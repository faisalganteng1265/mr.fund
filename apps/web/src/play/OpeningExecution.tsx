"use client";
import { decimalString } from "@mrfund/shared";
import { useRef } from "react";
import { publicExecutionConfig } from "../execution/config";
import type { LiveOpening, OpeningTokens, OpeningView } from "../execution/open-position-live";
import { decodeWireCard } from "../execution/wire";

const button = "rounded-full border border-white/10 px-4 py-2 text-xs font-semibold";
const primary = `${button} border-0 bg-[#bad7c3] text-[#203327]`;
const STAGE_NAME = { deposit: "deposit", borrow: "borrow" } as const;

/**
 * Execute, in-app confirmation and observed result for one opening card (deposit or borrow,
 * `add-chat-open-position` 5.2). Nothing here decides an outcome: every state shown after the
 * wallet comes from the runner's reconciliation, and explorer links appear only once the chain
 * evidence was read. Adjusting means asking for a new card; the card itself never changes.
 */
export function OpeningExecution({
  card: wire,
  store,
  view,
  onSettled,
}: {
  card: unknown;
  store: LiveOpening | null;
  view: OpeningView;
  onSettled: () => void;
}) {
  const controller = useRef<AbortController | null>(null);
  const card = decodeWireCard(wire);
  if (!card) return null;
  if (card.action !== "wallet_collateral_deposit" && card.action !== "wallet_borrow") return null;
  if (!store)
    return <p className="text-xs text-[#a2a4a5]">Execution is unavailable for this session.</p>;
  const mine = view.phase !== "idle" && view.cardId === card.id;
  const signal = () => {
    controller.current?.abort();
    controller.current = new AbortController();
    return controller.current.signal;
  };

  if (!mine)
    return (
      <button
        type="button"
        className={primary}
        disabled={store.status(card.id) !== "idle"}
        onClick={() => void store.prepare(card, signal())}
      >
        Review and execute
      </button>
    );
  if (view.phase === "preparing") return <p role="status">Checking your position and this card…</p>;
  if (view.phase === "blocked")
    return (
      <div className="space-y-2">
        <p role="alert">{view.reason}</p>
        <button type="button" className={button} onClick={() => store.cancel()}>
          Close
        </button>
      </div>
    );
  if (view.phase === "confirm") {
    const c = view.confirmation;
    return (
      <section
        aria-label={`Confirm ${STAGE_NAME[c.stage]}`}
        className="space-y-2 rounded-xl border border-white/10 p-3"
      >
        <h4 className="text-sm font-semibold">Confirm in your wallet next</h4>
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
          <dt>{c.stage === "deposit" ? "Deposit" : "Borrow"}</dt>
          <dd>
            {c.amount} {c.stage === "deposit" ? "into" : "from"} {c.lendingId}
          </dd>
          {c.fee && (
            <>
              <dt>Fee</dt>
              <dd>
                {c.fee.amount} to {c.fee.recipientId}
              </dd>
            </>
          )}
          {c.registrations.map((r) => (
            <div key={r.receiverId} className="contents">
              <dt>Registration</dt>
              <dd>
                {r.near} to register with {r.receiverId}
              </dd>
            </div>
          ))}
          {c.lines.map((l) => (
            <div key={l.label} className="contents">
              <dt>{l.label}</dt>
              <dd>{l.value}</dd>
            </div>
          ))}
          <dt>Network</dt>
          <dd>{c.network}</dd>
          <dt>Account</dt>
          <dd>{c.accountId}</dd>
        </dl>
        {c.risks.length > 0 && (
          <ul className="list-disc pl-4 text-xs text-[#a2a4a5]">
            {c.risks.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        )}
        <p className="text-xs text-[#a2a4a5]">
          Your wallet shows its own review. Numbers are estimates from the last read. To change the
          amount or target, adjust and ask for a new card.
        </p>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={button} onClick={() => store.cancel()}>
            Adjust
          </button>
          <button
            type="button"
            className={primary}
            onClick={() => void store.confirm(card, signal()).then(onSettled)}
          >
            Open wallet
          </button>
        </div>
      </section>
    );
  }
  if (view.phase === "signing") return <p role="status">Waiting for your wallet…</p>;
  return (
    <ResultView view={view} onCheck={() => void store.check(card, signal()).then(onSettled)} />
  );
}

const STATE_COPY = {
  submitted: "Sent. The result is not observed yet.",
  confirmed: "Confirmed from the chain.",
  partial: "Partly applied. See what was observed below.",
  failed: "The chain reported a failure.",
  unresolved: "Not confirmed. I could not observe the result yet.",
} as const;

function ResultView({
  view,
  onCheck,
}: {
  view: Extract<OpeningView, { phase: "result" }>;
  onCheck: () => void;
}) {
  const { run, tokens, summary } = view;
  const internal = (v: bigint, t: OpeningTokens["collateral"]) =>
    `${decimalString(v, t.decimals + t.extraDecimals)} ${t.symbol}`;
  if (run.kind === "blocked" || run.kind === "unknown") return <p role="alert">{run.reason}</p>;
  if (run.kind === "nothing_observed")
    return (
      <p role="status">
        Your wallet reported an error and your position did not change. Nothing was sent that I can
        see. Ask for a new card to try again.
      </p>
    );
  if (run.kind === "observed_change")
    return (
      <p role="status">
        Your wallet reported an error, but your position changed: collateral{" "}
        {internal(run.collateralBeforeInternal, tokens.collateral)} to{" "}
        {internal(run.collateralAfterInternal, tokens.collateral)}, debt{" "}
        {internal(run.debtBeforeInternal, tokens.debt)} to{" "}
        {internal(run.debtAfterInternal, tokens.debt)}. This is an observed change, not a
        confirmation.
      </p>
    );
  const r = run.result;
  const o = r.observed;
  const config = publicExecutionConfig();
  const pending = r.state === "submitted" || r.state === "unresolved";
  return (
    <section aria-label="Opening result" className="space-y-2 text-xs" role="status">
      <p className="text-sm font-semibold">{STATE_COPY[r.state]}</p>
      {summary && <p>{summary.headline}</p>}
      {o && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
          <dt>Collateral</dt>
          <dd>
            {internal(o.collateralBefore, tokens.collateral)} →{" "}
            {internal(o.collateralAfter, tokens.collateral)}
          </dd>
          <dt>Debt</dt>
          <dd>
            {internal(o.debtBefore, tokens.debt)} → {internal(o.debtAfter, tokens.debt)}
          </dd>
          {typeof o.healthAfter === "number" && (
            <>
              <dt>Health (observed)</dt>
              <dd>{decimalString(BigInt(o.healthAfter), 2)}%</dd>
            </>
          )}
          <dt>Observed at</dt>
          <dd>{new Date(o.readAtMs).toISOString()}</dd>
        </dl>
      )}
      {pending ? (
        <button type="button" className={button} onClick={onCheck}>
          Check again
        </button>
      ) : (
        config.ok &&
        r.txHashes.map((hash) => (
          <a
            key={hash}
            href={`${config.value.explorerTxBase}${hash}`}
            target="_blank"
            rel="noreferrer"
            className="block break-all underline"
          >
            View transaction {hash.slice(0, 8)}…
          </a>
        ))
      )}
    </section>
  );
}
