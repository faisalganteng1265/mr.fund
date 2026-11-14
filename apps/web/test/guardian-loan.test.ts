import {
  type GuardianViewClient,
  guardianPositionPayload,
  POSITION_GAS,
} from "@mrfund/guardian-client";
import { err, type NearTransaction, ok } from "@mrfund/shared";
import { describe, expect, it } from "vitest";
import type { TransactionSigner } from "../src/execution/signer";
import { createLiveGuardian } from "../src/guardian/live";
import {
  buildLoanStep,
  internalToAtomicDown,
  internalToAtomicUp,
  loanAvailability,
  loanChanged,
  parseBalance,
  readHoldings,
  rheaBalance,
  sweepableDebt,
} from "../src/guardian/loan";
import {
  type GuardianExpectation,
  type GuardianIntent,
  verifyGuardianPayload,
} from "../src/guardian/verify";
import { createdViews, factory, NOW, OWNER, snapshot, views } from "./guardian-fixture";

const GUARDIAN = "guardian.testnet";
const WRAP = "wrap.testnet";
const USDC = "usdc.testnet";
const HASH = "7fVZ6aHCNXnz8VzM6uz5jzH6oUxYy1bJwbV3aD1Eo2Gv";
const owner = { ownerId: OWNER, nowMs: NOW };

/** Mutable chain facts for the Guardian-held loan (collateral extra decimals 0, debt 12). */
interface Loan {
  collateralInternal: string;
  borrowedInternal: string;
  guardianUsdc: string;
  guardianWrap: string;
  ownerWrap: string;
  account?: unknown;
}
const loan = (over: Partial<Loan> = {}): Loan => ({
  collateralInternal: "0",
  borrowedInternal: "0",
  guardianUsdc: "200",
  guardianWrap: "0",
  ownerWrap: "1000",
  ...over,
});

function client(l: Loan, data = views(), fail: string | null = null): GuardianViewClient {
  return {
    async view(id: string, method: string, args: unknown) {
      if (method === fail) return err({ kind: "rpc_unavailable" as const, detail: "down" });
      const at = (v: unknown) => ok({ data: v, blockHeight: 1, blockHash: "b" });
      const who = (args as { account_id?: string }).account_id;
      if (id === factory.factoryId) {
        const f: Record<string, unknown> = {
          get_template: {
            debt_token_id: factory.debtTokenId,
            collateral_token_id: factory.collateralTokenId,
            lending_id: factory.lendingId,
            fee_recipient_id: factory.feeRecipientId,
            activation_fee: factory.activationFee.toString(),
          },
          get_limits: {
            min_funding: factory.minFunding.toString(),
            max_funding: factory.maxFunding.toString(),
          },
          get_guardian: GUARDIAN,
          is_pending: false,
          get_unclaimed: "0",
          get_next_guardian_id: GUARDIAN,
        };
        return at(f[method]);
      }
      if (id === GUARDIAN) return at((data as Record<string, unknown>)[method]);
      if (method === "ft_metadata")
        return at(
          id === WRAP ? { symbol: "wNEAR", decimals: 24 } : { symbol: "USDC", decimals: 6 },
        );
      if (method === "get_account" && id === "rhea.testnet")
        return at(
          "account" in l
            ? l.account
            : {
                account_id: GUARDIAN,
                supplied: [],
                collateral: [{ token_id: WRAP, balance: l.collateralInternal, shares: "1" }],
                borrowed: [{ token_id: USDC, balance: l.borrowedInternal, shares: "1" }],
              },
        );
      if (method === "ft_balance_of") {
        if (id === USDC && who === GUARDIAN) return at(l.guardianUsdc);
        if (id === WRAP && who === GUARDIAN) return at(l.guardianWrap);
        if (id === WRAP && who === OWNER) return at(l.ownerWrap);
      }
      if (method === "storage_balance_of") return at({ total: "1" });
      return err({ kind: "bad_response" as const, detail: "unknown" });
    },
  };
}

const holdings = async (l = loan()) => {
  const h = await readHoldings(client(l), await snapshot(), () => NOW);
  if (!h) throw new Error("fixture");
  return h;
};

