import { ArrowUpRight, Plus, ShieldCheck } from "lucide-react";
import Image from "next/image";
import { ClosingFooter } from "./ClosingFooter";
import { FeatureArtwork } from "./FeatureArtwork";
import { landingFigures } from "./figures";
import { HeroChat } from "./HeroChat";
import { HeroVideo } from "./HeroVideo";
import { HowItWorks } from "./HowItWorks";
import { LandingMotion } from "./LandingMotion";
import { Mascot } from "./Mascot";
import { TrustSection } from "./TrustSection";

const shell = "mx-auto w-full max-w-[1440px] px-5 sm:px-10 lg:px-14";
const display = "font-[family-name:var(--font-display)]";
const focus =
  "focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#bad7c3]";
const eyebrow = "m-0 flex items-center gap-2 text-sm font-medium tracking-[.05em] text-[#a2b2a5]";
const cta = `group inline-flex min-h-13 items-center justify-center gap-6 rounded-[10px] bg-[#d3e5d7] px-6 py-3.5 text-base font-semibold text-[#203327] transition-[background-color,translate] duration-200 hover:-translate-y-0.5 hover:bg-[#e6efdc] [&_svg]:transition-transform [&_svg]:duration-300 hover:[&_svg]:-translate-y-0.5 hover:[&_svg]:translate-x-0.5 ${focus}`;

const navLink = `inline-flex items-center gap-1.5 whitespace-nowrap text-[10px] font-semibold uppercase tracking-[.12em] sm:tracking-[.16em] text-[#d6ddd6] no-underline transition-colors hover:text-white sm:text-xs ${focus}`;

/**
 * Floating split nav: two dark pill halves and a round logo badge in the middle.
 * The bar is masked with a circle slightly larger than the badge, so the notch
 * around the badge is a real transparent cut that works over every section.
 */
function Nav() {
  return (
    <header className="pointer-events-none fixed inset-x-0 top-0 z-40 pt-2.5 sm:pt-4">
      <nav
        aria-label="Main"
        className="relative mx-auto flex h-[68px] w-[calc(100%-24px)] max-w-[820px] items-center sm:h-[84px] sm:w-[calc(100%-48px)]"
      >
        <div className="pointer-events-auto flex h-12 w-full items-center justify-between rounded-full border border-solid border-white/15 bg-[#535956]/75 px-4 [mask-image:radial-gradient(circle_at_center,transparent_42px,#000_42.5px)] sm:h-[52px] sm:px-6 sm:[mask-image:radial-gradient(circle_at_center,transparent_54px,#000_54.5px)]">
          <div className="flex max-w-[calc(50%-44px)] items-center gap-4 sm:max-w-[calc(50%-56px)] lg:gap-6">
            <a href="#experience" className={`${navLink} hidden lg:inline-flex`}>
              Meet Mr.Fund
            </a>
            <a href="#how" className={navLink}>
              How it works
            </a>
          </div>
          <div className="flex max-w-[calc(50%-44px)] items-center gap-4 sm:max-w-[calc(50%-56px)] lg:gap-6">
            <a href="/play" className={navLink}>
              <span className="sm:hidden">Let’s talk</span>
              <span className="hidden sm:inline">Start consultation</span>
              <ArrowUpRight size={15} aria-hidden="true" />
            </a>
          </div>
        </div>
        <a
          href="#top"
          aria-label="Mr.Fund home"
          className={`pointer-events-auto absolute left-1/2 top-1/2 grid size-[66px] -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full sm:size-[84px] bg-[#d3e5d7] text-[#203327] no-underline transition-transform duration-300 hover:scale-[1.04] motion-reduce:transition-none ${focus}`}
        >
          <Mascot size={76} className="size-[58px] rounded-full sm:size-[76px]" />
        </a>
      </nav>
    </header>
  );
}

function Crosshair({ className }: { className: string }) {
  return (
    <Plus
      aria-hidden="true"
      size={20}
      strokeWidth={1.25}
      className={`pointer-events-none absolute hidden text-[#d3e5d7]/60 lg:block ${className}`}
    />
  );
}

