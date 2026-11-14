/**
 * Card numbers (BUILD-PLAN P4.1, PRD "Recommendation card contract").
 *
 * Builds the engine-owned part of a card: headline, before and after numbers, assumptions, fees,
 * risks and data age. Adjust is this function called again with a new amount, so every number is
 * recomputed. The transaction payload is added only by the `rhea` or `guardian-client` builders
 * from `amount` and `tokenId`; the reason prose is added by the model and number-checked. Nothing
 * in the model's text reaches this function.
 *
 * Does not guarantee: that the repay lands or that the numbers still hold at signing time. Prices
 * and rates move, so `canExecute` blocks a card once its oldest input passes the age limit.
 */
import {
  type Atomic,
  type Card,
  type CardDraft,
  type CardNumber,
  decimalString,
  type EngineError,
  err,
  type FeeSchedule,
  type NearTransaction,
  ok,
  type PositionSnapshot,
  type Result,
  usdPerWholeToken,
} from "@mrfund/shared";
import { fees } from "./fees";
import { type HealthOptions, healthBps, liquidationPrice, MAX_DATA_AGE_MS } from "./health";
import { outstandingDebtAtomic, withRepay } from "./sizing";

export interface RepayRequest {
  tokenId: string;
  /** Requested amount in token atomic units. Bounded below. */
  amount: Atomic;
  /** What the user's wallet holds of this token, in atomic units. */
  walletBalance: Atomic;
}

const invalid = (reason: string): Result<never, EngineError> =>
  err({ kind: "invalid_amount", reason });

const ceilMul = (amount: bigint, bps: number): bigint => (amount * BigInt(bps) + 9_999n) / 10_000n;
const pct = (bps: number): string => decimalString(BigInt(bps), 2);

