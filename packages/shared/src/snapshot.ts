import type { AccountId, Atomic, Bps } from "./errors";

export interface TokenMeta {
  id: AccountId;
  symbol: string;
  decimals: number;
  extraDecimals: number;
}

export interface Price {
  multiplier: bigint;
  decimals: number;
  /** `null` for a fixed `default_price`, which bypasses freshness in Rhea. */
  publishTimeMs: number | null;
  source: "oracle" | "default_price";
}

export interface AssetState {
  token: TokenMeta;
  /** Rhea asset config `volatility_ratio`, 10000 scale. */
  volatilityRatioBps: Bps;
  supplyAprBps: Bps;
  borrowAprBps: Bps;
  canBorrow: boolean;
  canUseAsCollateral: boolean;
}

/** Balances are in Rhea internal units: token atomic * 10^extraDecimals. */
export interface Balance {
  tokenId: AccountId;
  internal: Atomic;
}

export interface PositionSnapshot {
  network: "testnet" | "mainnet";
  lendingId: AccountId;
  accountId: AccountId;
  blockHeight: number;
  readAtMs: number;
  collateral: Balance[];
  supplied: Balance[];
  borrowed: Balance[];
  assets: Record<AccountId, AssetState>;
  prices: Record<AccountId, Price>;
}
