/**
 * Plain-wallet opening quotes (`add-chat-open-position` 2.2 to 2.4): how much more a wallet can
 * borrow at a disclosed target health, what that borrow leaves as debt and health, and what a
 * collateral deposit adds. Pure functions over validated inputs; no I/O, no model numbers.
 *
 * Rhea's share arithmetic is mirrored, not approximated (ref-finance/burrowland@2110c704
 * `pool.rs`, `actions.rs` `internal_borrow` and `internal_withdraw`). A borrow issues
 * `ceil(amount x debtShares / debtBalance)` debt shares; the account's debt is then
 * `ceil(shares x debtBalance' / debtShares')` on the updated pool; the borrowed tokens are credited
 * to `supplied` as `floor(amount x suppliedShares / suppliedBalance)` shares and an amount-omitted
 * `Withdraw` returns `floor(credit x suppliedBalance' / suppliedShares')`. `projectBorrow`
 * reproduces two real testnet borrows exactly (fixture `rhea-borrow-vectors.json`: shares issued,
 * debt balance and delivered tokens, one unit at a time). Only Rhea versions with such recorded
 * vectors are quoted (`VERIFIED_BORROW_VERSIONS`); anything else refuses.
 *
 * Rounding is conservative for the user: debt ceils, delivery floors, health floors, and the
 * maximum is the largest amount whose projected health still meets the target.
 *
 * Does not guarantee: that interest, prices or liquidity are unchanged when the transaction lands
 * (pool balances accrue every block, so the issued shares and delivery move slightly), that Rhea
 * accepts the borrow, or any health level after inclusion. A quote is an estimate, not an
 * observation.
 */
import {
  type AccountId,
  type Atomic,
  type Bps,
  type CardDraft,
  type CardNumber,
  type Computed,
  decimalString,
  type EngineError,
  err,
  type FeeLine,
  ok,
  type PositionSnapshot,
  type Result,
} from "@mrfund/shared";
import { type HealthOptions, healthBps, MAX_DATA_AGE_MS } from "./health";

/** Rhea versions whose borrow share arithmetic is pinned by recorded vectors. */
export const VERIFIED_BORROW_VERSIONS: readonly string[] = ["0.11.0"];

const U128_MAX = (1n << 128n) - 1n;
const LIQUIDATION_BPS = 10_000;
const ceilDiv = (a: bigint, b: bigint): bigint => (a + b - 1n) / b;
const invalid = (reason: string): Result<never, EngineError> =>
  err({ kind: "invalid_input", reason });

/** Pool totals in Rhea internal units, already updated to the block being quoted. */
export interface BorrowPools {
  borrowedShares: bigint;
  borrowedBalance: bigint;
  suppliedShares: bigint;
  suppliedBalance: bigint;
}

export interface BorrowProjection {
  /** Debt shares the borrow adds to the account. */
  issuedShares: bigint;
  /** Total account debt after the borrow, Rhea internal units, rounded up. */
  debtAfterInternal: bigint;
  /** Supplied shares credited for the borrowed tokens before the withdraw. */
  creditedShares: bigint;
  /** Internal units an amount-omitted `Withdraw` returns, rounded down. */
  deliveredInternal: bigint;
}

function amountToShares(amount: bigint, shares: bigint, balance: bigint, roundUp: boolean) {
  // Burrow's pool.rs: an empty balance means one share per unit (shares-to-amount special cases
  // return the same numbers as the formula while the pool invariant balance >= shares holds).
  if (balance === 0n) return amount;
  const n = shares * amount;
  return roundUp ? ceilDiv(n, balance) : n / balance;
}

/**
 * Exact Rhea projection of one borrow plus an amount-omitted withdraw of the same token.
 * Callers validate that pool totals are consistent (zero shares only with zero balance) first.
 */
