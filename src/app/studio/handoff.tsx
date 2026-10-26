"use client";

import { useEffect, useRef } from "react";
import { EXAMPLES, type Example } from "@/lib/agent/examples";
import { NUDGES, type Nudge } from "@/lib/agent/options";

// A featured treatment's page hands off to the studio in two ways:
// - Its rework chips leave { from, nudge } in sessionStorage and open /studio, which opens the pre-built board (a cache
//   hit, so at once), then runs the rework live, as the chip promised. Not in the URL: a reload or a shared link must
//   not run it again, and cleaning the URL afterwards would remount the studio (Next keeps a page per URL) and cancel
//   the run.
// - Its stand-in, when a build has no pre-built board to open, links to /studio?fill=<slug>: the brief is filled in, and
//   nothing runs until the director presses Build.

const KEY = "itsgiving:handoff";

export interface Handoff {
  example: Example;
  /** Run the brief now (it opens from the pre-built set), rather than only fill it in. */
  open: boolean;
  nudge?: Nudge;
}

/** Called by a featured page's rework chip, just before it opens the studio. */
export function handOff(slug: string, nudge: Nudge) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ from: slug, nudge }));
  } catch {
    // Storage blocked: the studio opens without the board, as if from its own link.
  }
}

/**
 * What the studio was handed: a rework from storage, or a brief to fill from the URL. Only featured examples, and only
 * the stored kind runs: a link alone never starts a live build.
 */
export function parseHandoff(stored: string | null, search: string): Handoff | null {
  let from: unknown;
  let nudge: unknown;
  try {
    ({ from, nudge } = JSON.parse(stored ?? "null") ?? {});
  } catch {
    // ignore a malformed entry
  }
  const featured = (slug: unknown) => EXAMPLES.find((e) => e.featured && e.slug === slug);
  const opened = featured(from);
  if (opened) return { example: opened, open: true, nudge: NUDGES.find((n) => n === nudge) };
  const filled = featured(new URLSearchParams(search).get("fill"));
  return filled ? { example: filled, open: false } : null;
}

/**
 * Takes the handoff once, when the studio has settled: on a timer, so React's development double-run of effects (which
 * would cancel a run just started) is over first, and the stored entry is removed only when it's acted on.
 */
export function HandoffReader({ onOpen }: { onOpen: (handoff: Handoff) => void }) {
  const done = useRef(false);
  useEffect(() => {
    const timer = setTimeout(() => {
      if (done.current) return;
      done.current = true;
      let stored: string | null = null;
      try {
        stored = sessionStorage.getItem(KEY);
        sessionStorage.removeItem(KEY);
      } catch {
        // nothing stored, or storage blocked
      }
      const handoff = parseHandoff(stored, window.location.search);
      if (handoff) onOpen(handoff);
    }, 0);
    return () => clearTimeout(timer);
  }, [onOpen]);
  return null;
}
