import { MAX_DATA_AGE_MS } from "@mrfund/engine";
import { createAdmission, edgeIp, type ProxyConfig, type RateLimit } from "../admission";
import { abortable, readBoundedBody } from "../transport";
import { networkAccount, type PositionConfig } from "./config";
import { positionError } from "./errors";
import { createPositionLoader, type PositionRead, PositionReadError } from "./loader";
import { presentPosition } from "./presenter";
import { type PositionSelectors, parsePositionSelectors } from "./selectors";

export interface PositionHandlerDependencies {
  config: PositionConfig | null;
  fetchImpl?: typeof fetch;
  now?: () => number;
  maxDataAgeMs?: number;
  proxy?: ProxyConfig;
  rateLimit?: RateLimit;
  loadPosition?: (
    accountId: string,
    signal: AbortSignal,
  ) => Promise<Pick<PositionRead, "snapshot" | "source">>;
}
export type PositionHandler = (request: Request) => Promise<Response>;
export function createPositionHandler(deps: PositionHandlerDependencies): PositionHandler {
  const now = deps.now ?? Date.now;
  const limit = deps.rateLimit ?? { requests: 30, windowMs: 60000, maxEntries: 4096 };
  const allow = createAdmission(limit, now);
  const load =
    deps.loadPosition ??
    (deps.config ? createPositionLoader(deps.config, deps.fetchImpl ?? fetch, true) : undefined);
  const execute = async (request: Request, signal: AbortSignal): Promise<Response> => {
    const network = deps.config?.network ?? null;
    const limited = () =>
      positionError("rate_limited", network, {
        "retry-after": String(Math.ceil(limit.windowMs / 1000)),
      });
    if (!allow([`ip:${edgeIp(request, deps.proxy)}`])) return limited();
    if (request.method !== "GET" && request.method !== "POST")
      return positionError("method_not_allowed", network, { allow: "GET, POST" });
    const maxAge = deps.maxDataAgeMs ?? MAX_DATA_AGE_MS;
    if (!deps.config || !load || !Number.isSafeInteger(maxAge) || maxAge <= 0)
      return positionError("configuration_unavailable", network);
    let selectors: PositionSelectors;
    try {
      const url = new URL(request.url);
      if (new TextEncoder().encode(url.search.slice(1)).byteLength > 512)
        return positionError("request_too_large", network);
      if (request.method === "POST") {
        if (
          request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !==
          "application/json"
        )
          return positionError("invalid_content_type", network);
        if (url.search) return positionError("invalid_input", network);
        selectors = parsePositionSelectors(await readBoundedBody(request.body, 1024, signal));
      } else selectors = parsePositionSelectors(url.searchParams);
    } catch (error) {
      return positionError(
        signal.aborted
          ? "cancelled"
          : error instanceof RangeError
            ? "request_too_large"
            : "invalid_input",
        network,
      );
    }
    if (
      selectors.networkId !== network ||
      !networkAccount(selectors.accountId, deps.config.network)
    )
      return positionError("network_mismatch", network);
    if (!allow([`account:${network}:${selectors.accountId}`])) return limited();
    try {
      signal.throwIfAborted();
      const { snapshot, source } = await load(selectors.accountId, signal);
      signal.throwIfAborted();
      if (
        !source ||
        snapshot.accountId !== selectors.accountId ||
        snapshot.network !== network ||
        snapshot.lendingId !== deps.config.lendingId
      )
        throw new PositionReadError("untrusted_data");
      return Response.json(presentPosition(snapshot, source, now(), maxAge), {
        headers: { "cache-control": "no-store" },
      });
    } catch (error) {
      return positionError(
        signal.aborted
          ? "cancelled"
          : error instanceof PositionReadError
            ? error.code
            : "rpc_unavailable",
        network,
      );
    }
  };
  return async (request) => {
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, 15000);
    const disconnect = () => controller.abort();
    request.signal.addEventListener("abort", disconnect, { once: true });
    if (request.signal.aborted) disconnect();
    try {
      controller.signal.throwIfAborted();
      const response = await abortable(execute(request, controller.signal), controller.signal);
      controller.signal.throwIfAborted();
      return response;
    } catch {
      return positionError(
        timedOut ? "timeout" : controller.signal.aborted ? "cancelled" : "rpc_unavailable",
        deps.config?.network ?? null,
      );
    } finally {
      clearTimeout(timer);
      request.signal.removeEventListener("abort", disconnect);
    }
  };
}