export function projectBorrow(
  pools: BorrowPools,
  accountBorrowedShares: bigint,
  amountInternal: bigint,
): BorrowProjection {
  const issuedShares = amountToShares(
    amountInternal,
    pools.borrowedShares,
    pools.borrowedBalance,
    true,
  );
  const sharesAfter = pools.borrowedShares + issuedShares;
  const balanceAfter = pools.borrowedBalance + amountInternal;
  const accountShares = accountBorrowedShares + issuedShares;
  const debtAfterInternal = ceilDiv(accountShares * balanceAfter, sharesAfter);

  const creditedShares = amountToShares(
    amountInternal,
    pools.suppliedShares,
    pools.suppliedBalance,
    false,
  );
  const suppliedSharesAfter = pools.suppliedShares + creditedShares;
  const suppliedBalanceAfter = pools.suppliedBalance + amountInternal;
  const deliveredInternal =
    suppliedSharesAfter === 0n ? 0n : (creditedShares * suppliedBalanceAfter) / suppliedSharesAfter;
  return { issuedShares, debtAfterInternal, creditedShares, deliveredInternal };
}

export interface OpenPositionInput {
  snapshot: PositionSnapshot;
  collateralTokenId: AccountId;
  debtTokenId: AccountId;
  /** Observed Rhea version; must be in `VERIFIED_BORROW_VERSIONS`. */
  lendingVersion: string;
  pools: BorrowPools;
  /** Debt shares the account already holds in the debt token; 0 when it has no debt there. */
  accountBorrowedShares: bigint;
  /** Liquidity the borrow may draw, Rhea internal units (supplied + reserved - borrowed). */
  availableInternal: bigint;
  /** Whole basis points strictly above 10000. A preference, never a reason to borrow. */
  targetBps: Bps;
  /** The oracle's own validity window; the stricter of this and the app limit applies. */
  oracleValidityMs?: number;
}

export type BindingLimit = "target_health" | "liquidity" | "no_collateral";

export interface BorrowMax {
  /** Largest additional principal, token atomic units. 0 means no executable borrow. */
  maxAtomic: Atomic;
  bindingLimit: BindingLimit;
  targetBps: Bps;
}

export interface BorrowQuote {
  principalAtomic: Atomic;
  principalInternal: bigint;
  /** Estimated tokens reaching the wallet, token atomic units, rounded down. */
  deliveredAtomicEstimate: Atomic;
  debtBeforeInternal: bigint;
  debtAfterInternal: bigint;
  healthBefore: Bps | "no_debt";
  healthAfter: Bps;
  maxAtomic: Atomic;
  bindingLimit: BindingLimit;
  targetBps: Bps;
  issuedShares: bigint;
}

export interface DepositQuote {
  amountAtomic: Atomic;
  collateralAfterInternal: bigint;
  /** Maximum additional borrow once this deposit has settled; conditional, never executable. */
  conditionalMaxBorrowAtomic: Atomic;
  conditionalBindingLimit: BindingLimit;
}

interface Ctx {
  scale: bigint;
  debtBefore: bigint;
  collateralBefore: bigint;
  opts: HealthOptions;
  nowMs: number;
}

const sumInternal = (lines: { tokenId: AccountId; internal: bigint }[], id: AccountId) =>
  lines.reduce((s, l) => (l.tokenId === id ? s + l.internal : s), 0n);

