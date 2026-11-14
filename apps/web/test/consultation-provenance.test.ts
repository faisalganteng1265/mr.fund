// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, expect, it } from "vitest";
import { ProvenanceTag } from "../src/play/ProvenanceTag";

afterEach(cleanup);
it("retains the existing simulated label", () => {
  render(
    createElement(ProvenanceTag, {
      port: { provenance: "simulated" },
      label: "SIMULATED · PnL unavailable",
    }),
  );
  expect(screen.getByText("SIMULATED · PnL unavailable")).toBeTruthy();
});
it("does not label live values as simulated", () => {
  render(createElement(ProvenanceTag, { port: { provenance: "live" }, label: "Simulated" }));
  expect(screen.queryByText("Simulated")).toBeNull();
});
it("labels mixed capabilities independently", () => {
  render(
    createElement(
      "div",
      null,
      createElement(ProvenanceTag, {
        port: { provenance: "live", networkLabel: "Testnet" },
        label: "Simulated session",
      }),
      createElement(ProvenanceTag, {
        port: { provenance: "simulated" },
        label: "Simulated position",
      }),
    ),
  );
  expect(screen.getByText("Testnet")).toBeTruthy();
  expect(screen.getByText("Simulated position")).toBeTruthy();
  expect(screen.queryByText("Simulated session")).toBeNull();
});
it.each(["", "Testnet"])("rejects a simulated surface labelled %j", (label) => {
  expect(() =>
    render(createElement(ProvenanceTag, { port: { provenance: "simulated" }, label })),
  ).toThrow("Simulated provenance requires a visible simulation label");
});
