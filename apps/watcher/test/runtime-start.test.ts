import { KeyPair, KeyPairSigner } from "near-api-js";
import { describe, expect, it, vi } from "vitest";
import { readWatcherConfig } from "../src/runtime/config";
import { createWatcherProvider } from "../src/runtime/near-signer";
import { startWatcher } from "../src/runtime/start";
import { fakeReads, GUARDIAN, WATCHER } from "./fixture";

describe("watcher Node runtime", () => {
  it("requires explicit network, https RPC, account, key directory and one Guardian", () => {
    const env = {
      NEAR_NETWORK_ID: "testnet",
      NEAR_RPC_URL: "https://rpc.example",
      WATCHER_ACCOUNT_ID: WATCHER,
      WATCHER_KEYS_DIR: "/keys",
    };
    expect(readWatcherConfig(env, [GUARDIAN])).toMatchObject({
      network: "testnet",
      guardianId: GUARDIAN,
    });
    for (const changed of [
      { ...env, NEAR_RPC_URL: "https://user:secret@rpc.example" },
      { ...env, NEAR_NETWORK_ID: "mainnet" },
      { ...env, WATCHER_KEYS_DIR: "" },
    ])
      expect(() => readWatcherConfig(changed, [GUARDIAN])).toThrow("Invalid watcher configuration");
    expect(() => readWatcherConfig(env, [GUARDIAN, GUARDIAN])).toThrow(
      "Invalid watcher configuration",
    );
  });
  it("starts read-only and cannot sign or broadcast while restart and public gates are open", async () => {
    const key = KeyPair.fromRandom("ed25519");
    const signer = new KeyPairSigner(key);
    const sign = vi.spyOn(signer, "signTransaction");
    const provider = createWatcherProvider("https://rpc.example");
    vi.spyOn(provider, "viewNodeStatus").mockResolvedValue({ chain_id: "testnet" } as Awaited<
      ReturnType<typeof provider.viewNodeStatus>
    >);
    vi.spyOn(provider, "viewAccessKey").mockResolvedValue({
      nonce: 4n,
      permission: {
        FunctionCall: {
          receiver_id: GUARDIAN,
          method_names: ["request_repay"],
          allowance: "100000000000000000000000",
        },
      },
      block_hash: "block",
      block_height: 1,
    });
    const broadcast = vi.spyOn(provider, "sendTransactionUntil");
    const lines: string[] = [];
    const runtime = await startWatcher({
      config: {
        network: "testnet",
        rpcUrl: "https://rpc.example",
        guardianId: GUARDIAN,
        watcherAccountId: WATCHER,
        keysDirectory: "/keys",
      },
      provider,
      reads: fakeReads(Date.now).reads,
      key: { publicKey: key.getPublicKey().toString(), signer },
      write: (line) => lines.push(line),
    });
    try {
      await vi.waitFor(() =>
        expect(runtime.watcher.status().guardians[0]?.lastEvaluationAt).not.toBeNull(),
      );
      expect(runtime.watcher.status().guardians[0]).toMatchObject({
        requests: "read_only",
        readOnlyReason: "startup_uncertain",
      });
      expect(sign).not.toHaveBeenCalled();
      expect(broadcast).not.toHaveBeenCalled();
      expect(lines.some((line) => JSON.parse(line).event === "heartbeat")).toBe(true);
    } finally {
      runtime.stop();
      vi.restoreAllMocks();
    }
  });
});
