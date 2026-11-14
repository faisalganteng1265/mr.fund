import { err, type GuardianState, isValidAccountId, ok, type Result } from "@mrfund/shared";
import {
  integer,
  nsToMs,
  parseConfig,
  parseHistory,
  parsePolicy,
  parseReserve,
  parseStatus,
} from "./parse";
import type {
  GuardianReadError,
  GuardianReadOptions,
  GuardianSnapshot,
  GuardianTarget,
  GuardianViewClient,
} from "./types";

class ReadFailure extends Error {
  constructor(readonly kind: GuardianReadError["kind"]) {
    super(kind);
  }
}
const bad = (): Result<never, GuardianReadError> =>
  err({ kind: "bad_response", detail: "Invalid Guardian view data or request" });
export async function readGuardian(
  client: GuardianViewClient,
  target: GuardianTarget,
  options: GuardianReadOptions = {},
): Promise<Result<GuardianSnapshot, GuardianReadError>> {
  try {
    if (!["testnet", "mainnet"].includes(target.network) || !isValidAccountId(target.guardianId))
      return bad();
    const readAtMs = integer((options.now ?? Date.now)(), Number.MAX_SAFE_INTEGER);
    const limit = integer(options.limit ?? 50, 50);
    if (limit === 0) return bad();
    const sinceMs = options.sinceMs === undefined ? undefined : integer(options.sinceMs, readAtMs);
    const call = async (method: string, args: unknown, blockId?: string) => {
      let r: Awaited<ReturnType<GuardianViewClient["view"]>>;
      try {
        r = await client.view(target.guardianId, method, args, blockId);
      } catch {
        throw new ReadFailure("rpc_unavailable");
      }
      if (!r.ok)
        throw new ReadFailure(
          ["not_found", "rpc_unavailable", "bad_response"].includes(r.error.kind)
            ? r.error.kind
            : "bad_response",
        );
      integer(r.value.blockHeight, Number.MAX_SAFE_INTEGER);
      if (
        typeof r.value.blockHash !== "string" ||
        !r.value.blockHash ||
        r.value.blockHash.length > 128
      )
        throw new Error("Invalid block");
      return r.value;
    };
    const anchor = await call("get_config", {});
    const config = parseConfig(anchor.data);
    const view = async (method: string, args: unknown = {}) => {
      const r = await call(method, args, anchor.blockHash);
      if (r.blockHash !== anchor.blockHash || r.blockHeight !== anchor.blockHeight)
        throw new Error("Mixed blocks");
      return r.data;
    };
    const [rawStatus, rawPolicy, rawReserve, rawHistory] = await Promise.all([
      view("get_status"),
      view("get_policy"),
      view("get_reserve"),
      view("get_history", { from: 0, limit: 50 }),
    ]);
    const status = parseStatus(rawStatus),
      policy = parsePolicy(rawPolicy),
      reserve = parseReserve(rawReserve),
      attempts = parseHistory(rawHistory);
    for (const key of [
      "ownerId",
      "watcherId",
      "lendingId",
      "oracleId",
      "debtTokenId",
      "feeRecipientId",
    ] as const)
      if (status[key] !== config[key]) throw new Error("Config mismatch");
    if (
      status.collateralTokenIds[0] !== config.collateralTokenIds[0] ||
      reserve.floor !== policy.reserveFloor ||
      reserve.lifetimeCap !== policy.lifetimeCap ||
      reserve.spentTotal > reserve.lifetimeCap ||
      reserve.lifetimeRemaining !== reserve.lifetimeCap - reserve.spentTotal ||
      reserve.spendable !== (reserve.reserve > reserve.floor ? reserve.reserve - reserve.floor : 0n)
    )
      throw new Error("Inconsistent reserve");
    const timestamps = [
      status.lastActionStartedNs,
      ...attempts.map((a) => a.atNs),
      ...(status.inFlight ? [status.inFlight.startedNs] : []),
    ];
    if (timestamps.some((t) => nsToMs(t) > readAtMs)) throw new Error("Future timestamp");
    const filtered = attempts
      .filter((a) => sinceMs === undefined || a.atNs >= BigInt(sinceMs) * 1_000_000n)
      .sort((a, b) =>
        a.atNs < b.atNs ? -1 : a.atNs > b.atNs ? 1 : a.opId < b.opId ? -1 : a.opId > b.opId ? 1 : 0,
      );
    return ok({
      ...target,
      blockHash: anchor.blockHash,
      blockHeight: anchor.blockHeight,
      readAtMs,
      config,
      status,
      policy,
      reserve,
      history: {
        attempts: filtered.slice(-limit),
        retainedCount: attempts.length,
        retention: "possibly_truncated",
        limited: filtered.length > limit,
        transactionLinks: "unavailable",
      },
      activationHistory: "unavailable",
    });
  } catch (e) {
    return e instanceof ReadFailure
      ? err({
          kind: e.kind,
          detail:
            e.kind === "not_found"
              ? "Guardian account not found"
              : e.kind === "rpc_unavailable"
                ? "Guardian RPC unavailable"
                : "Invalid Guardian view data",
        })
      : bad();
  }
}
export function toGuardianState(s: GuardianSnapshot): GuardianState {
  return {
    status: s.status.status,
    ownerId: s.status.ownerId,
    watcherId: s.status.watcherId,
    debtTokenId: s.status.debtTokenId,
    reserve: s.reserve.reserve,
    spentTotal: s.reserve.spentTotal,
    inFlight:
      s.status.inFlight === null
        ? null
        : {
            opId: s.status.inFlight.opId,
            amount: s.status.inFlight.amount,
            fee: s.status.inFlight.fee,
          },
    lastActionStartedNs: s.status.lastActionStartedNs,
  };
}
