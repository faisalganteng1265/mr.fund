import { ArrowUpRight, Check } from "lucide-react";
import type { ComponentProps, RefObject } from "react";
import { ChatComposer } from "./ChatComposer";
import { ChatMessages } from "./ChatMessages";
import { RecommendationCard } from "./RecommendationCard";
import type { Receipt } from "./source/types";

type Props = ComponentProps<typeof ChatMessages> &
  ComponentProps<typeof RecommendationCard> &
  ComponentProps<typeof ChatComposer> & {
    phone: boolean;
    scrollRef: RefObject<HTMLDivElement | null>;
    cardOpen: boolean;
    lastRepay: Receipt | null;
    setSelectedReceipt: (receipt: Receipt | null) => void;
  };
export function ChatPanel({
  phone,
  scrollRef,
  thinking,
  messages,
  streamingId,
  whatIf,
  finishText,
  sendMessage,
  port,
  cardOpen,
  card,
  comp,
  repayAmount,
  adjusting,
  unavailable,
  setRepayAmount,
  setAdjusting,
  setCardOpen,
  executeCard,
  refresh,
  lastRepay,
  setSelectedReceipt,
  input,
  setInput,
  setComposerFocused,
  setKeyboardHeight,
  clearConversation,
  openPanel,
}: Props) {
  return (
    <section
      className={`chat-panel flex flex-1 min-h-0 flex-col px-4 text-[#edf3f5] sm:px-5 ${phone ? "bg-transparent" : "bg-[#121415] bg-[url(/play/chat-texture.svg)] bg-repeat"}`}
    >
      <div className="max-md:hidden shrink-0 pb-2 pt-5 text-center font-[family-name:var(--font-display)] text-sm font-semibold tracking-[-.4px] text-[#edf3f5]">
        mr.fund
      </div>
      <div
        className="chat-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain px-0.5 pb-2 pt-6 [scrollbar-width:thin] [scrollbar-color:#313334_transparent] sm:pt-8"
        ref={scrollRef}
        aria-live="polite"
        aria-busy={thinking}
      >
        <div className="flex min-h-full flex-col justify-end">
          <ChatMessages
            messages={messages}
            streamingId={streamingId}
            thinking={thinking}
            whatIf={whatIf}
            finishText={finishText}
            sendMessage={sendMessage}
            port={port}
          />
          {cardOpen && (
            <RecommendationCard
              card={card}
              comp={comp}
              repayAmount={repayAmount}
              adjusting={adjusting}
              unavailable={unavailable}
              setRepayAmount={setRepayAmount}
              setAdjusting={setAdjusting}
              setCardOpen={setCardOpen}
              executeCard={executeCard}
              refresh={refresh}
            />
          )}
          {lastRepay && (
            <button
              type="button"
              className="inline-receipt flex items-center text-left w-full [border:1px_solid_#313334] bg-[#1c1e1f] p-[14px_12px] gap-[10px] rounded-[9px] m-[10px_0] [&_b]:text-[11px] [&_b]:block [&_small]:text-[8px] [&_small]:text-[#a2a4a5] [&_small]:block [&_small]:mt-[4px] [&>svg]:ml-auto"
              onClick={() => setSelectedReceipt(lastRepay)}
            >
              <span className="receipt-check w-[32px] h-[32px] grid place-items-center bg-[var(--lime)] text-[#101a17]! rounded-full text-[#a2a4a5]">
                <Check size={20} />
              </span>
              <span>
                <b>{lastRepay.title}</b>
                <small>Demo receipt · Health {lastRepay.after}</small>
              </span>
              <ArrowUpRight size={18} />
            </button>
          )}
          {messages.length > 1 && !thinking && streamingId === null && (
            <div className="follow-up-prompts flex gap-[7px] flex-wrap mt-[14px] [&_button]:bg-transparent [&_button]:[border:1px_solid_#313334] [&_button]:rounded-[6px] [&_button]:p-[7px_8px] [&_button]:text-[8px] [&_button]:flex [&_button]:gap-[5px] [&_button]:items-center">
              <button type="button" onClick={() => sendMessage("What if NEAR drops 20%?")}>
                What if NEAR drops? <ArrowUpRight size={12} />
              </button>
              <button type="button" onClick={() => sendMessage("What are my Guardian limits?")}>
                My Guardian limits <ArrowUpRight size={12} />
              </button>
            </div>
          )}
        </div>
      </div>
      <ChatComposer
        input={input}
        thinking={thinking}
        streamingId={streamingId}
        setInput={setInput}
        sendMessage={sendMessage}
        setComposerFocused={setComposerFocused}
        setKeyboardHeight={setKeyboardHeight}
        clearConversation={clearConversation}
        openPanel={openPanel}
      />
    </section>
  );
}
