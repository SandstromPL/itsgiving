"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { EXAMPLES } from "@/lib/agent/examples";
import { THINKING, type Nudge } from "@/lib/agent/options";
import type { AgentEvent, Ambiguity, StepEvent, Treatment } from "@/lib/agent/types";
import type { LlmMode } from "@/lib/llm/config";
import type { QlooMode } from "@/lib/qloo/client";
import { accountsOn } from "@/lib/supabase/config";
import { playCut, slateDate } from "../cut";
import { Board } from "./board";
import { useBoardHistory } from "./board-history";
import { BriefForm } from "./brief-form";
import { useReceipts } from "./eggs";
import { briefLine, formFromBrief, toBrief, validateForm, type FormProblem, type FormState } from "./form";
import { HandoffReader, type Handoff } from "./handoff";
import { onScreen } from "./jump";
import { useLingo } from "./lingo";
import { BackArrow } from "./icons";
import { ModeBadges } from "./parts";
import { Picker } from "./picker";
import { SaveControl } from "./save";
import { studioSession, type RunInput } from "./session";
import { SiteHeader } from "./site-header";
import { useRunStream } from "./run-stream";
import { RunStage, Timeline, replaySteps } from "./timeline";
import { Toast, useToast } from "./toast";
import { backButton, pillButton, stopButton } from "./ui";

type Phase = "idle" | "running" | "needs_input" | "done" | "error";

const STUDIO_TITLE = "Studio: itsgiving";

const stopRunningSteps = (summary: string) => (steps: StepEvent[]) =>
  steps.map((s): StepEvent => (s.status === "running" ? { ...s, status: "error", summary } : s));

