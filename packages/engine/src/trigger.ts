import {
  type Atomic,
  type EngineError,
  err,
  type GuardianPolicy,
  type GuardianState,
  ok,
  type PositionSnapshot,
  type Result,
  validatePolicy,
} from "@mrfund/shared";
import { type HealthOptions, healthBps } from "./health";
import { outstandingDebtAtomic, repayToReachHealth } from "./sizing";

export type TriggerReason =
  | "not_active"
  | "in_flight"
  | "cooldown"
  | "no_debt"
  | "health_at_or_above_trigger"
  | "reserve_exhausted"
  | "lifetime_cap_reached";

/** What limited the amount: the health target itself, or one of the user's limits. */
export type TriggerBinding = "target" | "max_per_action" | "spendable" | "lifetime_cap";

export type TriggerDecision =
  | { act: false; reason: TriggerReason }
  | { act: true; amount: Atomic; binding: TriggerBinding };

const NS_PER_MS = 1_000_000n;
const NS_PER_SEC = 1_000_000_000n;

const saturatingSub = (a: bigint, b: bigint): bigint => (a > b ? a - b : 0n);

/**
 * Should the watcher request a repay now, and for how much?
 * Mirrors the contract's checks (SMART-CONTRACT `request_repay` steps 2 to 8) so the watcher
 * does not send requests the contract would reject. The contract stays the authority.
 * Fires only when health is strictly below the trigger; sizes to the target (or to the trigger
 * when none is set), then clamps to every limit, fee included.
 */
export function evaluateTrigger(
  s: PositionSnapshot,
  policy: GuardianPolicy,
  guardian: GuardianState,
  nowMs: number,
  opts: HealthOptions = {},
): Result<TriggerDecision, EngineError> {
  const no = (reason: TriggerReason): Result<TriggerDecision, EngineError> =>
    ok({ act: false, reason });

  const valid = validatePolicy(policy);
  if (!valid.ok) return valid;
  if (!Number.isFinite(nowMs) || nowMs < 0) {
    return err({ kind: "invalid_input", reason: "clock must be a non-negative number of ms" });
  }

  if (guardian.status !== "active") return no("not_active");
  if (guardian.inFlight !== null) return no("in_flight");
  const elapsedNs = BigInt(Math.floor(nowMs)) * NS_PER_MS - guardian.lastActionStartedNs;
  if (elapsedNs < BigInt(policy.cooldownSec) * NS_PER_SEC) return no("cooldown");

  const health = healthBps(s, nowMs, opts);
  if (!health.ok) return health;
  if (health.value.value === "no_debt") return no("no_debt");
  if (health.value.value >= policy.triggerHfBps) return no("health_at_or_above_trigger");

  // Limits as the contract checks them: the fee counts against both the reserve and the cap.
  const reserveRoom = saturatingSub(
    saturatingSub(guardian.reserve, policy.reserveFloor),
    policy.actionFee,
  );
  const capRoom = saturatingSub(
    saturatingSub(policy.lifetimeCap, guardian.spentTotal),
    policy.actionFee,
  );
  if (reserveRoom === 0n) return no("reserve_exhausted");
  if (capRoom === 0n) return no("lifetime_cap_reached");

  const target = policy.targetHfBps ?? policy.triggerHfBps;
  const needed = repayToReachHealth(s, guardian.debtTokenId, target, nowMs, opts);
  let desired: Atomic;
  if (needed.ok) {
    desired = needed.value.value;
  } else if (needed.error.kind === "target_unreachable") {
    // Repaying this token cannot reach the target; repay as much as the limits allow.
    desired = outstandingDebtAtomic(s, guardian.debtTokenId);
  } else {
    return err(needed.error);
  }

  const bounds: [TriggerBinding, bigint][] = [
    ["max_per_action", policy.maxPerAction],
    ["spendable", reserveRoom],
    ["lifetime_cap", capRoom],
  ];
  let amount = desired;
  let binding: TriggerBinding = "target";
  for (const [name, bound] of bounds) {
    if (bound < amount) {
      amount = bound;
      binding = name;
    }
  }
  if (amount === 0n) return no("health_at_or_above_trigger");
  return ok({ act: true, amount, binding });
}
