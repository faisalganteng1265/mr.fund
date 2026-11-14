import { describe, expect, it } from "vitest";
import { inspectWatcherAuthority } from "../src/runtime/authority";
import { fakeReads, GUARDIAN, NOW, WATCHER } from "./fixture";

const permission = {
  FunctionCall: {
    receiver_id: GUARDIAN,
    method_names: ["request_repay"],
    allowance: "1000000000000000000000000",
  },
};
const target = { network: "testnet" as const, guardianId: GUARDIAN };
const input = {
  target,
  watcherAccountId: WATCHER,
  publicKey: "ed25519:public",
  reads: fakeReads(() => NOW).reads,
};

describe("runtime authority inspection", () => {
  it("verifies the scoped key and keeps restart evidence uncertain", async () => {
    const result = await inspectWatcherAuthority({
      ...input,
      provider: {
        viewNodeStatus: async () => ({ chain_id: "testnet" }),
        viewAccessKey: async () => ({ nonce: 7n, permission }),
      },
    });
    expect(result).toMatchObject({
      ok: true,
      value: { nonce: 7n, authority: { guardianId: GUARDIAN }, startup: { kind: "uncertain" } },
    });
  });
  it("refuses full-access keys, wrong network and secrets in provider errors", async () => {
    const provider = {
      viewNodeStatus: async () => ({ chain_id: "testnet" }),
      viewAccessKey: async () => ({ nonce: 1n, permission: "FullAccess" }),
    };
    expect(await inspectWatcherAuthority({ ...input, provider })).toEqual({
      ok: false,
      error: "full_access_key",
    });
    expect(
      await inspectWatcherAuthority({
        ...input,
        provider: { ...provider, viewNodeStatus: async () => ({ chain_id: "mainnet" }) },
      }),
    ).toEqual({ ok: false, error: "rpc_network_mismatch" });
    expect(
      await inspectWatcherAuthority({
        ...input,
        provider: {
          ...provider,
          viewNodeStatus: async () => {
            throw new Error("secret-sentinel");
          },
        },
      }),
    ).toEqual({ ok: false, error: "authority_unavailable" });
  });
});
