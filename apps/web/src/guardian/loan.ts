/**
 * Guardian-held loan (task 5.5, P0 decision 2026-11-11): collateral deposit, `owner_borrow` and
 * `owner_sweep`. Holdings come only from final-block views (the Guardian's Rhea account and its
 * token balances), and every step's outcome is the next read compared with the one before it,
 * never the wallet's answer (G-UI-3, G-UI-4).
 *
 * Rounding is conservative: collateral rounds down and debt rounds up from Rhea internal units
 * (`atomic × 10^extra_decimals`), which stay a separate type until this conversion.
 * Does not guarantee: that Rhea accepts a borrow (it refuses one that leaves the position
 * unhealthy or lacks fresh prices); no health factor is computed here.
 */
import {
  type GuardianSnapshot,
  type GuardianViewClient,
  guardianPositionPayload,
  type SweepToken,
} from "@mrfund/guardian-client";
import type { Built } from "./flow";
import { parseTokenFacts, type TokenFacts } from "./live";
import type { GuardianIntent } from "./verify";

export interface GuardianHoldings {
  collateralToken: TokenFacts;
  /** Collateral the Guardian holds in Rhea, token atomic units rounded down. */
  collateralAtomic: bigint;
  /** Debt the Guardian owes Rhea, token atomic units rounded up. */
  debtAtomic: bigint;
  /** Debt-token balance of the Guardian account (reserve included). */
  heldDebt: bigint;
  /** Collateral-token balance of the Guardian account (not in Rhea). */
  heldCollateral: bigint;
  /** Collateral tokens in the owner's wallet, the most a deposit can send. */
  ownerCollateral: bigint;
  readAtMs: number;
}

export type LoanKind = "collateral" | "borrow" | "sweep_debt" | "sweep_collateral";
export interface LoanState {
  available: boolean;
  reason: string | null;
}

const U128_TEXT = /^(0|[1-9]\d{0,38})$/;
const U128_MAX = (1n << 128n) - 1n;
const record = (v: unknown): Record<string, unknown> | null =>
  v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

/** A NEP-141 `ft_balance_of` reply: a u128 decimal string. */
export function parseBalance(data: unknown): bigint | null {
  return typeof data === "string" && U128_TEXT.test(data) && BigInt(data) <= U128_MAX
    ? BigInt(data)
    : null;
}

/**
 * Rhea `get_account` → the Guardian's balance of one token in one list, in internal units.
 * A missing account or token is zero; a duplicate or malformed entry refuses the whole read.
 */
export function rheaBalance(
  data: unknown,
  list: "collateral" | "borrowed",
  tokenId: string,
): bigint | null {
  if (data === null) return 0n;
  const account = record(data);
  const entries = account?.[list];
  if (!Array.isArray(entries)) return null;
  let found: bigint | null = null;
  for (const entry of entries) {
    const e = record(entry);
    if (!e || typeof e.token_id !== "string") return null;
    if (e.token_id !== tokenId) continue;
    const balance = parseBalance(e.balance);
    if (balance === null || found !== null) return null;
    found = balance;
  }
  return found ?? 0n;
}

const pow10 = (n: number) => 10n ** BigInt(n);
export const internalToAtomicDown = (internal: bigint, extra: number) => internal / pow10(extra);
export const internalToAtomicUp = (internal: bigint, extra: number) => {
  const unit = pow10(extra);
  return (internal + unit - 1n) / unit;
};

/** Every holding the loan steps need, from final-block views. Null when any read fails. */
export async function readHoldings(
  client: GuardianViewClient,
  g: GuardianSnapshot,
  now: () => number,
): Promise<GuardianHoldings | null> {
  const collateralId = g.config.collateralTokenIds[0];
  if (!collateralId || g.config.collateralTokenIds.length !== 1) return null;
  const debtId = g.config.debtTokenId;
  const [meta, account, heldDebt, heldCollateral, ownerCollateral] = await Promise.all([
    client.view(collateralId, "ft_metadata", {}),
    client.view(g.config.lendingId, "get_account", { account_id: g.guardianId }),
    client.view(debtId, "ft_balance_of", { account_id: g.guardianId }),
    client.view(collateralId, "ft_balance_of", { account_id: g.guardianId }),
    client.view(collateralId, "ft_balance_of", { account_id: g.config.ownerId }),
  ]);
  if (!meta.ok || !account.ok || !heldDebt.ok || !heldCollateral.ok || !ownerCollateral.ok)
    return null;
  const collateralToken = parseTokenFacts(meta.value.data);
  const collateralInternal = rheaBalance(account.value.data, "collateral", collateralId);
  const debtInternal = rheaBalance(account.value.data, "borrowed", debtId);
  const balances = [heldDebt, heldCollateral, ownerCollateral].map((r) =>
    parseBalance(r.value.data),
  );
  const [hd, hc, oc] = balances;
  if (
    !collateralToken ||
    collateralInternal === null ||
    debtInternal === null ||
    hd == null ||
    hc == null ||
    oc == null
  )
    return null;
  return {
    collateralToken,
    collateralAtomic: internalToAtomicDown(collateralInternal, g.config.collateralExtraDecimals),
    debtAtomic: internalToAtomicUp(debtInternal, g.config.debtExtraDecimals),
    heldDebt: hd,
    heldCollateral: hc,
    ownerCollateral: oc,
    readAtMs: now(),
  };
}

