import type { CardReceipt, Computed, EngineError, PositionSnapshot, Result } from "@mrfund/shared";

/** From the trusted unsigned transaction plan, never inferred from RPC/model text. */
export interface ExpectedTransaction {
  hash: string;
  signerId: string;
  receiverId: string;
  methodName: "ft_transfer_call" | "ft_transfer" | "storage_deposit";
  argsJson: string;
  deposit: bigint;
  role: "repay" | "fee" | "registration";
}

export interface RepayPlan {
  network: "testnet" | "mainnet";
  accountId: string;
  lendingId: string;
  tokenId: string;
  lendingVersion: "0.11.0" | "0.16.2";
  transactions: ExpectedTransaction[];
}

export type OutcomeError = {
  kind:
    | "invalid_plan"
    | "bad_response"
    | "identity_mismatch"
    | "limit_exceeded"
    | "rpc_unavailable";
  detail: string;
  /** Previously validated effects survive a later malformed/mismatched response. */
  observedTransactions?: TransactionOutcome[];
};

export type ExecutionState = "pending" | "succeeded" | "failed" | "partial";

export interface TransactionOutcome {
  hash: string;
  role: ExpectedTransaction["role"];
  execution: ExecutionState;
  sent: bigint | null;
  accepted: bigint | null;
  refunded: bigint | null;
  failureReceiptIds: string[];
  pendingReasons: string[];
  finalBlockHeight: number | null;
  transactionBlockHeight: number | null;
}

export interface RepayObservation {
  beforeBlockHeight: number;
  afterBlockHeight: number;
  debtBeforeInternal: bigint;
  debtAfterInternal: bigint;
  /** Observed difference, not causal attribution; interest/concurrent actions can intervene. */
  debtDecreaseInternal: bigint;
  suppliedChangeInternal: bigint;
  healthBeforeBps?: number | "no_debt";
  healthAfterBps?: number | "no_debt";
}

export interface RepayOutcome {
  execution: ExecutionState;
  transactions: TransactionOutcome[];
  observation: RepayObservation | null;
  observationReason: string;
}

export interface OutcomeEvidence {
  network: RepayPlan["network"];
  /** Raw EXPERIMENTAL_tx_status result, including receipt action details. */
  outcome: unknown;
  /** Raw block headers for every execution-outcome block hash. */
  blocks: unknown[];
}

export interface OutcomeReader {
  read(
    expected: ExpectedTransaction,
    signal: AbortSignal,
  ): Promise<Result<OutcomeEvidence | null, OutcomeError>>;
}

export interface ObservationReader {
  /** Must read a final block and preserve the read's start time. */
  readPosition(signal: AbortSignal): Promise<Result<PositionSnapshot, OutcomeError>>;
  /** Optional trusted engine function injected by the composition root; rhea never imports engine. */
  health?: (
    snapshot: PositionSnapshot,
    nowMs: number,
  ) => Result<Computed<number | "no_debt">, EngineError>;
}

export type Receipt = CardReceipt;
