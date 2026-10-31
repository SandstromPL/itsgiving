"use client";

import { Fragment, useRef } from "react";
import { useScrollFrame } from "../smooth";
import { clamp, reducedMotion } from "./motion";

const PITCH =
  "For music-video and short-film directors: give it an artist, or the films your short is after, and a city. It reads what that audience actually loves on Qloo and writes a treatment you can pitch, with receipts for every pick.";
const WORDS = PITCH.split(" ");

/**
 * The pitch, at its own height, lighting up word by word as it comes up the screen. Under reduced motion it's a plain
 * paragraph.
 */
export function Pitch() {
  const para = useRef<HTMLParagraphElement>(null);
  const s = useRef({ moving: false, top: 0, vw: 0, vh: 0 }).current;

  const measure = () => {
    const p = para.current;
    if (!p) return;
    s.vw = innerWidth;
    s.vh = innerHeight;
    s.moving = !reducedMotion();
    p.style.transform = "";
    s.top = p.getBoundingClientRect().top + scrollY;
    if (!s.moving) p.querySelectorAll<HTMLElement>(".w").forEach((w) => w.style.removeProperty("--o"));
  };

  useScrollFrame((y) => {
    if (innerWidth !== s.vw || Math.abs(innerHeight - s.vh) > 150) measure();
    const p = para.current;
    if (!s.moving || !p) return;
    // Where the paragraph's top is, as a share of the screen: the words light up from when it comes on at the foot
    // until it is a third of the way down, as it rises the last 48px into place.
    const at = (s.top - y) / innerHeight;
    const q = clamp((0.92 - at) / 0.58);
    const words = p.querySelectorAll<HTMLElement>(".w");
    const n = words.length;
    words.forEach((w, i) => w.style.setProperty("--o", (0.14 + 0.86 * clamp((q * (n + 6) - i) / 6)).toFixed(3)));
    p.style.transform = `translateY(${((1 - clamp((0.92 - at) / 0.3)) * 48).toFixed(1)}px)`;
  });

  return (
    <section className="say" aria-label="What itsgiving does">
      <div className="say-stage">
        <div className="mx-auto w-full max-w-[80rem] px-4 sm:px-8">
          <p ref={para} className="say-p text-subsection lg:text-display-sm">
            {WORDS.map((word, i) => (
              <Fragment key={i}>
                <span className="w">{word}</span>
                {i < WORDS.length - 1 && " "}
              </Fragment>
            ))}
          </p>
        </div>
      </div>
    </section>
  );
}