describe("Guardian-held loan reads", () => {
  it("parses balances strictly and rounds collateral down, debt up", () => {
    expect(parseBalance("12")).toBe(12n);
    for (const bad of ["-1", "1.5", "01", 12, null, "1".repeat(40)])
      expect(parseBalance(bad)).toBeNull();
    expect(internalToAtomicDown(1_999n, 3)).toBe(1n);
    expect(internalToAtomicUp(1_001n, 3)).toBe(2n);
    expect(internalToAtomicUp(1_000n, 3)).toBe(1n);
  });

  it("reads the Rhea account per token; a duplicate or malformed entry refuses the read", () => {
    const acct = {
      collateral: [{ token_id: WRAP, balance: "5" }],
      borrowed: [{ token_id: "other.testnet", balance: "9" }],
    };
    expect(rheaBalance(acct, "collateral", WRAP)).toBe(5n);
    expect(rheaBalance(acct, "borrowed", USDC)).toBe(0n);
    expect(rheaBalance(null, "borrowed", USDC)).toBe(0n);
    expect(
      rheaBalance(
        {
          collateral: [
            { token_id: WRAP, balance: "5" },
            { token_id: WRAP, balance: "6" },
          ],
        },
        "collateral",
        WRAP,
      ),
    ).toBeNull();
    expect(rheaBalance({ collateral: [{ token_id: WRAP, balance: 5 }] }, "collateral", WRAP)).toBe(
      null,
    );
    expect(rheaBalance({}, "collateral", WRAP)).toBeNull();
  });

  it("reads holdings from final-block views, in token atomic units", async () => {
    const h = await holdings(
      loan({ collateralInternal: "70", borrowedInternal: "30000000000001", guardianUsdc: "260" }),
    );
    expect(h).toMatchObject({
      collateralToken: { symbol: "wNEAR", decimals: 24 },
      collateralAtomic: 70n,
      debtAtomic: 31n,
      heldDebt: 260n,
      ownerCollateral: 1000n,
    });
    // Only the amount above the 200 reserve can be swept.
    expect(sweepableDebt(await snapshot(), h)).toBe(60n);
  });

  it("any failed or malformed read means no holdings, never zeros", async () => {
    const g = await snapshot();
    expect(await readHoldings(client(loan(), views(), "get_account"), g, () => NOW)).toBeNull();
    expect(await readHoldings(client(loan(), views(), "ft_balance_of"), g, () => NOW)).toBeNull();
    expect(await readHoldings(client(loan({ ownerWrap: "-5" })), g, () => NOW)).toBeNull();
    expect(await readHoldings(client(loan({ account: { collateral: 1 } })), g, () => NOW)).toBe(
      null,
    );
  });
});

describe("loan availability mirrors the contract", () => {
  it("borrow needs collateral, deposit needs wallet tokens, sweep needs something to sweep", async () => {
    const g = await snapshot();
    const empty = loanAvailability(g, await holdings(loan({ ownerWrap: "0" })), NOW);
    expect(empty.collateral.reason).toMatch(/no wNEAR/);
    expect(empty.borrow.reason).toBe("Deposit collateral first.");
    expect(empty.sweep_debt.reason).toBe("Nothing above the reserve.");
    expect(empty.sweep_collateral.reason).toBe("Nothing to sweep.");
    const funded = loanAvailability(
      g,
      await holdings(loan({ collateralInternal: "5", guardianUsdc: "300", guardianWrap: "1" })),
      NOW,
    );
    expect(Object.values(funded).every((s) => s.available)).toBe(true);
  });

  it("in flight, created or stale: every step waits with the reason", async () => {
    const h = await holdings(loan({ collateralInternal: "5" }));
    const locked = await snapshot((v) => {
      (v.get_status as Record<string, unknown>).in_flight = {
        op_id: "1",
        amount: "5",
        fee: "0",
        started_ns: "1",
        repay_phase: null,
      };
    });
    for (const [g, nowMs, reason] of [
      [locked, NOW, /in flight/],
      [await snapshot(createdViews), NOW, /Activate/],
      [await snapshot(), NOW + 120_001, /Refresh/],
    ] as const) {
      const a = loanAvailability(g, h, nowMs);
      for (const s of Object.values(a)) {
        expect(s.available).toBe(false);
        expect(s.reason).toMatch(reason);
      }
    }
  });

  it("a deposit above the wallet balance is refused before any payload exists", async () => {
    const r = buildLoanStep(
      await snapshot(),
      await holdings(),
      { kind: "collateral", amount: 1001n },
      owner,
    );
    expect(r).toEqual({ ok: false, reason: expect.stringMatching(/more wNEAR than your wallet/) });
  });
});

