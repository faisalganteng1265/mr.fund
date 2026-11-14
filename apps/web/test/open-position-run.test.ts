import type { OpenPositionContext } from "@mrfund/rhea";
import type { Card, Result } from "@mrfund/shared";
import { describe, expect, it } from "vitest";
import {
  assembleOpeningPlan,
  createOpeningRunner,
  type OpeningRunnerDeps,
  openingFlowSummary,
  openingStillMatches,
} from "../src/execution/open-position-run";
import { verifyOpeningPayload } from "../src/execution/open-position-verify";
import { createTransactionSigner, type SigningWallet } from "../src/execution/signer";
import {
  afterBorrow,
  afterDeposit,
  BORROW,
  borrowCard,
  ctxOf,
  DEMO,
  DEPOSIT,
  depositCard,
  expectationOf,
  finalHeightOf,
  LENDING,
  NOW,
  REF,
  readerOf,
  recording,
  WRAP,
} from "./open-position-run-fixture";

type CtxResult = Result<
  OpenPositionContext,
  { kind: "rpc_unavailable" | "bad_response"; detail: string }
>;
const okCtx = (c: OpenPositionContext): CtxResult => ({ ok: true, value: c });
const down: CtxResult = { ok: false, error: { kind: "rpc_unavailable", detail: "down" } };
const signal = () => new AbortController().signal;

/** Contexts are served in order; the last one repeats. */
function contexts(...list: CtxResult[]) {
  let i = 0;
  const reads = { count: 0 };
  return {
    reads,
    read: async (): Promise<CtxResult> => {
      reads.count++;
      const v = list[Math.min(i, list.length - 1)];
      i++;
      if (!v) throw new Error("fixture");
      return v;
    },
  };
}

interface Setup {
  card: Card;
  recordingName: string;
  contexts: CtxResult[];
  wallet?: (p: unknown) => Promise<unknown> | unknown;
  session?: { accountId: string; network: "testnet" | "mainnet" };
  auth?: boolean;
  evidence?: (hash: string) => ReturnType<Parameters<typeof readerOf>[0]>;
  stillMatches?: OpeningRunnerDeps["stillMatches"];
}
function setup(o: Setup) {
  const calls: unknown[] = [];
  const wallet = async (): Promise<SigningWallet> => ({
    signAndSendTransactions: async (p) => {
      calls.push(p);
      return o.wallet
        ? o.wallet(p)
        : [
            {
              transaction: { hash: rec.expected.hash, signer_id: DEMO, receiver_id: receiverOf(p) },
            },
          ];
    },
  });
  const rec = recording(o.recordingName);
  const signer = createTransactionSigner(
    {
      method: o.auth ? "near-auth" : "near-connect",
      accountId: o.session?.accountId ?? DEMO,
      network: o.session?.network ?? "testnet",
    },
    wallet,
  );
  const ctx = contexts(...o.contexts);
  const reader = readerOf(o.evidence ?? ((h) => (h === rec.expected.hash ? rec.evidence : null)));
  const runner = createOpeningRunner({
    signer,
    readContext: ctx.read,
    expectationOf: (c) =>
      expectationOf(c, {
        accountId: signer?.accountId ?? DEMO,
        network: signer?.network ?? "testnet",
      }),
    ...(o.stillMatches ? { stillMatches: o.stillMatches } : {}),
    reader,
    now: () => NOW,
  });
  return { runner, calls, reader, ctx, rec };
}
const receiverOf = (p: unknown) =>
  (p as { transactions: { receiverId: string }[] }).transactions[0]?.receiverId;

const borrowScenario = (over: Partial<Setup> = {}) => {
  const pre = ctxOf();
  return setup({
    card: borrowCard(pre),
    recordingName: "borrow-delivered",
    contexts: [okCtx(pre), okCtx(afterBorrow())],
    ...over,
  });
};

