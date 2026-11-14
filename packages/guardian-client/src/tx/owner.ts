import {
  type EngineError,
  err,
  type GuardianPolicy,
  isValidAccountId,
  type NearTransaction,
  ok,
  type Result,
} from "@mrfund/shared";
import { parsePolicy } from "../parse";
import type { GuardianSnapshot } from "../types";
import { activationPayload, policyWire } from "./activation";
export type GuardianOwnerAction =
  | { kind: "pause" | "resume" | "deactivate" }
  | { kind: "withdraw_reserve"; amount: bigint }
  | { kind: "rotate_watcher"; watcherId: string }
  | { kind: "set_policy"; policy: GuardianPolicy }
  | { kind: "activate"; amount: bigint };
const U128_MAX = (1n << 128n) - 1n;
/** Existing Guardian controls only. No signer and no guessed factory/provisioning payload. */
export function guardianOwnerPayload(
  snapshot: GuardianSnapshot,
  action: GuardianOwnerAction,
  context: { ownerId: string; nowMs: number },
): Result<NearTransaction[], EngineError> {
  const bad = (reason: string): Result<never, EngineError> =>
    err({ kind: "invalid_input", reason });
  try {
    if (
      !isValidAccountId(snapshot.guardianId) ||
      context.ownerId !== snapshot.config.ownerId ||
      snapshot.status.ownerId !== context.ownerId
    )
      return bad("Only the configured owner may build owner controls");
    if (
      !Number.isSafeInteger(context.nowMs) ||
      !Number.isSafeInteger(snapshot.readAtMs) ||
      snapshot.readAtMs < 0 ||
      context.nowMs < snapshot.readAtMs
    )
      return bad("Invalid owner draft timestamp");
    const age = context.nowMs - snapshot.readAtMs;
    if (age > 120000) return err({ kind: "stale_snapshot", ageMs: age, limitMs: 120000 });
    if (action === null || typeof action !== "object" || Array.isArray(action))
      return bad("Invalid owner action");
    if (action.kind === "activate") {
      if (Object.keys(action).some((k) => !["kind", "amount"].includes(k)))
        return bad("Unexpected owner action field");
      const draft = activationPayload(snapshot, action.amount, context);
      return draft.ok ? ok(draft.value.payload) : draft;
    }
    const allowed =
      action.kind === "withdraw_reserve"
        ? ["kind", "amount"]
        : action.kind === "rotate_watcher"
          ? ["kind", "watcherId"]
          : action.kind === "set_policy"
            ? ["kind", "policy"]
            : ["kind"];
    if (Object.keys(action).some((k) => !allowed.includes(k)))
      return bad("Unexpected owner action field");
    let methodName: string;
    let args: Record<string, unknown> = {};
    switch (action.kind) {
      case "pause":
        if (snapshot.status.status !== "active") return bad("Only an active Guardian can pause");
        methodName = "pause";
        break;
      case "resume":
        if (snapshot.status.status !== "paused") return bad("Only a paused Guardian can resume");
        methodName = "resume";
        break;
      case "deactivate":
        if (!["active", "paused"].includes(snapshot.status.status))
          return bad("Guardian cannot deactivate from this status");
        methodName = "deactivate";
        break;
      case "withdraw_reserve":
        if (
          snapshot.status.inFlight !== null ||
          typeof action.amount !== "bigint" ||
          action.amount <= 0n ||
          action.amount > U128_MAX ||
          action.amount > snapshot.reserve.reserve
        )
          return bad("Withdrawal exceeds unlocked booked reserve");
        methodName = "owner_withdraw_reserve";
        args = { amount: action.amount.toString() };
        break;
      case "rotate_watcher":
        if (!isValidAccountId(action.watcherId)) return bad("Invalid watcher account");
        methodName = "rotate_watcher";
        args = { watcher_id: action.watcherId };
        break;
      case "set_policy": {
        if (snapshot.status.inFlight !== null) return bad("Operation in flight");
        const wire = policyWire(action.policy);
        const policy = parsePolicy(wire);
        if (policy.lifetimeCap < snapshot.reserve.spentTotal)
          return bad("Lifetime cap below cumulative spend");
        methodName = "set_policy";
        args = { policy: wire };
        break;
      }
      default:
        return bad("Unsupported owner action");
    }
    return ok([
      {
        receiverId: snapshot.guardianId,
        actions: [{ methodName, args, gas: 30000000000000n, deposit: 1n }],
      },
    ]);
  } catch {
    return bad("Invalid owner action input");
  }
}