export function repayCard(
  s: PositionSnapshot,
  req: RepayRequest,
  schedule: FeeSchedule,
  nowMs: number,
  opts: HealthOptions = {},
): Result<CardDraft, EngineError> {
  const asset = s.assets[req.tokenId];
  if (!asset) return err({ kind: "unsupported_asset", tokenId: req.tokenId });
  if (req.amount <= 0n) return invalid("amount must be greater than zero");
  if (req.walletBalance <= 0n) return invalid("the wallet holds none of this token");
  const debt = outstandingDebtAtomic(s, req.tokenId);
  if (debt === 0n) return invalid("no outstanding debt in this token");

  // A fee paid in the same token comes out of the same wallet balance, so it is not repayable.
  const feeInDebtToken = schedule.tokenId === req.tokenId ? schedule.executionFee : 0n;
  const spendable = req.walletBalance - feeInDebtToken;
  if (spendable <= 0n) return invalid("the wallet cannot cover the fee");

  // bigint has no Math.min; take the smaller bound, then the smaller of it and the request.
  let limit = spendable;
  if (debt < limit) limit = debt;
  let amount = req.amount;
  if (limit < amount) amount = limit;
  const cappedBy: CardDraft["cappedBy"] =
    req.amount <= limit ? null : debt <= spendable ? "debt" : "wallet";

  const before = healthBps(s, nowMs, opts);
  if (!before.ok) return before;
  const afterSnapshot = withRepay(s, req.tokenId, amount);
  const after = healthBps(afterSnapshot, nowMs, opts);
  if (!after.ok) return after;

  const { symbol, decimals } = asset.token;
  const dec = (n: Atomic) => decimalString(n, decimals);
  const debtAfter = outstandingDebtAtomic(afterSnapshot, req.tokenId);
  const bpsCost = asset.borrowAprBps;

  const numbers: CardNumber[] = [
    { label: "Debt", before: dec(debt), after: dec(debtAfter), unit: symbol },
  ];

  const assumptions = [...before.value.assumptions];
  const risks = ["Rates change.", "Repaying lowers liquidation risk; it does not remove it."];

  const beforeHealth = before.value.value;
  const afterHealth = after.value.value;
  if (beforeHealth !== "no_debt") {
    const n: CardNumber = { label: "Health factor", before: pct(beforeHealth), unit: "%" };
    if (afterHealth !== "no_debt") n.after = pct(afterHealth);
    numbers.push(n);
  }
  if (afterHealth === "no_debt") {
    assumptions.push("No debt remains after this repay.");
  } else if (afterHealth < 10_000) {
    risks.push("Health stays below the liquidation line after this repay.");
  }

  for (const line of s.collateral) {
    const c = s.assets[line.tokenId];
    if (!c || line.internal <= 0n) continue;
    const lpBefore = liquidationPrice(s, line.tokenId, nowMs, opts);
    if (!lpBefore.ok || lpBefore.value.value.multiplier === 0n) continue;
    const n: CardNumber = {
      label: `${c.token.symbol} liquidation price`,
      before: usdPerWholeToken(lpBefore.value.value, c.token.decimals),
      unit: "USD",
    };
    const lpAfter = liquidationPrice(afterSnapshot, line.tokenId, nowMs, opts);
    if (lpAfter.ok && lpAfter.value.value.multiplier > 0n) {
      n.after = usdPerWholeToken(lpAfter.value.value, c.token.decimals);
    }
    numbers.push(n);
  }

  numbers.push({
    label: "Annual interest cost",
    before: dec(ceilMul(debt, bpsCost)),
    after: dec(ceilMul(debtAfter, bpsCost)),
    unit: symbol,
  });
  assumptions.push(
    `Annual interest cost uses the current ${symbol} protocol-reported borrow APR of ${pct(bpsCost)}% for one year, without compounding.`,
    "Debt and interest cost are rounded up; health is rounded down.",
  );

  if (cappedBy === "debt") risks.push("The amount was capped at your outstanding debt.");
  if (cappedBy === "wallet") risks.push("The amount was capped at your wallet balance.");

  const feeLines = fees("repay", schedule);
  assumptions.push(...feeLines.assumptions);

  return ok({
    action: "repay",
    headline: `Repay ${dec(amount)} ${symbol}`,
    numbers,
    assumptions,
    fees: feeLines.value,
    risks,
    dataAgeMs: before.value.dataAgeMs,
    maxDataAgeMs: opts.maxDataAgeMs ?? MAX_DATA_AGE_MS,
    amount,
    tokenId: req.tokenId,
    cappedBy,
  });
}

export type ExecuteState =
  | { enabled: true }
  | { enabled: false; reason: "stale_data" | "no_payload" };

/**
 * Whether the Execute button may be enabled. `elapsedMs` is the time since the card was built, so
 * a card that sits on screen goes stale. A card with no payload was not made by a builder.
 */
export function canExecute(
  card: { dataAgeMs: number; maxDataAgeMs: number; payload: readonly unknown[] },
  elapsedMs: number,
): ExecuteState {
  if (card.payload.length === 0) return { enabled: false, reason: "no_payload" };
  if (card.dataAgeMs + Math.max(0, elapsedMs) > card.maxDataAgeMs) {
    return { enabled: false, reason: "stale_data" };
  }
  return { enabled: true };
}

/**
 * The full card: the engine's draft, the payload a builder made from it, and the model's reason.
 * The reason is copied into one field and nothing else reads it, so no text can reach a number or
 * a payload byte. The id comes from the caller.
 */
export function assembleCard(
  draft: CardDraft,
  parts: { id: string; reason: string; payload: NearTransaction[] },
): Card {
  return {
    id: parts.id,
    action: draft.action,
    headline: draft.headline,
    reason: parts.reason,
    numbers: draft.numbers,
    assumptions: draft.assumptions,
    fees: draft.fees,
    risks: draft.risks,
    dataAgeMs: draft.dataAgeMs,
    maxDataAgeMs: draft.maxDataAgeMs,
    payload: parts.payload,
  };
}
