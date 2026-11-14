import type { Result } from "@mrfund/shared";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  type BorrowPools,
  borrowCardDraft,
  borrowCardNumbers,
  depositCardDraft,
  maxBorrow,
  type OpeningFee,
  type OpenPositionInput,
  projectBorrow,
  quoteBorrow,
  quoteCollateralDeposit,
} from "../src/open-position";
import vectorsFixture from "./fixtures/rhea-borrow-vectors.json";
import { baseSnapshot, NOW, USDC, usdcPrice, WNEAR } from "./helpers";

const fixture = vectorsFixture as {
  vectors: {
    name: string;
    txHash: string;
    inputs: Record<string, string>;
    expected: Record<string, string>;
  }[];
};

function unwrap<T, E>(r: Result<T, E>): T {
  if (!r.ok) throw new Error(`expected ok, got ${JSON.stringify(r.error)}`);
  return r.value;
}

describe("projectBorrow reproduces real Rhea 0.11.0 borrows exactly", () => {
  it.each(fixture.vectors)("$name ($txHash)", (v) => {
    const i = v.inputs;
    const p = projectBorrow(
      {
        borrowedShares: BigInt(i.borrowedShares as string),
        borrowedBalance: BigInt(i.borrowedBalance as string),
        suppliedShares: BigInt(i.suppliedShares as string),
        suppliedBalance: BigInt(i.suppliedBalance as string),
      },
      BigInt(i.accountBorrowedShares as string),
      BigInt(i.amountInternal as string),
    );
    expect(p.issuedShares.toString()).toBe(v.expected.issuedShares);
    expect(p.debtAfterInternal.toString()).toBe(v.expected.debtAfterInternal);
    expect(p.creditedShares.toString()).toBe(v.expected.creditedShares);
    expect(p.deliveredInternal.toString()).toBe(v.expected.deliveredInternal);
  });

  it("an exact withdraw would need one share more than the borrow credited (the Gate 1 failure)", () => {
    // 0.5 REF credited as floor(A * S / B) shares; withdrawing exactly A needs ceil(A * S' / B').
    const v = fixture.vectors[0];
    if (!v) throw new Error("fixture");
    const i = v.inputs;
    const amount = BigInt(i.amountInternal as string);
    const Ss = BigInt(i.suppliedShares as string);
    const Bs = BigInt(i.suppliedBalance as string);
    const credit = (amount * Ss) / Bs;
    const needed =
      ((Ss + credit) * 0n + amount * (Ss + credit) + (Bs + amount) - 1n) / (Bs + amount);
    expect(needed).toBeGreaterThan(credit);
  });
});

// Hand-computed position (health.test.ts): 100 wNEAR at $5 x 60% = $300 adjusted collateral,
// 200 USDC at $1 / 95% = $210.526 adjusted debt, health 14250 bps.
const ONE_TO_ONE: BorrowPools = {
  borrowedShares: 10n ** 24n,
  borrowedBalance: 10n ** 24n,
  suppliedShares: 5n * 10n ** 24n,
  suppliedBalance: 5n * 10n ** 24n,
};
const DEBT_INTERNAL = 200n * 10n ** 6n * 10n ** 12n;
const input = (over: Partial<OpenPositionInput> = {}): OpenPositionInput => ({
  snapshot: baseSnapshot(),
  collateralTokenId: WNEAR,
  debtTokenId: USDC,
  lendingVersion: "0.11.0",
  pools: ONE_TO_ONE,
  accountBorrowedShares: DEBT_INTERNAL,
  availableInternal: 10n ** 24n,
  targetBps: 12_000,
  ...over,
});