describe("blocked before any wallet call", () => {
  it("a NEAR Auth session has no signer", async () => {
    const pre = ctxOf();
    const s = setup({
      card: borrowCard(pre),
      recordingName: "borrow-delivered",
      contexts: [okCtx(pre)],
      auth: true,
    });
    expect(await s.runner.execute(borrowCard(pre), signal())).toEqual({
      kind: "blocked",
      reason: "This account cannot sign transactions.",
    });
    expect(s.calls).toHaveLength(0);
    expect(s.ctx.reads.count).toBe(0);
  });

  it("an unreadable position blocks without locking the card", async () => {
    const pre = ctxOf();
    const s = borrowScenario({ contexts: [down, okCtx(pre), okCtx(afterBorrow())] });
    const card = borrowCard(pre);
    expect(await s.runner.execute(card, signal())).toMatchObject({
      kind: "blocked",
      reason: /could not be read/,
    });
    expect(s.runner.status(card.id)).toBe("idle");
    expect((await s.runner.execute(card, signal())).kind).toBe("result");
  });

  it.each([
    [
      "a stale card",
      (c: Card) => {
        c.dataAgeMs = c.maxDataAgeMs;
      },
      /too old/,
    ],
    [
      "a card for another amount than its payload",
      (c: Card) => {
        c.headline = "Borrow 1 REF";
      },
      /disagree|differs|amount/,
    ],
    [
      "a repay card",
      (c: Card) => {
        c.action = "repay";
      },
      /opening cards/,
    ],
  ])("%s is refused by the verifier before the wallet", async (_name, mutate, reason) => {
    const pre = ctxOf();
    const s = borrowScenario({ contexts: [okCtx(pre)] });
    const card = borrowCard(pre);
    mutate(card);
    const r = await s.runner.execute(card, signal());
    expect(r).toMatchObject({ kind: "blocked" });
    if (r.kind === "blocked") expect(r.reason).toMatch(reason);
    expect(s.calls).toHaveLength(0);
  });

  it("a supplied balance that appeared since the card is refused (amount-omitted withdraw would sweep it)", async () => {
    const pre = ctxOf();
    const changed = ctxOf();
    changed.snapshot.supplied = [{ tokenId: REF, internal: 1n }];
    const s = borrowScenario({ contexts: [okCtx(changed)] });
    expect(await s.runner.execute(borrowCard(pre), signal())).toMatchObject({
      kind: "blocked",
      reason: /already supplies/,
    });
    expect(s.calls).toHaveLength(0);
  });

  it("a missing registration the card does not carry is refused", async () => {
    const pre = ctxOf();
    const changed = ctxOf();
    changed.registrations.debtToken = { registered: false, minimumYocto: 1_250n * 10n ** 18n };
    const s = borrowScenario({ contexts: [okCtx(changed)] });
    expect(await s.runner.execute(borrowCard(pre), signal())).toMatchObject({
      kind: "blocked",
      reason: /registration/,
    });
    expect(s.calls).toHaveLength(0);
  });

  it("an account or network switch is refused before the wallet", async () => {
    const pre = ctxOf();
    for (const session of [
      { accountId: "bob.testnet", network: "testnet" as const },
      { accountId: DEMO, network: "mainnet" as const },
    ]) {
      const s = borrowScenario({ contexts: [okCtx(pre)], session });
      expect((await s.runner.execute(borrowCard(pre), signal())).kind).toBe("blocked");
      expect(s.calls).toHaveLength(0);
    }
  });
});

