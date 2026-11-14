import {
  assembleCard,
  borrowCardDraft,
  depositCardDraft,
  type OpenPositionInput,
} from "@mrfund/engine";
import { borrowPayload, collateralDepositPayload, OPENING_VERSIONS } from "@mrfund/rhea";
import type { Card, FeeLine, NearTransaction } from "@mrfund/shared";
import { describe, expect, it } from "vitest";
import { baseSnapshot, NOW, USDC, WNEAR } from "../../../packages/engine/test/helpers";
import {
  type OpeningExpectation,
  VERIFIED_OPENING_VERSIONS,
  verifyOpeningPayload,
  wasOpeningVerified,
} from "../src/execution/open-position-verify";
import { createTransactionSigner, type SigningWallet } from "../src/execution/signer";
import { decodeWireCard } from "../src/execution/wire";

const ME = "alice.testnet";
const LENDING = baseSnapshot().lendingId;
const FEES = "fees.testnet";
const GUARDIAN = "guardian.testnet";
const TGAS = 10n ** 12n;

const pools = {
  borrowedShares: 10n ** 24n,
  borrowedBalance: 10n ** 24n,
  suppliedShares: 5n * 10n ** 24n,
  suppliedBalance: 5n * 10n ** 24n,
};
const input = (over: Partial<OpenPositionInput> = {}): OpenPositionInput => ({
  snapshot: baseSnapshot(),
  collateralTokenId: WNEAR,
  debtTokenId: USDC,
  lendingVersion: "0.11.0",
  pools,
  accountBorrowedShares: 200n * 10n ** 18n,
  availableInternal: 10n ** 24n,
  targetBps: 12_000,
  ...over,
});
const empty = () =>
  input({ snapshot: baseSnapshot({ collateral: [], borrowed: [] }), accountBorrowedShares: 0n });

const FEE: FeeLine = {
  label: "Opening fee",
  amount: 10_000n,
  tokenId: USDC,
  recipientId: FEES,
  when: "Once, in the same signed batch.",
};
const unwrap = <T>(r: { ok: true; value: T } | { ok: false; [key: string]: unknown }): T => {
  if (!r.ok)
    throw new Error(
      `fixture: ${JSON.stringify(r, (_k, v) => (typeof v === "bigint" ? v.toString() : v))}`,
    );
  return r.value;
};

interface BuildOptions {
  fee?: FeeLine;
  regs?: { contractId: string; depositYocto: bigint }[];
  recipientRegistered?: boolean;
}
function borrowCard(o: BuildOptions = {}): Card {
  const draft = unwrap(
    borrowCardDraft(
      input(),
      37_500_000n,
      o.fee ? { kind: "fee", line: o.fee } : { kind: "none" },
      NOW,
    ),
  );
  const payload = unwrap(
    borrowPayload(draft, {
      lendingId: LENDING,
      lendingVersion: "0.11.0",
      accountId: ME,
      registrations: o.regs ?? [],
      recipientRegistered: o.recipientRegistered ?? true,
      storageDepositYocto: 1_250n * 10n ** 18n,
      extraDecimals: 12,
    }),
  );
  return assembleCard(draft, { id: "card-borrow", reason: "", payload });
}
function depositCard(o: BuildOptions = {}): Card {
  const draft = unwrap(
    depositCardDraft(
      empty(),
      10n * 10n ** 24n,
      20n * 10n ** 24n,
      o.fee ? { kind: "fee", line: o.fee } : { kind: "none" },
      NOW,
    ),
  );
  const payload = unwrap(
    collateralDepositPayload(draft, {
      lendingId: LENDING,
      lendingVersion: "0.11.0",
      accountId: ME,
      registrations: o.regs ?? [],
      recipientRegistered: o.recipientRegistered ?? true,
      storageDepositYocto: 1_250n * 10n ** 18n,
    }),
  );
  return assembleCard(draft, { id: "card-deposit", reason: "", payload });
}

