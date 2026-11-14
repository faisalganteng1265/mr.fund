/**
 * FINAL outcome parsing for a plain-wallet opening (`add-chat-open-position` 4.1): each planned
 * transaction (registrations, the deposit or the borrow, and an optional fee) is read from raw
 * `EXPERIMENTAL_tx_status` evidence and judged on its receipts, never on its first receipt or on a
 * hash. A transaction whose root succeeded can still have a failed receipt below it (the recorded
 * USDC borrow did: root `SuccessValue`, `callback_execute_with_pyth` failed), so every receipt is
 * visited and any failure counts.
 *
 * Evidence per role, all checked against the trusted plan:
 * - deposit: the token's `ft_transfer_call` to the lending contract, its `ft_on_transfer` on the
 *   lending contract and the token's `ft_resolve_transfer` give how much the contract accepted and
 *   refunded. Acceptance alone is not collateralization; the caller still needs post-state.
 * - borrow: `execute_with_pyth`, the debt token's `ft_transfer` to the signer (delivery evidence)
 *   and Rhea's `after_ft_transfer` callback, which must return `true` for the withdrawal to count.
 *   A balance delta is never used as causal proof here.
 * - registration and fee: success means no failed receipt in a FINAL transaction.
 * Debt rising on a borrow is never read as a repay failure; this parser has no repay logic.
 *
 * Does not guarantee: cross-stage atomicity, that a quoted amount was executed, exact delivery, or
 * isolation from concurrent activity. Unavailable or malformed evidence stays pending or errors;
 * it is never defaulted to success.
 */
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
  ExecutionState,
  OutcomeError,
  OutcomeEvidence,
  TransactionOutcome,
} from "./outcome-types";

export type OpeningRole = "registration" | "deposit" | "borrow" | "fee";
export type OpeningStageName = "wallet_collateral_deposit" | "wallet_borrow";

/** From the trusted verified transaction list, never inferred from RPC or model text. */
export interface OpeningExpectedTransaction {
  hash: string;
  signerId: string;
  receiverId: string;
  methodName: "storage_deposit" | "ft_transfer_call" | "execute_with_pyth" | "ft_transfer";
  argsJson: string;
  deposit: bigint;
  role: OpeningRole;
}

export interface OpeningPlan {
  network: "testnet" | "mainnet";
  accountId: string;
  lendingId: string;
  lendingVersion: "0.11.0";
  stage: OpeningStageName;
  collateralTokenId: string;
  debtTokenId: string;
  transactions: OpeningExpectedTransaction[];
}

export interface OpeningTransactionOutcome {
  hash: string;
  role: OpeningRole;
  execution: ExecutionState;
  /** Deposit and fee: token atomic units sent. Borrow: the Borrow amount in Rhea internal units. */
  sent: bigint | null;
  /** Deposit only: what the lending contract accepted, per `ft_resolve_transfer`. */
  accepted: bigint | null;
  refunded: bigint | null;
  /** Borrow only: token atomic units of the `ft_transfer` to the signer, when it succeeded. */
  delivered: bigint | null;
  /** Borrow only: Rhea's `after_ft_transfer` result; null until observed. */
  withdrawConfirmed: boolean | null;
  failureReceiptIds: string[];
  pendingReasons: string[];
  finalBlockHeight: number | null;
  transactionBlockHeight: number | null;
}

export interface OpeningOutcome {
  execution: ExecutionState;
  transactions: OpeningTransactionOutcome[];
}

const DEPOSIT_MSG = (tokenId: string) =>
  JSON.stringify({ Execute: { actions: [{ IncreaseCollateral: { token_id: tokenId } }] } });