function Hero() {
  return (
    <section
      data-hero
      id="top"
      className="relative overflow-hidden px-3 pt-[86px] pb-6 sm:pt-[104px] sm:px-6 sm:pb-14 lg:px-[clamp(24px,9vw,176px)] lg:pb-20"
    >
      <div className="relative isolate mx-auto max-w-[1440px] overflow-hidden border border-solid border-white/10">
        <HeroVideo />
        <div aria-hidden="true" className="absolute inset-0 -z-10 bg-[#0a0c0b]/60" />
        <div className="relative grid min-h-[calc(100svh-92px)] items-end gap-12 px-5 pb-8 pt-16 sm:min-h-[calc(100svh-104px-80px)] sm:px-10 sm:py-14 lg:grid-cols-[1.08fr_.92fr] lg:items-center lg:gap-16 lg:px-14 lg:py-20">
          <Crosshair className="left-1 top-12" />
          <Crosshair className="left-[52%] top-12" />
          <Crosshair className="left-1 bottom-24" />
          <div className="relative z-10 flex flex-col items-start">
            <p data-hero-intro className={`${eyebrow} uppercase tracking-[.2em]! text-xs!`}>
              Your DeFi manager on NEAR
              <span aria-hidden="true" className="h-0.5 w-3 bg-[#d3e5d7]" />
            </p>
            <h1
              data-hero-title
              className={`${display} m-0 mt-4 text-[clamp(40px,11vw,56px)] font-medium leading-[1] tracking-[-.055em] text-[#f1f3ec] sm:mt-5 sm:text-[clamp(48px,6.4vw,96px)]`}
            >
              <span className="block overflow-hidden pb-[.06em]">
                <span data-hero-word className="block">
                  The DeFi manager
                </span>
              </span>
              <span className="block overflow-hidden pb-[.08em]">
                <span
                  data-hero-word
                  className="block font-[family-name:var(--font-editorial)] font-normal italic text-[#d9e2c5]"
                >
                  you can talk to.
                </span>
              </span>
            </h1>
            <p
              data-hero-intro
              className="m-0 mt-5 max-w-[500px] text-[15px] leading-relaxed text-[#b3bdb5] sm:mt-6 sm:text-lg"
            >
              Mr.Fund explains your lending position in plain words, shows the smartest move, and
              acts only within limits you set.
            </p>
            <div
              data-hero-intro
              className="mt-7 flex w-full flex-wrap items-center gap-x-6 gap-y-4 sm:mt-9 sm:w-auto"
            >
              <a
                data-magnetic
                href="/play"
                className={`${cta} max-sm:w-full max-sm:justify-between`}
              >
                Start consultation <ArrowUpRight size={20} />
              </a>
              <p className="m-0 flex items-center gap-3 text-sm leading-snug text-[#a2b0a4]">
                <span className="grid size-9 shrink-0 place-items-center rounded-full border border-solid border-white/12 bg-[#141816]">
                  <ShieldCheck size={16} className="text-[#d3e5d7]" />
                </span>
                <span>
                  Simulated demo.
                  <br />
                  Mock wallet, no real funds.
                </span>
              </p>
            </div>
            <div
              data-hero-intro
              className="mt-8 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-[#a2b0a4] sm:mt-16"
            >
              <span className="flex items-center gap-2 text-xs font-medium uppercase tracking-[.2em] text-[#8a9a8d]">
                Built on
                <span aria-hidden="true" className="h-0.5 w-3 bg-[#d3e5d7]" />
              </span>
              <span className="flex items-center gap-2 text-[#d6dfd6]">
                <Image
                  src="/play/tokens/near.svg"
                  alt=""
                  width={20}
                  height={20}
                  className="size-5 invert"
                />
                NEAR
              </span>
              <span className="text-[#d6dfd6]">Rhea lending</span>
            </div>
          </div>
          <div className="relative z-10 hidden w-full lg:block lg:max-w-[500px] lg:justify-self-end">
            <HeroChat figures={landingFigures()} />
          </div>
        </div>
      </div>
    </section>
  );
}

