import type { GuardianTarget } from "@mrfund/guardian-client";
import type { RepayRequester, StartupEvidence, SubmitResult, WatcherReads } from "../core/types";

const MAX_U128 = (1n << 128n) - 1n;

/** Manual test only: never called by the scheduler and never retries an uncertain send. */
export async function requestOverLimit(input: {
  target: GuardianTarget;
  reads: WatcherReads;
  requester: RepayRequester;
  startup: StartupEvidence;
  nowMs: number;
  /** Optional clock sampled after the asynchronous snapshot completes. */
  now?: () => number;
  /** The caller must have separately established the applicable operation gates. */
  authorized: boolean;
}): Promise<SubmitResult> {
  if (!input.authorized || input.startup.kind !== "clear")
    return { kind: "refused", reason: "operator_gate_closed" };
  if (
    input.requester.guardianId !== input.target.guardianId ||
    input.requester.network !== input.target.network
  )
    return { kind: "refused", reason: "invalid_operator_context" };
  const state = await input.reads.guardian(input.target).catch(() => null);
  if (!state?.ok) return { kind: "refused", reason: "guardian_unavailable" };
  const nowMs = input.now ? input.now() : input.nowMs;
  if (!Number.isSafeInteger(nowMs) || nowMs < 0)
    return { kind: "refused", reason: "invalid_operator_context" };
  const guardian = state.value;
  if (
    guardian.network !== input.target.network ||
    guardian.guardianId !== input.target.guardianId ||
    guardian.readAtMs > nowMs ||
    nowMs - guardian.readAtMs > Math.min(120_000, guardian.config.maxPriceAgeSec * 1000)
  )
    return { kind: "refused", reason: "stale_or_foreign_guardian" };
  if (guardian.status.status !== "active" || guardian.status.inFlight !== null)
    return { kind: "refused", reason: "guardian_not_ready" };
  const nowNs = BigInt(nowMs) * 1_000_000n;
  const cooldownNs = BigInt(guardian.policy.cooldownSec) * 1_000_000_000n;
  if (
    guardian.status.lastActionStartedNs > 0n &&
    nowNs < guardian.status.lastActionStartedNs + cooldownNs
  )
    return { kind: "refused", reason: "cooldown" };
  if (guardian.policy.maxPerAction >= MAX_U128)
    return { kind: "refused", reason: "amount_overflow" };
  // If signing or broadcasting becomes ambiguous, propagate the failure: never make another call.
  return input.requester.requestRepay(guardian.policy.maxPerAction + 1n);
}
