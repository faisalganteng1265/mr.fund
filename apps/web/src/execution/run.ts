import {
  type ObservationReader,
  type OutcomeError,
  type OutcomeReader,
  type RepayPlan,
  readRepayOutcome,
  toCardReceipt,
} from "@mrfund/rhea";
import type { Card, CardReceipt, PositionSnapshot, Result } from "@mrfund/shared";
import { assembleRepayPlan } from "./plan";
import type { TransactionSigner } from "./signer";
import type { VerifiedRepay, VerifyResult } from "./verify";

export interface RunnerDeps {
  /** Present only for a NEAR Connect session (E5). */
  signer: TransactionSigner | null;
  /** `verifyCardPayload` bound to the session, configuration and token metadata. */
  verify(card: Card): VerifyResult;
  /** Fresh final-block read of the session account's Rhea position. */
  readPosition(signal: AbortSignal): Promise<Result<PositionSnapshot, OutcomeError>>;
  /** Whether a fresh read still matches the inputs the card was computed from. */
  stillMatches(card: Card, before: PositionSnapshot): boolean;
  reader: OutcomeReader;
  health?: ObservationReader["health"];
  now(): number;
}

export type RunResult =
  /** Nothing was sent; the card can still be refreshed. */
  | { kind: "blocked"; reason: string }
  /** Hashes are known; `receipt.status` is the parser's verdict (`submitted` = still pending). */
  | { kind: "receipt"; receipt: CardReceipt }
  /** The wallet reported an error and the debt did not move: nothing was sent that we can see. */
  | { kind: "nothing_observed" }
  /** The wallet reported an error but the debt moved; shown as observed, never as confirmed. */
  | { kind: "observed_change"; debtBeforeInternal: bigint; debtAfterInternal: bigint }
  /** Neither hashes nor a fresh read are available; the card stays locked. */
  | { kind: "unknown"; reason: string };

type Run =
  | { state: "signing" }
  | { state: "submitted"; plan: RepayPlan; before: PositionSnapshot; receipt: CardReceipt }
  | { state: "done" };

const debtOf = (s: PositionSnapshot, tokenId: string) =>
  s.borrowed.reduce((sum, b) => (b.tokenId === tokenId ? sum + b.internal : sum), 0n);

/**
 * Manual repay execution (tasks 2.2, 2.3). Permission boundary: only the user's wallet signs,
 * and only a payload that `verify` accepted for this session (E1). At most one submission per
 * card (E3): a card is locked from the moment signing starts and is never unlocked once the
 * wallet was asked. `confirmed` comes only from `toCardReceipt` over a parsed outcome with a
 * fresh post-state; a thrown wallet error never yields it (E2).
 * Does not guarantee: that the wallet's own display is accurate or that a debt change is caused
 * by this repay (observed difference, not attribution).
 */
export function createRepayRunner(deps: RunnerDeps) {
  const runs = new Map<string, Run>();

  async function resolve(
    cardId: string,
    plan: RepayPlan,
    before: PositionSnapshot,
    signal: AbortSignal,
  ) {
    const outcome = await readRepayOutcome(plan, deps.reader, {
      before,
      observer: {
        readPosition: deps.readPosition,
        ...(deps.health ? { health: deps.health } : {}),
      },
      signal,
      now: deps.now,
    });
    const receipt: CardReceipt = outcome.ok
      ? toCardReceipt(outcome.value, deps.now())
      : { status: "submitted", txHashes: plan.transactions.map((t) => t.hash), atMs: deps.now() };
    runs.set(
      cardId,
      receipt.status === "submitted"
        ? { state: "submitted", plan, before, receipt }
        : { state: "done" },
    );
    return { kind: "receipt", receipt } as const;
  }

  async function observeAfterError(
    verified: VerifiedRepay,
    before: PositionSnapshot,
    signal: AbortSignal,
  ) {
    const after = await deps.readPosition(signal).catch(() => null);
    if (!after?.ok)
      return {
        kind: "unknown",
        reason: "Your wallet did not report a result and the position could not be re-read.",
      } as const;
    const debtBeforeInternal = debtOf(before, verified.tokenId);
    const debtAfterInternal = debtOf(after.value, verified.tokenId);
    return debtAfterInternal === debtBeforeInternal
      ? ({ kind: "nothing_observed" } as const)
      : ({ kind: "observed_change", debtBeforeInternal, debtAfterInternal } as const);
  }

  return {
    status(cardId: string): Run["state"] | "idle" {
      return runs.get(cardId)?.state ?? "idle";
    },

    /** Verification only, for the in-app confirmation; nothing is signed. */
    prepare(card: Card): VerifyResult {
      if (runs.has(card.id)) return { ok: false, reason: "This card was already submitted." };
      if (!deps.signer) return { ok: false, reason: "This account cannot sign transactions." };
      return deps.verify(card);
    },

    async execute(card: Card, signal: AbortSignal): Promise<RunResult> {
      if (runs.has(card.id)) return { kind: "blocked", reason: "This card was already submitted." };
      const signer = deps.signer;
      if (!signer) return { kind: "blocked", reason: "This account cannot sign transactions." };
      const verified = deps.verify(card);
      if (!verified.ok) return { kind: "blocked", reason: verified.reason };
      runs.set(card.id, { state: "signing" });
      const before = await deps.readPosition(signal).catch(() => null);
      if (!before?.ok) {
        runs.delete(card.id);
        return { kind: "blocked", reason: "Your position could not be read. Try again." };
      }
      if (!deps.stillMatches(card, before.value)) {
        runs.delete(card.id);
        return { kind: "blocked", reason: "Your position changed since this card. Refresh it." };
      }
      // From here the wallet has been asked: the card is never unlocked again.
      let outcomes: unknown;
      try {
        outcomes = await signer.signAndSend(verified.value);
      } catch {
        runs.set(card.id, { state: "done" });
        return observeAfterError(verified.value, before.value, signal);
      }
      const plan = assembleRepayPlan(verified.value, outcomes);
      if (!plan.ok) {
        runs.set(card.id, { state: "done" });
        return observeAfterError(verified.value, before.value, signal);
      }
      return resolve(card.id, plan.value, before.value, signal);
    },

    /** Explicit "Check again" for a pending receipt; no polling loop. */
    async check(cardId: string, signal: AbortSignal): Promise<RunResult> {
      const run = runs.get(cardId);
      if (run?.state !== "submitted") return { kind: "blocked", reason: "Nothing is pending." };
      return resolve(cardId, run.plan, run.before, signal);
    },
  };
}
