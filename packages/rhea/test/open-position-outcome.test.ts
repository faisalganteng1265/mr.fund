import { readFileSync } from "node:fs";
import { err, ok } from "@mrfund/shared";
import { describe, expect, it } from "vitest";
import {
  type OpeningExpectedTransaction,
  type OpeningOutcomeReader,
  type OpeningPlan,
  parseOpeningOutcome,
  parseOpeningTransaction,
  readOpeningOutcome,
  validateOpeningPlan,
} from "../src/open-position-outcome";
import type { OutcomeEvidence } from "../src/outcome-types";

// Real public testnet transactions of the demo user (Gate 1 cycle), recorded from the archival
// RPC: fixtures/rhea/opening-outcomes.json. Branches with no recording (partial refund, failed
// transfer, a false callback) are mutations of a real recording and are labelled "mutated".
// biome-ignore lint/suspicious/noExplicitAny: recorded RPC JSON is untyped and mutated field by field.
type Raw = any;
const fx = JSON.parse(
  readFileSync(new URL("../../../fixtures/rhea/opening-outcomes.json", import.meta.url), "utf8"),
) as {
  recordings: {
    name: string;
    expected: {
      hash: string;
      signerId: string;
      receiverId: string;
      methodName: string;
      argsJson: string;
      deposit: string;
    };
    evidence: { network: string; outcome: Raw; blocks: unknown[] };
  }[];
};
const ME = "d-mrf-b1ce96af6a.testnet";
const LENDING = "contract.1689937928.burrow.testnet";
const WRAP = "wrap.testnet";
const REF = "ref.fakes.testnet";
const USDC = "usdc.fakes.testnet";
const b64 = (s: string) => Buffer.from(s).toString("base64");

const rec = (name: string) => {
  const r = fx.recordings.find((x) => x.name === name);
  if (!r) throw new Error(`missing recording ${name}`);
  return structuredClone(r);
};
const tx = (
  r: ReturnType<typeof rec>,
  role: OpeningExpectedTransaction["role"],
): OpeningExpectedTransaction => ({
  hash: r.expected.hash,
  signerId: r.expected.signerId,
  receiverId: r.expected.receiverId,
  methodName: r.expected.methodName as OpeningExpectedTransaction["methodName"],
  argsJson: r.expected.argsJson,
  deposit: BigInt(r.expected.deposit),
  role,
});
const plan = (
  stage: OpeningPlan["stage"],
  transactions: OpeningExpectedTransaction[],
  over: Partial<OpeningPlan> = {},
): OpeningPlan => ({
  network: "testnet",
  accountId: ME,
  lendingId: LENDING,
  lendingVersion: "0.11.0",
  stage,
  collateralTokenId: WRAP,
  debtTokenId: REF,
  transactions,
  ...over,
});
const unwrap = <T>(r: { ok: true; value: T } | { ok: false; error: unknown }): T => {
  if (!r.ok) throw new Error(`expected ok: ${JSON.stringify(r.error)}`);
  return r.value;
};

/** The recorded exact-Withdraw failures re-encoded to the amountless form the builder emits. */
function amountless(r: ReturnType<typeof rec>, debtToken: string) {
  const o = r.evidence.outcome;
  const orig = JSON.parse(r.expected.argsJson) as {
    actions: [unknown, { Withdraw: { token_id: string } }];
  };
  const next = JSON.stringify({
    actions: [orig.actions[0], { Withdraw: { token_id: debtToken } }],
  });
  o.transaction.actions[0].FunctionCall.args = b64(next);
  for (const d of o.receipts)
    for (const a of d.receipt?.Action?.actions ?? [])
      if (a.FunctionCall?.method_name === "execute_with_pyth") a.FunctionCall.args = b64(next);
  r.expected.argsJson = next;
  return r;
}
/** Re-encode one method's arguments consistently in the transaction and its receipts. */
function rewriteArgs(r: ReturnType<typeof rec>, methodName: string, argsJson: string) {
  const o = r.evidence.outcome;
  o.transaction.actions[0].FunctionCall.args = b64(argsJson);
  for (const d of o.receipts)
    for (const a of d.receipt?.Action?.actions ?? [])
      if (a.FunctionCall?.method_name === methodName) a.FunctionCall.args = b64(argsJson);
  r.expected.argsJson = argsJson;
  return r;
}
const receiptOutcome = (r: ReturnType<typeof rec>, pred: (d: Raw, o: Raw) => boolean) => {
  const o = r.evidence.outcome;
  const found = o.receipts.find((d: Raw) => {
    const ro = o.receipts_outcome.find((x: Raw) => x.id === d.receipt_id);
    return pred(d, ro);
  });
  if (!found) throw new Error("receipt not found");
  const ro = o.receipts_outcome.find((x: Raw) => x.id === found.receipt_id);
  return { detail: found, outcome: ro };
};
const callOf = (d: Raw) => d.receipt.Action.actions[0].FunctionCall;
const method = (name: string) => (d: Raw) => callOf(d)?.method_name === name;

