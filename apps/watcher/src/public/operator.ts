import type { GuardianSnapshot } from "@mrfund/guardian-client";
import { baseDecode, baseEncode } from "near-api-js";
import { REQUEST_GAS, REQUEST_METHOD, type RepayCall, verifyAuthority } from "../core/authority";
import type { WatcherReads } from "../core/types";
import { reconcileFinal } from "../runtime/reconcile";
import type { PublicOperatorConfig } from "./config";
import type { PublicOperatorJournal } from "./journal";

export interface PublicOperatorDependencies<T = unknown> {
  publicKey: string;
  now(): number;
  provider: {
    viewNodeStatus(): Promise<{ chain_id: string }>;
    viewAccessKey(input: {
      accountId: string;
      publicKey: string;
      finalityQuery: { finality: "final" };
    }): Promise<{ nonce: bigint; permission: unknown }>;
  };
  reads: WatcherReads;
  journal: PublicOperatorJournal;
  sign(call: RepayCall, beforeSign: () => Promise<boolean>): Promise<{ hash: string; signed: T }>;
  broadcast(signed: T): Promise<void>;
  transaction(hash: string): Promise<unknown>;
  emit(record: Record<string, unknown>): void;
}

function validHash(hash: string): boolean {
  try {
    return (
      /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(hash) &&
      baseDecode(hash).length === 32 &&
      baseEncode(baseDecode(hash)) === hash
    );
  } catch {
    return false;
  }
}

function rejectionEvent(
  raw: unknown,
  guardianId: string,
  opId: bigint,
  amount: string,
): Record<string, unknown> | null {
  if (!raw || typeof raw !== "object" || !("receipts_outcome" in raw)) return null;
  const receipts = raw.receipts_outcome;
  if (!Array.isArray(receipts)) return null;
  const events: Record<string, unknown>[] = [];
  for (const receipt of receipts) {
    const outcome = receipt?.outcome;
    if (
      !outcome ||
      typeof outcome !== "object" ||
      !outcome.status ||
      typeof outcome.status !== "object" ||
      !(
        typeof outcome.status.SuccessValue === "string" ||
        typeof outcome.status.SuccessReceiptId === "string"
      ) ||
      !Array.isArray(outcome.logs)
    )
      return null;
    if (outcome.executor_id !== guardianId) continue;
    for (const line of outcome.logs) {
      if (typeof line !== "string" || !line.startsWith("EVENT_JSON:")) continue;
      try {
        const event = JSON.parse(line.slice(11));
        if (
          event.standard === "mrfund_guardian" &&
          event.version === "1.0.0" &&
          event.event === "request_rejected" &&
          Array.isArray(event.data) &&
          event.data.length === 1
        )
          events.push(event.data[0]);
      } catch {
        return null;
      }
    }
  }
  const matching = events.filter(
    (event) =>
      event &&
      event.op_id === String(opId) &&
      event.requested === amount &&
      event.reason === "above_max_per_action",
  );
  return matching.length === 1 ? (matching[0] ?? null) : null;
}

