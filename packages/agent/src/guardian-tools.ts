import { assembleCard, guardianOwnerCard } from "@mrfund/engine";
import {
  type GuardianTarget,
  type GuardianViewClient,
  guardianOwnerPayload,
  nsToMs,
  readGuardian,
  toGuardianState,
} from "@mrfund/guardian-client";
import { fromAtomic } from "./numbers";
import type { Fact, ToolContext, ToolResult } from "./tools";

export interface GuardianToolContext {
  client: GuardianViewClient;
  target: GuardianTarget;
  /** Optional server-supplied observer. Correlation/timestamps are validated; raw errors are never exposed. */
  heartbeat?: () => Promise<unknown>;
}

/** Existing-instance owner cards; activation/factory creation remain unavailable. */
export async function proposeGuardianControl(
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const tool = "propose_card";
  if (!ctx.proposal)
    return fail(tool, "not_available", "No wallet is connected, so a card cannot be prepared.");
  if (args.action !== "guardian_deactivate" && args.action !== "guardian_withdraw")
    return fail(tool, "invalid_arguments", "Unsupported Guardian card action.");
  const dependency = ctx.guardian;
  if (!dependency)
    return fail(tool, "not_available", "No existing Guardian read context is configured.");
  if (dependency.target.network !== ctx.snapshot.network)
    return fail(tool, "invalid_input", "Guardian network does not match trusted context.");
  const r = await readGuardian(dependency.client, dependency.target, { now: () => ctx.nowMs });
  if (!r.ok) return fail(tool, r.error.kind, "Guardian state could not be read and validated.");
  const s = r.value;
  if (s.config.ownerId !== ctx.snapshot.accountId || s.config.lendingId !== ctx.snapshot.lendingId)
    return fail(
      tool,
      "invalid_input",
      "Guardian owner or lending target does not match trusted context.",
    );
  const token = ctx.snapshot.assets[s.config.debtTokenId]?.token;
  if (
    !token ||
    token.id !== s.config.debtTokenId ||
    token.extraDecimals !== s.config.debtExtraDecimals
  )
    return fail(
      tool,
      "unsupported_asset",
      "Guardian token metadata is unavailable or inconsistent.",
    );
  if (
    args.token !== undefined &&
    (typeof args.token !== "string" ||
      (args.token !== token.id && args.token.toLowerCase() !== token.symbol.toLowerCase()))
  )
    return fail(
      tool,
      "invalid_arguments",
      "Token does not match the configured Guardian debt token.",
    );
  let amount = 0n;
  if (args.action === "guardian_deactivate") {
    if (args.amount !== undefined)
      return fail(tool, "invalid_arguments", "Deactivation has no amount.");
  } else if (args.amount === undefined) amount = s.reserve.reserve;
  else {
    const input =
      typeof args.amount === "number" && Number.isFinite(args.amount)
        ? String(args.amount)
        : args.amount;
    if (
      typeof input !== "string" ||
      input.length > 100 ||
      !/^\d+(\.\d+)?$/.test(input) ||
      !Number.isInteger(token.decimals) ||
      token.decimals < 0 ||
      token.decimals > 38
    )
      return fail(tool, "invalid_arguments", "Invalid withdrawal amount.");
    const [whole = "", fraction = ""] = input.split(".");
    if (fraction.length > token.decimals)
      return fail(tool, "invalid_arguments", "Too many token decimal places.");
    amount = BigInt(whole + fraction.padEnd(token.decimals, "0"));
  }
  const draft = guardianOwnerCard(
    toGuardianState(s),
    s.policy,
    { action: args.action, amount, token },
    s.readAtMs,
    ctx.nowMs,
  );
  if (!draft.ok)
    return fail(
      tool,
      draft.error.kind,
      "Guardian control draft failed state or amount validation.",
    );
  const payload = guardianOwnerPayload(
    s,
    args.action === "guardian_deactivate"
      ? { kind: "deactivate" }
      : { kind: "withdraw_reserve", amount: draft.value.amount },
    { ownerId: ctx.snapshot.accountId, nowMs: ctx.nowMs },
  );
  if (!payload.ok)
    return fail(tool, payload.error.kind, "Guardian owner payload failed validation.");
  const card = assembleCard(draft.value, {
    id: ctx.newId?.() ?? crypto.randomUUID(),
    reason: "",
    payload: payload.value,
  });
  const facts: Fact[] = [];
  for (const n of card.numbers) {
    if (n.before !== undefined)
      facts.push({ label: `${n.label} before`, value: n.before, unit: n.unit });
    if (n.after !== undefined)
      facts.push({ label: `${n.label} after`, value: n.after, unit: n.unit });
  }
  if (args.action === "guardian_withdraw")
    facts.push({
      label: "reserve withdrawal",
      ...fromAtomic(draft.value.amount, token.decimals, token.symbol),
    });
  return {
    ok: true,
    tool,
    facts,
    notes: [
      ...card.assumptions,
      "Nothing is signed or sent. The wallet must review and approve this owner call.",
    ],
    text: { card: "draft", risks: card.risks.join(" ") },
    dataAgeMs: card.dataAgeMs,
    scenario: false,
    card,
  };
}
function fail(tool: string, code: string, message: string): ToolResult {
  return { ok: false, tool, refusal: { code, message } };
}
const integer = (v: unknown, max = Number.MAX_SAFE_INTEGER): v is number =>
  typeof v === "number" && Number.isSafeInteger(v) && v >= 0 && v <= max;