describe("recorded real transactions", () => {
  it("a deposit stage: registration then collateral deposit, accepted in full", () => {
    // The recorded registration used registration_only:false; re-encoded to the builder's shape.
    const reg = rewriteArgs(
      rec("registration-only"),
      "storage_deposit",
      JSON.stringify({ account_id: ME, registration_only: true }),
    );
    const dep = rec("deposit-applied");
    const p = plan("wallet_collateral_deposit", [tx(reg, "registration"), tx(dep, "deposit")]);
    const out = unwrap(parseOpeningOutcome([reg.evidence, dep.evidence], p));
    expect(out.execution).toBe("succeeded");
    const [r, d] = out.transactions;
    expect(r).toMatchObject({
      role: "registration",
      execution: "succeeded",
      failureReceiptIds: [],
    });
    expect(d).toMatchObject({
      role: "deposit",
      execution: "succeeded",
      sent: 500_000_000_000_000_000_000_000n,
      accepted: 500_000_000_000_000_000_000_000n,
      refunded: 0n,
      delivered: null,
    });
    expect(d?.finalBlockHeight).toBeGreaterThan(0);
  });

  it("a borrow: Borrow, delivery to the signer and a confirmed withdraw callback", () => {
    const b = rec("borrow-delivered");
    const p = plan("wallet_borrow", [tx(b, "borrow")]);
    const out = unwrap(parseOpeningOutcome([b.evidence], p));
    expect(out.execution).toBe("succeeded");
    expect(out.transactions[0]).toMatchObject({
      role: "borrow",
      execution: "succeeded",
      sent: 500_000_000_000_000_000n,
      delivered: 499_999_999_999_999_999n,
      withdrawConfirmed: true,
      failureReceiptIds: [],
      pendingReasons: [],
    });
  });

  it("a rejected borrow whose root succeeded: the failed callback receipt still makes it failed", () => {
    const b = amountless(rec("borrow-missing-price"), USDC);
    expect(b.evidence.outcome.status).toEqual({ SuccessValue: "" }); // the root looks successful
    const p = plan("wallet_borrow", [tx(b, "borrow")], { debtTokenId: USDC });
    const t = unwrap(parseOpeningTransaction(b.evidence, tx(b, "borrow"), p));
    expect(t.execution).toBe("failed");
    expect(t.failureReceiptIds.length).toBeGreaterThan(0);
    expect(t.delivered).toBeNull();
    expect(t.withdrawConfirmed).toBeNull();
  });

  it("a borrow that reverted on share rounding is failed (mutated args, real receipt tree)", () => {
    const b = amountless(rec("borrow-exact-withdraw-reverted"), REF);
    const t = unwrap(
      parseOpeningTransaction(
        b.evidence,
        tx(b, "borrow"),
        plan("wallet_borrow", [tx(b, "borrow")]),
      ),
    );
    expect(t.execution).toBe("failed");
    expect(t.failureReceiptIds.length).toBeGreaterThan(0);
  });

  it("the recorded full registration (registration_only false) is refused as a plan", () => {
    const reg = rec("registration-only");
    const dep = rec("deposit-applied");
    const p = plan("wallet_collateral_deposit", [tx(reg, "registration"), tx(dep, "deposit")]);
    expect(validateOpeningPlan(p)).toMatchObject({ ok: false, error: { kind: "invalid_plan" } });
  });

  it("the exact-Withdraw encoding is refused as a plan, not parsed as an outcome", () => {
    const b = rec("borrow-exact-withdraw-reverted");
    const r = parseOpeningTransaction(
      b.evidence,
      tx(b, "borrow"),
      plan("wallet_borrow", [tx(b, "borrow")]),
    );
    expect(r).toMatchObject({ ok: false, error: { kind: "invalid_plan" } });
  });
});

