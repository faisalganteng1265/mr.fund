// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LiveCard } from "../src/play/live/LiveCard";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// A repay card sends the repay and the fee through the same token, so two transactions share a
// receiver. React reports duplicate keys through console.error.
const card = {
  id: "card-1",
  action: "repay",
  headline: "Repay 0.01 REF",
  numbers: [],
  assumptions: [],
  risks: [],
  fees: [],
  payload: [
    { receiverId: "ref.fakes.testnet", actions: [{ methodName: "ft_transfer_call" }] },
    { receiverId: "ref.fakes.testnet", actions: [{ methodName: "ft_transfer" }] },
    { receiverId: "ref.fakes.testnet", actions: [{ methodName: "storage_deposit" }] },
  ],
};

describe("live card payload list", () => {
  it("lists every transaction without a duplicate key when receivers repeat", () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      createElement(
        LiveCard,
        // The card shape is built by the chat route; this test only needs its payload list.
        { card, position: null } as never,
        null,
      ),
    );
    expect(screen.getAllByText(/To ref\.fakes\.testnet:/)).toHaveLength(3);
    const duplicate = errors.mock.calls.some((call) =>
      String(call[0]).includes("two children with the same key"),
    );
    expect(duplicate).toBe(false);
  });
});