/** Everything that makes an opening quote meaningless is refused here, never defaulted. */
function validate(
  input: OpenPositionInput,
  nowMs: number,
  options: HealthOptions,
): Result<Ctx, EngineError> {
  const s = input.snapshot;
  if (!VERIFIED_BORROW_VERSIONS.includes(input.lendingVersion))
    return invalid(`borrow sizing is not verified for Rhea version ${input.lendingVersion}`);
  if (input.collateralTokenId === input.debtTokenId)
    return invalid("collateral and debt must be different tokens");
  if (
    !Number.isInteger(input.targetBps) ||
    input.targetBps <= LIQUIDATION_BPS ||
    input.targetBps > 10_000_000
  )
    return invalid("target health must be a whole number of bps above 10000");
  const collateral = s.assets[input.collateralTokenId];
  const debt = s.assets[input.debtTokenId];
  if (!collateral) return err({ kind: "unsupported_asset", tokenId: input.collateralTokenId });
  if (!debt) return err({ kind: "unsupported_asset", tokenId: input.debtTokenId });
  if (!collateral.canUseAsCollateral)
    return err({ kind: "unsupported_asset", tokenId: input.collateralTokenId });
  if (!debt.canBorrow) return err({ kind: "unsupported_asset", tokenId: input.debtTokenId });
  if (!Number.isInteger(debt.token.extraDecimals) || debt.token.extraDecimals < 0)
    return invalid("debt token extra decimals must be a non-negative whole number");

  // Only the one supported pair: an extra collateral or debt line would be silently ignored.
  for (const l of s.collateral)
    if (l.internal !== 0n && l.tokenId !== input.collateralTokenId)
      return invalid(
        `the account also holds collateral in ${l.tokenId}; only one pair is supported`,
      );
  for (const l of s.borrowed)
    if (l.internal !== 0n && l.tokenId !== input.debtTokenId)
      return invalid(`the account also owes ${l.tokenId}; only one pair is supported`);
  // An amount-omitted Withdraw would also sweep any supplied balance of that token.
  for (const id of [input.debtTokenId, input.collateralTokenId])
    if (sumInternal(s.supplied, id) !== 0n)
      return invalid(`the account already has a supplied balance of ${id}; move it first`);

  const p = input.pools;
  for (const v of [
    p.borrowedShares,
    p.borrowedBalance,
    p.suppliedShares,
    p.suppliedBalance,
    input.accountBorrowedShares,
    input.availableInternal,
  ])
    if (v < 0n || v > U128_MAX) return invalid("pool values must be u128 integers");
  if (
    (p.borrowedShares === 0n) !== (p.borrowedBalance === 0n) ||
    (p.suppliedShares === 0n) !== (p.suppliedBalance === 0n)
  )
    return invalid("a pool with shares must hold a balance, and the reverse");
  if (input.accountBorrowedShares > p.borrowedShares)
    return invalid("account debt shares exceed the pool's total");

  const maxAgeMs = Math.min(
    options.maxDataAgeMs ?? MAX_DATA_AGE_MS,
    input.oracleValidityMs ?? Number.POSITIVE_INFINITY,
  );
  return ok({
    scale: 10n ** BigInt(debt.token.extraDecimals),
    debtBefore: sumInternal(s.borrowed, input.debtTokenId),
    collateralBefore: sumInternal(s.collateral, input.collateralTokenId),
    opts: { maxDataAgeMs: maxAgeMs },
    nowMs,
  });
}

function withDebt(s: PositionSnapshot, debtTokenId: AccountId, internal: bigint): PositionSnapshot {
  return {
    ...s,
    borrowed: [
      ...s.borrowed.filter((l) => l.tokenId !== debtTokenId),
      { tokenId: debtTokenId, internal },
    ],
  };
}

function withCollateral(
  s: PositionSnapshot,
  tokenId: AccountId,
  internal: bigint,
): PositionSnapshot {
  return {
    ...s,
    collateral: [...s.collateral.filter((l) => l.tokenId !== tokenId), { tokenId, internal }],
  };
}

type Evaluated = { projection: BorrowProjection; health: Bps; computed: Computed<Bps | "no_debt"> };

/** Projection plus health after borrowing `amountAtomic`, or the error that blocks it. */
function evaluate(
  input: OpenPositionInput,
  ctx: Ctx,
  amountAtomic: Atomic,
): Result<Evaluated, EngineError> {
  const projection = projectBorrow(
    input.pools,
    input.accountBorrowedShares,
    amountAtomic * ctx.scale,
  );
  if (projection.debtAfterInternal > U128_MAX) return invalid("resulting debt exceeds u128");
  const h = healthBps(
    withDebt(input.snapshot, input.debtTokenId, projection.debtAfterInternal),
    ctx.nowMs,
    ctx.opts,
  );
  if (!h.ok) return h;
  if (h.value.value === "no_debt") return invalid("a positive borrow always leaves debt");
  return ok({ projection, health: h.value.value, computed: h.value });
}

