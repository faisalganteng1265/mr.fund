"use client";

import { type ReactNode, useEffect, useRef, useState } from "react";
import { conversation } from "./conversation";
import type { LandingFigures } from "./figures";
import { useLandingMotion, useVisible } from "./LandingMotion";
import { Mascot } from "./Mascot";

const STEP_MS = 1500;
/** The panel waits this long after load, then unfolds from its vertical centre. */
const OPEN_DELAY_MS = 2000;
const OPEN_MS = 740;

type Stat = { label: string; value: string; good?: boolean };
type Message =
  | { id: string; from: "user"; text: string }
  | { id: string; from: "fund"; text: string; stats: Stat[] };

/** Data cards under each answer. Every value is an engine output from `landingFigures()`. */
function statsFor(f: LandingFigures, story: number): Stat[] {
  if (story === 0)
    return [
      { label: "Health", value: f.health, good: true },
      { label: "Liquidation near", value: `${f.liquidationUsd} / NEAR` },
    ];
  if (story === 1)
    return [
      { label: "Repay", value: `${f.repayAmount} USDC` },
      { label: "Health after", value: f.healthAfterRepay, good: true },
    ];
  return [
    { label: "Health if NEAR −20%", value: f.shockHealth },
    { label: "Status", value: f.shockLiquidatable ? "Liquidatable" : "Above 100%" },
  ];
}

/** Emphasise the engine figures inside an answer without changing its text. */
function highlight(text: string, figures: string[]): ReactNode[] {
  const values = [...new Set(figures.filter(Boolean))].sort((a, b) => b.length - a.length);
  if (values.length === 0) return [text];
  const pattern = new RegExp(
    `(${values.map((v) => v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`,
  );
  return text.split(pattern).map((part, i) =>
    values.includes(part) ? (
      // biome-ignore lint/suspicious/noArrayIndexKey: split parts of a fixed string never reorder
      <b key={i} className="font-semibold text-[#eef3ea] tabular-nums">
        {part}
      </b>
    ) : (
      part
    ),
  );
}

function FundAvatar() {
  return (
    <span aria-hidden="true" className="relative shrink-0">
      <Mascot size={36} className="size-9 rounded-full bg-[#e4d7ba]" />
    </span>
  );
}

const enter =
  "transition-[opacity,translate] duration-500 ease-[cubic-bezier(.2,.8,.2,1)] starting:translate-y-3 starting:opacity-0 motion-reduce:transition-none";

