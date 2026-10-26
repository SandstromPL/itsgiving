"use client";

import { createContext, useContext, useMemo, useSyncExternalStore, type ReactNode } from "react";
import { NUDGE_LABELS, type Nudge } from "@/lib/agent/options";

/**
 * Two registers for the words around the work: Gen Z by default, plain English in "unc mode" ("unc" is slang for
 * someone older and out of touch) for producers, label people and judges. The treatment itself, Qloo's evidence,
 * the run log and every button that does something read the same in both.
 */
interface Lines {
  thinking: { deep: string; quick: string };
  cooking: string;
  cookingAgain: string;
  slowBurn: string;
  pickTitle: string;
  take: (n: number) => string;
  nudges: Record<Nudge, string>;
  done: string;
  back: string;
  giving: string;
  shared: string;
  failTitle: string;
  rateTitle: string;
  titleWindow: string;
  interval: { title: string; line: string };
  directorsCut: string;
  footer: string;
  nowShowing: string;
  /** The last poster in "Now showing": the treatment the reader hasn't made yet. */
  nextUp: { label: string; title: string };
  yourPoster: string;
  makeItYours: string;
  tryOne: string;
  watchItWork: string;
}

const GENZ: Lines = {
  thinking: { deep: "lock in", quick: "speedrun" },
  cooking: "letting it cook",
  cookingAgain: "letting it cook again",
  slowBurn: "it's a slow burn. still going.",
  pickTitle: "pick your fighter",
  take: (n) => `take ${n}`,
  nudges: { darker: "villain arc", more_90s: "90s core", deeper_cuts: "gatekeep mode", cheaper_locations: "budget era" },
  done: "ate. no crumbs.",
  back: "we're so back",
  giving: "it's giving",
  shared: "same energy as your taste",
  failTitle: "it's so over",
  rateTitle: "touch grass, then try again",
  titleWindow: "pick your fighter",
  interval: { title: "INTERVAL", line: "grab a cutting chai. the second half is next." },
  directorsCut: "director's cut unlocked",
  footer: "receipts, not slop.",
  nowShowing: "Now showing",
  nextUp: { label: "coming soon", title: "yours" },
  yourPoster: "your poster",
  makeItYours: "Make it yours",
  tryOne: "Try one",
  watchItWork: "Watch it work",
};

const PLAIN: Lines = {
  thinking: { deep: "Deep", quick: "Quick" },
  cooking: "Building the treatment",
  cookingAgain: "Reworking the treatment",
  slowBurn: "Still working. Deep runs can take up to two minutes.",
  pickTitle: "Which one do you mean?",
  take: (n) => `Version ${n}`,
  nudges: NUDGE_LABELS,
  done: "Treatment ready",
  back: "Back on track",
  giving: "Tone",
  shared: "shared with your taste",
  failTitle: "The treatment didn't finish",
  rateTitle: "Too many requests",
  titleWindow: "Title typeface",
  interval: { title: "Intermission", line: "The second half of the treatment is next." },
  directorsCut: "Director's cut on",
  footer: "Every pick is backed by Qloo data.",
  nowShowing: "Featured treatments",
  nextUp: { label: "Your own", title: "Make your own" },
  yourPoster: "Your treatment",
  makeItYours: "More options",
  tryOne: "Examples",
  watchItWork: "How it works",
};

const STORAGE_KEY = "itsgiving:unc";

/**
 * The register, remembered per browser. Storage can be missing or blocked: then the choice lives in memory for the
 * visit, and the page works the same.
 */
const register = {
  memory: undefined as boolean | undefined,
  listeners: new Set<() => void>(),
  read(): boolean {
    if (register.memory !== undefined) return register.memory;
    try {
      return localStorage.getItem(STORAGE_KEY) === "1";
    } catch {
      return false;
    }
  },
  write(unc: boolean) {
    register.memory = unc;
    try {
      localStorage.setItem(STORAGE_KEY, unc ? "1" : "0");
    } catch {
      // remembered for this visit only
    }
    register.listeners.forEach((listener) => listener());
  },
  subscribe(listener: () => void) {
    register.listeners.add(listener);
    return () => register.listeners.delete(listener);
  },
};

const LingoContext = createContext<{ t: Lines; unc: boolean; setUnc: (unc: boolean) => void }>({
  t: GENZ,
  unc: false,
  setUnc: () => {},
});

export function LingoProvider({ children }: { children: ReactNode }) {
  // The server renders the default register; the browser then reads the remembered one.
  const unc = useSyncExternalStore(register.subscribe, register.read, () => false);
  const value = useMemo(() => ({ t: unc ? PLAIN : GENZ, unc, setUnc: register.write }), [unc]);
  return <LingoContext value={value}>{children}</LingoContext>;
}

export const useLingo = () => useContext(LingoContext);

export function UncSwitch() {
  const { unc, setUnc } = useLingo();
  return (
    <button
      type="button"
      role="switch"
      aria-checked={unc}
      onClick={() => setUnc(!unc)}
      title="unc mode: plain English for everything around the treatment"
      className="flex min-h-11 items-center gap-2.5 rounded-full border border-foreground bg-card py-1.5 pr-4 pl-2 text-[15px] font-bold whitespace-nowrap print:hidden"
    >
      <span
        aria-hidden
        className={`relative h-7 w-[46px] shrink-0 rounded-full border-2 border-foreground ${unc ? "bg-foreground" : "bg-card"}`}
      >
        <span
          className={`absolute top-[3px] size-[18px] rounded-full transition-[left] duration-200 ${unc ? "left-[21px] bg-accent" : "left-[3px] bg-foreground"}`}
        />
      </span>
      unc mode
    </button>
  );
}
