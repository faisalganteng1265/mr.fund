import type { LandingFigures } from "./figures";

export function conversation(f: LandingFigures) {
  return [
    {
      question: "Is my loan getting risky?",
      answer: `Your health is ${f.health}. Liquidation starts near ${f.liquidationUsd} per NEAR. Let's look at the buffer before your next move.`,
      label: "Understand your position",
    },
    {
      question: "Should I repay or earn yield?",
      answer:
        f.winner === "repay"
          ? `Repaying ${f.repayAmount} USDC avoids ${f.repaySaves} USDC of interest over a year, versus ${f.yieldEarns} USDC earned supplying it. Your health would become ${f.healthAfterRepay}.`
          : "Repaying is not the clear winner in this simulated comparison. Let's review the assumptions before choosing.",
      label: "See the comparison",
    },
    {
      question: "What if NEAR drops 20%?",
      answer: `In this simulated scenario, your health becomes ${f.shockHealth}. ${f.shockLiquidatable ? "This position could be liquidated." : "That's above liquidation, with a thinner buffer."} A scenario is not a forecast.`,
      label: "Explore a scenario",
    },
  ] as const;
}