/** Plan checks catch caller mistakes without deriving authority from RPC data. */
export function validateOpeningPlan(plan: OpeningPlan): Result<true, OutcomeError> {
  try {
    if (
      !plan ||
      !["testnet", "mainnet"].includes(plan.network) ||
      plan.lendingVersion !== "0.11.0" ||
      !["wallet_collateral_deposit", "wallet_borrow"].includes(plan.stage)
    )
      fail("Unsupported plan network, version or stage");
    for (const id of [plan.accountId, plan.lendingId, plan.collateralTokenId, plan.debtTokenId])
      account(id);
    const mainRole = plan.stage === "wallet_collateral_deposit" ? "deposit" : "borrow";
    const txs = list(
      plan.transactions,
      OUTCOME_LIMITS.transactions,
    ) as OpeningExpectedTransaction[];
    if (txs.filter((t) => t.role === mainRole).length !== 1)
      fail(`Expected exactly one ${mainRole}`);
    const seen = new Set<string>();
    let mainSeen = false;
    for (const t of txs) {
      hash(t.hash);
      if (seen.has(t.hash)) fail("Duplicate planned transaction");
      seen.add(t.hash);
      if (t.signerId !== plan.accountId) fail("Plan signer differs from the account");
      account(t.receiverId);
      const args = outcomeRecord(json(str(t.argsJson)));
      if (typeof t.deposit !== "bigint" || t.deposit <= 0n || t.deposit > U128_MAX)
        fail("Invalid deposit");
      if (t.role === "registration") {
        if (t.methodName !== "storage_deposit" || args.registration_only !== true)
          fail("Invalid registration");
        account(args.account_id);
      } else if (t.role === "deposit") {
        if (
          t.methodName !== "ft_transfer_call" ||
          t.receiverId !== plan.collateralTokenId ||
          t.deposit !== 1n ||
          args.receiver_id !== plan.lendingId ||
          args.msg !== DEPOSIT_MSG(plan.collateralTokenId) ||
          outcomeAmount(args.amount) === 0n
        )
          fail("Invalid deposit transaction");
        mainSeen = true;
      } else if (t.role === "borrow") {
        const actions = list(args.actions, 2);
        const borrow = outcomeRecord(outcomeRecord(actions[0]).Borrow);
        const withdraw = outcomeRecord(outcomeRecord(actions[1]).Withdraw);
        if (
          t.methodName !== "execute_with_pyth" ||
          t.receiverId !== plan.lendingId ||
          t.deposit !== 1n ||
          Object.keys(args).length !== 1 ||
          actions.length !== 2 ||
          Object.keys(borrow).length !== 2 ||
          borrow.token_id !== plan.debtTokenId ||
          outcomeAmount(borrow.amount) === 0n ||
          Object.keys(withdraw).length !== 1 ||
          withdraw.token_id !== plan.debtTokenId
        )
          fail("Invalid borrow transaction");
        mainSeen = true;
      } else if (t.role === "fee") {
        if (t.methodName !== "ft_transfer" || t.deposit !== 1n || !mainSeen)
          fail("Invalid fee order or method");
        account(args.receiver_id);
        if (outcomeAmount(args.amount) === 0n) fail("Invalid fee amount");
      } else fail("Unknown role");
      // Stage registrations come first; after the main transaction only fee steps may follow.
      if (mainSeen && t.role === "registration" && t.receiverId === plan.lendingId)
        fail("Registration after the main transaction");
    }
    return ok(true);
  } catch {
    return err({ kind: "invalid_plan", detail: "Invalid trusted opening plan" });
  }
}

const same = (a: OpeningExpectedTransaction, b: OpeningExpectedTransaction): boolean =>
  a === b ||
  (a.hash === b.hash &&
    a.argsJson === b.argsJson &&
    a.role === b.role &&
    a.receiverId === b.receiverId &&
    a.signerId === b.signerId &&
    a.deposit === b.deposit &&
    a.methodName === b.methodName);

