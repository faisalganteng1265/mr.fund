// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LiveChatPanel, LivePositionPanel } from "../src/play/LivePanels";
import { useLiveConsultation } from "../src/play/useLiveConsultation";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
const account = {
  accountId: "alice.testnet",
  network: "testnet" as const,
  method: "near-connect" as const,
  accounts: ["alice.testnet"],
};
const position = {
  ok: true,
  provenance: "live",
  accountId: "alice.testnet",
  networkId: "testnet",
  dataAgeMs: 10,
  maxDataAgeMs: 10000,
  supplied: [],
  collateral: [
    { tokenId: "near", symbol: "NEAR", decimals: 24, atomic: "1000000000000000000000000" },
  ],
  debt: [],
  liquidationPrices: [],
  health: { kind: "no_debt" },
};
function Harness({ id = "alice.testnet" }: { id?: string }) {
  const live = useLiveConsultation({ ...account, accountId: id });
  return createElement(
    "div",
    null,
    createElement(LivePositionPanel, { live }),
    createElement(LiveChatPanel, {
      live,
      repay: { store: null, view: { phase: "idle" } },
      opening: { store: null, view: { phase: "idle" } },
      phone: false,
      setComposerFocused: () => {},
      setKeyboardHeight: () => {},
      openPanel: () => {},
    }),
  );
}
describe("live consultation", () => {
  it("shows live position and a non-executing server card", async () => {
    const card = {
      type: "card",
      card: {
        id: "card-1",
        headline: "Repay",
        reason: "Reduce debt",
        numbers: [],
        fees: [],
        action: "repay",
        dataAgeMs: 10,
        payload: [],
      },
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url === "/api/position"
          ? Response.json(position)
          : new Response(
              `data: ${JSON.stringify({ type: "text", text: "Hello" })}\n\ndata: ${JSON.stringify(card)}\n\ndata: {"type":"done","summary":{}}\n\n`,
            ),
      ),
    );
    render(createElement(Harness));
    expect(await screen.findByText("1 NEAR")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Message Mr.Fund"), { target: { value: "What now?" } });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    expect(await screen.findByText("Hello")).toBeTruthy();
    // Without a live repay executor (no session store) the card states it cannot execute.
    expect(await screen.findByText("Execution is unavailable for this session.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Execute now" })).toBeNull();
    expect(screen.queryByText(/confirmed|pending|receipt/i)).toBeNull();
    expect(screen.queryByText("1,800.00")).toBeNull();
  });
  it("hides the previous account response immediately when accounts change", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(position)),
    );
    const view = render(createElement(Harness));
    await screen.findByText("1 NEAR");
    await act(async () => {
      view.rerender(createElement(Harness, { id: "bob.testnet" }));
    });
    await waitFor(() => expect(screen.queryByText("1 NEAR")).toBeNull());
  });
  it("restores the input and discards an interrupted answer", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url === "/api/position"
          ? Response.json(position)
          : new Response('data: {"type":"text","text":"unfinished"}\n\n'),
      ),
    );
    render(createElement(Harness));
    await screen.findByText("1 NEAR");
    fireEvent.change(screen.getByLabelText("Message Mr.Fund"), { target: { value: "Question" } });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    expect((await screen.findByRole("alert")).textContent).toContain("interrupted");
    expect(screen.queryByText("unfinished")).toBeNull();
    expect((screen.getByLabelText("Message Mr.Fund") as HTMLTextAreaElement).value).toBe(
      "Question",
    );
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByLabelText("Message Mr.Fund")),
    );
  });
  it("prevents sending and hides values for a network mismatch", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ ...position, networkId: "mainnet" })),
    );
    render(createElement(Harness));
    expect((await screen.findByRole("alert")).textContent).toContain("networks do not match");
    expect((screen.getByLabelText("Message Mr.Fund") as HTMLTextAreaElement).disabled).toBe(true);
    expect(screen.queryByText("1 NEAR")).toBeNull();
  });
  it("aborts an earlier streaming answer when sending a new question", async () => {
    let cancelled = false;
    let chatCalls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url === "/api/position") return Response.json(position);
        chatCalls++;
        if (chatCalls === 1)
          return new Response(
            new ReadableStream({
              start(controller) {
                controller.enqueue(
                  new TextEncoder().encode('data: {"type":"text","text":"old partial"}\n\n'),
                );
              },
              cancel() {
                cancelled = true;
              },
            }),
          );
        return new Response(
          'data: {"type":"text","text":"new answer"}\n\ndata: {"type":"done","summary":{}}\n\n',
        );
      }),
    );
    render(createElement(Harness));
    await screen.findByText("1 NEAR");
    fireEvent.change(screen.getByLabelText("Message Mr.Fund"), { target: { value: "First" } });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    await screen.findByText("old partial");
    fireEvent.change(screen.getByLabelText("Message Mr.Fund"), { target: { value: "Second" } });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    expect(await screen.findByText("new answer")).toBeTruthy();
    expect(screen.queryByText("old partial")).toBeNull();
    expect(cancelled).toBe(true);
  });
});
