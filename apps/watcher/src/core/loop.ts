import type { GuardianTarget } from "@mrfund/guardian-client";
import { MIN_COOLDOWN_SEC } from "@mrfund/shared";
import { decide } from "./evaluate";
import type {
  RepayRequester,
  RequestOutcome,
  StartupEvidence,
  TxLookup,
  WatcherClock,
  WatcherEvent,
  WatcherLog,
  WatcherReads,
} from "./types";

export const POLL_INTERVAL_MS = 30_000;
export const MAX_READ_BACKOFF_MS = 300_000;
/** Matches the panel's heartbeat rule (ARCHITECTURE): older than this is a stale observation. */
export const STALE_OBSERVATION_MS = 90_000;

/** Bounded exponential backoff after `failures` consecutive read failures (1-based). */
export function readBackoffMs(failures: number, intervalMs = POLL_INTERVAL_MS): number {
  if (failures <= 0) return 0;
  return Math.min(intervalMs * 2 ** Math.min(failures - 1, 16), MAX_READ_BACKOFF_MS);
}

export interface WatchedGuardian {
  target: GuardianTarget;
  requester: RepayRequester;
  /** Startup evidence for this Guardian's key (see `StartupEvidence`). */
  startup(): Promise<StartupEvidence>;
}

export interface WatcherOptions {
  guardians: WatchedGuardian[];
  reads: WatcherReads;
  clock: WatcherClock;
  log: WatcherLog;
  intervalMs?: number;
  /** Guardians an operator has explicitly reconciled after an uncertain restart. */
  operatorReconciled?: string[];
}

export interface GuardianStatus {
  guardianId: string;
  network: GuardianTarget["network"];
  requests: "enabled" | "read_only";
  readOnlyReason: string | null;
  monitoring: "recent_observation" | "stale_observation";
  lastSuccessfulReadAt: number | null;
  lastEvaluationAt: number | null;
  lastDecision: string | null;
  pendingHash: string | null;
  consecutiveReadFailures: number;
  retryAt: number | null;
  lastError: string | null;
}

export interface WatcherStatus {
  observedAt: number;
  startedAt: number;
  intervalMs: number;
  guardians: GuardianStatus[];
}

interface Slot {
  watched: WatchedGuardian;
  busy: boolean;
  startup: "unchecked" | "clear" | "uncertain";
  /** Set when a submission's fate is unknowable (transport threw); only an operator clears it. */
  lockedReason: string | null;
  pending: { hash: string } | null;
  holdUntil: number;
  cooldownMs: number;
  failures: number;
  retryAt: number;
  lastSuccessfulReadAt: number | null;
  lastEvaluationAt: number | null;
  lastDecision: string | null;
  lastError: string | null;
  announced: string | null;
}

/**
 * Deterministic Guardian watcher (BUILD-PLAN P5.3, invariant W1: at most one unresolved
 * request per Guardian, and no owner authority).
 *
 * Every tick reads fresh Guardian and position views, asks the engine, and only then may call
 * the single `requestRepay` surface. Ticks never overlap per Guardian. A signed hash is
 * reconciled before any new request; anything ambiguous leaves the Guardian read-only.
 * Does not guarantee uptime or that liquidation is prevented: the contract stays the authority.
 */
