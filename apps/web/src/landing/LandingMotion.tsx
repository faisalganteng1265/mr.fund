"use client";

import { Pause, Play } from "lucide-react";
import {
  createContext,
  type ReactNode,
  type RefObject,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import { mountLandingMotion } from "./motionScene";

const MotionContext = createContext({ paused: false, reduced: false, toggle: () => {} });
export function useLandingMotion() {
  return useContext(MotionContext);
}

export function useVisible(ref: RefObject<HTMLElement | null>) {
  const [visible, setVisible] = useState(false);
  const [foreground, setForeground] = useState(true);
  useEffect(() => {
    const el = ref.current;
    const update = () => setForeground(!document.hidden);
    update();
    document.addEventListener("visibilitychange", update);
    const observer =
      typeof IntersectionObserver === "undefined"
        ? null
        : new IntersectionObserver(([entry]) => setVisible(entry?.isIntersecting ?? true), {
            rootMargin: "80px",
          });
    if (el) {
      if (observer) observer.observe(el);
      else setVisible(true);
    }
    return () => {
      observer?.disconnect();
      document.removeEventListener("visibilitychange", update);
    };
  }, [ref]);
  return visible && foreground;
}

export function MotionToggle() {
  const { paused, reduced, toggle } = useLandingMotion();
  return (
    <button
      type="button"
      onClick={toggle}
      disabled={reduced}
      aria-label={
        reduced
          ? "Reduced motion is enabled"
          : paused
            ? "Resume page animations"
            : "Pause page animations"
      }
      aria-pressed={paused || reduced}
      className="grid size-10 shrink-0 place-items-center rounded-full border border-solid border-white/15 bg-transparent text-[#b3bcb6] transition-colors hover:bg-white/5 focus-visible:outline-2 focus-visible:outline-[#d3e5d7] disabled:opacity-40"
    >
      {paused || reduced ? <Play size={15} /> : <Pause size={15} />}
    </button>
  );
}

export function LandingMotion({ children }: { children: ReactNode }) {
  const root = useRef<HTMLDivElement>(null);
  const progress = useRef<HTMLDivElement>(null);
  const [paused, setPaused] = useState(false);
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  useLayoutEffect(() => {
    if (
      !root.current ||
      paused ||
      reduced ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    )
      return;
    return mountLandingMotion(root.current, progress.current);
  }, [paused, reduced]);
  return (
    <MotionContext.Provider value={{ paused, reduced, toggle: () => setPaused((value) => !value) }}>
      <div
        ref={root}
        data-grid-origin
        className="overflow-x-clip bg-[#0e1110] bg-[url(/landing/grid.svg)] font-[family-name:var(--font-body)] text-[#eff1e9] antialiased [&_*]:box-border [&_button]:font-[family-name:inherit] [&_a]:no-underline motion-reduce:[&_*]:scroll-auto motion-reduce:[&_*]:transition-none"
      >
        <div
          ref={progress}
          aria-hidden="true"
          className="fixed inset-x-0 top-0 z-50 h-0.5 origin-left scale-x-0 bg-[#bad7c3]"
        />
        {children}
      </div>
    </MotionContext.Provider>
  );
}
