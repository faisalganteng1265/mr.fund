// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useLiveConsultation } from "../src/play/useLiveConsultation";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
it("clears account-scoped conversation and uses server events", async () => {
  const account = {
    accountId: "alice.testnet",
    network: "testnet" as const,
    method: "near-connect" as const,
    accounts: ["alice.testnet"],
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) =>
      url === "/api/position"
        ? Response.json(
            { ok: false, networkId: "testnet", error: { code: "no_position" } },
            { status: 404 },
          )
        : new Response(
            'data: {"type":"text","text":"Server answer"}\n\ndata: {"type":"done","summary":{}}\n\n',
          ),
    ),
  );
  const { result, rerender } = renderHook(
    ({ id }) => useLiveConsultation({ ...account, accountId: id }),
    { initialProps: { id: account.accountId } },
  );
  await waitFor(() => expect(result.current.state.status).toBe("empty"));
  await act(async () => result.current.send("Question"));
  expect(result.current.messages.map((message) => message.content)).toEqual([
    "Question",
    "Server answer",
  ]);
  rerender({ id: "bob.testnet" });
  expect(result.current.messages).toEqual([]);
});

it.each(["done", "error", "cancel", "clear", "account", "replacement"] as const)(
  "resets slow state on %s and ignores the obsolete turn",
  async (ending) => {
    vi.useFakeTimers();
    const streams: ReadableStreamDefaultController<Uint8Array>[] = [];
    vi.stubGlobal("fetch", async (url: string) =>
      url === "/api/position"
        ? Response.json(
            { ok: false, networkId: "testnet", error: { code: "no_position" } },
            { status: 404 },
          )
        : new Response(
            new ReadableStream<Uint8Array>({
              start(controller) {
                streams.push(controller);
              },
            }),
          ),
    );
    const { result, rerender } = renderHook(
      ({ id }) =>
        useLiveConsultation({
          accountId: id,
          network: "testnet",
          method: "near-connect",
          accounts: [id],
        }),
      { initialProps: { id: "alice.testnet" } },
    );
    await act(async () => {});
    let pending!: Promise<void>;
    act(() => {
      pending = result.current.send("Question");
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(14_999);
    });
    expect(result.current.busy).toBe(true);
    expect(result.current.slow).toBe(false);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(result.current.slow).toBe(true);
    if (ending === "done" || ending === "error") {
      await act(async () => {
        streams[0]?.enqueue(
          new TextEncoder().encode(
            ending === "done"
              ? 'data: {"type":"text","text":"Answer"}\n\ndata: {"type":"done","summary":{}}\n\n'
              : 'data: {"type":"error","code":"timeout"}\n\n',
          ),
        );
        await pending;
      });
      if (ending === "done") expect(result.current.messages.at(-1)?.content).toBe("Answer");
      else expect(result.current.error).toMatch(/timed out/i);
    } else if (ending === "account") {
      rerender({ id: "bob.testnet" });
    } else if (ending === "replacement") {
      act(() => {
        void result.current.send("Replacement");
      });
      expect(result.current.busy).toBe(true);
    } else {
      act(() => (ending === "clear" ? result.current.clear() : result.current.cancel()));
    }
    expect(result.current.slow).toBe(false);
    if (ending !== "replacement") expect(result.current.busy).toBe(false);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });
    expect(result.current.slow).toBe(ending === "replacement");
    act(() => result.current.clear());
  },
);
