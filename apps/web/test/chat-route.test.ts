import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";

const recording = JSON.parse(
  readFileSync(new URL("../../../fixtures/rhea/testnet-reads.json", import.meta.url), "utf8"),
);
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
});
describe("production chat route", () => {
  it("uses configured native provider and real RPC adapter rather than injected fixture context", async () => {
    vi.stubEnv("NEARAI_API_KEY", "test-secret");
    vi.stubEnv("NEARAI_MODEL", "z-ai/glm-5.3-flash");
    vi.stubEnv("NEARAI_BASE_URL", "https://cloud-api.near.ai/v1");
    vi.stubEnv("NEAR_NETWORK_ID", "testnet");
    vi.stubEnv("NEAR_RPC_URL", "https://rpc.example");
    vi.stubEnv("RHEA_LENDING_ID", recording._provenance.lendingId);
    vi.stubEnv("GUARDIAN_FACTORY_ID", "");
    const targets: string[] = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      targets.push(String(url));
      const body = JSON.parse(String(init.body));
      if (String(url).includes("cloud-api.near.ai"))
        return Response.json({
          choices: [{ message: { content: "Hello. I can explain your position." } }],
          usage: { prompt_tokens: 10, completion_tokens: 9 },
        });
      if (body.method === "status") return Response.json({ result: { chain_id: "testnet" } });
      const p = body.params;
      const args = JSON.parse(Buffer.from(p.args_base64, "base64").toString("utf8"));
      const call = recording.calls.find(
        (c: { contractId: string; method: string; args: unknown }) =>
          c.contractId === p.account_id &&
          c.method === p.method_name &&
          JSON.stringify(c.args) === JSON.stringify(args),
      );
      if (!call) throw new Error("Unrecorded RPC");
      return Response.json({
        result: {
          block_height: call.blockHeight,
          block_hash: call.blockHash,
          result: [...Buffer.from(JSON.stringify(call.data))],
        },
      });
    });
    // Module loading is part of this test: route configuration must see the server-only env.
    const { POST } = await import("../src/app/api/chat/route");
    const response = await POST(
      new Request("https://app.example/api/chat", {
        method: "POST",
        body: JSON.stringify({ message: "Hello", accountId: recording._provenance.accountId }),
        headers: { "content-type": "application/json" },
      }),
    );
    const text = await response.text();
    expect(text).toContain('"status":"ok"');
    expect(targets).toContain("https://rpc.example/");
    expect(targets).toContain("https://cloud-api.near.ai/v1/chat/completions");
    expect(text).not.toContain("test-secret");
  });
});