/** Debt tokens `owner_sweep` would move: everything above the reserve and any in-flight amount. */
export function sweepableDebt(g: GuardianSnapshot, h: GuardianHoldings): bigint {
  const committed = g.reserve.reserve + (g.status.inFlight?.amount ?? 0n);
  return h.heldDebt > committed ? h.heldDebt - committed : 0n;
}

const SNAPSHOT_LIMIT_MS = 120_000;

/** Which loan steps apply now; mirrors the contract and adds no permission of its own. */
export function loanAvailability(
  g: GuardianSnapshot,
  h: GuardianHoldings,
  nowMs: number,
): Record<LoanKind, LoanState> {
  const shared =
    nowMs - Math.min(g.readAtMs, h.readAtMs) > SNAPSHOT_LIMIT_MS
      ? "Refresh the Guardian first."
      : g.status.status === "created"
        ? "Activate the Guardian first."
        : g.status.inFlight
          ? "An operation is in flight. Loan steps wait until the contract settles it."
          : null;
  const state = (reason: string | null): LoanState => ({ available: reason === null, reason });
  return {
    collateral: state(
      shared ??
        (h.ownerCollateral > 0n
          ? null
          : `Your wallet holds no ${h.collateralToken.symbol} to deposit.`),
    ),
    borrow: state(shared ?? (h.collateralAtomic > 0n ? null : "Deposit collateral first.")),
    sweep_debt: state(shared ?? (sweepableDebt(g, h) > 0n ? null : "Nothing above the reserve.")),
    sweep_collateral: state(shared ?? (h.heldCollateral > 0n ? null : "Nothing to sweep.")),
  };
}

export type LoanRequest =
  | { kind: "collateral" | "borrow"; amount: bigint }
  | { kind: "sweep"; token: SweepToken };

/** Unsigned payload and intent for one loan step; the verifier checks it again. */
export function buildLoanStep(
  g: GuardianSnapshot,
  h: GuardianHoldings,
  request: LoanRequest,
  input: { ownerId: string; nowMs: number },
): Built {
  if (request.kind === "collateral" && request.amount > h.ownerCollateral)
    return {
      ok: false,
      reason: `That is more ${h.collateralToken.symbol} than your wallet holds.`,
    };
  const r = guardianPositionPayload(g, request, input);
  if (!r.ok)
    return {
      ok: false,
      reason:
        r.error.kind === "stale_snapshot"
          ? "Refresh the Guardian first."
          : (("reason" in r.error ? r.error.reason : undefined) ?? r.error.kind),
    };
  const intent: GuardianIntent =
    request.kind === "sweep"
      ? { kind: "sweep", token: request.token }
      : request.kind === "collateral"
        ? { kind: "collateral", amount: request.amount }
        : { kind: "borrow", amount: request.amount };
  return { ok: true, intent, payload: r.value };
}

export type LoanIntent = "collateral" | "borrow" | "sweep";

/** What the last loan step changed, from two chain reads; null `after` means it was not read. */
export interface LoanOutcome {
  intent: LoanIntent;
  before: GuardianHoldings;
  after: GuardianHoldings | null;
  hashes: string[];
  walletError: boolean;
}

/** Whether the values the step targets moved between the two reads. */
export function loanChanged(o: LoanOutcome): boolean | null {
  const { before: b, after: a } = o;
  if (!a) return null;
  switch (o.intent) {
    case "collateral":
      return a.collateralAtomic !== b.collateralAtomic;
    case "borrow":
      return a.debtAtomic !== b.debtAtomic;
    case "sweep":
      return a.heldDebt !== b.heldDebt || a.heldCollateral !== b.heldCollateral;
  }
}