/** Read-only pure parser. `null` evidence means unavailable, never a retry instruction. */
export function parseOpeningTransaction(
  input: unknown,
  expected: OpeningExpectedTransaction,
  plan: OpeningPlan,
): Result<OpeningTransactionOutcome, OutcomeError> {
  const valid = validateOpeningPlan(plan);
  if (!valid.ok) return valid;
  try {
    if (!plan.transactions.some((t) => same(t, expected)))
      fail("Transaction absent from plan", "invalid_plan");
    const args = outcomeRecord(json(expected.argsJson));
    let sent: bigint | null = null;
    if (expected.role === "deposit" || expected.role === "fee") sent = outcomeAmount(args.amount);
    if (expected.role === "borrow")
      sent = outcomeAmount(
        outcomeRecord(outcomeRecord((args.actions as unknown[])[0]).Borrow).amount,
      );
    const result: OpeningTransactionOutcome = {
      hash: expected.hash,
      role: expected.role,
      execution: "pending",
      sent,
      accepted: null,
      refunded: null,
      delivered: null,
      withdrawConfirmed: null,
      failureReceiptIds: [],
      pendingReasons: [],
      finalBlockHeight: null,
      transactionBlockHeight: null,
    };
    if (input === null) {
      result.pendingReasons.push("transaction_unavailable");
      return ok(result);
    }
    const evidence = outcomeRecord(input) as unknown as OutcomeEvidence & Record<string, unknown>;
    if (evidence.network !== plan.network) fail("Network differs from plan", "identity_mismatch");
    const raw = outcomeRecord(evidence.outcome);
    if (!raw.transaction && raw.final_execution_status === "NONE") {
      result.pendingReasons.push("not_included");
      return ok(result);
    }
    const tx = outcomeRecord(raw.transaction);
    const actual = functionCall(tx.actions);
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
      const r = outcomeRecord(v);
      const id = hash(r.receipt_id);
      if (receipts.has(id)) fail("Duplicate receipt details");
      receipts.set(id, r);
    }
    const blocks = new Map<string, number>();
    for (const v of list(evidence.blocks)) {
      const b = outcomeRecord(v);
      const id = hash(b.hash);
      if (blocks.has(id) || !Number.isSafeInteger(b.height) || (b.height as number) < 0)
        fail("Invalid or duplicate block header");
      blocks.set(id, b.height as number);
    }
    const seen = new Set<string>();
    const active = new Set<string>();
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

    const callOf = (r: Record<string, unknown>) =>
      functionCall(outcomeRecord(outcomeRecord(r.receipt).Action).actions);

    if (expected.role === "deposit" && initial) {
      const start = nodes.get(hash(initial.receipt_id));
      const receiver = start?.children
        .map((id) => receipts.get(id))
        .find(
          (r) => r?.receiver_id === plan.lendingId && r.predecessor_id === plan.collateralTokenId,
        );
      if (receiver) {
        const call = callOf(receiver);
        const received = outcomeRecord(json(call.argsJson));
        if (
          call.method !== "ft_on_transfer" ||
          call.deposit !== 0n ||
          received.sender_id !== plan.accountId ||
          outcomeAmount(received.amount) !== sent ||
          received.msg !== args.msg
        )
          fail("Receiver call differs from the planned deposit", "identity_mismatch");
      } else if (!result.failureReceiptIds.length)
        result.pendingReasons.push("matching_receiver_unavailable");
      const resolverId = start?.status.kind === "receipt" ? start.status.id : undefined;
      const r = resolverId ? receipts.get(resolverId) : undefined;
      if (
        receiver &&
        r &&
        r.receiver_id === plan.collateralTokenId &&
        r.predecessor_id === plan.collateralTokenId
      ) {
        const call = callOf(r);
        const resolveArgs = outcomeRecord(json(call.argsJson));
        if (
          call.method !== "ft_resolve_transfer" ||
          call.deposit !== 0n ||
          resolveArgs.sender_id !== plan.accountId ||
          resolveArgs.receiver_id !== plan.lendingId ||
          outcomeAmount(resolveArgs.amount) !== sent
        )
          fail("Resolver differs from the planned deposit", "identity_mismatch");
        const resolved = nodes.get(resolverId as string);
        if (resolved && resolved.executor !== plan.collateralTokenId)
          fail("Resolver executor differs from the token", "identity_mismatch");
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

    if (expected.role === "borrow" && initial) {
      // Delivery evidence: the debt token's ft_transfer from the lending contract to the signer.
      let transferId: string | undefined;
      let callbackId: string | undefined;
      for (const [id, r] of receipts) {
        if (!nodes.has(id) || id === hash(initial.receipt_id)) continue;
        const a = r.receipt && (outcomeRecord(r.receipt).Action as unknown);
        if (!a) continue;
        let call: ReturnType<typeof functionCall>;
        try {
          call = callOf(r);
        } catch {
          continue;
        }
        if (
          r.receiver_id === plan.debtTokenId &&
          r.predecessor_id === plan.lendingId &&
          call.method === "ft_transfer" &&
          outcomeRecord(json(call.argsJson)).receiver_id === plan.accountId
        ) {
          if (transferId !== undefined) fail("More than one delivery transfer");
          transferId = id;
          const t = outcomeRecord(json(call.argsJson));
          if (call.deposit !== 1n) fail("Delivery transfer deposit differs", "identity_mismatch");
          const amount = outcomeAmount(t.amount);
          if (amount === 0n || amount > (sent as bigint)) fail("Delivery exceeds the borrow");
          const n = nodes.get(id) as Node;
          if (n.status.kind === "value") result.delivered = amount;
          else if (n.status.kind !== "failure") result.pendingReasons.push("transfer_unresolved");
        }
        if (
          r.receiver_id === plan.lendingId &&
          r.predecessor_id === plan.lendingId &&
          call.method === "after_ft_transfer"
        ) {
          const c = outcomeRecord(json(call.argsJson));
          if (c.account_id !== plan.accountId || c.token_id !== plan.debtTokenId)
            fail("Withdraw callback differs from the plan", "identity_mismatch");
          if (callbackId !== undefined) fail("More than one withdraw callback");
          callbackId = id;
          const n = nodes.get(id) as Node;
          if (n.status.kind === "value") {
            const v = json(n.status.value);
            if (typeof v !== "boolean") fail("Withdraw callback returned a non-boolean");
            result.withdrawConfirmed = v;
          } else if (n.status.kind !== "failure") result.pendingReasons.push("callback_unresolved");
        }
      }
      if (transferId !== undefined && callbackId === undefined && !result.failureReceiptIds.length)
        result.pendingReasons.push("callback_unavailable");
    }

    result.pendingReasons = [...new Set(result.pendingReasons)];
    if (result.pendingReasons.length) return ok(result);
    result.finalBlockHeight = height;
    if (result.failureReceiptIds.length) {
      result.execution =
        expected.role === "deposit" && (result.accepted ?? 0n) > 0n ? "partial" : "failed";
    } else if (expected.role === "registration" || expected.role === "fee") {
      result.execution = "succeeded";
    } else if (expected.role === "deposit") {
      if (result.accepted === null) {
        result.pendingReasons.push("matching_resolver_unavailable");
        result.finalBlockHeight = null;
      } else
        result.execution =
          result.accepted === 0n ? "failed" : result.refunded === 0n ? "succeeded" : "partial";
    } else {
      // Borrow: succeeded needs delivery evidence and a confirmed withdraw; anything less is partial.
      result.execution =
        result.delivered !== null && result.withdrawConfirmed === true ? "succeeded" : "partial";
    }
    return ok(result);
  } catch (e) {
    return err({
      kind: e instanceof InvalidOutcome ? e.kind : "bad_response",
      detail: e instanceof InvalidOutcome ? e.message : "Malformed outcome data",
    });
  }
}

/** Per-transaction outcomes in plan order plus a conservative rollup. */
export function parseOpeningOutcome(
  inputs: unknown[],
  plan: OpeningPlan,
): Result<OpeningOutcome, OutcomeError> {
  const valid = validateOpeningPlan(plan);
  if (!valid.ok) return valid;
  if (!Array.isArray(inputs) || inputs.length > plan.transactions.length)
    return err({ kind: "bad_response", detail: "Unexpected transaction count" });
  const transactions: OpeningTransactionOutcome[] = [];
  for (let i = 0; i < plan.transactions.length; i++) {
    const expected = plan.transactions[i];
    if (!expected) return err({ kind: "invalid_plan", detail: "Missing planned transaction" });
    const r = parseOpeningTransaction(inputs[i] ?? null, expected, plan);
    if (!r.ok) {
      // Effects already validated survive a later malformed or mismatched response.
      const error: OutcomeError = {
        kind: r.error.kind,
        detail: r.error.detail,
        observedTransactions: transactions as unknown as TransactionOutcome[],
      };
      return err(error);
    }
    transactions.push(r.value);
  }
  const execution: ExecutionState = transactions.some((t) => t.execution === "pending")
    ? "pending"
    : transactions.every((t) => t.execution === "succeeded")
      ? "succeeded"
      : transactions.some((t) => t.execution === "succeeded" || t.execution === "partial")
        ? "partial"
        : "failed";
  return ok({ execution, transactions });
}

/**
 * A status lookup needs only the hash and who signed it. `createOutcomeReader` satisfies this
 * (it reads nothing else), so the repay `OutcomeReader` type stays untouched.
 */
export interface OpeningOutcomeReader {
  read(
    lookup: { hash: string; signerId: string },
    signal: AbortSignal,
  ): Promise<Result<OutcomeEvidence | null, OutcomeError>>;
}

/**
 * Read every planned transaction's FINAL evidence and parse it. An unavailable RPC leaves that
 * transaction pending (never failed or succeeded); mismatched or malformed evidence is an error.
 * Read-only: nothing here signs, sends or retries.
 */
export async function readOpeningOutcome(
  plan: OpeningPlan,
  reader: OpeningOutcomeReader,
  signal: AbortSignal,
): Promise<Result<OpeningOutcome, OutcomeError>> {
  const valid = validateOpeningPlan(plan);
  if (!valid.ok) return valid;
  const inputs: unknown[] = [];
  for (const t of plan.transactions) {
    const r = await reader.read({ hash: t.hash, signerId: t.signerId }, signal);
    if (r.ok) inputs.push(r.value);
    else if (r.error.kind === "rpc_unavailable") inputs.push(null);
    else return r;
  }
  return parseOpeningOutcome(inputs, plan);
}
