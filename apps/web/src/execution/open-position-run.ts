/**
 * Plain-wallet opening execution (`add-chat-open-position` 4.2; invariant OP-4). It runs one stage
 * of one card: `fresh read → verify → still-matches → wallet → receipts + fresh post-state`.
 *
 * Permission boundary: only a NEAR Connect session has a signer, and the runner signs only what
 * `verifyOpeningPayload` accepted for this session against a context read just before (OP-1).
 * A card is locked from the moment signing starts and is never unlocked once the wallet was asked,
 * so a stage is submitted at most once per card; an unknown result is resolved by an explicit,
 * read-only `check`, never by a resend. `confirmed` exists only through `reconcileOpening`, which
 * needs parsed receipts and a post-state read; a thrown wallet error never yields it (OP-5).
 * A borrow cannot run from a deposit preview: the engine returns a zero maximum for an account
 * whose observed collateral is zero, so a borrow card needs collateral Rhea reports on chain.
 *
 * Does not guarantee: that the wallet displays the transaction faithfully, cross-stage atomicity,
 * or that an observed change was caused by this transaction rather than concurrent activity.
 */
import {
  healthBps,
  type OpenPositionInput,
  quoteBorrow,
  quoteCollateralDeposit,
} from "@mrfund/engine";
import { parseDecimal } from "@mrfund/guardian-client";
import {
  type AdapterError,
  type OpeningExpectedTransaction,
  type OpeningObservation,
  type OpeningOutcomeReader,
  type OpeningPlan,
  type OpeningResult,
  type OpeningScales,
  type OpenPositionContext,
  readOpeningOutcome,
  reconcileOpening,
  validateOpeningPlan,
} from "@mrfund/rhea";
import type { Card, Result } from "@mrfund/shared";
import type {
  OpeningExpectation,
  OpeningVerifyResult,
  VerifiedOpening,
} from "./open-position-verify";
import { verifyOpeningPayload } from "./open-position-verify";
import type { TransactionSigner } from "./signer";

/** Interest accrues between the card and the click; anything beyond this is a material change. */
const DEBT_DRIFT_DIVISOR = 1000n; // 0.1 %
const HEALTH_DRIFT_BPS = 50;

const sum = (lines: { tokenId: string; internal: bigint }[], id: string) =>
  lines.reduce((s, l) => (l.tokenId === id ? s + l.internal : s), 0n);

/** What a fresh context says about the account right now, in the reconciler's terms. */
export function observationOf(ctx: OpenPositionContext, nowMs: number): OpeningObservation {
  const h = healthBps(ctx.snapshot, nowMs);
  return {
    blockHeight: ctx.blockHeight,
    readAtMs: ctx.snapshot.readAtMs,
    collateralInternal: sum(ctx.snapshot.collateral, ctx.collateralTokenId),
    debtInternal: sum(ctx.snapshot.borrowed, ctx.debtTokenId),
    walletCollateral: ctx.walletCollateralBalance,
    walletDebt: ctx.walletDebtBalance,
    healthBps: h.ok ? h.value.value : null,
  };
}

export function scalesOf(ctx: OpenPositionContext): OpeningScales {
  const extra = (id: string) => ctx.snapshot.assets[id]?.token.extraDecimals ?? 0;
  return {
    collateral: 10n ** BigInt(extra(ctx.collateralTokenId)),
    debt: 10n ** BigInt(extra(ctx.debtTokenId)),
  };
}

const numberOf = (card: Card, label: string, unit: string, field: "before" | "after") =>
  card.numbers.find((n) => n.label === label && n.unit === unit)?.[field];

/**
 * Whether a fresh context still supports the card: the same amount must still quote within the
 * card's own target, the debt may only have grown by accrued interest (up to 0.1 %), and the
 * projected health may differ by at most 0.5 percentage points. A changed pool, liquidity,
 * supplied balance, price or version shows up as a refused quote. Anything else, or anything
 * unreadable, asks for a new card.
 */
