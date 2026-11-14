import { ArrowUpRight, LoaderCircle, Mic, MoreHorizontal } from "lucide-react";
import type { FormEvent } from "react";
import { chatComposerClass, chatInputClass, chatSendClass } from "./chatAppearance";
import type { Panel } from "./useConsultation";

interface Props {
  input: string;
  thinking: boolean;
  streamingId: number | null;
  setInput: (text: string) => void;
  sendMessage: (text: string) => void;
  setComposerFocused: (focused: boolean) => void;
  setKeyboardHeight: (height: number | null) => void;
  clearConversation: () => void;
  openPanel: (panel: Panel | null) => void;
  maxLength?: number;
  allowDuringThinking?: boolean;
  disabled?: boolean;
}
export function ChatComposer({
  input,
  thinking,
  streamingId,
  setInput,
  sendMessage,
  setComposerFocused,
  setKeyboardHeight,
  clearConversation,
  openPanel,
  maxLength = 500,
  allowDuringThinking = false,
  disabled = false,
}: Props) {
  return (
    <form
      className={chatComposerClass}
      onSubmit={(event: FormEvent) => {
        event.preventDefault();
        sendMessage(input);
      }}
    >
      <textarea
        rows={1}
        onFocus={() => setComposerFocused(true)}
        onBlur={() => {
          setComposerFocused(false);
          setKeyboardHeight(null);
        }}
        className={chatInputClass}
        aria-label="Message Mr.Fund"
        placeholder="Write a message…"
        value={input}
        maxLength={maxLength}
        onChange={(event) => setInput(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault();
            if (
              input.trim() &&
              !disabled &&
              (allowDuringThinking || (!thinking && streamingId === null))
            )
              event.currentTarget.form?.requestSubmit();
          }
        }}
        disabled={disabled || (thinking && !allowDuringThinking)}
      />
      <div className="flex shrink-0 items-center gap-0.5 pb-1 pr-1 sm:gap-1">
        <button
          type="button"
          aria-label="Clear conversation"
          title="Clear conversation"
          onClick={clearConversation}
          className="grid size-9 place-items-center rounded-full border-0 bg-transparent text-[#a2a4a5] transition-colors hover:bg-[#2b2d2e] hover:text-[#edf3f5]"
        >
          <MoreHorizontal size={17} />
        </button>
        <button
          type="button"
          aria-label="Open voice input"
          title="Voice input"
          onClick={() => openPanel("voice")}
          className="grid size-9 place-items-center rounded-full border-0 bg-transparent text-[#a2a4a5] transition-colors hover:bg-[#2b2d2e] hover:text-[#edf3f5]"
        >
          <Mic size={17} />
        </button>
        <button
          type="submit"
          aria-label="Send message"
          disabled={
            disabled ||
            !input.trim() ||
            (!allowDuringThinking && (thinking || streamingId !== null))
          }
          className={chatSendClass}
        >
          {thinking ? (
            <LoaderCircle size={17} className="animate-spin" />
          ) : (
            <ArrowUpRight size={20} />
          )}
        </button>
      </div>
    </form>
  );
}
