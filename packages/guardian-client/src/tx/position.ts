/**
 * Guardian-held loan payloads (P0 decision 2026-11-11, `add-guardian-live-activation-ui` 5.5)
 * against the P2.4 ABI in SMART-CONTRACT "Guardian owner position methods". Unsigned only: the
 * owner's wallet signs each one.
 *
 * - Collateral deposit: the collateral token's `ft_transfer_call(receiver_id: <guardian>,
 *   amount, msg: {"collateral":{}})`, 1 yocto. The Guardian refunds the whole amount unless the
 *   sender is the owner, the token is the configured collateral token, nothing is in flight and
 *   at least 140 Tgas reaches it.
 * - `owner_borrow({amount})`, 1 yocto, at least 260 Tgas; the borrowed tokens arrive at the
 *   Guardian, outside reserve accounting.
 * - `owner_sweep({token_id})`, 1 yocto; for the debt token only the balance above the reserve and
 *   any in-flight amount moves (the contract computes it from its own balance read).
 *
 * Permission boundary: every Guardian method needs the stored owner and exactly 1 yocto, so the
 * watcher's function-call key cannot reach them (I5, I9); every target is fixed to the configured
 * lending contract and tokens.
 * Does not guarantee: that Rhea accepts a borrow (it refuses one that leaves the position
 * unhealthy or lacks fresh prices) or that a step succeeds; each outcome is observed by reading
 * the chain again.
 */
import {
  type EngineError,
  err,
  ftTransferCall,
  isValidAccountId,
  type NearTransaction,
  ok,
  type Result,
} from "@mrfund/shared";
import type { GuardianSnapshot } from "../types";

const TGAS = 1_000_000_000_000n;
const U128_MAX = (1n << 128n) - 1n;
const SNAPSHOT_LIMIT_MS = 120_000;
/**
 * [V, sandbox 2026-11-07] The sandbox flow attaches the 300 Tgas maximum to the collateral
 * transfer, `owner_borrow` and `owner_sweep`; unused gas is refunded. The contract floors are
 * 140 Tgas reaching `ft_on_transfer` and 260 Tgas for `owner_borrow`.
 */
export const POSITION_GAS = 300n * TGAS;
export const COLLATERAL_MSG = JSON.stringify({ collateral: {} });

export type SweepToken = "debt_token" | "collateral_token";
export type PositionAction =
  | { kind: "collateral"; amount: bigint }
  | { kind: "borrow"; amount: bigint }
  | { kind: "sweep"; token: SweepToken };

export function sweepTokenId(snapshot: GuardianSnapshot, token: SweepToken): string | undefined {
  return token === "debt_token"
    ? snapshot.config.debtTokenId
    : snapshot.config.collateralTokenIds[0];
}

const bad = (reason: string): Result<never, EngineError> => err({ kind: "invalid_input", reason });

export function guardianPositionPayload(
  snapshot: GuardianSnapshot,
  action: PositionAction,
  context: { ownerId: string; nowMs: number },
): Result<NearTransaction[], EngineError> {
  if (
    !isValidAccountId(snapshot.guardianId) ||
    context.ownerId !== snapshot.config.ownerId ||
    snapshot.status.ownerId !== context.ownerId
  )
    return bad("Only the configured owner may build position operations");
  if (
    !Number.isSafeInteger(context.nowMs) ||
    !Number.isSafeInteger(snapshot.readAtMs) ||
    snapshot.readAtMs < 0 ||
    context.nowMs < snapshot.readAtMs
  )
    return bad("Invalid position draft timestamp");
  const age = context.nowMs - snapshot.readAtMs;
  if (age > SNAPSHOT_LIMIT_MS)
    return err({ kind: "stale_snapshot", ageMs: age, limitMs: SNAPSHOT_LIMIT_MS });
  if (snapshot.status.status === "created") return bad("Activate the Guardian first");
  if (snapshot.status.inFlight !== null) return bad("Operation in flight");
  if (action === null || typeof action !== "object" || Array.isArray(action))
    return bad("Invalid position action");
  const keys = action.kind === "sweep" ? ["kind", "token"] : ["kind", "amount"];
  if (Object.keys(action).some((k) => !keys.includes(k)))
    return bad("Unexpected position action field");

  switch (action.kind) {
    case "collateral": {
      const tokenId = snapshot.config.collateralTokenIds[0];
      if (!tokenId || snapshot.config.collateralTokenIds.length !== 1)
        return bad("Exactly one collateral token is configured in P0");
      if (typeof action.amount !== "bigint" || action.amount <= 0n || action.amount > U128_MAX)
        return bad("Collateral amount must be positive");
      const transfer = ftTransferCall(tokenId, snapshot.guardianId, action.amount, COLLATERAL_MSG);
      if (!transfer.ok) return transfer;
      const [first] = transfer.value.actions;
      if (!first) return bad("Invalid collateral transfer");
      return ok([{ ...transfer.value, actions: [{ ...first, gas: POSITION_GAS }] }]);
    }
    case "borrow":
      if (typeof action.amount !== "bigint" || action.amount <= 0n || action.amount > U128_MAX)
        return bad("Borrow amount must be positive");
      return ok([call(snapshot, "owner_borrow", { amount: action.amount.toString() })]);
    case "sweep": {
      const tokenId =
        action.token === "debt_token" || action.token === "collateral_token"
          ? sweepTokenId(snapshot, action.token)
          : undefined;
      if (!tokenId || !isValidAccountId(tokenId)) return bad("Unsupported sweep token");
      return ok([call(snapshot, "owner_sweep", { token_id: tokenId })]);
    }
    default:
      return bad("Unsupported position action");
  }
}

function call(
  snapshot: GuardianSnapshot,
  methodName: string,
  args: Record<string, unknown>,
): NearTransaction {
  return {
    receiverId: snapshot.guardianId,
    actions: [{ methodName, args, gas: POSITION_GAS, deposit: 1n }],
  };
}