/** Largest atomic amount that satisfies `fits`, which must be monotone (true then false). */
function largest(hi: bigint, fits: (n: bigint) => Result<boolean, EngineError>) {
  let lo = 0n;
  let top = hi;
  while (lo < top) {
    const mid = (lo + top + 1n) / 2n;
    const r = fits(mid);
    if (!r.ok) return r;
    if (r.value) lo = mid;
    else top = mid - 1n;
  }
  return ok(lo);
}

export function maxBorrow(
  input: OpenPositionInput,
  nowMs: number,
  options: HealthOptions = {},
): Result<Computed<BorrowMax>, EngineError> {
  const v = validate(input, nowMs, options);
  if (!v.ok) return v;
  const ctx = v.value;
  const base = {
    inputs: {
      network: input.snapshot.network,
      accountId: input.snapshot.accountId,
      blockHeight: String(input.snapshot.blockHeight),
      lendingVersion: input.lendingVersion,
      targetBps: String(input.targetBps),
    },
    assumptions: [
      "Debt rounds up, health rounds down and delivery rounds down.",
      "Pool balances accrue interest every block, so the amount that lands can differ slightly.",
      `Only Rhea ${VERIFIED_BORROW_VERSIONS.join(", ")} share arithmetic is verified.`,
    ],
  };
  const dataAge = Math.max(0, nowMs - input.snapshot.readAtMs);
  if (ctx.collateralBefore === 0n)
    return ok({
      ...base,
      value: { maxAtomic: 0n, bindingLimit: "no_collateral", targetBps: input.targetBps },
      dataAgeMs: dataAge,
    });

  const liquidityCap = input.availableInternal / ctx.scale;
  // bigint has no Math.min: the search never exceeds liquidity or what fits in u128 internal units.
  let hi = liquidityCap;
  const u128Cap = U128_MAX / ctx.scale;
  if (u128Cap < hi) hi = u128Cap;
  const fits = (n: bigint): Result<boolean, EngineError> => {
    const e = evaluate(input, ctx, n);
    return e.ok ? ok(e.value.health >= input.targetBps) : e;
  };
  const best = largest(hi, fits);
  if (!best.ok) return best;
  const max = best.value;
  const binding: BindingLimit = max === hi ? "liquidity" : "target_health";
  // A fresh price is needed once any debt exists; evaluate once more so a stale price never hides.
  const probe = evaluate(input, ctx, max > 0n ? max : 1n);
  if (!probe.ok) return probe;
  return ok({
    ...base,
    value: { maxAtomic: max, bindingLimit: binding, targetBps: input.targetBps },
    dataAgeMs: Math.max(dataAge, probe.value.computed.dataAgeMs),
    assumptions: [...base.assumptions, ...probe.value.computed.assumptions],
  });
}

export function quoteBorrow(
  input: OpenPositionInput,
  amountAtomic: Atomic,
  nowMs: number,
  options: HealthOptions = {},
): Result<Computed<BorrowQuote>, EngineError> {
  if (typeof amountAtomic !== "bigint" || amountAtomic <= 0n)
    return err({ kind: "invalid_amount", reason: "borrow amount must be greater than zero" });
  const v = validate(input, nowMs, options);
  if (!v.ok) return v;
  const ctx = v.value;
  const max = maxBorrow(input, nowMs, options);
  if (!max.ok) return max;
  if (amountAtomic > max.value.value.maxAtomic)
    return err({
      kind: "invalid_amount",
      reason:
        max.value.value.maxAtomic === 0n
          ? "nothing can be borrowed at this target"
          : `amount exceeds the maximum for the ${max.value.value.bindingLimit} limit`,
    });
  const e = evaluate(input, ctx, amountAtomic);
  if (!e.ok) return e;
  const before = healthBps(input.snapshot, nowMs, ctx.opts);
  if (!before.ok) return before;
  const { projection, health, computed } = e.value;
  return ok({
    value: {
      principalAtomic: amountAtomic,
      principalInternal: amountAtomic * ctx.scale,
      deliveredAtomicEstimate: projection.deliveredInternal / ctx.scale,
      debtBeforeInternal: ctx.debtBefore,
      debtAfterInternal: projection.debtAfterInternal,
      healthBefore: before.value.value,
      healthAfter: health,
      maxAtomic: max.value.value.maxAtomic,
      bindingLimit: max.value.value.bindingLimit,
      targetBps: input.targetBps,
      issuedShares: projection.issuedShares,
    },
    inputs: { ...max.value.inputs, ...computed.inputs, amountAtomic: amountAtomic.toString() },
    assumptions: [...new Set([...max.value.assumptions, ...computed.assumptions])],
    dataAgeMs: Math.max(max.value.dataAgeMs, computed.dataAgeMs),
  });
}

