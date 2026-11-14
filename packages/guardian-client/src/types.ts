import type { GuardianPolicy, GuardianState, GuardianStatus, Result } from "@mrfund/shared";

export type GuardianReadError = {
  kind: "not_found" | "rpc_unavailable" | "bad_response";
  detail: string;
};
/** Structurally compatible with a read-only injected RPC adapter; never imports Rhea internals. */
export interface GuardianViewClient {
  view(
    contractId: string,
    method: string,
    args: unknown,
    blockId?: string,
  ): Promise<Result<{ data: unknown; blockHeight: number; blockHash: string }, GuardianReadError>>;
}
export interface GuardianTarget {
  network: "testnet" | "mainnet";
  guardianId: string;
}
export interface GuardianConfigView {
  ownerId: string;
  watcherId: string;
  lendingId: string;
  oracleId: string;
  debtTokenId: string;
  collateralTokenIds: string[];
  feeRecipientId: string;
  activationFee: bigint;
  lendingVersion: "0.11.0" | "0.16.2";
  debtExtraDecimals: number;
  collateralExtraDecimals: number;
  collateralPriceId: string;
  debtPriceId: string;
  maxPriceAgeSec: number;
}
export type RepayPhase = null | "reading" | "repaying" | "unresolved" | { fee: { used: bigint } };
export interface GuardianStatusView {
  status: GuardianStatus;
  ownerId: string;
  watcherId: string;
  lendingId: string;
  oracleId: string;
  debtTokenId: string;
  collateralTokenIds: string[];
  feeRecipientId: string;
  lastActionStartedNs: bigint;
  inFlight: null | {
    opId: bigint;
    amount: bigint;
    fee: bigint;
    startedNs: bigint;
    repayPhase: RepayPhase;
  };
}
export interface GuardianReserveView {
  reserve: bigint;
  floor: bigint;
  spendable: bigint;
  lifetimeCap: bigint;
  spentTotal: bigint;
  lifetimeRemaining: bigint;
}
export const REJECT_REASONS = [
  "not_active",
  "in_flight",
  "cooldown",
  "zero_amount",
  "above_max_per_action",
  "above_lifetime_cap",
  "below_reserve_floor",
  "trigger_not_met",
  "stale_price",
  "unsupported_position_shape",
  "invalid_config",
  "bad_response",
  "arithmetic_overflow",
] as const;
export type GuardianRejectReason = (typeof REJECT_REASONS)[number];
export interface GuardianAttempt {
  opId: bigint;
  atNs: bigint;
  requested: bigint;
  used: bigint;
  fee: bigint;
  outcome: "rejected" | "started" | "settled" | "failed" | "unresolved";
  reason: GuardianRejectReason | null;
}
export interface GuardianHistory {
  attempts: GuardianAttempt[];
  retainedCount: number;
  retention: "possibly_truncated";
  limited: boolean;
  /** No event/transaction source is connected. An op id is never a transaction hash. */
  transactionLinks: "unavailable";
}
export interface GuardianSnapshot extends GuardianTarget {
  blockHeight: number;
  blockHash: string;
  readAtMs: number;
  config: GuardianConfigView;
  status: GuardianStatusView;
  policy: GuardianPolicy;
  reserve: GuardianReserveView;
  history: GuardianHistory;
  activationHistory: "unavailable";
}
export type GuardianEngineState = GuardianState;
export interface GuardianReadOptions {
  now?: () => number;
  sinceMs?: number;
  limit?: number;
}
