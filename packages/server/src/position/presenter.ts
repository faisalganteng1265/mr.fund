import {
  healthBps,
  liquidationPrice,
  MAX_DATA_AGE_MS,
  MAX_FUTURE_SKEW_MS,
  outstandingDebtAtomic,
} from "@mrfund/engine";
import {
  type Balance,
  type EngineError,
  type PositionSnapshot,
  toAtomic,
  usdPerWholeToken,
} from "@mrfund/shared";
import { PositionReadError, type PositionSource } from "./loader";

export interface BalanceView {
  tokenId: string;
  symbol: string;
  decimals: number;
  extraDecimals: number;
  internal: string;
  atomic: string;
  atomicRounding: "down" | "up";
  supplyAprBps: number;
  borrowAprBps: number;
  price: {
    multiplier: string;
    decimals: number;
    source: "oracle" | "default_price";
    publishTimeMs: number | null;
  } | null;
}
export type LiquidationView =
  | {
      tokenId: string;
      kind: "price";
      multiplier: string;
      decimals: number;
      usdPerWholeToken: string;
    }
  | { tokenId: string; kind: "no_debt" | "covered_by_other_collateral" };
export interface PositionView {
  ok: true;
  provenance: "live";
  accountId: string;
  networkId: "testnet" | "mainnet";
  source: PositionSource;
  readAtMs: number;
  computedAtMs: number;
  dataAgeMs: number;
  maxDataAgeMs: number;
  supplied: BalanceView[];
  collateral: BalanceView[];
  debt: BalanceView[];
  health: { kind: "value"; bps: number } | { kind: "no_debt" };
  liquidationPrices: LiquidationView[];
  inputs: Record<string, string>;
  assumptions: string[];
}
function integer(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new PositionReadError("untrusted_data");
}
function engineError(error: EngineError): never {
  throw new PositionReadError(
    error.kind === "stale_price" || error.kind === "stale_snapshot"
      ? "stale_data"
      : "untrusted_data",
  );
}

/** The wire view never computes risk from rounded atomic balances. */
export function presentPosition(
  s: PositionSnapshot,
  source: PositionSource,
  nowMs: number,
  maxDataAgeMs = MAX_DATA_AGE_MS,
): PositionView {
  for (const n of [s.blockHeight, source.blockHeight, s.readAtMs, nowMs, maxDataAgeMs]) integer(n);
  if (
    !maxDataAgeMs ||
    s.blockHeight !== source.blockHeight ||
    s.lendingId !== source.lendingId ||
    !source.blockHash
  )
    throw new PositionReadError("untrusted_data");
  const lines = [...s.supplied, ...s.collateral, ...s.borrowed];
  if (lines.some((b) => typeof b.internal !== "bigint" || b.internal < 0n))
    throw new PositionReadError("untrusted_data");
  if (!lines.some((b) => b.internal > 0n)) throw new PositionReadError("no_position");
  const balance = (b: Balance, debt: boolean): BalanceView => {
    const asset = s.assets[b.tokenId];
    if (!asset || asset.token.id !== b.tokenId || !asset.token.symbol)
      throw new PositionReadError("untrusted_data");
    const token = asset.token;
    for (const n of [token.decimals, token.extraDecimals, asset.supplyAprBps, asset.borrowAprBps])
      integer(n);
    if (token.decimals > 38 || token.extraDecimals > 38)
      throw new PositionReadError("untrusted_data");
    const price = s.prices[b.tokenId];
    if (price) {
      integer(price.decimals);
      if (price.publishTimeMs !== null) integer(price.publishTimeMs);
      if (price.publishTimeMs !== null && price.publishTimeMs - nowMs > MAX_FUTURE_SKEW_MS)
        throw new PositionReadError("untrusted_data");
      if (price.multiplier <= 0n || !["oracle", "default_price"].includes(price.source))
        throw new PositionReadError("untrusted_data");
    }
    return {
      tokenId: b.tokenId,
      symbol: token.symbol,
      decimals: token.decimals,
      extraDecimals: token.extraDecimals,
      internal: b.internal.toString(),
      atomic: (debt
        ? outstandingDebtAtomic(s, b.tokenId)
        : toAtomic(b.internal, token.extraDecimals)
      ).toString(),
      atomicRounding: debt ? "up" : "down",
      supplyAprBps: asset.supplyAprBps,
      borrowAprBps: asset.borrowAprBps,
      price: price ? { ...price, multiplier: price.multiplier.toString() } : null,
    };
  };
  const supplied = s.supplied.filter((b) => b.internal > 0n).map((b) => balance(b, false));
  const collateral = s.collateral.filter((b) => b.internal > 0n).map((b) => balance(b, false));
  const debt = s.borrowed.filter((b) => b.internal > 0n).map((b) => balance(b, true));
  const opts = { maxDataAgeMs };
  const h = healthBps(s, nowMs, opts);
  if (!h.ok) engineError(h.error);
  integer(h.value.dataAgeMs);
  const assumptions = new Set(h.value.assumptions);
  const inputs = { ...h.value.inputs };
  const liquidationPrices: LiquidationView[] = [];
  for (const b of collateral) {
    if (h.value.value === "no_debt") {
      liquidationPrices.push({ tokenId: b.tokenId, kind: "no_debt" });
      continue;
    }
    const result = liquidationPrice(s, b.tokenId, nowMs, opts);
    if (!result.ok) engineError(result.error);
    for (const note of result.value.assumptions) assumptions.add(note);
    for (const [key, value] of Object.entries(result.value.inputs))
      inputs[`liquidation:${b.tokenId}:${key}`] = value;
    const p = result.value.value;
    liquidationPrices.push(
      p.multiplier === 0n
        ? { tokenId: b.tokenId, kind: "covered_by_other_collateral" }
        : {
            tokenId: b.tokenId,
            kind: "price",
            multiplier: p.multiplier.toString(),
            decimals: p.decimals,
            usdPerWholeToken: usdPerWholeToken(p, b.decimals),
          },
    );
    if (debt.some((d) => d.tokenId === b.tokenId))
      assumptions.add(
        "When a token is both collateral and debt, liquidation price shocks only its collateral leg.",
      );
  }
  if (typeof h.value.value === "number") integer(h.value.value);
  return {
    ok: true,
    provenance: "live",
    accountId: s.accountId,
    networkId: s.network,
    source,
    readAtMs: s.readAtMs,
    computedAtMs: nowMs,
    dataAgeMs: h.value.dataAgeMs,
    maxDataAgeMs,
    supplied,
    collateral,
    debt,
    health:
      h.value.value === "no_debt" ? { kind: "no_debt" } : { kind: "value", bps: h.value.value },
    liquidationPrices,
    inputs,
    assumptions: [...assumptions],
  };
}
