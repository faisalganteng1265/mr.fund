/**
 * Stage-level reconciliation for a plain-wallet opening (`add-chat-open-position` 4.1 and 4.3,
 * invariants OP-4 and OP-5): the parsed receipts of one stage plus a fresh Rhea and wallet read
 * before and after become one honest state. Pure and deterministic; every input is observed data.
 *
 * Rules, in the order they apply:
 * - Pending or missing receipts are `submitted`: no receipt links, no health, nothing applied.
 * - Terminal receipts without a post-state read, or with one older than the transaction's final
 *   block, are `unresolved`: success on receipts alone never confirms.
 * - A deposit is `confirmed` only when the contract accepted and refunded nothing AND the
 *   collateral balance rose by that amount. Acceptance alone is not collateralization, so an
 *   accepted deposit whose collateral is not observed stays `unresolved`.
 * - A borrow is `confirmed` only with delivery evidence (the debt token's `ft_transfer` to the
 *   signer), a confirmed withdraw callback AND a debt rise of at least the principal. A balance
 *   delta is reported but never used as causal proof. Debt that rose without delivery is
 *   `partial` ("debt without delivery"); the debt stays, nothing is rolled back.
 * - Registrations that landed before a failed main transaction are `partial` (`registration_only`);
 *   a fee that landed while the main transaction failed is `partial` (`fee_only`); an applied main
 *   transaction followed by a failed fee is `partial` (`fee_failed_after_applied`). A fee is never
 *   charged again and an applied stage is never undone.
 * - Receipt links (hashes) are exposed only in `confirmed`, `failed` and `partial`.
 * - Health is exposed only in `confirmed` and `partial`, from a post-state read.
 *
 * Rounding units: Rhea's share conversions floor. The `increase_collateral` event of the recorded
 * public deposit of 5 x 10^23 reported 499999999999999999999999, one unit less than sent, so a rise
 * within `ROUNDING_UNITS` of the expected amount counts. This is a unit-level allowance for floor
 * rounding, not a percentage tolerance.
 *
 * Does not guarantee: cross-stage atomicity, that a rise is caused by this transaction rather than
 * a concurrent one, or exact delivery.
 */
import type {
  OpeningOutcome,
  OpeningPlan,
  OpeningTransactionOutcome,
} from "./open-position-outcome";

/** Floor-rounding allowance in Rhea internal units; one unit was observed on a real deposit. */
export const ROUNDING_UNITS = 2n;

export interface OpeningObservation {
  /** Height of the final block this read was pinned to. */
  blockHeight: number;
  readAtMs: number;
  /** Collateral token balance in Rhea, internal units. */
  collateralInternal: bigint;
  /** Debt token balance in Rhea, internal units. */
  debtInternal: bigint;
  /** Wallet token balances in token atomic units; corroboration only. */
  walletCollateral: bigint | null;
  walletDebt: bigint | null;
  /** Engine health on the same snapshot; null when it could not be computed. */
  healthBps: number | "no_debt" | null;
}

/** 10^extraDecimals of each token: internal = atomic x scale. */
export interface OpeningScales {
  collateral: bigint;
  debt: bigint;
}

export type OpeningState = "submitted" | "confirmed" | "failed" | "partial" | "unresolved";
export type OpeningReason =
  | "pending"
  | "evidence_unavailable"
  | "post_state_unavailable"
  | "post_state_before_final"
  | "collateral_not_observed"
  | "debt_not_observed"
  | "delivery_not_observed"
  | "state_changed_without_success"
  | "refund"
  | "receipt_failed_after_accept"
  | "debt_without_delivery"
  | "registration_only"
  | "fee_only"
  | "fee_failed_after_applied"
  | "applied"
  | "nothing_applied";

export interface OpeningResult {
  state: OpeningState;
  reason: OpeningReason;
  /** null means not known (still pending, or no such transaction was planned). */
  applied: { registration: boolean | null; main: boolean | null; fee: boolean | null };
  /** Receipt links; empty unless the state is confirmed, failed or partial. */
  txHashes: string[];
  main: Pick<
    OpeningTransactionOutcome,
    "role" | "execution" | "sent" | "accepted" | "refunded" | "delivered" | "withdrawConfirmed"
  > | null;
  observed: {
    collateralBefore: bigint;
    collateralAfter: bigint;
    debtBefore: bigint;
    debtAfter: bigint;
    /** Reported, never used as proof of delivery. */
    walletDebtDelta: bigint | null;
    healthAfter: number | "no_debt" | null;
    blockHeight: number;
    readAtMs: number;
  } | null;
}

const hashesOf = (plan: OpeningPlan) => plan.transactions.map((t) => t.hash);

function allSucceeded(txs: OpeningTransactionOutcome[]): boolean | null {
  return txs.length === 0 ? null : txs.every((t) => t.execution === "succeeded");
}

