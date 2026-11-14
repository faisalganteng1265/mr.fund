import { ok } from "@mrfund/shared";

export const NOW = 1_800_000_000_000;
export const target = { network: "testnet" as const, guardianId: "guardian.testnet" };
export function views() {
  return {
    get_config: {
      owner_id: "alice.testnet",
      watcher_id: "watcher.testnet",
      lending_id: "rhea.testnet",
      oracle_id: "oracle.testnet",
      debt_token_id: "usdc.testnet",
      collateral_token_ids: ["wrap.testnet"],
      fee_recipient_id: "fees.testnet",
      activation_fee: "5",
      lending_version: "0.11.0",
      debt_extra_decimals: 12,
      collateral_extra_decimals: 0,
      collateral_price_id: "11".repeat(32),
      debt_price_id: "22".repeat(32),
      max_price_age_sec: 60,
    },
    get_status: {
      status: "active",
      owner_id: "alice.testnet",
      watcher_id: "watcher.testnet",
      lending_id: "rhea.testnet",
      oracle_id: "oracle.testnet",
      debt_token_id: "usdc.testnet",
      collateral_token_ids: ["wrap.testnet"],
      fee_recipient_id: "fees.testnet",
      in_flight: null,
      last_action_started_ns: "0",
    },
    get_policy: {
      max_per_action: "100",
      lifetime_cap: "1000",
      reserve_floor: "20",
      trigger_hf_bps: 12000,
      target_hf_bps: 15000,
      cooldown_sec: 300,
      action_fee: "1",
    },
    get_reserve: {
      reserve: "200",
      floor: "20",
      spendable: "180",
      lifetime_cap: "1000",
      spent_total: "41",
      lifetime_remaining: "959",
    },
    get_history: [
      {
        op_id: "0",
        at_ns: String(BigInt(NOW - 1000) * 1_000_000n),
        requested: "100",
        outcome: "settled",
        reason: null,
        used: "40",
        fee: "1",
      },
    ],
  };
}
export function fakeClient(data: Record<string, unknown> = views()) {
  const calls: { method: string; args: unknown; blockId: string | undefined }[] = [];
  return {
    calls,
    async view(_id: string, method: string, args: unknown, blockId?: string) {
      calls.push({ method, args, blockId });
      return ok({ data: data[method], blockHeight: 123, blockHash: "block" });
    },
  };
}
