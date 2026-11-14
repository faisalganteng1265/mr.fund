/**
 * NEP-141 transaction encodings shared by the Rhea and Guardian builders (BUILD-PLAN P4.2).
 *
 * Only these functions produce `NearTransaction` values. Amounts are token atomic units written
 * as decimal strings, every token transfer carries exactly 1 yoctoNEAR, and account ids are
 * validated before they reach a payload. The vectors in `fixtures/encodings.json` pin the exact
 * bytes; the Rust sandbox tests assert the same file.
 *
 * Does not guarantee: that the transaction succeeds on chain, that the gas figures are enough
 * (they are unmeasured estimates until P2.7 and P4.5), or that a signer approves it.
 */

import type { CardDraft, FeeLine, NearFunctionCall, NearTransaction } from "./card";
import type { AccountId, Atomic, EngineError, Result } from "./errors";
import { err, ok } from "./errors";

export const ONE_YOCTO = 1n;

const TGAS = 1_000_000_000_000n;
/** [I] Estimates, not measurements. Replace with measured values in P2.7 and P4.5. */
export const GAS = {
  ftTransferCall: 100n * TGAS,
  ftTransfer: 30n * TGAS,
  storageDeposit: 30n * TGAS,
} as const;

const U128_MAX = 2n ** 128n - 1n;
const ACCOUNT_ID = /^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;

/** NEAR account id rules: 2 to 64 characters, lowercase letters, digits and `-_` between parts. */
export function isValidAccountId(id: string): boolean {
  return id.length >= 2 && id.length <= 64 && ACCOUNT_ID.test(id);
}

const badId = (what: string, id: string): Result<never, EngineError> =>
  err({
    kind: "invalid_input",
    reason: `${what} is not a valid account id: ${JSON.stringify(id)}`,
  });

function checkAmount(amount: Atomic): Result<null, EngineError> {
  if (amount <= 0n)
    return err({ kind: "invalid_amount", reason: "amount must be greater than zero" });
  if (amount > U128_MAX)
    return err({ kind: "invalid_amount", reason: "amount exceeds the largest u128" });
  return ok(null);
}

const tx = (receiverId: AccountId, action: NearFunctionCall): NearTransaction => ({
  receiverId,
  actions: [action],
});

/** `ft_transfer_call(receiver_id, amount, msg)` on the token, with 1 yocto. */
export function ftTransferCall(
  tokenId: AccountId,
  receiverId: AccountId,
  amount: Atomic,
  msg: string,
): Result<NearTransaction, EngineError> {
  if (!isValidAccountId(tokenId)) return badId("token", tokenId);
  if (!isValidAccountId(receiverId)) return badId("receiver", receiverId);
  const a = checkAmount(amount);
  if (!a.ok) return a;
  return ok(
    tx(tokenId, {
      methodName: "ft_transfer_call",
      args: { receiver_id: receiverId, amount: amount.toString(), msg },
      gas: GAS.ftTransferCall,
      deposit: ONE_YOCTO,
    }),
  );
}

/** `ft_transfer(receiver_id, amount)` on the token, with 1 yocto. */
export function ftTransfer(
  tokenId: AccountId,
  receiverId: AccountId,
  amount: Atomic,
): Result<NearTransaction, EngineError> {
  if (!isValidAccountId(tokenId)) return badId("token", tokenId);
  if (!isValidAccountId(receiverId)) return badId("receiver", receiverId);
  const a = checkAmount(amount);
  if (!a.ok) return a;
  return ok(
    tx(tokenId, {
      methodName: "ft_transfer",
      args: { receiver_id: receiverId, amount: amount.toString() },
      gas: GAS.ftTransfer,
      deposit: ONE_YOCTO,
    }),
  );
}

/** `storage_deposit(account_id, registration_only: true)` on the token, paying `depositYocto`. */
export function storageDeposit(
  tokenId: AccountId,
  accountId: AccountId,
  depositYocto: bigint,
): Result<NearTransaction, EngineError> {
  if (!isValidAccountId(tokenId)) return badId("token", tokenId);
  if (!isValidAccountId(accountId)) return badId("account", accountId);
  if (depositYocto <= 0n) {
    return err({ kind: "invalid_amount", reason: "storage deposit must be greater than zero" });
  }
  return ok(
    tx(tokenId, {
      methodName: "storage_deposit",
      args: { account_id: accountId, registration_only: true },
      gas: GAS.storageDeposit,
      deposit: depositYocto,
    }),
  );
}

export interface FeeTransferParams {
  /** Whether the fee recipient is already registered on the fee token (`storage_balance_of`). */
  recipientRegistered: boolean;
  /** Needed only when the recipient is not registered: the token's `storage_balance_bounds().min`. */
  storageDepositYocto?: bigint;
}

/**
 * Transactions that pay the card's fee: nothing for no fee; otherwise an optional registration of
 * the recipient followed by one `ft_transfer`. An unregistered recipient with no known deposit
 * is refused, because the transfer would fail on chain after the repay had gone through.
 */
export function feeTransfers(
  draft: Pick<CardDraft, "fees">,
  p: FeeTransferParams,
): Result<NearTransaction[], EngineError> {
  if (draft.fees.length === 0) return ok([]);
  const [fee, ...rest] = draft.fees as [FeeLine, ...FeeLine[]];
  if (rest.length > 0) {
    return err({ kind: "invalid_input", reason: "more than one fee line is not supported" });
  }
  const out: NearTransaction[] = [];
  if (!p.recipientRegistered) {
    if (p.storageDepositYocto === undefined) {
      return err({
        kind: "invalid_input",
        reason:
          "fee recipient is not registered on the fee token and no storage deposit amount is known",
      });
    }
    const reg = storageDeposit(fee.tokenId, fee.recipientId, p.storageDepositYocto);
    if (!reg.ok) return reg;
    out.push(reg.value);
  }
  const pay = ftTransfer(fee.tokenId, fee.recipientId, fee.amount);
  if (!pay.ok) return pay;
  out.push(pay.value);
  return ok(out);
}
