import { type RepayPlan, validateRepayPlan } from "@mrfund/rhea";
import type { VerifiedRepay } from "./verify";

/** Minimal slice of `FinalExecutionOutcome` the plan needs; everything else stays untrusted. */
export interface WalletOutcome {
  transaction?: { hash?: unknown; signer_id?: unknown; receiver_id?: unknown };
}

export type PlanResult = { ok: true; value: RepayPlan } | { ok: false; reason: string };

/**
 * Pair each verified transaction with the hash the wallet returned for it (task 1.3). Hashes
 * come only from the wallet result, never from the model or server, and are paired in order
 * after checking signer and receiver. A missing, extra or duplicated outcome fails, so the caller
 * falls back to observation instead of trusting a partial plan.
 */
export function assembleRepayPlan(verified: VerifiedRepay, outcomes: unknown): PlanResult {
  if (!Array.isArray(outcomes)) return { ok: false, reason: "The wallet returned no outcomes." };
  if (outcomes.length !== verified.transactions.length)
    return { ok: false, reason: "The wallet returned a different number of outcomes." };
  const transactions = verified.transactions.map((tx, i) => {
    const o = outcomes[i] as WalletOutcome | null | undefined;
    const t = o && typeof o === "object" ? o.transaction : undefined;
    if (!t || typeof t.hash !== "string") return null;
    if (t.signer_id !== verified.signerId || t.receiver_id !== tx.receiverId) return null;
    return {
      hash: t.hash,
      signerId: verified.signerId,
      receiverId: tx.receiverId,
      methodName: tx.methodName,
      argsJson: tx.argsJson,
      deposit: tx.deposit,
      role: tx.role,
    };
  });
  if (transactions.some((t) => t === null))
    return { ok: false, reason: "A wallet outcome does not match the transaction it signed." };
  const plan: RepayPlan = {
    network: verified.network,
    accountId: verified.signerId,
    lendingId: verified.lendingId,
    tokenId: verified.tokenId,
    lendingVersion: verified.lendingVersion,
    transactions: transactions as RepayPlan["transactions"],
  };
  const valid = validateRepayPlan(plan);
  return valid.ok ? { ok: true, value: plan } : { ok: false, reason: valid.error.detail };
}
