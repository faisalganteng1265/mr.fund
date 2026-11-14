// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConsultationHeader } from "../src/play/ConsultationHeader";
import { liveHeaderStats } from "../src/play/live/headerStats";
import { createDemoSource } from "../src/play/source/demoSource";

afterEach(cleanup);
const usdc = { tokenId: "usdc.testnet", symbol: "USDC", decimals: 6 };
const near = { tokenId: "wrap.testnet", symbol: "NEAR", decimals: 24 };
const ready = (over: object) => ({
  status: "ready" as const,
  position: {
    health: { kind: "value", bps: 15250 },
    debt: [{ ...usdc, atomic: "1500000" }],
    ...over,
  } as never,
});

describe("liveHeaderStats", () => {
  it("shows health and exact per-token debt from the live read", () => {
    expect(liveHeaderStats(ready({}))).toEqual({ health: "152.50%", debt: "1.5 USDC" });
  });
  it("lists every debt token in its own units and skips zero balances", () => {
    expect(
      liveHeaderStats(
        ready({
          debt: [
            { ...usdc, atomic: "1500000" },
            { ...near, atomic: "0" },
            { ...near, atomic: "2500000000000000000000000" },
          ],
        }),
      ).debt,
    ).toBe("1.5 USDC, 2.5 NEAR");
  });
  it("uses a dash for no debt and for every state without a position", () => {
    expect(liveHeaderStats(ready({ health: { kind: "no_debt" }, debt: [] }))).toEqual({
      health: "—",
      debt: "—",
    });
    for (const status of ["loading", "empty", "stale", "unavailable", "network_mismatch"] as const)
      expect(liveHeaderStats({ status })).toEqual({ health: "—", debt: "—" });
  });
});

describe("ConsultationHeader", () => {
  const props = (over: object) => ({
    stage: "consult" as const,
    chatRevealed: true,
    phone: false,
    keyboardHeight: null,
    shortMobile: false,
    healthText: "212.00%",
    dataState: "fresh" as const,
    debt: 1_800_000_000n,
    port: createDemoSource().position,
    sound: false,
    setSound: () => {},
    setNotice: () => {},
    connected: true,
    setModal: () => {},
    ...over,
  });
  const stats = () => screen.getByRole("region", { name: "Position stats" }).textContent;

  it("shows the demo figures and the simulated label for the demo", () => {
    render(createElement(ConsultationHeader, props({})));
    expect(stats()).toContain("212.00%");
    expect(stats()).toContain("$1,800.00");
    expect(stats()).toContain("SIMULATED");
  });

  it("labels the demo as simulated outside the width-gated stats so it shows at 360 px", () => {
    render(createElement(ConsultationHeader, props({})));
    const tag = screen.getByText("SIMULATED");
    expect(tag.closest('[aria-label="Position stats"]')).toBeNull();
    expect(tag.closest(".tag")).not.toBeNull();
  });

  it("shows no simulation label in live mode", () => {
    render(
      createElement(
        ConsultationHeader,
        props({ liveAccount: "alice.testnet", liveStats: { health: "—", debt: "—" } }),
      ),
    );
    expect(screen.queryByText(/simulat/i)).toBeNull();
  });

  it("shows live figures and never a fixture value or simulation label in live mode", () => {
    render(
      createElement(
        ConsultationHeader,
        props({
          liveAccount: "alice.testnet",
          liveStats: { health: "152.50%", debt: "1.5 USDC" },
        }),
      ),
    );
    expect(stats()).toContain("152.50%");
    expect(stats()).toContain("1.5 USDC");
    expect(stats()).not.toContain("212.00%");
    expect(stats()).not.toContain("1,800");
    expect(stats()).not.toMatch(/simulat/i);
  });

  it("shows dashes while the live position is absent", () => {
    render(
      createElement(
        ConsultationHeader,
        props({ liveAccount: "alice.testnet", liveStats: { health: "—", debt: "—" } }),
      ),
    );
    expect(stats()).toBe("Health —Debt —");
  });
});

describe("the Stop speaking button", () => {
  const props = (over: object) => ({
    stage: "consult" as const,
    chatRevealed: true,
    phone: false,
    keyboardHeight: null,
    shortMobile: false,
    healthText: "—",
    dataState: "fresh" as const,
    debt: 0n,
    port: createDemoSource().position,
    sound: true,
    setSound: () => {},
    setNotice: () => {},
    connected: true,
    setModal: () => {},
    liveAccount: "alice.testnet",
    liveStats: { health: "—", debt: "—" },
    ...over,
  });

  it("appears only while Mr.Fund is speaking, in live and demo, and stops the voice", () => {
    const stop = vi.fn();
    const { rerender } = render(createElement(ConsultationHeader, props({ speaking: false })));
    expect(screen.queryByRole("button", { name: "Stop speaking" })).toBeNull();
    rerender(createElement(ConsultationHeader, props({ speaking: true, onStopSpeaking: stop })));
    fireEvent.click(screen.getByRole("button", { name: "Stop speaking" }));
    expect(stop).toHaveBeenCalledTimes(1);
    rerender(
      createElement(
        ConsultationHeader,
        props({ speaking: true, onStopSpeaking: stop, liveAccount: undefined }),
      ),
    );
    expect(screen.getByRole("button", { name: "Stop speaking" })).toBeTruthy();
  });
});
