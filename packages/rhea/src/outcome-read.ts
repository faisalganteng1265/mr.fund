import { type CardReceipt, err, ok, type PositionSnapshot, type Result } from "@mrfund/shared";
import { parseRepayOutcome, validateRepayPlan } from "./outcome";
import type {
  ObservationReader,
  OutcomeError,
  OutcomeReader,
  RepayOutcome,
  RepayPlan,
} from "./outcome-types";

export interface ResolveOptions {
  before?: PositionSnapshot;
  observer?: ObservationReader;
  signal?: AbortSignal;
  timeoutMs?: number;
  maxDataAgeMs?: number;
  now?: () => number;
}
async function bounded<T>(work: () => Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) throw new Error("Read aborted");
  let abort = () => {};
  try {
    return await Promise.race([
      work(),
      new Promise<never>((_resolve, reject) => {
        abort = () => reject(new Error("Read aborted"));
        signal.addEventListener("abort", abort, { once: true });
        if (signal.aborted) abort();
      }),
    ]);
  } finally {
    signal.removeEventListener("abort", abort);
  }
}
function validClock(n: number) {
  return Number.isSafeInteger(n) && n >= 0;
}
function observe(
  before: PositionSnapshot,
  after: PositionSnapshot,
  plan: RepayPlan,
  result: RepayOutcome,
  now: number,
  maxAge: number,
  observer: ObservationReader,
): void {
  const heights = result.transactions.map((t) => t.finalBlockHeight ?? -1),
    initials = result.transactions.map((t) => t.transactionBlockHeight ?? -1);
  for (const s of [before, after]) {
    if (
      s.network !== plan.network ||
      s.accountId !== plan.accountId ||
      s.lendingId !== plan.lendingId
    )
      throw new Error("identity_mismatch");
    if (
      !validClock(s.readAtMs) ||
      s.readAtMs > now ||
      now - s.readAtMs > maxAge ||
      !validClock(s.blockHeight)
    )
      throw new Error("stale_or_invalid_snapshot");
  }
  if (
    before.blockHeight >= Math.min(...initials) ||
    after.blockHeight < Math.max(...heights) ||
    before.readAtMs > after.readAtMs
  )
    throw new Error("invalid_block_order");
  const b = before.assets[plan.tokenId]?.token,
    a = after.assets[plan.tokenId]?.token;
  if (
    !b ||
    !a ||
    b.id !== plan.tokenId ||
    a.id !== plan.tokenId ||
    b.decimals !== a.decimals ||
    b.extraDecimals !== a.extraDecimals ||
    ![a.decimals, a.extraDecimals].every((n) => Number.isInteger(n) && n >= 0 && n <= 38)
  )
    throw new Error("metadata_mismatch");
  const amount = (s: PositionSnapshot, kind: "borrowed" | "supplied") => {
    if (!Array.isArray(s[kind]) || s[kind].length > 512) throw new Error("invalid_balances");
    let sum = 0n;
    for (const balance of s[kind]) {
      if (
        typeof balance.internal !== "bigint" ||
        balance.internal < 0n ||
        balance.internal >= 1n << 128n
      )
        throw new Error("invalid_balance");
      if (balance.tokenId === plan.tokenId) sum += balance.internal;
    }
    if (sum >= 1n << 128n) throw new Error("invalid_balance");
    return sum;
  };
  const debtBeforeInternal = amount(before, "borrowed"),
    debtAfterInternal = amount(after, "borrowed");
  const observation = {
    beforeBlockHeight: before.blockHeight,
    afterBlockHeight: after.blockHeight,
    debtBeforeInternal,
    debtAfterInternal,
    debtDecreaseInternal: debtBeforeInternal - debtAfterInternal,
    suppliedChangeInternal: amount(after, "supplied") - amount(before, "supplied"),
  };
  result.observation = observation;
  result.observationReason = "observed_change_not_causal";
  if (observer.health) {
    try {
      const bh = observer.health(before, now),
        ah = observer.health(after, now);
      const validHealth = (v: number | "no_debt") =>
        v === "no_debt" || (Number.isSafeInteger(v) && v >= 0);
      if (bh.ok && ah.ok && validHealth(bh.value.value) && validHealth(ah.value.value))
        result.observation = {
          ...observation,
          healthBeforeBps: bh.value.value,
          healthAfterBps: ah.value.value,
        };
    } catch {
      /* A failed engine observation cannot erase verified balance observations. */
    }
  }
}

