"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import type { BriefInput } from "@/lib/agent/brief";
import type { Nudge } from "@/lib/agent/options";
import type { AgentEvent, Ambiguity, StepEvent, Treatment } from "@/lib/agent/types";
import type { LlmMode } from "@/lib/llm/config";
import type { QlooMode } from "@/lib/qloo/client";
import { Board, EmptyBoard, type Example } from "./board";
import { BriefForm, EMPTY_FORM, splitTitles, type FormState } from "./brief-form";
import { ModeBadges } from "./parts";
import { Picker } from "./picker";
import { streamTreatment } from "./stream";
import { Timeline } from "./timeline";

type Phase = "idle" | "running" | "needs_input" | "done" | "error";

// Names that exist in Qloo and in the mock catalog, so every example works in both modes.
const EXAMPLES: Example<FormState>[] = [
  {
    label: "Prateek Kuhad, shot in Mumbai",
    form: { ...EMPTY_FORM, artist: "Prateek Kuhad", city: "Mumbai", directorFilms: "In the Mood for Love\nDonnie Darko\nRockstar" },
  },
  {
    label: "Charli xcx, shot in New York",
    form: { ...EMPTY_FORM, artist: "Charli xcx", city: "New York", budget: "premium", directorFilms: "Chungking Express\nDrive" },
  },
  {
    label: "A short film after Past Lives and Aftersun",
    form: { ...EMPTY_FORM, format: "short_film", touchstones: "Past Lives\nAftersun", city: "Mumbai", budget: "shoestring", directorFilms: "Masaan" },
  },
  {
    label: "Frank Ocean, with a title to pick",
    form: { ...EMPTY_FORM, artist: "Frank Ocean", touchstones: "Forgotten", city: "New York" },
  },
];

function toBrief(form: FormState, picks: Record<string, string>, nudges: Nudge[]): BriefInput {
  return {
    format: form.format,
    artist: form.artist.trim() || undefined,
    touchstones: splitTitles(form.touchstones).slice(0, 5),
    city: form.city.trim(),
    budget: form.budget,
    director_films: splitTitles(form.directorFilms).slice(0, 8),
    picks,
    nudges,
  };
}