export async function guardianTool(
  raw: unknown,
  ctx: ToolContext,
  history: boolean,
): Promise<ToolResult> {
  const tool = history ? "guardian_history" : "guardian_status";
  if (raw !== null && raw !== undefined && (typeof raw !== "object" || Array.isArray(raw)))
    return fail(tool, "invalid_arguments", "Arguments must be an object.");
  const args = (raw ?? {}) as Record<string, unknown>;
  if (
    Object.keys(args).some((k) => !(history ? ["sinceMs", "limit"] : []).includes(k)) ||
    (args.sinceMs !== undefined && !integer(args.sinceMs, ctx.nowMs)) ||
    (args.limit !== undefined && (!integer(args.limit, 50) || args.limit === 0))
  )
    return fail(tool, "invalid_arguments", "Unsupported Guardian arguments or history bounds.");
  const dependency = ctx.guardian;
  if (!dependency) return fail(tool, "not_available", "No Guardian read context is configured.");
  if (dependency.target.network !== ctx.snapshot.network)
    return fail(
      tool,
      "invalid_input",
      "Guardian network does not match the trusted account context.",
    );
  const result = await readGuardian(dependency.client, dependency.target, {
    now: () => ctx.nowMs,
    ...(args.sinceMs === undefined ? {} : { sinceMs: args.sinceMs as number }),
    ...(args.limit === undefined ? {} : { limit: args.limit as number }),
  });
  if (!result.ok)
    return fail(
      tool,
      result.error.kind,
      result.error.kind === "not_found"
        ? "Guardian account was not found."
        : "Guardian state could not be read and validated.",
    );
  const s = result.value;
  if (s.config.ownerId !== ctx.snapshot.accountId || s.config.lendingId !== ctx.snapshot.lendingId)
    return fail(
      tool,
      "invalid_input",
      "Guardian ownership or lending target does not match trusted context.",
    );
  const asset = ctx.snapshot.assets[s.config.debtTokenId];
  if (
    !asset ||
    asset.token.id !== s.config.debtTokenId ||
    asset.token.extraDecimals !== s.config.debtExtraDecimals ||
    !integer(asset.token.decimals, 38)
  )
    return fail(
      tool,
      "unsupported_asset",
      "Guardian debt token metadata is unavailable or inconsistent.",
    );
  const facts: Fact[] = [];
  const amount = (label: string, value: bigint) =>
    facts.push({ label, ...fromAtomic(value, asset.token.decimals, asset.token.symbol) });
  const number = (label: string, value: number | bigint, unit: string | null) =>
    facts.push({ label, value: String(value), unit });
  const notes = [
    "History is a bounded retained ring and may be truncated; an empty filtered result does not establish no past activity.",
    "Used means accepted token spend, including any supplied surplus, rather than observed debt decrease.",
    "Transaction links, activation date and historical activation fees are unavailable because no verified event/transaction source is connected.",
  ];
  const text: Record<string, string> = {
    status: s.status.status,
    network: s.network,
    guardianId: s.guardianId,
    blockHash: s.blockHash,
    transactionLinks: "unavailable",
    activationDate: "unavailable",
    activationFeePaid: "unavailable",
    heartbeat: "unavailable",
    historyRetention: s.history.retention,
    historyLimited: String(s.history.limited),
    spending: s.status.inFlight ? "locked" : "not_locked",
    repayPhase: s.status.inFlight
      ? typeof s.status.inFlight.repayPhase === "string"
        ? s.status.inFlight.repayPhase
        : s.status.inFlight.repayPhase === null
          ? "reserve_operation"
          : "fee"
      : "none",
  };
  number("read block height", s.blockHeight, null);
  number("read timestamp", s.readAtMs, "unix_ms");
  if (history) {
    number("returned attempts", s.history.attempts.length, null);
    number("retained attempts", s.history.retainedCount, null);
    for (const a of s.history.attempts) {
      const prefix = `attempt ${a.opId}`;
      number(`${prefix} operation id`, a.opId, null);
      number(`${prefix} timestamp`, nsToMs(a.atNs), "unix_ms");
      amount(`${prefix} requested`, a.requested);
      const pending = a.outcome === "started" || a.outcome === "unresolved";
      if (!pending || a.used > 0n) amount(`${prefix} accepted spend`, a.used);
      else text[`${prefix} accepted spend evidence`] = "unavailable";
      if (!pending) amount(`${prefix} confirmed action fee`, a.fee);
      else text[`${prefix} action fee evidence`] = "unavailable";
      text[prefix] = a.outcome;
      text[`${prefix} reason`] = a.reason ?? "unavailable";
    }
    amount(
      "confirmed action fees in returned terminal attempts",
      s.history.attempts
        .filter((a) => a.outcome !== "started" && a.outcome !== "unresolved")
        .reduce((total, a) => total + a.fee, 0n),
    );
    text.feeTotalCoverage = s.history.attempts.some(
      (a) => a.outcome === "started" || a.outcome === "unresolved",
    )
      ? "partial_unknown_pending_or_unresolved"
      : "returned_terminal_attempts_only";
    notes.push(
      "Pending/unresolved placeholder zeros are not proof of zero token consumption or zero fees; unknown amounts are omitted from numeric facts.",
    );
  } else {
    amount("booked reserve", s.reserve.reserve);
    amount("reserve floor", s.reserve.floor);
    amount("reserve above floor", s.reserve.spendable);
    amount("max per action", s.policy.maxPerAction);
    amount("lifetime cap", s.policy.lifetimeCap);
    amount("booked cumulative accepted spend and action fees", s.reserve.spentTotal);
    amount("lifetime remaining", s.reserve.lifetimeRemaining);
    amount("configured action fee", s.policy.actionFee);
    amount("configured activation fee", s.config.activationFee);
    facts.push({ label: "trigger health", ...fromAtomic(BigInt(s.policy.triggerHfBps), 2, "%") });
    number("cooldown", s.policy.cooldownSec, "s");
    if (s.status.lastActionStartedNs !== 0n)
      number("last action started", nsToMs(s.status.lastActionStartedNs), "unix_ms");
    notes.push(
      "Configured activation fee is a current setting, not evidence that activation paid it. Reserve above floor is not an execution allowance while spending is locked.",
    );
  }
  if (dependency.heartbeat) {
    try {
      const raw = await dependency.heartbeat();
      if (raw !== null && typeof raw === "object" && !Array.isArray(raw)) {
        const h = raw as Record<string, unknown>;
        if (
          h.network === s.network &&
          h.guardianId === s.guardianId &&
          h.watcherId === s.config.watcherId &&
          integer(h.lastSeenMs, ctx.nowMs) &&
          integer(h.observedAtMs, ctx.nowMs) &&
          h.lastSeenMs <= h.observedAtMs
        ) {
          text.heartbeat =
            ctx.nowMs - h.lastSeenMs > 90_000 ? "stale_observation" : "recent_observation";
          number("watcher last seen", h.lastSeenMs, "unix_ms");
          number("heartbeat observed at", h.observedAtMs, "unix_ms");
          number("watcher observation age", ctx.nowMs - h.lastSeenMs, "ms");
        }
      }
    } catch {
      /* Absent evidence remains unavailable; never serialize dependency exceptions. */
    }
  }
  notes.push(
    "Heartbeat is an optional timestamped observation, not proof of current uptime or why a past action did not happen.",
  );
  return { ok: true, tool, facts, notes, text, dataAgeMs: ctx.nowMs - s.readAtMs, scenario: false };
}
