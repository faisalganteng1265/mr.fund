import {
  type AccountId,
  type Atomic,
  type Bps,
  type Computed,
  type EngineError,
  err,
  ok,
  type PositionSnapshot,
  type Result,
} from "@mrfund/shared";
import { outstandingDebtAtomic } from "./sizing";

export interface RepayVsYieldParams {
  amount: Atomic;
  tokenId: AccountId;
  /** Supply APR of the yield option, in the same token. */
  yieldAprBps: Bps;
  horizonDays: number;
}

export interface RepayVsYield {
  /** Amount actually compared: the requested amount capped at the outstanding debt. */
  amountUsed: Atomic;
  repaySaves: Atomic;
  yieldEarns: Atomic;
  winner: "repay" | "yield" | "equal";
}

const MAX_HORIZON_DAYS = 3650;

/** Linear proration of an annual rate over `days`, floored. */
function accrue(amount: Atomic, bps: Bps, days: number): Atomic {
  return (amount * BigInt(bps) * BigInt(days)) / (10_000n * 365n);
}

const invalid = (reason: string): Result<never, EngineError> =>
  err({ kind: "invalid_amount", reason });

/**
 * Compare using spare money to repay a loan against parking it at a yield, over the same horizon.
 * Both rates are APR. The winner is decided on the rates, never on rounded amounts.
 */
export function repayVsYield(
  s: PositionSnapshot,
  p: RepayVsYieldParams,
  nowMs: number,
): Result<Computed<RepayVsYield>, EngineError> {
  const asset = s.assets[p.tokenId];
  if (!asset) return err({ kind: "unsupported_asset", tokenId: p.tokenId });
  if (p.amount <= 0n) return invalid("amount must be greater than zero");
  if (!Number.isInteger(p.horizonDays) || p.horizonDays < 1 || p.horizonDays > MAX_HORIZON_DAYS) {
    return invalid(`horizon must be a whole number of days from 1 to ${MAX_HORIZON_DAYS}`);
  }
  if (!Number.isInteger(p.yieldAprBps) || p.yieldAprBps < 0) {
    return invalid("yield rate must be a non-negative whole number of basis points");
  }
  const debt = outstandingDebtAtomic(s, p.tokenId);
  if (debt === 0n) return invalid("no outstanding debt in this token");

  const capped = p.amount > debt;
  const amountUsed = capped ? debt : p.amount;
  const borrowAprBps = asset.borrowAprBps;
  const winner =
    borrowAprBps > p.yieldAprBps ? "repay" : borrowAprBps < p.yieldAprBps ? "yield" : "equal";

  const assumptions = [
    "Both rates are APR, prorated linearly over the horizon without compounding.",
    "Rates change continuously; this is an estimate, not a promised return.",
    "Amounts are rounded down.",
  ];
  if (capped) assumptions.push("The amount was capped at the outstanding debt.");

  return ok({
    value: {
      amountUsed,
      repaySaves: accrue(amountUsed, borrowAprBps, p.horizonDays),
      yieldEarns: accrue(amountUsed, p.yieldAprBps, p.horizonDays),
      winner,
    },
    inputs: {
      network: s.network,
      accountId: s.accountId,
      tokenId: p.tokenId,
      amount: String(p.amount),
      borrowAprBps: String(borrowAprBps),
      yieldAprBps: String(p.yieldAprBps),
      horizonDays: String(p.horizonDays),
    },
    assumptions,
    dataAgeMs: Math.max(0, nowMs - s.readAtMs),
  });
}