function FailCard({ problem, onRetry }: { problem: string; onRetry?: () => void }) {
  const { t } = useLingo();
  const rateLimited = /too many|rate limit/i.test(problem);
  return (
    <div role="alert" className="flex flex-col gap-3 rounded-[24px] border-2 border-safelight bg-safelight-wash p-6">
      <p className="type-head text-subsection leading-none text-safelight">{rateLimited ? t.rateTitle : t.failTitle}</p>
      <p className="text-body leading-6">{problem}</p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="self-start rounded-full bg-foreground px-5 py-3 text-ui font-bold text-background"
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
  const { view, showBoard, leaveBoard } = useBoardHistory();
  const stream = useRunStream();
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
  const [toast, setToast] = useToast();
  const focusTitle = useRef(false);
  const failedBefore = useRef(false);
  /** A rework a featured page asked for, run once its board has opened. */
  const pendingNudge = useRef<Nudge | null>(null);
  /** The latest run(), for the rework one run starts as it lands; kept current after each render. */
  const runLatest = useRef<(input: RunInput) => Promise<void>>(async () => {});
  const running = phase === "running";
  const onBoard = treatment !== null && view === "board";
  useReceipts(treatment);
  /** Whether the run stage is what's on screen, and the take on the board, for a run's events as they land. */
  const stageOn = useRef(false);
  const takeNow = useRef(take);
  useEffect(() => {
    stageOn.current = !onBoard;
    takeNow.current = take;
  });

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

  // Move focus to the treatment's title once it renders, new or reopened (it also scrolls it into view).
  useEffect(() => {
    if (!treatment || view !== "board" || !focusTitle.current) return;
    focusTitle.current = false;
    // The board on screen: a featured page left earlier is still in the document, hidden, with its own title.
    onScreen("treatment-title")?.focus();
  }, [treatment, view]);

  const run = async (input: RunInput) => {
    const began = Date.now();

    setPending(input);
    setFormProblem(null);
    setRunProblem(null);
    setQuestion(null);
    setSteps([]);
    setStartedAt(began);
    setPhase("running");
    setStatus("Building the treatment…");

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
          setStatus(`itsgiving needs your choice. ${event.message}`);
          break;
        case "treatment": {
          const landed = event.treatment;
          // Built from the brief, the run stage is on screen: the slate claps, it's pulled up out of frame, and the
          // camera cuts to the board. A rework replaces the board in place.
          const fromStage = stageOn.current;
          const land = () => {
            focusTitle.current = true;
            setTreatment(landed);
            setSeal(event.seal ?? null);
            setSaveOnOpen(false);
            // A board opened from the brief gets its history entry; a rework replaces the board in place.
            showBoard("unless-there");
            setShown(input);
            setPhase("done");
            if (event.cached) setSteps(replaySteps(landed));
            if (fromStage) window.scrollTo(0, 0);
          };
          const toast = () => {
            if (!event.cached)
              setToast({
                title: failedBefore.current ? lingo.back : lingo.done,
                line: `${landed.title}: ${Math.round((Date.now() - began) / 1000)} s, ${landed.qloo.calls} Qloo calls`,
                open: true,
              });
            failedBefore.current = false;
          };
          if (fromStage) {
            void playCut(() => flushSync(land), { slate: { scene: landed.title, take: takeNow.current, date: slateDate() } }).then(toast);
          } else {
            land();
            toast();
          }
          setStatus(`Treatment ready: ${landed.title}.`);
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
          if (event.field === "stand_ins") askOnField({ field: "standIns", message: event.message });
          else fail(event.message);
          break;
        case "done":
          break;
      }
    };

    await stream.start(toBrief(input.form, input.picks, input.nudges), onEvent, {
      fail,
      stopped: () => {
        pendingNudge.current = null;
        setPhase(treatment ? "done" : "idle");
        setSteps(stopRunningSteps("Stopped."));
        setStatus("Stopped.");
      },
    });
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
    focusTitle.current = true;
    showBoard("new");
    window.scrollTo({ top: 0 });
    setStatus(`Opened ${handed.title}.`);
    if (nudge) {
      setTake(2);
      void runLatest.current({ ...input, nudges: [nudge] });
    }
  };

  const reopenBoard = () => {
    focusTitle.current = true;
    showBoard("new");
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
            <button type="button" onClick={leaveBoard} className={`${pillButton} -mb-2 self-start print:hidden`}>
              <BackArrow />
              Back to the brief
            </button>
            {phase === "error" && runProblem && <FailCard problem={runProblem} onRetry={retry} />}
            {running && (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-[28px] border border-foreground bg-card py-2 pr-2 pl-5 sm:rounded-full print:hidden">
                <span aria-hidden className="size-2.5 rounded-full bg-foreground motion-safe:animate-pulse" />
                <span className="font-bold">{lingo.cookingAgain}</span>
                {current && <span className="text-ui text-dim">{current}</span>}
                <button type="button" onClick={stream.stop} className={stopButton}>
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
                <button type="button" onClick={leaveBoard} aria-label="Back to the brief" title="Back to the brief" className={backButton}>
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
              <span className="text-ui text-dim">{THINKING[pending.form.thinking].label} thinking</span>
              <button type="button" onClick={stream.stop} className={stopButton}>
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
                className="flex min-h-11 max-w-full items-center self-start rounded-full bg-foreground px-5 py-2 text-ui font-bold text-background hover:opacity-90"
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
            <div className="flex w-full max-w-[40rem] min-w-0 flex-col gap-7 self-center">
              <div className="flex flex-col gap-3">
                <h1 className="type-poster text-display">new treatment</h1>
                <p className="max-w-[40ch] text-lead leading-[1.5] text-dim">
                  {form.format === "music_video" ? "An artist and a city" : "A film it's after and a city"} are enough to start. Everything
                  else is optional.
                </p>
              </div>
              {/* What the brief adds up to so far, where the floating poster card used to sit. */}
              <p className="flex flex-col gap-0.5 rounded-[20px] border border-line bg-card px-5 py-3.5" aria-live="polite">
                <small className="text-caption font-semibold text-faint">Your treatment</small>
                <b className="text-body leading-snug">{briefLine(form)}</b>
              </p>
              <BriefForm
                form={form}
                onChange={setForm}
                onSubmit={() => startOver(form)}
                onStop={stream.stop}
                running={running}
                problem={formProblem}
                examples={TRY}
                onExample={fillExample}
              />
            </div>
          </div>
        )}
      </main>

      <Toast toast={toast} />
    </>
  );
}
