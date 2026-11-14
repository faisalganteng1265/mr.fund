// @vitest-environment jsdom
import { act, cleanup, render, screen, within } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LiveChatPanel, LivePositionPanel } from "../src/play/LivePanels";
import { feeAmountText } from "../src/play/live/cardFormat";
import { formatDataAge } from "../src/play/live/dataAge";

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const usdc = { tokenId: "usdc.testnet", symbol: "USDC", decimals: 6 };
const balance = (atomic: string) => ({ ...usdc, atomic });
const position = (dataAgeMs: number) => ({
  ok: true,
  dataAgeMs,
  health: { kind: "value", bps: 15000 },
  collateral: [],
  debt: [balance("1500000")],
  supplied: [],
});
const ready = (dataAgeMs: number) => ({ status: "ready", position: position(dataAgeMs) });
const noop = () => {};

describe("formatDataAge", () => {
  it("uses whole seconds below one minute and rounds down", () => {
    expect(formatDataAge(0)).toBe("Updated 0 s ago");
    expect(formatDataAge(13_999)).toBe("Updated 13 s ago");
    expect(formatDataAge(59_999)).toBe("Updated 59 s ago");
  });
  it("switches to minutes at 60 s", () => {
    expect(formatDataAge(60_000)).toBe("Updated 1 min ago");
    expect(formatDataAge(125_000)).toBe("Updated 2 min ago");
  });
  it("never shows a negative or non-finite age", () => {
    expect(formatDataAge(-5000)).toBe("Updated 0 s ago");
    expect(formatDataAge(Number.NaN)).toBe("Updated 0 s ago");
  });
});

describe("live position data age", () => {
  const render1 = (state: unknown) =>
    render(createElement(LivePositionPanel, { live: { state, refresh: noop } as never }));

  it("starts at the reported age and grows with elapsed time, once per second", () => {
    render1(ready(13_000));
    expect(screen.getByText("Updated 13 s ago")).toBeTruthy();
    act(() => {
      vi.advanceTimersByTime(999);
    });
    expect(screen.getByText("Updated 13 s ago")).toBeTruthy();
    act(() => {
      vi.advanceTimersByTime(5_001);
    });
    expect(screen.getByText("Updated 19 s ago")).toBeTruthy();
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(screen.getByText("Updated 1 min ago")).toBeTruthy();
  });

  it("restarts at the new reported age after a refresh", () => {
    const view = render1(ready(13_000));
    act(() => {
      vi.advanceTimersByTime(30_000);
    });
    expect(screen.getByText("Updated 43 s ago")).toBeTruthy();
    view.rerender(
      createElement(LivePositionPanel, { live: { state: ready(2_000), refresh: noop } as never }),
    );
    expect(screen.getByText("Updated 2 s ago")).toBeTruthy();
  });

  it("is not announced every second", () => {
    render1(ready(13_000));
    expect(screen.getByText("Updated 13 s ago").getAttribute("aria-live")).toBe("off");
  });
});

describe("fee amounts", () => {
  const view = { supplied: [balance("1")], collateral: [], debt: [] } as never;
  it("formats exactly with the token's decimals when the position knows the token", () => {
    expect(feeAmountText({ amount: 100000n, tokenId: "usdc.testnet" }, view)).toBe("0.1 USDC");
    expect(feeAmountText({ amount: "123456789012345678901", tokenId: "usdc.testnet" }, view)).toBe(
      "123456789012345.678901 USDC",
    );
  });
  it("keeps the exact atomic amount for an unknown token or no position", () => {
    expect(feeAmountText({ amount: "100000", tokenId: "other.testnet" }, view)).toBe(
      "100000 atomic units of other.testnet",
    );
    expect(feeAmountText({ amount: "100000", tokenId: "usdc.testnet" }, null)).toBe(
      "100000 atomic units of usdc.testnet",
    );
  });
  it("falls back to atomic text rather than throwing on a malformed amount", () => {
    expect(feeAmountText({ amount: "1.5", tokenId: "usdc.testnet" }, view)).toBe(
      "1.5 atomic units of usdc.testnet",
    );
  });
});

describe("live card", () => {
  const card = {
    id: "card-1",
    action: "repay",
    headline: "Repay 1.5 USDC",
    reason: "That lowers your debt.",
    numbers: [
      { label: "Health", before: "150.00", after: "180.00", unit: "%" },
      { label: "Debt", before: "1.5", after: "0", unit: "USDC" },
      { label: "Fee", unit: "USDC", before: "0.1" },
    ],
    assumptions: ["Prices as read."],
    fees: [
      {
        label: "Execution fee",
        amount: "100000",
        tokenId: "usdc.testnet",
        recipientId: "fees.testnet",
        when: "on repay",
      },
    ],
    risks: ["Rates change."],
    dataAgeMs: 13_000,
    maxDataAgeMs: 60_000,
    payload: [
      {
        receiverId: "usdc.testnet",
        actions: [{ methodName: "ft_transfer_call", args: {}, gas: "1", deposit: "1" }],
      },
    ],
  };
  const live = (over: object = {}) => ({
    state: ready(13_000),
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
    ...over,
  });
  const mount = (l: object) => {
    HTMLElement.prototype.scrollTo = vi.fn();
    return render(
      createElement(LiveChatPanel, {
        live: l as never,
        repay: { store: null, view: { phase: "idle" } } as never,
        opening: { store: null, view: { phase: "idle" } } as never,
        phone: false,
        setComposerFocused: noop,
        setKeyboardHeight: noop,
        openPanel: noop,
      }),
    );
  };

  it("shows its data age and every card number unchanged", () => {
    mount(live());
    const article = screen.getByRole("article", { name: "Repay 1.5 USDC" });
    const scope = within(article);
    expect(scope.getByText("Updated 13 s ago")).toBeTruthy();
    expect(scope.getByText("That lowers your debt.")).toBeTruthy();
    const rows = Array.from(article.querySelectorAll("dl > div")).map((r) => r.textContent);
    expect(rows).toEqual(["Health150.00180.00%", "Debt1.50USDC", "Fee0.1USDC"]);
  });

  it("shows fees in token units inside the details, with assumptions and risks", () => {
    mount(live());
    const text = screen.getByRole("article").querySelector("details")?.textContent ?? "";
    expect(text).toContain("Execution fee: 0.1 USDC to fees.testnet (on repay)");
    expect(text).toContain("Prices as read.");
    expect(text).toContain("Rates change.");
    expect(text).toContain("To usdc.testnet: ft_transfer_call");
  });

  it("keeps fee amounts exact when the position is not ready", () => {
    mount(live({ state: { status: "stale" } }));
    expect(screen.getByRole("article").textContent).toContain(
      "100000 atomic units of usdc.testnet",
    );
  });
});
