// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, expect, it } from "vitest";
import { PositionPanel } from "../src/play/PositionPanel";

afterEach(cleanup);
it.each(["simulated", "live"] as const)(
  "renders port supplied figures with %s provenance",
  (provenance) => {
    render(
      createElement(PositionPanel, {
        port: { provenance },
        state: "fresh",
        health: "165.00%",
        debt: "2,000.00",
        liquidation: "$3.20",
        comfort: "150",
        noDebt: false,
        change: null,
        figures: { collateralUsd: "6,250.00", borrowApr: "19.50%", supplyApr: "9.00%" },
        onRefresh: () => {},
        onSettings: () => {},
        onExplain: () => {},
      }),
    );
    expect(screen.getByText("$6,250.00")).toBeTruthy();
    expect(screen.getByText("19.50%")).toBeTruthy();
    expect(screen.getByText("9.00%")).toBeTruthy();
    expect(screen.queryByText(/Amounts come from the simulated position/) !== null).toBe(
      provenance === "simulated",
    );
  },
);
