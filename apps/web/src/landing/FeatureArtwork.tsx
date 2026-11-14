import { ArrowRight, Check, CircleDollarSign, LockKeyhole, ShieldCheck } from "lucide-react";
import Image from "next/image";
import type { LandingFigures } from "./figures";
import { Mascot } from "./Mascot";

export type FeatureKind =
  | "position-orbit"
  | "decision-route"
  | "position-tokens"
  | "plain-words"
  | "guardian"
  | "languages";

function Fund({ small = false }: { small?: boolean }) {
  return (
    <span
      className={`relative z-10 grid shrink-0 place-items-center rounded-full border border-solid border-[#596355] bg-[#e4dfca] ${small ? "size-10" : "size-16"}`}
    >
      <Mascot size={small ? 36 : 58} className={small ? "size-9" : "size-[58px]"} />
    </span>
  );
}

function Token({ name }: { name: "near" | "usdc" }) {
  return (
    <span
      className={`grid size-9 shrink-0 place-items-center rounded-full ${name === "near" ? "bg-[#e9edde]" : "bg-[#2775ca]"}`}
    >
      <Image src={`/play/tokens/${name}.svg`} alt="" width={24} height={24} className="size-6" />
    </span>
  );
}

function Orbit() {
  return (
    <div className="relative mx-auto flex h-full max-w-[440px] items-center justify-center">
      <svg
        aria-hidden="true"
        viewBox="0 0 400 250"
        className="absolute inset-0 size-full overflow-visible fill-none"
      >
        <path
          d="M37 125H109M291 125H363M70 48L128 84M272 166L330 205M70 205L128 166M272 84L330 48"
          stroke="#414349"
          strokeDasharray="3 6"
        />
        <circle
          cx="200"
          cy="125"
          r="81"
          stroke="#34363b"
          strokeWidth="21"
          strokeDasharray="110 17"
        />
        <circle
          data-feature-signal
          cx="200"
          cy="125"
          r="81"
          stroke="#3264e7"
          strokeWidth="21"
          strokeDasharray="112 397"
          transform="rotate(-88 200 125)"
        />
        <circle
          data-feature-signal
          cx="200"
          cy="125"
          r="81"
          stroke="#eeb941"
          strokeWidth="21"
          strokeDasharray="54 455"
          transform="rotate(1 200 125)"
        />
        <circle
          data-feature-signal
          cx="200"
          cy="125"
          r="81"
          stroke="#ef7850"
          strokeWidth="21"
          strokeDasharray="80 429"
          transform="rotate(49 200 125)"
        />
      </svg>
      <Fund />
      <span data-feature-pop className="absolute left-[3%] top-[43%]">
        <Token name="near" />
      </span>
      <span data-feature-pop className="absolute right-[3%] top-[43%]">
        <Token name="usdc" />
      </span>
      <span
        data-feature-pop
        className="absolute left-[14%] top-[9%] grid size-9 place-items-center rounded-full border border-solid border-[#45474c] bg-[#292b30] text-[#c8e7b9]"
      >
        <ShieldCheck size={19} />
      </span>
      <span
        data-feature-pop
        className="absolute bottom-[8%] right-[13%] grid size-9 place-items-center rounded-full bg-[#e4dfca] text-[#203327]"
      >
        <CircleDollarSign size={22} />
      </span>
      <span className="absolute bottom-0 text-sm text-[#a0a3a9]">
        One position. The whole picture.
      </span>
    </div>
  );
}

function Decision({ f }: { f: LandingFigures }) {
  return (
    <div className="mx-auto flex h-full max-w-[380px] flex-col justify-center gap-5">
      <div className="flex items-center justify-between gap-3 px-4">
        <Token name="usdc" />
        <span className="h-px flex-1 bg-current/20" />
        <span data-feature-pop>
          <Fund />
        </span>
        <span className="h-px flex-1 bg-current/20" />
        <span
          data-feature-pop
          className="grid size-10 place-items-center rounded-xl bg-[#3264e7] text-white"
        >
          <ArrowRight size={24} />
        </span>
      </div>
      <div className="grid grid-cols-2 gap-3">
        {[
          {
            label: "Repay",
            value: f.repaySaves,
            active: f.winner === "repay",
            detail: "USDC avoided / year",
          },
          {
            label: "Supply",
            value: f.yieldEarns,
            active: f.winner === "yield",
            detail: "USDC earned / year",
          },
        ].map((item) => (
          <div
            key={item.label}
            className="relative overflow-hidden rounded-xl border border-solid border-[#3c3e44] bg-[#202125] p-4 text-[#e7eee5]"
          >
            {item.active && <span data-feature-surface className="absolute inset-0 bg-[#303238]" />}
            <div className="relative">
              <span className="flex items-center justify-between text-sm">
                {item.label}
                {item.active && <Check size={16} />}
              </span>
              <b className="mt-3 block text-[28px] font-medium tracking-[-1px] tabular-nums">
                {item.value}
              </b>
              <span className="text-sm text-[#a3b89b]">{item.detail}</span>
            </div>
          </div>
        ))}
      </div>
      <span className="text-center text-sm text-[#a0a3a9]">Same amount. Simulated comparison.</span>
    </div>
  );
}