export function openingStillMatches(
  card: Card,
  amount: bigint,
  ctx: OpenPositionContext,
  nowMs: number,
): boolean {
  const targetText = numberOf(card, "Target health", "%", "after");
  const target = targetText === undefined ? null : parseDecimal(targetText, 2);
  if (target === null || target <= 10_000n) return false;
  const input: OpenPositionInput = {
    snapshot: ctx.snapshot,
    collateralTokenId: ctx.collateralTokenId,
    debtTokenId: ctx.debtTokenId,
    lendingVersion: ctx.lendingVersion,
    pools: ctx.pools,
    accountBorrowedShares: ctx.accountBorrowedShares,
    availableInternal: ctx.availableInternal,
    targetBps: Number(target),
    oracleValidityMs: ctx.oracleValidityMs,
  };
  if (card.action === "wallet_collateral_deposit")
    return quoteCollateralDeposit(input, amount, ctx.walletCollateralBalance, nowMs).ok;
  const q = quoteBorrow(input, amount, nowMs);
  if (!q.ok) return false;
  const debt = ctx.snapshot.assets[ctx.debtTokenId]?.token;
  if (!debt) return false;
  const debtText = numberOf(card, "Debt", debt.symbol, "before");
  const cardDebt =
    debtText === undefined ? null : parseDecimal(debtText, debt.decimals + debt.extraDecimals);
  if (cardDebt === null) return false;
  const freshDebt = q.value.value.debtBeforeInternal;
  if (freshDebt < cardDebt || freshDebt - cardDebt > cardDebt / DEBT_DRIFT_DIVISOR) return false;
  const healthText = numberOf(card, "Health factor", "%", "after");
  const cardHealth = healthText === undefined ? null : parseDecimal(healthText, 2);
  if (cardHealth === null) return false;
  return Math.abs(q.value.value.healthAfter - Number(cardHealth)) <= HEALTH_DRIFT_BPS;
}

export interface WalletOutcome {
  transaction?: { hash?: unknown; signer_id?: unknown; receiver_id?: unknown };
}
export type OpeningPlanResult = { ok: true; value: OpeningPlan } | { ok: false; reason: string };

/**
 * Pair each verified transaction with the hash the wallet returned for it. Hashes come only from
 * the wallet result, in order, after checking signer and receiver; a missing, extra or mismatched
 * outcome fails, so the caller falls back to observation instead of trusting a partial plan.
 */
export function assembleOpeningPlan(
  verified: VerifiedOpening,
  outcomes: unknown,
  tokens: { collateralTokenId: string; debtTokenId: string },
): OpeningPlanResult {
  if (verified.lendingVersion !== "0.11.0")
    return { ok: false, reason: "This Rhea version has no verified opening plan." };
  if (!Array.isArray(outcomes)) return { ok: false, reason: "The wallet returned no outcomes." };
  if (outcomes.length !== verified.transactions.length)
    return { ok: false, reason: "The wallet returned a different number of outcomes." };
  const transactions: OpeningExpectedTransaction[] = [];
  for (const [i, tx] of verified.transactions.entries()) {
    const o = outcomes[i] as WalletOutcome | null | undefined;
    const t = o && typeof o === "object" ? o.transaction : undefined;
    if (!t || typeof t.hash !== "string")
      return { ok: false, reason: "A wallet outcome has no transaction hash." };
    if (t.signer_id !== verified.signerId || t.receiver_id !== tx.receiverId)
      return { ok: false, reason: "A wallet outcome does not match the transaction it signed." };
    transactions.push({
      hash: t.hash,
      signerId: verified.signerId,
      receiverId: tx.receiverId,
      methodName: tx.methodName,
      argsJson: tx.argsJson,
      deposit: tx.deposit,
      role: tx.role,
    });
  }
  const plan: OpeningPlan = {
    network: verified.network,
    accountId: verified.signerId,
    lendingId: verified.lendingId,
    lendingVersion: "0.11.0",
    stage: verified.stage,
    collateralTokenId: tokens.collateralTokenId,
    debtTokenId: tokens.debtTokenId,
    transactions,
  };
  const valid = validateOpeningPlan(plan);
  return valid.ok ? { ok: true, value: plan } : { ok: false, reason: valid.error.detail };
}