/**
 * What depositing `amountAtomic` of the collateral token adds, and the borrowing it would unlock
 * once it has settled. The preview is conditional: an executable borrow needs a fresh post-deposit
 * context, so `conditionalMaxBorrowAtomic` can never authorize one.
 */
export function quoteCollateralDeposit(
  input: OpenPositionInput,
  amountAtomic: Atomic,
  walletBalance: Atomic,
  nowMs: number,
  options: HealthOptions = {},
): Result<Computed<DepositQuote>, EngineError> {
  if (typeof amountAtomic !== "bigint" || amountAtomic <= 0n)
    return err({ kind: "invalid_amount", reason: "deposit amount must be greater than zero" });
  if (amountAtomic > walletBalance)
    return err({ kind: "invalid_amount", reason: "the wallet holds less than this amount" });
  const v = validate(input, nowMs, options);
  if (!v.ok) return v;
  const collateralAsset = input.snapshot.assets[input.collateralTokenId];
  const scale = 10n ** BigInt(collateralAsset?.token.extraDecimals ?? 0);
  const collateralAfter = v.value.collateralBefore + amountAtomic * scale;
  if (collateralAfter > U128_MAX) return invalid("resulting collateral exceeds u128");
  const preview = maxBorrow(
    {
      ...input,
      snapshot: withCollateral(input.snapshot, input.collateralTokenId, collateralAfter),
    },
    nowMs,
    options,
  );
  if (!preview.ok) return preview;
  return ok({
    value: {
      amountAtomic,
      collateralAfterInternal: collateralAfter,
      conditionalMaxBorrowAtomic: preview.value.value.maxAtomic,
      conditionalBindingLimit: preview.value.value.bindingLimit,
    },
    inputs: { ...preview.value.inputs, depositAtomic: amountAtomic.toString() },
    assumptions: [
      ...preview.value.assumptions,
      "The borrowing power shown is conditional on this deposit settling; borrowing is quoted again afterwards.",
    ],
    dataAgeMs: preview.value.dataAgeMs,
  });
}

const pct = (bps: number): string => decimalString(BigInt(bps), 2);

/** Engine-formatted card numbers for a borrow quote; symbols and decimals come from the snapshot. */
export function borrowCardNumbers(
  input: OpenPositionInput,
  q: BorrowQuote,
): Result<CardNumber[], EngineError> {
  const debt = input.snapshot.assets[input.debtTokenId];
  if (!debt) return err({ kind: "unsupported_asset", tokenId: input.debtTokenId });
  const { symbol, decimals, extraDecimals } = debt.token;
  const internalDecimals = decimals + extraDecimals;
  const tok = (n: Atomic) => decimalString(n, decimals);
  const debtText = (n: bigint) => decimalString(n, internalDecimals);
  return ok([
    { label: "Borrow", after: tok(q.principalAtomic), unit: symbol },
    { label: "Estimated to your wallet", after: tok(q.deliveredAtomicEstimate), unit: symbol },
    {
      label: "Debt",
      before: debtText(q.debtBeforeInternal),
      after: debtText(q.debtAfterInternal),
      unit: symbol,
    },
    {
      label: "Health factor",
      before: q.healthBefore === "no_debt" ? "No debt" : pct(q.healthBefore),
      after: pct(q.healthAfter),
      unit: "%",
    },
    { label: "Target health", after: pct(q.targetBps), unit: "%" },
    { label: "Largest borrow at this target", after: tok(q.maxAtomic), unit: symbol },
  ]);
}

