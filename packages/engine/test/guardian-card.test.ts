import type { GuardianPolicy, GuardianState } from "@mrfund/shared";
import { expect, it } from "vitest";
import { guardianOwnerCard } from "../src/guardian-card";

const now = 1_800_000_000_000;
const state: GuardianState = {
  status: "deactivated",
  ownerId: "alice.testnet",
  watcherId: "watcher.testnet",
  debtTokenId: "usdc.testnet",
  reserve: 200n,
  spentTotal: 40n,
  inFlight: null,
  lastActionStartedNs: 0n,
};
const policy: GuardianPolicy = {
  maxPerAction: 100n,
  lifetimeCap: 1000n,
  reserveFloor: 20n,
  triggerHfBps: 12000,
  targetHfBps: 15000,
  cooldownSec: 300,
  actionFee: 1n,
};
const token = { id: "usdc.testnet", symbol: "USDC", decimals: 2, extraDecimals: 12 };
it("permits deactivated owner withdrawal below the automation reserve floor", () => {
  const r = guardianOwnerCard(
    state,
    policy,
    { action: "guardian_withdraw", amount: 200n, token },
    now,
    now,
  );
  expect(r.ok).toBe(true);
  if (r.ok) {
    expect(r.value.numbers).toContainEqual({
      label: "Booked reserve",
      before: "2",
      after: "0",
      unit: "USDC",
    });
    expect(r.value.fees).toEqual([]);
  }
});
it("refuses stale state, over-withdrawal and locked withdrawals", () => {
  for (const [s, amount, at] of [
    [state, 201n, now],
    [{ ...state, inFlight: { opId: 1n, amount: 1n, fee: 0n } }, 1n, now],
    [state, 1n, now + 120001],
  ] as const)
    expect(
      guardianOwnerCard(s, policy, { action: "guardian_withdraw", amount, token }, now, at).ok,
    ).toBe(false);
});
it("allows deactivation while an automatic action is in flight", () => {
  const r = guardianOwnerCard(
    { ...state, status: "active", inFlight: { opId: 1n, amount: 1n, fee: 0n } },
    policy,
    { action: "guardian_deactivate", amount: 0n, token },
    now,
    now,
  );
  expect(r.ok).toBe(true);
});
