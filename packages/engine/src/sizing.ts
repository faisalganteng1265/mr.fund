import {
  type AccountId,
  type Atomic,
  type Bps,
  type Computed,
  type EngineError,
  err,
  ok,
  type PositionSnapshot,
  type Result,
} from "@mrfund/shared";
import { type HealthOptions, healthBps } from "./health";

/** Total internal debt of one token, summed over duplicate lines. */
function debtInternal(s: PositionSnapshot, tokenId: AccountId): bigint {
  return s.borrowed.reduce((sum, l) => (l.tokenId === tokenId ? sum + l.internal : sum), 0n);
}

/** Outstanding debt in token atomic units, rounded up so repaying it clears the debt. 0 if unknown. */
export function outstandingDebtAtomic(s: PositionSnapshot, tokenId: AccountId): Atomic {
  const asset = s.assets[tokenId];
  if (!asset) return 0n;
  const scale = 10n ** BigInt(asset.token.extraDecimals);
  return (debtInternal(s, tokenId) + scale - 1n) / scale;
}

/** The most that repaying this token can usefully send: the outstanding debt, rounded up. */
export function maxRepayUseful(
  s: PositionSnapshot,
  debtTokenId: AccountId,
  nowMs: number,
): Result<Computed<Atomic>, EngineError> {
  if (!s.assets[debtTokenId]) return err({ kind: "unsupported_asset", tokenId: debtTokenId });
  return ok({
    value: outstandingDebtAtomic(s, debtTokenId),
    inputs: { network: s.network, accountId: s.accountId, tokenId: debtTokenId },
    assumptions: ["Outstanding debt is rounded up so a repay of this amount clears it."],
    dataAgeMs: Math.max(0, nowMs - s.readAtMs),
  });
}

/**
 * A copy of the snapshot with `amount` (token atomic units) repaid on `tokenId`.
 * Clamps at zero debt. Throws for a token with no asset config or a negative amount (callers validate first).
 */
export function withRepay(
  s: PositionSnapshot,
  tokenId: AccountId,
  amount: Atomic,
): PositionSnapshot {
  const asset = s.assets[tokenId];
  if (!asset) throw new RangeError(`unknown asset ${tokenId}`);
  if (amount < 0n) throw new RangeError("repay amount must not be negative");
  const remaining = debtInternal(s, tokenId) - amount * 10n ** BigInt(asset.token.extraDecimals);
  const others = s.borrowed.filter((l) => l.tokenId !== tokenId);
  return {
    ...s,
    borrowed: remaining > 0n ? [...others, { tokenId, internal: remaining }] : others,
  };
}

/**
 * Smallest repay (token atomic units) after which health is at or above `targetBps`.
 * Health never falls when debt falls, so a binary search finds the exact minimum.
 */
export function repayToReachHealth(
  s: PositionSnapshot,
  debtTokenId: AccountId,
  targetBps: Bps,
  nowMs: number,
  opts: HealthOptions = {},
): Result<Computed<Atomic>, EngineError> {
  if (!Number.isInteger(targetBps) || targetBps <= 0) {
    return err({ kind: "invalid_amount", reason: "target must be a positive whole number of bps" });
  }
  if (!s.assets[debtTokenId]) return err({ kind: "unsupported_asset", tokenId: debtTokenId });

  const meets = (amount: Atomic): Result<boolean, EngineError> => {
    const h = healthBps(withRepay(s, debtTokenId, amount), nowMs, opts);
    if (!h.ok) return h;
    return ok(h.value.value === "no_debt" || h.value.value >= targetBps);
  };

  const current = healthBps(s, nowMs, opts);
  if (!current.ok) return current;
  const done = (value: Atomic): Result<Computed<Atomic>, EngineError> =>
    ok({
      value,
      inputs: { ...current.value.inputs, tokenId: debtTokenId, targetBps: String(targetBps) },
      assumptions: [
        ...current.value.assumptions,
        "Result is the smallest repay that reaches the target at current prices.",
      ],
      dataAgeMs: current.value.dataAgeMs,
    });

  const already = meets(0n);
  if (!already.ok) return already;
  if (already.value) return done(0n);

  let hi = outstandingDebtAtomic(s, debtTokenId);
  const full = meets(hi);
  if (!full.ok) return full;
  if (!full.value) {
    return err({ kind: "target_unreachable", tokenId: debtTokenId, targetBps });
  }
  let lo = 0n; // lo never meets the target, hi always does
  while (hi - lo > 1n) {
    const mid = (lo + hi) / 2n;
    const m = meets(mid);
    if (!m.ok) return m;
    if (m.value) hi = mid;
    else lo = mid;
  }
  return done(hi);
}
