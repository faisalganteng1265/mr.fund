import type { PositionView } from "@mrfund/server/position";
import type { NearNetwork } from "../../wallet/types";
import { apiUrl } from "./apiBase";

function validBalance(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  return (
    "tokenId" in value &&
    typeof value.tokenId === "string" &&
    "symbol" in value &&
    typeof value.symbol === "string" &&
    "atomic" in value &&
    typeof value.atomic === "string" &&
    /^(0|[1-9][0-9]*)$/.test(value.atomic) &&
    "decimals" in value &&
    typeof value.decimals === "number" &&
    Number.isSafeInteger(value.decimals) &&
    value.decimals >= 0 &&
    value.decimals <= 38
  );
}

export type LivePositionState =
  | { status: "loading" }
  | { status: "empty" | "network_mismatch" | "stale" | "unavailable" }
  | { status: "ready"; position: PositionView };

/** Explicit, cancellable refreshes only. Superseded responses never replace newer state. */
export function createLivePosition(
  accountId: string,
  networkId: NearNetwork,
  fetcher: typeof fetch = fetch,
) {
  let state: LivePositionState = { status: "loading" };
  let generation = 0;
  let active: AbortController | undefined;
  let expiry: ReturnType<typeof setTimeout> | undefined;
  const listeners = new Set<() => void>();
  const publish = (next: LivePositionState) => {
    state = next;
    for (const listener of listeners) listener();
  };
  return {
    provenance: "live" as const,
    getSnapshot: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    async refresh(signal?: AbortSignal) {
      signal?.throwIfAborted();
      active?.abort();
      clearTimeout(expiry);
      const controller = new AbortController();
      active = controller;
      const current = ++generation;
      const abort = () => controller.abort();
      signal?.addEventListener("abort", abort, { once: true });
      if (signal?.aborted) abort();
      publish({ status: "loading" });
      try {
        const response = await fetcher(apiUrl("/api/position"), {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ accountId, networkId }),
          signal: controller.signal,
        });
        const data: unknown = await response.json();
        controller.signal.throwIfAborted();
        if (current !== generation) return;
        if (!data || typeof data !== "object") throw new Error("Invalid response");
        if ("networkId" in data && data.networkId !== null && data.networkId !== networkId) {
          publish({ status: "network_mismatch" });
          return;
        }
        if (!response.ok) {
          const code =
            "error" in data && data.error && typeof data.error === "object" && "code" in data.error
              ? data.error.code
              : null;
          publish({
            status:
              code === "network_mismatch"
                ? "network_mismatch"
                : code === "no_position"
                  ? "empty"
                  : code === "stale_data"
                    ? "stale"
                    : "unavailable",
          });
          return;
        }
        if (
          !("ok" in data) ||
          data.ok !== true ||
          !("networkId" in data) ||
          data.networkId !== networkId ||
          !("accountId" in data) ||
          data.accountId !== accountId ||
          !("dataAgeMs" in data) ||
          typeof data.dataAgeMs !== "number" ||
          !("maxDataAgeMs" in data) ||
          typeof data.maxDataAgeMs !== "number" ||
          !Number.isSafeInteger(data.dataAgeMs) ||
          !Number.isSafeInteger(data.maxDataAgeMs) ||
          data.dataAgeMs < 0 ||
          data.maxDataAgeMs <= 0 ||
          !("provenance" in data) ||
          data.provenance !== "live" ||
          !("supplied" in data) ||
          !Array.isArray(data.supplied) ||
          !("collateral" in data) ||
          !Array.isArray(data.collateral) ||
          !("debt" in data) ||
          !Array.isArray(data.debt) ||
          ![...data.supplied, ...data.collateral, ...data.debt].every(validBalance) ||
          !("liquidationPrices" in data) ||
          !Array.isArray(data.liquidationPrices) ||
          !("health" in data) ||
          !data.health ||
          typeof data.health !== "object" ||
          !("kind" in data.health) ||
          !["value", "no_debt"].includes(String(data.health.kind)) ||
          (data.health.kind === "value" &&
            (!("bps" in data.health) ||
              typeof data.health.bps !== "number" ||
              !Number.isSafeInteger(data.health.bps) ||
              data.health.bps < 0))
        )
          throw new Error("Invalid response");
        publish(
          data.dataAgeMs > data.maxDataAgeMs
            ? { status: "stale" }
            : { status: "ready", position: data as PositionView },
        );
        if (data.dataAgeMs <= data.maxDataAgeMs) {
          expiry = setTimeout(
            () => {
              if (current === generation) publish({ status: "stale" });
            },
            data.maxDataAgeMs - data.dataAgeMs + 1,
          );
        }
      } catch {
        if (current === generation && !controller.signal.aborted)
          publish({ status: "unavailable" });
        if (signal?.aborted) signal.throwIfAborted();
      } finally {
        signal?.removeEventListener("abort", abort);
        if (active === controller) active = undefined;
      }
    },
    dispose() {
      ++generation;
      active?.abort();
      clearTimeout(expiry);
    },
  };
}
