import {
  type AccountId,
  type AssetState,
  type Bps,
  type Computed,
  type EngineError,
  err,
  ok,
  type PositionSnapshot,
  type Price,
  type Result,
} from "@mrfund/shared";

/** Default freshness limit for advice and cards (INTEGRATIONS `MAX_DATA_AGE_MS`). */
export const MAX_DATA_AGE_MS = 120_000;

/** [I] Tolerance for clock skew between the reader and this process. */
export const MAX_FUTURE_SKEW_MS = 60_000;

export interface HealthOptions {
  maxDataAgeMs?: number;
}

/** Exact non-negative-denominator fraction. No intermediate rounding: only final results are floored/ceiled. */
interface Frac {
  n: bigint;
  d: bigint;
}

const ZERO: Frac = { n: 0n, d: 1n };
const add = (a: Frac, b: Frac): Frac => ({ n: a.n * b.d + b.n * a.d, d: a.d * b.d });
const pow10 = (e: number): bigint => 10n ** BigInt(e);

interface Priced {
  asset: AssetState;
  price: Price;
  ageMs: number;
  fixed: boolean;
}

function resolve(
  s: PositionSnapshot,
  tokenId: AccountId,
  nowMs: number,
  maxAgeMs: number,
): Result<Priced, EngineError> {
  const asset = s.assets[tokenId];
  if (!asset) return err({ kind: "unsupported_asset", tokenId });
  const price = s.prices[tokenId];
  if (!price || price.multiplier <= 0n) return err({ kind: "missing_price", tokenId });
  if (
    !Number.isInteger(asset.volatilityRatioBps) ||
    asset.volatilityRatioBps < 0 ||
    asset.volatilityRatioBps > 10_000
  ) {
    return err({
      kind: "invalid_input",
      reason: `volatility ratio for ${tokenId} must be a whole number of bps from 0 to 10000`,
    });
  }
  if (!Number.isInteger(price.decimals) || price.decimals < 0) {
    return err({
      kind: "invalid_input",
      reason: `price decimals for ${tokenId} must be a non-negative whole number`,
    });
  }
  if (price.source === "default_price") return ok({ asset, price, ageMs: 0, fixed: true });
  if (price.publishTimeMs === null) return err({ kind: "missing_price", tokenId });
  if (price.publishTimeMs - nowMs > MAX_FUTURE_SKEW_MS) {
    return err({ kind: "invalid_input", reason: `price for ${tokenId} is dated in the future` });
  }
  const ageMs = Math.max(0, nowMs - price.publishTimeMs);
  if (ageMs > maxAgeMs) return err({ kind: "stale_price", tokenId, ageMs, limitMs: maxAgeMs });
  return ok({ asset, price, ageMs, fixed: false });
}

function sumByToken(lines: { tokenId: AccountId; internal: bigint }[]): Map<AccountId, bigint> {
  const out = new Map<AccountId, bigint>();
  for (const l of lines) out.set(l.tokenId, (out.get(l.tokenId) ?? 0n) + l.internal);
  return out;
}

interface Position {
  collateralValue: Frac; // adjusted collateral C, in USD terms
  debtValue: Frac; // adjusted debt B
  collateralByToken: Map<AccountId, { internal: bigint; priced: Priced }>;
  inputs: Record<string, string>;
  assumptions: string[];
  dataAgeMs: number;
}

function evaluate(
  s: PositionSnapshot,
  nowMs: number,
  maxAgeMs: number,
): Result<Position, EngineError> {
  if (!Number.isFinite(nowMs) || nowMs < 0) {
    return err({ kind: "invalid_input", reason: "clock must be a non-negative number of ms" });
  }
  if (s.readAtMs - nowMs > MAX_FUTURE_SKEW_MS) {
    return err({ kind: "invalid_input", reason: "snapshot is dated in the future" });
  }
  const readAgeMs = Math.max(0, nowMs - s.readAtMs);
  if (readAgeMs > maxAgeMs)
    return err({ kind: "stale_snapshot", ageMs: readAgeMs, limitMs: maxAgeMs });
  if ([...s.collateral, ...s.borrowed].some((l) => l.internal < 0n)) {
    return err({ kind: "invalid_input", reason: "balances must not be negative" });
  }

  let c = ZERO;
  let b = ZERO;
  let dataAgeMs = readAgeMs;
  const inputs: Record<string, string> = {
    network: s.network,
    accountId: s.accountId,
    blockHeight: String(s.blockHeight),
  };
  const assumptions = [
    "Health rounds down.",
    "Supplied balances not used as collateral are excluded.",
  ];
  const fixedSymbols = new Set<string>();
  const collateralByToken = new Map<AccountId, { internal: bigint; priced: Priced }>();

  const note = (tokenId: AccountId, p: Priced) => {
    inputs[`price:${tokenId}`] = `${p.price.multiplier}/10^${p.price.decimals}`;
    dataAgeMs = Math.max(dataAgeMs, p.ageMs);
    if (p.fixed) fixedSymbols.add(p.asset.token.symbol);
  };

  for (const [tokenId, internal] of sumByToken(s.collateral)) {
    if (internal === 0n) continue;
    const r = resolve(s, tokenId, nowMs, maxAgeMs);
    if (!r.ok) return r;
    note(tokenId, r.value);
    const { asset, price } = r.value;
    c = add(c, {
      n: internal * price.multiplier * BigInt(asset.volatilityRatioBps),
      d: pow10(price.decimals + asset.token.extraDecimals) * 10_000n,
    });
    collateralByToken.set(tokenId, { internal, priced: r.value });
  }

  for (const [tokenId, internal] of sumByToken(s.borrowed)) {
    if (internal === 0n) continue;
    const r = resolve(s, tokenId, nowMs, maxAgeMs);
    if (!r.ok) return r;
    // A debt asset with ratio 0 would divide by zero.
    if (r.value.asset.volatilityRatioBps <= 0) return err({ kind: "unsupported_asset", tokenId });
    note(tokenId, r.value);
    const { asset, price } = r.value;
    b = add(b, {
      n: internal * price.multiplier * 10_000n,
      d: pow10(price.decimals + asset.token.extraDecimals) * BigInt(asset.volatilityRatioBps),
    });
  }

  for (const symbol of [...fixedSymbols].sort()) assumptions.push(`${symbol} uses a fixed price`);
  return ok({
    collateralValue: c,
    debtValue: b,
    collateralByToken,
    inputs,
    assumptions,
    dataAgeMs,
  });
}