const featureCards = [
  {
    asset: "position-orbit",
    category: "The briefing",
    title: "The whole picture.",
    text: "Collateral, debt and your buffer. All in one conversation.",
  },
  {
    asset: "decision-route",
    category: "The next move",
    title: "A clearer next move.",
    text: "Repay or supply? Compare the numbers before you make a move.",
  },
  {
    asset: "position-tokens",
    category: "Position",
    title: "Numbers with context.",
    text: "Health, rates and balances. Connected, not scattered.",
  },
  {
    asset: "plain-words",
    category: "Conversation",
    title: "Plain words, please.",
    text: "Ask what it means. Get an explanation you can use.",
  },
  {
    asset: "guardian",
    category: "Guardian",
    title: "Your rules come first.",
    text: "Your reserve, your limits. Guardian follows your policy.",
  },
  {
    asset: "languages",
    category: "Language",
    title: "Your way of asking.",
    text: "Designed for your language. Previewed here with scripted replies.",
  },
] as const;
function Features() {
  return (
    <section id="features" className="relative py-16 sm:py-28">
      <div className={shell}>
        <div data-reveal className="relative mb-8 pt-6 sm:mb-12">
          <span
            data-rule
            aria-hidden="true"
            className="absolute inset-x-0 top-0 h-px origin-left bg-[#343539]"
          />
          <h2
            className={`${display} m-0 text-[clamp(34px,9.5vw,46px)] font-medium leading-[1.05] tracking-[-.045em] sm:whitespace-nowrap sm:text-[clamp(16px,4.3vw,64px)] sm:leading-[1.1]`}
          >
            Less dashboard.{" "}
            <span className="block font-[family-name:var(--font-editorial)] font-normal italic text-[#c7d9bc] sm:inline">
              More understanding.
            </span>
          </h2>
        </div>
        <div data-feature-grid className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {featureCards.map((item, index) => (
            <article
              data-feature-card
              key={item.asset}
              className="group relative flex min-w-0 flex-col overflow-hidden border border-solid border-[#343539] bg-[#17181b] p-5 sm:p-7"
            >
              <div className="flex items-center justify-between gap-3">
                <span className="flex items-baseline gap-3">
                  <span
                    className={`${display} shrink-0 text-[30px] font-semibold sm:text-[34px] leading-none tracking-[-.04em] tabular-nums text-[#c7d9bc]`}
                  >
                    0{index + 1}
                  </span>
                  <span
                    className={`${display} text-[17px] font-medium tracking-[-.02em] text-[#dfe6df] sm:text-[18px]`}
                  >
                    {item.category}
                  </span>
                </span>
                <span aria-hidden="true" className="size-2 rounded-full bg-[#9bb09d] opacity-50" />
              </div>
              <div data-feature-art className="relative my-4 h-[220px] sm:my-5 sm:h-[260px]">
                <FeatureArtwork kind={item.asset} figures={landingFigures()} />
              </div>
              <div className="mt-auto text-[#e7eee5]">
                <h3
                  className={`${display} m-0 text-[25px] font-medium leading-[1.1] tracking-[-.04em] sm:text-[28px]`}
                >
                  {item.title}
                </h3>
                <p className="mb-0 mt-3 text-[15px] leading-relaxed text-[#a0aea3] sm:mt-4 sm:text-base">
                  {item.text}
                </p>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

const marqueeItems = [
  { text: "Money talks.", serif: false },
  { text: "So does Mr.Fund.", serif: true },
  { text: "Plain words.", serif: false },
  { text: "Real numbers.", serif: true },
  { text: "Your limits.", serif: false },
] as const;

/** A slightly tilted sage band. Each half holds the phrases twice so the -50% loop never shows a gap on wide screens. */
function Marquee() {
  return (
    <div aria-hidden="true" className="relative overflow-hidden py-8 sm:py-14">
      <div className="-mx-[5%] -rotate-[1.5deg] border-0 border-y-2 border-solid border-[#203327] bg-[#c7d4bc] py-3 sm:py-5">
        <div data-marquee className="flex w-max items-center">
          {[0, 1].map((half) => (
            <div key={half} className="flex shrink-0 items-center">
              {[0, 1].flatMap((copy) =>
                marqueeItems.map((item) => (
                  <span key={`${copy}-${item.text}`} className="flex items-center">
                    <span
                      className={`whitespace-nowrap px-5 leading-none sm:px-10 ${
                        item.serif
                          ? "font-[family-name:var(--font-editorial)] text-[clamp(27px,4.4vw,62px)] italic text-[#3b5a43]"
                          : `${display} text-[clamp(24px,3.9vw,54px)] font-medium tracking-[-.045em] text-[#1b2c21]`
                      }`}
                    >
                      {item.text}
                    </span>
                    <span className="grid size-8 shrink-0 place-items-center rounded-full bg-[#203327] font-[family-name:var(--font-display)] text-sm font-semibold tracking-[-1px] text-[#c7d4bc] sm:size-12 sm:text-lg">
                      m.
                    </span>
                  </span>
                )),
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function Landing() {
  return (
    <LandingMotion>
      <a
        href="#features"
        className={`sr-only rounded-full bg-[#d3e5d7] px-5 py-3 text-[#203327] focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 ${focus}`}
      >
        Skip to content
      </a>
      <Nav />
      <main>
        <Hero />
        <Marquee />
        <Features />
        <HowItWorks figures={landingFigures()} />
        <TrustSection />
      </main>
      <ClosingFooter />
    </LandingMotion>
  );
}
