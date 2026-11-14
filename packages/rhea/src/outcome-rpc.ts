import { err, isValidAccountId, ok } from "@mrfund/shared";
import { object } from "./client";
import type { OpeningOutcomeReader } from "./open-position-outcome";
import { OUTCOME_LIMITS } from "./outcome";
import type { ExpectedTransaction, OutcomeError, OutcomeReader, RepayPlan } from "./outcome-types";

class RpcReadError extends Error {
  constructor(
    readonly kind: OutcomeError["kind"],
    detail: string,
  ) {
    super(detail);
  }
}
const bad = () => new RpcReadError("bad_response", "Malformed outcome RPC response");
async function body(response: Response): Promise<unknown> {
  if (!response.ok) throw new RpcReadError("rpc_unavailable", "Outcome RPC HTTP failure");
  if (!response.body) throw bad();
  const stream = response.body.getReader(),
    decoder = new TextDecoder("utf-8", { fatal: true });
  let text = "",
    bytes = 0;
  try {
    for (;;) {
      const chunk = await stream.read();
      if (chunk.done) break;
      bytes += chunk.value.length;
      if (bytes > 2_000_000)
        throw new RpcReadError("limit_exceeded", "Outcome RPC byte limit exceeded");
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
    return JSON.parse(text) as unknown;
  } finally {
    await stream.cancel().catch(() => {});
    stream.releaseLock();
  }
}
/** Configured endpoint only; status reads never sign, broadcast, or retry. */
export function createOutcomeReader(
  rpcUrl: string,
  network: RepayPlan["network"],
  fetchImpl: typeof fetch = fetch,
): OutcomeReader & OpeningOutcomeReader {
  return {
    // The lookup uses only the hash and the signer, so one reader serves repays and openings.
    async read(expected: Pick<ExpectedTransaction, "hash" | "signerId">, signal) {
      try {
        if (
          !["testnet", "mainnet"].includes(network) ||
          !isValidAccountId(expected.signerId) ||
          !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(expected.hash)
        )
          return err({ kind: "invalid_plan", detail: "Invalid lookup identity" });
        const deadline = AbortSignal.any([signal, AbortSignal.timeout(10_000)]);
        const rpc = async (method: string, params: unknown): Promise<unknown> => {
          const v = await body(
            await fetchImpl(rpcUrl, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              signal: deadline,
              body: JSON.stringify({ jsonrpc: "2.0", id: "outcome", method, params }),
            }),
          );
          if (!object(v)) throw bad();
          if (v.error !== undefined) {
            if (
              method === "EXPERIMENTAL_tx_status" &&
              object(v.error) &&
              object(v.error.cause) &&
              v.error.cause.name === "UNKNOWN_TRANSACTION"
            )
              return null;
            throw new RpcReadError("rpc_unavailable", "Outcome RPC lookup failed");
          }
          if (v.result === undefined) throw bad();
          return v.result;
        };
        const chain = await rpc("status", []);
        if (!object(chain) || chain.chain_id !== network)
          return err({
            kind: "identity_mismatch",
            detail: "RPC chain differs from configured network",
          });
        const outcome = await rpc("EXPERIMENTAL_tx_status", {
          tx_hash: expected.hash,
          sender_account_id: expected.signerId,
          wait_until: "FINAL",
        });
        if (outcome === null) return ok(null);
        if (!object(outcome)) throw bad();
        if (outcome.final_execution_status === "NONE" && !outcome.transaction)
          return ok({ network, outcome, blocks: [] });
        if (!object(outcome.transaction_outcome) || !Array.isArray(outcome.receipts_outcome))
          throw bad();
        if (outcome.receipts_outcome.length > OUTCOME_LIMITS.receipts)
          throw new RpcReadError("limit_exceeded", "Receipt count limit exceeded");
        const hashes = new Set<string>();
        for (const r of [outcome.transaction_outcome, ...outcome.receipts_outcome]) {
          if (
            !object(r) ||
            typeof r.block_hash !== "string" ||
            !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(r.block_hash)
          )
            throw bad();
          hashes.add(r.block_hash);
        }
        const blocks: unknown[] = [];
        for (const hash of hashes) {
          const block = await rpc("block", { block_id: hash });
          if (!object(block) || !object(block.header) || block.header.hash !== hash) throw bad();
          blocks.push(block.header);
        }
        return ok({ network, outcome, blocks });
      } catch (e) {
        return err({
          kind: e instanceof RpcReadError ? e.kind : "rpc_unavailable",
          detail: e instanceof RpcReadError ? e.message : "Outcome RPC unavailable or cancelled",
        });
      }
    },
  };
}
