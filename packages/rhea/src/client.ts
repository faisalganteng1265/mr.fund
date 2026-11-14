import { err, isValidAccountId, ok, type Result } from "@mrfund/shared";

export type AdapterError = { kind: "rpc_unavailable" | "bad_response"; detail: string };
export interface ViewResult {
  data: unknown;
  blockHeight: number;
  blockHash: string;
}
export interface RheaClient {
  view(
    contractId: string,
    method: string,
    args: unknown,
    blockId?: string,
  ): Promise<Result<ViewResult, AdapterError>>;
}

export const badResponse = (detail: string): Result<never, AdapterError> =>
  err({ kind: "bad_response", detail });
export function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** No signer, retries or batching. Callers validate the decoded contract data. */
export function createRheaClient(rpcUrl: string, fetchImpl: typeof fetch = fetch): RheaClient {
  return {
    async view(contractId, method, args, blockId) {
      if (!isValidAccountId(contractId) || !/^[a-zA-Z0-9_]+$/.test(method))
        return badResponse("Invalid view target");
      let response: Response;
      try {
        response = await fetchImpl(rpcUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: AbortSignal.timeout(10_000),
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: "view",
            method: "query",
            params: {
              request_type: "call_function",
              ...(blockId === undefined ? { finality: "final" } : { block_id: blockId }),
              account_id: contractId,
              method_name: method,
              args_base64: btoa(
                Array.from(new TextEncoder().encode(JSON.stringify(args)), (byte) =>
                  String.fromCharCode(byte),
                ).join(""),
              ),
            },
          }),
        });
      } catch {
        return err({ kind: "rpc_unavailable", detail: "RPC request failed" });
      }
      if (!response.ok)
        return err({ kind: "rpc_unavailable", detail: `RPC HTTP ${response.status}` });
      try {
        const body: unknown = await response.json();
        if (!object(body) || body.error !== undefined || !object(body.result))
          return badResponse("RPC view failed");
        const r = body.result;
        if (
          !Number.isSafeInteger(r.block_height) ||
          (r.block_height as number) < 0 ||
          typeof r.block_hash !== "string" ||
          !r.block_hash ||
          !Array.isArray(r.result) ||
          !r.result.every(
            (b: unknown) => Number.isInteger(b) && (b as number) >= 0 && (b as number) <= 255,
          )
        )
          return badResponse("Malformed RPC view result");
        const decoded = new TextDecoder("utf-8", { fatal: true }).decode(new Uint8Array(r.result));
        return ok({
          data: JSON.parse(decoded) as unknown,
          blockHeight: r.block_height as number,
          blockHash: r.block_hash,
        });
      } catch {
        return badResponse("Malformed RPC view result");
      }
    },
  };
}
