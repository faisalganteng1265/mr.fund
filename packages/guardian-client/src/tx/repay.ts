/**
 * Guardian-held loan repay payload (G1; BUILD-PLAN P4.2). Pending D18: if the founder picks a
 * different custody option this builder changes or goes away.
 *
 * The debt token goes to the user's Guardian, which forwards it to Rhea with `OnlyRepay` as itself
 * (SMART-CONTRACT `{"repay":{}}`). Same boundary as the wallet repay: the user's wallet signs with
 * 1 yocto, and token and amount come only from the engine's `CardDraft`.
 *
 * Does not guarantee: that the Guardian is active or holds a loan; the contract decides that.
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

/** The `msg` that makes the Guardian repay with the tokens it just received. */
export const GUARDIAN_REPAY_MSG = JSON.stringify({ repay: {} });

export interface GuardianRepayParams extends FeeTransferParams {
  guardianId: string;
}

export function guardianRepayPayload(
  draft: CardDraft,
  p: GuardianRepayParams,
): Result<NearTransaction[], EngineError> {
  if (draft.action !== "repay") {
    return err({ kind: "invalid_input", reason: "this builder only creates repay payloads" });
  }
  const repay = ftTransferCall(draft.tokenId, p.guardianId, draft.amount, GUARDIAN_REPAY_MSG);
  if (!repay.ok) return repay;
  const fee = feeTransfers(draft, p);
  if (!fee.ok) return fee;
  return ok([repay.value, ...fee.value]);
}
