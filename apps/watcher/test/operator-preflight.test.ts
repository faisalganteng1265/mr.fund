import { describe, expect, it } from "vitest";
import { inspectOperatorReadiness } from "../src/runtime/operator-preflight";
import { fakeReads, GUARDIAN, NOW, WATCHER } from "./fixture";

const validKey = {
  nonce: 42n,
  permission: {
    FunctionCall: {
      receiver_id: GUARDIAN,
      method_names: ["request_repay"],
      allowance: "1000000000000000000000000",
    },
  },
};
const input = {
  target: { network: "testnet" as const, guardianId: GUARDIAN },
  watcherAccountId: WATCHER,
  publicKey: "ed25519:public",
  reads: fakeReads(() => NOW).reads,
};
const provider = {
  viewNodeStatus: async () => ({ chain_id: "testnet" }),
  viewAccessKey: async () => validKey,
};

describe("public operator read-only preflight", () => {
  it("keeps valid authority locked when restart history cannot be proven", async () => {
    expect(await inspectOperatorReadiness({ ...input, provider })).toEqual({
      status: "read_only",
      reason: "restart_reconciliation_unavailable",
    });
  });
  it("refuses a wrong chain and broader permission", async () => {
    expect(
      await inspectOperatorReadiness({
        ...input,
        provider: { ...provider, viewNodeStatus: async () => ({ chain_id: "mainnet" }) },
      }),
    ).toEqual({ status: "read_only", reason: "rpc_network_mismatch" });
    expect(
      await inspectOperatorReadiness({
        ...input,
        provider: {
          ...provider,
          viewAccessKey: async () => ({ nonce: 1n, permission: "FullAccess" }),
        },
      }),
    ).toEqual({ status: "read_only", reason: "full_access_key" });
  });
  it("does not expose provider errors", async () => {
    expect(
      await inspectOperatorReadiness({
        ...input,
        provider: {
          ...provider,
          viewNodeStatus: async () => {
            throw new Error("secret-sentinel");
          },
        },
      }),
    ).toEqual({ status: "read_only", reason: "authority_unavailable" });
  });
});
