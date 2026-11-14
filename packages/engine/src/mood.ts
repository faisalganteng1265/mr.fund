import type { CardReceipt, PositionSnapshot } from "@mrfund/shared";
import { healthBps } from "./health";

/**
 * Character state (PRD F1 table). The model never picks the mood; this does,
 * from data. "Thinking" is a transient UI state while a tool call is in
 * flight, not a mood, so it is not produced here.
 *
 * Receipts carry health before and after as decimal strings in `observed`.
 * The receipt builder (P4.3) must fill these from fresh reads; without them a
 * confirmed receipt cannot make the character pleased.
 *
 * Does not guarantee: that the position is safe. The comfort line is a
 * preference, and calm only means fresh data at or above it.
 */
export const OBSERVED_HEALTH_BEFORE_BPS = "healthBeforeBps";
export const OBSERVED_HEALTH_AFTER_BPS = "healthAfterBps";

/** [I] How long a receipt colours the mood. The PRD gives no duration. */
export const DEFAULT_RECEIPT_WINDOW_MS = 300_000;

export type MoodState = "calm" | "concerned" | "pleased";
export type MoodReason =
  | "healthy"
  | "below_comfort"
  | "stale_data"
  | "failed_transaction"
  | "improved_health";

export interface Mood {
  state: MoodState;
  reason: MoodReason;
}

export interface MoodOptions {
  maxDataAgeMs?: number;
  receiptWindowMs?: number;
}

function bpsOf(v: string | undefined): bigint | undefined {
  return v !== undefined && /^\d+$/.test(v) ? BigInt(v) : undefined;
}

function improved(r: CardReceipt): boolean {
  const before = bpsOf(r.observed?.[OBSERVED_HEALTH_BEFORE_BPS]);
  const after = bpsOf(r.observed?.[OBSERVED_HEALTH_AFTER_BPS]);
  return before !== undefined && after !== undefined && after > before;
}

export function mood(
  snapshot: PositionSnapshot,
  lastReceipt: CardReceipt | undefined,
  comfortBps: number,
  nowMs: number,
  opts: MoodOptions = {},
): Mood {
  if (!Number.isInteger(comfortBps) || comfortBps <= 0) {
    throw new RangeError("comfortBps must be a positive integer");
  }
  const h = healthBps(
    snapshot,
    nowMs,
    opts.maxDataAgeMs === undefined ? {} : { maxDataAgeMs: opts.maxDataAgeMs },
  );
  if (!h.ok) return { state: "concerned", reason: "stale_data" };

  const windowMs = opts.receiptWindowMs ?? DEFAULT_RECEIPT_WINDOW_MS;
  const recent = lastReceipt !== undefined && nowMs - lastReceipt.atMs <= windowMs;

  if (recent && (lastReceipt.status === "failed" || lastReceipt.status === "partial")) {
    return { state: "concerned", reason: "failed_transaction" };
  }
  if (h.value.value !== "no_debt" && h.value.value < comfortBps) {
    return { state: "concerned", reason: "below_comfort" };
  }
  if (recent && lastReceipt.status === "confirmed" && improved(lastReceipt)) {
    return { state: "pleased", reason: "improved_health" };
  }
  return { state: "calm", reason: "healthy" };
}
