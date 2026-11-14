import type {
  GuardianReadError,
  GuardianRejectReason,
  GuardianSnapshot,
  GuardianTarget,
} from "@mrfund/guardian-client";
import type { PositionSnapshot, Result } from "@mrfund/shared";

/** Injected wall clock in ms since epoch; tests drive it explicitly. */
export interface WatcherClock {
  now(): number;
}

export type PositionReadError = { kind: "rpc_unavailable" | "bad_response"; detail: string };

/** Read-only views. The watcher never receives a raw RPC client with mutation methods. */
export interface WatcherReads {
  guardian(target: GuardianTarget): Promise<Result<GuardianSnapshot, GuardianReadError>>;
  /** Under G1 the loan lives on the Guardian account, so `accountId` is the Guardian. */
  position(
    network: GuardianTarget["network"],
    lendingId: string,
    accountId: string,
  ): Promise<Result<PositionSnapshot, PositionReadError>>;
}

export type RejectReason = GuardianRejectReason;

/** `request_repay` return value (SMART-CONTRACT "RequestOutcome"). */
export type RequestOutcome =
  | { outcome: "rejected"; opId: bigint; reason: RejectReason }
  | { outcome: "executed"; opId: bigint; used: bigint; fee: bigint }
  | { outcome: "failed"; opId: bigint }
  | { outcome: "unresolved"; opId: bigint };

/**
 * Result of one `request_repay(amount)` submission.
 * - `refused`: nothing was signed (permission, network or argument check failed first).
 * - `final`: the transaction reached a terminal execution outcome.
 * - `failed`: the transaction executed and failed (e.g. a contract panic); terminal.
 * - `pending`: signed; broadcast timed out or execution is not final. The hash must be
 *   reconciled before any new request (invariant W1).
 */
export type SubmitResult =
  | { kind: "refused"; reason: string }
  | { kind: "final"; hash: string; outcome: RequestOutcome }
  | { kind: "failed"; hash: string; detail: string }
  | { kind: "pending"; hash: string };

/** Lookup of a previously signed hash. `unknown` means the node has no record yet. */
export type TxLookup =
  | { kind: "final"; outcome: RequestOutcome }
  | { kind: "failed"; detail: string }
  | { kind: "pending" }
  | { kind: "unknown" };

/**
 * The only signing surface the watcher sees: one Guardian, one method, zero deposit.
 * There is deliberately no generic `call`, owner method or deposit parameter.
 */
export interface RepayRequester {
  readonly network: GuardianTarget["network"];
  readonly guardianId: string;
  requestRepay(amount: bigint): Promise<SubmitResult>;
  lookup(hash: string): Promise<TxLookup>;
}

/**
 * Startup evidence about this key's recent transactions. `clear` only when the adapter can
 * establish that no earlier signed request is still unaccounted for.
 */
export type StartupEvidence = { kind: "clear" } | { kind: "uncertain"; detail: string };

export type WatcherEvent =
  | { event: "tick_skipped_busy"; guardianId: string; at: number }
  | { event: "read_failed"; guardianId: string; at: number; kind: string; retryAt: number }
  | { event: "evaluated"; guardianId: string; at: number; act: false; reason: string }
  | { event: "evaluation_refused"; guardianId: string; at: number; reason: string }
  | { event: "request_sent"; guardianId: string; at: number; amount: string; hash: string }
  | { event: "request_refused"; guardianId: string; at: number; reason: string }
  | { event: "request_pending"; guardianId: string; at: number; hash: string }
  | {
      event: "request_outcome";
      guardianId: string;
      at: number;
      hash: string;
      outcome: RequestOutcome["outcome"];
      reason: RejectReason | null;
      opId: string;
    }
  | { event: "request_failed"; guardianId: string; at: number; hash: string; detail: string }
  | { event: "request_uncertain"; guardianId: string; at: number; detail: string }
  | { event: "read_only"; guardianId: string; at: number; detail: string }
  | { event: "requests_enabled"; guardianId: string; at: number };

export type WatcherLog = (event: WatcherEvent) => void;