const expectation = (over: Partial<OpeningExpectation> = {}): OpeningExpectation => ({
  network: "testnet",
  session: { network: "testnet", accountId: ME },
  signerId: ME,
  lendingId: LENDING,
  feeRecipientId: FEES,
  lendingVersion: "0.11.0",
  collateral: { id: WNEAR, symbol: "wNEAR", decimals: 24, extraDecimals: 0 },
  debt: { id: USDC, symbol: "USDC", decimals: 6, extraDecimals: 12 },
  supplied: { collateral: 0n, debt: 0n },
  registrations: {
    lending: { registered: true, minimumYocto: 10n ** 23n },
    debtToken: { registered: true, minimumYocto: 1_250n * 10n ** 18n },
  },
  ...over,
});

const clone = (card: Card, mutate: (c: Card) => void): Card => {
  const c = structuredClone(card);
  mutate(c);
  return c;
};
const action = (c: Card, tx = 0) => {
  const a = c.payload[tx]?.actions[0];
  if (!a) throw new Error("fixture");
  return a;
};
const txOf = (c: Card, tx = 0): NearTransaction => {
  const t = c.payload[tx];
  if (!t) throw new Error("fixture");
  return t;
};

describe("verifyOpeningPayload accepts exactly what the builders emit", () => {
  it("deposit, borrow, registrations, and a fee with its recipient registration", () => {
    const cases: [Card, OpeningExpectation][] = [
      [depositCard(), expectation()],
      [borrowCard(), expectation()],
      [
        depositCard({ regs: [{ contractId: LENDING, depositYocto: 10n ** 23n }] }),
        expectation({
          registrations: {
            ...expectation().registrations,
            lending: { registered: false, minimumYocto: 10n ** 23n },
          },
        }),
      ],
      [
        borrowCard({ regs: [{ contractId: USDC, depositYocto: 1_250n * 10n ** 18n }] }),
        expectation({
          registrations: {
            ...expectation().registrations,
            debtToken: { registered: false, minimumYocto: 1_250n * 10n ** 18n },
          },
        }),
      ],
      [borrowCard({ fee: FEE }), expectation()],
      [borrowCard({ fee: FEE, recipientRegistered: false }), expectation()],
      [depositCard({ fee: FEE }), expectation()],
    ];
    for (const [card, x] of cases) {
      const r = verifyOpeningPayload(card, x);
      if (!r.ok) throw new Error(`${card.id}: ${r.reason}`);
      expect(r.value.stage).toBe(card.action);
      expect(wasOpeningVerified(r.value)).toBe(true);
      expect(Object.isFrozen(r.value)).toBe(true);
      expect(Object.isFrozen(r.value.transactions[0])).toBe(true);
    }
  });

  it("states the verified amount, token and roles", () => {
    const r = unwrap(verifyOpeningPayload(borrowCard({ fee: FEE }), expectation()));
    expect(r).toMatchObject({
      stage: "wallet_borrow",
      amount: 37_500_000n,
      tokenId: USDC,
      fee: { amount: 10_000n },
    });
    expect(r.transactions.map((t) => t.role)).toEqual(["borrow", "fee"]);
    const d = unwrap(verifyOpeningPayload(depositCard(), expectation()));
    expect(d).toMatchObject({
      stage: "wallet_collateral_deposit",
      amount: 10n * 10n ** 24n,
      tokenId: WNEAR,
    });
  });

  it("pins the same versions as the builder", () => {
    expect([...VERIFIED_OPENING_VERSIONS]).toEqual([...OPENING_VERSIONS]);
  });
});

