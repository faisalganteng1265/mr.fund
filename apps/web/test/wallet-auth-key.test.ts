import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveAuthAccount } from "../src/wallet/auth-key";
import type { WalletConfig } from "../src/wallet/types";

const config: WalletConfig = {
  network: "testnet",
  rpcUrl: "https://rpc.example",
  auth: {
    clientId: "public-client",
    domain: "login.testnet.fast-auth.com",
    contractId: "fast-auth.testnet",
    mpcId: "v1.signer-prod.testnet",
  },
};
const key = "ed25519:4vJ9JU1bJJE96FWSJKvHsmmFADCg4gpZQff4P3bkLKi";
const accountId = "0101010101010101010101010101010101010101010101010101010101010101";
function transport(derived: unknown = key, chain = "testnet") {
  const calls: { method: string; params: Record<string, unknown> }[] = [];
  const fetchImpl: typeof fetch = async (_url, init) => {
    const call = JSON.parse(String(init?.body));
    calls.push(call);
    if (call.method === "status") return Response.json({ result: { chain_id: chain } });
    return Response.json({
      result: {
        block_height: 123,
        block_hash: "final-block",
        result: [...new TextEncoder().encode(JSON.stringify(derived))],
      },
    });
  };
  return { calls, fetchImpl };
}
afterEach(() => vi.useRealTimers());

describe("NEAR Auth public-key account resolution", () => {
  it("maps a known 32-byte key and uses the canonical FINAL MPC path", async () => {
    const rpc = transport();
    await expect(resolveAuthAccount(config, "google-oauth2|123", rpc.fetchImpl)).resolves.toEqual({
      accountId,
      publicKey: key,
    });
    expect(rpc.calls.map((call) => call.method)).toEqual(["status", "query"]);
    const params = rpc.calls[1]?.params;
    expect(params).toMatchObject({
      finality: "final",
      request_type: "call_function",
      account_id: "v1.signer-prod.testnet",
      method_name: "derived_public_key",
    });
    expect(JSON.parse(atob(String(params?.args_base64)))).toEqual({
      path: "jwt#https://login.testnet.fast-auth.com/#google-oauth2|123",
      predecessor: "fast-auth.testnet",
      domain_id: 1,
    });
  });
  it("refuses a wrong chain before exposing an identity to MPC", async () => {
    const rpc = transport(key, "mainnet");
    await expect(resolveAuthAccount(config, "auth0|123", rpc.fetchImpl)).rejects.toThrow();
    expect(rpc.calls.map((call) => call.method)).toEqual(["status"]);
  });
  it.each(["", "x".repeat(257), "auth0|a#b", "a\n", "a\u0000", "a\u007f", "a\u0085"])(
    "rejects invalid subject %j before any RPC read",
    async (subject) => {
      const rpc = transport();
      await expect(resolveAuthAccount(config, subject, rpc.fetchImpl)).rejects.toThrow();
      expect(rpc.calls).toEqual([]);
    },
  );
  it.each(["a", "x".repeat(256)])("accepts the subject length boundary", async (subject) => {
    await expect(resolveAuthAccount(config, subject, transport().fetchImpl)).resolves.toEqual({
      accountId,
      publicKey: key,
    });
  });
  it("requires configured Auth", async () => {
    const rpc = transport();
    await expect(
      resolveAuthAccount({ ...config, auth: null }, "auth0|123", rpc.fetchImpl),
    ).rejects.toThrow();
    expect(rpc.calls).toEqual([]);
  });
  it.each([
    null,
    { public_key: key },
    key.replace("ed25519", "secp256k1"),
    "ed25519:0OIl",
    `ed25519:${"1".repeat(31)}`,
    `ed25519:${"1".repeat(33)}`,
    `${key} `,
    `ed25519:${"1".repeat(500)}`,
  ])("rejects invalid derived key %j", async (derived) => {
    await expect(
      resolveAuthAccount(config, "auth0|123", transport(derived).fetchImpl),
    ).rejects.toThrow();
  });
  it.each([
    () => Response.json({ error: { message: "RPC error" } }),
    () => Response.json({ result: {} }),
    () => new Response("not json"),
    () => new Response("unavailable", { status: 503 }),
    () => new Response("x".repeat(65_537)),
  ])("rejects invalid RPC status without querying MPC", async (response) => {
    const fetchImpl = vi.fn<typeof fetch>(async () => response());
    await expect(resolveAuthAccount(config, "auth0|123", fetchImpl)).rejects.toThrow();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
  it.each([
    { result: { block_height: 1, block_hash: "block", result: [256] } },
    { result: { block_height: 1, block_hash: "block", result: [123] } },
    { result: null },
    { error: { message: "MPC failure" } },
  ])("rejects malformed MPC RPC envelopes", async (envelope) => {
    const fetchImpl: typeof fetch = async (_url, init) => {
      const call = JSON.parse(String(init?.body));
      return Response.json(
        call.method === "status" ? { result: { chain_id: "testnet" } } : envelope,
      );
    };
    await expect(resolveAuthAccount(config, "auth0|123", fetchImpl)).rejects.toThrow();
  });
  it.each(["fetch", "body"])("bounds stalled %s to ten seconds", async (phase) => {
    vi.useFakeTimers();
    const fetchImpl: typeof fetch = async () => {
      if (phase === "fetch") return new Promise<Response>(() => {});
      return new Response(new ReadableStream({ start() {} }));
    };
    const rejected = expect(resolveAuthAccount(config, "auth0|123", fetchImpl)).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(10_000);
    await rejected;
  });
});
