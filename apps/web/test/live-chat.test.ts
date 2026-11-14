import { describe, expect, it } from "vitest";
import { LiveChatError, streamLiveChat } from "../src/play/source/liveChat";

const request = { message: "hi", accountId: "alice.near", history: [] };
const collect = async (fetcher: typeof fetch, signal = new AbortController().signal) => {
  const events = [];
  for await (const event of streamLiveChat(request, signal, fetcher)) events.push(event);
  return events;
};
const response =
  (body: string, status = 200): typeof fetch =>
  async () =>
    new Response(body, { status });

describe("live chat stream", () => {
  it("decodes split UTF-8 and frame boundaries and ignores unknown events", async () => {
    const bytes = new TextEncoder().encode(
      'data: {"type":"text","text":"café"}\n\ndata: {"type":"future"}\n\ndata: {"type":"done","summary":{}}\n\n',
    );
    const fetcher: typeof fetch = async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
            controller.close();
          },
        }),
      );
    expect(await collect(fetcher)).toEqual([
      { type: "text", text: "café" },
      { type: "done", summary: {} },
    ]);
  });

  it("classifies malformed and incomplete streams", async () => {
    await expect(collect(response("data: {bad}\n\n"))).rejects.toMatchObject({
      code: "invalid_stream",
    });
    await expect(
      collect(response('data: {"type":"text","text":"partial"}\n\n')),
    ).rejects.toMatchObject({ code: "interrupted" });
  });

  it.each([
    [400, "invalid_request"],
    [429, "rate_limited"],
    [500, "unavailable"],
  ])("maps HTTP %i", async (status, code) => {
    await expect(collect(response("", status as number))).rejects.toMatchObject({ code });
  });

  it("maps network errors and preserves cancellation", async () => {
    const fetcher: typeof fetch = async () => {
      throw new Error("secret");
    };
    await expect(collect(fetcher)).rejects.toBeInstanceOf(LiveChatError);
    const controller = new AbortController();
    controller.abort();
    await expect(collect(fetcher, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
  });

  it("cancels a pending read and delivers no later event", async () => {
    const controller = new AbortController();
    let cancelled = false;
    const fetcher: typeof fetch = async () =>
      new Response(
        new ReadableStream({
          cancel() {
            cancelled = true;
          },
        }),
      );
    const pending = collect(fetcher, controller.signal);
    await new Promise((resolve) => setTimeout(resolve, 0));
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(cancelled).toBe(true);
  });

  it("finishes at done even if the signal aborts after delivery", async () => {
    const controller = new AbortController();
    const events = streamLiveChat(
      request,
      controller.signal,
      response('data: {"type":"done","summary":{}}\n\n'),
    )[Symbol.asyncIterator]();
    expect((await events.next()).value).toMatchObject({ type: "done" });
    controller.abort();
    expect((await events.next()).done).toBe(true);
  });
});