describe("branches built by mutating a real recording (mutated)", () => {
  const borrowPlan = () => {
    const b = rec("borrow-delivered");
    return { b, p: plan("wallet_borrow", [tx(b, "borrow")]) };
  };
  const parse = (b: ReturnType<typeof rec>, p: OpeningPlan) =>
    parseOpeningTransaction(b.evidence, tx(b, "borrow"), p);

  it("borrow: a failed delivery transfer is failed, with the receipt named", () => {
    const { b, p } = borrowPlan();
    const t = receiptOutcome(b, (d) => method("ft_transfer")(d)).outcome;
    t.outcome.status = { Failure: { ActionError: { index: 0, kind: "mutated" } } };
    const r = unwrap(parse(b, p));
    expect(r.execution).toBe("failed");
    expect(r.failureReceiptIds).toContain(t.id);
    expect(r.delivered).toBeNull();
  });

  it("borrow: a callback that returns false is partial, never succeeded", () => {
    const { b, p } = borrowPlan();
    const cb = receiptOutcome(b, (d) => method("after_ft_transfer")(d)).outcome;
    cb.outcome.status = { SuccessValue: b64("false") };
    const r = unwrap(parse(b, p));
    expect(r).toMatchObject({
      execution: "partial",
      withdrawConfirmed: false,
      delivered: 499_999_999_999_999_999n,
    });
  });

  it("borrow: no delivery receipt at all is partial", () => {
    const { b, p } = borrowPlan();
    const t = receiptOutcome(b, (d) => method("ft_transfer")(d));
    callOf(t.detail).args = b64(
      JSON.stringify({ receiver_id: "someone.testnet", amount: "1", memo: null }),
    );
    const r = unwrap(parse(b, p));
    expect(r).toMatchObject({ execution: "partial", delivered: null });
  });

  it("borrow: a missing callback receipt leaves the outcome pending, not confirmed", () => {
    const { b, p } = borrowPlan();
    const o = b.evidence.outcome;
    const cb = receiptOutcome(b, (d) => method("after_ft_transfer")(d));
    o.receipts = o.receipts.filter((d: Raw) => d.receipt_id !== cb.detail.receipt_id);
    o.receipts_outcome = o.receipts_outcome.filter((x: Raw) => x.id !== cb.detail.receipt_id);
    const r = unwrap(parse(b, p));
    expect(r.execution).toBe("pending");
    expect(r.pendingReasons.length).toBeGreaterThan(0);
  });

  it("borrow: transaction arguments that differ from the plan are refused even when every receipt agrees", () => {
    const { b, p } = borrowPlan();
    // Consistently re-encoded: the transaction and its receipts agree with each other, not the plan.
    rewriteArgs(
      b,
      "execute_with_pyth",
      JSON.stringify({
        actions: [{ Borrow: { token_id: REF, amount: "1" } }, { Withdraw: { token_id: REF } }],
      }),
    );
    b.expected.argsJson = tx(rec("borrow-delivered"), "borrow").argsJson;
    expect(parse(b, p)).toMatchObject({ ok: false, error: { kind: "identity_mismatch" } });
  });

  it("borrow: a second delivery transfer to the signer is refused, not summed", () => {
    const { b, p } = borrowPlan();
    const o = b.evidence.outcome;
    const t = receiptOutcome(b, (d) => method("ft_transfer")(d));
    const extra = "Ho5vUHPC5u53B3JUWfRSLwLbvjwsnzNSw4G3urqySGuC";
    o.receipts.push({ ...structuredClone(t.detail), receipt_id: extra });
    o.receipts_outcome.push({ ...structuredClone(t.outcome), id: extra });
    expect(parse(b, p).ok).toBe(false);
  });

  it.each([
    [
      "a delivery above the borrow",
      (b: ReturnType<typeof rec>) => {
        const t = receiptOutcome(b, (d) => method("ft_transfer")(d));
        callOf(t.detail).args = b64(
          JSON.stringify({ receiver_id: ME, amount: "500000000000000001", memo: null }),
        );
      },
    ],
    [
      "a delivery with another deposit",
      (b: ReturnType<typeof rec>) => {
        callOf(receiptOutcome(b, (d) => method("ft_transfer")(d)).detail).deposit = "2";
      },
    ],
    [
      "a callback for another account",
      (b: ReturnType<typeof rec>) => {
        const t = receiptOutcome(b, (d) => method("after_ft_transfer")(d));
        const a = JSON.parse(Buffer.from(callOf(t.detail).args, "base64").toString());
        a.account_id = "other.testnet";
        callOf(t.detail).args = b64(JSON.stringify(a));
      },
    ],
    [
      "a callback returning a non-boolean",
      (b: ReturnType<typeof rec>) => {
        receiptOutcome(b, (d) => method("after_ft_transfer")(d)).outcome.outcome.status = {
          SuccessValue: b64('"yes"'),
        };
      },
    ],
    [
      "an executor that differs from the receipt receiver",
      (b: ReturnType<typeof rec>) => {
        receiptOutcome(b, (d) => method("ft_transfer")(d)).detail.receiver_id = "other.testnet";
      },
    ],
  ])("borrow: refuses %s", (_name, mutate) => {
    const { b, p } = borrowPlan();
    mutate(b);
    expect(parse(b, p).ok).toBe(false);
  });

  const depositPlan = () => {
    const d = rec("deposit-applied");
    return { d, p: plan("wallet_collateral_deposit", [tx(d, "deposit")]) };
  };
  const setAccepted = (d: ReturnType<typeof rec>, value: string, finalToo = true) => {
    const resolver = receiptOutcome(d, (det) => method("ft_resolve_transfer")(det)).outcome;
    resolver.outcome.status = { SuccessValue: b64(JSON.stringify(value)) };
    if (finalToo) d.evidence.outcome.status = { SuccessValue: b64(JSON.stringify(value)) };
  };

  it("deposit: a partial refund is partial with the exact accepted and refunded amounts", () => {
    const { d, p } = depositPlan();
    setAccepted(d, "300000000000000000000000");
    const r = unwrap(parseOpeningTransaction(d.evidence, tx(d, "deposit"), p));
    expect(r).toMatchObject({
      execution: "partial",
      accepted: 3n * 10n ** 23n,
      refunded: 2n * 10n ** 23n,
    });
  });

  it("deposit: a full refund is failed, not confirmed", () => {
    const { d, p } = depositPlan();
    setAccepted(d, "0");
    const r = unwrap(parseOpeningTransaction(d.evidence, tx(d, "deposit"), p));
    expect(r).toMatchObject({ execution: "failed", accepted: 0n, refunded: 5n * 10n ** 23n });
  });

  it("deposit: a failed receipt after partial acceptance is partial", () => {
    const { d, p } = depositPlan();
    setAccepted(d, "300000000000000000000000");
    const last = d.evidence.outcome.receipts_outcome.at(-1);
    last.outcome.status = { Failure: { ActionError: { index: 0, kind: "mutated" } } };
    const r = unwrap(parseOpeningTransaction(d.evidence, tx(d, "deposit"), p));
    expect(r.execution).toBe("partial");
    expect(r.failureReceiptIds.length).toBeGreaterThan(0);
  });

  it.each([
    [
      "a resolver that accepted more than was sent (final return agrees)",
      (d: ReturnType<typeof rec>) => setAccepted(d, "500000000000000000000001", true),
    ],
    [
      "a final return that differs from the resolver",
      (d: ReturnType<typeof rec>) => setAccepted(d, "300000000000000000000000", false),
    ],
    [
      "a receiver call with another sender",
      (d: ReturnType<typeof rec>) => {
        const t = receiptOutcome(d, (det) => method("ft_on_transfer")(det));
        const a = JSON.parse(Buffer.from(callOf(t.detail).args, "base64").toString());
        a.sender_id = "other.testnet";
        callOf(t.detail).args = b64(JSON.stringify(a));
      },
    ],
    [
      "a receiver call with another message",
      (d: ReturnType<typeof rec>) => {
        const t = receiptOutcome(d, (det) => method("ft_on_transfer")(det));
        const a = JSON.parse(Buffer.from(callOf(t.detail).args, "base64").toString());
        a.msg = "{}";
        callOf(t.detail).args = b64(JSON.stringify(a));
      },
    ],
    [
      "a resolver with another amount",
      (d: ReturnType<typeof rec>) => {
        const t = receiptOutcome(d, (det) => method("ft_resolve_transfer")(det));
        const a = JSON.parse(Buffer.from(callOf(t.detail).args, "base64").toString());
        a.amount = "1";
        callOf(t.detail).args = b64(JSON.stringify(a));
      },
    ],
  ])("deposit: refuses %s", (_name, mutate) => {
    const { d, p } = depositPlan();
    mutate(d);
    expect(parseOpeningTransaction(d.evidence, tx(d, "deposit"), p).ok).toBe(false);
  });
});

