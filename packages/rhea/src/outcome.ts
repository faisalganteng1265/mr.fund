import { err, ok, type Result } from "@mrfund/shared";
import {
  account,
  fail,
  functionCall,
  hash,
  InvalidOutcome,
  json,
  list,
  type Node,
  node,
  OUTCOME_LIMITS,
  outcomeAmount,
  outcomeRecord,
  status,
  str,
  U128_MAX,
} from "./outcome-core";
import type {
  ExpectedTransaction,
  OutcomeError,
  RepayOutcome,
  RepayPlan,
  TransactionOutcome,
} from "./outcome-types";

export { OUTCOME_LIMITS } from "./outcome-core";
export * from "./outcome-types";

/** Trusted plan validation catches caller mistakes without deriving authority from RPC data. */
export function validateRepayPlan(plan: RepayPlan): Result<true, OutcomeError> {
  try {
    if (
      !plan ||
      !["testnet", "mainnet"].includes(plan.network) ||
      !["0.11.0", "0.16.2"].includes(plan.lendingVersion)
    )
      fail("Unsupported plan network/version");
    for (const id of [plan.accountId, plan.lendingId, plan.tokenId]) account(id);
    const txs = list(plan.transactions, OUTCOME_LIMITS.transactions) as ExpectedTransaction[];
    if (!txs.length || txs.filter((t) => t.role === "repay").length !== 1)
      fail("Expected exactly one repay");
    const seen = new Set<string>();
    let repaySeen = false;
    for (const t of txs) {
      hash(t.hash);
      if (seen.has(t.hash)) fail("Duplicate planned transaction");
      seen.add(t.hash);
      if (t.signerId !== plan.accountId) fail("Plan signer differs from position owner");
      account(t.receiverId);
      const args = outcomeRecord(json(str(t.argsJson)));
      if (typeof t.deposit !== "bigint" || t.deposit <= 0n || t.deposit > U128_MAX)
        fail("Invalid deposit");
      if (t.role === "registration") {
        if (t.methodName !== "storage_deposit" || args.registration_only !== true)
          fail("Invalid registration");
        account(args.account_id);
      } else {
        if (t.deposit !== 1n || outcomeAmount(args.amount) === 0n)
          fail("Invalid transfer amount/deposit");
        account(args.receiver_id);
        if (t.role === "repay") {
          if (
            t.methodName !== "ft_transfer_call" ||
            t.receiverId !== plan.tokenId ||
            args.receiver_id !== plan.lendingId ||
            !str(args.msg)
          )
            fail("Invalid repay target");
          repaySeen = true;
        } else if (t.role !== "fee" || t.methodName !== "ft_transfer" || !repaySeen)
          fail("Invalid fee order/method");
      }
    }
    return ok(true);
  } catch {
    return err({ kind: "invalid_plan", detail: "Invalid trusted transaction plan" });
  }
}
/** Read-only pure parser. null evidence means an unavailable transaction, never a retry instruction. */
export function parseTransactionOutcome(
  input: unknown,
  expected: ExpectedTransaction,
  plan: RepayPlan,
): Result<TransactionOutcome, OutcomeError> {
  const valid = validateRepayPlan(plan);
  if (!valid.ok) return valid;
  try {
    if (
      !plan.transactions.some(
        (t) =>
          t === expected ||
          (t.hash === expected.hash &&
            t.argsJson === expected.argsJson &&
            t.role === expected.role &&
            t.receiverId === expected.receiverId &&
            t.signerId === expected.signerId &&
            t.deposit === expected.deposit &&
            t.methodName === expected.methodName),
      )
    )
      fail("Transaction absent from plan", "invalid_plan");
    const args = outcomeRecord(json(expected.argsJson));
    const sent = expected.role === "registration" ? null : outcomeAmount(args.amount);
    const result: TransactionOutcome = {
      hash: expected.hash,
      role: expected.role,
      execution: "pending",
      sent,
      accepted: null,
      refunded: null,
      failureReceiptIds: [],
      pendingReasons: [],
      finalBlockHeight: null,
      transactionBlockHeight: null,
    };
    if (input === null) {
      result.pendingReasons.push("transaction_unavailable");
      return ok(result);
    }
    const evidence = outcomeRecord(input);
    if (evidence.network !== plan.network) fail("Network differs from plan", "identity_mismatch");
    const raw = outcomeRecord(evidence.outcome);
    if (!raw.transaction && raw.final_execution_status === "NONE") {
      result.pendingReasons.push("not_included");
      return ok(result);
    }
    const tx = outcomeRecord(raw.transaction),
      actual = functionCall(tx.actions);
    if (
      tx.hash !== expected.hash ||
      tx.signer_id !== expected.signerId ||
      tx.receiver_id !== expected.receiverId ||
      actual.method !== expected.methodName ||
      actual.argsJson !== expected.argsJson ||
      actual.deposit !== expected.deposit
    )
      fail("Transaction differs from unsigned plan", "identity_mismatch");
    const root = node(raw.transaction_outcome);
    if (root.id !== expected.hash || root.executor !== expected.signerId)
      fail("Invalid transaction outcome identity", "identity_mismatch");
    const nodes = new Map<string, Node>([[root.id, root]]);
    for (const v of list(raw.receipts_outcome ?? [])) {
      const n = node(v);
      if (nodes.has(n.id)) fail("Duplicate receipt outcome");
      nodes.set(n.id, n);
    }
    const receipts = new Map<string, Record<string, unknown>>();
    for (const v of list(raw.receipts ?? [])) {
      const r = outcomeRecord(v),
        id = hash(r.receipt_id);
      if (receipts.has(id)) fail("Duplicate receipt details");
      receipts.set(id, r);
    }
    const blocks = new Map<string, number>();
    for (const v of list(evidence.blocks)) {
      const b = outcomeRecord(v),
        id = hash(b.hash);
      if (blocks.has(id) || !Number.isSafeInteger(b.height) || (b.height as number) < 0)
        fail("Invalid or duplicate block header");
      blocks.set(id, b.height as number);
    }
    const seen = new Set<string>(),
      active = new Set<string>();
    let height = 0;
    const visit = (id: string, depth: number) => {
      if (depth > OUTCOME_LIMITS.depth) fail("Receipt depth limit exceeded", "limit_exceeded");
      if (active.has(id)) fail("Receipt graph cycle");
      if (seen.has(id)) return;
      const n = nodes.get(id);
      if (!n) {
        result.pendingReasons.push("missing_receipt");
        return;
      }
      seen.add(id);
      active.add(id);
      if (id !== root.id) {
        const detail = receipts.get(id);
        if (!detail) result.pendingReasons.push("missing_receipt_details");
        else {
          if (account(detail.receiver_id) !== n.executor)
            fail("Receipt executor differs from payload", "identity_mismatch");
          account(detail.predecessor_id);
        }
      }
      const h = blocks.get(n.block);
      if (h === undefined) result.pendingReasons.push("missing_block");
      else height = Math.max(height, h);
      if (n.status.kind === "unknown") result.pendingReasons.push("unknown_receipt_status");
      if (n.status.kind === "failure") result.failureReceiptIds.push(id);
      for (const child of n.children) visit(child, depth + 1);
      active.delete(id);
    };
    visit(root.id, 0);
    result.transactionBlockHeight = blocks.get(root.block) ?? null;
    const finalStatus = status(raw.status);
    if (
      raw.final_execution_status !== "FINAL" ||
      finalStatus.kind === "unknown" ||
      finalStatus.kind === "receipt"
    )
      result.pendingReasons.push("not_final");
    if (finalStatus.kind === "failure" && !result.failureReceiptIds.length)
      result.failureReceiptIds.push(root.id);
    const initial = root.children
      .map((id) => receipts.get(id))
      .find(
        (r) => r?.receiver_id === expected.receiverId && r.predecessor_id === expected.signerId,
      );
    if (initial) {
      const call = functionCall(outcomeRecord(outcomeRecord(initial.receipt).Action).actions);
      if (
        call.method !== actual.method ||
        call.argsJson !== actual.argsJson ||
        call.deposit !== actual.deposit
      )
        fail("Initial receipt differs from transaction");
    } else result.pendingReasons.push("missing_initial_receipt_details");
    if (expected.role === "repay" && initial) {
      const start = nodes.get(hash(initial.receipt_id));
      const receiver = start?.children
        .map((id) => receipts.get(id))
        .find((r) => r?.receiver_id === plan.lendingId && r.predecessor_id === plan.tokenId);
      if (receiver) {
        const call = functionCall(outcomeRecord(outcomeRecord(receiver.receipt).Action).actions),
          received = outcomeRecord(json(call.argsJson));
        if (
          call.method !== "ft_on_transfer" ||
          call.deposit !== 0n ||
          received.sender_id !== plan.accountId ||
          outcomeAmount(received.amount) !== sent ||
          received.msg !== args.msg
        )
          fail("Receiver call differs from planned transfer", "identity_mismatch");
      } else if (!result.failureReceiptIds.length)
        result.pendingReasons.push("matching_receiver_unavailable");
      const resolverId = start?.status.kind === "receipt" ? start.status.id : undefined;
      const r = resolverId ? receipts.get(resolverId) : undefined;
      if (receiver && r && r.receiver_id === plan.tokenId && r.predecessor_id === plan.tokenId) {
        const call = functionCall(outcomeRecord(outcomeRecord(r.receipt).Action).actions),
          resolveArgs = outcomeRecord(json(call.argsJson));
        if (
          call.method !== "ft_resolve_transfer" ||
          call.deposit !== 0n ||
          resolveArgs.sender_id !== plan.accountId ||
          resolveArgs.receiver_id !== plan.lendingId ||
          outcomeAmount(resolveArgs.amount) !== sent
        )
          fail("Resolver differs from planned transfer", "identity_mismatch");
        const resolved = nodes.get(resolverId as string);
        if (resolved && resolved.executor !== plan.tokenId)
          fail("Resolver executor differs from token", "identity_mismatch");
        if (resolved?.status.kind === "value") {
          result.accepted = outcomeAmount(json(resolved.status.value));
          if (result.accepted > (sent as bigint)) fail("Resolver used exceeds sent");
          result.refunded = (sent as bigint) - result.accepted;
          if (
            finalStatus.kind === "value" &&
            outcomeAmount(json(finalStatus.value)) !== result.accepted
          )
            fail("Final return differs from resolver");
        } else if (resolved?.status.kind !== "failure")
          result.pendingReasons.push("resolver_unresolved");
      } else if (!result.failureReceiptIds.length)
        result.pendingReasons.push("matching_resolver_unavailable");
    }
    result.pendingReasons = [...new Set(result.pendingReasons)];
    if (result.pendingReasons.length) return ok(result);
    result.finalBlockHeight = height;
    if (result.failureReceiptIds.length)
      result.execution = (result.accepted ?? 0n) > 0n ? "partial" : "failed";
    else if (expected.role !== "repay") result.execution = "succeeded";
    else if (result.accepted === null) {
      result.pendingReasons.push("matching_resolver_unavailable");
      result.finalBlockHeight = null;
    } else
      result.execution =
        result.accepted === 0n ? "failed" : result.refunded === 0n ? "succeeded" : "partial";
    return ok(result);
  } catch (e) {
    return err({
      kind: e instanceof InvalidOutcome ? e.kind : "bad_response",
      detail: e instanceof InvalidOutcome ? e.message : "Malformed outcome data",
    });
  }
}

export function parseRepayOutcome(
  inputs: unknown[],
  plan: RepayPlan,
): Result<RepayOutcome, OutcomeError> {
  const valid = validateRepayPlan(plan);
  if (!valid.ok) return valid;
  if (!Array.isArray(inputs) || inputs.length > plan.transactions.length)
    return err({ kind: "bad_response", detail: "Unexpected transaction count" });
  const transactions: TransactionOutcome[] = [];
  for (let i = 0; i < plan.transactions.length; i++) {
    const expected = plan.transactions[i];
    if (!expected) return err({ kind: "invalid_plan", detail: "Missing planned transaction" });
    const r = parseTransactionOutcome(inputs[i] ?? null, expected, plan);
    if (!r.ok) return err({ ...r.error, observedTransactions: transactions });
    transactions.push(r.value);
  }
  const execution = transactions.some((t) => t.execution === "pending")
    ? "pending"
    : transactions.every((t) => t.execution === "succeeded")
      ? "succeeded"
      : transactions.some((t) => t.execution === "succeeded" || t.execution === "partial")
        ? "partial"
        : "failed";
  return ok({ execution, transactions, observation: null, observationReason: "not_read" });
}