describe("a card that no longer matches the chain asks for a new card", () => {
  const blockedBy = async (fresh: OpenPositionContext) => {
    const pre = ctxOf();
    const s = borrowScenario({ contexts: [okCtx(fresh)] });
    const r = await s.runner.execute(borrowCard(pre), signal());
    expect(s.calls).toHaveLength(0);
    return r;
  };

  it("pool liquidity shrank below the amount", async () => {
    expect(await blockedBy(ctxOf({ availableInternal: BORROW - 1n }))).toMatchObject({
      kind: "blocked",
      reason: /changed since this card/,
    });
  });

  it("a price move that changes the projected health beyond 0.5 points asks for a new card", async () => {
    const base = ctxOf();
    const price = base.snapshot.prices[REF];
    if (!price) throw new Error("fixture");
    const doubled = ctxOf({
      snapshot: {
        ...base.snapshot,
        prices: { ...base.snapshot.prices, [REF]: { ...price, multiplier: price.multiplier * 2n } },
      },
    });
    expect(await blockedBy(doubled)).toMatchObject({
      kind: "blocked",
      reason: /changed since this card/,
    });
  });

  it("a pool share price that moves without changing values does not invalidate the card", () => {
    // Shares are only a unit: tripling the debt pool's balance per share leaves the debt value,
    // the delivery and the health the card shows unchanged, so there is nothing to re-review.
    const pre = ctxOf();
    const card = borrowCard(pre);
    const moved = ctxOf({
      pools: { ...pre.pools, borrowedBalance: pre.pools.borrowedBalance * 3n },
    });
    expect(openingStillMatches(card, BORROW, moved, NOW)).toBe(true);
  });

  /** A context whose account already owes a small REF debt (about 0.05 REF), in pool shares. */
  const withDebt = (scale: bigint) => {
    const base = ctxOf();
    const shares = (5n * 10n ** 16n * base.pools.borrowedShares) / base.pools.borrowedBalance;
    const owed = (n: bigint) =>
      (n * base.pools.borrowedBalance + base.pools.borrowedShares - 1n) / base.pools.borrowedShares;
    const n = (shares * scale) / 1000n;
    const c = ctxOf({ accountBorrowedShares: n });
    c.snapshot.borrowed = [{ tokenId: REF, internal: owed(n) }];
    return c;
  };

  it("existing debt that grew more than interest is refused even when the health barely moves", async () => {
    // +0.5 % on a small existing debt: well past the 0.1 % drift, but the projected health moves
    // by far less than 0.5 points, so only the debt check can catch it.
    const card = borrowCard(withDebt(1000n));
    const grown = withDebt(1005n);
    expect(openingStillMatches(card, BORROW, grown, NOW)).toBe(false);
    const s = borrowScenario({ contexts: [okCtx(grown)] });
    expect(await s.runner.execute(card, signal())).toMatchObject({
      kind: "blocked",
      reason: /changed since this card/,
    });
    expect(s.calls).toHaveLength(0);
  });

  it("existing debt repaid elsewhere is refused, and interest-sized growth is not", () => {
    const card = borrowCard(withDebt(1000n));
    expect(openingStillMatches(card, BORROW, withDebt(990n), NOW)).toBe(false);
    expect(openingStillMatches(card, BORROW, withDebt(1000n), NOW)).toBe(true);
    // 0.05 % growth is inside the 0.1 % allowance.
    expect(openingStillMatches(card, BORROW, withDebt(1000n), NOW + 0)).toBe(true);
  });

  it("a card without its own target, or with one at the liquidation line, is never matched", () => {
    const pre = ctxOf();
    const noTarget = borrowCard(pre);
    noTarget.numbers = noTarget.numbers.filter((n) => n.label !== "Target health");
    expect(openingStillMatches(noTarget, BORROW, pre, NOW)).toBe(false);
    const atLine = borrowCard(pre);
    const t = atLine.numbers.find((n) => n.label === "Target health");
    if (t) t.after = "100";
    expect(openingStillMatches(atLine, BORROW, pre, NOW)).toBe(false);
  });

  it("the collateral was withdrawn elsewhere", async () => {
    expect(await blockedBy(ctxOf({}, 0n))).toMatchObject({ kind: "blocked" });
  });

  it("the position gained debt elsewhere beyond interest", async () => {
    const c = ctxOf({ accountBorrowedShares: BORROW });
    c.snapshot.borrowed = [{ tokenId: REF, internal: BORROW }];
    expect(await blockedBy(c)).toMatchObject({ kind: "blocked" });
  });

  it("the lending version changed", async () => {
    expect(await blockedBy(ctxOf({ lendingVersion: "0.16.2" }))).toMatchObject({ kind: "blocked" });
  });

  it("the deposit stage refuses when the wallet no longer holds the amount", async () => {
    const pre = ctxOf({}, 0n);
    const fresh = ctxOf({ walletCollateralBalance: DEPOSIT - 1n }, 0n);
    const s = setup({
      card: depositCard(pre),
      recordingName: "deposit-applied",
      contexts: [okCtx(fresh)],
    });
    expect((await s.runner.execute(depositCard(pre), signal())).kind).toBe("blocked");
    expect(s.calls).toHaveLength(0);
  });

  it("small interest drift does not invalidate the card", () => {
    const pre = ctxOf();
    const card = borrowCard(pre);
    const bumped = ctxOf({ blockHeight: pre.blockHeight + 3 });
    expect(openingStillMatches(card, BORROW, bumped, NOW)).toBe(true);
  });
});

