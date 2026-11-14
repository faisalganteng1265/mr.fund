import { Account, createTransaction, JsonRpcProvider, KeyPair, KeyPairSigner } from "near-api-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { constrainedRequester, REQUEST_GAS } from "../src/core/authority";
import { createNearSignerPort, createWatcherProvider } from "../src/runtime/near-signer";
import { fakeReads, GUARDIAN, NOW, WATCHER } from "./fixture";

afterEach(() => vi.restoreAllMocks());
const target = { network: "testnet" as const, guardianId: GUARDIAN };
const authority = {
  network: "testnet" as const,
  guardianId: GUARDIAN,
  watcherAccountId: WATCHER,
  allowance: 1n,
};
const permission = {
  FunctionCall: {
    receiver_id: GUARDIAN,
    method_names: ["request_repay"],
    allowance: "1000000000000000000000000",
  },
};

describe("NEAR watcher signer", () => {
  it("configures one attempt and refuses a provider with retry defaults", () => {
    expect(createWatcherProvider("https://rpc.example").options.retries).toBe(1);
    const key = KeyPair.fromRandom("ed25519");
    expect(() =>
      createNearSignerPort({
        target,
        authority,
        publicKey: key.getPublicKey().toString(),
        signer: new KeyPairSigner(key),
        provider: new JsonRpcProvider({ url: "https://rpc.example" }),
        reads: fakeReads(() => NOW).reads,
        submissionAllowed: () => false,
      }),
    ).toThrow("one attempt");
  });
  it("signs only the constrained zero-deposit call and retains the hash after broadcast failure", async () => {
    const key = KeyPair.fromRandom("ed25519");
    const signer = new KeyPairSigner(key);
    const provider = createWatcherProvider("https://rpc.example");
    vi.spyOn(provider, "viewNodeStatus").mockResolvedValue({ chain_id: "testnet" } as Awaited<
      ReturnType<typeof provider.viewNodeStatus>
    >);
    vi.spyOn(provider, "viewAccessKey").mockResolvedValue({
      nonce: 1n,
      permission,
      block_hash: "block",
      block_height: 1,
    });
    const create = vi
      .spyOn(Account.prototype, "createTransaction")
      .mockImplementation(async ({ receiverId, actions }) =>
        createTransaction(
          WATCHER,
          key.getPublicKey(),
          receiverId,
          2n,
          actions,
          new Uint8Array(32).fill(1),
        ),
      );
    const broadcast = vi
      .spyOn(provider, "sendTransactionUntil")
      .mockRejectedValue(new Error("network secret"));
    const requester = constrainedRequester(
      authority,
      createNearSignerPort({
        target,
        authority,
        publicKey: key.getPublicKey().toString(),
        signer,
        provider,
        reads: fakeReads(() => NOW).reads,
        submissionAllowed: () => true,
      }),
    );
    const result = await requester.requestRepay(5n);
    expect(result.kind).toBe("pending");
    expect(broadcast).toHaveBeenCalledOnce();
    expect(broadcast.mock.calls[0]?.[1]).toBe("NONE");
    const params = create.mock.calls[0]?.[0];
    expect(params?.receiverId).toBe(GUARDIAN);
    expect(params?.actions).toHaveLength(1);
    expect(params?.actions[0]).toMatchObject({
      functionCall: { methodName: "request_repay", gas: REQUEST_GAS, deposit: 0n },
    });
    expect(await requester.requestRepay(5n)).toMatchObject({ kind: "refused" });
    expect(create).toHaveBeenCalledOnce();
  });
});
