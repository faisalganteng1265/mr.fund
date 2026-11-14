import type { GuardianSnapshot } from "@mrfund/guardian-client";
import { parseRequestOutcome } from "../core/authority";
import type { TxLookup } from "../core/types";

/** A terminal receipt alone is insufficient: the final Guardian state must corroborate it. */
export function reconcileFinal(
  raw: unknown,
  hash: string,
  signerId: string,
  guardian: GuardianSnapshot,
): TxLookup {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { kind: "unknown" };
  const value = raw as Record<string, unknown>;
  if (value.final_execution_status !== "FINAL") return { kind: "pending" };
  if (
    !value.transaction ||
    typeof value.transaction !== "object" ||
    Array.isArray(value.transaction)
  )
    return { kind: "unknown" };
  const tx = value.transaction as Record<string, unknown>;
  if (tx.hash !== hash || tx.signer_id !== signerId || tx.receiver_id !== guardian.guardianId)
    return { kind: "unknown" };
  if (!value.status || typeof value.status !== "object" || Array.isArray(value.status))
    return { kind: "pending" };
  const status = value.status as Record<string, unknown>;
  // Failure alone does not establish which receipts changed Guardian state.
  if ("Failure" in status) return { kind: "pending" };
  if (
    typeof status.SuccessValue !== "string" ||
    status.SuccessValue.length > 4096 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(status.SuccessValue)
  )
    return { kind: "pending" };
  let decoded: unknown;
  try {
    decoded = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(Buffer.from(status.SuccessValue, "base64")),
    );
  } catch {
    return { kind: "pending" };
  }
  const outcome = parseRequestOutcome(decoded);
  if (!outcome || outcome.outcome === "unresolved" || guardian.status.inFlight !== null)
    return { kind: "pending" };
  const entry = guardian.history.attempts.find((attempt) => attempt.opId === outcome.opId);
  if (!entry) return { kind: "pending" };
  if (
    outcome.outcome === "rejected" &&
    (entry.outcome !== "rejected" || entry.reason !== outcome.reason)
  )
    return { kind: "pending" };
  if (outcome.outcome === "failed" && entry.outcome !== "failed") return { kind: "pending" };
  if (
    outcome.outcome === "executed" &&
    (entry.outcome !== "settled" || entry.used !== outcome.used || entry.fee !== outcome.fee)
  )
    return { kind: "pending" };
  return { kind: "final", outcome };
}
