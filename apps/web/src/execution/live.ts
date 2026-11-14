/**
 * Browser composition of manual repay execution for a live wallet session (tasks 3.1, 3.2).
 * It feeds `createRepayRunner` with observed inputs only: the lending contract's `get_version`,
 * a fresh final-block position read for token metadata and freshness, the public outcome
 * reader and the engine's health function. The flow is
 * `prepare (read + verify) → in-app confirmation → wallet → observed receipt`.
 *
 * Permission boundary: only a NEAR Connect session has a signer; the runner signs only what
 * `verifyCardPayload` accepted (E1, E5); one submission per card (E3). `confirmed` comes only
 * from the parser plus a fresh post-state (E2).
 * Does not guarantee: that the wallet displays the transaction faithfully, or that a debt
 * change was caused by this repay (observed deltas, not attribution).
 */
import { healthBps, outstandingDebtAtomic } from "@mrfund/engine";
import { parseDecimal } from "@mrfund/guardian-client";
import { type OutcomeError, type OutcomeReader, type RheaClient, readPosition } from "@mrfund/rhea";
import { type Card, decimalString, err, type PositionSnapshot, type Result } from "@mrfund/shared";
import type { ExecutionConfig } from "./config";
import { createRepayRunner, type RunResult } from "./run";
import type { TransactionSigner } from "./signer";
import { type RepayExpectation, type VerifiedRepay, verifyCardPayload } from "./verify";

type Token = RepayExpectation["token"];
const VERSIONS = ["0.11.0", "0.16.2"] as const;
/** Interest accrues between the card and the click; anything beyond this is a material change. */
const DEBT_DRIFT_DIVISOR = 1000n; // 0.1 %
const HEALTH_DRIFT_BPS = 50;

export function parseLendingVersion(data: unknown): RepayExpectation["lendingVersion"] | null {
  return VERSIONS.find((v) => v === data) ?? null;
}

const numberOf = (card: Card, label: string, unit: string) =>
  card.numbers.find((n) => n.label === label && n.unit === unit)?.before;

/**
 * Whether a fresh read still matches the inputs the card was computed from: the debt may only
 * have grown by accrued interest (≤ 0.1 %), and the engine health may differ by at most 0.5
 * percentage points. Anything else, or anything unreadable, asks for a new card.
 */
export function cardMatchesPosition(
  card: Card,
  fresh: PositionSnapshot,
  token: Token,
  nowMs: number,
): boolean {
  const debtText = numberOf(card, "Debt", token.symbol);
  const cardDebt = debtText === undefined ? null : parseDecimal(debtText, token.decimals);
  if (cardDebt === null) return false;
  const debt = outstandingDebtAtomic(fresh, token.id);
  if (debt < cardDebt || debt - cardDebt > cardDebt / DEBT_DRIFT_DIVISOR) return false;
  const healthText = numberOf(card, "Health factor", "%");
  if (healthText === undefined) return true;
  const cardHealth = parseDecimal(healthText, 2);
  const health = healthBps(fresh, nowMs);
  if (cardHealth === null || !health.ok || health.value.value === "no_debt") return false;
  return Math.abs(health.value.value - Number(cardHealth)) <= HEALTH_DRIFT_BPS;
}

export interface Confirmation {
  amount: string;
  tokenId: string;
  fee: { amount: string; recipientId: string } | null;
  /** NEAR attached to register the fee recipient with the token, when needed. */
  registrationNear: string | null;
  lendingId: string;
  network: string;
  accountId: string;
}

export function confirmationOf(v: VerifiedRepay, token: Token): Confirmation {
  const registration = v.transactions.find((t) => t.role === "registration");
  return {
    amount: `${decimalString(v.amount, token.decimals)} ${token.symbol}`,
    tokenId: v.tokenId,
    fee: v.fee
      ? {
          amount: `${decimalString(v.fee.amount, token.decimals)} ${v.fee.tokenId === token.id ? token.symbol : v.fee.tokenId}`,
          recipientId: v.fee.recipientId,
        }
      : null,
    registrationNear: registration ? `${decimalString(registration.deposit, 24)} NEAR` : null,
    lendingId: v.lendingId,
    network: v.network,
    accountId: v.signerId,
  };
}

export type RepayView =
  | { phase: "idle" }
  | { phase: "preparing"; cardId: string }
  | { phase: "blocked"; cardId: string; reason: string }
  | { phase: "confirm"; cardId: string; confirmation: Confirmation }
  | { phase: "signing"; cardId: string }
  | { phase: "result"; cardId: string; result: RunResult; token: Token };

export interface LiveRepayDeps {
  accountId: string;
  network: "testnet" | "mainnet";
  /** Public execution configuration, or the reason it is missing. */
  config: { ok: true; value: ExecutionConfig } | { ok: false; reason: string };
  rhea: RheaClient;
  reader: OutcomeReader;
  signer: TransactionSigner | null;
  /** Injected in tests; defaults to a final-block `readPosition` through `rhea`. */
  readPosition?: () => Promise<Result<PositionSnapshot, OutcomeError>>;
  now?: () => number;
}