export function reconcileOpening(input: {
  plan: OpeningPlan;
  /** Parsed receipts, or null when none could be read yet. */
  outcome: OpeningOutcome | null;
  before: OpeningObservation;
  /** Fresh read after the transactions; null when it was unavailable. */
  after: OpeningObservation | null;
  scales: OpeningScales;
}): OpeningResult {
  const { plan, outcome, before, after, scales } = input;
  const unknown = { registration: null, main: null, fee: null } as const;
  const base = { txHashes: [] as string[], main: null, observed: null };

  if (!outcome || outcome.execution === "pending")
    return {
      state: "submitted",
      reason: outcome ? "pending" : "evidence_unavailable",
      applied: unknown,
      ...base,
    };

  const main = outcome.transactions.find((t) => t.role === "deposit" || t.role === "borrow");
  if (!main)
    return { state: "unresolved", reason: "evidence_unavailable", applied: unknown, ...base };
  const registrations = outcome.transactions.filter((t) => t.role === "registration");
  const fees = outcome.transactions.filter((t) => t.role === "fee");
  const mainView = {
    role: main.role,
    execution: main.execution,
    sent: main.sent,
    accepted: main.accepted,
    refunded: main.refunded,
    delivered: main.delivered,
    withdrawConfirmed: main.withdrawConfirmed,
  };

  if (!after)
    return {
      state: "unresolved",
      reason: "post_state_unavailable",
      applied: unknown,
      txHashes: [],
      main: mainView,
      observed: null,
    };
  const finalHeight = main.finalBlockHeight;
  if (finalHeight === null || after.blockHeight < finalHeight)
    return {
      state: "unresolved",
      reason: "post_state_before_final",
      applied: unknown,
      txHashes: [],
      main: mainView,
      observed: null,
    };

  const dCollateral = after.collateralInternal - before.collateralInternal;
  const dDebt = after.debtInternal - before.debtInternal;
  const registrationApplied = allSucceeded(registrations);
  const feeApplied = allSucceeded(fees);
  const walletDebtDelta =
    after.walletDebt !== null && before.walletDebt !== null
      ? after.walletDebt - before.walletDebt
      : null;
  const observed = (withHealth: boolean): OpeningResult["observed"] => ({
    collateralBefore: before.collateralInternal,
    collateralAfter: after.collateralInternal,
    debtBefore: before.debtInternal,
    debtAfter: after.debtInternal,
    walletDebtDelta,
    healthAfter: withHealth ? after.healthBps : null,
    blockHeight: after.blockHeight,
    readAtMs: after.readAtMs,
  });
  const make = (
    state: OpeningState,
    reason: OpeningReason,
    mainApplied: boolean | null,
  ): OpeningResult => ({
    state,
    reason,
    applied: { registration: registrationApplied, main: mainApplied, fee: feeApplied },
    txHashes: state === "unresolved" ? [] : hashesOf(plan),
    main: mainView,
    observed: observed(state === "confirmed" || state === "partial"),
  });

  // What the main transaction's receipts and the observed state each say.
  let mainApplied: boolean;
  let confirmedByState: boolean;
  if (main.role === "deposit") {
    const expectedUp = (main.accepted ?? 0n) * scales.collateral;
    mainApplied = expectedUp > 0n && dCollateral >= expectedUp - ROUNDING_UNITS;
    confirmedByState = mainApplied;
  } else {
    const principal = main.sent ?? 0n;
    mainApplied = principal > 0n && dDebt >= principal - ROUNDING_UNITS;
    confirmedByState = mainApplied && main.delivered !== null && main.withdrawConfirmed === true;
  }

  if (main.execution === "succeeded") {
    if (!confirmedByState) {
      const reason: OpeningReason =
        main.role === "deposit"
          ? "collateral_not_observed"
          : mainApplied
            ? "delivery_not_observed"
            : "debt_not_observed";
      return make("unresolved", reason, null);
    }
    if (fees.length > 0 && feeApplied !== true)
      return make("partial", "fee_failed_after_applied", true);
    return make("confirmed", "applied", true);
  }

  if (main.execution === "partial") {
    if (main.role === "deposit")
      return make(
        "partial",
        (main.refunded ?? 0n) > 0n ? "refund" : "receipt_failed_after_accept",
        mainApplied,
      );
    // Borrow: delivery or the withdraw callback is not confirmed.
    return mainApplied
      ? make("partial", "debt_without_delivery", true)
      : make("unresolved", "debt_not_observed", null);
  }

  // The main transaction failed.
  if (main.role === "borrow" && mainApplied) return make("partial", "debt_without_delivery", true);
  const sentUp =
    main.role === "deposit" ? (main.sent ?? 0n) * scales.collateral : (main.sent ?? 0n);
  const changed = main.role === "deposit" ? dCollateral >= sentUp - ROUNDING_UNITS : false;
  if (main.role === "deposit" && changed && sentUp > 0n)
    return make("unresolved", "state_changed_without_success", null);
  if (registrationApplied === true) return make("partial", "registration_only", false);
  if (feeApplied === true) return make("partial", "fee_only", false);
  return make("failed", "nothing_applied", false);
}