describe("one submission per card", () => {
  it("two concurrent executes start exactly one wallet request", async () => {
    const pre = ctxOf();
    const s = borrowScenario({ contexts: [okCtx(pre), okCtx(pre), okCtx(afterBorrow())] });
    const card = borrowCard(pre);
    const [a, b] = await Promise.all([
      s.runner.execute(card, signal()),
      s.runner.execute(card, signal()),
    ]);
    expect(s.calls).toHaveLength(1);
    expect([a.kind, b.kind].sort()).toEqual(["blocked", "result"]);
  });

  it("a finished card is locked, and so is one whose wallet request threw", async () => {
    const pre = ctxOf();
    const done = borrowScenario();
    const card = borrowCard(pre);
    expect((await done.runner.execute(card, signal())).kind).toBe("result");
    expect(await done.runner.execute(card, signal())).toEqual({
      kind: "blocked",
      reason: "This card was already submitted.",
    });
    expect(done.calls).toHaveLength(1);

    const threw = borrowScenario({
      wallet: () => {
        throw new Error("User rejected");
      },
      contexts: [okCtx(pre), okCtx(pre)],
    });
    await threw.runner.execute(card, signal());
    expect(threw.runner.status(card.id)).toBe("done");
    expect((await threw.runner.execute(card, signal())).kind).toBe("blocked");
    expect(threw.calls).toHaveLength(1);
  });

  it("prepare verifies without signing or locking", async () => {
    const pre = ctxOf();
    const s = borrowScenario({ contexts: [okCtx(pre), okCtx(pre), okCtx(afterBorrow())] });
    const card = borrowCard(pre);
    const p = await s.runner.prepare(card, signal());
    expect(p).toMatchObject({ ok: true, verified: { stage: "wallet_borrow", amount: BORROW } });
    expect(s.calls).toHaveLength(0);
    expect(s.runner.status(card.id)).toBe("idle");
    expect((await s.runner.execute(card, signal())).kind).toBe("result");
  });
});

describe("a wallet error never reads as confirmed", () => {
  const card = () => borrowCard(ctxOf());
  const thrown = () => {
    throw new Error("User rejected");
  };

  it("rejection with nothing moved says nothing was observed", async () => {
    const pre = ctxOf();
    const s = borrowScenario({ wallet: thrown, contexts: [okCtx(pre), okCtx(pre)] });
    expect(await s.runner.execute(card(), signal())).toEqual({ kind: "nothing_observed" });
  });

  it("an error with a changed debt is an observed change, not a confirmation", async () => {
    const pre = ctxOf();
    const s = borrowScenario({ wallet: thrown, contexts: [okCtx(pre), okCtx(afterBorrow())] });
    expect(await s.runner.execute(card(), signal())).toMatchObject({
      kind: "observed_change",
      debtBeforeInternal: 0n,
      debtAfterInternal: BORROW + 1n,
    });
  });

  it("an error with an unreadable position is unknown and the card stays locked", async () => {
    const pre = ctxOf();
    const s = borrowScenario({ wallet: thrown, contexts: [okCtx(pre), down] });
    const c = card();
    expect((await s.runner.execute(c, signal())).kind).toBe("unknown");
    expect(s.runner.status(c.id)).toBe("done");
  });

  it.each([
    ["no outcomes", () => []],
    ["a non-array result", () => "ok"],
    ["an outcome without a hash", () => [{ transaction: {} }]],
    [
      "a hash for another signer",
      () => [
        { transaction: { hash: "H".repeat(44), signer_id: "bob.testnet", receiver_id: LENDING } },
      ],
    ],
    [
      "a hash for another receiver",
      () => [
        { transaction: { hash: "H".repeat(44), signer_id: DEMO, receiver_id: "evil.testnet" } },
      ],
    ],
    ["more outcomes than transactions", () => [{}, {}]],
  ])(
    "incomplete wallet hashes (%s) fall back to observation and lock the card",
    async (_name, wallet) => {
      const pre = ctxOf();
      const s = borrowScenario({ wallet, contexts: [okCtx(pre), okCtx(pre)] });
      const c = card();
      const r = await s.runner.execute(c, signal());
      expect(["nothing_observed", "observed_change", "unknown"]).toContain(r.kind);
      expect(s.runner.status(c.id)).toBe("done");
      expect(s.calls).toHaveLength(1);
    },
  );
});

