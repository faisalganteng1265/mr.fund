"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";

/** Local text updates keep the Three.js portrait out of the per-character React render loop. */
export function ReplyText({
  id,
  text,
  streaming,
  onComplete,
}: {
  id: number;
  text: string;
  streaming: boolean;
  onComplete: (id: number) => void;
}) {
  const [visible, setVisible] = useState(streaming ? 0 : Array.from(text).length);
  const characters = Array.from(text);
  const paragraph = useRef<HTMLParagraphElement>(null);
  const following = useRef(true);
  useEffect(() => {
    if (!streaming) return;
    following.current = true;
    const scroller = paragraph.current?.closest<HTMLElement>(".chat-scroll");
    const track = () => {
      if (scroller)
        following.current = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 48;
    };
    scroller?.addEventListener("scroll", track, { passive: true });
    return () => scroller?.removeEventListener("scroll", track);
  }, [streaming]);
  useLayoutEffect(() => {
    if (!streaming || !following.current || visible === 0) return;
    const scroller = paragraph.current?.closest<HTMLElement>(".chat-scroll");
    if (scroller) scroller.scrollTop = scroller.scrollHeight;
  }, [visible, streaming]);
  useEffect(() => {
    if (!streaming) return;
    if (
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      setVisible(Array.from(text).length);
      onComplete(id);
      return;
    }
    let count = 0;
    let timer: ReturnType<typeof setTimeout>;
    const length = Array.from(text).length;
    setVisible(0);
    const tick = () => {
      count = Math.min(length, count + 2);
      setVisible(count);
      if (count === length) onComplete(id);
      else timer = setTimeout(tick, 36);
    };
    timer = setTimeout(tick, 36);
    return () => clearTimeout(timer);
  }, [streaming, text, id, onComplete]);
  return (
    <p ref={paragraph}>
      <span aria-hidden={streaming ? true : undefined} data-testid={`reply-visible-${id}`}>
        {streaming ? characters.slice(0, visible).join("") : text}
      </span>
      {streaming && (
        <>
          <span
            aria-hidden="true"
            className="ml-0.5 inline-block h-[1em] w-[2px] translate-y-0.5 bg-[#bad7c3] motion-safe:animate-pulse"
          />
          <span className="sr-only">{text}</span>
        </>
      )}
    </p>
  );
}