/** A tall chat panel that unfolds after a short pause, then reveals the scripted demo exchange one message at a time. */
export function HeroChat({ figures }: { figures: LandingFigures }) {
  const host = useRef<HTMLDivElement>(null);
  const visible = useVisible(host);
  const { paused, reduced } = useLandingMotion();
  const messages: Message[] = conversation(figures).flatMap((story, n) => [
    { id: `q${n}`, from: "user" as const, text: story.question },
    { id: `a${n}`, from: "fund" as const, text: story.answer, stats: statsFor(figures, n) },
  ]);
  const emphasis = [
    figures.health,
    figures.healthAfterRepay,
    figures.liquidationUsd,
    `${figures.repayAmount} USDC`,
    `${figures.repaySaves} USDC`,
    `${figures.yieldEarns} USDC`,
    figures.shockHealth,
  ];
  const [shown, setShown] = useState(2);
  const [stage, setStage] = useState<"waiting" | "opening" | "open">("waiting");
  const still = paused || reduced;
  const active = visible && !still && stage === "open" && shown < messages.length;

  useEffect(() => {
    if (still) {
      setStage("open");
      return;
    }
    if (stage === "open") return;
    const timer = setTimeout(
      () => setStage(stage === "waiting" ? "opening" : "open"),
      stage === "waiting" ? OPEN_DELAY_MS : OPEN_MS,
    );
    return () => clearTimeout(timer);
  }, [stage, still]);

  useEffect(() => {
    if (!active) return;
    const timer = setTimeout(() => setShown((n) => n + 1), STEP_MS);
    return () => clearTimeout(timer);
  }, [active]);

  const count = reduced ? messages.length : shown;
  const typing = !reduced && count < messages.length && messages[count]?.from === "fund";

  return (
    <div
      ref={host}
      id="experience"
      inert={stage === "waiting"}
      aria-hidden={stage === "waiting" || undefined}
      className={`relative flex h-[540px] scroll-mt-24 flex-col rounded-[28px] border border-solid border-white/9 bg-[#0d0f0e] [contain:paint] transition-[clip-path,opacity] duration-[740ms] ease-[cubic-bezier(.4,0,.2,1)] motion-reduce:transition-none sm:h-[620px] ${stage === "waiting" ? "[clip-path:inset(50%_0_round_28px)] opacity-0" : "[clip-path:inset(0_0_round_28px)] opacity-100"}`}
    >
      <p className="m-0 px-5 pt-5 text-center font-[family-name:var(--font-display)] text-[17px] font-semibold tracking-[-.02em] text-[#eef3ea] sm:px-7 sm:pt-6">
        Mr.Fund
      </p>

      <ol
        aria-label="Simulated demo conversation"
        className="m-0 flex min-h-0 flex-1 list-none flex-col justify-end gap-5 overflow-hidden px-5 pb-5 pt-6 sm:pb-7 [mask-image:linear-gradient(to_bottom,transparent,#000_72px)] sm:px-7"
      >
        {messages.slice(0, count).map((message) =>
          message.from === "user" ? (
            <li key={message.id} className={`flex items-center justify-end gap-3 ${enter}`}>
              <p className="m-0 max-w-[80%] rounded-[20px] border border-solid border-white/8 bg-[#1a1d1c] px-4 py-2.5 text-sm leading-relaxed text-[#e9eee7]">
                {message.text}
              </p>
            </li>
          ) : (
            <li key={message.id} className={`flex items-start gap-3 ${enter}`}>
              <FundAvatar />
              <div className="min-w-0 flex-1 pt-1.5">
                <p className="m-0 text-sm leading-[1.7] text-[#b7c2b9]">
                  <span aria-hidden="true">{highlight(message.text, emphasis)}</span>
                  <span className="sr-only">{message.text}</span>
                </p>
                <dl className="m-0 mt-3 grid grid-cols-2 overflow-hidden rounded-[16px] border border-solid border-white/8 bg-[#131614]">
                  {message.stats.map((stat, i) => (
                    <div
                      key={stat.label}
                      className={`px-3.5 py-3 ${i > 0 ? "border-0 border-l border-solid border-white/8" : ""}`}
                    >
                      <dt className="text-[11px] text-[#7f8f83]">{stat.label}</dt>
                      <dd
                        className={`m-0 mt-1 font-[family-name:var(--font-display)] text-[17px] font-medium tracking-[-.02em] tabular-nums ${stat.good ? "text-[#c8e6a4]" : "text-[#eef3ea]"}`}
                      >
                        {stat.value}
                      </dd>
                    </div>
                  ))}
                </dl>
              </div>
            </li>
          ),
        )}
        {typing && (
          <li className={`flex items-center gap-3 ${enter}`}>
            <FundAvatar />
            <span
              role="status"
              aria-label="Mr.Fund is thinking"
              className="inline-flex items-center gap-1.5 rounded-full bg-[#1a1d1c] px-4 py-3"
            >
              <i className="size-1.5 rounded-full bg-[#9bb4a2] motion-safe:animate-pulse" />
              <i className="size-1.5 rounded-full bg-[#9bb4a2] motion-safe:animate-pulse [animation-delay:150ms]" />
              <i className="size-1.5 rounded-full bg-[#9bb4a2] motion-safe:animate-pulse [animation-delay:300ms]" />
            </span>
          </li>
        )}
      </ol>
    </div>
  );
}