describe("maxBorrow at a disclosed target", () => {
  it("1:1 pools: the worked maximum is 37.5 USDC, and max + 1 breaks the target", () => {
    // Target 12000 needs total adjusted debt <= $250, so debt <= $237.50: 37.5 USDC more.
    const m = unwrap(maxBorrow(input(), NOW));
    expect(m.value).toEqual({
      maxAtomic: 37_500_000n,
      bindingLimit: "target_health",
      targetBps: 12_000,
    });
    const atMax = unwrap(quoteBorrow(input(), 37_500_000n, NOW));
    expect(atMax.value.healthAfter).toBe(12_000);
    expect(atMax.value.healthBefore).toBe(14_250);
    const over = quoteBorrow(input(), 37_500_001n, NOW);
    expect(over).toMatchObject({ ok: false, error: { kind: "invalid_amount" } });
  });

  it("is limited by liquidity when the pool cannot supply the target amount", () => {
    const m = unwrap(maxBorrow(input({ availableInternal: 5n * 10n ** 18n }), NOW));
    // 5 * 10^18 internal / 10^12 = 5 USDC atomic = 5_000_000.
    expect(m.value).toMatchObject({ maxAtomic: 5_000_000n, bindingLimit: "liquidity" });
  });

  it("no collateral means a zero, non-executable maximum", () => {
    const m = unwrap(
      maxBorrow(
        input({
          snapshot: baseSnapshot({ collateral: [], borrowed: [] }),
          accountBorrowedShares: 0n,
        }),
        NOW,
      ),
    );
    expect(m.value).toMatchObject({ maxAtomic: 0n, bindingLimit: "no_collateral" });
    expect(
      quoteBorrow(
        input({
          snapshot: baseSnapshot({ collateral: [], borrowed: [] }),
          accountBorrowedShares: 0n,
        }),
        1n,
        NOW,
      ).ok,
    ).toBe(false);
  });

  it("an empty account (no debt) quotes from no_debt and still needs the debt price", () => {
    const snap = baseSnapshot({ borrowed: [] });
    const q = unwrap(
      quoteBorrow(input({ snapshot: snap, accountBorrowedShares: 0n }), 100_000_000n, NOW),
    );
    expect(q.value.healthBefore).toBe("no_debt");
    expect(q.value.debtBeforeInternal).toBe(0n);
    // 100 USDC borrowed against $300: B = 100 / 0.95, health = floor(300 / 105.2631.. x 10000) = 28500.
    expect(q.value.healthAfter).toBe(28_500);
    const { [USDC]: _drop, ...prices } = snap.prices;
    expect(
      quoteBorrow(
        input({ snapshot: { ...snap, prices }, accountBorrowedShares: 0n }),
        1_000_000n,
        NOW,
      ),
    ).toMatchObject({ ok: false, error: { kind: "missing_price", tokenId: USDC } });
  });

  it("a stale intended-debt price refuses, and the oracle window is the stricter limit", () => {
    const old = { ...usdcPrice, publishTimeMs: NOW - 90_000 };
    const snap = baseSnapshot({ prices: { ...baseSnapshot().prices, [USDC]: old } });
    // 90 s is inside the app's 120 s limit.
    expect(maxBorrow(input({ snapshot: snap }), NOW).ok).toBe(true);
    // The oracle's own 60 s window is stricter.
    expect(maxBorrow(input({ snapshot: snap, oracleValidityMs: 60_000 }), NOW)).toMatchObject({
      ok: false,
      error: { kind: "stale_price", tokenId: USDC, limitMs: 60_000 },
    });
  });

  it("a fixed default price keeps its fixed-price warning", () => {
    const fixed = { ...usdcPrice, publishTimeMs: null, source: "default_price" as const };
    const snap = baseSnapshot({ prices: { ...baseSnapshot().prices, [USDC]: fixed } });
    const m = unwrap(maxBorrow(input({ snapshot: snap }), NOW));
    expect(m.assumptions).toContain("USDC uses a fixed price");
  });
});

