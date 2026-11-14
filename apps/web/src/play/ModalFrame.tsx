import { X } from "lucide-react";
import { type ReactNode, useEffect, useId, useRef } from "react";
import { playClasses } from "./styles";

export function ModalFrame({
  title,
  eyebrow,
  children,
  close,
  wide = false,
  wallet = false,
}: {
  title: string;
  eyebrow: string;
  children: ReactNode;
  close: () => void;
  wide?: boolean;
  wallet?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const el = ref.current;
    // The dialog unmounts with its focused control, so hand focus back to whatever opened it.
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    el?.showModal();
    return () => {
      el?.close();
      if (opener?.isConnected) opener.focus();
    };
  }, []);
  return (
    <dialog
      aria-labelledby={titleId}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          close();
        }
      }}
      ref={ref}
      className={playClasses(
        `play-modal ${wide ? "wide" : ""} ${wallet ? "w-[min(500px,calc(100vw_-_28px))]! rounded-[32px]! bg-[url(/play/chat-texture.svg)] bg-repeat" : ""}`,
      )}
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div
        className={`modal-inner ${wallet ? "relative overflow-hidden px-6 pb-6 pt-8 sm:px-8 sm:pb-7 sm:pt-10" : "p-[27px] max-[620px]:p-[23px_20px]"}`}
      >
        <div
          className={`modal-heading ${wallet ? "flex items-start justify-between gap-5 [&_.eyebrow]:text-[9px] [&_.eyebrow]:font-medium [&_.eyebrow]:text-[#929996] [&_h2]:mt-4 [&_h2]:whitespace-nowrap [&_h2]:font-[family-name:var(--font-display)] [&_h2]:text-[clamp(24px,7vw,38px)] [&_h2]:font-medium [&_h2]:leading-[1.04] [&_h2]:tracking-[-1.1px]" : "flex justify-between items-start gap-[10px] [&_.eyebrow]:text-[#a2a4a5] [&_.eyebrow]:text-[8px] [&_h2]:font-[family-name:var(--font-display)] [&_h2]:text-[30px] [&_h2]:font-medium [&_h2]:leading-[1.15] [&_h2]:tracking-[-1.2px] [&_h2]:mt-[7px] [&>.icon-button]:bg-[#1c1e1f] [&>.icon-button]:w-[30px] [&>.icon-button]:h-[30px] [&>.icon-button]:shrink-0 max-[620px]:[&_h2]:text-[27px] max-[620px]:[&_.eyebrow]:text-[7px]"}`}
        >
          <div>
            <span className="eyebrow text-[9px] font-extrabold tracking-[.15em] block leading-[1.5]">
              {eyebrow}
            </span>
            <h2 id={titleId}>{title}</h2>
          </div>
          <button
            type="button"
            className="icon-button inline-flex items-center justify-center border-0 bg-transparent w-[32px] h-[32px] rounded-full p-0 [transition:background_.18s] [&:hover]:bg-[#8080801a]"
            onClick={close}
            aria-label="Close dialog"
          >
            <X size={21} />
          </button>
        </div>
        {children}
      </div>
    </dialog>
  );
}
