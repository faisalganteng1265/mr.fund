import { REJECT_REASONS } from "@mrfund/guardian-client";
import { baseDecode, baseEncode } from "near-api-js";
import type { WatcherStatus } from "../core/loop";
import type { WatcherEvent } from "../core/types";

function transactionHash(value: string | null): string | undefined {
  try {
    if (!value || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value)) return undefined;
    const bytes = baseDecode(value);
    return bytes.length === 32 && baseEncode(bytes) === value ? value : undefined;
  } catch {
    return undefined;
  }
}

/** Structured output is a fixed projection, never raw RPC errors or key material. */
export function createRuntimeLog(write: (line: string) => void) {
  return {
    event(event: WatcherEvent) {
      write(
        JSON.stringify({
          event: event.event,
          guardianId: event.guardianId,
          at: event.at,
          ...("hash" in event && transactionHash(event.hash)
            ? { hash: transactionHash(event.hash) }
            : {}),
          ...(event.event === "read_failed" &&
          ["rpc_unavailable", "bad_response", "not_found"].includes(event.kind)
            ? { errorCode: event.kind, retryAt: event.retryAt }
            : {}),
          ...(event.event === "request_outcome"
            ? {
                outcome: event.outcome,
                opId: event.opId,
                ...(event.reason && REJECT_REASONS.includes(event.reason)
                  ? { reason: event.reason }
                  : {}),
              }
            : {}),
        }),
      );
    },
    heartbeat(status: WatcherStatus) {
      write(
        JSON.stringify({
          event: "heartbeat",
          observedAt: status.observedAt,
          startedAt: status.startedAt,
          intervalMs: status.intervalMs,
          guardians: status.guardians.map((guardian) => ({
            guardianId: guardian.guardianId,
            network: guardian.network,
            requests: guardian.requests,
            monitoring: guardian.monitoring,
            lastSuccessfulReadAt: guardian.lastSuccessfulReadAt,
            lastEvaluationAt: guardian.lastEvaluationAt,
            pending: guardian.pendingHash !== null,
            ...(transactionHash(guardian.pendingHash)
              ? { pendingHash: transactionHash(guardian.pendingHash) }
              : {}),
            consecutiveReadFailures: guardian.consecutiveReadFailures,
            retryAt: guardian.retryAt,
            hasError: guardian.lastError !== null || guardian.readOnlyReason !== null,
          })),
        }),
      );
    },
  };
}
