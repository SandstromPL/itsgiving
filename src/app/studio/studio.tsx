"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { EXAMPLES } from "@/lib/agent/examples";
import type { FeaturedCover } from "@/lib/agent/featured";
import { STEP_LABELS, STEP_ORDER, type Nudge } from "@/lib/agent/options";
import type { AgentEvent, Ambiguity, StepEvent, Treatment } from "@/lib/agent/types";
import type { LlmMode } from "@/lib/llm/config";
import type { QlooMode } from "@/lib/qloo/client";
import { Board, EmptyBoard } from "./board";
import { BriefForm } from "./brief-form";
import { EMPTY_FORM, formFromBrief, toBrief, validateForm, type FormProblem, type FormState } from "./form";
import { ModeBadges } from "./parts";
import { Picker } from "./picker";
import { StreamError, streamTreatment } from "./stream";
import { RunStage, Timeline } from "./timeline";

type Phase = "idle" | "running" | "needs_input" | "done" | "error";

/** One request's inputs: kept so iterate chips and the picker re-run the brief behind the board, not the live form. */
interface RunInput {
  form: FormState;
  picks: Record<string, string>;
  nudges: Nudge[];
}

/**
 * The server reports progress at least every few seconds, even while a model thinks (TIMING and TICK_MS
 * in pipeline.ts), so this much silence means the connection is gone.
 */
const STALL_MS = 75_000;

/** Timeline rows for a treatment replayed from cache: the calls and models that originally made it. */
function replaySteps(t: Treatment): StepEvent[] {
  return STEP_ORDER.flatMap((id): StepEvent[] => {
    const qloo = t.qloo.steps[id];
    const llm = t.llm.find((trace) => trace.step === id);
    if (!qloo?.length && !llm) return [];
    return [
      { type: "step", id, status: "done", label: STEP_LABELS[id], summary: "Replayed from cache: no new calls this time.", qloo, llm },
    ];
  });
}

const stopRunningSteps = (summary: string) => (steps: StepEvent[]) =>
  steps.map((s): StepEvent => (s.status === "running" ? { ...s, status: "error", summary } : s));

