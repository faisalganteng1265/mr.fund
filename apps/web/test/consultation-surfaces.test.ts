// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, expect, it } from "vitest";
import { ActivityPanel } from "../src/play/ActivityPanel";
import { GuardianDetails } from "../src/play/GuardianDetails";
import { GuardianPanel } from "../src/play/GuardianPanel";
import { GuardianSetupDialog } from "../src/play/GuardianSetupDialog";
import { ReceiptDetail } from "../src/play/ReceiptDetail";
import { createDemoSource } from "../src/play/source/demoSource";
import type { Receipt } from "../src/play/source/types";

afterEach(cleanup);
const receipt: Receipt = {
  id: 1,
  title: "Repaid 250 USDC",
  detail: "Observed repayment",
  status: "confirmed",
  at: "10:45 AM",
  atMs: 0,
  chain: { status: "confirmed", txHashes: [], atMs: 0 },
};
it("keeps live receipt status and time when omitting simulation provenance", () => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
  const { container } = render(
    createElement(ReceiptDetail, {
      receipt,
      port: { provenance: "live" },
      close: () => {},
      openActivity: () => {},
    }),
  );
  expect(container.textContent).toContain("CONFIRMED");
  expect(container.textContent).toContain("10:45 AM");
  expect(container.querySelector(".receipt-banner")?.textContent).not.toContain("SIMULATED");
});
it("keeps live activity status and time independently of provenance", () => {
  const { container } = render(
    createElement(ActivityPanel, {
      receipts: [receipt],
      port: { provenance: "live" },
      setSelectedReceipt: () => {},
      sendMessage: () => {},
    }),
  );
  expect(container.querySelector(".receipt-row")?.textContent).toContain("10:45 AM · confirmed");
  expect(container.querySelector(".receipt-row")?.textContent).not.toContain("Simulated");
});
it("retains live watcher availability while removing only its simulation marker", () => {
  const source = createDemoSource();
  const { container } = render(
    createElement(GuardianDetails, {
      ...source.guardian.getSnapshot(),
      guardian: "active",
      watcherOnline: false,
      port: { provenance: "live" },
      ownerAction: () => {},
      replay: () => {},
    }),
  );
  expect(container.textContent).toContain("Offline");
  expect(container.textContent).not.toContain("Offline · simulated");
});
it("does not describe a live Guardian status or loan as simulated", () => {
  const source = createDemoSource();
  render(
    createElement(GuardianPanel, {
      view: { ...source.guardian.getSnapshot(), guardian: "active" },
      port: { provenance: "live" },
      ownerAction: () => {},
      replay: () => {},
      setup: () => {},
    }),
  );
  expect(screen.queryByText("Active · demo")).toBeNull();
  expect(screen.queryByText(/A separate, simulated Guardian-held loan/)).toBeNull();
});
it("keeps live Guardian setup free of mock approvals and simulated loan labels", () => {
  const source = createDemoSource();
  const { container } = render(
    createElement(GuardianSetupDialog, {
      port: { provenance: "live" },
      policyFields: source.guardian.getSnapshot().savedFields,
      setPolicyFields: () => {},
      setupReview: true,
      setSetupReview: () => {},
      policyError: null,
      activate: () => {},
      close: () => {},
    }),
  );
  expect(container.textContent).not.toMatch(/simulated|mock|demo|example pricing/i);
  expect(screen.getByRole("button", { name: "Approve in wallet" })).toBeTruthy();
});
