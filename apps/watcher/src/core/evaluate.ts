import { evaluateTrigger, MAX_DATA_AGE_MS } from "@mrfund/engine";
import { type GuardianSnapshot, toGuardianState } from "@mrfund/guardian-client";
import type { PositionSnapshot } from "@mrfund/shared";

export type Decision =
  | { kind: "act"; amount: bigint }
  | { kind: "hold"; reason: string }
  | { kind: "refuse"; reason: string };

/**
 * One deterministic decision from fresh views. No LLM, no network: the engine's
 * `evaluateTrigger` decides, after the snapshots are checked to describe the same Guardian.
 * The freshness limit is the stricter of the engine default and the Guardian's own
 * `max_price_age_sec`, so the watcher never acts on data the contract would call stale.
 * Advisory only: the contract re-checks every limit.
 */
export function decide(
  guardian: GuardianSnapshot,
  position: PositionSnapshot,
  nowMs: number,
): Decision {
  if (
    position.network !== guardian.network ||
    position.lendingId !== guardian.config.lendingId ||
    position.accountId !== guardian.guardianId
  )
    return { kind: "refuse", reason: "position_mismatch" };
  const contractAgeMs = guardian.config.maxPriceAgeSec * 1000;
  const maxDataAgeMs =
    contractAgeMs > 0 ? Math.min(MAX_DATA_AGE_MS, contractAgeMs) : MAX_DATA_AGE_MS;
  if (!(nowMs - guardian.readAtMs <= maxDataAgeMs) || guardian.readAtMs > nowMs)
    return { kind: "refuse", reason: "stale_guardian_state" };
  const result = evaluateTrigger(position, guardian.policy, toGuardianState(guardian), nowMs, {
    maxDataAgeMs,
  });
  if (!result.ok) return { kind: "refuse", reason: result.error.kind };
  if (!result.value.act) return { kind: "hold", reason: result.value.reason };
  return { kind: "act", amount: result.value.amount };
}
