"use client";

import { Fragment, useRef } from "react";
import { useScrollFrame } from "../smooth";
import { clamp, reducedMotion } from "./motion";

const PITCH =
  "For music-video and short-film directors: give it an artist, or the films your short is after, and a city. It reads what that audience actually loves on Qloo and writes a treatment you can pitch, with receipts for every pick.";
const WORDS = PITCH.split(" ");

/**
 * The pitch, alone on its screen, lighting up word by word as you scroll through it. Under reduced motion it's a plain
 * paragraph in the page.
 */
export function Pitch() {
  const section = useRef<HTMLElement>(null);
  const para = useRef<HTMLParagraphElement>(null);
  const s = useRef({ pinned: false, top: 0, len: 1, vw: 0, vh: 0 }).current;

  const measure = () => {
    const sec = section.current;
    const p = para.current;
    if (!sec || !p) return;
    s.vw = innerWidth;
    s.vh = innerHeight;
    s.pinned = !reducedMotion();
    if (s.pinned) delete sec.dataset.static;
    else sec.dataset.static = "";
    sec.style.height = s.pinned ? `${Math.round(innerHeight * 2.1)}px` : "";
    s.top = sec.getBoundingClientRect().top + scrollY;
    s.len = Math.max(1, sec.offsetHeight - innerHeight);
    if (!s.pinned) {
      p.querySelectorAll<HTMLElement>(".w").forEach((w) => w.style.removeProperty("--o"));
      p.style.transform = "";
    }
  };

  useScrollFrame((y) => {
    if (innerWidth !== s.vw || Math.abs(innerHeight - s.vh) > 150) measure();
    const p = para.current;
    if (!s.pinned || !p) return;
    // The words light up from when the block is a third of the way in to halfway through its hold.
    const from = s.top - innerHeight * 0.66;
    const q = clamp((y - from) / (s.top + s.len * 0.5 - from));
    const words = p.querySelectorAll<HTMLElement>(".w");
    const n = words.length;
    words.forEach((w, i) => w.style.setProperty("--o", (0.14 + 0.86 * clamp((q * (n + 6) - i) / 6)).toFixed(3)));
    p.style.transform = `translateY(${((1 - clamp((y - from) / (innerHeight * 0.66))) * 48).toFixed(1)}px)`;
  });

  return (
    <section ref={section} className="say" aria-label="What itsgiving does">
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
