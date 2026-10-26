"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { EXAMPLES, type Example } from "@/lib/agent/examples";
import type { FeaturedCover, FeaturedReplay } from "@/lib/agent/featured";
import { STEP_LABELS, STEP_ORDER, type Nudge } from "@/lib/agent/options";
import type { AgentEvent, Ambiguity, StepEvent, Treatment } from "@/lib/agent/types";
import type { LlmMode } from "@/lib/llm/config";
import type { QlooMode } from "@/lib/qloo/client";
import { Board } from "./board";
import { BriefForm } from "./brief-form";
import { DirectorsCut, Wordmark, useConsoleNote, useDirectorsCut } from "./eggs";
import { EMPTY_FORM, formFromBrief, toBrief, validateForm, type FormProblem, type FormState } from "./form";
import { Hero, HowItWorks, NowShowing } from "./landing";
import { LetterboxBars, useLightsDown } from "./lights";
import { LingoProvider, UncSwitch, useLingo } from "./lingo";
import { BackArrow, ModeBadges } from "./parts";
import { Picker } from "./picker";
import { Replay } from "./replay";
import { StreamError, streamTreatment } from "./stream";
import { ThemeSwitch } from "./theme";
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

/**
 * A board gets its own history entry (same URL, this marker in its state), so the browser's Back button returns
 * to the studio and Forward reopens the board. Next.js keeps its own fields alongside it.
 */
const BOARD_ENTRY = "board";
const onBoardEntry = () => window.history.state?.itsgiving === BOARD_ENTRY;

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

/** A fresh treatment lands with a short toast; the live region already announced it, so this is for the eyes. */
function Toast({ toast }: { toast: { title: string; line: string } | null }) {
  if (!toast) return null;
  return (
    <div
      aria-hidden
      className="fixed right-4 bottom-4 z-40 flex max-w-[min(25rem,calc(100vw-2rem))] items-center gap-3.5 rounded-[20px] bg-[#121211] px-4 py-3.5 text-white shadow-[6px_6px_0_rgb(0_0_0/0.15)] print:hidden"
    >
      <span className="grid size-9 shrink-0 place-items-center rounded-full bg-accent">
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="#121211"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M5 12l5 5 9-10" />
        </svg>
      </span>
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="text-[19px] leading-tight font-extrabold tracking-[-0.03em]">{toast.title}</span>
        <span className="truncate text-[14px] text-[#d9d5cc]">{toast.line}</span>
      </span>
    </div>
  );
}

function FailCard({ problem, onRetry }: { problem: string; onRetry?: () => void }) {
  const { t } = useLingo();
  const rateLimited = /too many|rate limit/i.test(problem);
  return (
    <div role="alert" className="flex flex-col gap-3 rounded-[24px] border-2 border-safelight bg-[#fff6f4] p-6">
      <p className="type-head text-[clamp(1.75rem,3vw,2.25rem)] leading-none text-[#8f1a10]">{rateLimited ? t.rateTitle : t.failTitle}</p>
      <p className="text-[16px] leading-6 text-[#3a2420]">{problem}</p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="self-start rounded-full bg-foreground px-5 py-3 text-[15px] font-bold text-background"
        >
          Try again
        </button>
      )}
    </div>
  );
}

interface StudioProps {
  initialBadges: ReactNode;
  featured: FeaturedCover[];
  /** One featured run to replay on the landing; none on a server without live data. */
  replay?: FeaturedReplay;
}

/** Briefs offered as "Try one" chips: the ones without a pre-built treatment, so they run live. */
const TRY = EXAMPLES.filter((example) => !example.featured);

export function Studio(props: StudioProps) {
  return (
    <LingoProvider>
      <StudioScreen {...props} />
    </LingoProvider>
  );
}