export function Studio({ initialBadges, featured }: { initialBadges: ReactNode; featured: FeaturedCover[] }) {
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [phase, setPhase] = useState<Phase>("idle");
  const [steps, setSteps] = useState<StepEvent[]>([]);
  const [treatment, setTreatment] = useState<Treatment | null>(null);
  /** The run in flight (or last attempted), and the run that produced the board. */
  const [pending, setPending] = useState<RunInput | null>(null);
  const [shown, setShown] = useState<RunInput | null>(null);
  const [question, setQuestion] = useState<{ message: string; items: Ambiguity[] } | null>(null);
  const [formProblem, setFormProblem] = useState<FormProblem | null>(null);
  const [runProblem, setRunProblem] = useState<string | null>(null);
  const [modes, setModes] = useState<{ qloo: QlooMode; llm: LlmMode } | null>(null);
  const [status, setStatus] = useState("");
  const [startedAt, setStartedAt] = useState(0);
  const active = useRef<AbortController | null>(null);
  const stopActive = useRef<() => void>(() => {});
  const focusTitle = useRef(false);
  const running = phase === "running";

  // Leaving the page mid-run shouldn't keep spending model quota and credit.
  useEffect(() => () => active.current?.abort(), []);

  // Move focus to the new treatment's title once it renders (it also scrolls it into view).
  useEffect(() => {
    if (!treatment || !focusTitle.current) return;
    focusTitle.current = false;
    document.getElementById("treatment-title")?.focus();
  }, [treatment]);

  const run = async (input: RunInput) => {
    active.current?.abort();
    const controller = new AbortController();
    active.current = controller;
    let finished = false;
    let stalled = false;
    let stopped = false;
    stopActive.current = () => {
      stopped = true;
      controller.abort();
    };

    setPending(input);
    setFormProblem(null);
    setRunProblem(null);
    setQuestion(null);
    setSteps([]);
    setStartedAt(Date.now());
    setPhase("running");
    setStatus("Building the treatment…");

    const stall = () => {
      stalled = true;
      controller.abort();
    };
    let watchdog = setTimeout(stall, STALL_MS);

    const fail = (message: string) => {
      setRunProblem(message);
      setPhase("error");
      setSteps(stopRunningSteps("Stopped before it finished."));
      setStatus(`The treatment didn't finish. ${message}`);
    };

    const onEvent = (event: AgentEvent) => {
      if (active.current !== controller) return; // a newer run has taken over
      clearTimeout(watchdog);
      watchdog = setTimeout(stall, STALL_MS);
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
          finished = true;
          setQuestion({ message: event.message, items: event.items });
          setPhase("needs_input");
          setStatus(`itsgiving needs your choice. ${event.message}`);
          break;
        case "treatment":
          finished = true;
          focusTitle.current = true;
          setTreatment(event.treatment);
          setShown(input);
          setPhase("done");
          if (event.cached) setSteps(replaySteps(event.treatment));
          setStatus(`Treatment ready: ${event.treatment.title}.`);
          break;
        case "error":
          finished = true;
          fail(event.message);
          break;
        case "done":
          break;
      }
    };

    try {
      await streamTreatment(toBrief(input.form, input.picks, input.nudges), onEvent, controller.signal);
      if (active.current === controller && !finished) fail("The connection closed before the treatment finished. Try again.");
    } catch (err) {
      if (active.current !== controller) return;
      if (stopped) {
        setPhase(treatment ? "done" : "idle");
        setSteps(stopRunningSteps("Stopped."));
        setStatus("Stopped.");
      } else if (stalled) {
        fail("The server went quiet for over a minute, so itsgiving stopped waiting. Try again.");
      } else {
        if (err instanceof StreamError && err.detail) console.error(err.detail);
        else if (!(err instanceof StreamError)) console.error(err);
        fail(err instanceof StreamError ? err.message : "Something went wrong while building the treatment. Try again.");
      }
    } finally {
      clearTimeout(watchdog);
    }
  };

  /** A new brief starts clean, but only once it is valid: a typo must not wipe the board. */
  const startOver = (nextForm: FormState) => {
    const invalid = validateForm(nextForm);
    if (invalid) {
      setFormProblem(invalid);
      setStatus(invalid.message);
      return;
    }
    setTreatment(null);
    setShown(null);
    void run({ form: nextForm, picks: {}, nudges: [] });
  };

  const tryExample = (example: FormState) => {
    setForm(example);
    startOver(example);
  };

  const pick = (chosen: Record<string, string>) => {
    if (!pending || running) return;
    void run({ ...pending, picks: { ...pending.picks, ...chosen } });
  };

  const toggleNudge = (nudge: Nudge) => {
    if (!shown || running) return;
    const nudges = shown.nudges.includes(nudge) ? shown.nudges.filter((n) => n !== nudge) : [...shown.nudges, nudge];
    void run({ ...shown, nudges });
  };

  const current = [...steps].reverse().find((s) => s.status === "running")?.label;
  // Chips show the run in flight while it runs, otherwise the nudges behind the board on screen.
  const nudgesShown = running && pending ? pending.nudges : (shown?.nudges ?? []);
  const boardState = running ? "updating" : phase === "error" ? "previous" : "current";
  // A first build takes the stage with its run log; the rail keeps the log the rest of the time.
  const logOnStage = running && !treatment;

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="sticky top-0 z-30 border-b border-line bg-background/90 backdrop-blur print:static">
        <div className="mx-auto flex h-14 w-full max-w-[100rem] items-center justify-between gap-4 px-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-4">
            <h1 className="flex items-center gap-2.5">
              {/* A 2.39:1 frame with letterbox bars: the mark is the screen the treatment is made for. */}
              <span aria-hidden className="h-[14px] w-[33px] shrink-0 rounded-[2px] border-x border-y-[3px] border-paper" />
              <span className="type-head text-2xl leading-none text-paper">itsgiving</span>
            </h1>
            <p className="hidden truncate text-sm text-dim md:block">Treatments grounded in what the audience loves</p>
          </div>
          {modes ? <ModeBadges qloo={modes.qloo} llm={modes.llm} treatment={treatment ?? undefined} /> : initialBadges}
        </div>
      </header>
      <p role="status" aria-live="polite" className="sr-only">
        {status}
      </p>

      <main className="mx-auto grid w-full max-w-[100rem] flex-1 grid-cols-[minmax(0,1fr)] lg:grid-cols-[23rem_minmax(0,1fr)] print:block">
        <aside className="quiet-scroll flex min-w-0 flex-col gap-10 border-line px-4 py-6 sm:px-6 lg:sticky lg:top-14 lg:h-[calc(100vh-3.5rem)] lg:overflow-y-auto lg:border-r lg:bg-graphite/40 lg:py-8 print:hidden">
          <BriefForm
            form={form}
            onChange={setForm}
            onSubmit={() => startOver(form)}
            onStop={() => stopActive.current()}
            running={running}
            problem={formProblem}
          />
          {!logOnStage && <Timeline steps={steps} />}
          {process.env.NODE_ENV !== "production" && (
            <Link href="/playground" className="text-xs text-faint underline decoration-line underline-offset-4 hover:text-dim">
              Tool playground (development)
            </Link>
          )}
        </aside>

        <section aria-label="Treatment" className="flex min-w-0 flex-col gap-8 px-4 py-8 sm:px-8 lg:px-12 lg:py-10 xl:px-16 print:p-0">
          {phase === "error" && runProblem && (
            <div role="alert" className="rounded-lg border border-safelight/40 bg-safelight/10 px-4 py-3 text-sm text-paper">
              <p className="font-medium text-safelight">The treatment didn&apos;t finish.</p>
              <p className="mt-1 text-paper/85">{runProblem}</p>
            </div>
          )}
          {running && treatment && (
            <p className="flex items-center gap-3 text-sm text-dim print:hidden">
              <span aria-hidden className="size-1.5 rounded-full bg-tungsten motion-safe:animate-pulse" />
              Reworking the treatment{current ? `: ${current.toLowerCase()}` : ""}…
            </p>
          )}
          {question && phase === "needs_input" && (
            <Picker
              key={question.items.map((i) => i.key).join("|")}
              message={question.message}
              items={question.items}
              onPick={pick}
              running={running}
            />
          )}
          {logOnStage ? (
            <RunStage steps={steps} startedAt={startedAt} thinking={pending?.form.thinking ?? "deep"} />
          ) : treatment ? (
            <Board treatment={treatment} state={boardState} nudges={nudgesShown} onToggleNudge={toggleNudge} running={running} />
          ) : (
            phase !== "needs_input" && (
              <EmptyBoard examples={EXAMPLES} covers={featured} onTry={(example) => tryExample(formFromBrief(example.brief))} />
            )
          )}
        </section>
      </main>
    </div>
  );
}
