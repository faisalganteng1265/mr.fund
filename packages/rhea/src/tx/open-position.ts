/**
 * Plain-wallet opening payloads (`add-chat-open-position` 3.1): a collateral deposit and a borrow
 * against Rhea, built only from the engine's validated `CardDraft` and trusted context.
 *
 * Shapes are the ones public Gate 1 and the Guardian run exercised on Rhea `0.11.0`:
 * - deposit: the collateral token's `ft_transfer_call(lending, amount, msg)` with
 *   `{"Execute":{"actions":[{"IncreaseCollateral":{"token_id":<token>}}]}}` and 1 yocto. The inner
 *   action has no `amount` or `max_amount`.
 * - borrow: `execute_with_pyth({actions:[Borrow(token, internal), Withdraw(token)]})` with 1 yocto.
 *   The `Withdraw` has no `amount` or `max_amount`: an exact withdraw reverts on pools with accrued
 *   interest (LESSONS 2026-11-11), and no silent fallback encoding exists.
 * Registrations come first and only when the caller passes them; they carry the exact freshly read
 * NEP-145 minimum and are bounded. A disclosed fee, if any, follows through the shared fee helper.
 *
 * Permission boundary: the connected wallet signs; every deposit is exactly 1 yocto, apart from
 * the bounded registrations, so a function-call key cannot supply it. An amount-omitted action
 * can consume a pre-existing supplied balance, so the engine refuses those accounts before a
 * draft exists; the verifier checks again before signing. Unknown versions are refused, never
 * retried with another encoding.
 *
 * Does not guarantee: that Rhea accepts the action, that the whole borrowed amount reaches the
 * wallet (it can be a few units lower), or that the quote still holds at inclusion.
 */
import {
  type CardDraft,
  type EngineError,
  err,
  type FeeTransferParams,
  feeTransfers,
  ftTransferCall,
  isValidAccountId,
  type NearTransaction,
  ok,
  type Result,
  storageDeposit,
} from "@mrfund/shared";

const TGAS = 1_000_000_000_000n;
/** [V, testnet] The attachment public Gate 1 and the Guardian run used; not a measured minimum. */
export const OPENING_GAS = 300n * TGAS;
/** Rhea versions whose opening encodings are pinned by recorded evidence. */
export const OPENING_VERSIONS: readonly string[] = ["0.11.0"];
/** A registration deposit above this is refused (observed minimums are 0.1 NEAR and 0.00125 NEAR). */
export const MAX_REGISTRATION_YOCTO = 10n ** 24n;
const U128_MAX = (1n << 128n) - 1n;

export interface RegistrationDeposit {
  /** The lending contract or one of the pair's tokens. */
  contractId: string;
  /** Exact `storage_balance_bounds().min` read for this build, yoctoNEAR. */
  depositYocto: bigint;
}

export interface OpeningPayloadParams extends FeeTransferParams {
  lendingId: string;
  /** Observed `get_version`; never inferred. */
  lendingVersion: string;
  /** The connected account that is registered and signs. */
  accountId: string;
  /** Registrations still missing for this stage, in the order to run them. */
  registrations: RegistrationDeposit[];
}

export interface BorrowPayloadParams extends OpeningPayloadParams {
  /** The debt token's Rhea extra decimals: internal = atomic x 10^extraDecimals. */
  extraDecimals: number;
}

const bad = (reason: string): Result<never, EngineError> => err({ kind: "invalid_input", reason });

function registrationPayload(
  p: OpeningPayloadParams,
  allowed: readonly string[],
): Result<NearTransaction[], EngineError> {
  const out: NearTransaction[] = [];
  const seen = new Set<string>();
  for (const r of p.registrations) {
    if (!allowed.includes(r.contractId))
      return bad(`registration target ${r.contractId} is not part of this stage`);
    if (seen.has(r.contractId)) return bad(`registration for ${r.contractId} appears twice`);
    seen.add(r.contractId);
    if (typeof r.depositYocto !== "bigint" || r.depositYocto <= 0n)
      return bad("a registration deposit must be positive");
    if (r.depositYocto > MAX_REGISTRATION_YOCTO) return bad("a registration deposit is too large");
    const tx = storageDeposit(r.contractId, p.accountId, r.depositYocto);
    if (!tx.ok) return tx;
    out.push(tx.value);
  }
  return ok(out);
}

function checkCommon(
  draft: CardDraft,
  action: CardDraft["action"],
  p: OpeningPayloadParams,
): Result<null, EngineError> {
  if (draft.action !== action) return bad(`this builder only creates ${action} payloads`);
  if (!OPENING_VERSIONS.includes(p.lendingVersion))
    return bad("Rhea lending version has no verified opening encoding");
  if (!isValidAccountId(p.lendingId) || !isValidAccountId(p.accountId))
    return bad("invalid lending or account id");
  if (typeof draft.amount !== "bigint" || draft.amount <= 0n)
    return err({ kind: "invalid_amount", reason: "amount must be greater than zero" });
  return ok(null);
}

/** Registrations, the collateral transfer, then any disclosed fee. */
export function collateralDepositPayload(
  draft: CardDraft,
  p: OpeningPayloadParams,
): Result<NearTransaction[], EngineError> {
  const common = checkCommon(draft, "wallet_collateral_deposit", p);
  if (!common.ok) return common;
  const regs = registrationPayload(p, [p.lendingId, draft.tokenId]);
  if (!regs.ok) return regs;
  const msg = JSON.stringify({
    Execute: { actions: [{ IncreaseCollateral: { token_id: draft.tokenId } }] },
  });
  const transfer = ftTransferCall(draft.tokenId, p.lendingId, draft.amount, msg);
  if (!transfer.ok) return transfer;
  const [first] = transfer.value.actions;
  if (!first) return bad("invalid collateral transfer");
  const fee = feeTransfers(draft, p);
  if (!fee.ok) return fee;
  return ok([
    ...regs.value,
    { ...transfer.value, actions: [{ ...first, gas: OPENING_GAS }] },
    ...fee.value,
  ]);
}

/** Registrations on the debt token, the borrow with an amount-omitted withdraw, then any fee. */
export function borrowPayload(
  draft: CardDraft,
  p: BorrowPayloadParams,
): Result<NearTransaction[], EngineError> {
  const common = checkCommon(draft, "wallet_borrow", p);
  if (!common.ok) return common;
  if (!Number.isInteger(p.extraDecimals) || p.extraDecimals < 0 || p.extraDecimals > 38)
    return bad("invalid Rhea extra decimals");
  const internal = draft.amount * 10n ** BigInt(p.extraDecimals);
  if (internal > U128_MAX)
    return err({ kind: "invalid_amount", reason: "internal amount exceeds u128" });
  const regs = registrationPayload(p, [draft.tokenId]);
  if (!regs.ok) return regs;
  const fee = feeTransfers(draft, p);
  if (!fee.ok) return fee;
  return ok([
    ...regs.value,
    {
      receiverId: p.lendingId,
      actions: [
        {
          methodName: "execute_with_pyth",
          args: {
            actions: [
              { Borrow: { token_id: draft.tokenId, amount: internal.toString() } },
              { Withdraw: { token_id: draft.tokenId } },
            ],
          },
          gas: OPENING_GAS,
          deposit: 1n,
        },
      ],
    },
    ...fee.value,
  ]);
}
