import { createRheaClient, type RheaClient, readPosition } from "@mrfund/rhea";
import type { PositionSnapshot } from "@mrfund/shared";
import { bindTurnFetch, record } from "../transport";
import { networkAccount, type PositionConfig } from "./config";

export class PositionReadError extends Error {
  constructor(
    readonly code:
      | "network_mismatch"
      | "rpc_unavailable"
      | "untrusted_data"
      | "unsupported_protocol_version"
      | "stale_data"
      | "no_position"
      | "timeout",
  ) {
    super(code);
  }
}
export interface PositionSource {
  protocol: "rhea";
  lendingId: string;
  lendingVersion: string;
  blockHash: string;
  blockHeight: number;
}
export interface PositionRead {
  snapshot: PositionSnapshot;
  source: PositionSource | null;
  client: RheaClient;
  boundFetch: typeof fetch;
}

/** Chat deliberately retains optional version enrichment; HTTP position reads require provenance. */
export function createPositionLoader(
  config: PositionConfig,
  fetchImpl: typeof fetch,
  verifyProvenance: boolean,
) {
  return async (accountId: string, signal: AbortSignal): Promise<PositionRead> => {
    signal.throwIfAborted();
    if (!networkAccount(accountId, config.network)) throw new PositionReadError("network_mismatch");
    let transportFailure: PositionReadError | undefined;
    const bounded = bindTurnFetch(fetchImpl, signal);
    const boundFetch: typeof fetch = async (target, init) => {
      try {
        return await bounded(target, { ...init, cache: "no-store" });
      } catch (error) {
        signal.throwIfAborted();
        transportFailure = new PositionReadError(
          init?.signal?.aborted
            ? "timeout"
            : error instanceof RangeError
              ? "untrusted_data"
              : "rpc_unavailable",
        );
        throw transportFailure;
      }
    };
    const status = await boundFetch(config.rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: "public-network", method: "status", params: [] }),
      signal: AbortSignal.timeout(10_000),
    });
    let chain: unknown;
    try {
      chain = await status.json();
    } catch {
      throw new PositionReadError("untrusted_data");
    }
    if (!record(chain) || !record(chain.result) || typeof chain.result.chain_id !== "string")
      throw new PositionReadError("untrusted_data");
    if (chain.result.chain_id !== config.network) throw new PositionReadError("network_mismatch");
    const client = createRheaClient(config.rpcUrl, boundFetch);
    let source: PositionSource | null = null;
    let provenanceFailure: PositionReadError | undefined;
    const wrapped: RheaClient = {
      async view(contractId, method, args, blockId) {
        signal.throwIfAborted();
        const result = await client.view(contractId, method, args, blockId);
        signal.throwIfAborted();
        if (verifyProvenance && method === "get_config" && result.ok) {
          const anchor = result.value;
          const version = await client.view(config.lendingId, "get_version", {}, anchor.blockHash);
          signal.throwIfAborted();
          if (!version.ok) return version;
          if (
            version.value.blockHash !== anchor.blockHash ||
            version.value.blockHeight !== anchor.blockHeight ||
            typeof version.value.data !== "string" ||
            !/^\d+\.\d+\.\d+$/.test(version.value.data)
          ) {
            provenanceFailure = new PositionReadError("untrusted_data");
          } else if (!["0.11.0", "0.16.2"].includes(version.value.data)) {
            provenanceFailure = new PositionReadError("unsupported_protocol_version");
          } else {
            source = {
              protocol: "rhea",
              lendingId: config.lendingId,
              lendingVersion: version.value.data,
              blockHash: anchor.blockHash,
              blockHeight: anchor.blockHeight,
            };
          }
          if (provenanceFailure) throw provenanceFailure;
        }
        return result;
      },
    };
    const result = await readPosition(wrapped, config, accountId);
    signal.throwIfAborted();
    if (transportFailure) throw transportFailure;
    if (provenanceFailure) throw provenanceFailure;
    if (!result.ok)
      throw new PositionReadError(
        result.error.kind === "rpc_unavailable" ? "rpc_unavailable" : "untrusted_data",
      );
    if (
      verifyProvenance &&
      (!source || (source as PositionSource).blockHeight !== result.value.blockHeight)
    )
      throw new PositionReadError("untrusted_data");
    return { snapshot: result.value, source, client, boundFetch };
  };
}
