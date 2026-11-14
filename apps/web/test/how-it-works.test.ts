// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { landingFigures } from "../src/landing/figures";
import { HowItWorks } from "../src/landing/HowItWorks";

afterEach(cleanup);

const titles = ["Ask", "Read", "Explain", "Recommend", "Decide", "Receipt"];

describe("how it works", () => {
  it("lists the six-step loop in order and states what the demo runs today", () => {
    render(createElement(HowItWorks, { figures: landingFigures() }));
    const headings = screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent);
    expect(headings).toEqual(titles);
    expect(screen.getAllByText(/simulated position with a mock wallet/)).toHaveLength(2);
  });

  it("marks the first step current and shows only engine figures in the scenes", () => {
    const f = landingFigures();
    render(createElement(HowItWorks, { figures: f }));
    const current = screen.getAllByRole("button").filter((b) => b.getAttribute("aria-current"));
    expect(current).toHaveLength(1);
    expect(current[0]?.textContent).toContain("Ask");
    expect(screen.getAllByText(f.health).length).toBeGreaterThan(0);
    expect(screen.getAllByText("None sent in demo").length).toBeGreaterThan(0);
  });
});
