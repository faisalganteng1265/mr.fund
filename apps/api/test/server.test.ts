import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { createApiServer } from "../src/server";

const open: { close(): void }[] = [];
afterEach(() => {
  for (const s of open.splice(0)) s.close();
});

async function start(routes: Parameters<typeof createApiServer>[0]["routes"], corsOrigin = "*") {
  const server = createApiServer({ routes, corsOrigin });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  open.push(server);
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

describe("standalone API server", () => {
  it("answers a CORS preflight for a known route without calling the handler", async () => {
    let calls = 0;
    const base = await start(
      {
        "/api/chat": async () => {
          calls++;
          return new Response("x");
        },
      },
      "https://app.example",
    );
    const r = await fetch(`${base}/api/chat`, { method: "OPTIONS" });
    expect(r.status).toBe(204);
    expect(r.headers.get("access-control-allow-origin")).toBe("https://app.example");
    expect(r.headers.get("access-control-allow-headers")).toBe("content-type");
    expect(calls).toBe(0);
  });

  it("passes method, body and headers to the handler and adds CORS to the reply", async () => {
    const seen: { method: string; body: string; type: string | null; url: string }[] = [];
    const base = await start({
      "/api/position": async (req) => {
        seen.push({
          method: req.method,
          body: await req.text(),
          type: req.headers.get("content-type"),
          url: req.url,
        });
        return Response.json({ ok: true }, { status: 201, headers: { "x-test": "1" } });
      },
    });
    const r = await fetch(`${base}/api/position?x=1`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: '{"a":1}',
    });
    expect(r.status).toBe(201);
    expect(await r.json()).toEqual({ ok: true });
    expect(r.headers.get("x-test")).toBe("1");
    expect(r.headers.get("access-control-allow-origin")).toBe("*");
    expect(seen).toEqual([
      {
        method: "POST",
        body: '{"a":1}',
        type: "application/json",
        url: expect.stringMatching(/\/api\/position\?x=1$/),
      },
    ]);
  });

  it("returns 404 with CORS for other paths", async () => {
    const base = await start({ "/api/chat": async () => new Response("x") });
    for (const path of ["/", "/api/other", "/api/chat/extra"]) {
      const r = await fetch(`${base}${path}`, { method: "POST" });
      expect(r.status).toBe(404);
      expect(r.headers.get("access-control-allow-origin")).toBe("*");
    }
  });

  it("streams the body as it is produced", async () => {
    const base = await start({
      "/api/chat": async () => {
        const enc = new TextEncoder();
        const body = new ReadableStream({
          async start(c) {
            c.enqueue(enc.encode("data: one\n\n"));
            await new Promise((r) => setTimeout(r, 50));
            c.enqueue(enc.encode("data: two\n\n"));
            c.close();
          },
        });
        return new Response(body, { headers: { "content-type": "text/event-stream" } });
      },
    });
    const r = await fetch(`${base}/api/chat`, { method: "POST", body: "{}" });
    const reader = r.body?.getReader();
    const first = await reader?.read();
    expect(new TextDecoder().decode(first?.value)).toBe("data: one\n\n");
    const rest = await reader?.read();
    expect(new TextDecoder().decode(rest?.value)).toBe("data: two\n\n");
  });

  it("cancels the handler's signal when the client disconnects", async () => {
    let signal: AbortSignal | undefined;
    let started!: () => void;
    const ready = new Promise<void>((r) => {
      started = r;
    });
    const base = await start({
      "/api/chat": async (req) => {
        signal = req.signal;
        started();
        return new Promise<Response>(() => {});
      },
    });
    const controller = new AbortController();
    fetch(`${base}/api/chat`, { method: "POST", body: "{}", signal: controller.signal }).catch(
      () => {},
    );
    await ready;
    expect(signal?.aborted).toBe(false);
    controller.abort();
    await new Promise((r) => setTimeout(r, 100));
    expect(signal?.aborted).toBe(true);
  });

  it("a throwing handler becomes a 503 and never leaks the error", async () => {
    const base = await start({
      "/api/chat": async () => {
        throw new Error("secret internal detail");
      },
    });
    const r = await fetch(`${base}/api/chat`, { method: "POST", body: "{}" });
    expect(r.status).toBe(503);
    expect(await r.text()).not.toContain("secret");
  });
});
