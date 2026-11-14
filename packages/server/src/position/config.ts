import { isValidAccountId } from "@mrfund/shared";

export interface PositionConfig {
  network: "testnet" | "mainnet";
  rpcUrl: string;
  lendingId: string;
}

/** Syntax is an app convention, not proof of existence or implicit-account network. */
export function networkAccount(value: string, network: PositionConfig["network"]): boolean {
  if (!isValidAccountId(value)) return false;
  if (/^[a-f0-9]{64}$/.test(value)) return true;
  const testnet = value === "testnet" || value.endsWith(".testnet");
  return network === "testnet" ? testnet : !testnet;
}

/** No browser, credential, fee or default-network dependency for public reads. */
export function readPositionConfig(
  env: Readonly<Record<string, string | undefined>>,
): PositionConfig | null {
  try {
    const network = env.NEAR_NETWORK_ID;
    if (network !== "testnet" && network !== "mainnet") return null;
    const rpc = new URL(env.NEAR_RPC_URL ?? "");
    if (rpc.protocol !== "https:" || rpc.username || rpc.password || rpc.hash) return null;
    const lendingId = env.RHEA_LENDING_ID ?? "";
    if (!networkAccount(lendingId, network)) return null;
    return { network, rpcUrl: rpc.toString(), lendingId };
  } catch {
    return null;
  }
}
