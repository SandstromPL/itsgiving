"use client";

import Lenis from "lenis";
import { useEffect, useRef } from "react";

// Smooth scrolling and the one frame loop every scroll scene shares. Lenis (MIT) smooths the wheel and trackpad on the
// pages that render <SmoothScroll />, never in the studio and never under reduced motion; it scrolls the window
// natively, so Back/Forward restoring, anchors and IntersectionObserver keep working. Scenes read the scroll position
// once a frame through useScrollFrame instead of each listening to scroll.

type Listener = (y: number) => void;
const listeners = new Set<Listener>();
let lenis: Lenis | null = null;
let raf = 0;
let lastY = -1;
let dirty = true;
/** Frames since the page last moved: without Lenis the loop sleeps after half a second of stillness. */
let still = 0;
let listening = false;

function loop(time: number) {
  lenis?.raf(time);
  const y = window.scrollY;
  if (y !== lastY || dirty) {
    lastY = y;
    dirty = false;
    still = 0;
    listeners.forEach((listener) => listener(y));
  } else still++;
  raf = lenis || (listeners.size && still < 30) ? requestAnimationFrame(loop) : 0;
}

function wake() {
  dirty = true;
  if (!raf) raf = requestAnimationFrame(loop);
}

/** A scroll the loop didn't drive (a key, a jump, Back) wakes it. */
const moved = () => {
  if (!raf) raf = requestAnimationFrame(loop);
};

const reduceMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Smooth scrolling for as long as the page that renders it is on screen. */
export function SmoothScroll() {
  useEffect(() => {
    if (reduceMotion()) return;
    const smooth = new Lenis({ lerp: 0.1, smoothWheel: true, autoRaf: false, allowNestedScroll: true, stopInertiaOnNavigate: true });
    lenis = smooth;
    wake();
    return () => {
      smooth.destroy();
      if (lenis === smooth) lenis = null;
    };
  }, []);
  return null;
}

/**
 * Calls `onFrame` with the scroll position once a frame while the page scrolls, and once on mount and on resize. The
 * latest `onFrame` is always the one called, so it can close over state.
 */
export function useScrollFrame(onFrame: Listener) {
  const latest = useRef(onFrame);
  useEffect(() => {
    latest.current = onFrame;
  });
  useEffect(() => {
    const listener: Listener = (y) => latest.current(y);
    listeners.add(listener);
    if (!listening) {
      listening = true;
      addEventListener("scroll", moved, { passive: true });
    }
    wake();
    addEventListener("resize", wake);
    return () => {
      listeners.delete(listener);
      removeEventListener("resize", wake);
    };
  }, []);
}

/** Asks every scene to read the page again on the next frame: after a layout change that isn't a resize. */
export const refreshScenes = wake;

/** Jumps to `y` at once, through Lenis when it's running, so it doesn't glide back to where it was. */
export function scrollToY(y: number) {
  if (lenis) lenis.scrollTo(y, { immediate: true, force: true });
  else window.scrollTo(0, y);
}

/** Holds the page still (a dialog is open, a cut is playing) or lets it move again. */
export function holdScroll(hold: boolean) {
  if (!lenis) return;
  if (hold) lenis.stop();
  else lenis.start();
}