export function createLiveRepay(deps: LiveRepayDeps) {
  const now = deps.now ?? Date.now;
  let view: RepayView = { phase: "idle" };
  const listeners = new Set<() => void>();
  const publish = (next: RepayView) => {
    view = next;
    for (const l of listeners) l();
  };
  /** Facts observed in `prepare`, used by the runner's synchronous verify and freshness checks. */
  let observed: { version: RepayExpectation["lendingVersion"]; token: Token } | null = null;

  const read = async (): Promise<Result<PositionSnapshot, OutcomeError>> => {
    if (!deps.config.ok) return err({ kind: "invalid_plan", detail: deps.config.reason });
    if (deps.readPosition)
      return deps
        .readPosition()
        .catch(() => err({ kind: "rpc_unavailable", detail: "Position read failed" }));
    const r = await readPosition(
      deps.rhea,
      { network: deps.network, lendingId: deps.config.value.lendingId },
      deps.accountId,
    ).catch(() => null);
    return r ?? err({ kind: "rpc_unavailable", detail: "Position read failed" });
  };

  const runner = createRepayRunner({
    signer: deps.signer,
    verify(card) {
      if (!deps.config.ok) return { ok: false, reason: deps.config.reason };
      if (!observed) return { ok: false, reason: "Prepare the card first." };
      return verifyCardPayload(card, {
        network: deps.config.value.network,
        session: { network: deps.network, accountId: deps.accountId },
        signerId: deps.signer?.accountId ?? deps.accountId,
        lendingId: deps.config.value.lendingId,
        feeRecipientId: deps.config.value.feeRecipientId,
        lendingVersion: observed.version,
        token: observed.token,
      });
    },
    readPosition: () => read(),
    stillMatches: (card, before) =>
      observed !== null && cardMatchesPosition(card, before, observed.token, now()),
    reader: deps.reader,
    health: (s, nowMs) => healthBps(s, nowMs),
    now,
  });

  const block = (cardId: string, reason: string) => publish({ phase: "blocked", cardId, reason });

  return {
    getSnapshot: () => view,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    status: (cardId: string) => runner.status(cardId),
    /** Reads version and position, verifies the card and shows the in-app confirmation. */
    async prepare(card: Card) {
      if (view.phase === "preparing" || view.phase === "signing") return;
      if (!deps.signer)
        return block(
          card.id,
          "This account cannot sign transactions. Connect with NEAR Connect to execute.",
        );
      if (!deps.config.ok) return block(card.id, deps.config.reason);
      if (deps.config.value.network !== deps.network)
        return block(card.id, "Your wallet is on a different network.");
      publish({ phase: "preparing", cardId: card.id });
      const version = await deps.rhea
        .view(deps.config.value.lendingId, "get_version", {})
        .catch(() => null);
      const lendingVersion = version?.ok ? parseLendingVersion(version.value.data) : null;
      if (!lendingVersion)
        return block(card.id, "The lending contract version could not be confirmed.");
      const snapshot = await read();
      if (!snapshot.ok) return block(card.id, "Your position could not be read. Try again.");
      const tokenId = card.payload[0]?.receiverId ?? "";
      const asset = snapshot.value.assets[tokenId];
      if (!asset || !snapshot.value.borrowed.some((b) => b.tokenId === tokenId))
        return block(card.id, "This card's token is not a debt in your position.");
      const token: Token = {
        id: tokenId,
        symbol: asset.token.symbol,
        decimals: asset.token.decimals,
        extraDecimals: asset.token.extraDecimals,
      };
      observed = { version: lendingVersion, token };
      if (!cardMatchesPosition(card, snapshot.value, token, now()))
        return block(card.id, "Your position changed since this card. Ask for a new one.");
      const verified = runner.prepare(card);
      if (!verified.ok) return block(card.id, verified.reason);
      publish({
        phase: "confirm",
        cardId: card.id,
        confirmation: confirmationOf(verified.value, token),
      });
    },
    cancel() {
      if (view.phase === "confirm" || view.phase === "blocked") publish({ phase: "idle" });
    },
    /** The single wallet request for this card (E3). */
    async confirm(card: Card, signal: AbortSignal) {
      if (view.phase !== "confirm" || view.cardId !== card.id || !observed) return;
      const token = observed.token;
      publish({ phase: "signing", cardId: card.id });
      const result = await runner.execute(card, signal);
      publish({ phase: "result", cardId: card.id, result, token });
    },
    /** Explicit "Check again" for a pending receipt; no polling loop. */
    async check(cardId: string, signal: AbortSignal) {
      if (view.phase !== "result" || view.cardId !== cardId) return;
      const token = view.token;
      publish({ phase: "result", cardId, result: await runner.check(cardId, signal), token });
    },
  };
}

export type LiveRepay = ReturnType<typeof createLiveRepay>;
