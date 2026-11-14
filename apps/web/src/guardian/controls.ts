/**
 * Owner-control availability and panel facts derived only from a validated Guardian snapshot
 * (task 3.3). Availability mirrors the contract: Pause only from Active, Resume only from
 * Paused, Deactivate from Active or Paused, Withdraw in any status but never while an operation
 * is in flight. A deactivated Guardian keeps Withdraw (automation stops; past actions stand).
 * Does not guarantee: that a control still applies when signed; the contract re-checks.
 */
import type { GuardianSnapshot } from "@mrfund/guardian-client";

export type ControlKind = "pause" | "resume" | "deactivate" | "withdraw";
export interface ControlState {
  available: boolean;
  reason: string | null;
}

/** Older snapshots cannot build a payload (builders refuse after 120 s), so controls wait. */
export const SNAPSHOT_LIMIT_MS = 120_000;
/** [I] A watcher heartbeat older than this shows as offline with its exact age. */
export const HEARTBEAT_LIMIT_MS = 120_000;

export function controlAvailability(
  s: GuardianSnapshot,
  nowMs: number,
): Record<ControlKind, ControlState> {
  const status = s.status.status;
  const stale = nowMs - s.readAtMs > SNAPSHOT_LIMIT_MS ? "Refresh the Guardian first." : null;
  const locked = s.status.inFlight
    ? "An operation is in flight with an unknown outcome. Controls that move the reserve wait until the contract settles it."
    : null;
  const state = (reason: string | null): ControlState => ({ available: reason === null, reason });
  return {
    pause: state(stale ?? (status === "active" ? null : "Only an active Guardian can pause.")),
    resume: state(stale ?? (status === "paused" ? null : "Only a paused Guardian can resume.")),
    deactivate: state(
      stale ??
        (status === "active" || status === "paused"
          ? null
          : status === "deactivated"
            ? "Already deactivated."
            : "Activate the Guardian first."),
    ),
    withdraw: state(
      stale ?? locked ?? (s.reserve.reserve > 0n ? null : "There is no reserve to withdraw."),
    ),
  };
}

/**
 * Editing limits mirrors the contract (owner only, nothing in flight) and the panel's rule that
 * automation must be on or paused: a deactivated or not yet activated Guardian shows no editor.
 */
export function policyEditAvailability(s: GuardianSnapshot, nowMs: number): ControlState {
  const status = s.status.status;
  const reason =
    nowMs - s.readAtMs > SNAPSHOT_LIMIT_MS
      ? "Refresh the Guardian first."
      : status === "created"
        ? "Activate the Guardian first."
        : status === "deactivated"
          ? "Automation is off, so there is nothing left to tune."
          : s.status.inFlight
            ? "An operation is in flight. Limits can change after the contract settles it."
            : null;
  return { available: reason === null, reason };
}

/**
 * An in-flight lock as the panel states it. `get_status` reports amount and fee but not the
 * operation kind, so the outcome is always "unknown" and nothing offers to clear it.
 */
export function inFlightNotice(s: GuardianSnapshot): string | null {
  const f = s.status.inFlight;
  if (!f) return null;
  return f.repayPhase === "unresolved"
    ? "Locked: a repay could not be confirmed by the contract. The outcome is unknown and only the contract can resolve it."
    : "Locked: an operation is in flight. Its kind and outcome are unknown until the contract settles it.";
}

/** The contract keeps a bounded ring; when it is full, older attempts may be gone. */
export function historyNotice(s: GuardianSnapshot): string {
  return s.history.retainedCount >= 50 || s.history.limited
    ? "Older attempts are not retained by the contract."
    : "Showing the attempts the contract still retains. Transaction links are unavailable.";
}

export type Heartbeat = { kind: "unavailable" } | { kind: "online" | "offline"; ageMs: number };

/** Liveness evidence only: an online heartbeat does not prove the watcher will act. */
export function heartbeatState(lastSeenMs: number | null, nowMs: number): Heartbeat {
  if (lastSeenMs === null || !Number.isSafeInteger(lastSeenMs) || lastSeenMs > nowMs)
    return { kind: "unavailable" };
  const ageMs = nowMs - lastSeenMs;
  return { kind: ageMs > HEARTBEAT_LIMIT_MS ? "offline" : "online", ageMs };
}