describe("evidence the parser refuses or leaves pending", () => {
  const b0 = () => {
    const b = rec("borrow-delivered");
    return { b, p: plan("wallet_borrow", [tx(b, "borrow")]) };
  };
  it("null evidence is pending, never success", () => {
    const { b, p } = b0();
    const r = unwrap(parseOpeningTransaction(null, tx(b, "borrow"), p));
    expect(r).toMatchObject({ execution: "pending", pendingReasons: ["transaction_unavailable"] });
  });
  it("a transaction that is not FINAL is pending", () => {
    const { b, p } = b0();
    b.evidence.outcome.final_execution_status = "INCLUDED";
    const r = unwrap(parseOpeningTransaction(b.evidence, tx(b, "borrow"), p));
    expect(r.execution).toBe("pending");
    expect(r.pendingReasons).toContain("not_final");
  });
  it("a transaction that is not included yet is pending", () => {
    const { b, p } = b0();
    const r = unwrap(
      parseOpeningTransaction(
        { network: "testnet", outcome: { final_execution_status: "NONE" }, blocks: [] },
        tx(b, "borrow"),
        p,
      ),
    );
    expect(r.pendingReasons).toEqual(["not_included"]);
  });
  it.each([
    [
      "another network",
      (b: ReturnType<typeof rec>) => {
        b.evidence.network = "mainnet";
      },
    ],
    [
      "another transaction hash",
      (b: ReturnType<typeof rec>) => {
        b.evidence.outcome.transaction.hash = "Ho5vUHPC5u53B3JUWfRSLwLbvjwsnzNSw4G3urqySGuC";
      },
    ],
    [
      "another signer",
      (b: ReturnType<typeof rec>) => {
        b.evidence.outcome.transaction.signer_id = "other.testnet";
      },
    ],
    [
      "another receiver",
      (b: ReturnType<typeof rec>) => {
        b.evidence.outcome.transaction.receiver_id = "other.testnet";
      },
    ],
    [
      "a different deposit",
      (b: ReturnType<typeof rec>) => {
        b.evidence.outcome.transaction.actions[0].FunctionCall.deposit = "2";
      },
    ],
    [
      "different arguments",
      (b: ReturnType<typeof rec>) => {
        b.evidence.outcome.transaction.actions[0].FunctionCall.args = b64("{}");
      },
    ],
    [
      "a duplicate receipt outcome",
      (b: ReturnType<typeof rec>) => {
        b.evidence.outcome.receipts_outcome.push(
          structuredClone(b.evidence.outcome.receipts_outcome[0]),
        );
      },
    ],
    [
      "a malformed block header",
      (b: ReturnType<typeof rec>) => {
        (b.evidence.blocks[0] as { height: unknown }).height = -1;
      },
    ],
  ])("refuses %s", (_name, mutate) => {
    const { b, p } = b0();
    mutate(b);
    expect(parseOpeningTransaction(b.evidence, tx(b, "borrow"), p).ok).toBe(false);
  });
  it("a transaction that is not in the plan is refused", () => {
    const { b, p } = b0();
    const stray = { ...tx(b, "borrow"), hash: "Ho5vUHPC5u53B3JUWfRSLwLbvjwsnzNSw4G3urqySGuC" };
    expect(parseOpeningTransaction(b.evidence, stray, p)).toMatchObject({
      ok: false,
      error: { kind: "invalid_plan" },
    });
  });
});

