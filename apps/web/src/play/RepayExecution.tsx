"use client";
import { decimalString } from "@mrfund/shared";
import { useRef } from "react";
import { publicExecutionConfig } from "../execution/config";
import type { LiveRepay, RepayView } from "../execution/live";
import type { RunResult } from "../execution/run";
import { decodeWireCard } from "../execution/wire";

const button = "rounded-full border border-white/10 px-4 py-2 text-xs font-semibold";
const primary = `${button} border-0 bg-[#bad7c3] text-[#203327]`;

/**
 * Execute, in-app confirmation and receipt for one live repay card (tasks 3.1, 3.2). Nothing
 * here decides an outcome: the receipt is what the runner observed. Explorer links appear only
 * once the outcome reader returned evidence (status other than `submitted`).
 */
export function RepayExecution({
  card: wire,
  store,
  view,
  onSettled,
}: {
  card: unknown;
  store: LiveRepay | null;
  view: RepayView;
  onSettled: () => void;
}) {
  const controller = useRef<AbortController | null>(null);
  const card = decodeWireCard(wire);
  if (!card)
    return (
      <p role="alert" className="text-xs">
        This card could not be read for execution.
      </p>
    );
  if (card.action !== "repay") return null;
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
        onClick={() => void store.prepare(card)}
      >
        Execute now
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
        aria-label="Confirm repay"
        className="space-y-2 rounded-xl border border-white/10 p-3"
      >
        <h4 className="text-sm font-semibold">Confirm in your wallet next</h4>
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs [&_dd]:min-w-0 [&_dd]:[overflow-wrap:anywhere]">
          <dt>Repay</dt>
          <dd>
            {c.amount} to {c.lendingId}
          </dd>
          {c.fee && (
            <>
              <dt>Fee</dt>
              <dd>
                {c.fee.amount} to {c.fee.recipientId}
              </dd>
            </>
          )}
          {c.registrationNear && (
            <>
              <dt>Registration</dt>
              <dd>{c.registrationNear} to register the fee recipient with the token</dd>
            </>
          )}
          <dt>Network</dt>
          <dd>{c.network}</dd>
          <dt>Account</dt>
          <dd>{c.accountId}</dd>
        </dl>
        <p className="text-xs text-[#a2a4a5]">
          Your wallet shows its own review. Repaying lowers liquidation risk; it does not remove it.
        </p>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={button} onClick={() => store.cancel()}>
            Cancel
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
    <ResultView
      result={view.result}
      token={view.token}
      onCheck={() => void store.check(card.id, signal()).then(onSettled)}
    />
  );
}

const STATUS_COPY = {
  submitted: "Sent. The result is not observed yet.",
  confirmed: "Repay confirmed from the chain.",
  partial: "Partly applied. See what was observed below.",
  failed: "The repay failed on the chain.",
} as const;

function ResultView({
  result,
  token,
  onCheck,
}: {
  result: RunResult;
  token: { decimals: number; extraDecimals: number; symbol: string };
  onCheck: () => void;
}) {
  const internal = (v: string | bigint) =>
    `${decimalString(BigInt(v), token.decimals + token.extraDecimals)} ${token.symbol}`;
  if (result.kind === "blocked") return <p role="alert">{result.reason}</p>;
  if (result.kind === "unknown") return <p role="alert">{result.reason}</p>;
  if (result.kind === "nothing_observed")
    return (
      <p role="status">
        Your wallet reported an error and your debt did not change. Nothing was sent that I can see.
        Ask for a new card to try again.
      </p>
    );
  if (result.kind === "observed_change")
    return (
      <p role="status">
        Your wallet reported an error, but your debt changed from{" "}
        {internal(result.debtBeforeInternal)} to {internal(result.debtAfterInternal)}. This is an
        observed change, not a confirmation.
      </p>
    );
  const r = result.receipt;
  const config = publicExecutionConfig();
  const o = r.observed;
  return (
    <section aria-label="Repay receipt" className="space-y-2 text-xs" role="status">
      <p className="text-sm font-semibold">{STATUS_COPY[r.status]}</p>
      {o && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 [&_dd]:min-w-0 [&_dd]:[overflow-wrap:anywhere]">
          <dt>Debt before</dt>
          <dd>{internal(o.debtBeforeInternal ?? "0")}</dd>
          <dt>Debt after</dt>
          <dd>{internal(o.debtAfterInternal ?? "0")}</dd>
          {o.healthBeforeBps && o.healthAfterBps && (
            <>
              <dt>Health</dt>
              <dd>
                {decimalString(BigInt(o.healthBeforeBps), 2)}% →{" "}
                {decimalString(BigInt(o.healthAfterBps), 2)}% (observed)
              </dd>
            </>
          )}
          <dt>Observed at</dt>
          <dd>{new Date(r.atMs).toISOString()}</dd>
        </dl>
      )}
      {r.status === "submitted" ? (
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
