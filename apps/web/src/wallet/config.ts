import type { WalletConfig } from "./types";

const TEST_CLIENT = "np8paqIpMWmNbzT4xAvOOapZBjsOpptl";

/** Public build-time settings only. Never fall back to a different chain. */
export function readWalletConfig(input: {
  network?: string | undefined;
  rpcUrl?: string | undefined;
  authClientId?: string | undefined;
}): WalletConfig {
  if (input.network !== "testnet" && input.network !== "mainnet") {
    throw new Error("Set NEXT_PUBLIC_NEAR_NETWORK_ID to testnet or mainnet.");
  }
  let rpc: URL;
  try {
    rpc = new URL(input.rpcUrl ?? "");
  } catch {
    throw new Error("Set NEXT_PUBLIC_NEAR_RPC_URL to an HTTPS NEAR RPC endpoint.");
  }
  if (rpc.protocol !== "https:" || rpc.username || rpc.password || rpc.hash) {
    throw new Error("Use an HTTPS NEAR RPC endpoint without credentials or a fragment.");
  }
  const clientId = input.authClientId || (input.network === "testnet" ? TEST_CLIENT : undefined);
  if (
    clientId &&
    (!/^[A-Za-z0-9_-]{1,128}$/.test(clientId) ||
      (input.network === "mainnet" && clientId === TEST_CLIENT))
  ) {
    throw new Error("Use the Auth client id approved for this network.");
  }
  const testnet = input.network === "testnet";
  return {
    network: input.network,
    rpcUrl: rpc.href,
    auth: clientId
      ? {
          clientId,
          domain: testnet ? "login.testnet.fast-auth.com" : "login.auth.near.org",
          contractId: testnet ? "fast-auth.testnet" : "fast-auth.near",
          mpcId: testnet ? "v1.signer-prod.testnet" : "v1.signer",
        }
      : null,
  };
}
