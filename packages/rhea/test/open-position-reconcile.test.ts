import { describe, expect, it } from "vitest";
import type {
  OpeningOutcome,
  OpeningPlan,
  OpeningTransactionOutcome,
} from "../src/open-position-outcome";
import {
  type OpeningObservation,
  type OpeningScales,
  ROUNDING_UNITS,
  reconcileOpening,
} from "../src/open-position-reconcile";

const ME = "alice.testnet";
const H = (n: number) => `Hash${n}`.padEnd(44, "x");
const plan = (stage: OpeningPlan["stage"], n = 1): OpeningPlan => ({
  network: "testnet",
  accountId: ME,
  lendingId: "lending.testnet",
  lendingVersion: "0.11.0",
  stage,
  collateralTokenId: "wrap.testnet",
  debtTokenId: "ref.fakes.testnet",
  transactions: Array.from({ length: n }, (_, i) => ({
    hash: H(i),
    signerId: ME,
    receiverId: "x.testnet",
    methodName: "ft_transfer",
    argsJson: "{}",
    deposit: 1n,
    role: "fee",
  })),
});
const tx = (
  role: OpeningTransactionOutcome["role"],
  execution: OpeningTransactionOutcome["execution"],
  over: Partial<OpeningTransactionOutcome> = {},
): OpeningTransactionOutcome => ({
  hash: H(0),
  role,
  execution,
  sent: null,
  accepted: null,
  refunded: null,
  delivered: null,
  withdrawConfirmed: null,
  failureReceiptIds: [],
  pendingReasons: [],
  finalBlockHeight: 100,
  transactionBlockHeight: 99,
  ...over,
});
const outcome = (...transactions: OpeningTransactionOutcome[]): OpeningOutcome => {
  const execution = transactions.some((t) => t.execution === "pending")
    ? "pending"
    : transactions.every((t) => t.execution === "succeeded")
      ? "succeeded"
      : transactions.some((t) => t.execution === "succeeded" || t.execution === "partial")
        ? "partial"
        : "failed";
  return { execution, transactions };
};
const E24 = 10n ** 24n;
const obs = (over: Partial<OpeningObservation> = {}): OpeningObservation => ({
  blockHeight: 120,
  readAtMs: 1_000,
  collateralInternal: 0n,
  debtInternal: 0n,
  walletCollateral: 100n * E24,
  walletDebt: 0n,
  healthBps: "no_debt",
  ...over,
});
const scales: OpeningScales = { collateral: 1n, debt: 1n };

const DEP = 5n * 10n ** 23n;
const depositOk = () => tx("deposit", "succeeded", { sent: DEP, accepted: DEP, refunded: 0n });
const BORROW = 5n * 10n ** 17n;
const borrowOk = () =>
  tx("borrow", "succeeded", { sent: BORROW, delivered: BORROW - 1n, withdrawConfirmed: true });

