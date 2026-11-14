import { type AssetState, type Balance, isValidAccountId, type Price } from "@mrfund/shared";
import { object } from "./client";

export function record(v: unknown): Record<string, unknown> {
  if (!object(v)) throw new Error("Expected object");
  return v;
}
export function integer(v: unknown, max = Number.MAX_SAFE_INTEGER): number {
  if (!Number.isSafeInteger(v) || (v as number) < 0 || (v as number) > max)
    throw new Error("Invalid integer");
  return v as number;
}
export function atomic(v: unknown): bigint {
  if (typeof v !== "string" || !/^(0|[1-9][0-9]*)$/.test(v) || v.length > 39)
    throw new Error("Invalid u128");
  const n = BigInt(v);
  if (n >= 2n ** 128n) throw new Error("Invalid u128");
  return n;
}
export function account(v: unknown): string {
  if (typeof v !== "string" || !isValidAccountId(v)) throw new Error("Invalid account id");
  return v;
}
function boolean(v: unknown): boolean {
  if (typeof v !== "boolean") throw new Error("Invalid boolean");
  return v;
}
/** Protocol decimal annual rate; no float conversion or implicit APR/APY conversion. */
export function parseAprBps(v: unknown, roundUp: boolean): number {
  if (typeof v !== "string" || v.length > 100 || !/^(0|[1-9][0-9]*)(\.[0-9]+)?$/.test(v))
    throw new Error("Invalid APR");
  const [whole = "", fraction = ""] = v.split(".");
  const scale = 10n ** BigInt(fraction.length);
  const numerator = BigInt(whole + fraction) * 10_000n;
  const bps = (numerator + (roundUp ? scale - 1n : 0n)) / scale;
  if (bps > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("APR out of range");
  return Number(bps);
}
export interface ParsedAccount {
  supplied: Balance[];
  collateral: Balance[];
  borrowed: Balance[];
}
export function parseAccount(v: unknown, accountId: string): ParsedAccount {
  if (v === null) return { supplied: [], collateral: [], borrowed: [] };
  const r = record(v);
  if (r.account_id !== accountId) throw new Error("Account mismatch");
  const lines = (value: unknown): Balance[] => {
    if (!Array.isArray(value)) throw new Error("Invalid balances");
    const seen = new Set<string>();
    return value.map((line: unknown) => {
      const x = record(line);
      const tokenId = account(x.token_id);
      if (seen.has(tokenId)) throw new Error("Duplicate balance");
      seen.add(tokenId);
      return { tokenId, internal: atomic(x.balance) };
    });
  };
  return {
    supplied: lines(r.supplied),
    collateral: lines(r.collateral),
    borrowed: lines(r.borrowed),
  };
}
export interface AssetView {
  tokenId: string;
  config: Record<string, unknown>;
  supplyAprBps: number;
  borrowAprBps: number;
}
export function parseAssets(v: unknown): AssetView[] {
  if (!Array.isArray(v)) throw new Error("Invalid assets page");
  return v.map((value: unknown) => {
    const r = record(value);
    const config = record(r.config);
    integer(config.extra_decimals, 38);
    integer(config.volatility_ratio, 10_000);
    boolean(config.can_borrow);
    boolean(config.can_use_as_collateral);
    return {
      tokenId: account(r.token_id),
      config,
      supplyAprBps: parseAprBps(r.supply_apr, false),
      borrowAprBps: parseAprBps(r.borrow_apr, true),
    };
  });
}
export function parseAsset(view: AssetView, metadata: unknown): AssetState {
  const r = record(metadata);
  if (typeof r.symbol !== "string" || !r.symbol.trim() || r.symbol.length > 100)
    throw new Error("Invalid token symbol");
  const decimals = integer(r.decimals, 38);
  return {
    token: {
      id: view.tokenId,
      symbol: r.symbol,
      decimals,
      extraDecimals: integer(view.config.extra_decimals, 38),
    },
    volatilityRatioBps: integer(view.config.volatility_ratio, 10_000),
    supplyAprBps: view.supplyAprBps,
    borrowAprBps: view.borrowAprBps,
    canBorrow: boolean(view.config.can_borrow),
    canUseAsCollateral: boolean(view.config.can_use_as_collateral),
  };
}
export interface PythInfo {
  decimals: number;
  fractionDigits: number;
  priceId: string;
  extraCall: string | null;
  defaultPrice: Price | null;
}
export function parsePythInfo(v: unknown): PythInfo {
  const r = record(v);
  const decimals = integer(r.decimals, 38);
  const fractionDigits = integer(r.fraction_digits, 38);
  if (typeof r.price_identifier !== "string" || !/^[0-9a-f]{64}$/.test(r.price_identifier))
    throw new Error("Invalid price identifier");
  // These are view calls configured by Rhea, and use its u128 / 10^24 adjustment rule.
  if (
    r.extra_call !== null &&
    (typeof r.extra_call !== "string" || !/^[a-z_][a-z0-9_]{0,63}$/.test(r.extra_call))
  )
    throw new Error("Invalid price adjustment method");
  let defaultPrice: Price | null = null;
  if (r.default_price !== null) {
    const p = record(r.default_price);
    defaultPrice = {
      multiplier: atomic(p.multiplier),
      decimals: integer(p.decimals, 76),
      publishTimeMs: null,
      source: "default_price",
    };
    if (defaultPrice.multiplier === 0n) throw new Error("Zero fixed price");
  }
  return {
    decimals,
    fractionDigits,
    priceId: r.price_identifier,
    extraCall: r.extra_call,
    defaultPrice,
  };
}
/** Match Rhea pyth_price_to_price_oracle_price, including flooring to fraction_digits. */
export function parseOraclePrice(
  v: unknown,
  info: Pick<PythInfo, "decimals" | "fractionDigits">,
): Price | null {
  if (v === null) return null;
  const r = record(v);
  const price = atomic(r.price);
  atomic(r.conf);
  if (price === 0n || !Number.isInteger(r.expo) || Math.abs(r.expo as number) > 38)
    throw new Error("Invalid oracle price");
  const publishTimeMs = integer(r.publish_time, Math.floor(Number.MAX_SAFE_INTEGER / 1000)) * 1000;
  if (publishTimeMs === 0) throw new Error("Invalid publish time");
  const power = (r.expo as number) + info.fractionDigits;
  const multiplier = power >= 0 ? price * 10n ** BigInt(power) : price / 10n ** BigInt(-power);
  if (multiplier === 0n) return null;
  return {
    multiplier,
    decimals: info.decimals + info.fractionDigits,
    publishTimeMs,
    source: "oracle",
  };
}
