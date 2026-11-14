/**
 * Browser-side check of a repay card's payload before any wallet is asked to sign (invariant E1).
 *
 * The model never supplies payloads, but the server builds them; this check means a buggy or
 * compromised route still cannot make the browser sign a transfer to another contract.
 *
 * Allowlist, from an inventory of every transaction `rhea.repayPayload` and
 * `shared.feeTransfers` can emit (task 1.1):
 *   1. repay: `<debt token>.ft_transfer_call({receiver_id: <lending>, amount, msg})`, 1 yocto;
 *      `msg` is `"OnlyRepay"` for Rhea 0.16.2, or `{"Execute":{"actions":[{"Repay":{token_id,
 *      max_amount: amount × 10^extra}}]}}` for 0.11.0.
 *   2. optional registration: `<fee token>.storage_deposit({account_id: <fee recipient>,
 *      registration_only: true})`, deposit in (0, 0.1 NEAR].
 *   3. fee (only when the card has one fee line): `<fee token>.ft_transfer({receiver_id:
 *      <fee recipient>, amount})`, 1 yocto.
 * Every transaction has exactly one function-call action with exactly these keys; anything else
 * (AddKey, DeleteKey, Transfer, DeployContract, Stake, extra arguments) is refused.
 *
 * Does not guarantee: that the wallet displays the transaction faithfully, or that Rhea accepts it.
 */
import { type Card, decimalString, isValidAccountId } from "@mrfund/shared";

const TGAS = 1_000_000_000_000n;
const MAX_GAS = 300n * TGAS;
/** Upper bound for a fee-recipient NEP-145 registration (token storage minimums are ~0.00125 NEAR). */
export const MAX_REGISTRATION_YOCTO = 10n ** 23n;
const U128_MAX = (1n << 128n) - 1n;

export type Network = "testnet" | "mainnet";
export type TxRole = "repay" | "registration" | "fee";

export interface RepayExpectation {
  /** Network the app is configured for. */
  network: Network;
  /** Network and account of the connected wallet session. */
  session: { network: Network; accountId: string };
  /** Account the signer will sign as; must be the session account. */
  signerId: string;
  /** Public configuration (task 1.2). */
  lendingId: string;
  feeRecipientId: string;
  /** Observed `get_version`, never inferred. */
  lendingVersion: "0.11.0" | "0.16.2";
  /** Debt token metadata from the validated position snapshot. */
  token: { id: string; symbol: string; decimals: number; extraDecimals: number };
}

export interface VerifiedTransaction {
  receiverId: string;
  methodName: "ft_transfer_call" | "storage_deposit" | "ft_transfer";
  args: Record<string, unknown>;
  argsJson: string;
  gas: bigint;
  deposit: bigint;
  role: TxRole;
}

export interface VerifiedRepay {
  cardId: string;
  network: Network;
  signerId: string;
  lendingId: string;
  lendingVersion: RepayExpectation["lendingVersion"];
  tokenId: string;
  amount: bigint;
  fee: { amount: bigint; tokenId: string; recipientId: string } | null;
  transactions: VerifiedTransaction[];
}

export type VerifyResult = { ok: true; value: VerifiedRepay } | { ok: false; reason: string };
const refuse = (reason: string): VerifyResult => ({ ok: false, reason });

function plainObject(v: unknown, keys: readonly string[]): Record<string, unknown> | null {
  if (v === null || typeof v !== "object" || Array.isArray(v)) return null;
  if (Object.getPrototypeOf(v) !== Object.prototype && Object.getPrototypeOf(v) !== null)
    return null;
  const own = Object.keys(v);
  if (own.length !== keys.length || !keys.every((k) => own.includes(k))) return null;
  return v as Record<string, unknown>;
}

const amountText = (v: unknown): bigint | null =>
  typeof v === "string" && /^[1-9]\d{0,38}$/.test(v) && BigInt(v) <= U128_MAX ? BigInt(v) : null;

/** One function call with exactly the builder's keys, bounded gas and an exact deposit rule. */
function call(
  tx: unknown,
  method: VerifiedTransaction["methodName"],
  argKeys: readonly string[],
): Omit<VerifiedTransaction, "role"> | null {
  const t = plainObject(tx, ["receiverId", "actions"]);
  if (!t || typeof t.receiverId !== "string" || !Array.isArray(t.actions)) return null;
  if (t.actions.length !== 1) return null;
  const a = plainObject(t.actions[0], ["methodName", "args", "gas", "deposit"]);
  if (!a || a.methodName !== method) return null;
  if (typeof a.gas !== "bigint" || a.gas <= 0n || a.gas > MAX_GAS) return null;
  if (typeof a.deposit !== "bigint" || a.deposit <= 0n) return null;
  const args = plainObject(a.args, argKeys);
  if (!args) return null;
  return {
    receiverId: t.receiverId,
    methodName: method,
    args,
    argsJson: JSON.stringify(args),
    gas: a.gas,
    deposit: a.deposit,
  };
}

