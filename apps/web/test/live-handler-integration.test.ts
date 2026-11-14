import type { ChatProvider, ToolContext } from "@mrfund/agent";
import { createChatHandler, createPositionHandler } from "@mrfund/server";
import { describe, expect, it } from "vitest";
import { baseSnapshot, NOW, USDC } from "../../../packages/agent/test/fixture";
import { accountId, config, rpc } from "../../../packages/server/test/position-rpc";
import { streamLiveChat } from "../src/play/source/liveChat";
import { createLivePosition } from "../src/play/source/livePosition";

const snapshot = baseSnapshot();
const context = (): ToolContext => ({
  snapshot,
  nowMs: NOW,
  newId: () => "test-card",
  proposal: {
    walletBalances: { [USDC]: 30_000_000n },
    fees: {
      tokenId: USDC,
      recipientId: "fees.testnet",
      activationFee: 0n,
      actionFee: 0n,
      executionFee: 100_000n,
    },
    lendingId: snapshot.lendingId,
    lendingVersion: "0.11.0",
    feeRecipientRegistered: true,
  },
});
const usage = { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, reasoningTokens: 0 };
function transport(handler: (request: Request) => Promise<Response>): typeof fetch {
  return (url, init) => handler(new Request(`https://local.test${String(url)}`, init));
}
const request = { accountId: "alice.testnet", message: "Repay", history: [] };

describe("local live clients against server handlers", () => {
  it("reads a fake position through the real HTTP handler", async () => {
    const handler = createPositionHandler({
      config,
      fetchImpl: rpc({
        get_price_no_older_than: {
          price: "100000000",
          expo: -8,
          conf: "0",
          publish_time: Math.floor(Date.now() / 1000),
        },
      }).fetchImpl,
    });
    const port = createLivePosition(accountId, "testnet", transport(handler));
    await port.refresh();
    expect(port.getSnapshot()).toMatchObject({
      status: "ready",
      position: { accountId, networkId: "testnet", health: { kind: "value" } },
    });
    port.dispose();
  });
  it("streams a real tool-built card through the client", async () => {
    let calls = 0;
    const provider: ChatProvider = {
      async complete() {
        calls++;
        return calls === 1
          ? {
              content: "",
              toolCalls: [
                {
                  id: "draft",
                  name: "propose_card",
                  arguments: '{"action":"repay","amount":"10"}',
                },
              ],
              usage,
            }
          : { content: "Review the draft; nothing has been sent.", toolCalls: [], usage };
      },
    };
    const handler = createChatHandler({ provider, loadContext: async () => context() });
    const events = [];
    for await (const event of streamLiveChat(
      request,
      new AbortController().signal,
      transport(handler),
    ))
      events.push(event);
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "card",
        card: expect.objectContaining({ action: "repay", id: "test-card" }),
      }),
    );
    expect(events.at(-1)).toMatchObject({ type: "done", summary: { status: "ok" } });
  });
  it("delivers sanitized errors and propagates cancellation to provider", async () => {
    const missing = createChatHandler({ loadContext: async () => context() });
    const errors = [];
    for await (const event of streamLiveChat(
      request,
      new AbortController().signal,
      transport(missing),
    ))
      errors.push(event);
    expect(errors).toContainEqual({ type: "error", code: "unavailable" });
    let providerSignal: AbortSignal | undefined;
    let started!: () => void;
    const entered = new Promise<void>((resolve) => {
      started = resolve;
    });
    const provider: ChatProvider = {
      async complete({ signal }) {
        providerSignal = signal;
        started();
        return new Promise((_resolve, reject) =>
          signal.addEventListener("abort", () => reject(new Error("cancelled")), { once: true }),
        );
      },
    };
    const handler = createChatHandler({ provider, loadContext: async () => context() });
    const controller = new AbortController();
    const consume = (async () => {
      for await (const _event of streamLiveChat(request, controller.signal, transport(handler))) {
        /* consume until cancelled */
      }
    })();
    await entered;
    controller.abort();
    await expect(consume).rejects.toMatchObject({ name: "AbortError" });
    expect(providerSignal?.aborted).toBe(true);
  });
});