/** A fee transfer shaped from the recorded registration (mutated): one token receipt tree. */
function feeEvidence(failed: boolean) {
  const r = rec("registration-only");
  const args = JSON.stringify({ receiver_id: "fees.testnet", amount: "10000" });
  const o = r.evidence.outcome;
  o.transaction.receiver_id = USDC;
  const fc = o.transaction.actions[0].FunctionCall;
  fc.method_name = "ft_transfer";
  fc.args = b64(args);
  fc.deposit = "1";
  for (const d of o.receipts) {
    if (d.receiver_id === LENDING) d.receiver_id = USDC;
    for (const a of d.receipt?.Action?.actions ?? [])
      if (a.FunctionCall?.method_name === "storage_deposit") {
        a.FunctionCall.method_name = "ft_transfer";
        a.FunctionCall.args = b64(args);
        a.FunctionCall.deposit = "1";
      }
  }
  for (const ro of o.receipts_outcome)
    if (ro.outcome.executor_id === LENDING) ro.outcome.executor_id = USDC;
  if (failed) {
    const first = o.receipts_outcome.find((x: Raw) => x.outcome.executor_id === USDC);
    first.outcome.status = { Failure: { ActionError: { index: 0, kind: "mutated" } } };
  }
  const expected: OpeningExpectedTransaction = {
    hash: r.expected.hash,
    signerId: ME,
    receiverId: USDC,
    methodName: "ft_transfer",
    argsJson: args,
    deposit: 1n,
    role: "fee",
  };
  return { evidence: r.evidence, expected };
}