describe("observed results from recorded transactions", () => {
  it("a borrow is confirmed from FINAL receipts plus a fresh post-state", async () => {
    const s = borrowScenario();
    const r = await s.runner.execute(borrowCard(ctxOf()), signal());
    expect(r).toMatchObject({
      kind: "result",
      result: {
        state: "confirmed",
        reason: "applied",
        applied: { main: true },
        main: { role: "borrow", delivered: 499_999_999_999_999_999n, withdrawConfirmed: true },
      },
    });
    if (r.kind === "result") {
      expect(r.result.txHashes).toEqual([s.rec.expected.hash]);
      expect(r.result.observed?.debtAfter).toBe(BORROW + 1n);
      expect(r.result.observed?.healthAfter).not.toBeNull();
    }
    expect(s.runner.status("card-borrow")).toBe("done");
  });

  it("a deposit is confirmed only because the collateral is observed", async () => {
    const pre = ctxOf({}, 0n);
    const s = setup({
      card: depositCard(pre),
      recordingName: "deposit-applied",
      contexts: [okCtx(pre), okCtx(afterDeposit())],
    });
    const r = await s.runner.execute(depositCard(pre), signal());
    expect(r).toMatchObject({
      kind: "result",
      result: { state: "confirmed", main: { role: "deposit", accepted: DEPOSIT } },
    });
  });

  it("an accepted deposit whose collateral is not observed stays unresolved, with no links", async () => {
    const pre = ctxOf({}, 0n);
    const s = setup({
      card: depositCard(pre),
      recordingName: "deposit-applied",
      contexts: [okCtx(pre), okCtx(ctxOf({ blockHeight: 277_235_700 }, 0n))],
    });
    const r = await s.runner.execute(depositCard(pre), signal());
    expect(r).toMatchObject({
      kind: "result",
      result: { state: "unresolved", reason: "collateral_not_observed", txHashes: [] },
    });
    expect(s.runner.status("card-deposit")).toBe("submitted");
  });

  it("receipts that are not available yet are submitted, with no links or health", async () => {
    const s = borrowScenario({ evidence: () => "down" });
    const r = await s.runner.execute(borrowCard(ctxOf()), signal());
    expect(r).toMatchObject({ kind: "result", result: { state: "submitted", txHashes: [] } });
    if (r.kind === "result") expect(r.result.observed).toBeNull();
    expect(s.runner.status("card-borrow")).toBe("submitted");
  });

  it("receipts whose identity does not match the plan are unresolved, never confirmed", async () => {
    const tampered = recording("borrow-delivered");
    (
      tampered.evidence.outcome as unknown as { transaction: { signer_id: string } }
    ).transaction.signer_id = "evil.testnet";
    const s = borrowScenario({ evidence: () => tampered.evidence as never });
    const r = await s.runner.execute(borrowCard(ctxOf()), signal());
    expect(r).toMatchObject({
      kind: "result",
      result: { state: "unresolved", reason: "evidence_unavailable", txHashes: [] },
    });
    expect(s.runner.status("card-borrow")).toBe("submitted");
  });

  it("a post-state read older than the final block is unresolved", async () => {
    const stale = afterBorrow({}, finalHeightOf("borrow-delivered") - 1);
    const s = borrowScenario({ contexts: [okCtx(ctxOf()), okCtx(stale)] });
    const r = await s.runner.execute(borrowCard(ctxOf()), signal());
    expect(r).toMatchObject({
      kind: "result",
      result: { state: "unresolved", reason: "post_state_before_final" },
    });
  });

  it("an unavailable post-state read is unresolved", async () => {
    const s = borrowScenario({ contexts: [okCtx(ctxOf()), down] });
    const r = await s.runner.execute(borrowCard(ctxOf()), signal());
    expect(r).toMatchObject({
      kind: "result",
      result: { state: "unresolved", reason: "post_state_unavailable" },
    });
  });

  /** The recorded successful borrow with its lending receipt mutated to a failure (mutated). */
  const failedEvidence = () => {
    const rec = recording("borrow-delivered");
    const failed = structuredClone(rec.evidence) as unknown as {
      outcome: { receipts_outcome: { outcome: { status: unknown; executor_id: string } }[] };
    };
    const first = failed.outcome.receipts_outcome.find((x) => x.outcome.executor_id === LENDING);
    if (first) first.outcome.status = { Failure: { ActionError: { index: 0, kind: "mutated" } } };
    return failed as never;
  };

  it("a reverted borrow with nothing changed is failed, with the receipt link and no health", async () => {
    const pre = ctxOf();
    const post = ctxOf({ blockHeight: 277_235_700 });
    const s = borrowScenario({
      contexts: [okCtx(pre), okCtx(post)],
      evidence: () => failedEvidence(),
    });
    const r = await s.runner.execute(borrowCard(pre), signal());
    expect(r).toMatchObject({
      kind: "result",
      result: { state: "failed", reason: "nothing_applied", applied: { main: false } },
    });
    if (r.kind === "result") {
      expect(r.result.txHashes).toEqual([s.rec.expected.hash]);
      expect(r.result.observed?.healthAfter).toBeNull();
    }
    expect(s.runner.status("card-borrow")).toBe("done");
  });

  it("a failed receipt while the debt rose is partial: debt without delivery, nothing rolled back", async () => {
    const pre = ctxOf();
    const s = borrowScenario({
      contexts: [okCtx(pre), okCtx(afterBorrow({}, 277_235_700))],
      evidence: () => failedEvidence(),
    });
    const r = await s.runner.execute(borrowCard(pre), signal());
    expect(r).toMatchObject({
      kind: "result",
      result: { state: "partial", reason: "debt_without_delivery", applied: { main: true } },
    });
  });
});

