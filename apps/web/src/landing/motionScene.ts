import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import Lenis from "lenis";

/** One scroll clock for this route; every pin, listener and ticker is released on exit. */
export function mountLandingMotion(root: HTMLElement, progress: HTMLElement | null) {
  gsap.registerPlugin(ScrollTrigger);
  const lenis = new Lenis({
    autoRaf: false,
    lerp: 0.085,
    smoothWheel: true,
    syncTouch: false,
    anchors: { offset: -92 },
    allowNestedScroll: true,
  });
  const tick = (time: number) => lenis.raf(time * 1000);
  lenis.on("scroll", ScrollTrigger.update);
  gsap.ticker.add(tick);
  const media = gsap.matchMedia();
  const releases: (() => void)[] = [];
  const loops: { tween: gsap.core.Tween | gsap.core.Timeline; trigger: ScrollTrigger }[] = [];
  let disposed = false;
  const context = gsap.context(() => {
    const intro = gsap.timeline({ defaults: { ease: "power3.out" } });
    intro
      .fromTo(
        "[data-hero-word]",
        { yPercent: 115, rotate: 3 },
        { yPercent: 0, rotate: 0, duration: 1.25, stagger: 0.14 },
      )
      .fromTo(
        "[data-hero-intro]",
        { y: 24, autoAlpha: 0 },
        { y: 0, autoAlpha: 1, duration: 0.75, stagger: 0.08 },
        0.45,
      );
    for (const el of root.querySelectorAll<HTMLElement>("[data-reveal]")) {
      gsap.fromTo(
        el,
        { y: 64, autoAlpha: 0 },
        {
          y: 0,
          autoAlpha: 1,
          duration: 0.95,
          ease: "power3.out",
          clearProps: "transform,opacity,visibility",
          scrollTrigger: { trigger: el, start: "top 91%", once: true },
        },
      );
    }
    for (const rule of root.querySelectorAll<HTMLElement>("[data-rule]"))
      gsap.fromTo(
        rule,
        { scaleX: 0 },
        {
          scaleX: 1,
          duration: 1.2,
          ease: "power3.out",
          scrollTrigger: { trigger: rule, start: "top 92%", once: true },
        },
      );
    const seal = root.querySelector("[data-hero-seal]");
    if (seal)
      gsap.to(seal, {
        rotation: 10,
        y: -24,
        ease: "none",
        scrollTrigger: { trigger: seal, start: "top 30%", end: "+=600", scrub: 0.8 },
      });
    const cards = Array.from(root.querySelectorAll<HTMLElement>("[data-feature-card]"));
    for (const [index, card] of cards.entries()) {
      gsap.fromTo(
        card,
        { y: 110, scale: 0.94, autoAlpha: 0, rotate: index % 2 ? 2 : -2 },
        {
          y: 0,
          scale: 1,
          rotate: 0,
          autoAlpha: 1,
          delay: (index % 3) * 0.07,
          duration: 1.05,
          ease: "power3.out",
          clearProps: "transform,opacity,visibility",
          scrollTrigger: { trigger: card, start: "top 94%", once: true },
        },
      );
      const signals = card.querySelectorAll("[data-feature-signal]");
      const pops = card.querySelectorAll("[data-feature-pop]");
      const surfaces = card.querySelectorAll("[data-feature-surface]");
      if (signals.length || pops.length || surfaces.length) {
        const tween = gsap.timeline({ paused: true, repeat: -1, repeatDelay: 1.2 });
        if (signals.length)
          tween.fromTo(
            signals,
            { opacity: 0.12 },
            {
              opacity: 1,
              duration: 0.7,
              stagger: 0.23,
              ease: "sine.inOut",
              repeat: 1,
              yoyo: true,
              repeatDelay: 1.1,
            },
            0,
          );
        if (surfaces.length)
          tween.fromTo(
            surfaces,
            { backgroundColor: "#202125" },
            {
              backgroundColor: "#303238",
              duration: 0.7,
              repeat: 1,
              yoyo: true,
              repeatDelay: 1.1,
            },
            0,
          );
        if (pops.length) {
          gsap.set(pops, { display: "inline-flex", transformOrigin: "50% 50%" });
          tween.fromTo(
            pops,
            { y: 3, scale: 0.97 },
            {
              y: -3,
              scale: 1,
              duration: 0.65,
              stagger: 0.18,
              ease: "sine.inOut",
              repeat: 1,
              yoyo: true,
              repeatDelay: 1.3,
            },
            0.2,
          );
        }
        tween.timeScale(1.7);
        const trigger = ScrollTrigger.create({
          trigger: card,
          start: "top bottom",
          end: "bottom top",
          onToggle: (state) => (state.isActive && !document.hidden ? tween.play() : tween.pause()),
        });
        if (trigger.isActive && !document.hidden) tween.play();
        loops.push({ tween, trigger });
      }
      const art = card.querySelector("[data-feature-art]");
      if (art)
        gsap.fromTo(
          art,
          { y: 16 },
          {
            y: -24,
            ease: "none",
            scrollTrigger: { trigger: card, start: "top bottom", end: "bottom top", scrub: 0.7 },
          },
        );
    }
    for (const el of root.querySelectorAll<HTMLElement>(
      "[data-float], [data-orbit], [data-marquee]",
    )) {
      const marquee = el.hasAttribute("data-marquee"),
        orbit = el.hasAttribute("data-orbit");
      const tween = gsap.to(
        el,
        marquee
          ? { xPercent: -50, duration: 60, ease: "none", repeat: -1, paused: true }
          : orbit
            ? { rotation: 360, duration: 48, ease: "none", repeat: -1, paused: true }
            : {
                y: -13,
                rotation: 1.5,
                duration: 3.1 + (loops.length % 3),
                ease: "sine.inOut",
                yoyo: true,
                repeat: -1,
                paused: true,
              },
      );
      const trigger = ScrollTrigger.create({
        trigger: el,
        start: "top bottom",
        end: "bottom top",
        onToggle: (state) => {
          if (state.isActive && !document.hidden) tween.play();
          else tween.pause();
        },
      });
      if (trigger.isActive) tween.play();
      loops.push({ tween, trigger });
    }
    for (const section of root.querySelectorAll<HTMLElement>("[data-curtain]"))
      gsap.fromTo(
        section,
        { clipPath: "inset(0 4% 0 4% round 54px)" },
        {
          clipPath: "inset(0 0% 0 0% round 0px)",
          ease: "none",
          scrollTrigger: { trigger: section, start: "top 94%", end: "top 18%", scrub: 0.7 },
        },
      );
    if (progress)
      gsap.fromTo(
        progress,
        { scaleX: 0 },
        { scaleX: 1, ease: "none", scrollTrigger: { start: 0, end: "max", scrub: true } },
      );
    media.add(
      {
        large: "(min-width: 1024px) and (min-height: 760px)",
        small: "(max-width: 1023px), (max-height: 759px)",
      },
      (ctx) => {
        const large = ctx.conditions?.large;
        const hero = root.querySelector<HTMLElement>("[data-hero]"),
          heroWindow = root.querySelector<HTMLElement>("[data-hero-window]"),
          visual = root.querySelector<HTMLElement>("[data-hero-pin]");
        if (hero) {
          gsap.to("[data-hero-title]", {
            y: large ? 90 : 36,
            opacity: 0.15,
            ease: "none",
            scrollTrigger: { trigger: hero, start: "top top", end: "center top", scrub: 0.7 },
          });
          const orbit = root.querySelector("[data-hero-orbit]");
          if (orbit)
            gsap.to(orbit, {
              rotation: 70,
              scale: 1.25,
              ease: "none",
              scrollTrigger: { trigger: hero, start: "top top", end: "bottom top", scrub: 1 },
            });
        }
        if (large && visual && heroWindow) {
          const canPin = visual.offsetHeight + 128 <= window.innerHeight;
          const timeline = gsap.timeline({
            scrollTrigger: {
              trigger: visual,
              start: canPin ? "top 104px" : "top 25%",
              end: "+=360",
              pin: canPin,
              scrub: 0.8,
              anticipatePin: 1,
              invalidateOnRefresh: true,
            },
          });
          timeline
            .to(heroWindow, { scale: 1.025, duration: 1, ease: "none" }, 0)
            .fromTo("[data-hero-chat]", { y: 20 }, { y: -12, duration: 1, ease: "none" }, 0);
        }
        const footerArt = root.querySelector<HTMLElement>("[data-footer-art]");
        if (footerArt)
          gsap.fromTo(
            footerArt,
            { y: large ? 24 : 12 },
            {
              y: 0,
              ease: "none",
              scrollTrigger: {
                trigger: footerArt.parentElement,
                start: "top bottom",
                end: "bottom bottom",
                scrub: 0.8,
              },
            },
          );
      },
    );
    if (window.matchMedia("(hover: hover) and (pointer: fine)").matches)
      for (const el of root.querySelectorAll<HTMLElement>("[data-magnetic]")) {
        const x = gsap.quickTo(el, "x", { duration: 0.4, ease: "power3.out" }),
          y = gsap.quickTo(el, "y", { duration: 0.4, ease: "power3.out" });
        const move = (event: PointerEvent) => {
          const rect = el.getBoundingClientRect();
          x((event.clientX - rect.left - rect.width / 2) * 0.15);
          y((event.clientY - rect.top - rect.height / 2) * 0.2);
        };
        const leave = () => {
          x(0);
          y(0);
        };
        el.addEventListener("pointermove", move);
        el.addEventListener("pointerleave", leave);
        releases.push(() => {
          el.removeEventListener("pointermove", move);
          el.removeEventListener("pointerleave", leave);
        });
      }
  }, root);
  const visibility = () => {
    for (const loop of loops)
      loop.trigger.isActive && !document.hidden ? loop.tween.play() : loop.tween.pause();
  };
  document.addEventListener("visibilitychange", visibility);
  const refresh = () => {
    if (!disposed) ScrollTrigger.refresh();
  };
  document.fonts?.ready.then(refresh);
  const refreshFrame = requestAnimationFrame(refresh);
  return () => {
    disposed = true;
    cancelAnimationFrame(refreshFrame);
    document.removeEventListener("visibilitychange", visibility);
    for (const release of releases) release();
    media.revert();
    context.revert();
    lenis.off("scroll", ScrollTrigger.update);
    gsap.ticker.remove(tick);
    lenis.destroy();
  };
}
