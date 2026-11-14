/**
 * Browser composition of the plain-wallet opening flow (`add-chat-open-position` 5.2): it feeds
 * `createOpeningRunner` with a fresh block-pinned context, the session expectation and the public
 * outcome reader, and turns the runner's answers into one view for the card. The flow per card is
 * `prepare (read + verify + match) → in-app confirmation → wallet → observed result`.
 *
 * Permission boundary: only a NEAR Connect session has a signer; the runner signs only what
 * `verifyOpeningPayload` accepted, once per card, and a card never unlocks after the wallet was
 * asked. Deposit and borrow are separate cards; a borrow is only ever prepared against collateral
 * that a fresh read shows Rhea already holds (the runner's match check), never one still pending.
 * Does not guarantee: that the wallet shows the transaction faithfully, delivery of tokens, or
 * that the position still matches when the wallet confirms; `confirmed` comes only from the
 * reconciler's observation.
 */
import {
  type AdapterError,
  type OpeningOutcomeReader,
  type OpeningResult,
  type OpenPositionContext,
  type RheaClient,
  readOpenPositionContext,
} from "@mrfund/rhea";
import { type Card, decimalString, err, type Result } from "@mrfund/shared";
import type { ExecutionConfig } from "./config";
import {
  createOpeningRunner,
  type OpeningFlowSummary,
  type OpeningRunResult,
  openingFlowSummary,
} from "./open-position-run";
import type { OpeningExpectation } from "./open-position-verify";
import type { TransactionSigner } from "./signer";

export interface OpeningPair {
  collateralTokenId: string;
  debtTokenId: string;
}

export interface OpeningTokens {
  collateral: { symbol: string; decimals: number; extraDecimals: number };
  debt: { symbol: string; decimals: number; extraDecimals: number };
}

export interface OpeningConfirmation {
  stage: "deposit" | "borrow";
  /** Principal or deposit, in the stage token. */
  amount: string;
  fee: { amount: string; recipientId: string } | null;
  /** NEAR attached to register an account with a contract, per registration. */
  registrations: { receiverId: string; near: string }[];
  /** The card's own numbers, shown again so the approval reads them next to the amount. */
  lines: { label: string; value: string }[];
  risks: string[];
  lendingId: string;
  network: string;
  accountId: string;
}

export type OpeningView =
  | { phase: "idle" }
  | { phase: "preparing"; cardId: string }
  | { phase: "blocked"; cardId: string; reason: string }
  | { phase: "confirm"; cardId: string; confirmation: OpeningConfirmation }
  | { phase: "signing"; cardId: string }
  | {
      phase: "result";
      cardId: string;
      run: OpeningRunResult;
      tokens: OpeningTokens;
      /** Null until this session has a deposit result; a borrow alone has no deposit to summarise. */
      summary: OpeningFlowSummary | null;
    };

export interface LiveOpeningDeps {
  accountId: string;
  network: "testnet" | "mainnet";
  /** Public execution configuration plus the token pair, or the reason either is missing. */
  config: { ok: true; value: ExecutionConfig & OpeningPair } | { ok: false; reason: string };
  rhea: RheaClient;
  reader: OpeningOutcomeReader;
  signer: TransactionSigner | null;
  /** Injected in tests; defaults to `readOpenPositionContext` through `rhea`. */
  readContext?: (signal: AbortSignal) => Promise<Result<OpenPositionContext, AdapterError>>;
  now?: () => number;
}

const STAGE = {
  wallet_collateral_deposit: "deposit",
  wallet_borrow: "borrow",
} as const;

const sum = (lines: { tokenId: string; internal: bigint }[], id: string) =>
  lines.reduce((s, l) => (l.tokenId === id ? s + l.internal : s), 0n);