describe("deposit stage", () => {
  const run = (o: OpeningOutcome | null, after: OpeningObservation | null) =>
    reconcileOpening({
      plan: plan("wallet_collateral_deposit"),
      outcome: o,
      before: obs(),
      after,
      scales,
    });

  it("confirmed only when accepted in full AND the collateral is observed", () => {
    const r = run(
      outcome(depositOk()),
      obs({ collateralInternal: DEP - 1n, healthBps: "no_debt" }),
    );
    expect(r).toMatchObject({ state: "confirmed", reason: "applied", applied: { main: true } });
    expect(r.txHashes).toEqual([H(0)]);
    expect(r.observed).toMatchObject({
      collateralBefore: 0n,
      collateralAfter: DEP - 1n,
      healthAfter: "no_debt",
    });
  });

  it("accepted by the token contract but no collateral observed stays unresolved, with no links or health", () => {
    const r = run(outcome(depositOk()), obs({ collateralInternal: 0n }));
    expect(r).toMatchObject({ state: "unresolved", reason: "collateral_not_observed" });
    expect(r.txHashes).toEqual([]);
    expect(r.observed?.healthAfter).toBeNull();
    expect(r.applied.main).toBeNull();
  });

  it("the rounding allowance is exactly two internal units", () => {
    expect(ROUNDING_UNITS).toBe(2n);
    expect(run(outcome(depositOk()), obs({ collateralInternal: DEP - 2n })).state).toBe(
      "confirmed",
    );
    expect(run(outcome(depositOk()), obs({ collateralInternal: DEP - 3n })).state).toBe(
      "unresolved",
    );
  });

  it("a partial refund is partial with the exact amounts and the collateral that did land", () => {
    const o = outcome(
      tx("deposit", "partial", { sent: DEP, accepted: 3n * 10n ** 23n, refunded: 2n * 10n ** 23n }),
    );
    const r = run(o, obs({ collateralInternal: 3n * 10n ** 23n }));
    expect(r).toMatchObject({ state: "partial", reason: "refund", applied: { main: true } });
    expect(r.main).toMatchObject({ accepted: 3n * 10n ** 23n, refunded: 2n * 10n ** 23n });
  });

  it("a full refund is failed, not confirmed", () => {
    const r = run(
      outcome(tx("deposit", "failed", { sent: DEP, accepted: 0n, refunded: DEP })),
      obs(),
    );
    expect(r).toMatchObject({
      state: "failed",
      reason: "nothing_applied",
      applied: { main: false },
    });
    expect(r.txHashes).toEqual([H(0)]);
    expect(r.observed?.healthAfter).toBeNull();
  });

  it("a failed receipt after partial acceptance is partial", () => {
    const o = outcome(
      tx("deposit", "partial", {
        sent: DEP,
        accepted: DEP / 2n,
        refunded: 0n,
        failureReceiptIds: ["x"],
      }),
    );
    expect(run(o, obs({ collateralInternal: DEP / 2n }))).toMatchObject({
      state: "partial",
      reason: "receipt_failed_after_accept",
    });
  });

  it("a failed deposit while the collateral rose by the full amount is unresolved, not failed", () => {
    const r = run(
      outcome(tx("deposit", "failed", { sent: DEP, accepted: 0n, refunded: DEP })),
      obs({ collateralInternal: DEP }),
    );
    expect(r).toMatchObject({ state: "unresolved", reason: "state_changed_without_success" });
  });

  it("a rise 10^12 times too small for the collateral scale is not confirmation", () => {
    const o = outcome(
      tx("deposit", "succeeded", {
        sent: 5n * 10n ** 11n,
        accepted: 5n * 10n ** 11n,
        refunded: 0n,
      }),
    );
    const r = reconcileOpening({
      plan: plan("wallet_collateral_deposit"),
      outcome: o,
      before: obs(),
      after: obs({ collateralInternal: 5n * 10n ** 11n }),
      scales: { collateral: 10n ** 12n, debt: 1n },
    });
    expect(r).toMatchObject({ state: "unresolved", reason: "collateral_not_observed" });
  });

  it("scales the accepted amount by the collateral token's extra decimals", () => {
    const o = outcome(
      tx("deposit", "succeeded", {
        sent: 5n * 10n ** 11n,
        accepted: 5n * 10n ** 11n,
        refunded: 0n,
      }),
    );
    const r = reconcileOpening({
      plan: plan("wallet_collateral_deposit"),
      outcome: o,
      before: obs(),
      after: obs({ collateralInternal: 5n * 10n ** 23n }),
      scales: { collateral: 10n ** 12n, debt: 1n },
    });
    expect(r.state).toBe("confirmed");
  });
});

