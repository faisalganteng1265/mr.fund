import { describe, expect, it } from "vitest";
import { landingFigures } from "../src/landing/figures";

describe("landing figures", () => {
  it("shows only engine outputs for the simulated fixture", () => {
    expect(landingFigures()).toEqual({
      collateral: "1,000",
      debt: "1,800",
      health: "158.33%",
      healthAfterRepay: "167.64%",
      liquidationUsd: "$3.15",
      repayAmount: "100",
      repaySaves: "21.00",
      yieldEarns: "14.01",
      winner: "repay",
      shockHealth: "126.66%",
      shockLiquidatable: false,
    });
  });
});
