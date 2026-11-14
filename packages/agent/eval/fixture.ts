import { MAX_DATA_AGE_MS } from "@mrfund/engine";
import type { GuardianViewClient } from "@mrfund/guardian-client";
import { err, ok } from "@mrfund/shared";
import type { ToolContext } from "../src/tools";
import { baseSnapshot, NOW, USDC, WNEAR } from "../test/fixture";
import type { ContextVariant } from "./cases";

export const EVALUATION_FIXTURE = {
  label: "Simulated" as const,
  version: "chat-eval-2026-11-08-v1",
  frozenAt: "2026-11-08",
  nowMs: NOW,
  network: "testnet",
  source:
    "Hand-computed agent test/fixture.ts and guardian.test.ts RPC shapes; synthetic, not network observations.",
  walletBalanceAtomic: "100100000",
  manualExecutionFeeAtomic: "100000",
  pricing: "Simulated fee, not a product price; D24 remains open.",
};

/** Public view fixture only: no network, signer, transaction sender or wallet. */
export function createEvaluationContext(variant: ContextVariant): ToolContext {
  const snapshot = baseSnapshot();
  if (variant === "missing") delete snapshot.prices[WNEAR];
  if (variant === "stale") snapshot.readAtMs = NOW - MAX_DATA_AGE_MS - 1;
  const config = {
    owner_id: "alice.testnet",
    watcher_id: "watcher.testnet",
    lending_id: snapshot.lendingId,
    oracle_id: "oracle.testnet",
    debt_token_id: USDC,
    collateral_token_ids: [WNEAR],
    fee_recipient_id: "fees.testnet",
    activation_fee: "50000",
    lending_version: "0.11.0",
    debt_extra_decimals: 12,
    collateral_extra_decimals: 0,
    collateral_price_id: "11".repeat(32),
    debt_price_id: "22".repeat(32),
    max_price_age_sec: 60,
  };
  const data: Record<string, unknown> = {
    get_config: config,
    get_status: {
      status: "active",
      owner_id: config.owner_id,
      watcher_id: config.watcher_id,
      lending_id: config.lending_id,
      oracle_id: config.oracle_id,
      debt_token_id: USDC,
      collateral_token_ids: [WNEAR],
      fee_recipient_id: config.fee_recipient_id,
      in_flight: null,
      last_action_started_ns: "0",
    },
    get_policy: {
      max_per_action: "100000000",
      lifetime_cap: "1000000000",
      reserve_floor: "20000000",
      trigger_hf_bps: 12000,
      target_hf_bps: 15000,
      cooldown_sec: 300,
      action_fee: "100000",
    },
    get_reserve: {
      reserve: "200000000",
      floor: "20000000",
      spendable: "180000000",
      lifetime_cap: "1000000000",
      spent_total: "40100000",
      lifetime_remaining: "959900000",
    },
    get_history: [
      {
        op_id: "7",
        at_ns: String(BigInt(NOW - 2000) * 1_000_000n),
        requested: "100000000",
        outcome: "settled",
        reason: null,
        used: "40000000",
        fee: "100000",
      },
      {
        op_id: "8",
        at_ns: String(BigInt(NOW - 1000) * 1_000_000n),
        requested: "300000000",
        outcome: "rejected",
        reason: "above_max_per_action",
        used: "0",
        fee: "0",
      },
    ],
  };
  const client: GuardianViewClient = {
    async view(id, method, _args, blockId) {
      if (
        id !== "guardian.testnet" ||
        !(method in data) ||
        (method !== "get_config" && blockId !== "simulated-final-block")
      ) {
        return err({ kind: "bad_response", detail: "Unsupported Simulated fixture view" });
      }
      return ok({
        data: structuredClone(data[method]),
        blockHash: "simulated-final-block",
        blockHeight: 123,
      });
    },
  };
  return {
    snapshot,
    nowMs: NOW,
    newId: () => "simulated-evaluation-card",
    proposal: {
      walletBalances: { [USDC]: 100_100_000n },
      fees: {
        tokenId: USDC,
        recipientId: "fees.testnet",
        activationFee: 0n,
        actionFee: 0n,
        executionFee: 100_000n,
      },
      lendingId: snapshot.lendingId,
      lendingVersion: "0.11.0",
      feeRecipientRegistered: true,
    },
    guardian: { client, target: { network: "testnet", guardianId: "guardian.testnet" } },
  };
}