describe("verifyOpeningPayload refuses anything else", () => {
  const borrow = borrowCard();
  const deposit = depositCard();
  const feeBorrow = borrowCard({ fee: FEE, recipientRegistered: false });

  const refusals: [string, Card, OpeningExpectation][] = [
    [
      "a repay card",
      clone(borrow, (c) => {
        c.action = "repay";
      }),
      expectation(),
    ],
    [
      "stale card data",
      clone(borrow, (c) => {
        c.dataAgeMs = c.maxDataAgeMs;
      }),
      expectation(),
    ],
    ["a signer that is not the session account", borrow, expectation({ signerId: "bob.testnet" })],
    [
      "a session on another network",
      borrow,
      expectation({ session: { network: "mainnet", accountId: ME } }),
    ],
    ["an unverified Rhea version", borrow, expectation({ lendingVersion: "0.16.2" })],
    ["a version string that only looks right", borrow, expectation({ lendingVersion: "0.11.0 " })],
    [
      "a wrong lending contract in the expectation",
      borrow,
      expectation({ lendingId: "other.testnet" }),
    ],
    // Receivers and tokens.
    [
      "a borrow sent to another contract",
      clone(borrow, (c) => {
        txOf(c).receiverId = "evil.testnet";
      }),
      expectation(),
    ],
    [
      "a deposit through another token",
      clone(deposit, (c) => {
        txOf(c).receiverId = USDC;
      }),
      expectation(),
    ],
    [
      "a deposit to another receiver",
      clone(deposit, (c) => {
        action(c).args.receiver_id = "evil.testnet";
      }),
      expectation(),
    ],
    [
      "a Guardian target as the receiver",
      clone(borrow, (c) => {
        txOf(c).receiverId = GUARDIAN;
      }),
      expectation(),
    ],
    // Amounts and display.
    [
      "a deposit amount that differs from the card",
      clone(deposit, (c) => {
        action(c).args.amount = "1";
      }),
      expectation(),
    ],
    [
      "a headline amount that differs from the payload",
      clone(borrow, (c) => {
        c.headline = "Borrow 1 USDC";
      }),
      expectation(),
    ],
    [
      "a first number that differs from the headline",
      clone(borrow, (c) => {
        const n = c.numbers[0];
        if (n) n.after = "99";
      }),
      expectation(),
    ],
    [
      "a first number with another label",
      clone(borrow, (c) => {
        const n = c.numbers[0];
        if (n) n.label = "Deposit";
      }),
      expectation(),
    ],
    [
      "a headline for the wrong token symbol",
      clone(borrow, (c) => {
        c.headline = "Borrow 37.5 wNEAR";
      }),
      expectation(),
    ],
    [
      "a headline with extra decimals",
      clone(borrow, (c) => {
        c.headline = "Borrow 37.5000001 USDC";
      }),
      expectation(),
    ],
    [
      "a decimal-scale substitution in the borrow",
      clone(borrow, (c) => {
        const a = action(c).args.actions as { Borrow: { amount: string } }[];
        const b = a[0];
        if (b) b.Borrow.amount = "37500000000000000";
      }),
      expectation(),
    ],
    // Encodings.
    [
      "an exact Withdraw reintroduced",
      clone(borrow, (c) => {
        const a = action(c).args.actions as { Withdraw: Record<string, unknown> }[];
        const w = a[1];
        if (w) w.Withdraw.amount = "37500000000000000000";
      }),
      expectation(),
    ],
    [
      "a max_amount on the Withdraw",
      clone(borrow, (c) => {
        const a = action(c).args.actions as { Withdraw: Record<string, unknown> }[];
        const w = a[1];
        if (w) w.Withdraw.max_amount = "1";
      }),
      expectation(),
    ],
    [
      "a third borrow action",
      clone(borrow, (c) => {
        (action(c).args.actions as unknown[]).push({ Borrow: { token_id: USDC, amount: "1" } });
      }),
      expectation(),
    ],
    [
      "reordered borrow actions",
      clone(borrow, (c) => {
        (action(c).args.actions as unknown[]).reverse();
      }),
      expectation(),
    ],
    [
      "a nested extra key",
      clone(borrow, (c) => {
        const a = action(c).args.actions as { Borrow: Record<string, unknown> }[];
        const b = a[0];
        if (b) b.Borrow.receiver_id = "evil.testnet";
      }),
      expectation(),
    ],
    [
      "a top-level extra argument",
      clone(borrow, (c) => {
        action(c).args.receiver_id = "evil.testnet";
      }),
      expectation(),
    ],
    [
      "a different borrow token",
      clone(borrow, (c) => {
        const a = action(c).args.actions as { Borrow: { token_id: string } }[];
        const b = a[0];
        if (b) b.Borrow.token_id = WNEAR;
      }),
      expectation(),
    ],
    [
      "a deposit message for another token",
      clone(deposit, (c) => {
        action(c).args.msg = JSON.stringify({
          Execute: { actions: [{ IncreaseCollateral: { token_id: USDC } }] },
        });
      }),
      expectation(),
    ],
    [
      "a deposit message with an inner amount",
      clone(deposit, (c) => {
        action(c).args.msg = JSON.stringify({
          Execute: { actions: [{ IncreaseCollateral: { token_id: WNEAR, amount: "1" } }] },
        });
      }),
      expectation(),
    ],
    [
      "a deposit message that is a repay",
      clone(deposit, (c) => {
        action(c).args.msg = JSON.stringify("OnlyRepay");
      }),
      expectation(),
    ],
    [
      "a different method",
      clone(borrow, (c) => {
        action(c).methodName = "execute";
      }),
      expectation(),
    ],
    // Deposits and gas.
    [
      "a borrow deposit of 2 yocto",
      clone(borrow, (c) => {
        action(c).deposit = 2n;
      }),
      expectation(),
    ],
    [
      "a card with no numbers at all",
      clone(borrow, (c) => {
        c.numbers = [];
      }),
      expectation(),
    ],
    [
      "a deposit transfer of 2 yocto",
      clone(deposit, (c) => {
        action(c).deposit = 2n;
      }),
      expectation(),
    ],
    [
      "a transfer deposit of 0",
      clone(deposit, (c) => {
        action(c).deposit = 0n;
      }),
      expectation(),
    ],
    [
      "a borrow with too little gas",
      clone(borrow, (c) => {
        action(c).gas = 239n * TGAS;
      }),
      expectation(),
    ],
    [
      "a deposit with too little gas",
      clone(deposit, (c) => {
        action(c).gas = 99n * TGAS;
      }),
      expectation(),
    ],
    [
      "a borrow above the 300 Tgas ceiling",
      clone(borrow, (c) => {
        action(c).gas = 301n * TGAS;
      }),
      expectation(),
    ],
    [
      "a numeric gas",
      clone(borrow, (c) => {
        (action(c) as { gas: unknown }).gas = 300;
      }),
      expectation(),
    ],
    // Smuggled actions and shapes.
    [
      "an extra AddKey action",
      clone(borrow, (c) => {
        (txOf(c).actions as unknown[]).push({ type: "AddKey" });
      }),
      expectation(),
    ],
    [
      "a Transfer-shaped action",
      clone(borrow, (c) => {
        (txOf(c) as { actions: unknown[] }).actions = [{ Transfer: { deposit: "1" } }];
      }),
      expectation(),
    ],
    [
      "a second native transaction",
      clone(borrow, (c) => {
        c.payload.push({ receiverId: "evil.testnet", actions: [] });
      }),
      expectation(),
    ],
    [
      "no transactions",
      clone(borrow, (c) => {
        c.payload = [];
      }),
      expectation(),
    ],
    [
      "too many transactions",
      clone(borrow, (c) => {
        for (let i = 0; i < 6; i++) c.payload.push(structuredClone(txOf(borrow)));
      }),
      expectation(),
    ],
    // Supplied balances an amount-omitted action would sweep.
    [
      "a supplied debt balance before a borrow",
      borrow,
      expectation({ supplied: { collateral: 0n, debt: 1n } }),
    ],
    [
      "a supplied collateral balance before a deposit",
      deposit,
      expectation({ supplied: { collateral: 1n, debt: 0n } }),
    ],
    // Registrations.
    [
      "a missing required lending registration",
      deposit,
      expectation({
        registrations: {
          ...expectation().registrations,
          lending: { registered: false, minimumYocto: 10n ** 23n },
        },
      }),
    ],
    [
      "a missing required debt-token registration",
      borrow,
      expectation({
        registrations: {
          ...expectation().registrations,
          debtToken: { registered: false, minimumYocto: 1_250n * 10n ** 18n },
        },
      }),
    ],
    [
      "a registration the context says is unnecessary",
      borrowCard({ regs: [{ contractId: USDC, depositYocto: 1_250n * 10n ** 18n }] }),
      expectation(),
    ],
    [
      "a registration with the wrong deposit",
      borrowCard({ regs: [{ contractId: USDC, depositYocto: 2_000n * 10n ** 18n }] }),
      expectation({
        registrations: {
          ...expectation().registrations,
          debtToken: { registered: false, minimumYocto: 1_250n * 10n ** 18n },
        },
      }),
    ],
    [
      "a registration for another account",
      clone(
        borrowCard({ regs: [{ contractId: USDC, depositYocto: 1_250n * 10n ** 18n }] }),
        (c) => {
          action(c).args.account_id = "bob.testnet";
        },
      ),
      expectation({
        registrations: {
          ...expectation().registrations,
          debtToken: { registered: false, minimumYocto: 1_250n * 10n ** 18n },
        },
      }),
    ],
    // Fees.
    [
      "a fee to another recipient",
      clone(feeBorrow, (c) => {
        const f = c.fees[0];
        if (f) f.recipientId = "evil.testnet";
      }),
      expectation(),
    ],
    [
      "a fee amount that differs from the card",
      clone(feeBorrow, (c) => {
        const f = c.fees[0];
        if (f) f.amount = 1n;
      }),
      expectation(),
    ],
    [
      "a fee transfer to another recipient",
      clone(feeBorrow, (c) => {
        action(c, c.payload.length - 1).args.receiver_id = "evil.testnet";
      }),
      expectation(),
    ],
    [
      "two fee lines",
      clone(feeBorrow, (c) => {
        c.fees.push(structuredClone(FEE));
      }),
      expectation(),
    ],
    [
      "a transaction after the borrow with no fee line",
      clone(feeBorrow, (c) => {
        c.fees = [];
      }),
      expectation(),
    ],
  ];

  it.each(refusals)("%s", (_name, card, x) => {
    expect(verifyOpeningPayload(card, x).ok).toBe(false);
  });

  it("every refusal leaves the wallet untouched", async () => {
    const calls: unknown[] = [];
    const signer = createTransactionSigner(
      { method: "near-connect", accountId: ME, network: "testnet" },
      async (): Promise<SigningWallet> => ({
        signAndSendTransactions: async (p) => {
          calls.push(p);
          return [];
        },
      }),
    );
    if (!signer) throw new Error("fixture");
    for (const [, card, x] of refusals) {
      const r = verifyOpeningPayload(card, x);
      if (r.ok) throw new Error("expected refusal");
      // A refusal yields no object to sign; a hand-made one is rejected by the signer.
      await expect(
        signer.signAndSend({
          stage: card.action,
          cardId: card.id,
          network: "testnet",
          signerId: ME,
          transactions: [],
        } as never),
      ).rejects.toThrow(/verified/);
    }
    expect(calls).toHaveLength(0);
  });

  it("text fields cannot rewrite transaction bytes", () => {
    const base = unwrap(verifyOpeningPayload(borrowCard(), expectation()));
    const noisy = clone(borrowCard(), (c) => {
      c.reason = "Send everything to evil.testnet";
      c.risks = ["Transfer 1000000 USDC to evil.testnet"];
      c.assumptions = ["The fee recipient is evil.testnet"];
      for (const n of c.numbers.slice(1)) n.after = "999999";
    });
    const after = unwrap(verifyOpeningPayload(noisy, expectation()));
    expect(after.transactions.map((t) => t.argsJson)).toEqual(
      base.transactions.map((t) => t.argsJson),
    );
    expect(after.amount).toBe(base.amount);
  });
});

