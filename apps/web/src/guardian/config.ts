import { isValidAccountId } from "@mrfund/shared";
import type { Network } from "../execution/verify";

/** Public Guardian settings; none are secret. Missing values block setup, never default. */
export interface GuardianConfig {
  network: Network;
  rpcUrl: string;
  factoryId: string;
  /** Per-action fee written into the policy, in debt-token atomic units (D24). */
  actionFee: bigint;
}

export type GuardianConfigResult =
  | { ok: true; value: GuardianConfig }
  | { ok: false; reason: string };

export function readGuardianConfig(input: {
  network?: string | undefined;
  rpcUrl?: string | undefined;
  factoryId?: string | undefined;
  actionFee?: string | undefined;
}): GuardianConfigResult {
  const { network, factoryId, actionFee } = input;
  if (network !== "testnet" && network !== "mainnet")
    return { ok: false, reason: "Set NEXT_PUBLIC_NEAR_NETWORK_ID to testnet or mainnet." };
  let rpc: URL;
  try {
    rpc = new URL(input.rpcUrl ?? "");
  } catch {
    return { ok: false, reason: "Set NEXT_PUBLIC_NEAR_RPC_URL to an HTTPS NEAR RPC endpoint." };
  }
  if (rpc.protocol !== "https:" || rpc.username || rpc.password)
    return { ok: false, reason: "Use an HTTPS NEAR RPC endpoint without credentials." };
  if (!factoryId)
    return { ok: false, reason: "Set NEXT_PUBLIC_GUARDIAN_FACTORY_ID to enable Guardian setup." };
  if (!isValidAccountId(factoryId) || (network === "testnet") !== factoryId.endsWith(".testnet"))
    return { ok: false, reason: `NEXT_PUBLIC_GUARDIAN_FACTORY_ID is not a ${network} account.` };
  if (!actionFee || !/^(0|[1-9]\d{0,37})$/.test(actionFee))
    return {
      ok: false,
      reason: "Set NEXT_PUBLIC_GUARDIAN_ACTION_FEE_ATOMIC to the decided per-action fee (D24).",
    };
  return {
    ok: true,
    value: { network, rpcUrl: rpc.href, factoryId, actionFee: BigInt(actionFee) },
  };
}

export const publicGuardianConfig = () =>
  readGuardianConfig({
    network: process.env.NEXT_PUBLIC_NEAR_NETWORK_ID,
    rpcUrl: process.env.NEXT_PUBLIC_NEAR_RPC_URL,
    factoryId: process.env.NEXT_PUBLIC_GUARDIAN_FACTORY_ID,
    actionFee: process.env.NEXT_PUBLIC_GUARDIAN_ACTION_FEE_ATOMIC,
  });
