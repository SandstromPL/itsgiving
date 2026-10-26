"use client";

import { useEffect, useRef, useState } from "react";
import type { Treatment } from "@/lib/agent/types";
import { useLingo } from "./lingo";
import { CameraMark } from "./mark";

// Easter eggs: harmless, hidden, and never in the way of the work.

const KONAMI = ["arrowup", "arrowup", "arrowdown", "arrowdown", "arrowleft", "arrowright", "arrowleft", "arrowright", "b", "a"];

const typing = (target: EventTarget | null) =>
  target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));

/** The Konami code toggles the director's cut; Escape leaves it. Keys typed into a field don't count. */
export function useDirectorsCut(): [boolean, () => void] {
  const [on, setOn] = useState(false);
  const step = useRef(0);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOn(false);
      if (typing(event.target)) return;
      const key = event.key.toLowerCase();
      step.current = key === KONAMI[step.current] ? step.current + 1 : key === KONAMI[0] ? 1 : 0;
      if (step.current === KONAMI.length) {
        step.current = 0;
        setOn((was) => !was);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return [on, () => setOn(false)];
}

/** Letterbox bars and grain over the whole page, like the board is being projected. */
export function DirectorsCut({ on, onExit }: { on: boolean; onExit: () => void }) {
  const { t } = useLingo();
  if (!on) return null;
  return (
    <div className="print:hidden">
      <div aria-hidden className="pointer-events-none fixed inset-0 z-[60]">
        <div className="absolute inset-x-0 top-0 h-[9vh] bg-black" />
        <div className="absolute inset-x-0 bottom-0 h-[9vh] bg-black" />
        <div className="absolute inset-0 bg-[radial-gradient(rgb(0_0_0/0.07)_1px,transparent_1.2px)] bg-[length:3px_3px]" />
      </div>
      <p
        role="status"
        className="fixed top-[calc(9vh+1rem)] right-4 z-[61] rotate-2 rounded-xl bg-accent px-3.5 py-2 font-bold text-[#121211]"
      >
        {t.directorsCut}
      </p>
      <button
        type="button"
        onClick={onExit}
        className="fixed right-4 bottom-[calc(9vh+1rem)] z-[61] rounded-full bg-[#121211] px-4 py-2.5 text-sm font-bold text-white"
      >
        Exit director&apos;s cut
      </button>
    </div>
  );
}

const CYCLE = ["it's giving… A24", "it's giving… Wes Anderson", "it's giving… Wong Kar-wai", "it's giving… Bollywood"];

/**
 * The wordmark: a lime cinema camera on an ink tile, like the tab icon (src/app/icon.svg), and the name. Each tap also
 * calls `onTap` (on a treatment, that's the way home); five quick taps cycle through what it could be giving.
 */
export function Wordmark({ onTap }: { onTap?: () => void }) {
  const taps = useRef<number[]>([]);
  const [line, setLine] = useState<number | null>(null);

  useEffect(() => {
    if (line === null) return;
    const timer = setTimeout(() => setLine(line + 1 < CYCLE.length ? line + 1 : null), 1400);
    return () => clearTimeout(timer);
  }, [line]);

  const tap = () => {
    onTap?.();
    const now = Date.now();
    taps.current = [...taps.current.filter((at) => now - at < 2000), now];
    if (taps.current.length >= 5 && line === null) {
      taps.current = [];
      setLine(0);
    }
  };

  return (
    <button
      type="button"
      onClick={tap}
      aria-label={onTap ? "itsgiving, home" : "itsgiving"}
      className="flex items-center gap-2.5 rounded-xl text-left"
    >
      {/* An ink tile in either room: in the dark one its edge keeps it visible. */}
      <span aria-hidden className="grid h-[26px] w-[34px] shrink-0 place-items-center rounded-lg bg-[#121211] ring-1 ring-edge/60">
        <CameraMark height={17} />
      </span>
      <span aria-hidden className="text-[27px] leading-none font-extrabold tracking-[-0.045em] whitespace-nowrap">
        {line === null ? "itsgiving" : CYCLE[line]}
      </span>
    </button>
  );
}

const NOTE = [
  "▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄",
  "   itsgiving, director's console",
  "▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀",
  "you found the receipts drawer.",
  "every film, brand and place on the board was ranked by Qloo for this audience.",
  "the model only writes around them.",
  "type receipts() to list the Qloo calls behind the treatment on screen.",
].join("\n");

/** A note in DevTools for whoever opens it, and receipts() to list the Qloo calls behind the board. */
export function useConsoleNote(treatment: Treatment | null) {
  useEffect(() => {
    console.log(`%c${NOTE}`, "font-family: monospace; line-height: 1.5");
  }, []);
  useEffect(() => {
    const receipts = () => {
      const rows = treatment
        ? Object.entries(treatment.qloo.steps).flatMap(([step, calls]) =>
            (calls ?? []).map((call) => ({
              step,
              request: `GET ${call.path}`,
              status: call.status,
              ms: call.durationMs,
              cached: call.cached,
            })),
          )
        : [];
      console.table(rows);
      return `${rows.length} Qloo calls`;
    };
    Object.assign(window, { receipts });
  }, [treatment]);
}