export interface OpeningRunnerDeps {
  /** Present only for a NEAR Connect session (E5). */
  signer: TransactionSigner | null;
  /** Fresh final-block opening context for the session account. */
  readContext(signal: AbortSignal): Promise<Result<OpenPositionContext, AdapterError>>;
  /** The expectation for this session, built from a context read just now. */
  expectationOf(ctx: OpenPositionContext): OpeningExpectation;
  /** Whether the fresh context still supports the card. Defaults to `openingStillMatches`. */
  stillMatches?(card: Card, amount: bigint, ctx: OpenPositionContext): boolean;
  reader: OpeningOutcomeReader;
  now(): number;
}

export type OpeningRunResult =
  /** Nothing was sent; the card can still be refreshed. */
  | { kind: "blocked"; reason: string }
  /** The reconciled stage state; `submitted` and `unresolved` can be re-read with `check`. */
  | { kind: "result"; result: OpeningResult }
  /** The wallet reported an error and nothing moved: nothing was sent that we can see. */
  | { kind: "nothing_observed" }
  /** The wallet reported an error but the position moved; shown as observed, never as confirmed. */
  | {
      kind: "observed_change";
      collateralBeforeInternal: bigint;
      collateralAfterInternal: bigint;
      debtBeforeInternal: bigint;
      debtAfterInternal: bigint;
    }
  /** Neither hashes nor a fresh read are available; the card stays locked. */
  | { kind: "unknown"; reason: string };

type Run =
  | { state: "signing" }
  | {
      state: "submitted";
      plan: OpeningPlan;
      before: OpeningObservation;
      scales: OpeningScales;
      result: OpeningResult;
    }
  | { state: "done" };

const noResult = (reason: OpeningResult["reason"]): OpeningResult => ({
  state: "unresolved",
  reason,
  applied: { registration: null, main: null, fee: null },
  txHashes: [],
  main: null,
  observed: null,
});

export function createOpeningRunner(deps: OpeningRunnerDeps) {
  const runs = new Map<string, Run>();
  const matches = deps.stillMatches ?? ((c, a, x) => openingStillMatches(c, a, x, deps.now()));

  async function freshObservation(signal: AbortSignal): Promise<OpeningObservation | null> {
    const ctx = await deps.readContext(signal).catch(() => null);
    return ctx?.ok ? observationOf(ctx.value, deps.now()) : null;
  }

  async function resolve(
    cardId: string,
    plan: OpeningPlan,
    before: OpeningObservation,
    scales: OpeningScales,
    signal: AbortSignal,
  ): Promise<OpeningRunResult> {
    const outcome = await readOpeningOutcome(plan, deps.reader, signal).catch(() => null);
    const after = await freshObservation(signal);
    let result: OpeningResult;
    if (outcome && !outcome.ok) result = noResult("evidence_unavailable");
    else
      result = reconcileOpening({
        plan,
        outcome: outcome?.ok ? outcome.value : null,
        before,
        after,
        scales,
      });
    runs.set(
      cardId,
      result.state === "submitted" || result.state === "unresolved"
        ? { state: "submitted", plan, before, scales, result }
        : { state: "done" },
    );
    return { kind: "result", result };
  }

  async function observeAfterError(
    before: OpeningObservation,
    signal: AbortSignal,
  ): Promise<OpeningRunResult> {
    const after = await freshObservation(signal);
    if (!after)
      return {
        kind: "unknown",
        reason: "Your wallet did not report a result and the position could not be re-read.",
      };
    return after.collateralInternal === before.collateralInternal &&
      after.debtInternal === before.debtInternal
      ? { kind: "nothing_observed" }
      : {
          kind: "observed_change",
          collateralBeforeInternal: before.collateralInternal,
          collateralAfterInternal: after.collateralInternal,
          debtBeforeInternal: before.debtInternal,
          debtAfterInternal: after.debtInternal,
        };
  }

  /** Fresh read, verification and card match; nothing is signed or locked. */
  async function preflight(card: Card, signal: AbortSignal) {
    if (runs.has(card.id))
      return { ok: false, reason: "This card was already submitted." } as const;
    if (!deps.signer)
      return { ok: false, reason: "This account cannot sign transactions." } as const;
    const ctx = await deps.readContext(signal).catch(() => null);
    if (!ctx?.ok)
      return { ok: false, reason: "Your position could not be read. Try again." } as const;
    const verified: OpeningVerifyResult = verifyOpeningPayload(card, deps.expectationOf(ctx.value));
    if (!verified.ok) return { ok: false, reason: verified.reason } as const;
    if (!matches(card, verified.value.amount, ctx.value))
      return { ok: false, reason: "Your position changed since this card. Refresh it." } as const;
    return { ok: true, verified: verified.value, ctx: ctx.value } as const;
  }

  return {
    status(cardId: string): Run["state"] | "idle" {
      return runs.get(cardId)?.state ?? "idle";
    },

    /** Verification only, for the in-app confirmation; nothing is signed. */
    async prepare(
      card: Card,
      signal: AbortSignal,
    ): Promise<{ ok: true; verified: VerifiedOpening } | { ok: false; reason: string }> {
      const p = await preflight(card, signal);
      return p.ok ? { ok: true, verified: p.verified } : p;
    },

    async execute(card: Card, signal: AbortSignal): Promise<OpeningRunResult> {
      const signer = deps.signer;
      const p = await preflight(card, signal);
      if (!p.ok || !signer) return { kind: "blocked", reason: p.ok ? "No signer." : p.reason };
      // A second click while the first read was in flight must not start a second submission.
      if (runs.has(card.id)) return { kind: "blocked", reason: "This card was already submitted." };
      runs.set(card.id, { state: "signing" });
      const before = observationOf(p.ctx, deps.now());
      const scales = scalesOf(p.ctx);
      // From here the wallet has been asked: the card is never unlocked again.
      let outcomes: unknown;
      try {
        outcomes = await signer.signAndSend(p.verified);
      } catch {
        runs.set(card.id, { state: "done" });
        return observeAfterError(before, signal);
      }
      const plan = assembleOpeningPlan(p.verified, outcomes, {
        collateralTokenId: p.ctx.collateralTokenId,
        debtTokenId: p.ctx.debtTokenId,
      });
      if (!plan.ok) {
        runs.set(card.id, { state: "done" });
        return observeAfterError(before, signal);
      }
      return resolve(card.id, plan.value, before, scales, signal);
    },

    /** Explicit "Check again": re-reads receipts and state only; it never signs or resends. */
    async check(cardId: string, signal: AbortSignal): Promise<OpeningRunResult> {
      const run = runs.get(cardId);
      if (run?.state !== "submitted") return { kind: "blocked", reason: "Nothing is pending." };
      return resolve(cardId, run.plan, run.before, run.scales, signal);
    },
  };
}