describe("fee outcomes (mutated from a recorded registration)", () => {
  it("an applied borrow followed by a failed fee is partial and keeps the borrow succeeded", () => {
    const b = rec("borrow-delivered");
    const fee = feeEvidence(true);
    const p = plan("wallet_borrow", [tx(b, "borrow"), fee.expected]);
    const out = unwrap(parseOpeningOutcome([b.evidence, fee.evidence], p));
    expect(out.transactions.map((t) => [t.role, t.execution])).toEqual([
      ["borrow", "succeeded"],
      ["fee", "failed"],
    ]);
    expect(out.execution).toBe("partial");
  });

  it("a fee that succeeded while the borrow failed is partial, so the lost fee is visible", () => {
    const b = amountless(rec("borrow-missing-price"), USDC);
    const fee = feeEvidence(false);
    const p = plan("wallet_borrow", [tx(b, "borrow"), fee.expected], { debtTokenId: USDC });
    const out = unwrap(parseOpeningOutcome([b.evidence, fee.evidence], p));
    expect(out.transactions.map((t) => [t.role, t.execution])).toEqual([
      ["borrow", "failed"],
      ["fee", "succeeded"],
    ]);
    expect(out.execution).toBe("partial");
  });

  it("a borrow and its fee both succeeding is succeeded", () => {
    const b = rec("borrow-delivered");
    const fee = feeEvidence(false);
    const p = plan("wallet_borrow", [tx(b, "borrow"), fee.expected]);
    expect(unwrap(parseOpeningOutcome([b.evidence, fee.evidence], p)).execution).toBe("succeeded");
  });
});

