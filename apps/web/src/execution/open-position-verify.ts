/**
 * Browser-side check of a plain-wallet opening card's payload before any wallet is asked to sign
 * (`add-chat-open-position` 3.2; invariants OP-1 and OP-2). It never trusts the builder: the
 * allowlist below is written out here and compared against trusted current context, so a buggy or
 * compromised route still cannot make the browser sign anything else.
 *
 * Allowlist (one stage per card), in this order:
 *   1. registrations, only for contracts the context says are missing, each
 *      `storage_deposit({account_id: <signer>, registration_only: true})` paying exactly the freshly
 *      read NEP-145 minimum. Deposit stage: the lending contract. Borrow stage: the debt token.
 *   2. deposit stage: `<collateral token>.ft_transfer_call({receiver_id: <lending>, amount, msg})`
 *      with `msg` exactly `{"Execute":{"actions":[{"IncreaseCollateral":{"token_id":<token>}}]}}`
 *      and 1 yocto. Borrow stage: `<lending>.execute_with_pyth({actions:[Borrow, Withdraw]})` with
 *      the Borrow bounded by the card amount in Rhea internal units, a Withdraw that has only a
 *      `token_id` (no `amount`, no `max_amount`), and 1 yocto.
 *   3. optional fee: an unregistered-recipient registration then `ft_transfer`, as for repay.
 * Every transaction has exactly one function call with exactly the builder's keys and bounded
 * gas; AddKey, DeleteKey, Transfer, DeployContract, Stake, Guardian calls and any extra or nested
 * extra field are refused. The headline amount, the first card number and the payload amount must
 * all agree, and an account that already supplies the token an amount-omitted action would sweep
 * is refused.
 *
 * Does not guarantee: that the wallet displays the transaction faithfully, that Rhea accepts it,
 * or that the context is unchanged when the transaction lands.
 */
import { type Card, decimalString, isValidAccountId } from "@mrfund/shared";
import type { Network } from "./verify";

const TGAS = 1_000_000_000_000n;
const MAX_GAS = 300n * TGAS;
/** [V, SMART-CONTRACT P2.4] Rhea `execute_with_pyth` needed up to 240 Tgas in the probe. */
const MIN_BORROW_GAS = 240n * TGAS;
/** The shared `ft_transfer_call` default; the deposit builder attaches more. */
const MIN_TRANSFER_CALL_GAS = 100n * TGAS;
const MIN_STORAGE_GAS = 10n * TGAS;
const MIN_FEE_TRANSFER_GAS = 10n * TGAS;
/** Upper bound for the fee recipient's registration (token minimums are about 0.00125 NEAR). */
const MAX_FEE_REGISTRATION_YOCTO = 10n ** 23n;
const U128_MAX = (1n << 128n) - 1n;
/** Rhea versions whose opening encodings are pinned by recorded evidence. */
export const VERIFIED_OPENING_VERSIONS: readonly string[] = ["0.11.0"];

export type OpeningStage = "wallet_collateral_deposit" | "wallet_borrow";
export type OpeningRole = "registration" | "deposit" | "borrow" | "fee";

export interface TokenMeta {
  id: string;
  symbol: string;
  decimals: number;
  extraDecimals: number;
}

export interface OpeningExpectation {
  network: Network;
  session: { network: Network; accountId: string };
  signerId: string;
  lendingId: string;
  feeRecipientId: string;
  /** Observed `get_version`, never inferred. */
  lendingVersion: string;
  collateral: TokenMeta;
  debt: TokenMeta;
  /** Current supplied balances in Rhea internal units, read just before signing. */
  supplied: { collateral: bigint; debt: bigint };
  /** Current registration state with the freshly read storage minimums, yoctoNEAR. */
  registrations: {
    lending: { registered: boolean; minimumYocto: bigint };
    debtToken: { registered: boolean; minimumYocto: bigint };
  };
}

export interface OpeningTransaction {
  receiverId: string;
  methodName: "storage_deposit" | "ft_transfer_call" | "execute_with_pyth" | "ft_transfer";
  args: Record<string, unknown>;
  argsJson: string;
  gas: bigint;
  deposit: bigint;
  role: OpeningRole;
}

export interface VerifiedOpening {
  /** Discriminates this result from `VerifiedRepay` and `VerifiedGuardian` for the signer. */
  stage: OpeningStage;
  cardId: string;
  network: Network;
  signerId: string;
  lendingId: string;
  lendingVersion: string;
  tokenId: string;
  /** Principal or deposit, token atomic units. */
  amount: bigint;
  fee: { amount: bigint; tokenId: string; recipientId: string } | null;
  transactions: OpeningTransaction[];
}

export type OpeningVerifyResult =
  | { ok: true; value: VerifiedOpening }
  | { ok: false; reason: string };
const refuse = (reason: string): OpeningVerifyResult => ({ ok: false, reason });

