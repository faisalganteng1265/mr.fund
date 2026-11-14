// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { TrustSection } from "../src/landing/TrustSection";

afterEach(cleanup);

describe("trust section", () => {
  it("lists the trust layers from your key outward, with the AI furthest away", () => {
    render(createElement(TrustSection));
    const buttons = screen.getAllByRole("button");
    expect(buttons.map((b) => b.textContent)).toEqual([
      expect.stringContaining("Never asked for. Never handled."),
      expect.stringContaining("You sign every manual move."),
      expect.stringContaining("Your limits, enforced on-chain."),
      expect.stringContaining("Code decides every number."),
      expect.stringContaining("It talks. It can't sign or send."),
    ]);
    expect(buttons[0]?.getAttribute("aria-expanded")).toBe("true");
  });

  it("expands one layer at a time", () => {
    render(createElement(TrustSection));
    const ai = screen.getByRole("button", { name: /It talks/ });
    fireEvent.click(ai);
    expect(ai.getAttribute("aria-expanded")).toBe("true");
    const expanded = screen
      .getAllByRole("button")
      .filter((b) => b.getAttribute("aria-expanded") === "true");
    expect(expanded).toHaveLength(1);
  });

  it("marks Guardian as in development and uses no banned claims", () => {
    const { container } = render(createElement(TrustSection));
    expect(screen.getByText(/Designed to enforce.*In development/)).toBeTruthy();
    const text = (container.textContent ?? "").toLowerCase();
    for (const banned of [
      "never get liquidated",
      "guaranteed yield",
      "risk-free",
      "free borrowing",
    ])
      expect(text).not.toContain(banned);
    expect(text).not.toMatch(/\bsafe\b/);
  });
});
