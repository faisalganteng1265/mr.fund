import { type ReactNode, useEffect, useRef } from "react";
import type { useLiveOpening } from "../execution/useLiveOpening";
import type { useLiveRepay } from "../execution/useLiveRepay";
import { ChatComposer } from "./ChatComposer";
import { ChatRow, chatBubbleClass, ThinkingRow } from "./chatAppearance";
import { DataAgeLabel, LiveCard } from "./live/LiveCard";
import { liveGreeting, thinkingText } from "./live/liveCopy";
import { isSlow } from "./live/liveSlow";
import { liveSuggestions } from "./live/liveSuggestions";
import { RepayFocus } from "./live/RepayFocus";
import { RichText } from "./live/RichText";
import { SuggestionChips } from "./live/SuggestionChips";
import { OpeningExecution } from "./OpeningExecution";
import { RepayExecution } from "./RepayExecution";
import { formatAtomic } from "./source/formatAtomic";
import type { useLiveConsultation } from "./useLiveConsultation";

type Live = ReturnType<typeof useLiveConsultation>;
export function LivePositionPanel({ live }: { live: Live }) {
  const data = live.state.status === "ready" ? live.state.position : null;
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5 pt-5">
      <section className="rounded-[24px] border border-[#e4d7ba1a] bg-[#1f2122] p-5">
        <div className="flex items-center justify-between">
          <span>Position health</span>
          <button
            type="button"
            onClick={live.refresh}
            className="rounded-full border border-white/10 px-3 py-2"
          >
            Refresh
          </button>
        </div>
        {live.state.status === "loading" && <p role="status">Loading position…</p>}
        {live.state.status === "network_mismatch" && (
          <p role="alert">Wallet and server networks do not match. Chat is disabled.</p>
        )}
        {live.state.status === "empty" && <p>No lending position found for this account.</p>}
        {live.state.status === "stale" && <p>Position data is stale. Refresh before acting.</p>}
        {live.state.status === "unavailable" && (
          <p>Position data is unavailable. Try refreshing.</p>
        )}
        {data && (
          <>
            <strong className="mt-3 block text-4xl tabular-nums">
              {data.health.kind === "no_debt"
                ? "No debt"
                : `${(data.health.bps / 100).toFixed(2)}%`}
            </strong>
            <p className="mt-3">
              <DataAgeLabel ageMs={data.dataAgeMs} token={data} />
            </p>
          </>
        )}
      </section>
      {data &&
        (
          [
            ["Collateral", data.collateral],
            ["Debt", data.debt],
            ["Supplied", data.supplied],
          ] as const
        )
          .filter(([, items]) => items.length > 0)
          .map(([label, items]) => (
            <section key={label}>
              <h3 className="mb-3 mt-6 text-xs uppercase text-[#898b8c]">{label}</h3>
              {items.map((item) => (
                <p
                  key={item.tokenId}
                  className="mb-2 rounded-full border border-white/10 bg-[#1e2123] p-4"
                >
                  {formatAtomic(item.atomic, item.decimals)} {item.symbol}
                </p>
              ))}
            </section>
          ))}
    </div>
  );
}

