// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Playground } from "../src/play/Playground";
import { createDemoSource } from "../src/play/source/demoSource";
import { createLiveSessionPort, withLiveSession } from "../src/play/source/liveSession";
import type { WalletSession } from "../src/wallet/react";
import type { WalletState } from "../src/wallet/session";

const scene = vi.hoisted(() => ({ enter: () => {} }));
vi.mock("next/dynamic", () => ({
  default: () => (props: { onEntranceComplete: () => void }) => {
    scene.enter = props.onEntranceComplete;
    return null;
  },
}));
vi.mock("../src/play/ImmersiveSceneFrame", () => ({
  ImmersiveSceneFrame: ({ children }: { children: ReactNode }) =>
    createElement("div", null, children),
}));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("real wallet playground", () => {
  it("uses live panels in the existing room without demo financial data", async () => {
    HTMLElement.prototype.scrollTo = vi.fn();
    const state: WalletState = {
      status: "connected",
      error: null,
      session: {
        accountId: "alice.testnet",
        network: "testnet",
        method: "near-connect",
        accounts: [{ accountId: "alice.testnet" }],
        contextKey: "testnet:alice",
      },
    };
    const session = createLiveSessionPort(
      { getSnapshot: () => state, subscribe: () => () => {} },
      async () => {},
      "testnet",
    );
    const source = withLiveSession(createDemoSource(), session);
    const wallet = {
      state,
      logout: async () => {},
      selectAccount: () => {},
    } as unknown as WalletSession;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(
          { ok: false, networkId: "testnet", error: { code: "no_position" } },
          { status: 404 },
        ),
      ),
    );
    render(createElement(() => Playground({ source, wallet })));
    fireEvent.click(screen.getByRole("button", { name: "Start consultation" }));
    act(() => scene.enter());
    expect(await screen.findByText(/I don.t see a Rhea lending position/)).toBeTruthy();
    expect(screen.queryByText("$1,800.00")).toBeNull();
    expect(screen.queryByText(/scripted demo/i)).toBeNull();
    expect(screen.getAllByText("alice.testnet").length).toBeGreaterThan(0);
  });
  it("supports a mobile reduced-motion consultation with keyboard submission", async () => {
    HTMLElement.prototype.scrollTo = vi.fn();
    vi.stubGlobal("innerWidth", 360);
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query.includes("max-width: 767px") || query.includes("prefers-reduced-motion"),
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
    const state: WalletState = {
      status: "connected",
      error: null,
      session: {
        accountId: "alice.testnet",
        network: "testnet",
        method: "near-connect",
        accounts: [{ accountId: "alice.testnet" }],
        contextKey: "testnet:alice",
      },
    };
    const session = createLiveSessionPort(
      { getSnapshot: () => state, subscribe: () => () => {} },
      async () => {},
      "testnet",
    );
    const source = withLiveSession(createDemoSource(), session);
    const wallet = {
      state,
      logout: async () => {},
      selectAccount: () => {},
    } as unknown as WalletSession;
    const fetcher = vi.fn(async (url: string) =>
      url === "/api/position"
        ? Response.json(
            { ok: false, networkId: "testnet", error: { code: "no_position" } },
            { status: 404 },
          )
        : new Response(
            'data: {"type":"text","text":"Answer"}\n\ndata: {"type":"done","summary":{}}\n\n',
          ),
    );
    vi.stubGlobal("fetch", fetcher);
    render(createElement(() => Playground({ source, wallet })));
    fireEvent.click(screen.getByRole("button", { name: "Start consultation" }));
    act(() => scene.enter());
    const composer = await screen.findByRole("textbox", { name: "Message Mr.Fund" });
    expect(fetcher.mock.calls.filter(([url]) => url === "/api/chat")).toHaveLength(0);
    fireEvent.change(composer, { target: { value: "Explain" } });
    fireEvent.keyDown(composer, { key: "Enter", code: "Enter" });
    expect(await screen.findByText("Answer")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Position" }));
    expect(await screen.findByText("No lending position found for this account.")).toBeTruthy();
    expect(screen.queryByText("$1,800.00")).toBeNull();
  });
});
