import { expect, it, vi } from "vitest";
import { createGuardianClient } from "../src/client";

const transport = (body: unknown) => vi.fn(async () => new Response(JSON.stringify(body)));
it("uses finality for anchor, an explicit block for subsequent reads, and UTF8 bytes", async () => {
  const fetcher = vi.fn(
    async (_url: string | URL | Request, _init?: RequestInit) =>
      new Response(
        JSON.stringify({
          result: {
            block_height: 123,
            block_hash: "block",
            result: [...new TextEncoder().encode(JSON.stringify({ value: "日本語" }))],
          },
        }),
      ),
  );
  const client = createGuardianClient("https://rpc.example", fetcher);
  expect(await client.view("guardian.testnet", "get_status", {})).toEqual({
    ok: true,
    value: { data: { value: "日本語" }, blockHeight: 123, blockHash: "block" },
  });
  await client.view("guardian.testnet", "get_history", { from: 0, limit: 50 }, "block");
  expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body)).params.finality).toBe("final");
  const p = JSON.parse(String(fetcher.mock.calls[1]?.[1]?.body)).params;
  expect(p.block_id).toBe("block");
  expect(p.finality).toBeUndefined();
});
it("distinguishes unknown account from malformed view without exposing provider messages", async () => {
  for (const [body, kind] of [
    [{ error: { cause: { name: "UNKNOWN_ACCOUNT", info: { secret: "private" } } } }, "not_found"],
    [{ error: { message: "private" } }, "bad_response"],
    [{ result: { block_height: 1, block_hash: "block", result: [256] } }, "bad_response"],
  ] as const) {
    const r = await createGuardianClient("https://rpc.example", transport(body)).view(
      "guardian.testnet",
      "get_config",
      {},
    );
    expect(r.ok ? null : r.error.kind).toBe(kind);
    expect(JSON.stringify(r)).not.toContain("private");
  }
});
it("bounds RPC responses and sanitizes transport failures", async () => {
  const r = await createGuardianClient("https://rpc.example", async () => {
    throw new Error("private");
  }).view("guardian.testnet", "get_status", {});
  expect(r.ok ? null : r.error.kind).toBe("rpc_unavailable");
  expect(JSON.stringify(r)).not.toContain("private");
  const fetcher = transport({});
  expect(
    (await createGuardianClient("https://rpc.example", fetcher).view("INVALID!", "get_status", {}))
      .ok,
  ).toBe(false);
  expect(fetcher).not.toHaveBeenCalled();
});

it("distinguishes response body disconnects and transient RPC failures from malformed JSON", async () => {
  const broken = async () =>
    new Response(
      new ReadableStream({
        start(controller) {
          controller.error(new Error("private transport detail"));
        },
      }),
    );
  for (const fetcher of [
    broken,
    transport({ error: { cause: { name: "TIMEOUT_ERROR" } } }),
    transport({ error: { code: -32603, message: "private" } }),
  ]) {
    const r = await createGuardianClient("https://rpc.example", fetcher).view(
      "guardian.testnet",
      "get_status",
      {},
    );
    expect(r.ok ? null : r.error.kind).toBe("rpc_unavailable");
    expect(JSON.stringify(r)).not.toContain("private");
  }
  const r = await createGuardianClient(
    "https://rpc.example",
    async () => new Response("invalid json"),
  ).view("guardian.testnet", "get_status", {});
  expect(r.ok ? null : r.error.kind).toBe("bad_response");
});
it("allows only view methods, including token metadata, storage bounds, balances and the Rhea account", async () => {
  const fetcher = transport({
    result: { block_height: 1, block_hash: "b", result: [...new TextEncoder().encode("null")] },
  });
  const client = createGuardianClient("https://rpc.example", fetcher);
  for (const method of ["ft_metadata", "storage_balance_bounds", "ft_balance_of", "get_account"])
    expect((await client.view("usdc.testnet", method, {})).ok).toBe(true);
  for (const method of [
    "ft_transfer",
    "storage_deposit",
    "pause",
    "create_guardian",
    "owner_borrow",
    "owner_sweep",
    "execute",
  ])
    expect(await client.view("usdc.testnet", method, {})).toMatchObject({ ok: false });
  expect(fetcher).toHaveBeenCalledTimes(4);
});