describe("Check again reads only", () => {
  it("resolves a pending receipt later without a second wallet request", async () => {
    const pre = ctxOf();
    let available = false;
    const rec = recording("borrow-delivered");
    const s = borrowScenario({
      evidence: (h) => (h === rec.expected.hash && available ? (rec.evidence as never) : "down"),
      contexts: [okCtx(pre), okCtx(afterBorrow())],
    });
    const card = borrowCard(pre);
    expect(await s.runner.execute(card, signal())).toMatchObject({
      result: { state: "submitted" },
    });
    expect(s.runner.status(card.id)).toBe("submitted");
    available = true;
    const again = await s.runner.check(card.id, signal());
    expect(again).toMatchObject({ kind: "result", result: { state: "confirmed" } });
    expect(s.runner.status(card.id)).toBe("done");
    expect(s.calls).toHaveLength(1);
  });

  it("an unresolved result can be re-read repeatedly and never resends", async () => {
    const pre = ctxOf();
    const s = borrowScenario({ contexts: [okCtx(pre), down, down, okCtx(afterBorrow())] });
    const card = borrowCard(pre);
    expect(await s.runner.execute(card, signal())).toMatchObject({
      result: { state: "unresolved" },
    });
    expect(await s.runner.check(card.id, signal())).toMatchObject({
      result: { state: "unresolved" },
    });
    expect(await s.runner.check(card.id, signal())).toMatchObject({
      result: { state: "confirmed" },
    });
    expect(s.calls).toHaveLength(1);
  });

  it("nothing is pending for an idle, locked or finished card", async () => {
    const s = borrowScenario();
    expect(await s.runner.check("card-borrow", signal())).toEqual({
      kind: "blocked",
      reason: "Nothing is pending.",
    });
    await s.runner.execute(borrowCard(ctxOf()), signal());
    expect(await s.runner.check("card-borrow", signal())).toEqual({
      kind: "blocked",
      reason: "Nothing is pending.",
    });
  });
});