/**
 * Rhea health factor in basis points: adjusted collateral / adjusted debt.
 * Exact rational arithmetic; only the final division floors, so health never rounds up.
 */
export function healthBps(
  s: PositionSnapshot,
  nowMs: number,
  opts: HealthOptions = {},
): Result<Computed<Bps | "no_debt">, EngineError> {
  const p = evaluate(s, nowMs, opts.maxDataAgeMs ?? MAX_DATA_AGE_MS);
  if (!p.ok) return p;
  const { collateralValue: c, debtValue: b, inputs, assumptions, dataAgeMs } = p.value;
  if (b.n === 0n) return ok({ value: "no_debt", inputs, assumptions, dataAgeMs });
  const exact = (c.n * 10_000n * b.d) / (c.d * b.n);
  const cap = BigInt(Number.MAX_SAFE_INTEGER);
  if (exact > cap) {
    const note = `Health above ${Number.MAX_SAFE_INTEGER} bps is capped.`;
    return ok({
      value: Number.MAX_SAFE_INTEGER,
      inputs,
      assumptions: [...assumptions, note],
      dataAgeMs,
    });
  }
  return ok({ value: Number(exact), inputs, assumptions, dataAgeMs });
}

/**
 * Smallest price multiplier (same decimals as the current price) at which `collateralTokenId`
 * keeps health at or above 100%, all other inputs held fixed. Rounds up. Returns multiplier 0
 * when the other collateral already covers the debt.
 */
export function liquidationPrice(
  s: PositionSnapshot,
  collateralTokenId: AccountId,
  nowMs: number,
  opts: HealthOptions = {},
): Result<Computed<Price>, EngineError> {
  const p = evaluate(s, nowMs, opts.maxDataAgeMs ?? MAX_DATA_AGE_MS);
  if (!p.ok) return p;
  const {
    collateralValue: c,
    debtValue: b,
    collateralByToken,
    inputs,
    assumptions,
    dataAgeMs,
  } = p.value;
  const held = collateralByToken.get(collateralTokenId);
  if (!held || held.priced.asset.volatilityRatioBps <= 0) {
    return err({ kind: "unsupported_asset", tokenId: collateralTokenId });
  }
  const { asset, price } = held.priced;
  const decimals = price.decimals;

  // This token's current contribution to C, as a fraction, to be replaced by a(m) = a * m / bd.
  const a = held.internal * BigInt(asset.volatilityRatioBps);
  const bd = pow10(decimals + asset.token.extraDecimals) * 10_000n;
  const current = { n: a * price.multiplier, d: bd };
  const other = { n: c.n * current.d - current.n * c.d, d: c.d * current.d }; // C - current
  // Need other + a*m/bd >= B   =>   a*m/bd >= B - other = r
  const r = { n: b.n * other.d - other.n * b.d, d: b.d * other.d };
  let multiplier = 0n;
  if (r.n > 0n) {
    const num = r.n * bd;
    const den = r.d * a;
    multiplier = (num + den - 1n) / den; // ceil
  }
  return ok({
    value: { multiplier, decimals, publishTimeMs: null, source: price.source },
    inputs: { ...inputs, token: collateralTokenId },
    assumptions: [
      ...assumptions,
      "Liquidation price rounds up.",
      "All other prices and balances are held fixed.",
    ],
    dataAgeMs,
  });
}

/** Rhea liquidation discount: (1 - health) / 2, in bps, rounded up; 0 at or above 100%. */
export function liquidationDiscountBps(healthBpsValue: Bps): Bps {
  if (!Number.isInteger(healthBpsValue) || healthBpsValue < 0) {
    throw new RangeError("health must be a non-negative integer number of basis points");
  }
  if (healthBpsValue >= 10_000) return 0;
  return Math.ceil((10_000 - healthBpsValue) / 2);
}
