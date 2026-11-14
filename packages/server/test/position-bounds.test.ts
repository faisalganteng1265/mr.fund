import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPositionHandler } from "../src/position/handler";
import { config, rpc } from "./position-rpc";

const url = "https://app.example/api/position?accountId=alice.testnet&networkId=testnet";
function post(body: ReadableStream<Uint8Array>, signal?: AbortSignal) {
  return new Request("https://app.example/api/position", {
    method: "POST",
    headers: { "content-type": "application/json", "content-length": "1" },
    body,
    ...(signal ? { signal } : {}),
    duplex: "half",
  } as RequestInit);
}
describe("bounded position transport", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(AbortSignal, "timeout").mockImplementation((ms) => {
      const controller = new AbortController();
      setTimeout(() => controller.abort(new DOMException("Timed out", "TimeoutError")), ms);
      return controller.signal;
    });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });
  it("cancels a stalled request body at the total deadline before any RPC", async () => {
    let cancelled = false,
      calls = 0;
    const body = new ReadableStream<Uint8Array>({
      cancel() {
        cancelled = true;
      },
    });
    const fetchImpl: typeof fetch = async () => {
      calls++;
      throw new Error("unexpected RPC");
    };
    const pending = createPositionHandler({ config, fetchImpl })(post(body));
    await vi.advanceTimersByTimeAsync(14999);
    expect(cancelled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const response = await pending;
    expect(response.status).toBe(504);
    expect(cancelled).toBe(true);
    expect(calls).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("cancels a disconnected body and returns no later RPC", async () => {
    const controller = new AbortController();
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      cancel() {
        cancelled = true;
      },
    });
    const pending = createPositionHandler({ config })(post(body, controller.signal));
    controller.abort();
    expect((await pending).status).toBe(499);
    expect(cancelled).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("counts streamed bytes, not declared Content-Length, and checks UTF-8 query bytes", async () => {
    for (const length of [1024, 1025]) {
      const body = new ReadableStream<Uint8Array>({
        start(c) {
          c.enqueue(new TextEncoder().encode(" ".repeat(length)));
          c.close();
        },
      });
      expect((await createPositionHandler({ config })(post(body))).status).toBe(
        length === 1024 ? 400 : 413,
      );
    }
    for (const length of [512, 513])
      expect(
        (
          await createPositionHandler({ config })(
            new Request(`https://app.example/api/position?${"x".repeat(length)}`),
          )
        ).status,
      ).toBe(length === 512 ? 400 : 413);
    expect(
      (
        await createPositionHandler({ config })(
          new Request(`https://app.example/api/position?${"é".repeat(100)}`),
        )
      ).status,
    ).toBe(413);
  });
  it("stops stalled RPC headers at the shorter deadline without another view", async () => {
    let calls = 0;
    let signal: AbortSignal | null | undefined;
    const fetchImpl: typeof fetch = (_target, init) => {
      calls++;
      signal = init?.signal;
      return new Promise(() => {});
    };
    const pending = createPositionHandler({ config, fetchImpl })(new Request(url));
    await vi.advanceTimersByTimeAsync(10000);
    expect((await pending).status).toBe(504);
    expect(signal?.aborted).toBe(true);
    expect(calls).toBe(1);
  });
  it("aborts stalled RPC response bodies and preserves downstream timeout classification", async () => {
    let cancelled = false;
    let calls = 0;
    const fetchImpl: typeof fetch = async () => {
      calls++;
      return new Response(
        new ReadableStream<Uint8Array>({
          cancel() {
            cancelled = true;
          },
        }),
      );
    };
    const pending = createPositionHandler({ config, fetchImpl })(new Request(url));
    await vi.advanceTimersByTimeAsync(10000);
    expect((await pending).status).toBe(504);
    expect(cancelled).toBe(true);
    expect(calls).toBe(1);
  });
  it("honors caller abort inside snapshot views without another view", async () => {
    const controller = new AbortController();
    const remote = rpc();
    let count = 0;
    const fetchImpl: typeof fetch = async (target, init) => {
      count++;
      if (count === 3) {
        controller.abort();
        return new Promise(() => {});
      }
      return remote.fetchImpl(target, init);
    };
    const response = await createPositionHandler({ config, fetchImpl })(
      new Request(url, { signal: controller.signal }),
    );
    expect(response.status).toBe(499);
    expect(count).toBe(3);
  });
  it("enforces the whole deadline across otherwise shorter sequential RPC calls", async () => {
    const remote = rpc();
    let calls = 0;
    const fetchImpl: typeof fetch = async (target, init) => {
      calls++;
      await new Promise((resolve) => setTimeout(resolve, 6000));
      return remote.fetchImpl(target, init);
    };
    const pending = createPositionHandler({ config, fetchImpl })(new Request(url));
    await vi.advanceTimersByTimeAsync(15000);
    expect((await pending).status).toBe(504);
    expect(calls).toBe(3);
  });
  it("retains timeout causality when the snapshot adapter collapses transport errors", async () => {
    const remote = rpc();
    let stalled = false;
    const fetchImpl: typeof fetch = async (target, init) => {
      const body = JSON.parse(String(init?.body));
      if (body.params?.method_name === "get_account") {
        stalled = true;
        return new Response(new ReadableStream<Uint8Array>());
      }
      return remote.fetchImpl(target, init);
    };
    const pending = createPositionHandler({ config, fetchImpl })(new Request(url));
    await vi.advanceTimersByTimeAsync(10000);
    expect((await pending).status).toBe(504);
    expect(stalled).toBe(true);
  });
  it("retains the 4 MiB RPC response ceiling", async () => {
    const fetchImpl: typeof fetch = async () => new Response("x".repeat(4194305));
    expect((await createPositionHandler({ config, fetchImpl })(new Request(url))).status).toBe(502);
  });
});
