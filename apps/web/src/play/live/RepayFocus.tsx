import { type ReactNode, useEffect, useRef } from "react";
import type { RepayView } from "../../execution/live";

/**
 * Focus follows the repay flow. When Execute opens the confirmation (or a blocked, signing or
 * result state), focus moves to this region so keyboard and screen-reader users land on it
 * instead of on a button that just unmounted. When the flow is cancelled back to idle, focus
 * returns to the first control, which is Execute.
 */
export function RepayFocus({
  phase,
  children,
}: {
  phase: RepayView["phase"];
  children: ReactNode;
}) {
  const region = useRef<HTMLDivElement>(null);
  const last = useRef(phase);
  useEffect(() => {
    const before = last.current;
    last.current = phase;
    if (before === phase) return;
    if (phase === "idle") region.current?.querySelector("button")?.focus();
    else region.current?.focus();
  }, [phase]);
  return (
    // biome-ignore lint/a11y/useSemanticElements: a focus target for a transient state, not a form group
    <div
      ref={region}
      tabIndex={-1}
      role="group"
      aria-label={phase === "confirm" ? "Repay confirmation" : "Repay"}
      className="rounded-xl outline-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-[#bad7c3]"
    >
      {children}
    </div>
  );
}