function StudioScreen({ initialBadges, featured, replay }: StudioProps) {
  const { t: lingo } = useLingo();
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [phase, setPhase] = useState<Phase>("idle");
  const [steps, setSteps] = useState<StepEvent[]>([]);
  const [treatment, setTreatment] = useState<Treatment | null>(null);
  /** The board, or the studio around it: a treatment stays in memory when the director steps back out. */
  const [view, setView] = useState<"studio" | "board">("studio");
  /** The run in flight (or last attempted), and the run that produced the board. */
  const [pending, setPending] = useState<RunInput | null>(null);
  const [shown, setShown] = useState<RunInput | null>(null);
  const [question, setQuestion] = useState<{ message: string; items: Ambiguity[] } | null>(null);
  const [formProblem, setFormProblem] = useState<FormProblem | null>(null);
  const [runProblem, setRunProblem] = useState<string | null>(null);
  const [modes, setModes] = useState<{ qloo: QlooMode; llm: LlmMode } | null>(null);
  const [status, setStatus] = useState("");
  const [startedAt, setStartedAt] = useState(0);
  /** Which take of the brief is on the board: 1, then one more per rework. */
  const [take, setTake] = useState(1);
  const [briefOpen, setBriefOpen] = useState(false);
  const [toast, setToast] = useState<{ title: string; line: string } | null>(null);
  const active = useRef<AbortController | null>(null);
  const stopActive = useRef<() => void>(() => {});
  const focusTitle = useRef(false);
  const failedBefore = useRef(false);
  const briefPanel = useRef<HTMLDivElement>(null);
  const posters = useRef<HTMLElement>(null);
  /** Where the director was in the studio when the board opened, and the poster they opened, to return them there. */
  const landing = useRef<{ scroll: number; slug?: string } | null>(null);
  /** Where they were on the board when they stepped out, for Forward; null when the board should open at its top. */
  const boardSpot = useRef<number | null>(null);
  const viewNow = useRef(view);
  const [cut, exitCut] = useDirectorsCut();
  const running = phase === "running";
  const onBoard = treatment !== null && view === "board";
  useConsoleNote(treatment);
  useLightsDown(posters, !onBoard);

  // Back and Forward move between the studio and the board, each kept where the director left it. The page puts
  // them back itself: the browser's own restoring would land after it, at wherever the entry was first written.
  useEffect(() => {
    const restoring = window.history.scrollRestoration;
    window.history.scrollRestoration = "manual";
    const onPop = () => {
      const next = onBoardEntry() ? "board" : "studio";
      if (next === viewNow.current) return;
      if (next === "board") landing.current = { scroll: window.scrollY };
      else boardSpot.current = window.scrollY;
      setView(next);
    };
    window.addEventListener("popstate", onPop);
    return () => {
      window.removeEventListener("popstate", onPop);
      window.history.scrollRestoration = restoring;
    };
  }, []);

  useEffect(() => {
    viewNow.current = view;
    if (view === "board") {
      if (boardSpot.current !== null) window.scrollTo({ top: boardSpot.current });
      boardSpot.current = null;
      return;
    }
    // Back in the studio: the same spot on the page, and focus on the poster that was opened (or the way back in).
    if (!landing.current) return;
    const { scroll, slug } = landing.current;
    landing.current = null;
    window.scrollTo({ top: scroll });
    const target = slug ? document.querySelector<HTMLElement>(`[data-slug="${slug}"]`) : document.getElementById("reopen-board");
    target?.focus({ preventScroll: true });
  }, [view]);

  // Leaving the page mid-run shouldn't keep spending model quota and credit.
  useEffect(() => () => active.current?.abort(), []);

  // Move focus to the treatment's title once it renders, new or reopened (it also scrolls it into view).
  useEffect(() => {
    if (!treatment || view !== "board" || !focusTitle.current) return;
    focusTitle.current = false;
    document.getElementById("treatment-title")?.focus();
  }, [treatment, view]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(timer);
  }, [toast]);

  // "New brief" opens the form above the board and puts the cursor in it.
  useEffect(() => {
    if (!briefOpen) return;
    briefPanel.current?.scrollIntoView({ block: "start" });
    briefPanel.current?.querySelector<HTMLInputElement>("input:not([type=radio])")?.focus();
  }, [briefOpen]);

  const run = async (input: RunInput) => {
    active.current?.abort();
    const controller = new AbortController();
    active.current = controller;
    let finished = false;
    let stalled = false;
    let stopped = false;
    const began = Date.now();
    stopActive.current = () => {
      stopped = true;
      controller.abort();
    };

    setPending(input);
    setFormProblem(null);
    setRunProblem(null);
    setQuestion(null);
    setSteps([]);
    setStartedAt(began);
    setPhase("running");
    setStatus("Building the treatment…");

    const stall = () => {
      stalled = true;
      controller.abort();
    };
    let watchdog = setTimeout(stall, STALL_MS);

    const fail = (message: string) => {
      failedBefore.current = true;
      landing.current = null;
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
          // A board opened from the studio gets its history entry; a rework replaces the board in place.
          if (!onBoardEntry()) {
            landing.current ??= { scroll: window.scrollY };
            boardSpot.current = null;
            window.history.pushState({ itsgiving: BOARD_ENTRY }, "");
          }
          setView("board");
          setShown(input);
          setPhase("done");
          setBriefOpen(false);
          if (event.cached) setSteps(replaySteps(event.treatment));
          else
            setToast({
              title: failedBefore.current ? lingo.back : lingo.done,
              line: `${event.treatment.title}: ${Math.round((Date.now() - began) / 1000)} s, ${event.treatment.qloo.calls} Qloo calls`,
            });
          failedBefore.current = false;
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
    setTake(1);
    setBriefOpen(false);
    void run({ form: nextForm, picks: {}, nudges: [] });
  };

  /** A featured poster: its brief runs (a pre-built one answers at once), and Back returns to this poster. */
  const openFeatured = (example: Example) => {
    const brief = formFromBrief(example.brief);
    landing.current = { scroll: window.scrollY, slug: example.slug };
    setForm(brief);
    startOver(brief);
    window.scrollTo({ top: 0 });
  };

  /** Back to the studio, through the browser's history when the board has its entry, so Back and Forward agree. */
  const leaveBoard = () => {
    if (onBoardEntry()) {
      window.history.back();
    } else {
      boardSpot.current = window.scrollY;
      setView("studio");
    }
  };

  const reopenBoard = () => {
    landing.current = { scroll: window.scrollY };
    boardSpot.current = null;
    window.history.pushState({ itsgiving: BOARD_ENTRY }, "");
    focusTitle.current = true;
    setView("board");
    window.scrollTo({ top: 0 });
  };

  /** A "Try one" chip fills the brief without running it, so the director sees what it holds first. */
  const fillExample = (example: Example) => {
    setForm(formFromBrief(example.brief));
    setFormProblem(null);
    setStatus(`Filled the brief with ${example.title}. ${example.detail}`);
  };

  const pick = (chosen: Record<string, string>) => {
    if (!pending || running) return;
    void run({ ...pending, picks: { ...pending.picks, ...chosen } });
  };

  const toggleNudge = (nudge: Nudge) => {
    if (!shown || running) return;
    const nudges = shown.nudges.includes(nudge) ? shown.nudges.filter((n) => n !== nudge) : [...shown.nudges, nudge];
    setTake((n) => n + 1);
    void run({ ...shown, nudges });
  };

  const retry = pending && !running ? () => void run(pending) : undefined;
  const current = [...steps].reverse().find((s) => s.status === "running")?.label;
  // Chips show the run in flight while it runs, otherwise the nudges behind the board on screen.
  const nudgesShown = running && pending ? pending.nudges : (shown?.nudges ?? []);
  const boardState = running ? "updating" : phase === "error" ? "previous" : "current";

  const brief = (
    <BriefForm
      form={form}
      onChange={setForm}
      onSubmit={() => startOver(form)}
      onStop={() => stopActive.current()}
      running={running}
      problem={formProblem}
      examples={TRY}
      onExample={fillExample}
    />
  );
  const picker = question && phase === "needs_input" && (
    <Picker
      key={question.items.map((i) => i.key).join("|")}
      message={question.message}
      items={question.items}
      onPick={pick}
      running={running}
    />
  );

  return (
    <div className="flex min-h-full flex-1 flex-col">
      {/* On phones: the wordmark and the switch on one row, the badges and the theme under them. The header scrolls
          away: the landing keeps its brief in reach, and a treatment has its clapperboard bar. */}
      <header className="border-b border-line/80 print:border-0">
        <div className="mx-auto flex min-h-[4.5rem] w-full max-w-[80rem] flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3 sm:px-8">
          <div className="flex min-w-0 items-center gap-5">
            <h1>
              <Wordmark onTap={onBoard ? leaveBoard : undefined} />
            </h1>
            <p className="hidden text-[14px] text-faint xl:block">Treatments grounded in what the audience loves</p>
          </div>
          <div className="sm:order-3">
            <UncSwitch />
          </div>
          <div className="order-3 flex w-full flex-wrap items-center gap-2 sm:order-2 sm:ml-auto sm:w-auto print:hidden">
            {onBoard && (
              <button
                type="button"
                aria-expanded={briefOpen}
                onClick={() => setBriefOpen((open) => !open)}
                className="min-h-11 rounded-full px-4 text-[15px] font-semibold hover:bg-card"
              >
                {briefOpen ? "Hide brief" : "New brief"}
              </button>
            )}
            {modes ? <ModeBadges qloo={modes.qloo} llm={modes.llm} treatment={(onBoard && treatment) || undefined} /> : initialBadges}
            <ThemeSwitch />
          </div>
        </div>
      </header>
      <p role="status" aria-live="polite" className="sr-only">
        {status}
      </p>

      <main className="mx-auto flex w-full max-w-[80rem] flex-1 flex-col gap-16 px-4 pt-8 pb-16 sm:px-8 sm:pt-10 print:p-0">
        {treatment && view === "board" ? (
          <div className="flex flex-col gap-8">
            <button
              type="button"
              onClick={leaveBoard}
              className="-mb-2 flex min-h-11 items-center gap-2 self-start rounded-full border border-foreground py-2 pr-5 pl-4 text-[15px] font-bold hover:bg-card print:hidden"
            >
              <BackArrow />
              Home
            </button>
            {briefOpen && (
              <div ref={briefPanel} className="w-full max-w-[34rem] scroll-mt-28 print:hidden">
                {brief}
              </div>
            )}
            {phase === "error" && runProblem && <FailCard problem={runProblem} onRetry={retry} />}
            {running && (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-[28px] border border-foreground bg-card py-2 pr-2 pl-5 sm:rounded-full print:hidden">
                <span aria-hidden className="size-2.5 rounded-full bg-foreground motion-safe:animate-pulse" />
                <span className="font-bold">{lingo.cookingAgain}</span>
                {current && <span className="text-[15px] text-dim">{current}</span>}
                <button
                  type="button"
                  onClick={() => stopActive.current()}
                  className="ml-auto min-h-10 rounded-full border border-foreground px-4 text-sm font-semibold"
                >
                  Stop
                </button>
              </div>
            )}
            {picker}
            <Board
              treatment={treatment}
              state={boardState}
              nudges={nudgesShown}
              onToggleNudge={toggleNudge}
              running={running}
              take={take}
              log={<Timeline steps={steps} />}
              onHome={leaveBoard}
            />
          </div>
        ) : (
          <>
            {/* A split studio: on wide screens the brief stays in reach on the right while the posters scroll by on
                the left; on phones it comes straight after the headline. */}
            <section aria-label="Studio" className="grid items-start gap-x-10 gap-y-10 lg:grid-cols-[minmax(0,1fr)_minmax(22rem,27rem)]">
              <div className="min-w-0 lg:col-start-1 lg:row-start-1">
                {running ? (
                  <RunStage steps={steps} startedAt={startedAt} thinking={pending?.form.thinking ?? "deep"} />
                ) : picker ? (
                  picker
                ) : phase === "error" && runProblem ? (
                  <div className="flex flex-col gap-5">
                    <FailCard problem={runProblem} onRetry={retry} />
                    {steps.length > 0 && (
                      <div className="rounded-[28px] border border-line bg-card p-5 sm:p-6">
                        <Timeline steps={steps} size="stage" />
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="flex flex-col gap-6">
                    {treatment && (
                      <button
                        id="reopen-board"
                        type="button"
                        onClick={reopenBoard}
                        className="flex min-h-11 max-w-full items-center self-start rounded-full bg-foreground px-5 py-2 text-[15px] font-bold text-background hover:opacity-90"
                      >
                        <span className="truncate">Back to {treatment.title}</span>
                      </button>
                    )}
                    <Hero />
                  </div>
                )}
              </div>
              {/* Above the posters, so the projector's beam passes behind the brief, not over it (on phones the beam
                  reaches up to it). */}
              <div className="relative z-10 min-w-0 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:self-stretch">
                <div className="quiet-scroll lg:sticky lg:top-12 lg:max-h-[calc(100dvh-4rem)] lg:overflow-y-auto lg:rounded-[28px]">
                  {brief}
                </div>
              </div>
              <div className="min-w-0 lg:col-start-1 lg:row-start-2">
                <NowShowing ref={posters} examples={EXAMPLES} covers={featured} form={form} running={running} onTry={openFeatured} />
              </div>
            </section>
            {replay ? <Replay replay={replay} /> : <HowItWorks />}
            <LetterboxBars />
          </>
        )}
      </main>

      <footer className="mx-auto w-full max-w-[80rem] px-4 pb-10 sm:px-8 print:hidden">
        <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2 border-t border-line pt-6 text-[15px] text-dim">
          <span className="font-bold text-foreground">{lingo.footer}</span>
          <span className="flex flex-wrap items-baseline gap-x-5 gap-y-1">
            {process.env.NODE_ENV !== "production" && (
              <Link href="/playground" className="text-[14px] text-faint underline decoration-line underline-offset-4 hover:text-dim">
                Tool playground (development)
              </Link>
            )}
            <span>Built on Qloo&apos;s taste graph. itsgiving, 2026.</span>
          </span>
        </div>
      </footer>

      <Toast toast={toast} />
      <DirectorsCut on={cut} onExit={exitCut} />
    </div>
  );
}
