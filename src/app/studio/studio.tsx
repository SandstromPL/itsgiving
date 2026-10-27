"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { EXAMPLES } from "@/lib/agent/examples";
import { THINKING, type Nudge } from "@/lib/agent/options";
import type { AgentEvent, Ambiguity, StepEvent, Treatment } from "@/lib/agent/types";
import type { LlmMode } from "@/lib/llm/config";
import type { QlooMode } from "@/lib/qloo/client";
import { accountsOn } from "@/lib/supabase/config";
import { Board } from "./board";
import { BriefForm } from "./brief-form";
import { useReceipts } from "./eggs";
import { briefLine, formFromBrief, toBrief, validateForm, type FormProblem, type FormState } from "./form";
import { HandoffReader, type Handoff } from "./handoff";
import { onScreen } from "./jump";
import { YourPoster } from "./landing";
import { useLingo } from "./lingo";
import { BackArrow, ModeBadges } from "./parts";
import { Picker } from "./picker";
import { SaveControl } from "./save";
import { studioSession, type RunInput } from "./session";
import { SiteHeader } from "./site-header";
import { StreamError, streamTreatment } from "./stream";
import { RunStage, Timeline, replaySteps } from "./timeline";

type Phase = "idle" | "running" | "needs_input" | "done" | "error";

/**
 * The server reports progress at least every few seconds, even while a model thinks (TIMING and TICK_MS
 * in pipeline.ts), so this much silence means the connection is gone.
 */
const STALL_MS = 75_000;

/**
 * A board gets its own history entry (same URL, this marker in its state), so the browser's Back button returns
 * to the brief and Forward reopens the board. Next.js keeps its own fields alongside it.
 */
const BOARD_ENTRY = "board";
const onBoardEntry = () => window.history.state?.itsgiving === BOARD_ENTRY;

/**
 * The history entry the page is on, by its Navigation API key, or null where the browser has no Navigation API.
 * Coming back to the entry the studio was left on means Back or Forward; a link to the studio makes a new one.
 */
const entryKey = () =>
  (window as Window & { navigation?: { currentEntry?: { key: string } | null } }).navigation?.currentEntry?.key ?? null;

const STUDIO_TITLE = "Studio: itsgiving";

const stopRunningSteps = (summary: string) => (steps: StepEvent[]) =>
  steps.map((s): StepEvent => (s.status === "running" ? { ...s, status: "error", summary } : s));

interface ToastNote {
  title: string;
  line: string;
  open: boolean;
}

/** How long the toast stays, counted only while the tab is in view. */
const TOAST_MS = 6000;

/**
 * A fresh treatment lands with a short toast; the live region already announced it, so this is for the eyes. It's
 * always there, closed until a treatment lands: it rises from the corner a moment after the board (once its letterbox
 * has begun to open), sinks back out keeping its words, and lets taps through to whatever is under it.
 */
function Toast({ toast }: { toast: ToastNote | null }) {
  return (
    <div
      aria-hidden
      data-open={toast?.open || undefined}
      className="pointer-events-none fixed right-4 bottom-4 z-40 flex max-w-[min(25rem,calc(100vw-2rem))] translate-y-[calc(100%+1rem)] items-center gap-3.5 rounded-[20px] bg-[#121211] px-4 py-3.5 text-white opacity-0 shadow-[6px_6px_0_rgb(0_0_0/0.15)] transition-[opacity,translate] duration-200 data-open:translate-y-0 data-open:opacity-100 data-open:delay-400 data-open:duration-300 print:hidden"
    >
      {toast && (
        <>
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
        </>
      )}
    </div>
  );
}

