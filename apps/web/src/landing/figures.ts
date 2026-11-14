import { decimalString } from "@mrfund/shared";
import { amount, comparison, metrics, percent, scenario, snapshot } from "../play/demo";

/** Fixed read time so the landing figures are deterministic. The position is a labelled fixture. */
const FIXTURE_MS = Date.UTC(2026, 10, 8, 12, 0, 0);
const DEBT = 1_800_000_000n; // 1,800 USDC, atomic
const REPAY = 100_000_000n; // 100 USDC, atomic

export interface LandingFigures {
  collateral: string;
  debt: string;
  health: string;
  healthAfterRepay: string;
  liquidationUsd: string;
  repayAmount: string;
  repaySaves: string;
  yieldEarns: string;
  winner: "repay" | "yield" | "equal";
  shockHealth: string;
  shockLiquidatable: boolean;
}

function usd(price: string | null): string {
  if (price === null) return "Unavailable";
  const [whole = "0", fraction = ""] = price.split(".");
  return `$${whole}.${fraction.padEnd(2, "0").slice(0, 2)}`;
}

function wholeTokens(atomic: bigint | null, decimals: number): string {
  if (atomic === null) return "Unavailable";
  const [whole = "0"] = decimalString(atomic, decimals).split(".");
  return BigInt(whole).toLocaleString("en-US");
}

/**
 * Every number shown on the landing page, computed by the deterministic engine
 * over the same simulated fixture the /play demo uses. Unavailable values stay
 * "Unavailable"; nothing is guessed.
 */
export function landingFigures(): LandingFigures {
  const now = FIXTURE_MS;
  const position = snapshot(DEBT, now);
  const current = metrics(position, now);
  const after = metrics(snapshot(DEBT - REPAY, now), now);
  const compared = comparison(position, REPAY, now);
  const shock = scenario(position, now);

  return {
    collateral: wholeTokens(position.collateral[0]?.internal ?? null, 24),
    debt: amount(DEBT, 0),
    health: current.health === null ? "Unavailable" : percent(current.health),
    healthAfterRepay: after.health === null ? "Unavailable" : percent(after.health),
    liquidationUsd: usd(current.liquidation),
    repayAmount: amount(REPAY, 0),
    repaySaves: compared.ok ? amount(compared.value.value.repaySaves) : "Unavailable",
    yieldEarns: compared.ok ? amount(compared.value.value.yieldEarns) : "Unavailable",
    winner: compared.ok ? compared.value.value.winner : "equal",
    shockHealth: shock.ok ? percent(shock.value.value.healthBps) : "Unavailable",
    shockLiquidatable: shock.ok ? shock.value.value.liquidatable : false,
  };
}
