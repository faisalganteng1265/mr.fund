"use client";

import { useEffect, useRef } from "react";
import { useLandingMotion } from "./LandingMotion";

/** Decorative background loop. Pauses with the motion toggle and for reduced-motion users; the poster stays visible. */
export function HeroVideo() {
  const video = useRef<HTMLVideoElement>(null);
  const { paused, reduced } = useLandingMotion();
  const still = paused || reduced;

  useEffect(() => {
    const el = video.current;
    if (!el) return;
    if (still) {
      el.pause();
      return;
    }
    // Autoplay can be refused (data saver, browser policy); the poster then stays.
    el.play().catch(() => {});
  }, [still]);

  return (
    <video
      ref={video}
      aria-hidden="true"
      tabIndex={-1}
      muted
      loop
      playsInline
      preload="metadata"
      poster="/video/hero-poster.webp"
      className="pointer-events-none absolute inset-0 -z-20 size-full object-cover"
    >
      <source src="/video/gemini_generated_video_92f34b13.mp4" type="video/mp4" />
    </video>
  );
}