export function createLiveOpening(deps: LiveOpeningDeps) {
  const now = deps.now ?? Date.now;
  let view: OpeningView = { phase: "idle" };
  const listeners = new Set<() => void>();
  const publish = (next: OpeningView) => {
    view = next;
    for (const l of listeners) l();
  };
  /** The most recent successful read; the source of token scales and the expectation. */
  let lastContext: OpenPositionContext | null = null;
  const results: { deposit: OpeningResult | null; borrow: OpeningResult | null } = {
    deposit: null,
    borrow: null,
  };

  const readContext = async (
    signal: AbortSignal,
  ): Promise<Result<OpenPositionContext, AdapterError>> => {
    if (!deps.config.ok) return err({ kind: "bad_response", detail: deps.config.reason });
    const cfg = deps.config.value;
    const read = deps.readContext
      ? await deps.readContext(signal).catch(() => null)
      : await readOpenPositionContext(
          deps.rhea,
          { network: deps.network, lendingId: cfg.lendingId },
          deps.accountId,
          { collateralTokenId: cfg.collateralTokenId, debtTokenId: cfg.debtTokenId },
        ).catch(() => null);
    if (!read) return err({ kind: "rpc_unavailable", detail: "Position read failed" });
    if (read.ok) lastContext = read.value;
    return read;
  };

  const expectationOf = (ctx: OpenPositionContext): OpeningExpectation => {
    // Only called by the runner after `readContext` succeeded, so the config is present.
    const cfg = deps.config.ok ? deps.config.value : null;
    const meta = (id: string) => {
      const t = ctx.snapshot.assets[id]?.token;
      return {
        id,
        symbol: t?.symbol ?? "",
        decimals: t?.decimals ?? 0,
        extraDecimals: t?.extraDecimals ?? 0,
      };
    };
    return {
      network: cfg?.network ?? deps.network,
      session: { network: deps.network, accountId: deps.accountId },
      signerId: deps.signer?.accountId ?? deps.accountId,
      lendingId: ctx.snapshot.lendingId,
      feeRecipientId: cfg?.feeRecipientId ?? "",
      lendingVersion: ctx.lendingVersion,
      collateral: meta(ctx.collateralTokenId),
      debt: meta(ctx.debtTokenId),
      supplied: {
        collateral: sum(ctx.snapshot.supplied, ctx.collateralTokenId),
        debt: sum(ctx.snapshot.supplied, ctx.debtTokenId),
      },
      registrations: {
        lending: ctx.registrations.lending,
        debtToken: ctx.registrations.debtToken,
      },
    };
  };

  const runner = createOpeningRunner({
    signer: deps.signer,
    readContext,
    expectationOf,
    reader: deps.reader,
    now,
  });

  const tokensOf = (): OpeningTokens | null => {
    const c = lastContext;
    const collateral = c?.snapshot.assets[c.collateralTokenId]?.token;
    const debt = c?.snapshot.assets[c.debtTokenId]?.token;
    return collateral && debt ? { collateral, debt } : null;
  };

  const block = (cardId: string, reason: string) => publish({ phase: "blocked", cardId, reason });

  /** Publishes a runner answer and remembers a stage result for the flow summary. */
  const settle = (card: Card, run: OpeningRunResult) => {
    const stage = STAGE[card.action as keyof typeof STAGE];
    if (run.kind === "result" && stage) results[stage] = run.result;
    const tokens = tokensOf();
    if (!tokens) return block(card.id, "Your position could not be read. Try again.");
    publish({
      phase: "result",
      cardId: card.id,
      run,
      tokens,
      summary: results.deposit ? openingFlowSummary(results.deposit, results.borrow) : null,
    });
  };

  return {
    getSnapshot: () => view,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    status: (cardId: string) => runner.status(cardId),
    /** Reads and verifies the card against a fresh position and shows the in-app confirmation. */
    async prepare(card: Card, signal: AbortSignal) {
      if (view.phase === "preparing" || view.phase === "signing") return;
      if (!(card.action in STAGE)) return block(card.id, "This card is not an opening step.");
      if (!deps.signer)
        return block(
          card.id,
          "This account cannot sign transactions. Connect with NEAR Connect to execute.",
        );
      if (!deps.config.ok) return block(card.id, deps.config.reason);
      if (deps.config.value.network !== deps.network)
        return block(card.id, "Your wallet is on a different network.");
      publish({ phase: "preparing", cardId: card.id });
      const prepared = await runner.prepare(card, signal);
      const tokens = tokensOf();
      if (!prepared.ok) return block(card.id, prepared.reason);
      if (!tokens) return block(card.id, "Your position could not be read. Try again.");
      const v = prepared.verified;
      const token = v.stage === "wallet_borrow" ? tokens.debt : tokens.collateral;
      const unit = (amount: bigint, tokenId: string, decimals: number, symbol: string) =>
        `${decimalString(amount, decimals)} ${tokenId === v.tokenId ? symbol : tokenId}`;
      publish({
        phase: "confirm",
        cardId: card.id,
        confirmation: {
          stage: STAGE[v.stage],
          amount: unit(v.amount, v.tokenId, token.decimals, token.symbol),
          fee: v.fee
            ? {
                amount: unit(v.fee.amount, v.fee.tokenId, token.decimals, token.symbol),
                recipientId: v.fee.recipientId,
              }
            : null,
          registrations: v.transactions
            .filter((t) => t.methodName === "storage_deposit" && t.deposit > 0n)
            .map((t) => ({
              receiverId: t.receiverId,
              near: `${decimalString(t.deposit, 24)} NEAR`,
            })),
          lines: card.numbers.map((n) => ({
            label: n.label,
            value:
              `${n.before !== undefined && n.after !== undefined ? `${n.before} → ${n.after}` : (n.after ?? n.before ?? "")} ${n.unit}`.trim(),
          })),
          risks: card.risks,
          lendingId: v.lendingId,
          network: v.network,
          accountId: v.signerId,
        },
      });
    },
    cancel() {
      if (view.phase === "confirm" || view.phase === "blocked") publish({ phase: "idle" });
    },
    /** The single wallet request for this card. */
    async confirm(card: Card, signal: AbortSignal) {
      if (view.phase !== "confirm" || view.cardId !== card.id) return;
      publish({ phase: "signing", cardId: card.id });
      settle(card, await runner.execute(card, signal));
    },
    /** Explicit "Check again" for a pending receipt; no polling loop, no resend. */
    async check(card: Card, signal: AbortSignal) {
      if (view.phase !== "result" || view.cardId !== card.id) return;
      settle(card, await runner.check(card.id, signal));
    },
  };
}

export type LiveOpening = ReturnType<typeof createLiveOpening>;
