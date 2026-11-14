import { readFileSync } from "node:fs";
import { healthBps } from "@mrfund/engine";
import { describe, expect, it } from "vitest";
import { createRheaClient } from "../src/client";
import { readMarket, readPosition } from "../src/snapshot";
import { parseAccount, parseAprBps, parseOraclePrice } from "../src/views";

const fixture = JSON.parse(
  readFileSync(new URL("../../../fixtures/rhea/testnet-reads.json", import.meta.url), "utf8"),
);
const cfg = { network: "testnet" as const, lendingId: fixture._provenance.lendingId };
const accountId = fixture._provenance.accountId;
function replay(
  change?: (method: string, data: unknown, args: Record<string, unknown>) => unknown,
  recording = fixture,
) {
  const requests: Record<string, unknown>[] = [];
  const client = createRheaClient("https://rpc.example", async (_url, init) => {
    const request = JSON.parse(String(init?.body));
    requests.push(request.params);
    const p = request.params;
    const args = JSON.parse(Buffer.from(p.args_base64, "base64").toString());
    const call = recording.calls.find(
      (c: { contractId: string; method: string; args: unknown }) =>
        c.contractId === p.account_id &&
        c.method === p.method_name &&
        JSON.stringify(c.args) === JSON.stringify(args),
    );
    if (!call) throw new Error(`Unrecorded ${p.method_name} ${JSON.stringify(args)}`);
    const data = change ? change(p.method_name, structuredClone(call.data), args) : call.data;
    return new Response(
      JSON.stringify({
        jsonrpc: "2.0",
        id: "view",
        result: {
          block_height: call.blockHeight,
          block_hash: call.blockHash,
          result: [...Buffer.from(JSON.stringify(data))],
        },
      }),
    );
  });
  return { client, requests };
}
describe("Rhea snapshot from recorded RPC", () => {
  it("preserves internal bigint balances and protocol APRs on one block", async () => {
    const { client, requests } = replay();
    const result = await readPosition(client, cfg, accountId);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.collateral).toEqual([
      { tokenId: "usdc.fakes.testnet", internal: 5202203689933009073310n },
    ]);
    expect(result.value.borrowed[0]?.internal).toBe(121098520756n);
    expect(result.value.assets["usdc.fakes.testnet"]?.supplyAprBps).toBe(23688);
    expect(result.value.assets["usdc.fakes.testnet"]?.borrowAprBps).toBeGreaterThan(0);
    expect(result.value.prices["usdc.fakes.testnet"]).toBeUndefined();
    const health = healthBps(result.value, result.value.readAtMs);
    expect(health.ok ? null : health.error.kind).toBe("missing_price");
    expect(result.value.prices["wrap.testnet"]).toEqual({
      multiplier: 960n,
      decimals: 26,
      publishTimeMs: null,
      source: "default_price",
    });
    expect(result.value.blockHeight).toBe(fixture._provenance.blockHeight);
    expect(requests[0]?.finality).toBe("final");
    expect(
      requests.slice(1).every((p) => p.block_id === fixture._provenance.blockHash && !p.finality),
    ).toBe(true);
  });
  it("returns an empty snapshot for an unregistered account", async () => {
    const { client } = replay((method, data) => (method === "get_account" ? null : data));
    const result = await readPosition(client, cfg, accountId);
    expect(result.ok && result.value.collateral).toEqual([]);
    expect(result.ok && result.value.borrowed).toEqual([]);
  });
  it("preserves unknown position assets so the engine can refuse them", async () => {
    const { client } = replay((method, data) =>
      method === "get_account"
        ? {
            account_id: accountId,
            supplied: [],
            collateral: [{ token_id: "unknown.testnet", balance: "1" }],
            borrowed: [],
          }
        : data,
    );
    const result = await readPosition(client, cfg, accountId);
    expect(result.ok && result.value.collateral[0]?.tokenId).toBe("unknown.testnet");
    expect(result.ok && result.value.assets["unknown.testnet"]).toBeUndefined();
  });
  it.each([
    "get_account",
    "get_config",
    "get_assets_paged_detailed",
    "get_all_token_pyth_infos",
    "ft_metadata",
  ])("refuses malformed %s", async (method) => {
    const { client } = replay((name, data) => (name === method ? "bad" : data));
    const result = await readPosition(client, cfg, accountId);
    expect(result.ok ? null : result.error.kind).toBe("bad_response");
  });
  it("does not relabel RPC failure as an empty position", async () => {
    const client = createRheaClient("https://rpc.example", async () => {
      throw new Error("offline");
    });
    const result = await readPosition(client, cfg, accountId);
    expect(result.ok ? null : result.error.kind).toBe("rpc_unavailable");
  });
  it("paginates market assets and exposes unsupported synthetic assets", async () => {
    const { client } = replay();
    const result = await readMarket(client, cfg);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Object.keys(result.value.assets).length).toBeGreaterThan(2);
    expect(result.value.unsupportedTokenIds).toContain("shadow_ref_v1-269");
  });
  it("parses a recorded mainnet position and computes health from its recorded prices", async () => {
    const mainnet = JSON.parse(
      readFileSync(new URL("../../../fixtures/rhea/mainnet-reads.json", import.meta.url), "utf8"),
    );
    const { client, requests } = replay(undefined, mainnet);
    const result = await readPosition(
      client,
      { network: "mainnet", lendingId: mainnet._provenance.lendingId },
      mainnet._provenance.accountId,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const now = Date.parse(mainnet._provenance.recordedAt);
    const snapshot = { ...result.value, readAtMs: now };
    const health = healthBps(snapshot, now);
    expect(health.ok).toBe(true);
    expect(health.ok && typeof health.value.value).toBe("number");
    expect(result.value.assets["wrap.near"]?.token.decimals).toBe(24);
    expect(result.value.prices["wrap.near"]?.decimals).toBe(28);
    expect(requests.filter((p) => p.method_name === "get_assets_paged_detailed")).toHaveLength(2);
    const stale = healthBps(snapshot, now + 120001);
    expect(stale.ok ? null : stale.error.kind).toBe("stale_snapshot");
  });
  it("rejects responses from a different block", async () => {
    const { client } = replay();
    const view = client.view.bind(client);
    client.view = async (...args) => {
      const result = await view(...args);
      return result.ok && args[1] === "get_account"
        ? { ok: true, value: { ...result.value, blockHash: "wrong-block" } }
        : result;
    };
    const result = await readPosition(client, cfg, accountId);
    expect(result.ok ? null : result.error.kind).toBe("bad_response");
  });
  it("applies the derivative exchange rate only to oracle prices", async () => {
    const { client } = replay((method, data) => {
      if (method === "get_account")
        return {
          account_id: accountId,
          supplied: [],
          collateral: [
            { token_id: "linear-protocol.testnet", balance: "1000000000000000000000000" },
          ],
          borrowed: [],
        };
      if (method === "get_price_no_older_than")
        return { price: "500000000", conf: "1", expo: -8, publish_time: 1793927434 };
      if (method === "ft_price") return "2000000000000000000000000";
      return data;
    });
    const result = await readPosition(client, cfg, accountId);
    expect(result.ok && result.value.prices["linear-protocol.testnet"]?.multiplier).toBe(100000n);
  });
  it.each(["get_price_no_older_than", "ft_price"])(
    "refuses malformed %s without a fallback",
    async (broken) => {
      const { client } = replay((method, data) => {
        if (method === "get_account")
          return {
            account_id: accountId,
            supplied: [],
            collateral: [{ token_id: "linear-protocol.testnet", balance: "1" }],
            borrowed: [],
          };
        if (method === broken) return "bad";
        if (method === "get_price_no_older_than")
          return { price: "500000000", conf: "1", expo: -8, publish_time: 1793927434 };
        return data;
      });
      const result = await readPosition(client, cfg, accountId);
      expect(result.ok ? null : result.error.kind).toBe("bad_response");
    },
  );
});
describe("untrusted view parsing", () => {
  it("rounds supply APR down and borrow APR up with exact decimals", () => {
    expect(parseAprBps("0.140199999999999999999999999", false)).toBe(1401);
    expect(parseAprBps("0.210000000000000000000000001", true)).toBe(2101);
    expect(parseAprBps("0.0", true)).toBe(0);
    for (const v of ["-1", "1e6", "NaN", 0.14]) expect(() => parseAprBps(v, false)).toThrow();
  });
  it("rejects lossy balances and account mismatches", () => {
    for (const balance of [1, "-1", "1.2", "01", (2n ** 128n).toString()])
      expect(() =>
        parseAccount(
          {
            account_id: accountId,
            supplied: [{ token_id: "wrap.testnet", balance }],
            collateral: [],
            borrowed: [],
          },
          accountId,
        ),
      ).toThrow();
    expect(() =>
      parseAccount(
        { account_id: "other.testnet", supplied: [], collateral: [], borrowed: [] },
        accountId,
      ),
    ).toThrow();
  });
  it("normalizes Pyth prices to USD per atomic unit using Rhea fraction digits", () => {
    expect(
      parseOraclePrice(
        { price: "372683888", conf: "916112", expo: -8, publish_time: 1793927434 },
        { decimals: 24, fractionDigits: 4 },
      ),
    ).toEqual({ multiplier: 37268n, decimals: 28, publishTimeMs: 1793927434000, source: "oracle" });
    expect(parseOraclePrice(null, { decimals: 6, fractionDigits: 4 })).toBeNull();
    expect(() =>
      parseOraclePrice(
        { price: "-1", expo: -8, publish_time: 1 },
        { decimals: 6, fractionDigits: 4 },
      ),
    ).toThrow();
  });
});
