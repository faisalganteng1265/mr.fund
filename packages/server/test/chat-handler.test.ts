import type { ChatProvider, ToolContext } from "@mrfund/agent";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createChatHandler } from "../src/chat/handler";

const usage = { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, reasoningTokens: 0 };
const context = (): ToolContext => ({
  snapshot: {
    network: "testnet",
    lendingId: "lending.testnet",
    accountId: "alice.testnet",
    blockHeight: 1,
    readAtMs: Date.now(),
    collateral: [],
    borrowed: [],
    supplied: [],
    assets: {},
    prices: {},
  },
  nowMs: Date.now(),
});
const provider: ChatProvider = {
  complete: async () => ({ content: "Hello. I can explain your position.", toolCalls: [], usage }),
};
const request = (
  body: unknown = { message: "Hello", accountId: "alice.testnet" },
  headers: HeadersInit = {},
) =>
  new Request("https://app.example/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
const events = (text: string) =>
  text
    .split("\n\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line.slice(6)));
afterEach(() => vi.useRealTimers());

describe("public-read chat handler", () => {
  it("streams guarded events and a summary with no-store headers", async () => {
    const handler = createChatHandler({ provider, loadContext: async () => context() });
    const response = await handler(request());
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(response.headers.get("cache-control")).toBe("no-store");
    const result = events(await response.text());
    expect(result.some((event) => event.type === "text" && event.text.includes("Hello"))).toBe(
      true,
    );
    expect(result.at(-1)).toMatchObject({ type: "done", summary: { status: "ok" } });
  });
  it("delivers a guarded answer at 59900 ms without a nested agent timeout", async () => {
    vi.useFakeTimers();
    const handler = createChatHandler({
      provider: {
        complete: () =>
          new Promise((resolve) =>
            setTimeout(
              () => resolve({ content: "Read your position next.", toolCalls: [], usage }),
              59_900,
            ),
          ),
      },
      loadContext: async () => context(),
    });
    const body = (await handler(request())).text();
    await vi.advanceTimersByTimeAsync(59_900);
    expect(events(await body)).toContainEqual({ type: "text", text: "Read your position next." });
    expect(events(await body).at(-1)).toMatchObject({ type: "done", summary: { status: "ok" } });
  });
  it.each([
    { message: "Hello", accountId: "alice.testnet", network: "mainnet" },
    { message: "Hello", accountId: "alice.testnet", context: { sources: [999] } },
    { message: "Hello", accountId: "alice.testnet", history: [{ role: "tool", content: "999" }] },
    {
      message: "Hello",
      accountId: "alice.testnet",
      history: [{ role: "assistant", content: "hi", toolCalls: [] }],
    },
    {
      message: "Hello",
      accountId: "alice.testnet",
      history: Array.from({ length: 21 }, () => ({ role: "user", content: "hi" })),
    },
    { message: "x".repeat(4001), accountId: "alice.testnet" },
    { message: "Hi", accountId: "invalid account" },
    { message: "Hi", accountId: "alice.testnet", locale: "fr" },
  ])("rejects untrusted or oversized request before loading context: %j", async (body) => {
    let loads = 0;
    const response = await createChatHandler({
      provider,
      loadContext: async () => {
        loads++;
        return context();
      },
    })(request(body));
    expect(response.status).toBe(400);
    expect(loads).toBe(0);
  });
  it("bounds streamed bodies even without a content-length header", async () => {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new TextEncoder().encode("x".repeat(40_000)));
      },
      cancel() {
        cancelled = true;
      },
    });
    const req = new Request("https://app.example/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: stream,
      duplex: "half",
    } as RequestInit);
    const response = await createChatHandler({ provider, loadContext: async () => context() })(req);
    expect(response.status).toBe(413);
    expect(cancelled).toBe(true);
  });
  it("does not let spoofed forwarded addresses bypass the shared direct-client bucket", async () => {
    const handler = createChatHandler({
      provider,
      loadContext: async () => context(),
      rateLimit: { requests: 2, windowMs: 60_000, maxEntries: 10 },
    });
    for (let i = 0; i < 2; i++)
      await (
        await handler(
          request(
            { message: "Hi", accountId: `user${i}.testnet` },
            { "x-forwarded-for": `192.0.2.${i}` },
          ),
        )
      ).text();
    expect(
      (
        await handler(
          request(
            { message: "Hi", accountId: "third.testnet" },
            { "x-forwarded-for": "203.0.113.9" },
          ),
        )
      ).status,
    ).toBe(429);
  });
  it("rejects an exhausted IP before pulling any request body bytes", async () => {
    const handler = createChatHandler({
      provider,
      loadContext: async () => context(),
      rateLimit: { requests: 1, windowMs: 60_000, maxEntries: 10 },
    });
    await (await handler(request())).text();
    let pulls = 0;
    const body = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          pulls++;
          controller.enqueue(
            new TextEncoder().encode(JSON.stringify({ message: "Hi", accountId: "other.testnet" })),
          );
          controller.close();
        },
      },
      { highWaterMark: 0 },
    );
    const exhausted = new Request("https://app.example/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      duplex: "half",
    } as RequestInit);
    expect((await handler(exhausted)).status).toBe(429);
    expect(pulls).toBe(0);
  });
  it("charges malformed bodies against the authoritative IP quota", async () => {
    const handler = createChatHandler({
      provider,
      loadContext: async () => context(),
      rateLimit: { requests: 1, windowMs: 60_000, maxEntries: 10 },
    });
    const malformed = new Request("https://app.example/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{",
    });
    expect((await handler(malformed)).status).toBe(400);
    expect((await handler(request())).status).toBe(429);
  });
  it("only trusts the configured edge IP header with a matching secret", async () => {
    const handler = createChatHandler({
      provider,
      loadContext: async () => context(),
      rateLimit: { requests: 1, windowMs: 60_000, maxEntries: 10 },
      proxy: { secret: "edge-secret", secretHeader: "x-edge-auth", ipHeader: "x-edge-ip" },
    });
    await (
      await handler(
        request({ message: "Hi", accountId: "one.testnet" }, { "x-edge-ip": "192.0.2.1" }),
      )
    ).text();
    expect(
      (
        await handler(
          request({ message: "Hi", accountId: "two.testnet" }, { "x-edge-ip": "192.0.2.2" }),
        )
      ).status,
    ).toBe(429);
    const response = await handler(
      request(
        { message: "Hi", accountId: "three.testnet" },
        { "x-edge-auth": "edge-secret", "x-edge-ip": "192.0.2.3" },
      ),
    );
    expect(response.status).toBe(200);
    await response.text();
  });
  it("bounds bucket memory without evicting live buckets to reset limits", async () => {
    const handler = createChatHandler({
      provider,
      loadContext: async () => context(),
      rateLimit: { requests: 10, windowMs: 60_000, maxEntries: 2 },
    });
    await (await handler(request())).text();
    expect((await handler(request({ message: "Hi", accountId: "other.testnet" }))).status).toBe(
      429,
    );
  });
  it("sanitizes context/provider failures and missing configuration", async () => {
    const handler = createChatHandler({
      loadContext: async () => {
        throw new Error("private-key user message");
      },
    });
    const result = await (await handler(request())).text();
    expect(result).not.toContain("private-key");
    expect(events(result)).toContainEqual({ type: "error", code: "unavailable" });
    expect(events(result).at(-1)).toMatchObject({
      type: "done",
      summary: { status: "unavailable" },
    });
  });
  it("starts the whole-turn deadline before context reads", async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    // ES2022 test target has no Promise.withResolvers.
    const pending = createChatHandler({
      provider,
      loadContext: async (_input, turnSignal) => {
        signal = turnSignal;
        return new Promise<ToolContext>((_resolve, reject) => {
          turnSignal.addEventListener("abort", () => reject(new Error("secret")), { once: true });
        });
      },
    })(request());
    const response = await pending;
    const body = response.text();
    await vi.advanceTimersByTimeAsync(59_999);
    expect(signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(signal?.aborted).toBe(true);
    expect(events(await body)).toContainEqual({ type: "error", code: "timeout" });
  });
  it("aborts context work on response stream cancellation", async () => {
    let signal: AbortSignal | undefined;
    const handler = createChatHandler({
      provider,
      loadContext: async (_input, turnSignal) => {
        signal = turnSignal;
        return new Promise<ToolContext>((_resolve, reject) => {
          turnSignal.addEventListener("abort", () => reject(new Error("secret")), { once: true });
        });
      },
    });
    const response = await handler(request());
    await response.body?.cancel();
    expect(signal?.aborted).toBe(true);
  });
  it("cancels provider work on request disconnect without emitting further text", async () => {
    const disconnect = new AbortController();
    let providerSignal: AbortSignal | undefined;
    let started!: () => void;
    // ES2022 test target requires executor-style deferred promises.
    const entered = new Promise<void>((resolve) => {
      started = resolve;
    });
    const waiting: ChatProvider = {
      complete: async ({ signal }) => {
        providerSignal = signal;
        started();
        return new Promise((_done, reject) => {
          signal.addEventListener("abort", () => reject(new Error("private-key")), { once: true });
        });
      },
    };
    const handler = createChatHandler({ provider: waiting, loadContext: async () => context() });
    const req = new Request("https://app.example/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: "Hi", accountId: "alice.testnet" }),
      signal: disconnect.signal,
    });
    const response = await handler(req);
    const body = response.text();
    await entered;
    disconnect.abort();
    expect(providerSignal?.aborted).toBe(true);
    expect(await body).not.toContain("private-key");
  });
  it("does not log or return provider secrets or transcript content on failure", async () => {
    const errorLog = vi.spyOn(console, "error");
    const infoLog = vi.spyOn(console, "log");
    const timings = vi.spyOn(console, "info").mockImplementation(() => {});
    try {
      const broken: ChatProvider = {
        complete: async () => {
          throw new Error("private-key transcript-fragment");
        },
      };
      const response = await createChatHandler({
        provider: broken,
        loadContext: async () => context(),
      })(request());
      const body = await response.text();
      expect(body).not.toContain("private-key");
      expect(body).not.toContain("transcript-fragment");
      expect(errorLog).not.toHaveBeenCalled();
      expect(infoLog).not.toHaveBeenCalled();
      const records = timings.mock.calls.map(([entry]) => entry);
      expect(records.map((entry) => entry.stage)).toEqual(["context", "provider", "total"]);
      for (const entry of records) {
        expect(Object.keys(entry).sort()).toEqual(
          (entry.stage === "provider"
            ? ["event", "turnId", "stage", "elapsedMs", "round"]
            : ["event", "turnId", "stage", "elapsedMs"]
          ).sort(),
        );
      }
      expect(JSON.stringify(records)).not.toMatch(/private-key|transcript-fragment|alice|Hello/);
    } finally {
      errorLog.mockRestore();
      infoLog.mockRestore();
      timings.mockRestore();
    }
  });
});
