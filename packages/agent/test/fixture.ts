// Same hand-computed position as packages/engine/test/helpers.ts (copied so the agent tests do not reach into another package).
import type { AssetState, PositionSnapshot, Price } from "@mrfund/shared";

export const NOW = 1_800_000_000_000;

export const WNEAR = "wrap.testnet";
export const USDC = "usdc.fakes.testnet";

/** wNEAR: 24 decimals, no extra decimals, volatility ratio 60%. */
export const wnearAsset: AssetState = {
  token: { id: WNEAR, symbol: "wNEAR", decimals: 24, extraDecimals: 0 },
  volatilityRatioBps: 6000,
  supplyAprBps: 0,
  borrowAprBps: 0,
  canBorrow: false,
  canUseAsCollateral: true,
};

/** USDC: 6 decimals, 12 extra decimals (Rhea internal = atomic * 10^12), volatility ratio 95%. */
export const usdcAsset: AssetState = {
  token: { id: USDC, symbol: "USDC", decimals: 6, extraDecimals: 12 },
  volatilityRatioBps: 9500,
  supplyAprBps: 1401,
  borrowAprBps: 2100,
  canBorrow: true,
  canUseAsCollateral: false,
};

/** value = atomic * multiplier / 10^decimals  =>  5 USD per whole wNEAR. */
export const wnearPrice: Price = {
  multiplier: 50_000n,
  decimals: 28,
  publishTimeMs: NOW,
  source: "oracle",
};
/** value = atomic * multiplier / 10^decimals  =>  1 USD per whole USDC. */
export const usdcPrice: Price = {
  multiplier: 10_000n,
  decimals: 10,
  publishTimeMs: NOW,
  source: "oracle",
};

/**
 * Hand-computed base position (see health.test.ts):
 * 100 wNEAR collateral at $5 = $500; 200 USDC debt at $1 = $200.
 */
export function baseSnapshot(overrides: Partial<PositionSnapshot> = {}): PositionSnapshot {
  return {
    network: "testnet",
    lendingId: "contract.1689937928.burrow.testnet",
    accountId: "alice.testnet",
    blockHeight: 276_211_785,
    readAtMs: NOW,
    collateral: [{ tokenId: WNEAR, internal: 100n * 10n ** 24n }],
    supplied: [],
    borrowed: [{ tokenId: USDC, internal: 200n * 10n ** 6n * 10n ** 12n }],
    assets: { [WNEAR]: wnearAsset, [USDC]: usdcAsset },
    prices: { [WNEAR]: wnearPrice, [USDC]: usdcPrice },
    ...overrides,
  };
}