export function LiveChatPanel({
  live,
  repay,
  opening,
  phone,
  setComposerFocused,
  setKeyboardHeight,
  openPanel,
}: {
  live: Live;
  repay: ReturnType<typeof useLiveRepay>;
  opening: ReturnType<typeof useLiveOpening>;
  phone: boolean;
  setComposerFocused: (v: boolean) => void;
  setKeyboardHeight: (v: number | null) => void;
  openPanel: (v: "chat" | "voice" | "position" | "guardian" | "activity" | null) => void;
}) {
  const root = useRef<HTMLElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const slow = isSlow(live);
  // A chip unmounts when it is used; keyboard users get focus back in the composer, not on the page.
  const focusComposer = () => root.current?.querySelector<HTMLTextAreaElement>("textarea")?.focus();
  useEffect(() => {
    if (live.error) root.current?.querySelector<HTMLTextAreaElement>("textarea")?.focus();
  }, [live.error]);
  // Follow the newest line. Assigning scrollTop never animates, so reduced motion is respected.
  // biome-ignore lint/correctness/useExhaustiveDependencies: these values are the scroll triggers
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [live.messages.length, live.partial, live.busy, slow, live.error, live.card]);
  return (
    <section
      ref={root}
      className={`chat-panel flex min-h-0 flex-1 flex-col px-4 text-[#edf3f5] sm:px-5 ${phone ? "bg-transparent" : "bg-[#121415] bg-[url(/play/chat-texture.svg)] bg-repeat"}`}
    >
      <div className="max-md:hidden shrink-0 pb-2 pt-5 text-center font-[family-name:var(--font-display)] text-sm font-semibold tracking-[-.4px] text-[#edf3f5]">
        mr.fund
      </div>
      <div
        ref={scroller}
        className="chat-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain px-0.5 pb-2 pt-6 [scrollbar-width:thin] [scrollbar-color:#313334_transparent] sm:pt-8"
        aria-live="polite"
        aria-busy={live.busy}
      >
        <div className="flex min-h-full flex-col justify-end">
          <AssistantBubble>
            <p>{liveGreeting(live.state.status)}</p>
          </AssistantBubble>
          {live.messages.map((message) =>
            message.role === "user" ? (
              <ChatRow key={message.id} speaker="user">
                <div className={chatBubbleClass("user")}>
                  <span className="sr-only">YOU</span>
                  <p>{message.content}</p>
                </div>
              </ChatRow>
            ) : (
              <AssistantBubble key={message.id}>
                <RichText text={message.content} />
              </AssistantBubble>
            ),
          )}
          {live.partial && (
            <AssistantBubble>
              <RichText text={live.partial} />
            </AssistantBubble>
          )}
          {live.busy && !live.partial && (
            <ThinkingRow>
              <span className="ml-2 text-xs text-[#a2a4a5]">
                {thinkingText(live.progress, slow)}
              </span>
            </ThinkingRow>
          )}
          {live.error && (
            <AssistantBubble>
              <p role="alert">{live.error}</p>
              {live.input.trim() && (
                <button
                  type="button"
                  onClick={() => void live.send(live.input)}
                  className="mt-3 rounded-full border border-[#313334] bg-transparent px-3.5 py-2 text-[11px] font-medium text-[#edf3f5] transition-colors hover:bg-[#2b2d2e]"
                >
                  Retry
                </button>
              )}
            </AssistantBubble>
          )}
          {live.card && (
            <LiveCard
              card={live.card}
              position={live.state.status === "ready" ? live.state.position : null}
            >
              <RepayFocus phase={repay.view.phase}>
                <RepayExecution
                  card={live.card}
                  store={repay.store}
                  view={repay.view}
                  onSettled={live.refresh}
                />
              </RepayFocus>
              <RepayFocus phase={opening.view.phase}>
                <OpeningExecution
                  card={live.card}
                  store={opening.store}
                  view={opening.view}
                  onSettled={live.refresh}
                />
              </RepayFocus>
              {live.state.status === "stale" && (
                <button type="button" onClick={live.refresh}>
                  Refresh position
                </button>
              )}
            </LiveCard>
          )}
          {!live.busy && (
            <SuggestionChips
              suggestions={liveSuggestions(live.state.status, Boolean(live.error))}
              onSend={(text, byKeyboard) => {
                void live.send(text);
                if (byKeyboard) focusComposer();
              }}
              onRefresh={(byKeyboard) => {
                live.refresh();
                if (byKeyboard) focusComposer();
              }}
            />
          )}
        </div>
      </div>
      <ChatComposer
        input={live.input}
        thinking={live.busy}
        disabled={live.state.status === "loading" || live.state.status === "network_mismatch"}
        allowDuringThinking
        maxLength={4000}
        streamingId={null}
        setInput={live.setInput}
        sendMessage={(text) => {
          void live.send(text);
        }}
        setComposerFocused={setComposerFocused}
        setKeyboardHeight={setKeyboardHeight}
        clearConversation={live.clear}
        openPanel={openPanel}
      />
    </section>
  );
}

function AssistantBubble({ children }: { children: ReactNode }) {
  return (
    <ChatRow speaker="assistant">
      <div className={chatBubbleClass("assistant")}>
        <span className="sr-only">MR.FUND</span>
        {children}
      </div>
    </ChatRow>
  );
}
