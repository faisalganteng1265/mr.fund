import type { AccountId, Atomic } from "./errors";

export type CardAction =
  | "repay"
  /** Plain-wallet opening, stage 1: collateral into Rhea (`add-chat-open-position`). */
  | "wallet_collateral_deposit"
  /** Plain-wallet opening, stage 2: a borrow quoted again after the deposit is observed. */
  | "wallet_borrow"
  | "guardian_activate"
  | "guardian_deactivate"
  | "guardian_withdraw";

export interface FeeLine {
  label: string;
  amount: Atomic;
  tokenId: AccountId;
  recipientId: AccountId;
  /** When it is charged, in plain words. */
  when: string;
}

export interface NearFunctionCall {
  methodName: string;
  args: Record<string, unknown>;
  gas: bigint;
  /** yoctoNEAR */
  deposit: bigint;
}

export interface NearTransaction {
  receiverId: AccountId;
  actions: NearFunctionCall[];
}

export interface CardNumber {
  label: string;
  before?: string;
  after?: string;
  unit: string;
}

export interface CardReceipt {
  status: "submitted" | "confirmed" | "failed" | "partial";
  txHashes: string[];
  observed?: Record<string, string>;
  atMs: number;
}

/** `payload` is built only by `rhea` or `guardian-client` builders, never from model text. */
export interface Card {
  id: string;
  action: CardAction;
  headline: string;
  reason: string;
  numbers: CardNumber[];
  assumptions: string[];
  fees: FeeLine[];
  risks: string[];
  dataAgeMs: number;
  maxDataAgeMs: number;
  payload: NearTransaction[];
  receipt?: CardReceipt;
}

/**
 * Everything on a card except what only a builder or the model may add: the transaction payload
 * (built by `rhea` or `guardian-client`), the reason prose (LLM, number-checked) and the id.
 * Numbers are exact decimal strings; the UI localizes them.
 */
export interface CardDraft {
  action: CardAction;
  headline: string;
  numbers: CardNumber[];
  assumptions: string[];
  fees: FeeLine[];
  risks: string[];
  dataAgeMs: number;
  maxDataAgeMs: number;
  /** Validated amount in token atomic units, after bounds. Builders take it from here. */
  amount: Atomic;
  tokenId: AccountId;
  /** Which limit reduced the requested amount, if any. */
  cappedBy: "debt" | "wallet" | null;
}

/** Fee amounts in atomic units of `tokenId`. Pricing is open (D24), so there are no defaults. */
export interface FeeSchedule {
  tokenId: AccountId;
  recipientId: AccountId;
  /** Once, at Guardian activation. */
  activationFee: Atomic;
  /** Per executed automatic repay. 0 under the D27 fallback. */
  actionFee: Atomic;
  /** Per manual action executed through Mr.Fund. */
  executionFee: Atomic;
}
