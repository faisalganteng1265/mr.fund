"use client";

import { type ReactNode, useLayoutEffect, useRef } from "react";

type Rect = { left: number; top: number; width: number; height: number };
const same = (a: Rect | null, b: Rect) =>
  !!a &&
  Math.abs(a.left - b.left) < 1 &&
  Math.abs(a.top - b.top) < 1 &&
  Math.abs(a.width - b.width) < 1 &&
  Math.abs(a.height - b.height) < 1;

/** One persistent scene: full-screen welcome, then the character column after Start. */
export function ImmersiveSceneFrame({
  immersive,
  transparent = false,
  children,
}: {
  immersive: boolean;
  transparent?: boolean;
  children?: ReactNode;
}) {
  const anchor = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const previousMode = useRef(immersive);
  const lastTarget = useRef<Rect | null>(null);
  useLayoutEffect(() => {
    const element = frame.current,
      slot = anchor.current;
    if (!element || !slot) return;
    let animation: Animation | null = null;
    const modeChanged = previousMode.current !== immersive;
    previousMode.current = immersive;
    const update = (animate: boolean) => {
      const bounds = slot.getBoundingClientRect();
      const next: Rect = immersive
        ? { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight }
        : { left: bounds.left, top: bounds.top, width: bounds.width, height: bounds.height };
      if (next.width < 2 || next.height < 2 || same(lastTarget.current, next)) return;
      const from = element.getBoundingClientRect();
      animation?.cancel();
      lastTarget.current = next;
      Object.assign(element.style, {
        left: `${next.left}px`,
        top: `${next.top}px`,
        width: `${next.width}px`,
        height: `${next.height}px`,
        borderRadius: immersive ? "0px" : "28px",
      });
      if (
        animate &&
        typeof element.animate === "function" &&
        !window.matchMedia("(prefers-reduced-motion: reduce)").matches
      ) {
        animation = element.animate(
          [
            {
              left: `${from.left}px`,
              top: `${from.top}px`,
              width: `${from.width}px`,
              height: `${from.height}px`,
              borderRadius: "0px",
            },
            {
              left: `${next.left}px`,
              top: `${next.top}px`,
              width: `${next.width}px`,
              height: `${next.height}px`,
              borderRadius: immersive ? "0px" : "28px",
            },
          ],
          { duration: 1450, easing: "cubic-bezier(.65,0,.35,1)" },
        );
      }
    };
    update(modeChanged);
    const observer = new ResizeObserver(() => update(false));
    observer.observe(slot);
    const resize = () => update(false);
    window.addEventListener("resize", resize);
    return () => {
      animation?.cancel();
      observer.disconnect();
      window.removeEventListener("resize", resize);
    };
  }, [immersive]);
  return (
    <div ref={anchor} className="absolute inset-0">
      <div
        ref={frame}
        className={`fixed z-0 overflow-hidden ${transparent ? "bg-transparent" : "bg-[#101314]"}`}
        style={{ left: 0, top: 0, width: "100vw", height: "100dvh" }}
      >
        {children}
      </div>
    </div>
  );
}
