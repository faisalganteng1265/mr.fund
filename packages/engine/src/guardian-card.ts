import {
  type CardDraft,
  decimalString,
  type EngineError,
  err,
  type GuardianPolicy,
  type GuardianState,
  ok,
  type Result,
  type TokenMeta,
  validatePolicy,
} from "@mrfund/shared";
import { MAX_DATA_AGE_MS } from "./health";

const u128 = (n: unknown): n is bigint => typeof n === "bigint" && n >= 0n && n < 1n << 128n;
export function guardianOwnerCard(
  state: GuardianState,
  policy: GuardianPolicy,
  request: {
    action: "guardian_deactivate" | "guardian_withdraw";
    amount: bigint;
    token: TokenMeta;
  },
  readAtMs: number,
  nowMs: number,
): Result<CardDraft, EngineError> {
  const bad = (reason: string): Result<never, EngineError> =>
    err({ kind: "invalid_input", reason });
  if (
    !Number.isSafeInteger(readAtMs) ||
    !Number.isSafeInteger(nowMs) ||
    readAtMs < 0 ||
    nowMs < readAtMs
  )
    return bad("Invalid Guardian read timestamp");
  const dataAgeMs = nowMs - readAtMs;
  if (dataAgeMs > MAX_DATA_AGE_MS)
    return err({ kind: "stale_snapshot", ageMs: dataAgeMs, limitMs: MAX_DATA_AGE_MS });
  if (
    !["created", "active", "paused", "deactivated"].includes(state.status) ||
    !validatePolicy(policy).ok ||
    !u128(state.reserve) ||
    !u128(state.spentTotal) ||
    state.spentTotal > policy.lifetimeCap ||
    request.token.id !== state.debtTokenId ||
    !Number.isInteger(request.token.decimals) ||
    request.token.decimals < 0 ||
    request.token.decimals > 38
  )
    return bad("Invalid Guardian state or token metadata");
  if (request.action !== "guardian_deactivate" && request.action !== "guardian_withdraw")
    return bad("Unsupported Guardian card action");
  const withdraw = request.action === "guardian_withdraw";
  if (
    withdraw &&
    (!u128(request.amount) ||
      request.amount === 0n ||
      request.amount > state.reserve ||
      state.inFlight !== null)
  )
    return bad("Withdrawal exceeds unlocked booked reserve");
  if (!withdraw && (!["active", "paused"].includes(state.status) || request.amount !== 0n))
    return bad("Guardian cannot be deactivated from this status");
  const amount = withdraw ? request.amount : 0n;
  const dec = (n: bigint) => decimalString(n, request.token.decimals);
  return ok({
    action: request.action,
    headline: withdraw
      ? `Withdraw ${dec(amount)} ${request.token.symbol} reserve`
      : "Deactivate Guardian",
    numbers: [
      {
        label: "Booked reserve",
        before: dec(state.reserve),
        after: dec(state.reserve - amount),
        unit: request.token.symbol,
      },
    ],
    assumptions: [
      "Existing Guardian only; no factory creation or activation is implied.",
      "No token action fee is charged for this owner control; the wallet call attaches one yoctoNEAR.",
      "Owner withdrawal can use the full unlocked reserve, including below the automation floor.",
    ],
    fees: [],
    risks: [
      "State may change before wallet execution.",
      "Deactivation stops automation and leaves the loan and debt in place.",
    ],
    dataAgeMs,
    maxDataAgeMs: MAX_DATA_AGE_MS,
    amount,
    tokenId: state.debtTokenId,
    cappedBy: null,
  });
}