export interface OpeningFlowSummary {
  headline: string;
  /** Collateral the account holds in Rhea because of an observed deposit; never rolled back. */
  collateralRetained: boolean;
  /** Whether a borrow card may be offered: only after a deposit is observed on chain. */
  borrowOffered: boolean;
}

/** One line for the whole opening, from the two stage results. Deposit and borrow stay separate. */
export function openingFlowSummary(
  deposit: OpeningResult | null,
  borrow: OpeningResult | null,
): OpeningFlowSummary {
  const depositOk = deposit?.state === "confirmed";
  const retained = depositOk || deposit?.reason === "refund";
  if (!deposit)
    return { headline: "No deposit yet.", collateralRetained: false, borrowOffered: false };
  if (!depositOk)
    return {
      headline:
        deposit.state === "submitted"
          ? "Deposit sent; waiting for the chain."
          : deposit.state === "failed"
            ? "Deposit did not go through."
            : "Deposit not confirmed.",
      collateralRetained: retained,
      borrowOffered: false,
    };
  if (!borrow)
    return {
      headline: "Deposit applied. No borrow has been requested.",
      collateralRetained: true,
      borrowOffered: true,
    };
  const headline =
    borrow.state === "confirmed"
      ? "Deposit and borrow applied."
      : borrow.state === "partial"
        ? borrow.reason === "debt_without_delivery"
          ? "Deposit applied. The borrow added debt but the tokens were not confirmed."
          : "Deposit applied. The borrow is only partly applied."
        : borrow.state === "failed"
          ? "Deposit applied. The borrow did not go through; your collateral stays in Rhea."
          : "Deposit applied. The borrow is not confirmed yet.";
  // Never offer another borrow while one is pending or unresolved: that could double the debt.
  const settled = borrow.state === "failed" || borrow.state === "partial";
  return { headline, collateralRetained: true, borrowOffered: settled };
}
