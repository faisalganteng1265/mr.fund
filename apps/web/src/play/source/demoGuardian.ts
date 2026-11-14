import { type GuardianPolicy, validatePolicy } from "@mrfund/shared";
import { atomic, DEMO_FEE } from "../demo";
import { amount } from "../display";
import type { DemoExecution } from "./demoExecution";
import type { DemoSession } from "./demoSession";
import type { GuardianPort, GuardianView, PolicyFields } from "./types";

export function createDemoGuardian(session: DemoSession, execution: DemoExecution) {
  let state: GuardianView = {
    guardian: "inactive",
    reserve: 0n,
    guardianSpent: 0n,
    guardianDebt: 1_800_000_000n,
    savedFields: {
      max: "100",
      cap: "400",
      floor: "100",
      deposit: "500",
      trigger: "120",
      target: "150",
      cooldown: "5",
    },
    watcherOnline: true,
    spendable: 0n,
    remaining: 400_000_000n,
  };
  const listeners = new Set<() => void>();
  function update(next: Partial<GuardianView>) {
    state = { ...state, ...next };
    const floor = atomic(state.savedFields.floor) ?? 0n,
      cap = atomic(state.savedFields.cap) ?? 0n;
    state.spendable = state.reserve > floor ? state.reserve - floor : 0n;
    state.remaining = cap > state.guardianSpent ? cap - state.guardianSpent : 0n;
    for (const listener of listeners) listener();
  }
  function validate(fields: PolicyFields) {
    const maxPerAction = atomic(fields.max),
      lifetimeCap = atomic(fields.cap),
      reserveFloor = atomic(fields.floor),
      deposit = atomic(fields.deposit);
    if (maxPerAction === null || lifetimeCap === null || reserveFloor === null || deposit === null)
      return "Use positive token amounts with up to 6 decimals.";
    const policy: GuardianPolicy = {
      maxPerAction,
      lifetimeCap,
      reserveFloor,
      triggerHfBps: Math.round(Number(fields.trigger) * 100),
      targetHfBps: fields.target ? Math.round(Number(fields.target) * 100) : null,
      cooldownSec: Number(fields.cooldown) * 60,
      actionFee: 0n,
    };
    if (!Number.isFinite(Number(fields.trigger)) || !Number.isFinite(Number(fields.target)))
      return "Enter a valid health threshold.";
    if (!validatePolicy(policy).ok)
      return "Trigger must be ≥105%, target above trigger, cooldown ≥5 minutes, and lifetime cap ≥ a positive action maximum.";
    if (deposit < maxPerAction + reserveFloor)
      return "Reserve deposit must cover the action maximum plus the reserve floor.";
    if (deposit + DEMO_FEE.activationFee > session.port.getSnapshot().walletBalance)
      return "Your mock wallet cannot cover this reserve and activation fee.";
    return null;
  }
  const port: GuardianPort = {
    provenance: "simulated",
    getSnapshot: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    validate,
    prepare(action, fields) {
      if (action === "activate") {
        const error = validate(fields);
        if (error) return error;
        const deposit = atomic(fields.deposit) ?? 0n;
        return execution.prepare(
          "Activate Guardian",
          "Simulate creating a separate Guardian-held loan and funding its reserve. Your wallet loan is not moved. Includes a 1.00 test USDC activation fee to fees.demo.testnet.",
          `${amount(deposit + DEMO_FEE.activationFee)} test USDC`,
          () => {
            update({
              guardian: "active",
              savedFields: { ...fields },
              reserve: deposit,
              guardianSpent: 0n,
              guardianDebt: 1_800_000_000n,
            });
            session.changeBalance(-deposit - DEMO_FEE.activationFee);
            execution.addReceipt(
              "Guardian activated",
              `Simulated reserve ${amount(deposit)} USDC; activation fee 1.00 test USDC. Separate Guardian-held loan fixture. No contract was created.`,
            );
            return "Your demo Guardian is on watch.";
          },
        );
      }
      const reserve = state.reserve;
      if (action === "withdraw" && reserve === 0n) return "There is no reserve left to withdraw.";
      const topup = 50_000_000n;
      if (action === "topup" && session.port.getSnapshot().walletBalance < topup)
        return "The mock wallet needs 50 USDC for this top-up.";
      const titles = {
        pause: "Pause Guardian",
        resume: "Resume Guardian",
        deactivate: "Deactivate Guardian",
        withdraw: "Withdraw reserve",
        topup: "Top up reserve",
      };
      return execution.prepare(
        titles[action],
        action === "deactivate"
          ? "Stops future demo automation. Past actions stay in history, and unused reserve can still be withdrawn."
          : action === "withdraw"
            ? "Returns all unlocked demo reserve to your mock wallet. The floor limits automation, not owner withdrawals."
            : "Simulated owner approval. No transaction or contract call is sent.",
        action === "withdraw"
          ? `${amount(reserve)} test USDC`
          : action === "topup"
            ? "50.00 test USDC"
            : "No token transfer",
        () => {
          if (action === "withdraw") {
            session.changeBalance(reserve);
            update({ reserve: 0n });
          } else if (action === "topup") {
            session.changeBalance(-topup);
            update({ reserve: state.reserve + topup });
          } else
            update({
              guardian:
                action === "pause" ? "paused" : action === "resume" ? "active" : "deactivated",
            });
          execution.addReceipt(
            titles[action],
            "Owner control simulated with mock-wallet approval. No chain transaction.",
          );
          return `${titles[action]} simulated.`;
        },
      );
    },
    replay(overLimit) {
      const { guardian, watcherOnline, savedFields, spendable, remaining, guardianDebt } = state;
      const max = atomic(savedFields.max) ?? 0n;
      if (overLimit) {
        execution.addReceipt(
          "Over-limit request rejected",
          `Simulated operator test: requested ${amount(max + 1_000_000n)} USDC; your per-action limit is ${savedFields.max} USDC. Reason: AboveMaxPerAction. Reserve unchanged.`,
          "rejected",
        );
        return "Over-limit demo request rejected. Reserve unchanged.";
      }
      if (guardian !== "active" || !watcherOnline)
        return !watcherOnline
          ? "Watcher is offline. Replay blocked."
          : "Guardian must be active for a trigger replay.";
      if (
        execution.port.getSnapshot().receipts.some((r) => r.title === "Guardian repay replayed")
      ) {
        execution.addReceipt(
          "Guardian request rejected",
          `Simulated cooldown is ${savedFields.cooldown} minutes. Reset the demo to replay again.`,
          "rejected",
        );
        return "Cooldown blocks another demo replay.";
      }
      const value = [max, spendable, remaining, guardianDebt].reduce((a, b) => {
        if (a < b) return a;
        return b;
      });
      if (value <= 0n) {
        execution.addReceipt(
          "Guardian request rejected",
          "Reserve floor, lifetime cap, or remaining debt prevents another action.",
          "rejected",
        );
        return "";
      }
      update({
        reserve: state.reserve - value,
        guardianSpent: state.guardianSpent + value,
        guardianDebt: guardianDebt - value,
      });
      execution.addReceipt(
        "Guardian repay replayed",
        `SIMULATED trigger crossing: replay repaid ${amount(value)} USDC from the separate Guardian reserve. Action fee: 0.00. Reserve, floor, and lifetime cap enforced by local demo code only.`,
      );
      return "Labelled trigger replay completed. No on-chain protection is claimed.";
    },
    setWatcherOnline(online) {
      update({ watcherOnline: online });
    },
  };
  return {
    port,
    reset() {
      update({
        guardian: "inactive",
        reserve: 0n,
        guardianSpent: 0n,
        guardianDebt: 1_800_000_000n,
      });
    },
  };
}
