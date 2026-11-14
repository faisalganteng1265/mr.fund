import { describe, expect, it } from "vitest";
import { parseTransactionOutcome, type RepayPlan } from "../src/outcome";
import { recorded } from "./outcome-fixtures";

const hash = (c: string) => c.repeat(44);
const at = <T>(items: T[], index: number): T => {
  const value = items[index];
  if (value === undefined) throw new Error("Missing test receipt");
  return value;
};
const expected = {
  hash: hash("A"),
  signerId: "alice.testnet",
  receiverId: "usdc.testnet",
  methodName: "ft_transfer_call" as const,
  argsJson: JSON.stringify({ receiver_id: "lending.testnet", amount: "10", msg: '"OnlyRepay"' }),
  deposit: 1n,
  role: "repay" as const,
};
const plan: RepayPlan = {
  network: "testnet",
  accountId: "alice.testnet",
  lendingId: "lending.testnet",
  tokenId: "usdc.testnet",
  lendingVersion: "0.16.2",
  transactions: [expected],
};

function sample() {
  const block = hash("B"),
    root = hash("C"),
    receiver = hash("D"),
    resolver = hash("E");
  const outcome = (id: string, executor_id: string, receipt_ids: string[], status: unknown) => ({
    id,
    block_hash: block,
    outcome: { executor_id, receipt_ids, status, logs: [] },
  });
  const receipt = (
    receipt_id: string,
    predecessor_id: string,
    receiver_id: string,
    method_name: string,
    args: unknown,
  ) => ({
    receipt_id,
    predecessor_id,
    receiver_id,
    receipt: {
      Action: {
        actions: [
          {
            FunctionCall: {
              method_name,
              args: btoa(JSON.stringify(args)),
              deposit: method_name === "ft_transfer_call" ? "1" : "0",
              gas: "10000000000000",
            },
          },
        ],
      },
    },
  });
  return {
    network: "testnet",
    blocks: [{ hash: block, height: 42 }],
    outcome: {
      final_execution_status: "FINAL",
      status: { SuccessValue: btoa('"10"') },
      transaction: {
        hash: expected.hash,
        signer_id: expected.signerId,
        receiver_id: expected.receiverId,
        actions: [
          {
            FunctionCall: {
              method_name: expected.methodName,
              args: btoa(expected.argsJson),
              deposit: "1",
              gas: "100000000000000",
            },
          },
        ],
      },
      transaction_outcome: outcome(expected.hash, expected.signerId, [root], {
        SuccessReceiptId: root,
      }),
      receipts_outcome: [
        outcome(root, expected.receiverId, [receiver, resolver], { SuccessReceiptId: resolver }),
        outcome(receiver, plan.lendingId, [], { SuccessValue: btoa('"0"') }),
        outcome(resolver, plan.tokenId, [], { SuccessValue: btoa('"10"') }),
      ],
      receipts: [
        receipt(
          root,
          expected.signerId,
          plan.tokenId,
          "ft_transfer_call",
          JSON.parse(expected.argsJson),
        ),
        receipt(receiver, plan.tokenId, plan.lendingId, "ft_on_transfer", {
          sender_id: plan.accountId,
          amount: "10",
          msg: '"OnlyRepay"',
        }),
        receipt(resolver, plan.tokenId, plan.tokenId, "ft_resolve_transfer", {
          sender_id: plan.accountId,
          receiver_id: plan.lendingId,
          amount: "10",
        }),
      ],
    },
  };
}
const unwrap = <T>(r: { ok: true; value: T } | { ok: false; error: unknown }): T => {
  if (!r.ok) throw new Error(JSON.stringify(r.error));
  return r.value;
};

