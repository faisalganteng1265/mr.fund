export type AccountId = string;
/** Token amount in atomic units. Always `bigint`, never `number`. */
export type Atomic = bigint;
/** Integer basis points; 10000 = 100%. */
export type Bps = number;

export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };

export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });
export const err = <E>(error: E): Result<never, E> => ({ ok: false, error });

export type EngineError =
  | { kind: "stale_price"; tokenId: AccountId; ageMs: number; limitMs: number }
  | { kind: "missing_price"; tokenId: AccountId }
  | { kind: "unsupported_asset"; tokenId: AccountId }
  | { kind: "invalid_amount"; reason: string }
  /** A snapshot, policy or clock value that is malformed. Never guessed around. */
  | { kind: "invalid_input"; reason: string }
  /** The snapshot's own balances were read longer ago than the freshness limit. */
  | { kind: "stale_snapshot"; ageMs: number; limitMs: number }
  /** Repaying this token, up to the whole debt, cannot reach the target health. */
  | { kind: "target_unreachable"; tokenId: AccountId; targetBps: number };

/** Every engine output carries its inputs, assumptions and the age of its oldest input. */
export interface Computed<T> {
  value: T;
  inputs: Record<string, string>;
  assumptions: string[];
  dataAgeMs: number;
}
