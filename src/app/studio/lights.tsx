"use client";

import { useEffect, type RefObject } from "react";

/**
 * Lights down: as `target` (the landing's posters) comes up the screen, either room dims to the show's near black,
 * two letterbox bars close in and the projector comes on over the posters (landing.tsx); scrolling back up brings the
 * house lights back. It follows the scroll rather than a clock, and with reduced motion it switches at the halfway
 * point instead of fading.
 */
export function useLightsDown(target: RefObject<HTMLElement | null>, enabled: boolean) {
  useEffect(() => {
    const root = document.documentElement;
    if (!enabled) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    let frame = 0;
    let last = -1;
    const update = () => {
      frame = 0;
      const el = target.current;
      if (!el) return;
      const top = el.getBoundingClientRect().top / window.innerHeight;
      // Up while the posters' top edge is below 55% of the screen, fully down once it reaches 25%: a short fade, so
      // the half-lit room in between passes quickly.
      let lights = Math.min(1, Math.max(0, (0.55 - top) / 0.3));
      if (reduce.matches) lights = lights >= 0.5 ? 1 : 0;
      lights = Math.round(lights * 100) / 100;
      if (lights !== last) {
        last = lights;
        root.style.setProperty("--lights", String(lights));
      }
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      root.style.removeProperty("--lights");
    };
  }, [target, enabled]);
}

/** The bars themselves: black, fixed to the screen's top and bottom edges, scaled by --lights. */
export function LetterboxBars() {
  return (
    <>
      <div aria-hidden className="letterbox-bar top print:hidden" />
      <div aria-hidden className="letterbox-bar bottom print:hidden" />
    </>
  );
}