describe("refusals replace unsupported assumptions", () => {
  it.each([
    ["an unverified Rhea version", { lendingVersion: "0.16.2" }],
    ["a target at the liquidation line", { targetBps: 10_000 }],
    ["a fractional target", { targetBps: 12_000.5 }],
    ["the same token as collateral and debt", { debtTokenId: WNEAR }],
    ["debt shares above the pool total", { accountBorrowedShares: 2n * 10n ** 24n }],
    ["shares without a balance", { pools: { ...ONE_TO_ONE, borrowedBalance: 0n } }],
    ["a pool value above u128", { availableInternal: 1n << 128n }],
  ] as const)("%s", (_name, over) => {
    const r = maxBorrow(input(over as Partial<OpenPositionInput>), NOW);
    expect(r.ok).toBe(false);
  });

  it("a second collateral or debt token is refused, not ignored", () => {
    const snap = baseSnapshot({
      collateral: [
        { tokenId: WNEAR, internal: 100n * 10n ** 24n },
        { tokenId: "other.testnet", internal: 1n },
      ],
    });
    expect(maxBorrow(input({ snapshot: snap }), NOW)).toMatchObject({
      ok: false,
      error: { kind: "invalid_input" },
    });
    const snap2 = baseSnapshot({
      borrowed: [...baseSnapshot().borrowed, { tokenId: "other.testnet", internal: 1n }],
    });
    expect(maxBorrow(input({ snapshot: snap2 }), NOW).ok).toBe(false);
  });

  it("a supplied balance the amount-omitted withdraw would sweep is refused", () => {
    for (const id of [USDC, WNEAR]) {
      const snap = baseSnapshot({ supplied: [{ tokenId: id, internal: 5n }] });
      const r = maxBorrow(input({ snapshot: snap }), NOW);
      expect(r).toMatchObject({ ok: false, error: { kind: "invalid_input" } });
    }
  });

  it("an asset that cannot be borrowed or used as collateral is unsupported", () => {
    const snap = baseSnapshot();
    const usdc = snap.assets[USDC];
    const wnear = snap.assets[WNEAR];
    if (!usdc || !wnear) throw new Error("fixture");
    expect(
      maxBorrow(
        input({
          snapshot: { ...snap, assets: { ...snap.assets, [USDC]: { ...usdc, canBorrow: false } } },
        }),
        NOW,
      ),
    ).toMatchObject({ ok: false, error: { kind: "unsupported_asset", tokenId: USDC } });
    expect(
      maxBorrow(
        input({
          snapshot: {
            ...snap,
            assets: { ...snap.assets, [WNEAR]: { ...wnear, canUseAsCollateral: false } },
          },
        }),
        NOW,
      ),
    ).toMatchObject({ ok: false, error: { kind: "unsupported_asset", tokenId: WNEAR } });
  });

  it("zero, negative and non-bigint amounts", () => {
    for (const a of [0n, -1n, 5 as unknown as bigint])
      expect(quoteBorrow(input(), a, NOW)).toMatchObject({
        ok: false,
        error: { kind: "invalid_amount" },
      });
  });
});

describe("share-aware quotes on a non-1:1 pool", () => {
  // Debt shares are worth 1.0978 each, as in the recorded REF pool.
  const SKEWED: BorrowPools = {
    borrowedShares: 44_459_455_679_953_101_693_465n * 10_000n,
    borrowedBalance: 48_809_610_013_439_014_940_495n * 10_000n,
    suppliedShares: 370_481_008_160_211_288_092_408n * 10_000n,
    suppliedBalance: 377_384_649_352_991_856_987_876n * 10_000n,
  };
  // Shares that are worth about 200 USDC on this pool, and the debt they round up to.
  const SHARES = (DEBT_INTERNAL * SKEWED.borrowedShares) / SKEWED.borrowedBalance;
  const DEBT =
    (SHARES * SKEWED.borrowedBalance + SKEWED.borrowedShares - 1n) / SKEWED.borrowedShares;
  const skewed = (over: Partial<OpenPositionInput> = {}) =>
    input({
      snapshot: baseSnapshot({ borrowed: [{ tokenId: USDC, internal: DEBT }] }),
      pools: SKEWED,
      accountBorrowedShares: SHARES,
      ...over,
    });

  it("debt ceils and delivery floors: delivery never exceeds the principal", () => {
    const q = unwrap(quoteBorrow(skewed(), 20_000_000n, NOW));
    expect(q.value.deliveredAtomicEstimate).toBeLessThanOrEqual(20_000_000n);
    expect(q.value.deliveredAtomicEstimate).toBeGreaterThan(19_999_990n);
    expect(q.value.debtAfterInternal).toBeGreaterThanOrEqual(q.value.principalInternal);
    expect(q.value.healthAfter).toBeLessThan(unwrapHealth(q.value.healthBefore));
  });

  it("max satisfies the target and max + 1 does not", () => {
    const m = unwrap(maxBorrow(skewed(), NOW)).value;
    expect(m.bindingLimit).toBe("target_health");
    const atMax = unwrap(quoteBorrow(skewed(), m.maxAtomic, NOW)).value;
    expect(atMax.healthAfter).toBeGreaterThanOrEqual(12_000);
    expect(quoteBorrow(skewed(), m.maxAtomic + 1n, NOW).ok).toBe(false);
  });
});

