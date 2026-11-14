import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { baseSnapshot, NOW, USDC } from "../../../packages/engine/test/helpers";
import { createPositionHandler } from "../src/position/handler";
import { accountId, config, recording, rpc } from "./position-rpc";

const get = (query = `accountId=${accountId}&networkId=testnet`) =>
  new Request(`https://app.example/api/position?${query}`);
const post = (body: string, query = "") =>
  new Request(`https://app.example/api/position${query}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });
const selectors = JSON.stringify({ accountId, networkId: "testnet" });
function handler(overrides: Record<string, unknown> = {}) {
  return createPositionHandler({
    config,
    fetchImpl: rpc({
      get_price_no_older_than: {
        price: "100000000",
        expo: -8,
        conf: "0",
        publish_time: Math.floor(Date.now() / 1000),
      },
      ...overrides,
    }).fetchImpl,
  });
}
describe("public position HTTP boundary", () => {
  beforeEach(() => {
    vi.spyOn(Date, "now").mockReturnValue(NOW);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });
  it("accepts GET and POST without provider credentials and returns the wire identity", async () => {
    for (const request of [get(), post(selectors)]) {
      const response = await handler()(request);
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(await response.json()).toMatchObject({
        ok: true,
        provenance: "live",
        accountId,
        networkId: "testnet",
        source: { lendingVersion: "0.11.0", blockHash: recording._provenance.blockHash },
      });
    }
  });
  it.each([
    "accountId=Alice.testnet&networkId=testnet",
    "accountId=https://a.testnet&networkId=testnet",
    `accountId=${"a".repeat(65)}&networkId=testnet`,
    `accountId=${accountId}&accountId=${accountId}&networkId=testnet`,
    `accountId=${accountId}`,
    `accountId=${accountId}&networkId=testnet&rpcUrl=https://evil.example`,
    `accountId=${accountId}&networkId=testnet&lendingId=evil.testnet`,
  ])("rejects invalid GET selectors before RPC: %s", async (query) => {
    let calls = 0;
    const fetchImpl: typeof fetch = async () => {
      calls++;
      throw new Error("unexpected RPC");
    };
    const response = await createPositionHandler({ config, fetchImpl })(get(query));
    expect(response.status).toBe(400);
    expect(calls).toBe(0);
  });
  it.each([
    "{",
    "null",
    "[]",
    `{"accountId":"${accountId}","networkId":"testnet","rpcUrl":"https://evil.example"}`,
    `{"accountId":"${accountId}","networkId":"testnet","lendingId":"evil.testnet"}`,
    `{"accountId":"${accountId}","accountId":"${accountId}","networkId":"testnet"}`,
    `{"accountId":"${accountId}","networkId":"testnet","network\\u0049d":"testnet"}`,
  ])("rejects malformed, duplicate and override JSON %s", async (body) => {
    expect((await handler()(post(body))).status).toBe(400);
  });
  it("refuses POST query selectors and non-JSON bodies", async () => {
    expect((await handler()(post(selectors, "?accountId=x.testnet"))).status).toBe(400);
    expect(
      (
        await handler()(
          new Request("https://app.example/api/position", { method: "POST", body: selectors }),
        )
      ).status,
    ).toBe(415);
  });
  it.each([`accountId=alice.near&networkId=testnet`, `accountId=${accountId}&networkId=mainnet`])(
    "refuses network mismatch %s",
    async (query) => {
      const response = await handler()(get(query));
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({
        error: { code: "network_mismatch" },
        networkId: "testnet",
      });
    },
  );
  it("refuses missing explicit config and unsupported methods", async () => {
    expect((await createPositionHandler({ config: null })(get())).status).toBe(503);
    const response = await handler()(
      new Request("https://app.example/api/position", { method: "DELETE" }),
    );
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("GET, POST");
  });
  it("separates null/all-zero positions from nonempty debt-free supply", async () => {
    for (const get_account of [
      null,
      { account_id: accountId, supplied: [], collateral: [], borrowed: [] },
    ])
      expect((await handler({ get_account })(get())).status).toBe(404);
    const get_account = {
      account_id: accountId,
      supplied: [{ token_id: "wrap.testnet", balance: "1" }],
      collateral: [],
      borrowed: [],
    };
    expect((await handler({ get_account })(get())).status).toBe(200);
  });
  it("sanitizes failures and distinguishes unsupported versions", async () => {
    const fetchImpl: typeof fetch = async () => {
      throw new Error("SENTINEL_SECRET https://user:password@rpc.example stack");
    };
    const response = await createPositionHandler({ config, fetchImpl })(get());
    expect(response.status).toBe(503);
    expect(await response.text()).not.toMatch(/SENTINEL|password|stack|rpc.example/);
    expect((await handler({ get_version: "9.0.0" })(get())).status).toBe(422);
    expect((await handler({ chain: "mainnet" })(get())).status).toBe(409);
  });
  it.each(["stale", "missing", "future"])(
    "refuses %s prices without success fields",
    async (kind) => {
      const snapshot = structuredClone(baseSnapshot());
      if (kind === "missing") delete snapshot.prices[USDC];
      else {
        const p = snapshot.prices[USDC];
        if (!p) throw new Error("fixture");
        p.publishTimeMs = kind === "stale" ? NOW - 120001 : NOW + 60001;
      }
      const response = await createPositionHandler({
        config,
        now: () => NOW,
        loadPosition: async () => ({
          snapshot,
          source: {
            protocol: "rhea",
            lendingId: snapshot.lendingId,
            lendingVersion: "0.11.0",
            blockHash: "anchor",
            blockHeight: snapshot.blockHeight,
          },
        }),
      })(get(`accountId=alice.testnet&networkId=testnet`));
      expect(response.status).toBe(kind === "stale" ? 422 : 502);
      expect(await response.json()).toMatchObject({
        ok: false,
        error: { code: kind === "stale" ? "stale_data" : "untrusted_data" },
      });
    },
  );
  it("performs a new final-block read after each success without caching fetches", async () => {
    const remote = rpc({
      get_price_no_older_than: {
        price: "100000000",
        expo: -8,
        conf: "0",
        publish_time: NOW / 1000,
      },
    });
    const cacheModes: (RequestCache | undefined)[] = [];
    const fetchImpl: typeof fetch = async (target, init) => {
      cacheModes.push(init?.cache);
      return remote.fetchImpl(target, init);
    };
    const handle = createPositionHandler({ config, fetchImpl });
    expect((await handle(get())).status).toBe(200);
    expect((await handle(get())).status).toBe(200);
    expect(remote.calls.filter((c) => c.method === "get_config")).toHaveLength(2);
    expect(cacheModes.every((mode) => mode === "no-store")).toBe(true);
  });
});
