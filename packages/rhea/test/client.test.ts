import { describe, expect, it, vi } from "vitest";
import { createRheaClient } from "../src/client";

const envelope = (data: unknown) => ({
  jsonrpc: "2.0",
  id: "view",
  result: {
    block_height: 123,
    block_hash: "block",
    result: [...Buffer.from(JSON.stringify(data))],
    logs: [],
  },
});
const transport = (body: unknown) =>
  vi.fn(
    async (_url: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify(body)),
  );

describe("read-only RPC client", () => {
  it("encodes UTF-8 arguments without requiring a browser Buffer polyfill", async () => {
    const bodyData = envelope(null);
    const fetcher = vi.fn(
      async (_url: string | URL | Request, _init?: RequestInit) =>
        ({ ok: true, json: async () => bodyData }) as Response,
    );
    vi.stubGlobal("Buffer", undefined);
    try {
      expect(
        (
          await createRheaClient("https://rpc.example", fetcher).view("rhea.near", "get_config", {
            label: "日本語",
          })
        ).ok,
      ).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
    const body = JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body));
    expect(Buffer.from(body.params.args_base64, "base64").toString("utf8")).toBe(
      JSON.stringify({ label: "日本語" }),
    );
  });
  it("posts one view object and returns unknown data with block provenance", async () => {
    const fetcher = transport(envelope({ amount: "18446744073709551616" }));
    const result = await createRheaClient("https://rpc.example", fetcher).view(
      "rhea.near",
      "get_account",
      { account_id: "alice.near" },
    );
    expect(result).toEqual({
      ok: true,
      value: { data: { amount: "18446744073709551616" }, blockHeight: 123, blockHash: "block" },
    });
    const body = JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body));
    expect(Array.isArray(body)).toBe(false);
    expect(body.params).toMatchObject({
      request_type: "call_function",
      finality: "final",
      account_id: "rhea.near",
      method_name: "get_account",
    });
    expect(JSON.parse(Buffer.from(body.params.args_base64, "base64").toString())).toEqual({
      account_id: "alice.near",
    });
  });
  it("pins subsequent views to an explicit block without finality", async () => {
    const fetcher = transport(envelope(null));
    await createRheaClient("https://rpc.example", fetcher).view(
      "rhea.near",
      "get_account",
      {},
      "block",
    );
    const body = JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body));
    expect(body.params.block_id).toBe("block");
    expect(body.params.finality).toBeUndefined();
  });
  it("maps transport and HTTP failures without leaking raw errors", async () => {
    const fetcher = vi.fn(async () => {
      throw new Error("secret provider detail");
    });
    expect(
      await createRheaClient("https://rpc.example", fetcher).view("rhea.near", "get_config", {}),
    ).toEqual({ ok: false, error: { kind: "rpc_unavailable", detail: "RPC request failed" } });
    expect(
      (
        await createRheaClient(
          "https://rpc.example",
          async () => new Response("down", { status: 503 }),
        ).view("rhea.near", "get_config", {})
      ).ok,
    ).toBe(false);
  });
  it.each([
    {},
    { error: { message: "contract failed" } },
    { result: { block_height: 123, block_hash: "block", result: [] } },
    { result: { block_height: 123, block_hash: "block", result: [256] } },
    { result: { block_height: 123, block_hash: "block", result: [123] } },
  ])("refuses malformed or error envelopes", async (body) => {
    const result = await createRheaClient("https://rpc.example", transport(body)).view(
      "rhea.near",
      "get_config",
      {},
    );
    expect(result.ok ? null : result.error.kind).toBe("bad_response");
  });
  it("rejects invalid contract ids before doing I/O", async () => {
    const fetcher = transport(envelope(null));
    expect(
      (await createRheaClient("https://rpc.example", fetcher).view("INVALID!", "get_config", {}))
        .ok,
    ).toBe(false);
    expect(fetcher).not.toHaveBeenCalled();
  });
});