function unwrapHealth(h: number | "no_debt"): number {
  if (h === "no_debt") throw new Error("expected a health value");
  return h;
}

describe("properties", () => {
  const pool = fc
    .record({
      borrowedShares: fc.bigInt({ min: 10n ** 20n, max: 10n ** 26n }),
      borrowedExtra: fc.bigInt({ min: 0n, max: 10n ** 24n }),
      suppliedShares: fc.bigInt({ min: 10n ** 24n, max: 10n ** 27n }),
      suppliedExtra: fc.bigInt({ min: 0n, max: 10n ** 26n }),
    })
    .map(
      (p): BorrowPools => ({
        borrowedShares: p.borrowedShares,
        borrowedBalance: p.borrowedShares + p.borrowedExtra,
        suppliedShares: p.suppliedShares,
        suppliedBalance: p.suppliedShares + p.suppliedExtra,
      }),
    );
  const accountShares = (pools: BorrowPools) => (pools.borrowedShares * 2n) / 3n / 10n ** 8n;

  const build = (pools: BorrowPools, target: number, collateralUnits: bigint) => {
    const shares = accountShares(pools);
    const debt =
      (shares * pools.borrowedBalance + pools.borrowedShares - 1n) / pools.borrowedShares;
    return input({
      snapshot: baseSnapshot({
        collateral: [{ tokenId: WNEAR, internal: collateralUnits * 10n ** 24n }],
        borrowed: [{ tokenId: USDC, internal: debt }],
      }),
      pools,
      accountBorrowedShares: shares,
      availableInternal: 10n ** 26n,
      targetBps: target,
    });
  };

  it("projected health never rises as the amount grows, so the binary search is sound", () => {
    fc.assert(
      fc.property(
        pool,
        fc.integer({ min: 10_100, max: 30_000 }),
        fc.bigInt({ min: 1n, max: 10n ** 9n }),
        fc.bigInt({ min: 1n, max: 10n ** 9n }),
        (pools, target, a, b) => {
          const inp = build(pools, target, 1_000n);
          const [lo, hi] = a < b ? [a, b] : [b, a];
          const qLo = healthOf(inp, lo);
          const qHi = healthOf(inp, hi);
          if (qLo === null || qHi === null) return true;
          return qHi <= qLo;
        },
      ),
      { numRuns: 200 },
    );
  });

  it("the maximum meets the target and max + 1 breaks the named limit", () => {
    fc.assert(
      fc.property(pool, fc.integer({ min: 10_100, max: 30_000 }), (pools, target) => {
        const inp = build(pools, target, 1_000n);
        const m = maxBorrow(inp, NOW);
        if (!m.ok) return true;
        const { maxAtomic, bindingLimit } = m.value.value;
        if (maxAtomic > 0n) {
          const h = healthOf(inp, maxAtomic);
          if (h === null || h < target) return false;
        }
        if (bindingLimit === "target_health") {
          const next = healthOf(inp, maxAtomic + 1n);
          return next !== null && next < target;
        }
        return true;
      }),
      { numRuns: 100 },
    );
  });

  it("more collateral cannot reduce the admissible maximum", () => {
    fc.assert(
      fc.property(
        pool,
        fc.integer({ min: 10_100, max: 30_000 }),
        fc.bigInt({ min: 100n, max: 5_000n }),
        fc.bigInt({ min: 1n, max: 5_000n }),
        (pools, target, base, extra) => {
          const m1 = maxBorrow(build(pools, target, base), NOW);
          const m2 = maxBorrow(build(pools, target, base + extra), NOW);
          if (!m1.ok || !m2.ok) return true;
          return m2.value.value.maxAtomic >= m1.value.value.maxAtomic;
        },
      ),
      { numRuns: 100 },
    );
  });
});

