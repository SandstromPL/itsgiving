"use client";

import { useEffect, useRef } from "react";
import { EXAMPLES, type Example } from "@/lib/agent/examples";
import { NUDGES, type Nudge } from "@/lib/agent/options";
import type { Treatment } from "@/lib/agent/types";

// Other pages hand off to the studio:
// - A featured treatment's rework chips leave { from, nudge } in sessionStorage and open /studio, which opens the
//   pre-built board (a cache hit, so at once), then runs the rework live, as the chip promised. Not in the URL: a
//   reload or a shared link must not run it again, and cleaning the URL afterwards would remount the studio (Next keeps
//   a page per URL) and cancel the run.
// - Its stand-in, when a build has no pre-built board to open, links to /studio?fill=<slug>: the brief is filled in, and
//   nothing runs until the director presses Build.
// - A saved or shared treatment's rework chips, and Save on its way to signing in, leave the board itself: there's no
//   cache to open it from. Save's comes back after sign-in and is saved then.

const KEY = "itsgiving:handoff";

export type Handoff =
  | {
      kind: "example";
      example: Example;
      /** Run the brief now (it opens from the pre-built set), rather than only fill it in. */
      open: boolean;
      nudge?: Nudge;
    }
  | {
      kind: "board";
      treatment: Treatment;
      /** The server's seal, when this board can be saved. */
      seal?: string;
      nudge?: Nudge;
      /** Save it once it's open: the director pressed Save, then signed in. */
      save?: boolean;
    };

function leave(value: object) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(value));
  } catch {
    // Storage blocked: the studio opens without the board, as if from its own link.
  }
}

/** Called by a featured page's rework chip, just before it opens the studio. */
export function handOff(slug: string, nudge: Nudge) {
  leave({ from: slug, nudge });
}

/** Called by a saved or shared treatment's rework chip, and by Save just before it leaves to sign in. */
export function handOffBoard(board: { treatment: Treatment; seal?: string; nudge?: Nudge; save?: boolean }) {
  leave({ board: { ...board, at: Date.now() } });
}

/**
 * How long a "save it after sign-in" stands. A sign-in that's abandoned leaves the board in this tab's storage; much
 * later, with someone perhaps signed in another way, the studio still opens it but waits for a click to save it.
 */
export const SAVE_WINDOW_MS = 15 * 60 * 1000;

/** Enough of a treatment to open as a board; the server checks the rest (its seal) before anything is saved. */
function isTreatment(value: unknown): value is Treatment {
  const t = value as Partial<Treatment> | null;
  return typeof t?.title === "string" && typeof t.id === "string" && typeof t.brief?.city === "string" && Array.isArray(t.references);
}

/**
 * What the studio was handed: a rework or a board from storage, or a brief to fill from the URL. Only featured
 * examples by name, and only the stored kinds run: a link alone never starts a live build.
 */
export function parseHandoff(stored: string | null, search: string, now = Date.now()): Handoff | null {
  let from: unknown;
  let nudge: unknown;
  let board: { treatment?: unknown; seal?: unknown; nudge?: unknown; save?: unknown; at?: unknown } | undefined;
  try {
    ({ from, nudge, board } = JSON.parse(stored ?? "null") ?? {});
  } catch {
    // ignore a malformed entry
  }
  const known = (n: unknown) => NUDGES.find((x) => x === n);
  if (board && isTreatment(board.treatment)) {
    return {
      kind: "board",
      treatment: board.treatment,
      seal: typeof board.seal === "string" ? board.seal : undefined,
      nudge: known(board.nudge),
      save: board.save === true && typeof board.at === "number" && now - board.at >= 0 && now - board.at < SAVE_WINDOW_MS,
    };
  }
  const featured = (slug: unknown) => EXAMPLES.find((e) => e.featured && e.slug === slug);
  const opened = featured(from);
  if (opened) return { kind: "example", example: opened, open: true, nudge: known(nudge) };
  const filled = featured(new URLSearchParams(search).get("fill"));
  return filled ? { kind: "example", example: filled, open: false } : null;
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