const expectation = (
  guardian: GuardianExpectation["guardian"],
  over: Partial<GuardianExpectation> = {},
): GuardianExpectation => ({
  network: "testnet",
  session: { network: "testnet", accountId: OWNER },
  signerId: OWNER,
  factory,
  guardian,
  ...over,
});
const unwrap = (r: { ok: true; value: NearTransaction[] } | { ok: false }) => {
  if (!r.ok) throw new Error("fixture");
  return r.value;
};
const tamper = (
  p: NearTransaction[],
  mutate: (a: NearTransaction["actions"][0], t: NearTransaction) => void,
) => {
  const copy = structuredClone(p);
  const t = copy[0];
  const a = t?.actions[0];
  if (!t || !a) throw new Error("fixture");
  mutate(a, t);
  return copy;
};

describe("verifyGuardianPayload: Guardian-held loan", async () => {
  const active = await snapshot();
  const deposit = unwrap(
    guardianPositionPayload(active, { kind: "collateral", amount: 7n }, owner),
  );
  const borrow = unwrap(guardianPositionPayload(active, { kind: "borrow", amount: 9n }, owner));
  const sweep = unwrap(
    guardianPositionPayload(active, { kind: "sweep", token: "debt_token" }, owner),
  );
  const depositIntent: GuardianIntent = { kind: "collateral", amount: 7n };
  const borrowIntent: GuardianIntent = { kind: "borrow", amount: 9n };
  const sweepIntent: GuardianIntent = { kind: "sweep", token: "debt_token" };

  it("accepts exactly what the builders emit", async () => {
    for (const [p, intent] of [
      [deposit, depositIntent],
      [borrow, borrowIntent],
      [sweep, sweepIntent],
      [
        unwrap(
          guardianPositionPayload(active, { kind: "sweep", token: "collateral_token" }, owner),
        ),
        { kind: "sweep", token: "collateral_token" },
      ],
    ] as const) {
      const r = verifyGuardianPayload(p, intent, expectation(active));
      if (!r.ok) throw new Error(`${intent.kind}: ${r.reason}`);
      expect(r.value.intent).toBe(intent.kind);
    }
    expect(deposit[0]?.actions[0]?.gas).toBe(POSITION_GAS);
  });

  const locked = await snapshot((v) => {
    (v.get_status as Record<string, unknown>).in_flight = {
      op_id: "1",
      amount: "5",
      fee: "0",
      started_ns: "1",
      repay_phase: null,
    };
  });
  const created = await snapshot(createdViews);
  it.each<[string, unknown, GuardianIntent, GuardianExpectation]>([
    [
      "a deposit through another token",
      tamper(deposit, (_a, t) => {
        t.receiverId = USDC;
      }),
      depositIntent,
      expectation(active),
    ],
    [
      "a deposit to another receiver",
      tamper(deposit, (a) => {
        a.args.receiver_id = "evil.testnet";
      }),
      depositIntent,
      expectation(active),
    ],
    [
      "a deposit with the reserve message",
      tamper(deposit, (a) => {
        a.args.msg = JSON.stringify({ reserve: {} });
      }),
      depositIntent,
      expectation(active),
    ],
    [
      "a deposit amount other than chosen",
      deposit,
      { kind: "collateral", amount: 8n },
      expectation(active),
    ],
    [
      "a deposit with too little gas to reach the Guardian",
      tamper(deposit, (a) => {
        a.gas = 179n * 10n ** 12n;
      }),
      depositIntent,
      expectation(active),
    ],
    [
      "a borrow below 260 Tgas",
      tamper(borrow, (a) => {
        a.gas = 259n * 10n ** 12n;
      }),
      borrowIntent,
      expectation(active),
    ],
    [
      "a borrow on another Guardian",
      tamper(borrow, (_a, t) => {
        t.receiverId = "other-guardian.testnet";
      }),
      borrowIntent,
      expectation(active),
    ],
    [
      "a borrow with 2 yocto",
      tamper(borrow, (a) => {
        a.deposit = 2n;
      }),
      borrowIntent,
      expectation(active),
    ],
    [
      "a borrow amount other than chosen",
      borrow,
      { kind: "borrow", amount: 10n },
      expectation(active),
    ],
    [
      "a sweep of an unconfigured token",
      tamper(sweep, (a) => {
        a.args.token_id = "evil-token.testnet";
      }),
      sweepIntent,
      expectation(active),
    ],
    [
      "a sweep labelled debt but aimed at collateral",
      sweep,
      { kind: "sweep", token: "collateral_token" },
      expectation(active),
    ],
    [
      "an extra argument",
      tamper(borrow, (a) => {
        a.args.receiver = "evil.testnet";
      }),
      borrowIntent,
      expectation(active),
    ],
    ["a borrow while an operation is in flight", borrow, borrowIntent, expectation(locked)],
    ["a deposit before activation", deposit, depositIntent, expectation(created)],
    [
      "a non-owner signer",
      borrow,
      borrowIntent,
      expectation(active, {
        signerId: "bob.testnet",
        session: { network: "testnet", accountId: "bob.testnet" },
      }),
    ],
  ])("refuses %s", (_name, payload, intent, x) => {
    expect(verifyGuardianPayload(payload, intent, x).ok).toBe(false);
  });
});

