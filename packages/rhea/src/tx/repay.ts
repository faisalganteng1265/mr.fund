/**
 * Wallet-loan repay payload (BUILD-PLAN P4.2, P4.1; ARCHITECTURE Flow 2).
 *
 * The user's own debt token goes to the lending contract with the verified version's message: Rhea repays only the
 * sender's own debt (OPEN-DECISIONS D18). The token and amount come from the engine's validated
 * `CardDraft`, never from model text. Permission boundary: the user's wallet signs; the 1 yocto
 * deposit forces a full-access key. Invariant: only `draft.amount` of `draft.tokenId` leaves the
 * wallet toward `lendingId`, plus at most the one disclosed fee.
 *
 * Does not guarantee: that Rhea accepts the repay or that all accepted tokens reduce debt.
 * Excess may become supplied balance; observe receipts and post-state rather than assume a refund.
 */
import {
  type CardDraft,
  type EngineError,
  err,
  type FeeTransferParams,
  feeTransfers,
  ftTransferCall,
  type NearTransaction,
  ok,
  type Result,
} from "@mrfund/shared";

/** The JSON string `"OnlyRepay"` carried inside the NEP-141 `msg` string. */
export const ONLY_REPAY_MSG = JSON.stringify("OnlyRepay");

export interface RepayPayloadParams extends FeeTransferParams {
  /** The Rhea lending contract that receives the repay. */
  lendingId: string;
  /** Observed get_version result; never inferred from the network or model text. */
  lendingVersion: string;
  /** Validated token config, required for the legacy action's internal units. */
  extraDecimals: number;
}

/** Repay first, then (optionally) register the fee recipient and pay the fee. */
export function repayPayload(
  draft: CardDraft,
  p: RepayPayloadParams,
): Result<NearTransaction[], EngineError> {
  if (draft.action !== "repay") {
    return err({ kind: "invalid_input", reason: "this builder only creates repay payloads" });
  }
  if (!Number.isInteger(p.extraDecimals) || p.extraDecimals < 0 || p.extraDecimals > 38)
    return err({ kind: "invalid_input", reason: "invalid Rhea extra decimals" });
  let msg: string;
  if (p.lendingVersion === "0.16.2") msg = ONLY_REPAY_MSG;
  else if (p.lendingVersion === "0.11.0") {
    const internal = draft.amount * 10n ** BigInt(p.extraDecimals);
    if (internal > 2n ** 128n - 1n)
      return err({ kind: "invalid_amount", reason: "Rhea internal amount exceeds u128" });
    msg = JSON.stringify({
      Execute: {
        actions: [{ Repay: { token_id: draft.tokenId, max_amount: internal.toString() } }],
      },
    });
  } else
    return err({
      kind: "invalid_input",
      reason: "Rhea lending version has no verified repay encoding",
    });
  const repay = ftTransferCall(draft.tokenId, p.lendingId, draft.amount, msg);
  if (!repay.ok) return repay;
  const fee = feeTransfers(draft, p);
  if (!fee.ok) return fee;
  return ok([repay.value, ...fee.value]);
}
