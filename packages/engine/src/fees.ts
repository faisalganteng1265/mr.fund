import type { CardAction, Computed, FeeLine, FeeSchedule } from "@mrfund/shared";

/** Fee lines to disclose before the user signs. Zero fees are omitted and stated in assumptions. */
export function fees(action: CardAction, schedule: FeeSchedule): Computed<FeeLine[]> {
  for (const [name, amount] of [
    ["activationFee", schedule.activationFee],
    ["actionFee", schedule.actionFee],
    ["executionFee", schedule.executionFee],
  ] as const) {
    if (amount < 0n) throw new RangeError(`${name} must not be negative`);
  }

  const line = (label: string, amount: bigint, when: string): FeeLine => ({
    label,
    amount,
    tokenId: schedule.tokenId,
    recipientId: schedule.recipientId,
    when,
  });

  const value: FeeLine[] = [];
  const assumptions: string[] = [];
  const add = (label: string, amount: bigint, when: string, none: string) => {
    if (amount > 0n) value.push(line(label, amount, when));
    else assumptions.push(none);
  };

  switch (action) {
    case "repay":
      add(
        "Execution fee",
        schedule.executionFee,
        "Once, in the same signed batch as the repay.",
        "No execution fee is charged.",
      );
      break;
    case "guardian_activate":
      add(
        "Activation fee",
        schedule.activationFee,
        "Once, when you activate the Guardian.",
        "No activation fee is charged.",
      );
      add(
        "Per-action fee",
        schedule.actionFee,
        "Each time the Guardian repays for you, taken from your reserve and counted against your limits.",
        "No per-action fee is charged.",
      );
      break;
    case "guardian_deactivate":
    case "guardian_withdraw":
      assumptions.push("No fee is charged for this action.");
      break;
    case "wallet_collateral_deposit":
    case "wallet_borrow":
      // D24 prices manual repay and Guardian actions; opening has no approved schedule yet, and a
      // missing policy must block the stage rather than read as zero.
      throw new RangeError("opening actions are priced by an explicit opening fee policy");
  }

  return {
    value,
    inputs: { tokenId: schedule.tokenId, recipientId: schedule.recipientId, action },
    assumptions,
    dataAgeMs: 0,
  };
}
