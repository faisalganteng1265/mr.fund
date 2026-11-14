"use client";

import {
  ArrowUpRight,
  Braces,
  Fingerprint,
  MessagesSquare,
  ShieldCheck,
  Signature,
} from "lucide-react";
import Image from "next/image";
import { useState } from "react";

const shell = "mx-auto w-full max-w-[1440px] px-5 sm:px-10 lg:px-14";
const display = "font-[family-name:var(--font-display)]";
const editorial = "font-[family-name:var(--font-editorial)] font-normal italic";

const layers = [
  {
    name: "Your private key",
    promise: "Never asked for. Never handled.",
    detail: "Your key stays in your wallet. Mr.Fund never asks for it.",
    icon: Fingerprint,
  },
  {
    name: "Your wallet",
    promise: "You sign every manual move.",
    detail: "Review the exact amount in your own wallet before approving.",
    icon: Signature,
  },
  {
    name: "Guardian contract",
    promise: "Your limits, enforced on-chain.",
    detail: "Designed to enforce your reserve and repayment limits. In development.",
    icon: ShieldCheck,
  },
  {
    name: "The engine",
    promise: "Code decides every number.",
    detail: "Calculates from inputs and data age. Stale prices stop execution.",
    icon: Braces,
  },
  {
    name: "The AI",
    promise: "It talks. It can't sign or send.",
    detail: "Explains and proposes. Its tools cannot sign or send.",
    icon: MessagesSquare,
  },
] as const;

/** An illustrated ownership poster paired with five concise permission boundaries. */
export function TrustSection() {
  const [active, setActive] = useState(0);
  return (
    <section
      id="trust"
      className="relative scroll-mt-28 overflow-hidden py-20 text-[#eff1e9] sm:py-28"
    >
      <div className={shell}>
        <div data-reveal className="relative mb-10 pt-6 sm:mb-14">
          <span
            data-rule
            aria-hidden="true"
            className="absolute inset-x-0 top-0 h-px origin-left bg-[#343539]"
          />
          <h2
            className={`${display} m-0 text-[clamp(36px,4.3vw,64px)] font-medium leading-[1.05] tracking-[-.045em]`}
          >
            Your keys. <span className={`${editorial} text-[#c7d9bc]`}>Your signature.</span>
          </h2>
        </div>
        <div className="grid gap-6 lg:grid-cols-12 lg:gap-8">
          <div
            data-reveal
            className="relative isolate min-h-[500px] overflow-hidden border border-solid border-[#343539] bg-[#1b1c20] sm:min-h-[580px] lg:col-span-7 lg:min-h-[640px]"
          >
            <div
              aria-hidden="true"
              className={`${display} absolute bottom-2 left-4 whitespace-nowrap text-[clamp(80px,12vw,170px)] font-semibold leading-none tracking-[-.08em] text-[#34363c]`}
            >
              mr.fund
            </div>
            <div
              data-float
              className="absolute inset-x-6 bottom-3 top-4 sm:inset-x-10 sm:bottom-5 sm:top-5"
            >
              <Image
                src="/landing/mr-fund-standing.png"
                alt="Mr.Fund, a friendly cartoon financial companion, standing with an open hand."
                fill
                sizes="(min-width:1440px) 680px, (min-width:1024px) 55vw, 90vw"
                className="object-contain object-bottom"
              />
            </div>
            <div className="absolute bottom-8 left-5 z-10 -rotate-3 bg-[#eee6ce] px-4 py-3 text-[#263023] sm:bottom-10 sm:left-8 sm:px-5 sm:py-4">
              <span
                className={`${display} block text-[clamp(20px,2vw,28px)] font-medium leading-tight tracking-[-.04em]`}
              >
                Your wallet.
                <br />
                Your call.
              </span>
            </div>
            <a
              href="/play"
              aria-label="Start a consultation with Mr.Fund"
              className="absolute bottom-7 right-5 z-10 grid size-12 place-items-center bg-[#ed9b70] text-[#30231c] transition-transform hover:-translate-y-1 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white sm:bottom-10 sm:right-8 sm:size-14"
            >
              <ArrowUpRight size={27} />
            </a>
          </div>
          <ol className="m-0 flex list-none flex-col gap-2 p-0 lg:col-span-5">
            {layers.map((layer, index) => {
              const on = index === active;
              const Icon = layer.icon;
              return (
                <li
                  key={layer.name}
                  className={`border border-solid transition-colors duration-300 ${on ? "border-[#56595e] bg-[#242529]" : "border-[#303236] bg-[#17181b]"}`}
                >
                  <h3 className="m-0">
                    <button
                      type="button"
                      aria-expanded={on}
                      aria-controls={`trust-detail-${index}`}
                      onClick={() => setActive(index)}
                      onMouseEnter={() => setActive(index)}
                      onFocus={() => setActive(index)}
                      className="flex w-full cursor-pointer items-center gap-4 border-0 bg-transparent p-4 text-left focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#bad7c3] sm:p-5"
                    >
                      <span
                        aria-hidden="true"
                        className={`grid size-9 shrink-0 place-items-center transition-colors duration-300 ${on ? "text-[#d6dfc7]" : "text-[#8c929a]"}`}
                      >
                        <Icon size={26} strokeWidth={1.5} />
                      </span>
                      <span className="min-w-0">
                        <span className="block text-sm font-normal text-[#a5a9af]">
                          {layer.name}
                        </span>
                        <span
                          className={`${display} mt-1 block text-[clamp(20px,1.8vw,26px)] font-medium leading-[1.18] tracking-[-.035em] text-[#eff1e9]`}
                        >
                          {layer.promise}
                        </span>
                      </span>
                    </button>
                  </h3>
                  <div
                    id={`trust-detail-${index}`}
                    className={`grid transition-[grid-template-rows] duration-300 motion-reduce:transition-none ${on ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}
                  >
                    <div className="overflow-hidden">
                      <p className="m-0 px-4 pb-5 pl-[68px] text-sm leading-relaxed text-[#b4b8bf] sm:pl-[76px] sm:pr-5">
                        {layer.detail}
                      </p>
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
        </div>
      </div>
    </section>
  );
}