function healthOf(inp: OpenPositionInput, amount: bigint): number | null {
  const q = quoteBorrowUnbounded(inp, amount);
  return q;
}

/** Health after borrowing `amount`, ignoring the maximum: used to probe monotonicity. */
function quoteBorrowUnbounded(inp: OpenPositionInput, amount: bigint): number | null {
  const wide = { ...inp, targetBps: 10_001, availableInternal: 10n ** 30n };
  const m = maxBorrow(wide, NOW);
  if (!m.ok) return null;
  // Health at `amount` through the public quote requires amount <= max at target 10001.
  if (amount > m.value.value.maxAtomic) return 0;
  const q = quoteBorrow(wide, amount, NOW);
  return q.ok ? q.value.value.healthAfter : null;
}

describe("deposit quote and card numbers", () => {
  it("adds collateral, shows a conditional maximum and never an executable borrow", () => {
    const empty = input({
      snapshot: baseSnapshot({ collateral: [], borrowed: [] }),
      accountBorrowedShares: 0n,
    });
    const q = unwrap(quoteCollateralDeposit(empty, 10n * 10n ** 24n, 20n * 10n ** 24n, NOW));
    expect(q.value.collateralAfterInternal).toBe(10n * 10n ** 24n);
    // 10 wNEAR at $5 x 60% = $30; target 12000 allows $25 of adjusted debt = $23.75 USDC.
    expect(q.value.conditionalMaxBorrowAtomic).toBe(23_750_000n);
    expect(q.assumptions.join(" ")).toMatch(/conditional on this deposit settling/);
    // The unconditional quote on the same empty account has no collateral and no maximum.
    expect(unwrap(maxBorrow(empty, NOW)).value.maxAtomic).toBe(0n);
  });

  it("refuses a deposit above the wallet balance or of zero", () => {
    expect(quoteCollateralDeposit(input(), 5n, 4n, NOW)).toMatchObject({
      ok: false,
      error: { kind: "invalid_amount" },
    });
    expect(quoteCollateralDeposit(input(), 0n, 4n, NOW)).toMatchObject({
      ok: false,
      error: { kind: "invalid_amount" },
    });
  });

  it("formats exact decimal card numbers from the quote", () => {
    const q = unwrap(quoteBorrow(input(), 37_500_000n, NOW)).value;
    const nums = unwrap(borrowCardNumbers(input(), q));
    expect(nums).toEqual([
      { label: "Borrow", after: "37.5", unit: "USDC" },
      { label: "Estimated to your wallet", after: "37.5", unit: "USDC" },
      { label: "Debt", before: "200", after: "237.5", unit: "USDC" },
      { label: "Health factor", before: "142.5", after: "120", unit: "%" },
      { label: "Target health", after: "120", unit: "%" },
      { label: "Largest borrow at this target", after: "37.5", unit: "USDC" },
    ]);
  });
});

describe("pool conversions mirror Burrow's amount_to_shares and shares_to_amount", () => {
  // Source: ref-finance/burrowland@2110c704 pool.rs. Its shares-to-amount special cases (every
  // share, or shares not below the balance) return the same number as the formula while the pool
  // invariant balance >= shares holds, so no separate branch is modelled.
  it("an account holding every share of a pool is worth the whole balance", () => {
    const pools: BorrowPools = {
      borrowedShares: 1_000n,
      borrowedBalance: 1_001n,
      suppliedShares: 5_000n,
      suppliedBalance: 5_003n,
    };
    // The account is the only debtor: its shares are the pool's total shares.
    const p = projectBorrow(pools, 1_000n, 100n);
    // issued = ceil(100 * 1000 / 1001) = 100; shares 1100 of 1100 total => whole balance 1101.
    expect(p.issuedShares).toBe(100n);
    expect(p.debtAfterInternal).toBe(1_101n);
  });

  it("an empty supplied pool credits one share per unit and returns the whole balance", () => {
    const pools: BorrowPools = {
      borrowedShares: 1_000n,
      borrowedBalance: 1_000n,
      suppliedShares: 0n,
      suppliedBalance: 0n,
    };
    const p = projectBorrow(pools, 0n, 50n);
    expect(p.creditedShares).toBe(50n);
    expect(p.deliveredInternal).toBe(50n);
  });

  it("an amount-omitted withdraw of shares worth less than one token unit delivers nothing", () => {
    // 10^12 extra decimals: Rhea sends amount / 10^12 and drops the rest.
    const pools: BorrowPools = {
      borrowedShares: 10n ** 24n,
      borrowedBalance: 10n ** 24n,
      suppliedShares: 5n * 10n ** 24n,
      suppliedBalance: 5n * 10n ** 24n,
    };
    const p = projectBorrow(pools, 0n, 999_999_999_999n);
    expect(p.deliveredInternal / 10n ** 12n).toBe(0n);
  });
});

