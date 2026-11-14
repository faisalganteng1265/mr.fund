import { healthBps, liquidationPrice, repayCard, repayVsYield, whatIfPrice } from "@mrfund/engine";
import { type FeeSchedule, type PositionSnapshot, usdPerWholeToken } from "@mrfund/shared";
import type { DataState } from "./source/types";

export { amount, percent } from "./display";

export const USDC = "usdc.fakes.testnet";
export const NEAR = "wrap.testnet";
export const DEMO_FEE: FeeSchedule = {
  tokenId: USDC,
  recipientId: "fees.demo.testnet",
  activationFee: 1_000_000n,
  actionFee: 0n,
  executionFee: 100_000n,
};
export function snapshot(debt: bigint, atMs: number, state: DataState = "fresh"): PositionSnapshot {
  const readAtMs = state === "stale" ? atMs - 300_000 : atMs;
  return {
    network: "testnet",
    lendingId: "contract.1689937928.burrow.testnet",
    accountId: "you.demo.testnet",
    blockHeight: 0,
    readAtMs,
    collateral: state === "empty" ? [] : [{ tokenId: NEAR, internal: 1000n * 10n ** 24n }],
    supplied: [],
    borrowed:
      state === "empty" || debt === 0n ? [] : [{ tokenId: USDC, internal: debt * 10n ** 12n }],
    assets: {
      [NEAR]: {
        token: { id: NEAR, symbol: "NEAR", decimals: 24, extraDecimals: 0 },
        volatilityRatioBps: 6000,
        supplyAprBps: 320,
        borrowAprBps: 700,
        canBorrow: true,
        canUseAsCollateral: true,
      },
      [USDC]: {
        token: { id: USDC, symbol: "USDC", decimals: 6, extraDecimals: 12 },
        volatilityRatioBps: 9500,
        supplyAprBps: 1401,
        borrowAprBps: 2100,
        canBorrow: true,
        canUseAsCollateral: true,
      },
    },
    prices: {
      [NEAR]: { multiplier: 5_000_000n, decimals: 30, publishTimeMs: readAtMs, source: "oracle" },
      [USDC]: { multiplier: 1_000_000n, decimals: 12, publishTimeMs: readAtMs, source: "oracle" },
    },
  };
}
export function atomic(input: string): bigint | null {
  if (!/^\d+(\.\d{1,6})?$/.test(input)) return null;
  const [whole = "0", fraction = ""] = input.split(".");
  const result = BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, "0"));
  return result <= (1n << 128n) - 1n ? result : null;
}
export function metrics(s: PositionSnapshot, now: number) {
  const health = healthBps(s, now);
  const liquidation = liquidationPrice(s, NEAR, now);
  return {
    health: health.ok ? health.value.value : null,
    liquidation: liquidation.ok ? usdPerWholeToken(liquidation.value.value, 24) : null,
  };
}
export function draft(s: PositionSnapshot, value: string, balance: bigint, now: number) {
  const parsed = atomic(value);
  return parsed === null
    ? null
    : repayCard(s, { tokenId: USDC, amount: parsed, walletBalance: balance }, DEMO_FEE, now);
}
export function comparison(s: PositionSnapshot, value: bigint, now: number) {
  return repayVsYield(
    s,
    { amount: value, tokenId: USDC, yieldAprBps: 1401, horizonDays: 365 },
    now,
  );
}
export function scenario(s: PositionSnapshot, now: number) {
  return whatIfPrice(s, [{ tokenId: NEAR, changeBps: -2000 }], now);
}
