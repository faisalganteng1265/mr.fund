import type { ChatEvent } from "@mrfund/agent";
import type { RepayVsYield, WhatIf } from "@mrfund/engine";
import type {
  Card,
  CardDraft,
  CardReceipt,
  Computed,
  EngineError,
  PositionSnapshot,
  Result,
} from "@mrfund/shared";

import type { LiveAccountView } from "./liveSession";

export type { ChatEvent };
export type Provenance = "simulated" | "live";
export interface Port {
  readonly provenance: Provenance;
  readonly networkLabel?: string;
}
export interface Store<T> {
  getSnapshot(): T;
  subscribe(listener: () => void): () => void;
}
export type DataState = "fresh" | "loading" | "stale" | "empty" | "error";
export type WalletOutcome = "success" | "cancel" | "failure" | "partial";
export type GuardianStatus = "inactive" | "active" | "paused" | "deactivated";
export interface PolicyFields {
  max: string;
  cap: string;
  floor: string;
  deposit: string;
  trigger: string;
  target: string;
  cooldown: string;
}
export interface Receipt {
  id: number;
  title: string;
  detail: string;
  status: "confirmed" | "rejected" | "failed" | "partial";
  at: string;
  atMs: number;
  before?: string;
  after?: string;
  chain: CardReceipt;
}
export interface PositionView {
  debt: bigint;
  now: number;
  dataState: DataState;
  snapshot: PositionSnapshot;
  current: { health: number | "no_debt" | null; liquidation: string | null };
  figures: { collateralUsd: string; borrowApr: string; supplyApr: string };
}
export interface Advice {
  card: Result<CardDraft, EngineError> | null;
  comp: Result<Computed<RepayVsYield>, EngineError>;
  whatIf: Result<Computed<WhatIf>, EngineError>;
}
export interface Approval {
  id: string;
  title: string;
  description: string;
  amount: string;
}
export type ExecutionEvent =
  | { type: "receipt"; receipt: Receipt }
  | { type: "notice"; text: string }
  | { type: "done"; applied: boolean };
export type OwnerAction = "pause" | "resume" | "deactivate" | "withdraw" | "topup";
export interface SessionView {
  connected: boolean;
  connecting: boolean;
  walletBalance: bigint;
  /** Present only for a live wallet session; simulated sessions have no real account. */
  account?: LiveAccountView;
}
export interface ExecutionView {
  receipts: Receipt[];
  lastRepay: Receipt | null;
  lastChange: { repaid: string; before: string; after: string } | null;
}
export interface GuardianView {
  guardian: GuardianStatus;
  reserve: bigint;
  guardianSpent: bigint;
  guardianDebt: bigint;
  savedFields: PolicyFields;
  watcherOnline: boolean;
  spendable: bigint;
  remaining: bigint;
}
export interface SessionPort extends Port, Store<SessionView> {
  connect(signal?: AbortSignal): Promise<void>;
  disconnect(): void;
}
export interface PositionPort extends Port, Store<PositionView> {
  advice(value: string, recommendation?: Card): Advice;
  refresh(signal?: AbortSignal): Promise<void>;
  selectDataState(state: DataState): void;
}
export interface ChatPort extends Port {
  send(request: { message: string; amount: string }, signal: AbortSignal): AsyncIterable<ChatEvent>;
}
export interface ExecutionPort extends Port, Store<ExecutionView> {
  prepareRepay(value: string, recommendation?: Card): Approval | null;
  execute(id: string, outcome: WalletOutcome, signal: AbortSignal): AsyncIterable<ExecutionEvent>;
  clearRecommendation(): void;
}
export interface GuardianPort extends Port, Store<GuardianView> {
  validate(fields: PolicyFields): string | null;
  prepare(action: OwnerAction | "activate", fields: PolicyFields): Approval | string;
  replay(overLimit: boolean): string;
  setWatcherOnline(online: boolean): void;
}
export interface ConsultationSource {
  readonly session: SessionPort;
  readonly position: PositionPort;
  readonly chat: ChatPort;
  readonly execution: ExecutionPort;
  readonly guardian: GuardianPort;
  reset(): void;
}