function Position({ f }: { f: LandingFigures }) {
  return (
    <div className="mx-auto flex h-full max-w-[290px] flex-col justify-center gap-3 px-2">
      {[
        {
          name: "near" as const,
          label: "NEAR",
          value: f.collateral,
          points: "0,22 12,20 21,24 30,11 40,15 50,8 59,12 68,4 80,7",
        },
        {
          name: "usdc" as const,
          label: "USDC",
          value: f.debt,
          points: "0,17 11,17 20,15 30,17 39,14 50,17 61,13 70,15 80,13",
        },
      ].map((token) => (
        <div
          key={token.name}
          className="flex items-center gap-2 rounded-full border border-solid border-[#3c3e44] bg-[#242529] p-2 pr-3"
        >
          <Token name={token.name} />
          <span className="text-sm text-[#c3d0c5]">{token.label}</span>
          <svg aria-hidden="true" viewBox="0 0 80 30" className="h-6 min-w-5 flex-1 fill-none">
            <polyline points={token.points} stroke="#91b397" strokeWidth="1.5" />
            <polyline data-feature-signal points={token.points} stroke="#c4ed95" strokeWidth="2" />
          </svg>
          <span className="text-sm font-medium text-[#dcebd7] tabular-nums">{token.value}</span>
        </div>
      ))}
      <span className="text-center text-sm text-[#98ad9c]">Simulated balances</span>
    </div>
  );
}

function PlainWords() {
  return (
    <div className="mx-auto flex h-full max-w-[280px] flex-col justify-center gap-3 px-3">
      <div className="flex flex-wrap justify-center gap-x-3 gap-y-2 font-mono text-sm text-[#6e8775]">
        {["APR", "COLLATERAL", "LTV", "LIQUIDATION"].map((word) => (
          <span key={word} data-feature-signal>
            {word}
          </span>
        ))}
      </div>
      <div className="flex items-start gap-2">
        <Fund small />
        <span
          data-feature-pop
          className="rounded-[16px_16px_16px_4px] border border-solid border-[#3c3e44] bg-[#25262b] p-3 text-sm leading-relaxed text-[#e0ebdc]"
        >
          Let’s put that in plain words.
        </span>
      </div>
      <span
        data-feature-signal
        className="ml-auto rounded-[14px_14px_4px_14px] bg-[#c7d9bc] px-3 py-2 text-sm text-[#203327]"
      >
        That makes sense.
      </span>
    </div>
  );
}

function Guardian() {
  return (
    <div className="mx-auto flex h-full max-w-[300px] flex-col justify-center px-1">
      <div className="mb-4 flex items-center gap-3">
        <Fund small />
        <div className="flex-1">
          <span className="block text-sm font-medium text-[#e7e8e9]">Guardian</span>
          <span className="mt-1 block text-sm text-[#96999f]">Policy preview</span>
        </div>
      </div>
      <div className="overflow-hidden rounded-xl border border-solid border-[#383a40] bg-[#202125]">
        {[
          { name: "Reserve", value: "Your choice", icon: LockKeyhole },
          { name: "Repay limit", value: "Your limit", icon: CircleDollarSign },
        ].map(({ name, value, icon: Icon }, index) => (
          <div
            key={name}
            className={`flex items-center gap-3 px-4 py-4 ${index ? "border-0 border-t border-solid border-[#34363b]" : ""}`}
          >
            <Icon size={18} strokeWidth={1.5} className="shrink-0 text-[#a7abb2]" />
            <span className="flex-1 text-sm text-[#c3c5ca]">{name}</span>
            <span data-feature-pop className="text-sm text-[#d6e5c6]">
              {value}
            </span>
            <Check data-feature-signal size={15} className="shrink-0 text-[#c0df98]" />
          </div>
        ))}
      </div>
    </div>
  );
}

function Languages() {
  return (
    <div className="relative mx-auto flex h-full max-w-[290px] items-center justify-center">
      <div className="absolute inset-x-8 inset-y-2 rounded-full border border-solid border-[#34363b]" />
      <div className="absolute inset-x-16 inset-y-8 rounded-full border border-solid border-[#34363b]" />
      <Fund />
      {[
        { text: "Hello!", position: "left-0 top-3" },
        { text: "Halo!", position: "right-0 top-7" },
        { text: "こんにちは", position: "left-0 bottom-6" },
        { text: "Hola!", position: "right-0 bottom-2" },
      ].map((bubble) => (
        <span
          key={bubble.text}
          data-feature-pop
          className={`absolute rounded-[12px_12px_4px_12px] border border-solid border-[#3c3e44] bg-[#232429] px-3 py-2 text-sm text-[#dce9d5] ${bubble.position}`}
        >
          {bubble.text}
        </span>
      ))}
    </div>
  );
}

/** Native feature diagrams; only the mascot and official token marks are bitmap/vector assets. */
export function FeatureArtwork({ kind, figures }: { kind: FeatureKind; figures: LandingFigures }) {
  return (
    <div aria-hidden="true" data-feature-diagram className="relative size-full text-[#c7d9bc]">
      {kind === "position-orbit" ? (
        <Orbit />
      ) : kind === "decision-route" ? (
        <Decision f={figures} />
      ) : kind === "position-tokens" ? (
        <Position f={figures} />
      ) : kind === "plain-words" ? (
        <PlainWords />
      ) : kind === "guardian" ? (
        <Guardian />
      ) : (
        <Languages />
      )}
    </div>
  );
}