describe("complete attributable outcomes", () => {
  it("reads token acceptance from the matching reachable resolver", () => {
    const r = unwrap(parseTransactionOutcome(sample(), expected, plan));
    expect(r.execution).toBe("succeeded");
    expect(r.accepted).toBe(10n);
    expect(r.refunded).toBe(0n);
  });
  it("keeps missing receipts and optimistic finality pending", () => {
    const a = sample();
    a.outcome.receipts_outcome.pop();
    expect(unwrap(parseTransactionOutcome(a, expected, plan)).execution).toBe("pending");
    const b = sample();
    b.outcome.final_execution_status = "EXECUTED_OPTIMISTIC";
    expect(unwrap(parseTransactionOutcome(b, expected, plan)).execution).toBe("pending");
  });
  it("keeps absent status and an absent outcome collection unresolved", () => {
    const a = sample();
    delete (a.outcome as Record<string, unknown>).status;
    expect(unwrap(parseTransactionOutcome(a, expected, plan)).execution).toBe("pending");
    const b = sample();
    delete (b.outcome as Record<string, unknown>).receipts_outcome;
    expect(unwrap(parseTransactionOutcome(b, expected, plan)).execution).toBe("pending");
  });
  it("refuses another transaction or an altered unsigned plan", () => {
    const a = sample();
    a.outcome.transaction.hash = hash("F");
    expect(parseTransactionOutcome(a, expected, plan).ok).toBe(false);
    const b = sample();
    at(b.outcome.transaction.actions, 0).FunctionCall.deposit = "2";
    expect(parseTransactionOutcome(b, expected, plan).ok).toBe(false);
  });
  it("does not count a resolver from an unrelated receipt", () => {
    const a = sample();
    at(a.outcome.receipts, 2).predecessor_id = "other.testnet";
    const r = unwrap(parseTransactionOutcome(a, expected, plan));
    expect(r.execution).toBe("pending");
    expect(r.accepted).toBeNull();
  });
  it("requires receiver-call evidence rather than an unrelated successful resolver", () => {
    const a = sample();
    a.outcome.receipts.splice(1, 1);
    expect(unwrap(parseTransactionOutcome(a, expected, plan)).execution).toBe("pending");
    const b = sample();
    at(at(b.outcome.receipts, 1).receipt.Action.actions, 0).FunctionCall.args = btoa(
      JSON.stringify({ sender_id: "other.testnet", amount: "10", msg: '"OnlyRepay"' }),
    );
    expect(parseTransactionOutcome(b, expected, plan).ok).toBe(false);
  });
  it("refuses a reachable receipt whose executor contradicts its payload", () => {
    const a = sample();
    at(a.outcome.receipts_outcome, 1).outcome.executor_id = "other.testnet";
    expect(parseTransactionOutcome(a, expected, plan).ok).toBe(false);
  });
  it.each(['"-1"', '"01"', '"340282366920938463463374607431768211456"', "10"])(
    "refuses malformed resolver amount %s",
    (value) => {
      const a = sample();
      at(a.outcome.receipts_outcome, 2).outcome.status = { SuccessValue: btoa(value) };
      expect(parseTransactionOutcome(a, expected, plan).ok).toBe(false);
    },
  );
  it("bounds receipt graphs and rejects cycles rather than walking forever", () => {
    const a = sample();
    at(a.outcome.receipts_outcome, 2).outcome.receipt_ids.push(hash("C"));
    expect(parseTransactionOutcome(a, expected, plan).ok).toBe(false);
    const b = sample();
    b.outcome.receipts_outcome = Array.from({ length: 513 }, () =>
      at(b.outcome.receipts_outcome, 0),
    );
    expect(parseTransactionOutcome(b, expected, plan).ok).toBe(false);
  });
  it("rejects malformed base64, duplicate receipt ids and impossible used amounts", () => {
    const a = sample();
    at(a.outcome.transaction.actions, 0).FunctionCall.args = "%%%";
    expect(parseTransactionOutcome(a, expected, plan).ok).toBe(false);
    const b = sample();
    b.outcome.receipts_outcome.push(at(b.outcome.receipts_outcome, 0));
    expect(parseTransactionOutcome(b, expected, plan).ok).toBe(false);
    const c = sample();
    at(c.outcome.receipts_outcome, 2).outcome.status = { SuccessValue: btoa('"11"') };
    expect(parseTransactionOutcome(c, expected, plan).ok).toBe(false);
  });
});

for (const network of ["testnet", "mainnet"]) {
  it.each([
    ["repay-success", "succeeded", 1_000_000n, 0n],
    ["repay-surplus", "succeeded", 9_000_001n, 0n],
    ["full-refund", "failed", 0n, 2n],
    ["partial-refund-fixture-receiver", "partial", 2n, 2n],
    ["detached-failure", "failed", 0n, 9_000_001n],
    ["fee-failure", "failed", null, null],
  ] as const)(`${network} recorded %s`, (name, execution, accepted, refunded) => {
    const r = recorded(network, name);
    const output = unwrap(parseTransactionOutcome(r.evidence, r.expected, r.plan));
    expect(output.execution).toBe(execution);
    expect(output.accepted).toBe(accepted);
    expect(output.refunded).toBe(refunded);
    if (execution === "failed") expect(output.failureReceiptIds.length).toBeGreaterThan(0);
  });
}
