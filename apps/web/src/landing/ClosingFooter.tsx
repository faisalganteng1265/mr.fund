import { ArrowUpRight } from "lucide-react";
import Image from "next/image";
import { Mascot } from "./Mascot";

const display = "font-[family-name:var(--font-display)]";
const focus =
  "focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#d3e5d7]";

/** Original cartoon garden artwork blends into the page behind an accessible closing action. */
export function ClosingFooter() {
  return (
    <footer className="relative isolate overflow-hidden text-[#eff1e9]">
      <section
        aria-labelledby="closing-title"
        className="relative isolate min-h-[580px] sm:min-h-[660px] lg:min-h-[700px]"
      >
        <div
          data-footer-art
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 bottom-0 h-[340px] sm:h-[480px] lg:inset-0 lg:h-full"
        >
          <Image
            src="/landing/footer-consultation-garden.png"
            alt=""
            fill
            sizes="100vw"
            quality={85}
            className="object-cover object-[80%_100%] sm:object-[65%_100%] lg:object-bottom"
          />
        </div>
        <div
          data-reveal
          className="relative z-10 mx-auto flex max-w-[1100px] flex-col items-center px-5 pb-[280px] pt-14 text-center sm:px-10 sm:pt-20 lg:pt-16"
        >
          <h2
            id="closing-title"
            className={`${display} m-0 text-[clamp(38px,7vw,92px)] font-medium leading-[1.03] tracking-[-.055em]`}
          >
            Your next move.
            <br />
            <span className="font-[family-name:var(--font-editorial)] font-normal italic text-[#c7d9bc]">
              Let’s talk.
            </span>
          </h2>
          <a
            href="/play"
            className={`group mt-7 inline-flex min-h-14 max-w-full items-center justify-center gap-5 rounded-[10px] bg-[#d3e5d7] px-6 py-4 text-base font-semibold text-[#203327] transition-[translate,background-color] duration-200 hover:-translate-y-1 hover:bg-[#e6efdc] active:translate-y-0 sm:mt-8 sm:px-7 ${focus}`}
          >
            Start consultation{" "}
            <ArrowUpRight
              size={20}
              className="transition-transform duration-200 group-hover:-translate-y-0.5 group-hover:translate-x-0.5"
            />
          </a>
          <p className="mb-0 mt-4 text-sm text-[#a6b2a5]">Mock wallet. No real funds.</p>
        </div>
      </section>
      <div className="relative z-10 border-0 border-t border-solid border-[#303833] bg-[#0e1110]">
        <div className="mx-auto grid max-w-[1440px] items-center justify-items-center gap-5 px-5 py-7 text-sm text-[#a2b0a4] sm:px-10 lg:flex lg:justify-between lg:px-14">
          <a href="#top" aria-label="Mr.Fund home" className={`flex items-center gap-2 ${focus}`}>
            <Mascot size={40} className="size-10" />
            <span
              className={`${display} text-[23px] font-semibold tracking-[-1.2px] text-[#eff1e9]`}
            >
              mr.fund
            </span>
          </a>
          <span className="flex items-center justify-center gap-2 text-center">
            <Image
              src="/play/tokens/near.svg"
              alt=""
              width={18}
              height={18}
              className="size-[18px] invert"
            />
            Built for the NEAR Hackathon 2026
          </span>
          <nav
            aria-label="Footer"
            className="flex flex-wrap items-center justify-center gap-x-6 gap-y-3"
          >
            <a href="#how" className={`text-[#c7d5bc] transition-colors hover:text-white ${focus}`}>
              How it works
            </a>
            <a
              href="/play"
              className={`inline-flex items-center gap-1.5 text-[#c7d5bc] transition-colors hover:text-white ${focus}`}
            >
              Playground <ArrowUpRight size={15} />
            </a>
          </nav>
        </div>
      </div>
    </footer>
  );
}