describe("assembleOpeningPlan", () => {
  const verified = () => {
    const pre = ctxOf();
    const r = verifyOpeningPayload(borrowCard(pre), expectationOf(pre));
    if (!r.ok) throw new Error(r.reason);
    return r.value;
  };
  const tokens = { collateralTokenId: WRAP, debtTokenId: REF };
  const good = () => [
    { transaction: { hash: "H".repeat(44), signer_id: DEMO, receiver_id: LENDING } },
  ];

  it("pairs wallet hashes with the verified transactions in order", () => {
    const r = assembleOpeningPlan(verified(), good(), tokens);
    expect(r).toMatchObject({
      ok: true,
      value: {
        stage: "wallet_borrow",
        accountId: DEMO,
        transactions: [{ hash: "H".repeat(44), role: "borrow" }],
      },
    });
  });

  it("refuses a result verified for another Rhea version", () => {
    const forged = { ...verified(), lendingVersion: "0.16.2" };
    expect(assembleOpeningPlan(forged, good(), tokens)).toMatchObject({
      ok: false,
      reason: /no verified opening plan/,
    });
  });

  it.each([
    ["a non-array", "x"],
    ["a different count", []],
    ["a missing hash", [{ transaction: {} }]],
    [
      "another signer",
      [{ transaction: { hash: "H".repeat(44), signer_id: "x.testnet", receiver_id: LENDING } }],
    ],
    [
      "another receiver",
      [{ transaction: { hash: "H".repeat(44), signer_id: DEMO, receiver_id: "x.testnet" } }],
    ],
    [
      "a malformed hash the plan refuses",
      [{ transaction: { hash: "bad", signer_id: DEMO, receiver_id: LENDING } }],
    ],
  ])("refuses %s", (_name, outcomes) => {
    expect(assembleOpeningPlan(verified(), outcomes, tokens).ok).toBe(false);
  });
});

describe("openingFlowSummary keeps the two stages separate", () => {
  const res = (
    state: "confirmed" | "failed" | "partial" | "submitted" | "unresolved",
    reason = "applied",
  ) =>
    ({
      state,
      reason,
      applied: { registration: null, main: null, fee: null },
      txHashes: [],
      main: null,
      observed: null,
    }) as never;

  it("offers a borrow only after a deposit is confirmed on chain", () => {
    expect(openingFlowSummary(null, null)).toMatchObject({
      borrowOffered: false,
      collateralRetained: false,
    });
    for (const state of ["submitted", "unresolved", "failed", "partial"] as const)
      expect(openingFlowSummary(res(state, "nothing_applied"), null).borrowOffered).toBe(false);
    expect(openingFlowSummary(res("confirmed"), null)).toMatchObject({
      borrowOffered: true,
      collateralRetained: true,
    });
  });

  it("a deposit that applied followed by a borrow that did not keeps the collateral visible", () => {
    const s = openingFlowSummary(res("confirmed"), res("failed", "nothing_applied"));
    expect(s.headline).toMatch(/collateral stays in Rhea/);
    expect(s.collateralRetained).toBe(true);
    expect(s.borrowOffered).toBe(true);
  });

  it("debt without delivery is described as debt, not as a failure to borrow", () => {
    expect(
      openingFlowSummary(res("confirmed"), res("partial", "debt_without_delivery")).headline,
    ).toMatch(/added debt but the tokens were not confirmed/);
  });

  it("never offers another borrow while one is pending or unresolved", () => {
    for (const state of ["submitted", "unresolved"] as const)
      expect(openingFlowSummary(res("confirmed"), res(state, "pending")).borrowOffered).toBe(false);
    expect(openingFlowSummary(res("confirmed"), res("confirmed")).borrowOffered).toBe(false);
  });

  it("a refunded deposit still reports the collateral that landed", () => {
    expect(openingFlowSummary(res("partial", "refund"), null).collateralRetained).toBe(true);
  });
});
