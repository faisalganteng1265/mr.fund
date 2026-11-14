// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Playground } from "../src/play/Playground";

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
beforeEach(() => {
  vi.useFakeTimers();
  HTMLElement.prototype.scrollTo = vi.fn();
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
const advance = async (ms = 2200) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};
const click = (name: string | RegExp) => fireEvent.click(screen.getByRole("button", { name }));
async function begin() {
  render(createElement(Playground));
  click("Start consultation");
  click("Try the simulated demo");
  await advance(800);
  act(() => scene.enter());
  await advance(200);
}
async function recommend() {
  click("Find my smartest move");
  await advance();
}
async function activate() {
  click("Guardian");
  click("Meet your Guardian");
  click("Review my rules");
  click("Approve in mock wallet");
  click("Approve demo action");
  await advance();
}

it.each(["failure", "partial"])(
  "keeps debt and wallet funds after a %s batch and exposes its receipt",
  async (outcome) => {
    await begin();
    await recommend();
    click("Execute now");
    fireEvent.change(screen.getByLabelText("Demo transaction outcome"), {
      target: { value: outcome },
    });
    click("Approve demo action");
    await advance();
    expect(screen.getByRole("button", { name: "Execute now" })).toBeTruthy();
    click("Position");
    expect(screen.getAllByText("$1,800.00").length).toBeGreaterThan(0);
    click(/you.demo.testnet/);
    expect(screen.getByText("1,000.00 test USDC available")).toBeTruthy();
    click("Close dialog");
    click(/Activity/);
    click(/Repay 100.00 USDC/);
    const receipt = screen.getByRole("dialog", { name: "Your demo receipt." });
    expect(
      within(receipt).getByText(new RegExp(outcome === "failure" ? "FAILED" : "PARTIAL")),
    ).toBeTruthy();
    expect(within(receipt).getByText("Not submitted")).toBeTruthy();
    expect(within(receipt).queryByRole("link")).toBeNull();
    click("View all activity");
    expect(screen.queryByRole("dialog", { name: "Your demo receipt." })).toBeNull();
  },
);
it("shows the health transition in a confirmed receipt without inventing a transaction", async () => {
  await begin();
  await recommend();
  click("Execute now");
  click("Approve demo action");
  await advance();
  click(/Activity/);
  click(/Repaid 100.00 USDC/);
  const receipt = screen.getByRole("dialog", { name: "Your demo receipt." });
  expect(receipt.textContent).toContain("158.33%167.64%");
  expect(within(receipt).getByText("DEMO-0001")).toBeTruthy();
  expect(within(receipt).getByText("Local simulation")).toBeTruthy();
});
it("blocks a repeated trigger replay without spending more reserve", async () => {
  await begin();
  await activate();
  click("Run simulated trigger");
  click("Run simulated trigger");
  expect(screen.getByText(/Reserve 400.00 USDC/)).toBeTruthy();
  click(/Activity/);
  click(/Guardian request rejected/);
  expect(screen.getByText(/Simulated cooldown is 5 minutes/)).toBeTruthy();
});
it.each(["loading", "empty", "error"])(
  "withholds execution in the %s data state and recovers",
  async (state) => {
    await begin();
    await recommend();
    click("Demo settings");
    fireEvent.change(screen.getByLabelText("Position data state"), { target: { value: state } });
    click("Close dialog");
    const execute = screen.queryByRole("button", {
      name: "Execute now",
    }) as HTMLButtonElement | null;
    expect(execute === null || execute.disabled).toBe(true);
    click("Demo settings");
    fireEvent.change(screen.getByLabelText("Position data state"), { target: { value: "fresh" } });
    click("Close dialog");
    expect(screen.getByRole("button", { name: "Execute now" })).toBeTruthy();
  },
);
it("reviews an editable voice sample without sending until explicit approval", async () => {
  await begin();
  click("Voice");
  click("Try a demo transcript");
  const sample = screen.getByLabelText("SAMPLE TRANSCRIPT · SIMULATED");
  fireEvent.change(sample, { target: { value: "Explain my position" } });
  expect(screen.queryByText("YOU")).toBeNull();
  click("Send my question");
  await advance();
  expect(screen.getByText(/Your demo position has 1,000 NEAR/)).toBeTruthy();
});

it("reopens recommendation recovery after dismissing an invalid adjusted draft", async () => {
  await begin();
  await recommend();
  await advance(10000);
  click("Adjust");
  fireEvent.change(screen.getByLabelText("Repay amount (USDC)"), { target: { value: "0" } });
  click("Dismiss recommendation");
  fireEvent.change(screen.getByRole("textbox", { name: "Message Mr.Fund" }), {
    target: { value: "Should I repay or earn yield?" },
  });
  click("Send message");
  await advance();
  expect(screen.getByRole("button", { name: "Adjust amount" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Execute now" })).toBeNull();
});
