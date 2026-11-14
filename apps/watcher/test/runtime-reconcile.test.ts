import { describe, expect, it } from "vitest";
import { reconcileFinal } from "../src/runtime/reconcile";
import { GUARDIAN, guardian, NOW, WATCHER } from "./fixture";

const outcome = { outcome: "executed", op_id: "7", used: "12", fee: "2" };
const receipt = (data: unknown = outcome) => ({
  final_execution_status: "FINAL",
  transaction: { hash: "hash", signer_id: WATCHER, receiver_id: GUARDIAN },
  status: { SuccessValue: Buffer.from(JSON.stringify(data)).toString("base64") },
});
const snapshot = () => {
  const result = guardian(NOW);
  result.history.attempts = [
    { opId: 7n, atNs: 0n, requested: 12n, used: 12n, fee: 2n, outcome: "settled", reason: null },
  ];
  return result;
};

describe("terminal request reconciliation", () => {
  it("accepts only a final matching receipt corroborated by Guardian history", () => {
    expect(reconcileFinal(receipt(), "hash", WATCHER, snapshot())).toEqual({
      kind: "final",
      outcome: { outcome: "executed", opId: 7n, used: 12n, fee: 2n },
    });
    expect(
      reconcileFinal(
        { ...receipt(), final_execution_status: "EXECUTED" },
        "hash",
        WATCHER,
        snapshot(),
      ),
    ).toEqual({ kind: "pending" });
    expect(reconcileFinal(receipt(), "other-hash", WATCHER, snapshot())).toEqual({
      kind: "unknown",
    });
    const missing = snapshot();
    missing.history.attempts = [];
    expect(reconcileFinal(receipt(), "hash", WATCHER, missing)).toEqual({ kind: "pending" });
    const mismatch = snapshot();
    const attempt = mismatch.history.attempts[0];
    if (!attempt) throw new Error("Missing fixture attempt");
    attempt.fee = 3n;
    expect(reconcileFinal(receipt(), "hash", WATCHER, mismatch)).toEqual({ kind: "pending" });
  });
  it("keeps unresolved, malformed and in-flight outcomes pending", () => {
    expect(
      reconcileFinal(receipt({ outcome: "unresolved", op_id: "7" }), "hash", WATCHER, snapshot()),
    ).toEqual({ kind: "pending" });
    expect(
      reconcileFinal({ ...receipt(), status: { SuccessValue: "%%" } }, "hash", WATCHER, snapshot()),
    ).toEqual({ kind: "pending" });
    const locked = guardian(NOW, {
      status: {
        inFlight: { opId: 7n, amount: 12n, fee: 2n, startedNs: 0n, repayPhase: "unresolved" },
      },
    });
    expect(reconcileFinal(receipt(), "hash", WATCHER, locked)).toEqual({ kind: "pending" });
    expect(
      reconcileFinal({ ...receipt(), status: { Failure: "sensitive" } }, "hash", WATCHER, locked),
    ).toEqual({ kind: "pending" });
  });
});