describe("opening card drafts", () => {
  const none: OpeningFee = { kind: "none" };
  const FEE_LINE = {
    label: "Opening fee",
    amount: 10_000n,
    tokenId: USDC,
    recipientId: "fees.testnet",
    when: "Once, in the same signed batch.",
  };

  it("borrow draft: exact numbers, interest cost, no fee when approved as none", () => {
    const d = unwrap(borrowCardDraft(input(), 37_500_000n, none, NOW));
    expect(d).toMatchObject({
      action: "wallet_borrow",
      headline: "Borrow 37.5 USDC",
      amount: 37_500_000n,
      tokenId: USDC,
      fees: [],
      cappedBy: null,
      maxDataAgeMs: 120_000,
    });
    // 21% APR on 200 USDC = 42; on 237.5 USDC = 49.875 (rounded up).
    expect(d.numbers.find((n) => n.label === "Annual interest cost")).toEqual({
      label: "Annual interest cost",
      before: "42",
      after: "49.875",
      unit: "USDC",
    });
    expect(d.assumptions).toContain("No fee is charged for this stage (explicitly approved).");
    expect(d.risks.join(" ")).toMatch(/Borrowing adds debt and liquidation risk/);
    expect(d.risks.join(" ")).toMatch(/a few units lower/);
  });

  it("an explicit fee line is carried into the draft unchanged", () => {
    const d = unwrap(borrowCardDraft(input(), 1_000_000n, { kind: "fee", line: FEE_LINE }, NOW));
    expect(d.fees).toEqual([FEE_LINE]);
  });

  it.each([
    ["a missing policy", undefined],
    ["a fee of zero", { kind: "fee", line: { ...FEE_LINE, amount: 0n } }],
    ["an unknown kind", { kind: "free" }],
  ])("refuses %s instead of reading it as zero", (_name, fee) => {
    for (const r of [
      borrowCardDraft(input(), 1_000_000n, fee as unknown as OpeningFee, NOW),
      depositCardDraft(input(), 1n, 5n, fee as unknown as OpeningFee, NOW),
    ])
      expect(r).toMatchObject({ ok: false, error: { kind: "invalid_input" } });
  });

  it("an amount above the maximum is refused by the draft", () => {
    expect(borrowCardDraft(input(), 37_500_001n, none, NOW)).toMatchObject({
      ok: false,
      error: { kind: "invalid_amount" },
    });
  });

  it("the stricter oracle window becomes the card's freshness limit", () => {
    const d = unwrap(borrowCardDraft(input({ oracleValidityMs: 60_000 }), 1_000_000n, none, NOW));
    expect(d.maxDataAgeMs).toBe(60_000);
  });

  it("fixed default prices put a fixed-price warning on the card", () => {
    const fixed = { ...usdcPrice, publishTimeMs: null, source: "default_price" as const };
    const snap = baseSnapshot({ prices: { ...baseSnapshot().prices, [USDC]: fixed } });
    const d = unwrap(borrowCardDraft(input({ snapshot: snap }), 1_000_000n, none, NOW));
    expect(d.risks).toContain("Prices here are fixed protocol values, not market quotes.");
  });

  it("deposit draft: amount, collateral before and after, and a conditional borrowing power", () => {
    const empty = input({
      snapshot: baseSnapshot({ collateral: [], borrowed: [] }),
      accountBorrowedShares: 0n,
    });
    const d = unwrap(depositCardDraft(empty, 10n * 10n ** 24n, 20n * 10n ** 24n, none, NOW));
    expect(d).toMatchObject({
      action: "wallet_collateral_deposit",
      headline: "Deposit 10 wNEAR as collateral",
      amount: 10n * 10n ** 24n,
      tokenId: WNEAR,
      fees: [],
    });
    expect(d.numbers).toEqual([
      { label: "Deposit", after: "10", unit: "wNEAR" },
      { label: "Collateral in Rhea", before: "0", after: "10", unit: "wNEAR" },
      { label: "Borrowing power after it settles (conditional)", after: "23.75", unit: "USDC" },
      { label: "Target health", after: "120", unit: "%" },
    ]);
    expect(d.risks.join(" ")).toMatch(/does not borrow anything/);
    expect(d.risks.join(" ")).toMatch(/Nothing returns it automatically/);
  });

  it("a deposit above the wallet balance is refused", () => {
    expect(depositCardDraft(input(), 5n, 4n, none, NOW)).toMatchObject({
      ok: false,
      error: { kind: "invalid_amount" },
    });
  });
});

