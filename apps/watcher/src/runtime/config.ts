import { accountMatchesNetwork } from "../core/authority";

export interface WatcherConfig {
  network: "testnet" | "mainnet";
  rpcUrl: string;
  watcherAccountId: string;
  guardianId: string;
  keysDirectory: string;
}

/** Require explicit network and one Guardian; no hidden account, RPC or key defaults. */
export function readWatcherConfig(
  env: Readonly<Record<string, string | undefined>>,
  args: readonly string[],
): WatcherConfig {
  const network = env.NEAR_NETWORK_ID;
  if (network !== "testnet" && network !== "mainnet")
    throw new Error("Invalid watcher configuration");
  const watcherAccountId = env.WATCHER_ACCOUNT_ID;
  const guardianId = args[0];
  const keysDirectory = env.WATCHER_KEYS_DIR;
  if (
    args.length !== 1 ||
    !watcherAccountId ||
    !guardianId ||
    !keysDirectory ||
    !accountMatchesNetwork(watcherAccountId, network) ||
    !accountMatchesNetwork(guardianId, network)
  )
    throw new Error("Invalid watcher configuration");
  let rpc: URL;
  try {
    rpc = new URL(env.NEAR_RPC_URL ?? "");
  } catch {
    throw new Error("Invalid watcher configuration");
  }
  if (rpc.protocol !== "https:" || rpc.username || rpc.password || rpc.hash)
    throw new Error("Invalid watcher configuration");
  return { network, rpcUrl: rpc.toString(), watcherAccountId, guardianId, keysDirectory };
}
