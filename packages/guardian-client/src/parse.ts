import { type GuardianPolicy, isValidAccountId, validatePolicy } from "@mrfund/shared";
import {
  type GuardianAttempt,
  type GuardianConfigView,
  type GuardianReserveView,
  type GuardianStatusView,
  REJECT_REASONS,
  type RepayPhase,
} from "./types";

export function record(v: unknown): Record<string, unknown> {
  if (v === null || typeof v !== "object" || Array.isArray(v)) throw new Error("Object required");
  return v as Record<string, unknown>;
}
export function uint(v: unknown, bits = 128): bigint {
  if (typeof v !== "string" || v.length > 39 || !/^(0|[1-9]\d*)$/.test(v))
    throw new Error("Decimal string required");
  const n = BigInt(v);
  if (n >= 1n << BigInt(bits)) throw new Error("Integer bound");
  return n;
}
export function integer(v: unknown, max = 0xffffffff): number {
  if (typeof v !== "number" || !Number.isSafeInteger(v) || v < 0 || v > max)
    throw new Error("Integer required");
  return v;
}
export function account(v: unknown): string {
  if (typeof v !== "string" || !isValidAccountId(v)) throw new Error("Account required");
  return v;
}
function choice<T extends string>(v: unknown, allowed: readonly T[]): T {
  if (typeof v !== "string" || !allowed.includes(v as T)) throw new Error("Unknown enum");
  return v as T;
}
function collateral(v: unknown, debt: string): string[] {
  if (!Array.isArray(v) || v.length !== 1) throw new Error("One collateral required");
  const token = account(v[0]);
  if (token === debt) throw new Error("Distinct collateral required");
  return [token];
}
function identities(o: Record<string, unknown>) {
  const debtTokenId = account(o.debt_token_id);
  return {
    ownerId: account(o.owner_id),
    watcherId: account(o.watcher_id),
    lendingId: account(o.lending_id),
    oracleId: account(o.oracle_id),
    debtTokenId,
    collateralTokenIds: collateral(o.collateral_token_ids, debtTokenId),
    feeRecipientId: account(o.fee_recipient_id),
  };
}
export function parseConfig(v: unknown): GuardianConfigView {
  const o = record(v);
  const feed = (v: unknown) => {
    if (typeof v !== "string" || !/^[a-fA-F0-9]{64}$/.test(v)) throw new Error("Feed id required");
    return v;
  };
  const maxPriceAgeSec = integer(o.max_price_age_sec, 3600);
  if (!maxPriceAgeSec) throw new Error("Price age required");
  return {
    ...identities(o),
    activationFee: uint(o.activation_fee),
    lendingVersion: choice(o.lending_version, ["0.11.0", "0.16.2"]),
    debtExtraDecimals: integer(o.debt_extra_decimals, 38),
    collateralExtraDecimals: integer(o.collateral_extra_decimals, 38),
    collateralPriceId: feed(o.collateral_price_id),
    debtPriceId: feed(o.debt_price_id),
    maxPriceAgeSec,
  };
}
export function parseStatus(v: unknown): GuardianStatusView {
  const o = record(v);
  let inFlight: GuardianStatusView["inFlight"] = null;
  if (o.in_flight !== null) {
    const p = record(o.in_flight);
    let repayPhase: RepayPhase;
    if (p.repay_phase === null) repayPhase = null;
    else if (typeof p.repay_phase === "string")
      repayPhase = choice(p.repay_phase, ["reading", "repaying", "unresolved"] as const);
    else {
      const phase = record(p.repay_phase);
      if (Object.keys(phase).length !== 1 || !Object.hasOwn(phase, "fee"))
        throw new Error("Invalid phase");
      repayPhase = { fee: { used: uint(record(phase.fee).used) } };
    }
    inFlight = {
      opId: uint(p.op_id, 64),
      amount: uint(p.amount),
      fee: uint(p.fee),
      startedNs: uint(p.started_ns, 64),
      repayPhase,
    };
    // Position locks (owner_register, owner_sweep) carry amount 0 and no repay phase; only
    // repayment and reserve operations must lock a positive amount.
    if (
      (inFlight.amount === 0n && repayPhase !== null) ||
      (typeof repayPhase === "object" &&
        repayPhase !== null &&
        repayPhase.fee.used > inFlight.amount)
    )
      throw new Error("Invalid pending amount");
  }
  return {
    ...identities(o),
    status: choice(o.status, ["created", "active", "paused", "deactivated"]),
    lastActionStartedNs: uint(o.last_action_started_ns, 64),
    inFlight,
  };
}
export function parsePolicy(v: unknown): GuardianPolicy {
  const o = record(v);
  const p = {
    maxPerAction: uint(o.max_per_action),
    lifetimeCap: uint(o.lifetime_cap),
    reserveFloor: uint(o.reserve_floor),
    triggerHfBps: integer(o.trigger_hf_bps),
    targetHfBps: o.target_hf_bps === null ? null : integer(o.target_hf_bps),
    cooldownSec: integer(o.cooldown_sec),
    actionFee: uint(o.action_fee),
  };
  if (!validatePolicy(p).ok) throw new Error("Invalid policy");
  return p;
}
export function parseReserve(v: unknown): GuardianReserveView {
  const o = record(v);
  return {
    reserve: uint(o.reserve),
    floor: uint(o.floor),
    spendable: uint(o.spendable),
    lifetimeCap: uint(o.lifetime_cap),
    spentTotal: uint(o.spent_total),
    lifetimeRemaining: uint(o.lifetime_remaining),
  };
}
export function parseHistory(v: unknown): GuardianAttempt[] {
  if (!Array.isArray(v) || v.length > 50) throw new Error("Invalid ring");
  const ids = new Set<bigint>();
  return v.map((raw) => {
    const o = record(raw);
    const a: GuardianAttempt = {
      opId: uint(o.op_id, 64),
      atNs: uint(o.at_ns, 64),
      requested: uint(o.requested),
      used: uint(o.used),
      fee: uint(o.fee),
      outcome: choice(o.outcome, ["rejected", "started", "settled", "failed", "unresolved"]),
      reason: o.reason === null ? null : choice(o.reason, REJECT_REASONS),
    };
    if (
      ids.has(a.opId) ||
      a.used > a.requested ||
      (a.outcome === "rejected") !== (a.reason !== null) ||
      (a.outcome === "settled" && a.used === 0n) ||
      (["rejected", "started", "failed"].includes(a.outcome) && (a.used !== 0n || a.fee !== 0n))
    )
      throw new Error("Invalid attempt");
    ids.add(a.opId);
    return a;
  });
}
/** Exact ns are retained; conversion is explicitly checked before making an engine/UI timestamp. */
export function nsToMs(ns: bigint): number {
  if (ns < 0n || ns >= 1n << 64n) throw new Error("Invalid ns");
  const ms = ns / 1_000_000n;
  if (ms > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("Unsafe timestamp");
  return Number(ms);
}
