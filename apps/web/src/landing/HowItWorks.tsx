"use client";

import {
  ArrowUp,
  Calculator,
  Check,
  ClipboardList,
  MessageCircle,
  ReceiptText,
  ScanSearch,
  ShieldCheck,
  Wallet,
} from "lucide-react";
import Image from "next/image";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { ConsultationBackdrop } from "./ConsultationBackdrop";
import { Corners } from "./Corners";
import { conversation } from "./conversation";
import type { LandingFigures } from "./figures";

const shell = "mx-auto w-full max-w-[1440px] px-5 sm:px-10 lg:px-14";
const display = "font-[family-name:var(--font-display)]";
const editorial = "font-[family-name:var(--font-editorial)] font-normal italic";
const panel = "border border-solid border-[#343539] bg-[#121315]";

const steps = [
  { icon: MessageCircle, title: "Ask", text: "Type a question in your own language." },
  {
    icon: ScanSearch,
    title: "Read",
    text: "Mr.Fund reads your Rhea position: collateral, debt and price age.",
  },
  {
    icon: Calculator,
    title: "Explain",
    text: "The engine computes every number. The AI puts it in plain words.",
  },
  {
    icon: ClipboardList,
    title: "Recommend",
    text: "A card shows the move, the numbers behind it and what changes.",
  },
  {
    icon: Wallet,
    title: "Decide",
    text: "Adjust it, or execute it. Nothing moves without your approval.",
  },
  {
    icon: ReceiptText,
    title: "Receipt",
    text: "The result appears only after the outcome is observed.",
  },
] as const;
const COUNT = steps.length;
/** Tile size of /landing/grid.svg. */
const GRID = 88;
function Row({ label, value, good = false }: { label: ReactNode; value: string; good?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4 border-0 border-t border-solid border-[#26282b] py-3 text-sm first:border-t-0">
      <span className="flex items-center gap-2.5 text-[#8f9d92]">{label}</span>
      <span className={`font-semibold tabular-nums ${good ? "text-[#c8e6a4]" : "text-[#eef3ea]"}`}>
        {value}
      </span>
    </div>
  );
}

function Token({ symbol }: { symbol: "near" | "usdc" }) {
  return (
    <Image
      src={`/play/tokens/${symbol}.svg`}
      alt=""
      width={20}
      height={20}
      className="size-5 rounded-full"
    />
  );
}

/** One illustration per step. Every number is an engine output from `landingFigures()`. */
function Scene({ index, f }: { index: number; f: LandingFigures }) {
  const [first] = conversation(f);
  if (index === 0)
    return (
      <div className="flex w-full flex-col gap-4">
        <p className="m-0 ml-auto max-w-[85%] rounded-[20px] rounded-br-[6px] bg-[#bad7c3] px-4 py-3 text-[15px] text-[#203327]">
          {first.question}
        </p>
        <div className="flex items-center gap-3 rounded-full border border-solid border-[#343539] bg-[#17181b] py-2 pl-5 pr-2 text-sm text-[#7d8c81]">
          <span className="flex-1">
            Kalau NEAR turun 20%…
            <span className="ml-0.5 inline-block h-4 w-px translate-y-0.5 bg-[#c7d9bc] motion-safe:animate-pulse" />
          </span>
          <span className="grid size-9 place-items-center rounded-full bg-[#d3e5d7] text-[#203327]">
            <ArrowUp size={16} />
          </span>
        </div>
        <div className="flex gap-2 text-xs text-[#8f9d92]">
          {["EN", "ID", "ES"].map((lang) => (
            <span key={lang} className="border border-solid border-[#343539] px-2.5 py-1">
              {lang}
            </span>
          ))}
        </div>
      </div>
    );
  if (index === 1)
    return (
      <div className={`${panel} relative w-full overflow-hidden px-5 py-2`}>
        <span
          aria-hidden="true"
          className="absolute inset-x-0 top-0 h-px bg-[#c7d9bc]/60 motion-safe:animate-pulse"
        />
        <p className="m-0 pb-1 pt-3 text-xs uppercase tracking-[.16em] text-[#7f8f83]">
          Rhea position
        </p>
        <Row
          label={
            <>
              <Token symbol="near" /> Collateral
            </>
          }
          value={`${f.collateral} NEAR`}
        />
        <Row
          label={
            <>
              <Token symbol="usdc" /> Debt
            </>
          }
          value={`${f.debt} USDC`}
        />
        <Row
          label={
            <>
              <span className="size-2 rounded-full bg-[#9fd27a]" /> Price data
            </>
          }
          value="Fresh"
          good
        />
      </div>
    );
  if (index === 2)
    return (
      <div className="flex w-full flex-col gap-4">
        <div className={`${panel} px-6 py-6`}>
          <p className="m-0 text-xs uppercase tracking-[.16em] text-[#7f8f83]">Health</p>
          <p
            className={`${display} m-0 mt-2 text-[56px] leading-none tracking-[-.05em] text-[#c8e6a4]`}
          >
            {f.health}
          </p>
          <p className="mb-0 mt-3 text-sm text-[#8f9d92]">
            Liquidation near <b className="text-[#eef3ea]">{f.liquidationUsd}</b> per NEAR
          </p>
        </div>
        <p className="m-0 border-0 border-l-2 border-solid border-[#c7d9bc] pl-4 text-sm leading-relaxed text-[#b7c2b9]">
          {first.answer}
        </p>
      </div>
    );
  if (index === 3)
    return (
      <div className={`${panel} w-full p-5`}>
        <p className="m-0 text-xs uppercase tracking-[.16em] text-[#7f8f83]">Recommendation</p>
        <p
          className={`${display} m-0 mt-3 flex items-center gap-2.5 text-[28px] tracking-[-.04em]`}
        >
          <Token symbol="usdc" /> Repay {f.repayAmount} USDC
        </p>
        <div className="mt-4 grid grid-cols-2 gap-px bg-[#26282b]">
          <div className="bg-[#17181b] p-3">
            <p className="m-0 text-xs text-[#7f8f83]">Health after</p>
            <p className="m-0 mt-1 font-semibold tabular-nums text-[#c8e6a4]">
              {f.healthAfterRepay}
            </p>
          </div>
          <div className="bg-[#17181b] p-3">
            <p className="m-0 text-xs text-[#7f8f83]">Interest saved, 1 yr</p>
            <p className="m-0 mt-1 font-semibold tabular-nums">{f.repaySaves} USDC</p>
          </div>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2 text-center text-sm font-semibold">
          <span className="border border-solid border-[#343539] py-2.5 text-[#d6ddd6]">Adjust</span>
          <span className="bg-[#d3e5d7] py-2.5 text-[#203327]">Execute now</span>
        </div>
      </div>
    );
  if (index === 4)
    return (
      <div className="grid w-full gap-3">
        <div className={`${panel} flex items-start gap-4 p-5`}>
          <span className="grid size-10 shrink-0 place-items-center rounded-full bg-[#1d2a22] text-[#c7d9bc]">
            <Wallet size={18} />
          </span>
          <div>
            <p className="m-0 font-semibold">You sign in your wallet</p>
            <p className="m-0 mt-1 text-sm text-[#8f9d92]">
              Review the exact amount, then approve.
            </p>
          </div>
        </div>
        <p className={`${editorial} m-0 text-center text-xl text-[#7f8f83]`}>or</p>
        <div className={`${panel} flex items-start gap-4 p-5`}>
          <span className="grid size-10 shrink-0 place-items-center rounded-full bg-[#1d2a22] text-[#c7d9bc]">
            <ShieldCheck size={18} />
          </span>
          <div>
            <p className="m-0 font-semibold">Guardian, within your limits</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {["Max per action", "Trigger health", "Cooldown"].map((chip) => (
                <span
                  key={chip}
                  className="border border-solid border-[#343539] px-2 py-1 text-xs text-[#a0aea3]"
                >
                  {chip}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  return (
    <div className={`${panel} w-full p-6`}>
      <div className="flex items-center justify-between">
        <span className="grid size-11 place-items-center rounded-full bg-[#c8e6a4] text-[#203327]">
          <Check size={20} strokeWidth={2.5} />
        </span>
        <span className="border border-solid border-[#e4d7ba]/40 px-2.5 py-1 text-[11px] uppercase tracking-[.14em] text-[#e4d7ba]">
          Simulated
        </span>
      </div>
      <p className={`${display} m-0 mt-5 text-[26px] tracking-[-.04em]`}>
        Repaid {f.repayAmount} USDC
      </p>
      <div className="mt-3">
        <Row label="New health" value={f.healthAfterRepay} good />
        <Row label="Transaction" value="None sent in demo" />
      </div>
    </div>
  );
}

function Header() {
  return (
    <div className="relative pt-6">
      <span
        data-rule
        aria-hidden="true"
        className="absolute inset-x-0 top-0 h-px origin-left bg-[#343539]"
      />
      <h2
        className={`${display} m-0 text-[clamp(36px,4.3vw,64px)] font-medium leading-[1.05] tracking-[-.045em]`}
      >
        From question <span className={`${editorial} text-[#c7d9bc]`}>to receipt.</span>
      </h2>
    </div>
  );
}

const today = (
  <>
    <span className="font-semibold uppercase tracking-[.14em] text-[#e4d7ba]">Today</span> The
    consultation runs on a simulated position with a mock wallet. Live Rhea reads, wallet signing
    and the Guardian contract are still being built.
  </>
);

/**
 * Desktop: a tall scroll track with a sticky stage. Scroll position picks the active step,
 * fills the progress rail. Below 1024px the steps stack with their scenes.
 */
export function HowItWorks({ figures }: { figures: LandingFigures }) {
  const track = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);

  useEffect(() => {
    const el = track.current;
    if (!el) return;
    let frame = 0;
    const origin = el.closest<HTMLElement>("[data-grid-origin]");
    // The sticky layer holds its own grid so it stays still while pinned. Its travel is a whole
    // number of tiles and its offset matches the page grid, so it lines up when pinning starts and ends.
    const fit = () => {
      if (!window.matchMedia?.("(min-width: 1024px)").matches) {
        el.style.height = "";
        return;
      }
      const vh = window.innerHeight;
      el.style.height = `${vh + Math.max(GRID, Math.round((4.6 * vh) / GRID) * GRID)}px`;
    };
    const update = () => {
      frame = 0;
      const rect = el.getBoundingClientRect();
      const fromOrigin = rect.top - (origin?.getBoundingClientRect().top ?? 0);
      el.style.setProperty("--grid-y", `${(((-fromOrigin % GRID) + GRID) % GRID).toFixed(2)}px`);
      const span = rect.height - window.innerHeight;
      const progress = span > 0 ? Math.min(1, Math.max(0, -rect.top / span)) : 0;
      el.style.setProperty("--progress", String(progress));
      setActive(Math.min(COUNT - 1, Math.floor(progress * COUNT)));
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    const resize = () => {
      fit();
      schedule();
    };
    fit();
    update();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", resize);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", resize);
    };
  }, []);

  const jump = (index: number) => {
    const el = track.current;
    if (!el) return;
    const top = el.getBoundingClientRect().top + window.scrollY;
    const span = el.offsetHeight - window.innerHeight;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({
      top: top + ((index + 0.5) / COUNT) * span,
      behavior: reduced ? "auto" : "smooth",
    });
  };

  return (
    <section id="how" className="relative scroll-mt-28 text-[#eff1e9]">
      {/* Desktop: sticky scroll story */}
      <div ref={track} className="relative hidden lg:block lg:h-[560svh]">
        <div className="sticky top-0 flex h-svh items-stretch bg-[#0e1110] bg-[url(/landing/grid.svg)] pb-10 pt-[124px] [background-position:0_var(--grid-y,0px)]">
          <div className={`${shell} grid grid-cols-[minmax(0,5fr)_minmax(0,7fr)] gap-16`}>
            <div className="flex min-h-0 flex-col justify-between">
              <Header />
              <ol className="relative m-0 list-none p-0 pl-8">
                <span
                  aria-hidden="true"
                  className="absolute bottom-2 left-0 top-2 w-px bg-[#343539]"
                >
                  <span className="absolute inset-0 origin-top scale-y-[var(--progress,0)] bg-[#c7d9bc]" />
                </span>
                {steps.map((step, index) => {
                  const on = index === active;
                  return (
                    <li key={step.title}>
                      <button
                        type="button"
                        aria-current={on ? "step" : undefined}
                        onClick={() => jump(index)}
                        className="group relative block w-full max-w-[440px] cursor-pointer border-0 bg-transparent px-4 py-2.5 text-left focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#bad7c3]"
                      >
                        <span
                          aria-hidden="true"
                          className={`pointer-events-none absolute inset-0 transition-[opacity,scale] duration-500 ease-[cubic-bezier(.2,.8,.2,1)] motion-reduce:transition-none ${on ? "scale-100 opacity-100" : "scale-[1.12] opacity-0"}`}
                        >
                          <Corners placement="inside" small />
                        </span>
                        <span className="flex items-baseline gap-4">
                          <span
                            className={`w-6 text-sm tabular-nums transition-colors duration-500 ${on ? "text-[#c7d9bc]" : "text-[#5d625f]"}`}
                          >
                            {String(index + 1).padStart(2, "0")}
                          </span>
                          <span
                            className={`${display} text-[26px] tracking-[-.035em] transition-colors duration-500 ${on ? "text-[#eff1e9]" : "text-[#5d625f] group-hover:text-[#8f9d92]"}`}
                          >
                            {step.title}
                          </span>
                        </span>
                        <span
                          className={`grid pl-10 transition-[grid-template-rows,opacity] duration-500 ease-[cubic-bezier(.2,.8,.2,1)] ${on ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"}`}
                        >
                          <span className="overflow-hidden">
                            <span className="block pt-1.5 text-[15px] leading-relaxed text-[#a0aea3]">
                              {step.text}
                            </span>
                          </span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ol>
              <p className="m-0 max-w-[460px] text-[15px] leading-relaxed text-[#7f8f83]">
                {today}
              </p>
            </div>

            <div className="relative min-h-0">
              <Corners />
              <div className={`${panel} relative isolate h-full overflow-hidden bg-[#181b20]`}>
                <ConsultationBackdrop />
                {steps.map((step, index) => {
                  const state = index === active ? "on" : index < active ? "past" : "next";
                  return (
                    <div
                      key={step.title}
                      aria-hidden={state !== "on" || undefined}
                      className={`absolute inset-0 z-10 grid place-items-center px-10 transition-[opacity,translate,clip-path] duration-700 ease-[cubic-bezier(.7,0,.2,1)] ${
                        state === "on"
                          ? "translate-y-0 opacity-100 [clip-path:inset(0_0_0_0)]"
                          : state === "past"
                            ? "-translate-y-10 opacity-0 [clip-path:inset(0_0_100%_0)]"
                            : "translate-y-10 opacity-0 [clip-path:inset(100%_0_0_0)]"
                      }`}
                    >
                      <div className="w-full max-w-[440px]">
                        <Scene index={index} f={figures} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Below 1024px: stacked steps with their scenes */}
      <div className={`${shell} py-20 sm:py-28 lg:hidden`}>
        <div data-reveal className="mb-12">
          <Header />
        </div>
        <ol className="m-0 grid list-none gap-14 p-0">
          {steps.map((step, index) => {
            const Icon = step.icon;
            return (
              <li key={step.title} data-reveal className="grid gap-5">
                <div className="flex items-center gap-4">
                  <span className="grid size-11 place-items-center rounded-full border border-solid border-[#343539] bg-[#17181b] text-[#c7d9bc]">
                    <Icon size={19} strokeWidth={1.75} />
                  </span>
                  <div>
                    <p className="m-0 text-sm tabular-nums text-[#7f8f83]">
                      {String(index + 1).padStart(2, "0")}
                    </p>
                    <h3 className={`${display} m-0 text-[24px] font-medium tracking-[-.035em]`}>
                      {step.title}
                    </h3>
                  </div>
                </div>
                <p className="m-0 text-[15px] leading-relaxed text-[#a0aea3]">{step.text}</p>
                <div
                  aria-hidden="true"
                  className="relative isolate overflow-hidden border border-solid border-[#343539] p-5 py-12"
                >
                  <ConsultationBackdrop />
                  <Corners placement="inside" />
                  <div className="relative z-10">
                    <Scene index={index} f={figures} />
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
        <p className="mb-0 mt-14 border-0 border-t border-solid border-[#343539] pt-6 text-[15px] leading-relaxed text-[#8f9d92]">
          {today}
        </p>
      </div>
    </section>
  );
}