/** One bounded read pass. Never retries a transfer or discards an earlier applied transaction. */
export async function readRepayOutcome(
  plan: RepayPlan,
  reader: OutcomeReader,
  opts: ResolveOptions = {},
): Promise<Result<RepayOutcome, OutcomeError>> {
  const valid = validateRepayPlan(plan);
  if (!valid.ok) return valid;
  const timeout = opts.timeoutMs ?? 15_000,
    maxAge = opts.maxDataAgeMs ?? 120_000,
    now = opts.now ?? Date.now;
  let clock: number;
  try {
    clock = now();
  } catch {
    return err({ kind: "invalid_plan", detail: "Invalid read clock" });
  }
  if (
    !Number.isInteger(timeout) ||
    timeout < 1 ||
    timeout > 30_000 ||
    !Number.isInteger(maxAge) ||
    maxAge < 1 ||
    maxAge > 3_600_000 ||
    !validClock(clock)
  )
    return err({ kind: "invalid_plan", detail: "Invalid read limits or clock" });
  const signal = AbortSignal.any([
    AbortSignal.timeout(timeout),
    ...(opts.signal ? [opts.signal] : []),
  ]);
  const inputs: unknown[] = [],
    unavailable: number[] = [];
  for (const [i, expected] of plan.transactions.entries()) {
    try {
      const r = await bounded(() => reader.read(expected, signal), signal);
      if (!r.ok) {
        if (r.error.kind !== "rpc_unavailable") {
          const prior = parseRepayOutcome(inputs, plan);
          return err({
            ...r.error,
            observedTransactions: prior.ok
              ? prior.value.transactions.slice(0, inputs.length)
              : (prior.error.observedTransactions ?? []),
          });
        }
        inputs.push(null);
        unavailable.push(i);
      } else inputs.push(r.value);
    } catch {
      inputs.push(null);
      unavailable.push(i);
    }
  }
  const parsed = parseRepayOutcome(inputs, plan);
  if (!parsed.ok) return parsed;
  const result = parsed.value;
  for (const i of unavailable)
    result.transactions[i]?.pendingReasons.push("rpc_unavailable_or_cancelled");
  if (result.execution === "pending") {
    result.observationReason = "execution_unresolved";
    return ok(result);
  }
  const repayment = result.transactions.find((t) => t.role === "repay");
  const observer = opts.observer,
    before = opts.before;
  if (!repayment?.accepted || !before || !observer) {
    result.observationReason = "no_accepted_repay_or_baseline";
    return ok(result);
  }
  try {
    const r = await bounded(() => observer.readPosition(signal), signal);
    if (!r.ok) {
      result.observationReason = "post_read_unavailable";
      return ok(result);
    }
    const at = now();
    if (!validClock(at)) throw new Error("invalid_clock");
    observe(before, r.value, plan, result, at, maxAge, observer);
  } catch {
    result.observation = null;
    result.observationReason = "post_read_unavailable_or_invalid";
  }
  return ok(result);
}

/** Only observed debt reduction upgrades a successful transfer batch to a confirmed repayment. */
export function toCardReceipt(outcome: RepayOutcome, atMs: number): CardReceipt {
  if (!validClock(atMs)) throw new RangeError("Invalid receipt time");
  const o = outcome.observation;
  const status =
    outcome.execution === "pending"
      ? "submitted"
      : outcome.execution === "failed"
        ? "failed"
        : outcome.execution === "partial"
          ? "partial"
          : !o
            ? "submitted"
            : o.debtDecreaseInternal > 0n
              ? "confirmed"
              : "partial";
  const observed = o
    ? {
        debtBeforeInternal: o.debtBeforeInternal.toString(),
        debtAfterInternal: o.debtAfterInternal.toString(),
        debtDecreaseInternal: o.debtDecreaseInternal.toString(),
        suppliedChangeInternal: o.suppliedChangeInternal.toString(),
        ...(o.healthBeforeBps === undefined ? {} : { healthBeforeBps: String(o.healthBeforeBps) }),
        ...(o.healthAfterBps === undefined ? {} : { healthAfterBps: String(o.healthAfterBps) }),
      }
    : undefined;
  return {
    status,
    txHashes: outcome.transactions.map((t) => t.hash),
    atMs,
    ...(observed ? { observed } : {}),
  };
}