function signer(onSign: () => Promise<unknown>): TransactionSigner & { calls: unknown[] } {
  const calls: unknown[] = [];
  return {
    accountId: OWNER,
    network: "testnet",
    calls,
    async signAndSend(v) {
      calls.push(v);
      return onSign();
    },
  };
}

describe("live store: each loan step is reconciled from two chain reads", () => {
  const store = (l: Loan, s: TransactionSigner) =>
    createLiveGuardian({
      client: client(l),
      network: "testnet",
      factoryId: factory.factoryId,
      ownerId: OWNER,
      signer: s,
      now: () => NOW,
    });
  const ready = (g: ReturnType<typeof store>) => {
    const st = g.getSnapshot().state;
    if (st.status !== "ready" || st.activation.kind !== "activated" || !st.holdings)
      throw new Error("fixture");
    return { guardian: st.activation.guardian, holdings: st.holdings };
  };

  it("a deposit the chain shows is reported with before and after and its hash", async () => {
    const l = loan();
    const s = signer(async () => {
      l.collateralInternal = "7";
      l.ownerWrap = "993";
      return [{ transaction: { hash: HASH } }];
    });
    const g = store(l, s);
    await g.refresh();
    const { guardian, holdings: h } = ready(g);
    await g.run(buildLoanStep(guardian, h, { kind: "collateral", amount: 7n }, owner));
    expect(s.calls).toHaveLength(1);
    const o = g.getSnapshot().loan;
    expect(o).toMatchObject({
      intent: "collateral",
      before: { collateralAtomic: 0n },
      after: { collateralAtomic: 7n },
      hashes: [HASH],
      walletError: false,
    });
    if (o) expect(loanChanged(o)).toBe(true);
  });

  it("a wallet rejection with nothing changed is never shown as done", async () => {
    const l = loan({ collateralInternal: "5" });
    const s = signer(async () => {
      throw new Error("User rejected");
    });
    const g = store(l, s);
    await g.refresh();
    const { guardian, holdings: h } = ready(g);
    await g.run(buildLoanStep(guardian, h, { kind: "borrow", amount: 3n }, owner));
    const o = g.getSnapshot().loan;
    expect(o).toMatchObject({ intent: "borrow", walletError: true });
    if (o) expect(loanChanged(o)).toBe(false);
  });

  it("Check again re-compares the same step with the newest read", async () => {
    const l = loan({ collateralInternal: "5" });
    const g = store(
      l,
      signer(async () => []),
    );
    await g.refresh();
    const { guardian, holdings: h } = ready(g);
    await g.run(buildLoanStep(guardian, h, { kind: "borrow", amount: 3n }, owner));
    const first = g.getSnapshot().loan;
    if (first) expect(loanChanged(first)).toBe(false);
    l.borrowedInternal = "3000000000000";
    await g.refresh();
    const second = g.getSnapshot().loan;
    expect(second?.after?.debtAtomic).toBe(3n);
    if (second) expect(loanChanged(second)).toBe(true);
  });

  it("a tampered payload never reaches the wallet", async () => {
    const s = signer(async () => []);
    const g = store(loan({ collateralInternal: "5" }), s);
    await g.refresh();
    const { guardian, holdings: h } = ready(g);
    const built = buildLoanStep(guardian, h, { kind: "borrow", amount: 3n }, owner);
    if (!built.ok) throw new Error(built.reason);
    await g.run({ ...built, intent: { kind: "borrow", amount: 4n } });
    expect(s.calls).toHaveLength(0);
    expect(g.getSnapshot().notice).toMatch(/differs/);
    expect(g.getSnapshot().loan).toBeNull();
  });
});