function FailCard({ problem, onRetry }: { problem: string; onRetry?: () => void }) {
  const { t } = useLingo();
  const rateLimited = /too many|rate limit/i.test(problem);
  return (
    <div role="alert" className="flex flex-col gap-3 rounded-[24px] border-2 border-safelight bg-safelight-wash p-6">
      <p className="type-head text-[clamp(1.75rem,3vw,2.25rem)] leading-none text-safelight">{rateLimited ? t.rateTitle : t.failTitle}</p>
      <p className="text-[16px] leading-6">{problem}</p>
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

/** Briefs offered as "Try one" chips: the ones without a pre-built treatment, so they run live. */
const TRY = EXAMPLES.filter((example) => !example.featured);

/**
 * The studio, the tool on its own page (/studio): the brief, then the run, then the board it builds, in place. Featured
 * treatments live on their own pages (/t/<slug>); their rework chips hand off here (handoff.tsx).
 */
export function Studio({ initialBadges }: { initialBadges: ReactNode }) {
  const { t: lingo } = useLingo();
  // Back in the studio during the same visit: the brief and the last board are as they were left (session.ts).
  const [saved] = useState(studioSession.read);
  const [form, setForm] = useState<FormState>(saved.form);
  const [phase, setPhase] = useState<Phase>(saved.board ? "done" : "idle");
  const [steps, setSteps] = useState<StepEvent[]>(saved.board?.steps ?? []);
  const [treatment, setTreatment] = useState<Treatment | null>(saved.board?.treatment ?? null);
  /** The server's seal on the board's treatment: what lets it be saved (none when accounts aren't set up). */
  const [seal, setSeal] = useState<string | null>(saved.board?.seal ?? null);
  /** The board was handed back after signing in to save it: SaveControl saves it once the session is known. */
  const [saveOnOpen, setSaveOnOpen] = useState(false);
  /** The board, or the brief around it: a treatment stays in memory when the director steps back out. */
  const [view, setView] = useState<"studio" | "board">("studio");
  /** The run in flight (or last attempted), and the run that produced the board. */
  const [pending, setPending] = useState<RunInput | null>(saved.board?.shown ?? null);
  const [shown, setShown] = useState<RunInput | null>(saved.board?.shown ?? null);
  const [question, setQuestion] = useState<{ message: string; items: Ambiguity[] } | null>(null);
  const [formProblem, setFormProblem] = useState<FormProblem | null>(null);
  const [runProblem, setRunProblem] = useState<string | null>(null);
  const [modes, setModes] = useState<{ qloo: QlooMode; llm: LlmMode } | null>(null);
  const [status, setStatus] = useState("");
  const [startedAt, setStartedAt] = useState(0);
  /** Which take of the brief is on the board: 1, then one more per rework. */
  const [take, setTake] = useState(saved.board?.take ?? 1);
  const [toast, setToast] = useState<ToastNote | null>(null);
  const active = useRef<AbortController | null>(null);
  const stopActive = useRef<() => void>(() => {});
  const focusTitle = useRef(false);
  const failedBefore = useRef(false);
  /** A rework a featured page asked for, run once its board has opened. */
  const pendingNudge = useRef<Nudge | null>(null);
  /** The latest run(), for the rework one run starts as it lands; kept current after each render. */
  const runLatest = useRef<(input: RunInput) => Promise<void>>(async () => {});
  /** Where they were on the board when they stepped out, for Forward; null when the board should open at its top. */
  const boardSpot = useRef<number | null>(null);
  /** Set when the director steps back out of a board, so the brief can focus the way back in. */
  const leftBoard = useRef(false);
  const viewNow = useRef(view);
  /** Where the page is, and in which history entry: kept when the director leaves for another page. */
  const spot = useRef<{ y: number; key: string | null }>({ y: 0, key: null });
  const leftAt = useRef<{ y: number; key: string | null } | null>(null);
  const running = phase === "running";
  const onBoard = treatment !== null && view === "board";
  useReceipts(treatment);

  // The visit remembers the studio as it was left.
  useEffect(() => {
    studioSession.write({ form, board: treatment && shown ? { treatment, seal, shown, take, steps } : null });
  }, [form, treatment, seal, shown, take, steps]);

  // The tab says what's on screen: the treatment's title on its board, marked ready while the tab is in the
  // background, so a director who looked away learns it's done. A run in flight sets its own (timeline.tsx).
  useEffect(() => {
    if (running) return;
    const show = () => {
      document.title = onBoard && treatment ? `${document.hidden ? "Ready: " : ""}${treatment.title}: itsgiving` : STUDIO_TITLE;
    };
    show();
    document.addEventListener("visibilitychange", show);
    return () => document.removeEventListener("visibilitychange", show);
  }, [running, onBoard, treatment]);

  // Back and Forward move between the brief and the board, each kept where the director left it. The page puts them
  // back itself: the browser's own restoring would land after it, at wherever the entry was first written. Only on
  // this page's entries: the homepage and featured pages keep the browser's own.
  useEffect(() => {
    window.history.scrollRestoration = "manual";
    // Back or Forward from another page lands on this page's entry, which the browser won't restore: this does. The
    // traversal's own events can't say so, since Next has shown the page again before they fire.
    const left = leftAt.current;
    if (left?.key && left.key === entryKey()) window.scrollTo({ top: left.y });
    spot.current = { y: window.scrollY, key: entryKey() };
    // Only this page's own scrolling: leaving for "/#now-showing" scrolls the next page before this page lets go.
    const onScroll = () => {
      if (window.location.pathname === "/studio") spot.current = { y: window.scrollY, key: entryKey() };
    };
    const onPop = (event: PopStateEvent) => {
      // An entry with no state comes from a plain "#id" jump (the address bar, say): a place on this view, not a move
      // between the brief and the board.
      if (event.state === null) return;
      const next = onBoardEntry() ? "board" : "studio";
      if (next === viewNow.current) return;
      if (next === "studio") {
        boardSpot.current = window.scrollY;
        leftBoard.current = true;
      }
      setView(next);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("popstate", onPop);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("popstate", onPop);
      leftAt.current = spot.current;
      // The mode is kept per history entry, and this runs once the next page's entry is current: that page keeps the
      // browser's own restoring. (Putting back the mode found on arrival leaked "manual": arriving by Back, the
      // studio's entry still holds it.)
      window.history.scrollRestoration = "auto";
    };
  }, []);

  useEffect(() => {
    viewNow.current = view;
    if (view === "board") {
      if (boardSpot.current !== null) window.scrollTo({ top: boardSpot.current });
      boardSpot.current = null;
    } else if (leftBoard.current) {
      // Back at the brief from a board: the top of the page, with focus on the way back in.
      leftBoard.current = false;
      window.scrollTo({ top: 0 });
      document.getElementById("reopen-board")?.focus({ preventScroll: true });
    }
    // A board or the brief can be a new history entry without any scrolling to note it.
    spot.current = { y: window.scrollY, key: entryKey() };
  }, [view]);

  // Leaving the page mid-run shouldn't keep spending model quota and credit. Next keeps a page it leaves (hidden, for
  // Back), so this stops the run as Stop does: coming back finds it stopped, not failed.
  useEffect(() => () => stopActive.current(), []);

  // Move focus to the treatment's title once it renders, new or reopened (it also scrolls it into view).
  useEffect(() => {
    if (!treatment || view !== "board" || !focusTitle.current) return;
    focusTitle.current = false;
    // The board on screen: a featured page left earlier is still in the document, hidden, with its own title.
    onScreen("treatment-title")?.focus();
  }, [treatment, view]);

  // The toast's time runs only while the tab is in view: a director who looked away during the run (the tab's title
  // says "Ready:") still sees it on coming back.
  useEffect(() => {
    if (!toast?.open) return;
    let left = TOAST_MS;
    let since = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const run = () => {
      since = Date.now();
      timer = setTimeout(() => setToast((note) => note && { ...note, open: false }), left);
    };
    const onVisibility = () => {
      if (!document.hidden) return run();
      clearTimeout(timer);
      left -= Date.now() - since;
    };
    if (!document.hidden) run();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [toast]);

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
      pendingNudge.current = null;
      setRunProblem(message);
      setPhase("error");
      setSteps(stopRunningSteps("Stopped before it finished."));
      setStatus(`The treatment didn't finish. ${message}`);
    };

    /** A run the brief can fix (Qloo lacks the artist): the message goes on the field that fixes it, not on a failure card. */
    const askOnField = (problem: FormProblem) => {
      pendingNudge.current = null;
      setFormProblem(problem);
      setPhase("idle");
      setSteps(stopRunningSteps("Stopped before it finished."));
      setStatus(problem.message);
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
        case "treatment": {
          finished = true;
          focusTitle.current = true;
          setTreatment(event.treatment);
          setSeal(event.seal ?? null);
          setSaveOnOpen(false);
          // A board opened from the brief gets its history entry; a rework replaces the board in place.
          if (!onBoardEntry()) {
            boardSpot.current = null;
            window.history.pushState({ itsgiving: BOARD_ENTRY }, "");
          }
          setView("board");
          setShown(input);
          setPhase("done");
          if (event.cached) setSteps(replaySteps(event.treatment));
          else
            setToast({
              title: failedBefore.current ? lingo.back : lingo.done,
              line: `${event.treatment.title}: ${Math.round((Date.now() - began) / 1000)} s, ${event.treatment.qloo.calls} Qloo calls`,
              open: true,
            });
          failedBefore.current = false;
          setStatus(`Treatment ready: ${event.treatment.title}.`);
          // A rework asked for by a featured page runs once its board is open, as take 2.
          const nudge = pendingNudge.current;
          if (nudge) {
            pendingNudge.current = null;
            setTake((n) => n + 1);
            void runLatest.current({ ...input, nudges: [nudge] });
          }
          break;
        }
        case "error":
          finished = true;
          if (event.field === "stand_ins") askOnField({ field: "standIns", message: event.message });
          else fail(event.message);
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
        pendingNudge.current = null;
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

  useEffect(() => {
    runLatest.current = run;
  });

  /** A new brief starts clean, but only once it is valid: a typo must not wipe the board. */
  const startOver = (nextForm: FormState) => {
    const invalid = validateForm(nextForm);
    if (invalid) {
      setFormProblem(invalid);
      setStatus(invalid.message);
      return;
    }
    setTreatment(null);
    setSeal(null);
    setShown(null);
    setTake(1);
    window.scrollTo({ top: 0 });
    void run({ form: nextForm, picks: {}, nudges: [] });
  };

  /**
   * A handoff from another page. A featured page's: its pre-built board opens at once, then the rework it asked for
   * runs; or, from a page whose board this build doesn't have, the brief is only filled in. A board itself (a saved or
   * shared treatment's rework, or Save coming back from sign-in) opens as it is, then reworks or saves.
   */
  const openFrom = (handoff: Handoff) => {
    if (handoff.kind === "board") return openBoard(handoff);
    const { example, open, nudge } = handoff;
    const brief = formFromBrief(example.brief);
    setForm(brief);
    if (!open) {
      setStatus(`Filled the brief with ${example.title}. ${example.detail}`);
      return;
    }
    pendingNudge.current = nudge ?? null;
    startOver(brief);
  };

  const openBoard = ({ treatment: handed, seal: handedSeal, nudge, save }: Extract<Handoff, { kind: "board" }>) => {
    const input: RunInput = { form: formFromBrief(handed.brief), picks: handed.brief.picks ?? {}, nudges: handed.brief.nudges ?? [] };
    setForm(input.form);
    setTreatment(handed);
    setSeal(handedSeal ?? null);
    setSaveOnOpen(Boolean(save));
    setSteps(replaySteps(handed));
    setShown(input);
    setPending(input);
    setPhase("done");
    setTake(1);
    boardSpot.current = null;
    window.history.pushState({ itsgiving: BOARD_ENTRY }, "");
    focusTitle.current = true;
    setView("board");
    window.scrollTo({ top: 0 });
    setStatus(`Opened ${handed.title}.`);
    if (nudge) {
      setTake(2);
      void runLatest.current({ ...input, nudges: [nudge] });
    }
  };

  /** Back to the brief, through the browser's history when the board has its entry, so Back and Forward agree. */
  const leaveBoard = () => {
    if (onBoardEntry()) {
      window.history.back();
    } else {
      boardSpot.current = window.scrollY;
      leftBoard.current = true;
      setView("studio");
    }
  };

  const reopenBoard = () => {
    boardSpot.current = null;
    window.history.pushState({ itsgiving: BOARD_ENTRY }, "");
    focusTitle.current = true;
    setView("board");
    window.scrollTo({ top: 0 });
  };

  /** A "Try one" chip fills the brief without running it, so the director sees what it holds first. */
  const fillExample = (example: (typeof TRY)[number]) => {
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
    <>
      <SiteHeader
        current="studio"
        badges={modes ? <ModeBadges qloo={modes.qloo} llm={modes.llm} treatment={(onBoard && treatment) || undefined} /> : initialBadges}
      />
      <p role="status" aria-live="polite" className="sr-only">
        {status}
      </p>
      <HandoffReader onOpen={openFrom} />

      <main className="mx-auto flex w-full max-w-[80rem] flex-1 flex-col gap-10 px-4 pt-8 pb-16 sm:px-8 sm:pt-10 print:p-0">
        {onBoard ? (
          <div className="flex flex-col gap-8">
            <button
              type="button"
              onClick={leaveBoard}
              className="-mb-2 flex min-h-11 items-center gap-2 self-start rounded-full border border-foreground py-2 pr-5 pl-4 text-[15px] font-bold hover:bg-card print:hidden"
            >
              <BackArrow />
              Back to the brief
            </button>
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
              save={
                accountsOn && seal ? (
                  <SaveControl key={`${treatment.id}:${treatment.createdAt}`} treatment={treatment} seal={seal} autoSave={saveOnOpen} />
                ) : undefined
              }
              back={
                <button
                  type="button"
                  onClick={leaveBoard}
                  aria-label="Back to the brief"
                  title="Back to the brief"
                  className="-ml-1.5 grid size-10 shrink-0 place-items-center rounded-full hover:bg-card"
                >
                  <BackArrow />
                </button>
              }
            />
          </div>
        ) : running && pending ? (
          // While it builds, the brief folds into one line and the run takes the page.
          <div className="flex flex-col gap-5">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-[28px] border border-line bg-card py-2 pr-2 pl-5 sm:rounded-full">
              <span className="font-bold">{briefLine(pending.form)}</span>
              <span className="text-[15px] text-dim">{THINKING[pending.form.thinking].label} thinking</span>
              <button
                type="button"
                onClick={() => stopActive.current()}
                className="ml-auto min-h-10 rounded-full border border-foreground px-4 text-sm font-semibold"
              >
                Stop
              </button>
            </div>
            {/* A run of its own each time: its credits and their queue start empty. */}
            <RunStage key={startedAt} steps={steps} startedAt={startedAt} thinking={pending.form.thinking} mock={modes?.qloo === "mock"} />
          </div>
        ) : (
          // One column on wide screens: the way back, a question or a failure line up with the brief beneath them.
          <div className="flex w-full flex-col gap-8 lg:mx-auto lg:max-w-[59rem]">
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
            {picker}
            {phase === "error" && runProblem && (
              <div className="flex flex-col gap-5">
                <FailCard problem={runProblem} onRetry={retry} />
                {steps.length > 0 && (
                  <div className="rounded-[28px] border border-line bg-card p-5 sm:p-6">
                    <Timeline steps={steps} size="stage" />
                  </div>
                )}
              </div>
            )}
            <div className="grid items-start gap-10 lg:grid-cols-[minmax(0,36rem)_minmax(0,19rem)] lg:justify-center lg:gap-16">
              <div className="flex min-w-0 flex-col gap-7">
                <div className="flex flex-col gap-3">
                  <h1 className="type-poster text-[clamp(3rem,6vw,4.75rem)]">new treatment</h1>
                  <p className="max-w-[40ch] text-[1.15rem] leading-[1.5] text-dim">
                    {form.format === "music_video" ? "An artist and a city" : "A film it's after and a city"} are enough to start.
                    Everything else is optional.
                  </p>
                </div>
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
              </div>
              <div className="hidden lg:sticky lg:top-8 lg:block">
                <YourPoster form={form} />
              </div>
            </div>
          </div>
        )}
      </main>

      <Toast toast={toast} />
    </>
  );
}