describe("borrow stage", () => {
  const run = (
    o: OpeningOutcome | null,
    after: OpeningObservation | null,
    before = obs({ collateralInternal: DEP }),
  ) => reconcileOpening({ plan: plan("wallet_borrow"), outcome: o, before, after, scales });

  it("confirmed needs delivery evidence, a confirmed withdraw and a debt rise; health comes from the read", () => {
    const r = run(
      outcome(borrowOk()),
      obs({
        collateralInternal: DEP,
        debtInternal: BORROW + 1n,
        walletDebt: BORROW - 1n,
        healthBps: 14_250,
      }),
    );
    expect(r).toMatchObject({ state: "confirmed", reason: "applied", applied: { main: true } });
    expect(r.observed).toMatchObject({
      debtBefore: 0n,
      debtAfter: BORROW + 1n,
      walletDebtDelta: BORROW - 1n,
      healthAfter: 14_250,
    });
    expect(r.txHashes).toEqual([H(0)]);
  });

  it("evidence of success without an observed debt rise is unresolved", () => {
    const r = run(outcome(borrowOk()), obs({ collateralInternal: DEP, debtInternal: 0n }));
    expect(r).toMatchObject({ state: "unresolved", reason: "debt_not_observed" });
    expect(r.txHashes).toEqual([]);
  });

  it("debt that rose without delivery is partial and the debt stays", () => {
    const o = outcome(
      tx("borrow", "partial", { sent: BORROW, delivered: null, withdrawConfirmed: false }),
    );
    const r = run(
      o,
      obs({ collateralInternal: DEP, debtInternal: BORROW + 1n, healthBps: 20_000 }),
    );
    expect(r).toMatchObject({
      state: "partial",
      reason: "debt_without_delivery",
      applied: { main: true },
    });
    expect(r.observed).toMatchObject({ debtAfter: BORROW + 1n, healthAfter: 20_000 });
  });

  it("a wallet balance rise without delivery evidence is never confirmation", () => {
    const o = outcome(
      tx("borrow", "partial", { sent: BORROW, delivered: null, withdrawConfirmed: null }),
    );
    // Tokens appeared in the wallet (some other transfer), but no debt rose and there is no receipt.
    const r = run(o, obs({ collateralInternal: DEP, debtInternal: 0n, walletDebt: BORROW }));
    expect(r.state).toBe("unresolved");
    expect(r.observed?.walletDebtDelta).toBe(BORROW);
    // Even with debt up, missing delivery evidence keeps it partial, not confirmed.
    expect(
      run(o, obs({ collateralInternal: DEP, debtInternal: BORROW, walletDebt: BORROW })).state,
    ).toBe("partial");
  });

  it("a borrow marked succeeded without delivery or callback evidence is not confirmed (defence in depth)", () => {
    // The parser never produces this, but the reconciler must not trust its caller.
    const noDelivery = outcome(
      tx("borrow", "succeeded", { sent: BORROW, delivered: null, withdrawConfirmed: true }),
    );
    const noCallback = outcome(
      tx("borrow", "succeeded", { sent: BORROW, delivered: BORROW - 1n, withdrawConfirmed: null }),
    );
    for (const o of [noDelivery, noCallback]) {
      const r = run(o, obs({ collateralInternal: DEP, debtInternal: BORROW }));
      expect(r).toMatchObject({
        state: "unresolved",
        reason: "delivery_not_observed",
        txHashes: [],
      });
    }
  });

  it("a delivered borrow whose callback is unconfirmed is not confirmed", () => {
    const o = outcome(
      tx("borrow", "partial", { sent: BORROW, delivered: BORROW - 1n, withdrawConfirmed: false }),
    );
    expect(run(o, obs({ collateralInternal: DEP, debtInternal: BORROW })).state).toBe("partial");
  });

  it("a reverted borrow with no change is failed", () => {
    const r = run(
      outcome(tx("borrow", "failed", { sent: BORROW, failureReceiptIds: ["r"] })),
      obs({ collateralInternal: DEP }),
    );
    expect(r).toMatchObject({
      state: "failed",
      reason: "nothing_applied",
      applied: { main: false },
    });
    expect(r.txHashes).toEqual([H(0)]);
  });

  it("a failed delivery after the borrow landed is debt without delivery", () => {
    const r = run(
      outcome(tx("borrow", "failed", { sent: BORROW, failureReceiptIds: ["r"] })),
      obs({ collateralInternal: DEP, debtInternal: BORROW + 1n }),
    );
    expect(r).toMatchObject({ state: "partial", reason: "debt_without_delivery" });
  });

  it("an existing debt does not hide a missing rise: only the change counts", () => {
    const before = obs({ collateralInternal: DEP, debtInternal: 10n * BORROW });
    const flat = run(
      outcome(borrowOk()),
      obs({ collateralInternal: DEP, debtInternal: 10n * BORROW }),
      before,
    );
    expect(flat.state).toBe("unresolved");
    const up = run(
      outcome(borrowOk()),
      obs({ collateralInternal: DEP, debtInternal: 11n * BORROW }),
      before,
    );
    expect(up.state).toBe("confirmed");
  });
});

