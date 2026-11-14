import type { ReactNode } from "react";
export function chatBubbleClass(role: "assistant" | "user") {
  return `min-w-0 max-w-[92%] rounded-[22px] px-4 py-3 text-sm leading-[1.7] [overflow-wrap:anywhere] [&_p]:whitespace-pre-wrap [&_p]:font-normal [&_p]:leading-[1.7] ${role === "user" ? "rounded-br-[6px] bg-[#bad7c3] text-[#203327]" : "rounded-bl-[6px] bg-[#1f2122] text-[#d6d8d9]"}`;
}
export const chatComposerClass =
  "chat-composer mb-4 mt-3 flex shrink-0 items-end gap-1 rounded-[28px] border border-white/8 bg-[#1f2122] p-1.5 transition-colors focus-within:border-[#e4d7ba4d]";
export const chatInputClass =
  "block field-sizing-content min-h-11 max-h-32 min-w-0 flex-1 resize-none border-0 bg-transparent px-3 py-3 font-[family-name:var(--font-body)] text-base leading-5 text-[#eeeef3] outline-none! placeholder:text-[#757778] sm:text-sm";
export const chatSendClass =
  "grid size-9 place-items-center rounded-full border-0 bg-[#e4d7ba] text-[#26352a] transition-colors hover:bg-[#eee6d3] disabled:bg-[#323435] disabled:text-[#767879]";
export function ChatBrandAvatar({ className = "" }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`grid size-8 shrink-0 place-items-center rounded-full bg-[#e4d7ba] font-[family-name:var(--font-display)] text-lg font-bold leading-none tracking-[-1.5px] text-[#203327] ${className}`}
    >
      m.
    </span>
  );
}
function ChatAvatar() {
  return <ChatBrandAvatar className="max-md:hidden" />;
}
/** One chat line: the assistant gets the avatar, the user is right-aligned. Shared by demo and live. */
export function ChatRow({
  speaker,
  children,
}: {
  speaker: "assistant" | "user";
  children: ReactNode;
}) {
  return (
    <div
      className={`chat-message mb-5 flex items-end gap-2.5 ${speaker === "user" ? "justify-end pl-9 max-md:pl-28" : "pr-4 sm:pr-8 max-md:pl-[88px] max-md:pr-0"}`}
    >
      {speaker === "assistant" && <ChatAvatar />}
      {children}
    </div>
  );
}
/** Pulsing-dots bubble; `children` is the status text (hidden visually in the demo). */
export function ThinkingRow({ children }: { children: ReactNode }) {
  return (
    <div className="mb-5 flex items-end gap-2.5 max-md:pl-[88px]" role="status">
      <ChatAvatar />
      <div className="flex items-center gap-1.5 rounded-[22px] rounded-bl-[6px] bg-[#1f2122] px-4 py-4">
        {[0, 150, 300].map((delay) => (
          <span
            key={delay}
            aria-hidden="true"
            className={`size-1.5 rounded-full bg-[#a2a4a5] motion-safe:animate-pulse ${delay === 150 ? "[animation-delay:150ms]" : delay === 300 ? "[animation-delay:300ms]" : ""}`}
          />
        ))}
        {children}
      </div>
    </div>
  );
}
export const promptGridClass =
  "prompt-grid mb-6 ml-[42px] max-md:ml-[88px] flex flex-wrap gap-2 [&_button]:inline-flex [&_button]:items-center [&_button]:gap-2 [&_button]:rounded-full [&_button]:border [&_button]:border-[#313334] [&_button]:bg-transparent [&_button]:px-3.5 [&_button]:py-2.5 [&_button]:text-left [&_button]:text-[11px] [&_button]:font-medium [&_button]:text-[#a2a4a5] [&_button]:transition-colors [&_button:hover]:bg-[#1f2122] [&_button:hover]:text-[#edf3f5]";
