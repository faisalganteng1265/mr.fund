import { readFileSync } from "node:fs";
import { createRheaClient } from "@mrfund/rhea";
import { err } from "@mrfund/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeClient, NOW, target } from "../../../packages/guardian-client/test/fixture";
import { createWatcherReads, watcherReads } from "../src/runtime/reads";

const fixture = JSON.parse(
  readFileSync(new URL("../../../fixtures/rhea/testnet-reads.json", import.meta.url), "utf8"),
);
function replay(version = "0.11.0", mixed = false) {
  const requests: { method: string; block?: string }[] = [];
  const client = createRheaClient("https://rpc.example", async (_url, init) => {
    const p = JSON.parse(String(init?.body)).params;
    const args = JSON.parse(Buffer.from(p.args_base64, "base64").toString());
    const found = fixture.calls.find(
      (c: { contractId: string; method: string; args: unknown }) =>
        c.contractId === p.account_id &&
        c.method === p.method_name &&
        JSON.stringify(c.args) === JSON.stringify(args),
    );
    const data = p.method_name === "get_version" ? version : found?.data;
    requests.push({ method: p.method_name, block: p.block_id });
    if (data === undefined) throw new Error("unrecorded");
    return Response.json({
      result: {
        block_hash:
          mixed && p.method_name === "get_version" ? "foreign" : fixture._provenance.blockHash,
        block_height: fixture._provenance.blockHeight,
        result: [...Buffer.from(JSON.stringify(data))],
      },
    });
  });
  return { client, requests };
}

describe("watcher runtime read adapters", () => {
  beforeEach(() => vi.spyOn(Date, "now").mockReturnValue(NOW));
  afterEach(() => vi.restoreAllMocks());
  it("uses pinned Guardian and recorded Rhea views after network verification", async () => {
    const guardian = fakeClient();
    const rhea = replay();
    const networkMatches = vi.fn(async () => true);
    const reads = watcherReads("testnet", { guardian, rhea: rhea.client, networkMatches });
    expect((await reads.guardian(target)).ok).toBe(true);
    const result = await reads.position(
      "testnet",
      fixture._provenance.lendingId,
      fixture._provenance.accountId,
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.accountId).toBe(fixture._provenance.accountId);
    expect(networkMatches).toHaveBeenCalledTimes(2);
    const version = rhea.requests.find((request) => request.method === "get_version");
    expect(version?.block).toBe(fixture._provenance.blockHash);
  });
  it("refuses wrong network before contract views and sanitizes transport errors", async () => {
    const guardian = fakeClient();
    const rhea = replay();
    const reads = watcherReads("testnet", {
      guardian,
      rhea: rhea.client,
      networkMatches: async () => {
        throw new Error("sentinel-secret");
      },
    });
    expect(await reads.guardian(target)).toEqual(
      err({ kind: "rpc_unavailable", detail: "Network verification failed" }),
    );
    expect(await reads.position("mainnet", "rhea.near", "alice.near")).toEqual(
      err({ kind: "rpc_unavailable", detail: "Network verification failed" }),
    );
    expect(guardian.calls).toHaveLength(0);
    expect(rhea.requests).toHaveLength(0);
    const mismatch = createWatcherReads("testnet", "https://rpc.example", async () =>
      Response.json({ result: { chain_id: "mainnet" } }),
    );
    expect((await mismatch.guardian(target)).ok).toBe(false);
  });
  it("rejects an oversized status response before any contract views", async () => {
    const fetcher = vi.fn(async () => new Response("x".repeat(16_385)));
    const reads = createWatcherReads("testnet", "https://rpc.example", fetcher);
    expect(await reads.guardian(target)).toEqual(
      err({ kind: "rpc_unavailable", detail: "Network verification failed" }),
    );
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it.each([
    ["9.0.0", false],
    ["0.11.0", true],
  ])("refuses unsupported or mixed-block version: %s", async (version, mixed) => {
    const rhea = replay(version as string, mixed as boolean);
    const reads = watcherReads("testnet", {
      guardian: fakeClient(),
      rhea: rhea.client,
      networkMatches: async () => true,
    });
    const result = await reads.position(
      "testnet",
      fixture._provenance.lendingId,
      fixture._provenance.accountId,
    );
    expect(result).toEqual(err({ kind: "bad_response", detail: "Position read failed" }));
    expect(rhea.requests.map((r) => r.method)).toEqual(["get_config", "get_version"]);
  });
});