describe("rollup across a stage's transactions", () => {
  it("a registration that landed before a failed main transaction is partial, not failed", () => {
    const reg = rec("registration-only");
    const b = amountless(rec("borrow-missing-price"), USDC);
    // A borrow-stage plan: registration on the debt token then the (failed) borrow.
    const regTx = {
      ...tx(reg, "registration"),
      receiverId: USDC,
      argsJson: JSON.stringify({ account_id: ME, registration_only: true }),
    };
    const p = plan("wallet_borrow", [regTx, tx(b, "borrow")], { debtTokenId: USDC });
    // The registration evidence still names the lending contract, so it is refused; use a
    // matching mutated receiver to model "registration succeeded".
    reg.evidence.outcome.transaction.receiver_id = USDC;
    reg.evidence.outcome.transaction.actions[0].FunctionCall.args = b64(regTx.argsJson);
    for (const d of reg.evidence.outcome.receipts) {
      d.receiver_id = d.receiver_id === LENDING ? USDC : d.receiver_id;
      for (const a of d.receipt?.Action?.actions ?? [])
        if (a.FunctionCall?.method_name === "storage_deposit")
          a.FunctionCall.args = b64(regTx.argsJson);
    }
    for (const ro of reg.evidence.outcome.receipts_outcome)
      if (ro.outcome.executor_id === LENDING) ro.outcome.executor_id = USDC;
    const out = unwrap(parseOpeningOutcome([reg.evidence, b.evidence], p));
    expect(out.transactions.map((t) => t.execution)).toEqual(["succeeded", "failed"]);
    expect(out.execution).toBe("partial");
  });

  it("pending anywhere makes the whole outcome pending", () => {
    const b = rec("borrow-delivered");
    const p = plan("wallet_borrow", [tx(b, "borrow")]);
    expect(unwrap(parseOpeningOutcome([], p)).execution).toBe("pending");
  });

  it("every transaction failed is failed", () => {
    const b = amountless(rec("borrow-missing-price"), USDC);
    const p = plan("wallet_borrow", [tx(b, "borrow")], { debtTokenId: USDC });
    expect(unwrap(parseOpeningOutcome([b.evidence], p)).execution).toBe("failed");
  });

  it("more outcomes than planned transactions is refused", () => {
    const b = rec("borrow-delivered");
    const p = plan("wallet_borrow", [tx(b, "borrow")]);
    expect(parseOpeningOutcome([b.evidence, b.evidence], p).ok).toBe(false);
  });
});

describe("validateOpeningPlan", () => {
  const b = () => rec("borrow-delivered");
  const base = () => plan("wallet_borrow", [tx(b(), "borrow")]);
  it("accepts the recorded borrow and deposit plans", () => {
    expect(validateOpeningPlan(base()).ok).toBe(true);
    const d = rec("deposit-applied");
    expect(validateOpeningPlan(plan("wallet_collateral_deposit", [tx(d, "deposit")])).ok).toBe(
      true,
    );
  });
  it.each([
    ["a stage without its main transaction", () => plan("wallet_borrow", [])],
    [
      "two borrows",
      () => {
        const t = tx(b(), "borrow");
        return plan("wallet_borrow", [
          t,
          { ...t, hash: "Ho5vUHPC5u53B3JUWfRSLwLbvjwsnzNSw4G3urqySGuC" },
        ]);
      },
    ],
    [
      "a duplicate hash",
      () => {
        const t = tx(b(), "borrow");
        return plan("wallet_borrow", [t, t]);
      },
    ],
    [
      "the wrong stage for the main role",
      () => plan("wallet_collateral_deposit", [tx(b(), "borrow")]),
    ],
    [
      "another signer",
      () => plan("wallet_borrow", [{ ...tx(b(), "borrow"), signerId: "x.testnet" }]),
    ],
    [
      "an unverified version",
      () => plan("wallet_borrow", [tx(b(), "borrow")], { lendingVersion: "0.16.2" as never }),
    ],
    [
      "another network",
      () => plan("wallet_borrow", [tx(b(), "borrow")], { network: "devnet" as never }),
    ],
    [
      "a borrow of another token",
      () => plan("wallet_borrow", [tx(b(), "borrow")], { debtTokenId: USDC }),
    ],
    [
      "a borrow to another contract",
      () => plan("wallet_borrow", [{ ...tx(b(), "borrow"), receiverId: "evil.testnet" }]),
    ],
    [
      "a Withdraw that carries an amount",
      () =>
        plan("wallet_borrow", [
          {
            ...tx(b(), "borrow"),
            argsJson: JSON.stringify({
              actions: [
                { Borrow: { token_id: REF, amount: "1" } },
                { Withdraw: { token_id: REF, amount: "1" } },
              ],
            }),
          },
        ]),
    ],
    [
      "a Withdraw with max_amount",
      () =>
        plan("wallet_borrow", [
          {
            ...tx(b(), "borrow"),
            argsJson: JSON.stringify({
              actions: [
                { Borrow: { token_id: REF, amount: "1" } },
                { Withdraw: { token_id: REF, max_amount: "1" } },
              ],
            }),
          },
        ]),
    ],
    [
      "a zero borrow",
      () =>
        plan("wallet_borrow", [
          {
            ...tx(b(), "borrow"),
            argsJson: JSON.stringify({
              actions: [
                { Borrow: { token_id: REF, amount: "0" } },
                { Withdraw: { token_id: REF } },
              ],
            }),
          },
        ]),
    ],
    [
      "a deposit with another message",
      () => {
        const d = rec("deposit-applied");
        return plan("wallet_collateral_deposit", [
          {
            ...tx(d, "deposit"),
            argsJson: JSON.stringify({ receiver_id: LENDING, amount: "1", msg: "{}" }),
          },
        ]);
      },
    ],
    [
      "a fee before the main transaction",
      () => {
        const t = tx(b(), "borrow");
        const fee: OpeningExpectedTransaction = {
          hash: "Ho5vUHPC5u53B3JUWfRSLwLbvjwsnzNSw4G3urqySGuC",
          signerId: ME,
          receiverId: USDC,
          methodName: "ft_transfer",
          argsJson: JSON.stringify({ receiver_id: "fees.testnet", amount: "1" }),
          deposit: 1n,
          role: "fee",
        };
        return plan("wallet_borrow", [fee, t]);
      },
    ],
  ])("refuses %s", (_name, build) => {
    expect(validateOpeningPlan(build())).toMatchObject({
      ok: false,
      error: { kind: "invalid_plan" },
    });
  });
});