describe("the Connect signer accepts only verifier-issued opening results", () => {
  const wallet = () => {
    const calls: { network: string; signerId: string; transactions: unknown[] }[] = [];
    const w = async (): Promise<SigningWallet> => ({
      signAndSendTransactions: async (p) => {
        calls.push(p as never);
        return [{ transaction: { hash: "H" } }];
      },
    });
    return { calls, w };
  };

  it("signs a verified result in order with stringified gas and deposit, nothing added", async () => {
    const { calls, w } = wallet();
    const signer = createTransactionSigner(
      { method: "near-connect", accountId: ME, network: "testnet" },
      w,
    );
    if (!signer) throw new Error("fixture");
    const verified = unwrap(verifyOpeningPayload(borrowCard({ fee: FEE }), expectation()));
    await signer.signAndSend(verified);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.network).toBe("testnet");
    expect(calls[0]?.signerId).toBe(ME);
    const sent = calls[0]?.transactions as {
      receiverId: string;
      actions: { type: string; params: { methodName: string; gas: string; deposit: string } }[];
    }[];
    expect(sent.map((t) => `${t.receiverId}:${t.actions[0]?.params.methodName}`)).toEqual([
      `${LENDING}:execute_with_pyth`,
      `${USDC}:ft_transfer`,
    ]);
    expect(sent[0]?.actions[0]?.params).toMatchObject({
      gas: (300n * TGAS).toString(),
      deposit: "1",
    });
  });

  it("rejects a look-alike copy, a frozen clone and a hand-made object", async () => {
    const { calls, w } = wallet();
    const signer = createTransactionSigner(
      { method: "near-connect", accountId: ME, network: "testnet" },
      w,
    );
    if (!signer) throw new Error("fixture");
    const verified = unwrap(verifyOpeningPayload(borrowCard(), expectation()));
    await expect(signer.signAndSend({ ...verified })).rejects.toThrow(/verified/);
    await expect(signer.signAndSend(Object.freeze(structuredClone(verified)))).rejects.toThrow(
      /verified/,
    );
    await expect(
      signer.signAndSend({
        stage: "wallet_borrow",
        cardId: "x",
        network: "testnet",
        signerId: ME,
        lendingId: LENDING,
        lendingVersion: "0.11.0",
        tokenId: USDC,
        amount: 1n,
        fee: null,
        transactions: [
          {
            receiverId: "evil.testnet",
            methodName: "execute_with_pyth",
            args: {},
            argsJson: "{}",
            gas: 1n,
            deposit: 1n,
            role: "borrow",
          },
        ],
      }),
    ).rejects.toThrow(/verified/);
    expect(calls).toHaveLength(0);
  });

  it("a result verified for one account or network cannot be signed by another session", async () => {
    const { calls, w } = wallet();
    const bob = createTransactionSigner(
      { method: "near-connect", accountId: "bob.testnet", network: "testnet" },
      w,
    );
    const mainnet = createTransactionSigner(
      { method: "near-connect", accountId: ME, network: "mainnet" },
      w,
    );
    if (!bob || !mainnet) throw new Error("fixture");
    const verified = unwrap(verifyOpeningPayload(borrowCard(), expectation()));
    await expect(bob.signAndSend(verified)).rejects.toThrow(/another account/);
    await expect(mainnet.signAndSend(verified)).rejects.toThrow(/another network/);
    expect(calls).toHaveLength(0);
  });

  it("a NEAR Auth session has no signer at all", () => {
    expect(
      createTransactionSigner(
        { method: "near-auth", accountId: ME, network: "testnet" },
        async () => {
          throw new Error("never");
        },
      ),
    ).toBeNull();
  });
});