/**
 * The opening fee policy for one stage. Pricing is a founder decision (task 1.3), so there is no
 * default: the caller states either an explicit approved fee or an explicit approved "none".
 */
export type OpeningFee = { kind: "none" } | { kind: "fee"; line: FeeLine };

function openingFees(fee: OpeningFee): Result<{ lines: FeeLine[]; note: string }, EngineError> {
  if (fee?.kind === "none")
    return ok({ lines: [], note: "No fee is charged for this stage (explicitly approved)." });
  if (fee?.kind === "fee" && fee.line.amount > 0n)
    return ok({ lines: [fee.line], note: "The fee is paid in the same signed batch." });
  return invalid(
    "opening fee policy missing or invalid: state an approved fee or an approved none",
  );
}

const FIXED_PRICE_RISK = "Prices here are fixed protocol values, not market quotes.";
const ceilBps = (amount: bigint, bps: number): bigint => (amount * BigInt(bps) + 9_999n) / 10_000n;

function fixedPriceRisks(input: OpenPositionInput): string[] {
  return [input.collateralTokenId, input.debtTokenId].some(
    (id) => input.snapshot.prices[id]?.source === "default_price",
  )
    ? [FIXED_PRICE_RISK]
    : [];
}

/** Optional card inputs on top of the health options. */
export interface OpeningDraftOptions extends HealthOptions {
  /** Registrations still missing for this stage, shown as storage deposits (never as fees). */
  storage?: { label: string; depositYocto: bigint }[];
}

const NEAR_DECIMALS = 24;

function storageLines(
  options: OpeningDraftOptions,
): Result<{ numbers: CardNumber[]; assumptions: string[] }, EngineError> {
  const lines = options.storage ?? [];
  for (const l of lines)
    if (
      typeof l.label !== "string" ||
      l.label.trim() === "" ||
      typeof l.depositYocto !== "bigint" ||
      l.depositYocto <= 0n
    )
      return invalid("a storage deposit needs a label and a positive amount");
  return ok({
    numbers: lines.map((l) => ({
      label: `${l.label} deposit`,
      after: decimalString(l.depositYocto, NEAR_DECIMALS),
      unit: "NEAR",
    })),
    assumptions:
      lines.length > 0
        ? [
            "Storage deposits are paid once to register your account with a contract. They are not service fees.",
          ]
        : [],
  });
}

const sourceNote = (input: OpenPositionInput): string =>
  `Source: Rhea ${input.lendingVersion} on ${input.snapshot.network} at block ${input.snapshot.blockHeight}.`;