/** Explicit, single-use operator only; the scheduled public watcher remains disabled. */
export async function runPublicOverLimit<T>(
  config: PublicOperatorConfig,
  deps: PublicOperatorDependencies<T>,
): Promise<Record<string, unknown>> {
  const target = { network: "testnet" as const, guardianId: config.guardianId };
  const refused = () => ({ status: "refused" });
  const ambiguous = (hash?: string) =>
    hash ? { status: "ambiguous", hash } : { status: "ambiguous" };
  const checkAuthority = async (): Promise<GuardianSnapshot | null> => {
    const [status, key, result] = await Promise.all([
      deps.provider.viewNodeStatus(),
      deps.provider.viewAccessKey({
        accountId: config.watcherAccountId,
        publicKey: deps.publicKey,
        finalityQuery: { finality: "final" },
      }),
      deps.reads.guardian(target),
    ]);
    if (
      !result.ok ||
      typeof key.nonce !== "bigint" ||
      key.nonce < 0n ||
      result.value.guardianId !== config.guardianId
    )
      return null;
    const authority = verifyAuthority({
      network: "testnet",
      rpcChainId: status.chain_id,
      watcherAccountId: config.watcherAccountId,
      guardian: result.value,
      accessKey: key,
    });
    if (!authority.ok) return null;
    return result.value;
  };
  const ready = (guardian: GuardianSnapshot): boolean => {
    const now = deps.now();
    return (
      Number.isSafeInteger(now) &&
      now >= 0 &&
      guardian.readAtMs <= now &&
      now - guardian.readAtMs <= Math.min(120_000, guardian.config.maxPriceAgeSec * 1000) &&
      guardian.status.status === "active" &&
      guardian.status.inFlight === null &&
      (guardian.status.lastActionStartedNs === 0n ||
        BigInt(now) * 1_000_000n >=
          guardian.status.lastActionStartedNs +
            BigInt(guardian.policy.cooldownSec) * 1_000_000_000n) &&
      guardian.policy.maxPerAction < (1n << 128n) - 1n
    );
  };
  const reportFinal = async (hash: string, amount: string) => {
    if ((await deps.provider.viewNodeStatus().catch(() => null))?.chain_id !== "testnet")
      return ambiguous(hash);
    try {
      const raw = await deps.transaction(hash);
      const snapshot = await deps.reads.guardian(target);
      if (!snapshot.ok) return ambiguous(hash);
      const result = reconcileFinal(raw, hash, config.watcherAccountId, snapshot.value);
      if (
        result.kind !== "final" ||
        result.outcome.outcome !== "rejected" ||
        result.outcome.reason !== "above_max_per_action"
      )
        return ambiguous(hash);
      const event = rejectionEvent(raw, config.guardianId, result.outcome.opId, amount);
      const entry = snapshot.value.history.attempts.find(
        (item) =>
          item.opId === result.outcome.opId &&
          item.requested.toString() === amount &&
          item.outcome === "rejected" &&
          item.reason === "above_max_per_action",
      );
      if (!event || !entry) return ambiguous(hash);
      const record = {
        status: "rejected",
        label: "operator test request",
        hash,
        reason: "AboveMaxPerAction",
        event,
        history: {
          opId: entry.opId.toString(),
          requested: entry.requested.toString(),
          reason: entry.reason,
        },
      };
      deps.emit(record);
      return record;
    } catch {
      return ambiguous(hash);
    }
  };
  try {
    const state = await deps.journal.inspect();
    if (state.kind === "blocked" || (state.kind === "signed" && config.dryRun)) return refused();
    if (state.kind === "signed") {
      deps.emit({
        status: "pending",
        label: "operator test request",
        hash: state.hash,
        explorerUrl: `https://testnet.nearblocks.io/txns/${state.hash}`,
      });
      return await reportFinal(state.hash, state.amount);
    }
    const guardian = await checkAuthority();
    if (!guardian || !ready(guardian)) return refused();
    const amount = (guardian.policy.maxPerAction + 1n).toString();
    if (config.dryRun) {
      const result = { status: "dry_run", label: "operator test request", amount };
      deps.emit(result);
      return result;
    }
    const call: RepayCall = {
      signerId: config.watcherAccountId,
      receiverId: config.guardianId,
      methodName: REQUEST_METHOD,
      args: { amount },
      gas: REQUEST_GAS,
      deposit: 0n,
    };
    await deps.journal.begin(call);
    const signed = await deps.sign(call, async () => {
      const current = await checkAuthority();
      return !!current && ready(current) && current.policy.maxPerAction + 1n === BigInt(amount);
    });
    if (!validHash(signed.hash)) return ambiguous();
    await deps.journal.recordHash(signed.hash);
    deps.emit({
      status: "pending",
      label: "operator test request",
      hash: signed.hash,
      explorerUrl: `https://testnet.nearblocks.io/txns/${signed.hash}`,
    });
    try {
      await deps.broadcast(signed.signed);
    } catch {
      /* Never retransmit an uncertain send. */
    }
    return await reportFinal(signed.hash, amount);
  } catch {
    return ambiguous();
  } finally {
    await deps.journal.close().catch(() => {});
  }
}
