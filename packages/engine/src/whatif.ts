import {
  type AccountId,
  type Bps,
  type Computed,
  type EngineError,
  err,
  ok,
  type PositionSnapshot,
  type Price,
  type Result,
} from "@mrfund/shared";
import { type HealthOptions, healthBps } from "./health";

/** Rhea liquidates below health factor 1 (10,000 bps); the engine uses this one line everywhere. */
export const LIQUIDATION_LINE_BPS = 10_000;

export interface PriceShock {
  tokenId: AccountId;
  /** Change in basis points: -2000 is -20%. */
  changeBps: number;
}

export interface WhatIf {
  healthBps: Bps | "no_debt";
  /** True only when health is strictly below 100%. */
  liquidatable: boolean;
}

export const MIN_SHOCK_BPS = -9_500;
export const MAX_SHOCK_BPS = 50_000;

/**
 * Health if prices moved by the given shocks. A scenario, not a forecast.
 * Shocking is exact: multiplier * (10000 + change) with decimals + 4, so nothing is rounded.
 */
export function whatIfPrice(
  s: PositionSnapshot,
  shocks: PriceShock[],
  nowMs: number,
  opts: HealthOptions = {},
): Result<Computed<WhatIf>, EngineError> {
  const prices: Record<AccountId, Price> = { ...s.prices };
  const seen = new Set<AccountId>();
  const inputs: Record<string, string> = {};

  for (const { tokenId, changeBps } of shocks) {
    if (!Number.isInteger(changeBps) || changeBps < MIN_SHOCK_BPS || changeBps > MAX_SHOCK_BPS) {
      return err({
        kind: "invalid_amount",
        reason: `price change must be a whole number of bps from ${MIN_SHOCK_BPS} to ${MAX_SHOCK_BPS}`,
      });
    }
    if (seen.has(tokenId)) {
      return err({ kind: "invalid_amount", reason: `more than one shock for ${tokenId}` });
    }
    seen.add(tokenId);
    if (!s.assets[tokenId]) return err({ kind: "unsupported_asset", tokenId });
    const price = prices[tokenId];
    if (!price) return err({ kind: "missing_price", tokenId });
    prices[tokenId] = {
      ...price,
      multiplier: price.multiplier * BigInt(10_000 + changeBps),
      decimals: price.decimals + 4,
    };
    inputs[`shock:${tokenId}`] = String(changeBps);
  }

  const h = healthBps({ ...s, prices }, nowMs, opts);
  if (!h.ok) return h;
  return ok({
    value: {
      healthBps: h.value.value,
      liquidatable: h.value.value !== "no_debt" && h.value.value < LIQUIDATION_LINE_BPS,
    },
    inputs: { ...h.value.inputs, ...inputs },
    assumptions: [
      "Scenario: current prices moved by the stated amounts, everything else unchanged. Not a forecast.",
      ...h.value.assumptions,
    ],
    dataAgeMs: h.value.dataAgeMs,
  });
}
