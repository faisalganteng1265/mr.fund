// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { conversation } from "../src/landing/conversation";
import { landingFigures } from "../src/landing/figures";
import { HeroChat } from "../src/landing/HeroChat";

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("hero chat", () => {
  it("stays hidden for two seconds, then unfolds with the first exchange", () => {
    const f = landingFigures();
    const [first] = conversation(f);
    render(createElement(HeroChat, { figures: f }));
    const panel = document.getElementById("experience");
    expect(panel?.getAttribute("aria-hidden")).toBe("true");
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);

    act(() => vi.advanceTimersByTime(1999));
    expect(panel?.getAttribute("aria-hidden")).toBe("true");

    act(() => vi.advanceTimersByTime(1));
    expect(panel?.getAttribute("aria-hidden")).toBeNull();
    expect(panel?.className).toContain("[clip-path:inset(0_0_round_28px)]");
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getByText(first.question)).toBeTruthy();
    expect(screen.getByText(first.answer).textContent).toContain(f.health);
    expect(screen.getByRole("list", { name: "Simulated demo conversation" })).toBeTruthy();
  });
});