/** The repay amount the card states, from the engine-built headline `Repay <amount> <symbol>`. */
export function cardRepayAmount(card: Card, token: RepayExpectation["token"]): bigint | null {
  const m = /^Repay (\d{1,39}(?:\.\d{1,77})?) (\S+)$/.exec(card.headline);
  if (!m || m[2] !== token.symbol || !m[1]) return null;
  const [whole, frac = ""] = m[1].split(".");
  if (frac.length > token.decimals || whole === undefined) return null;
  const v =
    BigInt(whole) * 10n ** BigInt(token.decimals) + BigInt(frac.padEnd(token.decimals, "0") || "0");
  return decimalString(v, token.decimals) === m[1] ? v : null;
}

export function verifyCardPayload(card: Card, x: RepayExpectation): VerifyResult {
  if (card.action !== "repay") return refuse("Only repay cards can be executed.");
  if (x.session.network !== x.network) return refuse("Your wallet is on a different network.");
  if (x.signerId !== x.session.accountId)
    return refuse("The signing account is not the connected account.");
  for (const id of [x.lendingId, x.feeRecipientId, x.token.id, x.signerId])
    if (!isValidAccountId(id)) return refuse("Execution configuration is invalid.");
  if (!(card.dataAgeMs < card.maxDataAgeMs)) return refuse("This card's data is too old.");
  if (!Array.isArray(card.payload) || card.payload.length < 1 || card.payload.length > 3)
    return refuse("Unexpected number of transactions.");
  const amount = cardRepayAmount(card, x.token);
  if (amount === null) return refuse("The card does not state a repay amount for this token.");

  const [first, ...rest] = card.payload;
  const repay = call(first, "ft_transfer_call", ["receiver_id", "amount", "msg"]);
  if (!repay || repay.receiverId !== x.token.id)
    return refuse("The repay transfer is not for this debt token.");
  if (repay.deposit !== 1n) return refuse("The repay transfer must attach exactly 1 yoctoNEAR.");
  if (repay.args.receiver_id !== x.lendingId)
    return refuse("The repay goes to a contract other than the configured lending contract.");
  if (amountText(repay.args.amount) !== amount)
    return refuse("The repay amount differs from the card.");
  const msg =
    x.lendingVersion === "0.16.2"
      ? JSON.stringify("OnlyRepay")
      : JSON.stringify({
          Execute: {
            actions: [
              {
                Repay: {
                  token_id: x.token.id,
                  max_amount: (amount * 10n ** BigInt(x.token.extraDecimals)).toString(),
                },
              },
            ],
          },
        });
  if (repay.args.msg !== msg) return refuse("The repay message is not the verified encoding.");
  const transactions: VerifiedTransaction[] = [{ ...repay, role: "repay" }];

  if (card.fees.length > 1) return refuse("More than one fee line is not supported.");
  const line = card.fees[0];
  let fee: VerifiedRepay["fee"] = null;
  if (!line) {
    if (rest.length > 0) return refuse("Unexpected transactions after the repay.");
  } else {
    if (line.recipientId !== x.feeRecipientId)
      return refuse("The fee goes to an account other than the configured fee recipient.");
    if (typeof line.amount !== "bigint" || line.amount <= 0n || line.amount > U128_MAX)
      return refuse("The fee amount is invalid.");
    const payment = rest.at(-1);
    const registration = rest.length === 2 ? rest[0] : undefined;
    if (rest.length < 1 || rest.length > 2) return refuse("The fee transactions are incomplete.");
    if (registration !== undefined) {
      const r = call(registration, "storage_deposit", ["account_id", "registration_only"]);
      if (
        !r ||
        r.receiverId !== line.tokenId ||
        r.args.account_id !== x.feeRecipientId ||
        r.args.registration_only !== true ||
        r.deposit > MAX_REGISTRATION_YOCTO
      )
        return refuse("The fee recipient registration is not the expected one.");
      transactions.push({ ...r, role: "registration" });
    }
    const p = call(payment, "ft_transfer", ["receiver_id", "amount"]);
    if (!p || p.receiverId !== line.tokenId || p.deposit !== 1n)
      return refuse("The fee transfer is not the expected one.");
    if (p.args.receiver_id !== x.feeRecipientId)
      return refuse("The fee goes to an account other than the configured fee recipient.");
    if (amountText(p.args.amount) !== line.amount)
      return refuse("The fee amount differs from the card.");
    transactions.push({ ...p, role: "fee" });
    fee = { amount: line.amount, tokenId: line.tokenId, recipientId: line.recipientId };
  }
  const value: VerifiedRepay = Object.freeze({
    cardId: card.id,
    network: x.network,
    signerId: x.signerId,
    lendingId: x.lendingId,
    lendingVersion: x.lendingVersion,
    tokenId: x.token.id,
    amount,
    fee,
    transactions: Object.freeze(
      transactions.map((t) => Object.freeze({ ...t })),
    ) as VerifiedTransaction[],
  });
  issued.add(value);
  return { ok: true, value };
}

/** Results this module produced. The signer accepts nothing else (invariant E1). */
const issued = new WeakSet<VerifiedRepay>();
export function wasVerified(value: VerifiedRepay): boolean {
  return issued.has(value);
}