describe("readOpeningOutcome", () => {
  const signal = new AbortController().signal;
  const readerOf = (
    answer: (hash: string) => ReturnType<OpeningOutcomeReader["read"]>,
  ): OpeningOutcomeReader => ({ read: async (e) => answer(e.hash) });
  const borrow = () => {
    const b = rec("borrow-delivered");
    return { b, p: plan("wallet_borrow", [tx(b, "borrow")]) };
  };

  it("reads each planned transaction by hash and signer and parses the evidence", async () => {
    const { b, p } = borrow();
    const seen: string[] = [];
    const reader = readerOf(async (hash) => {
      seen.push(hash);
      return ok(b.evidence as OutcomeEvidence);
    });
    const r = unwrap(await readOpeningOutcome(p, reader, signal));
    expect(seen).toEqual([b.expected.hash]);
    expect(r.execution).toBe("succeeded");
  });

  it("an unavailable RPC leaves the outcome pending, never failed or succeeded", async () => {
    const { p } = borrow();
    const reader = readerOf(async () => err({ kind: "rpc_unavailable", detail: "down" }));
    const r = unwrap(await readOpeningOutcome(p, reader, signal));
    expect(r.execution).toBe("pending");
    expect(r.transactions[0]?.pendingReasons).toEqual(["transaction_unavailable"]);
  });

  it.each(["identity_mismatch", "bad_response", "limit_exceeded"] as const)(
    "a %s read is an error",
    async (kind) => {
      const { p } = borrow();
      const reader = readerOf(async () => err({ kind, detail: "x" }));
      expect(await readOpeningOutcome(p, reader, signal)).toMatchObject({
        ok: false,
        error: { kind },
      });
    },
  );

  it("an invalid plan is refused before any read", async () => {
    const { b } = borrow();
    let reads = 0;
    const reader = readerOf(async () => {
      reads++;
      return ok(b.evidence as OutcomeEvidence);
    });
    const bad = plan("wallet_borrow", [], {});
    expect((await readOpeningOutcome(bad, reader, signal)).ok).toBe(false);
    expect(reads).toBe(0);
  });
});
