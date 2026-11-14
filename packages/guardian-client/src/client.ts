import { err, isValidAccountId, ok, type Result } from "@mrfund/shared";
import { integer, record } from "./parse";
import type { GuardianReadError, GuardianViewClient } from "./types";

const bad = (): Result<never, GuardianReadError> =>
  err({ kind: "bad_response", detail: "Invalid Guardian RPC response or target" });
class BodyUnavailable extends Error {}
const unavailable = (): Result<never, GuardianReadError> =>
  err({ kind: "rpc_unavailable", detail: "Guardian RPC unavailable" });
async function boundedJson(response: Response): Promise<unknown> {
  if (!response.body) throw new Error("Missing response");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      let part: Awaited<ReturnType<typeof reader.read>>;
      try {
        part = await reader.read();
      } catch {
        throw new BodyUnavailable();
      }
      const { done, value } = part;
      if (done) break;
      size += value.byteLength;
      if (size > 1_048_576) {
        await reader.cancel();
        throw new Error("Oversized response");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
}
/** Guardian, factory, NEP-141/145 and Rhea account views; nothing here can change state. */
const VIEW_METHODS = [
  "get_config",
  "get_status",
  "get_policy",
  "get_reserve",
  "get_history",
  "get_guardian",
  "get_next_guardian_id",
  "get_template",
  "get_limits",
  "get_unclaimed",
  "is_pending",
  "storage_balance_of",
  "storage_balance_bounds",
  "ft_metadata",
  // Guardian-held loan reads (task 5.5): the Guardian's Rhea account and its token balances.
  "get_account",
  "ft_balance_of",
];
/** Public final-block views only. No signer, retry, account creation or mutation transport. */
export function createGuardianClient(
  rpcUrl: string,
  fetchImpl: typeof fetch = fetch,
): GuardianViewClient {
  return {
    async view(contractId, method, args, blockId) {
      if (
        !isValidAccountId(contractId) ||
        !VIEW_METHODS.includes(method) ||
        (blockId !== undefined && (typeof blockId !== "string" || !blockId || blockId.length > 128))
      )
        return bad();
      let response: Response;
      try {
        response = await fetchImpl(rpcUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: AbortSignal.timeout(10_000),
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: "guardian-view",
            method: "query",
            params: {
              request_type: "call_function",
              account_id: contractId,
              method_name: method,
              args_base64: btoa(
                Array.from(new TextEncoder().encode(JSON.stringify(args)), (b) =>
                  String.fromCharCode(b),
                ).join(""),
              ),
              ...(blockId === undefined ? { finality: "final" } : { block_id: blockId }),
            },
          }),
        });
      } catch {
        return err({ kind: "rpc_unavailable", detail: "Guardian RPC request failed" });
      }
      if (!response.ok)
        return err({ kind: "rpc_unavailable", detail: "Guardian RPC HTTP failure" });
      try {
        const body = record(await boundedJson(response));
        if (body.error !== undefined) {
          const error = record(body.error);
          const cause =
            typeof error.cause === "object" && error.cause !== null ? record(error.cause) : null;
          if (cause?.name === "UNKNOWN_ACCOUNT")
            return err({ kind: "not_found", detail: "Guardian account not found" });
          if (
            error.code === -32603 ||
            ["TIMEOUT_ERROR", "INTERNAL_ERROR", "UNAVAILABLE_SHARD", "NO_SYNCED_BLOCKS"].includes(
              String(cause?.name),
            )
          )
            return unavailable();
          return bad();
        }
        const r = record(body.result);
        const blockHeight = integer(r.block_height, Number.MAX_SAFE_INTEGER);
        if (
          typeof r.block_hash !== "string" ||
          !r.block_hash ||
          r.block_hash.length > 128 ||
          !Array.isArray(r.result) ||
          r.result.length > 262144 ||
          !r.result.every(
            (b: unknown) => typeof b === "number" && Number.isInteger(b) && b >= 0 && b <= 255,
          )
        )
          return bad();
        return ok({
          data: JSON.parse(
            new TextDecoder("utf-8", { fatal: true }).decode(new Uint8Array(r.result)),
          ) as unknown,
          blockHeight,
          blockHash: r.block_hash,
        });
      } catch (e) {
        return e instanceof BodyUnavailable ? unavailable() : bad();
      }
    },
  };
}
