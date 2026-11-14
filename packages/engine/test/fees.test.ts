import type { CardAction, FeeSchedule } from "@mrfund/shared";
import { describe, expect, it } from "vitest";
import { fees } from "../src/fees";
import { USDC } from "./helpers";

const schedule: FeeSchedule = {
  tokenId: USDC,
  recipientId: "fees.testnet",
  activationFee: 2_000_000n,
  actionFee: 1_000_000n,
  executionFee: 500_000n,
};

describe("fees", () => {
  it("charges one execution fee on a manual repay, with recipient and timing", () => {
    const r = fees("repay", schedule);
    expect(r.value).toEqual([
      {
        label: "Execution fee",
        amount: 500_000n,
        tokenId: USDC,
        recipientId: "fees.testnet",
        when: "Once, in the same signed batch as the repay.",
      },
    ]);
  });

  it("discloses both the activation fee and the per-action fee on activation", () => {
    const r = fees("guardian_activate", schedule);
    expect(r.value.map((l) => [l.label, l.amount])).toEqual([
      ["Activation fee", 2_000_000n],
      ["Per-action fee", 1_000_000n],
    ]);
    expect(r.value[0]?.when).toBe("Once, when you activate the Guardian.");
    expect(r.value[1]?.when).toBe(
      "Each time the Guardian repays for you, taken from your reserve and counted against your limits.",
    );
  });

  it("charges nothing to deactivate or withdraw", () => {
    for (const a of ["guardian_deactivate", "guardian_withdraw"] as const) {
      const r = fees(a, schedule);
      expect(r.value).toEqual([]);
      expect(r.assumptions).toContain("No fee is charged for this action.");
    }
  });

  it("omits a zero fee and says so (the D27 fallback has no per-action fee)", () => {
    const r = fees("guardian_activate", { ...schedule, actionFee: 0n });
    expect(r.value.map((l) => l.label)).toEqual(["Activation fee"]);
    expect(r.assumptions).toContain("No per-action fee is charged.");
  });

  it("gives every line a recipient, token and timing for every action", () => {
    const actions: CardAction[] = [
      "repay",
      "guardian_activate",
      "guardian_deactivate",
      "guardian_withdraw",
    ];
    for (const a of actions) {
      for (const line of fees(a, schedule).value) {
        expect(line.recipientId).toBe("fees.testnet");
        expect(line.tokenId).toBe(USDC);
        expect(line.when.length).toBeGreaterThan(0);
      }
    }
  });

  it("states the fee token and that amounts are atomic units in the inputs", () => {
    const r = fees("repay", schedule);
    expect(r.inputs.tokenId).toBe(USDC);
    expect(r.inputs.recipientId).toBe("fees.testnet");
    expect(r.dataAgeMs).toBe(0);
  });

  it("rejects a negative fee in the schedule", () => {
    expect(() => fees("repay", { ...schedule, executionFee: -1n })).toThrow(RangeError);
  });
});

describe("opening actions never get an implicit zero fee", () => {
  it.each(["wallet_collateral_deposit", "wallet_borrow"] as const)(
    "%s is priced only by an explicit opening fee policy",
    (action) => {
      expect(() => fees(action, schedule)).toThrow(/opening fee policy/);
    },
  );
});