export function Studio({ qlooMode, llmMode }: { qlooMode: QlooMode; llmMode: LlmMode }) {
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [picks, setPicks] = useState<Record<string, string>>({});
  const [nudges, setNudges] = useState<Nudge[]>([]);
  const [phase, setPhase] = useState<Phase>("idle");
  const [steps, setSteps] = useState<StepEvent[]>([]);
  const [treatment, setTreatment] = useState<Treatment | null>(null);
  const [question, setQuestion] = useState<{ message: string; items: Ambiguity[] } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [modes, setModes] = useState({ qloo: qlooMode, llm: llmMode });
  const active = useRef<AbortController | null>(null);
  const running = phase === "running";

  const board = useRef<HTMLElement>(null);
  /** In the one-column layout the board sits below the form; bring it into view when it lands. */
  const revealBoard = () => {
    if (window.matchMedia("(min-width: 64rem)").matches) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    requestAnimationFrame(() => board.current?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" }));
  };

  const onEvent = (event: AgentEvent) => {
    switch (event.type) {
      case "start":
        setModes({ qloo: event.qlooMode, llm: event.llmMode });
        break;
      case "step":
        setSteps((prev) => {
          const i = prev.findIndex((s) => s.id === event.id);
          if (i === -1) return [...prev, event];
          const next = [...prev];
          next[i] = event;
          return next;
        });
        break;
      case "needs_input":
        setQuestion({ message: event.message, items: event.items });
        setPhase("needs_input");
        break;
      case "treatment":
        setTreatment(event.treatment);
        setPhase("done");
        revealBoard();
        break;
      case "error":
        setProblem(event.message);
        setPhase("error");
        break;
      case "done":
        setPhase((p) => (p === "running" ? "idle" : p));
        break;
    }
  };

  const run = async (nextForm: FormState, nextPicks: Record<string, string>, nextNudges: Nudge[]) => {
    const brief = toBrief(nextForm, nextPicks, nextNudges);
    const invalid = !brief.city
      ? "Add the shoot city."
      : !brief.artist && brief.touchstones?.length === 0
        ? "Add an artist or at least one touchstone film."
        : null;
    if (invalid) {
      setProblem(invalid);
      setPhase((p) => (p === "error" ? "idle" : p));
      return;
    }

    active.current?.abort();
    const controller = new AbortController();
    active.current = controller;
    setProblem(null);
    setQuestion(null);
    setSteps([]);
    setPhase("running");
    try {
      await streamTreatment(brief, onEvent, controller.signal);
    } catch (err) {
      if (controller.signal.aborted) return;
      setProblem(err instanceof Error ? err.message : "The connection dropped. Try again.");
      setPhase("error");
    }
  };

  const startOver = (nextForm: FormState) => {
    // A new brief starts clean: earlier picks, nudges and the old board belonged to the last one.
    setPicks({});
    setNudges([]);
    setTreatment(null);
    void run(nextForm, {}, []);
  };

  const submit = () => startOver(form);

  const tryExample = (example: FormState) => {
    setForm(example);
    startOver(example);
  };

  const pick = (chosen: Record<string, string>) => {
    const next = { ...picks, ...chosen };
    setPicks(next);
    void run(form, next, nudges);
  };

  const toggleNudge = (nudge: Nudge) => {
    const next = nudges.includes(nudge) ? nudges.filter((n) => n !== nudge) : [...nudges, nudge];
    setNudges(next);
    void run(form, picks, next);
  };

  const current = [...steps].reverse().find((s) => s.status === "running")?.label;

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="border-b border-line">
        <div className="mx-auto flex w-full max-w-[96rem] flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-8">
          <div className="flex items-baseline gap-4">
            <h1 className="text-lg font-semibold tracking-[0.3em] text-paper">MISE</h1>
            <p className="hidden text-sm text-dim sm:block">Treatments grounded in what the audience loves</p>
          </div>
          <ModeBadges qloo={modes.qloo} llm={modes.llm} writtenBy={treatment?.writtenBy} />
        </div>
      </header>

      <main className="mx-auto grid w-full max-w-[96rem] flex-1 grid-cols-[minmax(0,1fr)] gap-10 px-4 py-8 sm:px-8 lg:grid-cols-[21rem_minmax(0,1fr)] lg:gap-12">
        <aside className="flex min-w-0 flex-col gap-10 print:hidden lg:sticky lg:top-6 lg:max-h-[calc(100vh-3rem)] lg:self-start lg:overflow-y-auto lg:pr-2">
          <BriefForm form={form} onChange={setForm} onSubmit={submit} running={running} problem={phase === "error" ? null : problem} />
          <Timeline steps={steps} running={running} />
          {process.env.NODE_ENV !== "production" && (
            <Link href="/playground" className="text-xs text-faint underline decoration-line underline-offset-4 hover:text-dim">
              Tool playground (development)
            </Link>
          )}
        </aside>

        <section ref={board} aria-label="Treatment" className="flex min-w-0 scroll-mt-4 flex-col gap-8">
          {phase === "error" && problem && (
            <div role="alert" className="rounded-lg border border-safelight/40 bg-safelight/10 px-4 py-3 text-sm text-paper">
              <p className="font-medium text-safelight">The treatment didn&apos;t finish.</p>
              <p className="mt-1 text-paper/85">{problem}</p>
            </div>
          )}
          {question && phase === "needs_input" && (
            <Picker key={question.items.map((i) => i.key).join("|")} message={question.message} items={question.items} onPick={pick} running={running} />
          )}
          {treatment ? (
            <Board treatment={treatment} stale={running} nudges={nudges} onToggleNudge={toggleNudge} running={running} />
          ) : (
            phase !== "needs_input" && <EmptyBoard examples={EXAMPLES} onTry={tryExample} running={running} current={current} />
          )}
        </section>
      </main>
    </div>
  );
}

