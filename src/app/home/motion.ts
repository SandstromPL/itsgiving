// The homepage's small motion helpers: the 1B rack focus and the reduced-motion check. Plain functions, browser only.

export const SOFT = "cubic-bezier(0.22, 1, 0.36, 1)";

export const clamp = (v: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));

export const reducedMotion = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * 1B rack focus: each part sharpens in turn, as a focus puller racks across a title. Under reduced motion, a fade. The
 * parts stay hidden through their delay (`fill: backwards`), so a page can hand them over hidden or not.
 */
export function rackFocus(
  parts: Element[],
  {
    stagger = 110,
    duration = 1000,
    scale = 1.08,
    blur = 16,
    delay = 0,
  }: { stagger?: number; duration?: number; scale?: number; blur?: number; delay?: number } = {},
) {
  const reduce = reducedMotion();
  return parts.map((part, i) =>
    part.animate(
      reduce
        ? [{ opacity: 0 }, { opacity: 1 }]
        : [
            { opacity: 0, filter: `blur(${blur}px)`, transform: `scale(${scale})` },
            { opacity: 1, filter: "blur(0px)", transform: "none" },
          ],
      { duration: reduce ? 320 : duration, delay: delay + (reduce ? i * 40 : i * stagger), easing: SOFT, fill: "backwards" },
    ),
  );
}

/** Runs `step` once a frame for `ms`, eased, then resolves. */
export function tween(ms: number, step: (eased: number) => void, curve: (t: number) => number = (t) => t) {
  return new Promise<void>((resolve) => {
    const start = performance.now();
    const tick = (now: number) => {
      const t = ms <= 0 ? 1 : clamp((now - start) / ms);
      step(curve(t));
      if (t < 1) requestAnimationFrame(tick);
      else resolve();
    };
    requestAnimationFrame(tick);
  });
}

export const outCubic = (t: number) => 1 - (1 - t) ** 3;

/** The header's height while it shows (the lead's `--head`), for what pins under it. */
export function headHeight() {
  const value = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--head"));
  return Number.isFinite(value) && value > 0 ? value : 72;
}
