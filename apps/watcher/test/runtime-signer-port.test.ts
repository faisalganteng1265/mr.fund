import { baseEncode } from "near-api-js";
import { describe, expect, it, vi } from "vitest";
import { constrainedRequester, REQUEST_GAS, type RepayCall } from "../src/core/authority";
import { createGuardedSignerPort } from "../src/runtime/signer-port";

const hash = baseEncode(new Uint8Array(32).fill(2));
const authority = {
  network: "testnet" as const,
  guardianId: "guardian.testnet",
  watcherAccountId: "watcher.testnet",
  allowance: 1n,
};
const call: RepayCall = {
  signerId: authority.watcherAccountId,
  receiverId: authority.guardianId,
  methodName: "request_repay",
  args: { amount: "5" },
  gas: REQUEST_GAS,
  deposit: 0n,
};
const dependencies = () => ({
  submissionAllowed: vi.fn(() => true),
  verify: vi.fn(async () => true),
  sign: vi.fn(async () => ({ hash, signed: "SIGNED" })),
  broadcast: vi.fn(async () => {}),
  lookup: vi.fn(async () => ({ kind: "unknown" as const })),
});

describe("guarded signer port", () => {
  it("refuses closed gates, unverified authority and altered transaction shapes", async () => {
    const deps = dependencies();
    const port = createGuardedSignerPort(authority, deps);
    expect(await port.send({ ...call, receiverId: "other.testnet" })).toEqual({
      kind: "refused",
      reason: "invalid_request",
    });
    deps.submissionAllowed.mockReturnValue(false);
    expect(await port.send(call)).toEqual({ kind: "refused", reason: "submission_gate_closed" });
    deps.submissionAllowed.mockReturnValue(true);
    deps.verify.mockResolvedValue(false);
    expect(await port.send(call)).toEqual({ kind: "refused", reason: "authority_unavailable" });
    expect(deps.sign).not.toHaveBeenCalled();
  });
  it("holds a signed hash after timeout and refuses another send until reconciliation", async () => {
    const deps = dependencies();
    deps.broadcast.mockRejectedValue(new Error("transport secret"));
    const port = createGuardedSignerPort(authority, deps);
    const requester = constrainedRequester(authority, port);
    expect(await requester.requestRepay(5n)).toEqual({ kind: "pending", hash });
    expect(await requester.requestRepay(5n)).toMatchObject({ kind: "refused" });
    expect(await requester.lookup(hash)).toEqual({ kind: "unknown" });
    expect(await requester.requestRepay(5n)).toMatchObject({ kind: "refused" });
    expect(deps.sign).toHaveBeenCalledOnce();
    expect(deps.sign).toHaveBeenCalledWith(call);
  });
  it("never treats unresolved outcomes or malformed signed hashes as clean", async () => {
    const deps = dependencies();
    const port = createGuardedSignerPort(authority, {
      ...deps,
      lookup: async () => ({ kind: "final", outcome: { outcome: "unresolved", opId: 1n } }),
    });
    expect(await port.send(call)).toEqual({ kind: "pending", hash });
    expect(await port.lookup(hash)).toEqual({ kind: "pending" });
    expect(await port.send(call)).toMatchObject({ kind: "refused" });
    const malformed = createGuardedSignerPort(authority, {
      ...dependencies(),
      sign: async () => ({ hash: "bad", signed: "SIGNED" }),
    });
    await expect(malformed.send(call)).rejects.toThrow("Watcher request could not be reconciled");
    expect(await malformed.send(call)).toEqual({ kind: "refused", reason: "request_unreconciled" });
  });
});
