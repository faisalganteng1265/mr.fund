import {
  createGuardianClient,
  type GuardianViewClient,
  readGuardian,
} from "@mrfund/guardian-client";
import { createRheaClient, type RheaClient, readPosition } from "@mrfund/rhea";
import { err } from "@mrfund/shared";
import { accountMatchesNetwork } from "../core/authority";
import type { WatcherReads } from "../core/types";

export interface ReadAdapters {
  guardian: GuardianViewClient;
  rhea: RheaClient;
  /** True only after a fresh status response identifies the configured network. */
  networkMatches(): Promise<boolean>;
}

async function statusJson(response: Response): Promise<unknown> {
  if (!response.body) throw new Error("Missing status body");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > 16_384) {
        await reader.cancel();
        throw new Error("Oversized status body");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)));
}

/** Read-only adapters: failures are sanitized and never fall back to another network. */
export function watcherReads(network: "testnet" | "mainnet", adapters: ReadAdapters): WatcherReads {
  return {
    async guardian(target) {
      if (
        target.network !== network ||
        !accountMatchesNetwork(target.guardianId, network) ||
        !(await adapters.networkMatches().catch(() => false))
      )
        return err({ kind: "rpc_unavailable", detail: "Network verification failed" });
      return readGuardian(adapters.guardian, target);
    },
    async position(requestedNetwork, lendingId, accountId) {
      if (
        requestedNetwork !== network ||
        !accountMatchesNetwork(lendingId, network) ||
        !accountMatchesNetwork(accountId, network) ||
        !(await adapters.networkMatches().catch(() => false))
      )
        return err({ kind: "rpc_unavailable", detail: "Network verification failed" });
      const client: RheaClient = {
        async view(contractId, method, args, blockId) {
          const result = await adapters.rhea.view(contractId, method, args, blockId);
          if (method !== "get_config" || !result.ok) return result;
          const version = await adapters.rhea.view(
            lendingId,
            "get_version",
            {},
            result.value.blockHash,
          );
          if (!version.ok) return version;
          if (
            version.value.blockHash !== result.value.blockHash ||
            version.value.blockHeight !== result.value.blockHeight ||
            !["0.11.0", "0.16.2"].includes(String(version.value.data))
          )
            return err({ kind: "bad_response", detail: "Unverified lending version" });
          return result;
        },
      };
      const result = await readPosition(client, { network, lendingId }, accountId);
      return result.ok ? result : err({ kind: result.error.kind, detail: "Position read failed" });
    },
  };
}

/** A fresh status check before every polling read; RPC and decode errors remain private. */
export function createWatcherReads(
  network: "testnet" | "mainnet",
  rpcUrl: string,
  fetchImpl: typeof fetch = fetch,
): WatcherReads {
  const noCache: typeof fetch = (target, init) => fetchImpl(target, { ...init, cache: "no-store" });
  return watcherReads(network, {
    guardian: createGuardianClient(rpcUrl, noCache),
    rhea: createRheaClient(rpcUrl, noCache),
    async networkMatches() {
      const response = await fetchImpl(rpcUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: "watcher-network",
          method: "status",
          params: [],
        }),
        signal: AbortSignal.timeout(10_000),
        cache: "no-store",
      });
      if (!response.ok) return false;
      const data = await statusJson(response);
      return (
        typeof data === "object" &&
        data !== null &&
        "result" in data &&
        typeof data.result === "object" &&
        data.result !== null &&
        "chain_id" in data.result &&
        data.result.chain_id === network
      );
    },
  });
}
