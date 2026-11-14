// @vitest-environment jsdom
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { afterEach, expect, it, vi } from "vitest";
import { mountLandingMotion } from "../src/landing/motionScene";

afterEach(() => {
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});
it.each([
  { desktop: false, heroHeight: 650 },
  { desktop: true, heroHeight: 770 },
  { desktop: true, heroHeight: 620 },
])(
  "restores native flow after scroll motion (desktop: $desktop, hero: $heroHeight)",
  ({ desktop, heroHeight }) => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn((query: string) => ({
        matches: query.includes("min-width")
          ? desktop
          : query.includes("max-width")
            ? !desktop
            : false,
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
      })),
    );
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    vi.stubGlobal("scrollTo", vi.fn());
    document.body.innerHTML = `<div id="landing"><div data-hero><span data-hero-word>Money</span><h1 data-hero-title></h1><p data-hero-intro></p><div data-hero-orbit></div><div data-hero-pin><div data-hero-visual><div data-hero-window></div><div data-hero-chat></div></div></div></div><div data-reveal>Visible content</div><span data-rule></span><div data-hero-seal>m.</div><article data-feature-card><div data-feature-art><svg><circle data-feature-signal /></svg><span data-feature-pop>Fund</span></div></article><div data-curtain></div><div data-float></div><footer><div data-footer-art></div></footer><div id="progress"></div></div>`;
    const root = document.getElementById("landing"),
      progress = document.getElementById("progress");
    if (!root) throw new Error("Missing fixture");
    const heroPin = root.querySelector<HTMLElement>("[data-hero-pin]");
    if (!heroPin) throw new Error("Missing hero");
    Object.defineProperty(heroPin, "offsetHeight", { value: heroHeight });
    const before = ScrollTrigger.getAll().length;
    const dispose = mountLandingMotion(root, progress);
    expect(ScrollTrigger.getAll().length).toBeGreaterThan(before);
    expect(document.documentElement.classList.contains("lenis")).toBe(true);
    expect(root.querySelector<HTMLElement>("[data-hero-word]")?.style.transform).not.toBe("");
    expect(heroPin.parentElement?.classList.contains("pin-spacer")).toBe(
      desktop && heroHeight + 128 <= window.innerHeight,
    );
    dispose();
    expect(root.querySelector(".pin-spacer")).toBeNull();
    expect(root.querySelector<SVGElement>("[data-feature-signal]")?.style.opacity).toBe("");
    expect(root.querySelector<HTMLElement>("[data-footer-art]")?.style.transform).toBe("");
    expect(ScrollTrigger.getAll().length).toBe(before);
    expect(document.documentElement.classList.contains("lenis")).toBe(false);
  },
);