export function createWatcher(options: WatcherOptions) {
  const { reads, clock, log } = options;
  const intervalMs = options.intervalMs ?? POLL_INTERVAL_MS;
  const reconciled = new Set(options.operatorReconciled ?? []);
  const ids = new Set<string>();
  const slots: Slot[] = options.guardians.map((watched) => {
    const id = watched.target.guardianId;
    if (ids.has(id)) throw new Error(`Guardian ${id} is configured twice`);
    if (watched.requester.guardianId !== id || watched.requester.network !== watched.target.network)
      throw new Error(`Requester for ${id} targets another Guardian or network`);
    ids.add(id);
    return {
      watched,
      busy: false,
      startup: reconciled.has(id) ? "clear" : "unchecked",
      lockedReason: null,
      pending: null,
      holdUntil: 0,
      cooldownMs: MIN_COOLDOWN_SEC * 1000,
      failures: 0,
      retryAt: 0,
      lastSuccessfulReadAt: null,
      lastEvaluationAt: null,
      lastDecision: null,
      lastError: null,
      announced: null,
    };
  });
  const startedAt = clock.now();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running = false;
  let stopGeneration = 0;

  const emit = (event: WatcherEvent) => {
    try {
      log(event);
    } catch {
      // A failing log sink must not change what the watcher does.
    }
  };

  const readOnlyReason = (slot: Slot): string | null =>
    slot.lockedReason ??
    (slot.startup === "clear"
      ? slot.lastSuccessfulReadAt === null
        ? "awaiting_first_read"
        : null
      : slot.startup === "unchecked"
        ? "startup_unchecked"
        : "startup_uncertain");

  /** Log mode changes once instead of every tick. */
  const announce = (slot: Slot, id: string) => {
    const reason = readOnlyReason(slot);
    const key = reason ?? "enabled";
    if (key === slot.announced) return;
    slot.announced = key;
    emit(
      reason === null
        ? { event: "requests_enabled", guardianId: id, at: clock.now() }
        : { event: "read_only", guardianId: id, at: clock.now(), detail: reason },
    );
  };

  const settle = (slot: Slot, id: string, hash: string, outcome: RequestOutcome) => {
    slot.pending = null;
    emit({
      event: "request_outcome",
      guardianId: id,
      at: clock.now(),
      hash,
      outcome: outcome.outcome,
      reason: outcome.outcome === "rejected" ? outcome.reason : null,
      opId: outcome.opId.toString(),
    });
    // A rejection is not retried until a full cooldown passes, so an unchanged condition
    // cannot become a send loop. Executed and failed outcomes are also cooled by the contract.
    if (outcome.outcome !== "executed") slot.holdUntil = clock.now() + slot.cooldownMs;
  };

  const failed = (slot: Slot, id: string, hash: string, detail: string) => {
    slot.pending = null;
    slot.holdUntil = clock.now() + slot.cooldownMs;
    emit({ event: "request_failed", guardianId: id, at: clock.now(), hash, detail });
  };

  /** Query a signed hash; a terminal result still waits for the next tick before any send. */
  const reconcile = async (slot: Slot, id: string, hash: string): Promise<void> => {
    let found: TxLookup;
    try {
      found = await slot.watched.requester.lookup(hash);
    } catch {
      found = { kind: "unknown" };
    }
    if (found.kind === "final") settle(slot, id, hash, found.outcome);
    else if (found.kind === "failed") failed(slot, id, hash, found.detail);
    else emit({ event: "request_pending", guardianId: id, at: clock.now(), hash });
  };

  async function poll(slot: Slot): Promise<void> {
    const { target, requester } = slot.watched;
    const id = target.guardianId;
    if (slot.busy) {
      emit({ event: "tick_skipped_busy", guardianId: id, at: clock.now() });
      return;
    }
    slot.busy = true;
    const generation = stopGeneration;
    try {
      if (clock.now() < slot.retryAt) return;
      // A signed hash is reconciled first; even a terminal result waits for the next tick.
      let sendable = true;
      if (slot.pending) {
        await reconcile(slot, id, slot.pending.hash);
        sendable = false;
      }
      if (slot.startup !== "clear") {
        let evidence: StartupEvidence;
        try {
          evidence = await slot.watched.startup();
        } catch {
          evidence = { kind: "uncertain", detail: "startup evidence unavailable" };
        }
        slot.startup = evidence.kind;
        if (evidence.kind === "uncertain") slot.lastError = evidence.detail;
        sendable = false;
      }

      const guardian = await reads.guardian(target).catch(() => null);
      const position =
        guardian?.ok === true
          ? await reads
              .position(target.network, guardian.value.config.lendingId, id)
              .catch(() => null)
          : null;
      if (guardian?.ok !== true || position?.ok !== true) {
        const kind =
          guardian === null || position === null
            ? "rpc_unavailable"
            : !guardian.ok
              ? guardian.error.kind
              : position.ok
                ? "bad_response"
                : position.error.kind;
        slot.failures += 1;
        slot.retryAt = clock.now() + readBackoffMs(slot.failures, intervalMs);
        slot.lastError = kind;
        emit({
          event: "read_failed",
          guardianId: id,
          at: clock.now(),
          kind,
          retryAt: slot.retryAt,
        });
        return;
      }
      const readAt = clock.now();
      slot.failures = 0;
      slot.retryAt = 0;
      slot.lastSuccessfulReadAt = readAt;
      if (slot.startup === "clear") slot.lastError = null;
      slot.cooldownMs = Math.max(guardian.value.policy.cooldownSec, MIN_COOLDOWN_SEC) * 1000;
      announce(slot, id);

      const decision = decide(guardian.value, position.value, readAt);
      slot.lastEvaluationAt = readAt;
      if (decision.kind === "refuse") {
        slot.lastDecision = `refused:${decision.reason}`;
        emit({ event: "evaluation_refused", guardianId: id, at: readAt, reason: decision.reason });
        return;
      }
      if (decision.kind === "hold") {
        slot.lastDecision = `hold:${decision.reason}`;
        emit({
          event: "evaluated",
          guardianId: id,
          at: readAt,
          act: false,
          reason: decision.reason,
        });
        return;
      }
      const blocked =
        readOnlyReason(slot) ??
        (slot.pending || !sendable ? "request_unreconciled" : null) ??
        (readAt < slot.holdUntil ? "rejection_hold" : null);
      if (blocked) {
        slot.lastDecision = `hold:${blocked}`;
        emit({ event: "evaluated", guardianId: id, at: readAt, act: false, reason: blocked });
        return;
      }

      if (generation !== stopGeneration) return;

      slot.lastDecision = `act:${decision.amount}`;
      let sent: Awaited<ReturnType<RepayRequester["requestRepay"]>>;
      try {
        sent = await requester.requestRepay(decision.amount);
      } catch {
        // Unknown whether a transaction was signed: never resend on our own.
        slot.lockedReason = "submission_uncertain";
        emit({
          event: "request_uncertain",
          guardianId: id,
          at: clock.now(),
          detail: "transport failed without a reconcilable hash",
        });
        announce(slot, id);
        return;
      }
      if (sent.kind === "refused") {
        slot.holdUntil = clock.now() + slot.cooldownMs;
        emit({ event: "request_refused", guardianId: id, at: clock.now(), reason: sent.reason });
        return;
      }
      emit({
        event: "request_sent",
        guardianId: id,
        at: clock.now(),
        amount: decision.amount.toString(),
        hash: sent.hash,
      });
      if (sent.kind === "final") settle(slot, id, sent.hash, sent.outcome);
      else if (sent.kind === "failed") failed(slot, id, sent.hash, sent.detail);
      else {
        slot.pending = { hash: sent.hash };
        emit({ event: "request_pending", guardianId: id, at: clock.now(), hash: sent.hash });
      }
    } finally {
      slot.busy = false;
    }
  }

  /** One scheduled tick. Slow Guardians do not delay or overlap with each other. */
  const tick = () =>
    Promise.all(
      slots.map(async (slot) => {
        try {
          await poll(slot);
        } catch {
          // An unexpected adapter or state failure may have happened after signing.
          // Without a reconcilable hash, fail closed and never log the exception.
          slot.lockedReason = "poll_uncertain";
          slot.lastError = "poll_uncertain";
          emit({
            event: "request_uncertain",
            guardianId: slot.watched.target.guardianId,
            at: clock.now(),
            detail: "unexpected polling failure",
          });
          announce(slot, slot.watched.target.guardianId);
        }
      }),
    ).then(() => undefined);

  const schedule = () => {
    if (!running) return;
    timer = setTimeout(() => {
      void tick();
      schedule();
    }, intervalMs);
  };

  return {
    tick,
    start() {
      if (running) return;
      running = true;
      void tick();
      schedule();
    },
    stop() {
      running = false;
      stopGeneration++;
      if (timer) clearTimeout(timer);
      timer = null;
    },
    status(): WatcherStatus {
      const now = clock.now();
      return {
        observedAt: now,
        startedAt,
        intervalMs,
        guardians: slots.map((slot) => ({
          guardianId: slot.watched.target.guardianId,
          network: slot.watched.target.network,
          requests: readOnlyReason(slot) === null ? "enabled" : "read_only",
          readOnlyReason: readOnlyReason(slot),
          monitoring:
            slot.lastSuccessfulReadAt !== null &&
            now - slot.lastSuccessfulReadAt <= STALE_OBSERVATION_MS
              ? "recent_observation"
              : "stale_observation",
          lastSuccessfulReadAt: slot.lastSuccessfulReadAt,
          lastEvaluationAt: slot.lastEvaluationAt,
          lastDecision: slot.lastDecision,
          pendingHash: slot.pending?.hash ?? null,
          consecutiveReadFailures: slot.failures,
          retryAt: slot.retryAt || null,
          lastError: slot.lastError,
        })),
      };
    },
  };
}

export type Watcher = ReturnType<typeof createWatcher>;