/** Engine-owned draft for the collateral deposit stage. */
export function depositCardDraft(
  input: OpenPositionInput,
  amountAtomic: Atomic,
  walletBalance: Atomic,
  fee: OpeningFee,
  nowMs: number,
  options: OpeningDraftOptions = {},
): Result<CardDraft, EngineError> {
  const f = openingFees(fee);
  if (!f.ok) return f;
  const st = storageLines(options);
  if (!st.ok) return st;
  const q = quoteCollateralDeposit(input, amountAtomic, walletBalance, nowMs, options);
  if (!q.ok) return q;
  const collateral = input.snapshot.assets[input.collateralTokenId];
  const debt = input.snapshot.assets[input.debtTokenId];
  if (!collateral || !debt)
    return err({ kind: "unsupported_asset", tokenId: input.collateralTokenId });
  const cd = collateral.token;
  const internalDecimals = cd.decimals + cd.extraDecimals;
  const before = sumInternal(input.snapshot.collateral, input.collateralTokenId);
  const maxAge = Math.min(
    options.maxDataAgeMs ?? MAX_DATA_AGE_MS,
    input.oracleValidityMs ?? Number.POSITIVE_INFINITY,
  );
  const numbers: CardNumber[] = [
    { label: "Deposit", after: decimalString(amountAtomic, cd.decimals), unit: cd.symbol },
    {
      label: "Collateral in Rhea",
      before: decimalString(before, internalDecimals),
      after: decimalString(q.value.value.collateralAfterInternal, internalDecimals),
      unit: cd.symbol,
    },
    {
      label: "Borrowing power after it settles (conditional)",
      after: decimalString(q.value.value.conditionalMaxBorrowAtomic, debt.token.decimals),
      unit: debt.token.symbol,
    },
    { label: "Target health", after: pct(input.targetBps), unit: "%" },
    ...st.value.numbers,
  ];
  return ok({
    action: "wallet_collateral_deposit",
    headline: `Deposit ${decimalString(amountAtomic, cd.decimals)} ${cd.symbol} as collateral`,
    numbers,
    assumptions: [...q.value.assumptions, sourceNote(input), ...st.value.assumptions, f.value.note],
    fees: f.value.lines,
    risks: [
      "Depositing does not borrow anything; borrowing is a separate step you approve afterwards.",
      "Collateral stays in Rhea until you withdraw it. Nothing returns it automatically.",
      "If the collateral's price falls while you owe debt, you can be liquidated.",
      ...fixedPriceRisks(input),
    ],
    dataAgeMs: q.value.dataAgeMs,
    maxDataAgeMs: maxAge,
    amount: amountAtomic,
    tokenId: input.collateralTokenId,
    cappedBy: null,
  });
}

/** Engine-owned draft for the borrow stage; the quote must come from a post-deposit context. */
export function borrowCardDraft(
  input: OpenPositionInput,
  amountAtomic: Atomic,
  fee: OpeningFee,
  nowMs: number,
  options: OpeningDraftOptions = {},
): Result<CardDraft, EngineError> {
  const f = openingFees(fee);
  if (!f.ok) return f;
  const st = storageLines(options);
  if (!st.ok) return st;
  const q = quoteBorrow(input, amountAtomic, nowMs, options);
  if (!q.ok) return q;
  const numbers = borrowCardNumbers(input, q.value.value);
  if (!numbers.ok) return numbers;
  const debt = input.snapshot.assets[input.debtTokenId];
  if (!debt) return err({ kind: "unsupported_asset", tokenId: input.debtTokenId });
  const { symbol, decimals, extraDecimals } = debt.token;
  const scale = 10n ** BigInt(extraDecimals);
  const atomicOf = (internal: bigint) => (internal + scale - 1n) / scale;
  const apr = debt.borrowAprBps;
  const maxAge = Math.min(
    options.maxDataAgeMs ?? MAX_DATA_AGE_MS,
    input.oracleValidityMs ?? Number.POSITIVE_INFINITY,
  );
  return ok({
    action: "wallet_borrow",
    headline: `Borrow ${decimalString(amountAtomic, decimals)} ${symbol}`,
    numbers: [
      ...numbers.value,
      {
        label: "Annual interest cost",
        before: decimalString(ceilBps(atomicOf(q.value.value.debtBeforeInternal), apr), decimals),
        after: decimalString(ceilBps(atomicOf(q.value.value.debtAfterInternal), apr), decimals),
        unit: symbol,
      },
      { label: "Borrow APR", after: pct(apr), unit: "%" },
      ...st.value.numbers,
    ],
    assumptions: [
      ...q.value.assumptions,
      sourceNote(input),
      ...st.value.assumptions,
      `Annual interest cost uses the current ${symbol} protocol-reported borrow APR of ${pct(apr)}% for one year, without compounding.`,
      f.value.note,
    ],
    fees: f.value.lines,
    risks: [
      "Borrowing adds debt and liquidation risk; the health shown is a projection, not a protected level.",
      "The amount that reaches your wallet can be a few units lower than the amount borrowed.",
      "Rates and prices change before the transaction lands.",
      ...fixedPriceRisks(input),
    ],
    dataAgeMs: q.value.dataAgeMs,
    maxDataAgeMs: maxAge,
    amount: amountAtomic,
    tokenId: input.debtTokenId,
    cappedBy: null,
  });
}
