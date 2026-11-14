import {
  type AccountId,
  type Atomic,
  type Bps,
  type EngineError,
  err,
  ok,
  type Result,
} from "./errors";

/** Contract constants (SMART-CONTRACT "Constants", D28). */
export const MIN_TRIGGER_HF_BPS = 10_500;
export const MIN_COOLDOWN_SEC = 300;

export interface GuardianPolicy {
  maxPerAction: Atomic;
  lifetimeCap: Atomic;
  reserveFloor: Atomic;
  triggerHfBps: Bps;
  targetHfBps: Bps | null;
  cooldownSec: number;
  actionFee: Atomic;
}

export type GuardianStatus = "created" | "active" | "paused" | "deactivated";

export interface GuardianState {
  status: GuardianStatus;
  ownerId: AccountId;
  watcherId: AccountId;
  debtTokenId: AccountId;
  reserve: Atomic;
  spentTotal: Atomic;
  inFlight: { opId: bigint; amount: Atomic; fee: Atomic } | null;
  /** Nanoseconds since epoch, as stored by the contract. */
  lastActionStartedNs: bigint;
}

/** Lead proposals (D28): user-editable, never presented as a safety guarantee. */
export const DEFAULT_COMFORT_HF_BPS = 15_000;
export const DEFAULT_TRIGGER_HF_BPS = 12_000;

const bad = (reason: string): Result<never, EngineError> => err({ kind: "invalid_input", reason });

/**
 * The same rules the contract enforces when a policy is set (SMART-CONTRACT "Policy"):
 * trigger at least the minimum, target above the trigger, cap at least the per-action maximum
 * and the maximum above zero, cooldown at least the minimum. Off-chain code validates first so
 * a malformed policy is refused instead of being sized as the largest possible spend.
 */
export function validatePolicy(p: GuardianPolicy): Result<GuardianPolicy, EngineError> {
  if (!Number.isInteger(p.triggerHfBps) || p.triggerHfBps < MIN_TRIGGER_HF_BPS) {
    return bad("trigger must be a whole number of bps at or above the contract minimum");
  }
  if (
    p.targetHfBps !== null &&
    (!Number.isInteger(p.targetHfBps) || p.targetHfBps <= p.triggerHfBps)
  ) {
    return bad("target must be a whole number of bps above the trigger");
  }
  if (!Number.isInteger(p.cooldownSec) || p.cooldownSec < MIN_COOLDOWN_SEC) {
    return bad("cooldown must be a whole number of seconds at or above the contract minimum");
  }
  if (p.maxPerAction <= 0n) return bad("max per action must be greater than zero");
  if (p.lifetimeCap < p.maxPerAction) return bad("lifetime cap must be at least max per action");
  if (p.reserveFloor < 0n) return bad("reserve floor must not be negative");
  if (p.actionFee < 0n) return bad("action fee must not be negative");
  return ok(p);
}
