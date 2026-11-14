import { describe, expect, it } from "vitest";
import { requestOverLimit } from "../src/runtime/operator";
import { fakeReads, fakeRequester, GUARDIAN, NOW } from "./fixture";

const target = { network: "testnet" as const, guardianId: GUARDIAN };
function setup() {
  const state = fakeReads(() => NOW);
  const sender = fakeRequester();
  return {
    state,
    sender,
    input: {
      target,
      reads: state.reads,
      requester: sender.requester,
      startup: { kind: "clear" as const },
      nowMs: NOW,
      authorized: true,
    },
  };
}
describe("explicit over-limit operator test", () => {
  it("sends exactly max_per_action + 1 only when invoked with verified context", async () => {
    const { input, sender } = setup();
    expect(await requestOverLimit(input)).toMatchObject({ kind: "final" });
    expect(sender.sent).toEqual([100_000_001n]);
  });
  it("refuses closed gates, stale data, in-flight requests and cooldown", async () => {
    const { input, sender, state } = setup();
    expect(await requestOverLimit({ ...input, authorized: false })).toMatchObject({
      kind: "refused",
      reason: "operator_gate_closed",
    });
    expect(
      await requestOverLimit({ ...input, startup: { kind: "uncertain", detail: "unknown" } }),
    ).toMatchObject({ kind: "refused", reason: "operator_gate_closed" });
    state.state.over = { readAtMs: NOW - 60_001 };
    expect(await requestOverLimit(input)).toMatchObject({
      kind: "refused",
      reason: "stale_or_foreign_guardian",
    });
    state.state.over = {
      status: {
        inFlight: { opId: 1n, amount: 1n, fee: 0n, startedNs: 0n, repayPhase: "repaying" },
      },
    };
    expect(await requestOverLimit(input)).toMatchObject({
      kind: "refused",
      reason: "guardian_not_ready",
    });
    state.state.over = { status: { lastActionStartedNs: BigInt(NOW - 1_000) * 1_000_000n } };
    expect(await requestOverLimit(input)).toMatchObject({ kind: "refused", reason: "cooldown" });
    expect(sender.sent).toHaveLength(0);
  });
  it("does not retry an uncertain submission", async () => {
    const { input, sender } = setup();
    sender.script.submit.push("throw");
    await expect(requestOverLimit(input)).rejects.toThrow();
    expect(sender.sent).toEqual([100_000_001n]);
  });
  it("samples the clock after an asynchronous fresh snapshot", async () => {
    const { input, sender, state } = setup();
    state.state.over = { readAtMs: NOW + 25 };
    expect(await requestOverLimit({ ...input, now: () => NOW + 30 })).toMatchObject({
      kind: "final",
    });
    expect(sender.sent).toEqual([100_000_001n]);
  });
});
