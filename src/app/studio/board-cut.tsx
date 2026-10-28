"use client";

import { useLingo } from "./lingo";

// What a board shows only in the director's cut (eggs.tsx sets data-cut on <html>): the film edge, the INTERVAL card and
// the date stamps on location photos.

/** A strip of film under the beats, edge-printed with the house stock and the beat numbers. Director's cut only. */
export function FilmEdge({ count }: { count: number }) {
  const holes = "mx-2.5 h-2.5 rounded-[3px] bg-[repeating-linear-gradient(90deg,#f2f0ea_0_14px,transparent_14px_26px)]";
  return (
    <div aria-hidden className="flex flex-col gap-2 rounded-2xl bg-[#1b1a17] py-2.5 print:hidden">
      <span className={holes} />
      <span className="truncate px-4 font-mono text-[14px] tracking-[0.14em] text-[#f2b33d]">
        ITSGIVING 400 {Array.from({ length: count }, (_, i) => `▸ ${i + 1}`).join(" ")}
      </span>
      <span className={holes} />
    </div>
  );
}

/** Halfway down the board, an interval card, the way a Hindi film breaks for chai. Director's cut only. */
export function Interval() {
  const lingo = useLingo().t;
  return (
    <aside
      aria-label={lingo.interval.title}
      className="flex flex-col items-center gap-2 rounded-[28px] bg-[#7a1238] px-6 py-10 text-center print:hidden"
    >
      <p
        className="text-[clamp(2.75rem,6vw,4rem)] leading-none tracking-[0.04em] text-[#ffe7a3]"
        style={{ fontFamily: "var(--font-tc-yatra), serif" }}
      >
        {lingo.interval.title}
      </p>
      <p className="text-[16px] text-[#fff3d6]">{lingo.interval.line}</p>
    </aside>
  );
}

/**
 * A digicam's date stamp, 'YY MM DD, for the day the treatment was built. In UTC, so a board rendered on the server
 * (a featured page) reads the same in every visitor's browser.
 */
export function dateStamp(iso: string): string {
  const d = new Date(iso);
  const two = (n: number) => String(n).padStart(2, "0");
  return `'${two(d.getUTCFullYear() % 100)} ${two(d.getUTCMonth() + 1)} ${two(d.getUTCDate())}`;
}