describe("card provenance, APR and storage lines (task 2.4)", () => {
  const none: OpeningFee = { kind: "none" };
  const storage = [
    { label: "Rhea registration", depositYocto: 10n ** 23n },
    { label: "USDC registration", depositYocto: 1_250n * 10n ** 18n },
  ];

  it("a borrow card names its source, block, price source and borrow APR", () => {
    const d = unwrap(borrowCardDraft(input(), 37_500_000n, none, NOW));
    expect(d.assumptions).toContain("Source: Rhea 0.11.0 on testnet at block 276211785.");
    expect(d.numbers).toContainEqual({ label: "Borrow APR", after: "21", unit: "%" });
    // Oracle prices carry their own age; fixed ones carry a warning (covered above).
    expect(d.assumptions.join(" ")).not.toMatch(/fixed price/);
  });

  it("storage deposits are listed separately from fees and are not service fees", () => {
    const d = unwrap(borrowCardDraft(input(), 37_500_000n, none, NOW, { storage }));
    expect(d.numbers).toContainEqual({
      label: "Rhea registration deposit",
      after: "0.1",
      unit: "NEAR",
    });
    expect(d.numbers).toContainEqual({
      label: "USDC registration deposit",
      after: "0.00125",
      unit: "NEAR",
    });
    expect(d.assumptions).toContain(
      "Storage deposits are paid once to register your account with a contract. They are not service fees.",
    );
    expect(d.fees).toEqual([]);
    const dep = unwrap(
      depositCardDraft(
        input({
          snapshot: baseSnapshot({ collateral: [], borrowed: [] }),
          accountBorrowedShares: 0n,
        }),
        10n * 10n ** 24n,
        20n * 10n ** 24n,
        none,
        NOW,
        { storage },
      ),
    );
    expect(dep.numbers).toContainEqual({
      label: "Rhea registration deposit",
      after: "0.1",
      unit: "NEAR",
    });
  });

  it("no storage lines when nothing needs registering", () => {
    const d = unwrap(borrowCardDraft(input(), 37_500_000n, none, NOW));
    expect(d.numbers.some((n) => n.unit === "NEAR")).toBe(false);
    expect(d.assumptions.join(" ")).not.toMatch(/Storage deposits/);
  });

  it("a storage line that is zero, negative or unlabeled is refused", () => {
    for (const bad of [
      { label: "x", depositYocto: 0n },
      { label: "x", depositYocto: -1n },
      { label: "", depositYocto: 1n },
    ])
      expect(borrowCardDraft(input(), 1_000_000n, none, NOW, { storage: [bad] })).toMatchObject({
        ok: false,
        error: { kind: "invalid_input" },
      });
  });

  it("the deposit card names its source too", () => {
    const d = unwrap(
      depositCardDraft(
        input({
          snapshot: baseSnapshot({ collateral: [], borrowed: [] }),
          accountBorrowedShares: 0n,
        }),
        10n * 10n ** 24n,
        20n * 10n ** 24n,
        none,
        NOW,
      ),
    );
    expect(d.assumptions).toContain("Source: Rhea 0.11.0 on testnet at block 276211785.");
  });
});