describe("wire encode and decode of opening cards (task 3.4)", () => {
  const wire = (card: Card) =>
    JSON.parse(
      JSON.stringify(card, (_k, v: unknown) => (typeof v === "bigint" ? v.toString() : v)),
    );

  it("a streamed opening card decodes back to the exact bigint card and still verifies", () => {
    for (const card of [borrowCard({ fee: FEE }), depositCard()]) {
      const decoded = decodeWireCard(wire(card));
      expect(decoded).toEqual(card);
      const r = verifyOpeningPayload(decoded as Card, expectation());
      expect(r.ok).toBe(true);
    }
  });

  it("a fractional, negative or numeric amount refuses the whole card at decode time", () => {
    const c = wire(borrowCard({ fee: FEE }));
    for (const patch of [
      (x: Card) => {
        (x.payload[0]?.actions[0] as { deposit: unknown }).deposit = "1.5";
      },
      (x: Card) => {
        (x.payload[0]?.actions[0] as { gas: unknown }).gas = "-1";
      },
      (x: Card) => {
        (x.fees[0] as { amount: unknown }).amount = 10_000;
      },
    ]) {
      const bad = structuredClone(c);
      patch(bad);
      expect(decodeWireCard(bad)).toBeNull();
    }
  });

  it("the card amount, headline and payload amount are one number", () => {
    const card = borrowCard();
    const actions = action(card).args.actions as { Borrow: { amount: string } }[];
    expect(card.headline).toBe("Borrow 37.5 USDC");
    expect(card.numbers[0]).toMatchObject({ label: "Borrow", after: "37.5", unit: "USDC" });
    expect(actions[0]?.Borrow.amount).toBe((37_500_000n * 10n ** 12n).toString());
  });
});