function exact(v: unknown, keys: readonly string[]): Record<string, unknown> | null {
  if (v === null || typeof v !== "object" || Array.isArray(v)) return null;
  const proto = Object.getPrototypeOf(v);
  if (proto !== Object.prototype && proto !== null) return null;
  const own = Object.keys(v);
  if (own.length !== keys.length || !keys.every((k) => own.includes(k))) return null;
  return v as Record<string, unknown>;
}

/** Deep equality for plain JSON values: same keys, same order-free contents, no extras. */
function sameJson(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) || Array.isArray(b))
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((x, i) => sameJson(x, b[i]))
    );
  if (a !== null && b !== null && typeof a === "object" && typeof b === "object") {
    const o = exact(a, Object.keys(b));
    return (
      o !== null && Object.keys(b).every((k) => sameJson(o[k], (b as Record<string, unknown>)[k]))
    );
  }
  return a === b;
}

const amountText = (v: unknown): bigint | null =>
  typeof v === "string" && /^[1-9]\d{0,38}$/.test(v) && BigInt(v) <= U128_MAX ? BigInt(v) : null;

function call(
  tx: unknown,
  method: OpeningTransaction["methodName"],
  argKeys: readonly string[],
  minGas: bigint,
): Omit<OpeningTransaction, "role"> | null {
  const t = exact(tx, ["receiverId", "actions"]);
  if (!t || typeof t.receiverId !== "string" || !Array.isArray(t.actions)) return null;
  if (t.actions.length !== 1) return null;
  const a = exact(t.actions[0], ["methodName", "args", "gas", "deposit"]);
  if (!a || a.methodName !== method) return null;
  if (typeof a.gas !== "bigint" || a.gas < minGas || a.gas > MAX_GAS) return null;
  if (typeof a.deposit !== "bigint" || a.deposit <= 0n) return null;
  const args = exact(a.args, argKeys);
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

/** `Deposit 10 wNEAR as collateral` or `Borrow 37.5 USDC`, parsed against the token's decimals. */
function headlineAmount(card: Card, stage: OpeningStage, token: TokenMeta): bigint | null {
  const re =
    stage === "wallet_collateral_deposit"
      ? /^Deposit (\d{1,39}(?:\.\d{1,77})?) (\S+) as collateral$/
      : /^Borrow (\d{1,39}(?:\.\d{1,77})?) (\S+)$/;
  const m = re.exec(card.headline);
  if (!m || m[2] !== token.symbol || !m[1]) return null;
  const [whole, frac = ""] = m[1].split(".");
  if (frac.length > token.decimals || whole === undefined) return null;
  const v =
    BigInt(whole) * 10n ** BigInt(token.decimals) + BigInt(frac.padEnd(token.decimals, "0") || "0");
  return decimalString(v, token.decimals) === m[1] ? v : null;
}

export function verifyOpeningPayload(card: Card, x: OpeningExpectation): OpeningVerifyResult {
  const stage = card.action;
  if (stage !== "wallet_collateral_deposit" && stage !== "wallet_borrow")
    return refuse("Only opening cards can be executed here.");
  if (x.session.network !== x.network) return refuse("Your wallet is on a different network.");
  if (x.signerId !== x.session.accountId)
    return refuse("The signing account is not the connected account.");
  for (const id of [x.lendingId, x.feeRecipientId, x.collateral.id, x.debt.id, x.signerId])
    if (!isValidAccountId(id)) return refuse("Execution configuration is invalid.");
  if (!VERIFIED_OPENING_VERSIONS.includes(x.lendingVersion))
    return refuse("This Rhea version has no verified opening encoding.");
  if (!(card.dataAgeMs < card.maxDataAgeMs)) return refuse("This card's data is too old.");
  if (!Array.isArray(card.payload) || card.payload.length < 1 || card.payload.length > 5)
    return refuse("Unexpected number of transactions.");

  const token = stage === "wallet_collateral_deposit" ? x.collateral : x.debt;
  const amount = headlineAmount(card, stage, token);
  if (amount === null) return refuse("The card does not state an amount for this token.");
  const first = card.numbers[0];
  if (
    !first ||
    first.unit !== token.symbol ||
    first.after !== decimalString(amount, token.decimals) ||
    (stage === "wallet_collateral_deposit" ? first.label !== "Deposit" : first.label !== "Borrow")
  )
    return refuse("The card's amount and its headline disagree.");
  if (x.supplied.collateral < 0n || x.supplied.debt < 0n)
    return refuse("Supplied balances are invalid.");
  const sweepRisk = stage === "wallet_collateral_deposit" ? x.supplied.collateral : x.supplied.debt;
  if (sweepRisk !== 0n)
    return refuse(
      "The account already supplies this token; an amount-omitted action would sweep it.",
    );

  // Registrations the context says are missing, in the order the builder emits them.
  const needed: { contractId: string; minimumYocto: bigint }[] = [];
  if (stage === "wallet_collateral_deposit") {
    if (!x.registrations.lending.registered)
      needed.push({ contractId: x.lendingId, minimumYocto: x.registrations.lending.minimumYocto });
  } else if (!x.registrations.debtToken.registered) {
    needed.push({ contractId: x.debt.id, minimumYocto: x.registrations.debtToken.minimumYocto });
  }

  const transactions: OpeningTransaction[] = [];
  const queue = [...card.payload];
  for (const want of needed) {
    const reg = call(
      queue.shift(),
      "storage_deposit",
      ["account_id", "registration_only"],
      MIN_STORAGE_GAS,
    );
    if (
      !reg ||
      reg.receiverId !== want.contractId ||
      reg.args.account_id !== x.signerId ||
      reg.args.registration_only !== true ||
      want.minimumYocto <= 0n ||
      reg.deposit !== want.minimumYocto
    )
      return refuse("A required registration is missing or is not the expected one.");
    transactions.push({ ...reg, role: "registration" });
  }

  const main = queue.shift();
  if (stage === "wallet_collateral_deposit") {
    const t = call(
      main,
      "ft_transfer_call",
      ["receiver_id", "amount", "msg"],
      MIN_TRANSFER_CALL_GAS,
    );
    if (!t || t.receiverId !== x.collateral.id)
      return refuse("The deposit is not for the collateral token.");
    if (t.deposit !== 1n) return refuse("The deposit transfer must attach exactly 1 yoctoNEAR.");
    if (t.args.receiver_id !== x.lendingId)
      return refuse("The deposit goes to a contract other than the configured lending contract.");
    if (amountText(t.args.amount) !== amount)
      return refuse("The deposit amount differs from the card.");
    const msg = JSON.stringify({
      Execute: { actions: [{ IncreaseCollateral: { token_id: x.collateral.id } }] },
    });
    if (t.args.msg !== msg) return refuse("The deposit message is not the verified encoding.");
    transactions.push({ ...t, role: "deposit" });
  } else {
    const t = call(main, "execute_with_pyth", ["actions"], MIN_BORROW_GAS);
    if (!t || t.receiverId !== x.lendingId)
      return refuse("The borrow is not for the configured lending contract.");
    if (t.deposit !== 1n) return refuse("The borrow must attach exactly 1 yoctoNEAR.");
    const internal = amount * 10n ** BigInt(x.debt.extraDecimals);
    if (internal > U128_MAX) return refuse("The borrow amount is too large.");
    const want = {
      actions: [
        { Borrow: { token_id: x.debt.id, amount: internal.toString() } },
        { Withdraw: { token_id: x.debt.id } },
      ],
    };
    if (!sameJson(t.args, want)) return refuse("The borrow actions are not the verified encoding.");
    transactions.push({ ...t, role: "borrow" });
  }

  // Disclosed fee: same shape as the repay fee, after the main transaction.
  if (card.fees.length > 1) return refuse("More than one fee line is not supported.");
  const line = card.fees[0];
  let fee: VerifiedOpening["fee"] = null;
  if (!line) {
    if (queue.length > 0) return refuse("Unexpected transactions after the opening.");
  } else {
    if (line.recipientId !== x.feeRecipientId)
      return refuse("The fee goes to an account other than the configured fee recipient.");
    if (typeof line.amount !== "bigint" || line.amount <= 0n || line.amount > U128_MAX)
      return refuse("The fee amount is invalid.");
    if (queue.length < 1 || queue.length > 2) return refuse("The fee transactions are incomplete.");
    const payment = queue.at(-1);
    if (queue.length === 2) {
      const r = call(
        queue[0],
        "storage_deposit",
        ["account_id", "registration_only"],
        MIN_STORAGE_GAS,
      );
      if (
        !r ||
        r.receiverId !== line.tokenId ||
        r.args.account_id !== x.feeRecipientId ||
        r.args.registration_only !== true ||
        r.deposit > MAX_FEE_REGISTRATION_YOCTO
      )
        return refuse("The fee recipient registration is not the expected one.");
      transactions.push({ ...r, role: "registration" });
    }
    const p = call(payment, "ft_transfer", ["receiver_id", "amount"], MIN_FEE_TRANSFER_GAS);
    if (!p || p.receiverId !== line.tokenId || p.deposit !== 1n)
      return refuse("The fee transfer is not the expected one.");
    if (p.args.receiver_id !== x.feeRecipientId)
      return refuse("The fee goes to an account other than the configured fee recipient.");
    if (amountText(p.args.amount) !== line.amount)
      return refuse("The fee amount differs from the card.");
    transactions.push({ ...p, role: "fee" });
    fee = { amount: line.amount, tokenId: line.tokenId, recipientId: line.recipientId };
  }

  const value: VerifiedOpening = Object.freeze({
    stage,
    cardId: card.id,
    network: x.network,
    signerId: x.signerId,
    lendingId: x.lendingId,
    lendingVersion: x.lendingVersion,
    tokenId: token.id,
    amount,
    fee,
    transactions: Object.freeze(
      transactions.map((t) => Object.freeze({ ...t })),
    ) as OpeningTransaction[],
  });
  issued.add(value);
  return { ok: true, value };
}

/** Results this module produced. The signer accepts nothing else (invariant OP-1). */
const issued = new WeakSet<VerifiedOpening>();
export function wasOpeningVerified(value: VerifiedOpening): boolean {
  return issued.has(value);
}
