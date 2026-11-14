import { DEMO_FEE } from "../demo";
import { amount, percent } from "../display";
import { demoDelay } from "./demoDelay";
import type { DemoPosition } from "./demoPosition";
import type { DemoSession } from "./demoSession";
import type { Approval, ExecutionEvent, ExecutionPort, ExecutionView, Receipt } from "./types";

export interface DemoExecution {
  port: ExecutionPort;
  prepare(title: string, description: string, amount: string, apply: () => string): Approval;
  addReceipt(
    title: string,
    detail: string,
    status?: Receipt["status"],
    before?: string,
    after?: string,
  ): Receipt;
  reset(): void;
}
export function createDemoExecution(session: DemoSession, position: DemoPosition): DemoExecution {
  let state: ExecutionView = { receipts: [], lastRepay: null, lastChange: null };
  let receiptId = 0,
    approvalId = 0;
  let pending: { approval: Approval; apply: () => string } | null = null;
  const listeners = new Set<() => void>();
  function update(next: Partial<ExecutionView>) {
    state = { ...state, ...next };
    for (const listener of listeners) listener();
  }
  function addReceipt(
    title: string,
    detail: string,
    status: Receipt["status"] = "confirmed",
    before?: string,
    after?: string,
  ) {
    const atMs = Date.now();
    const receipt: Receipt = {
      id: ++receiptId,
      title,
      detail,
      status,
      atMs,
      at: new Date(atMs).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" }),
      ...(before ? { before } : {}),
      ...(after ? { after } : {}),
      chain: { status: status === "rejected" ? "failed" : status, txHashes: [], atMs },
    };
    update({ receipts: [receipt, ...state.receipts] });
    return receipt;
  }
  function prepare(title: string, description: string, value: string, apply: () => string) {
    const approval = { id: String(++approvalId), title, description, amount: value };
    pending = { approval, apply };
    return approval;
  }
  const port: ExecutionPort = {
    provenance: "simulated",
    getSnapshot: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    clearRecommendation() {
      update({ lastRepay: null });
    },
    prepareRepay(input, recommendation) {
      const { card } = position.port.advice(input, recommendation);
      const current = position.port.getSnapshot();
      if (!card?.ok || current.dataState !== "fresh") return null;
      const value = card.value;
      return prepare(
        `Repay ${amount(value.amount)} USDC`,
        "Mock approval for a repayment from your wallet. Execution fee: 0.10 test USDC to fees.demo.testnet. No transaction will be sent.",
        `${amount(value.amount + DEMO_FEE.executionFee)} test USDC`,
        () => {
          const before =
            current.current.health === null ? "Unavailable" : percent(current.current.health);
          position.repay(value.amount);
          session.changeBalance(-value.amount - DEMO_FEE.executionFee);
          const next = position.port.getSnapshot().current;
          const after = next.health === null ? "Unavailable" : percent(next.health);
          const receipt = addReceipt(
            `Repaid ${amount(value.amount)} USDC`,
            "Simulated wallet repayment. Fee: 0.10 test USDC to fees.demo.testnet. Result computed from the updated demo fixture; no chain confirmation.",
            "confirmed",
            before,
            after,
          );
          update({
            lastRepay: receipt,
            lastChange: { repaid: amount(value.amount), before, after },
          });
          return "Repayment simulated. Your demo position has been updated.";
        },
      );
    },
    async *execute(id, outcome, signal): AsyncIterable<ExecutionEvent> {
      signal.throwIfAborted();
      const action = pending;
      if (!action || action.approval.id !== id) throw new Error("Unknown demo approval");
      pending = null;
      await demoDelay(1100, signal);
      signal.throwIfAborted();
      const previous = state.receipts[0];
      if (outcome === "cancel")
        yield {
          type: "notice",
          text: "You cancelled. Nothing changed; your draft is ready to retry.",
        };
      else if (outcome === "failure") {
        addReceipt(
          action.approval.title,
          "Simulated transaction failed. No balance changed. Retry when ready.",
          "failed",
        );
        yield { type: "notice", text: "Demo transaction failed. No funds moved." };
      } else if (outcome === "partial") {
        addReceipt(
          action.approval.title,
          "Simulated batch stopped before applying the action. Fee and action steps were not applied. Review and retry.",
          "partial",
        );
        yield { type: "notice", text: "Partial demo batch. No balance change was applied." };
      } else yield { type: "notice", text: action.apply() };
      const receipt = state.receipts[0];
      if (receipt && receipt !== previous) yield { type: "receipt", receipt };
      yield { type: "done", applied: outcome === "success" };
    },
  };
  return {
    port,
    prepare,
    addReceipt,
    reset() {
      pending = null;
      update({ receipts: [], lastRepay: null, lastChange: null });
    },
  };
}
