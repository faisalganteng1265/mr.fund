// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LiveChatPanel } from "../src/play/LivePanels";

afterEach(cleanup);
const noop = () => {};
const card = {
  id: "c1",
  action: "repay",
  headline: "Repay 1.5 USDC",
  reason: "That lowers your debt.",
  numbers: [],
  assumptions: [],
  fees: [],
  risks: [],
  dataAgeMs: 1000,
  maxDataAgeMs: 60000,
  payload: [],
};
const confirmation = {
  amount: "1.5 USDC",
  lendingId: "lending.testnet",
  fee: null,
  registrationNear: null,
  network: "testnet",
  accountId: "alice.testnet",
};

function Harness() {
  const [phase, setPhase] = useState<"idle" | "confirm">("idle");
  const repay = {
    store: {
      status: () => "idle",
      prepare: async () => setPhase("confirm"),
      cancel: () => setPhase("idle"),
      confirm: async () => {},
    },
    view: phase === "confirm" ? { phase, cardId: "c1", confirmation } : { phase },
  };
  const live = {
    state: { status: "empty" },
    messages: [],
    input: "",
    setInput: noop,
    partial: "",
    card,
    error: "",
    busy: false,
    progress: "",
    send: noop,
    clear: noop,
    refresh: noop,
  };
  return createElement(LiveChatPanel, {
    live: live as never,
    repay: repay as never,
    opening: { store: null, view: { phase: "idle" } } as never,
    phone: false,
    setComposerFocused: noop,
    setKeyboardHeight: noop,
    openPanel: noop,
  });
}

describe("repay confirmation focus", () => {
  it("moves focus into the confirmation and back to Execute after cancel", async () => {
    HTMLElement.prototype.scrollTo = vi.fn();
    render(createElement(Harness));
    const execute = screen.getByRole("button", { name: "Execute now" });
    execute.focus();
    fireEvent.click(execute);
    const region = await screen.findByRole("group", { name: "Repay confirmation" });
    expect(document.activeElement).toBe(region);
    expect(region.contains(screen.getByRole("button", { name: "Open wallet" }))).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    const back = await screen.findByRole("button", { name: "Execute now" });
    expect(document.activeElement).toBe(back);
  });

  it("does not steal focus on first render", () => {
    HTMLElement.prototype.scrollTo = vi.fn();
    render(createElement(Harness));
    expect(document.activeElement).toBe(document.body);
  });
});