describe("registrations and fees", () => {
  const p = (stage: OpeningPlan["stage"]) => plan(stage, 3);
  it("registration landed but the main transaction failed: registration_only, applied false", () => {
    const o = outcome(
      tx("registration", "succeeded"),
      tx("deposit", "failed", { sent: DEP, accepted: 0n, refunded: DEP }),
    );
    const r = reconcileOpening({
      plan: p("wallet_collateral_deposit"),
      outcome: o,
      before: obs(),
      after: obs(),
      scales,
    });
    expect(r).toMatchObject({
      state: "partial",
      reason: "registration_only",
      applied: { registration: true, main: false },
    });
  });

  it("a fee that landed while the main transaction failed is fee_only", () => {
    const o = outcome(
      tx("borrow", "failed", { sent: BORROW, failureReceiptIds: ["r"] }),
      tx("fee", "succeeded"),
    );
    const r = reconcileOpening({
      plan: p("wallet_borrow"),
      outcome: o,
      before: obs({ collateralInternal: DEP }),
      after: obs({ collateralInternal: DEP }),
      scales,
    });
    expect(r).toMatchObject({
      state: "partial",
      reason: "fee_only",
      applied: { main: false, fee: true },
    });
  });

  it("an applied borrow followed by a failed fee is partial and the borrow stays applied", () => {
    const o = outcome(borrowOk(), tx("fee", "failed", { failureReceiptIds: ["f"] }));
    const r = reconcileOpening({
      plan: p("wallet_borrow"),
      outcome: o,
      before: obs({ collateralInternal: DEP }),
      after: obs({ collateralInternal: DEP, debtInternal: BORROW + 1n, healthBps: 20_000 }),
      scales,
    });
    expect(r).toMatchObject({
      state: "partial",
      reason: "fee_failed_after_applied",
      applied: { main: true, fee: false },
    });
    expect(r.observed?.healthAfter).toBe(20_000);
  });

  it("an applied stage with every fee and registration succeeded is confirmed", () => {
    const o = outcome(tx("registration", "succeeded"), depositOk(), tx("fee", "succeeded"));
    const r = reconcileOpening({
      plan: p("wallet_collateral_deposit"),
      outcome: o,
      before: obs(),
      after: obs({ collateralInternal: DEP }),
      scales,
    });
    expect(r).toMatchObject({
      state: "confirmed",
      applied: { registration: true, main: true, fee: true },
    });
  });
});

describe("nothing is confirmed before it is observed", () => {
  const dep = (o: OpeningOutcome | null, after: OpeningObservation | null) =>
    reconcileOpening({
      plan: plan("wallet_collateral_deposit"),
      outcome: o,
      before: obs(),
      after,
      scales,
    });

  it("pending receipts are submitted: no links, no health, nothing known applied", () => {
    const r = dep(
      outcome(tx("deposit", "pending", { sent: DEP, finalBlockHeight: null })),
      obs({ collateralInternal: DEP }),
    );
    expect(r).toMatchObject({
      state: "submitted",
      reason: "pending",
      txHashes: [],
      observed: null,
    });
    expect(r.applied).toEqual({ registration: null, main: null, fee: null });
  });

  it("no receipts at all are submitted", () => {
    expect(dep(null, obs())).toMatchObject({
      state: "submitted",
      reason: "evidence_unavailable",
      txHashes: [],
    });
  });

  it("terminal receipts without a post-state read are unresolved", () => {
    expect(dep(outcome(depositOk()), null)).toMatchObject({
      state: "unresolved",
      reason: "post_state_unavailable",
      txHashes: [],
      observed: null,
    });
  });

  it("a post-state read older than the final block is unresolved, even if it looks right", () => {
    const stale = obs({ blockHeight: 99, collateralInternal: DEP });
    expect(dep(outcome(depositOk()), stale)).toMatchObject({
      state: "unresolved",
      reason: "post_state_before_final",
    });
  });

  it("an outcome with no main transaction cannot be reconciled", () => {
    expect(dep(outcome(tx("registration", "succeeded")), obs())).toMatchObject({
      state: "unresolved",
    });
  });

  it("health and links appear only in confirmed, failed and partial results", () => {
    const cases: [OpeningOutcome | null, OpeningObservation | null][] = [
      [null, obs({ healthBps: 15_000 })],
      [outcome(depositOk()), null],
      [outcome(depositOk()), obs({ collateralInternal: 0n, healthBps: 15_000 })],
    ];
    for (const [o, a] of cases) {
      const r = dep(o, a);
      expect(["submitted", "unresolved"]).toContain(r.state);
      expect(r.txHashes).toEqual([]);
      expect(r.observed?.healthAfter ?? null).toBeNull();
    }
  });
});
