"use client";

import { useEffect, useState, type CSSProperties } from "react";
import { STEP_LABELS, STEP_ORDER, THINKING, tagLabel, type Thinking } from "@/lib/agent/options";
import type { CreditKind, LlmTrace, StepEvent, StepStatus, Treatment } from "@/lib/agent/types";
import { describeKind } from "@/lib/llm/types";
import type { Provenance } from "@/lib/qloo/client";
import { useCredits, useShown, type Billed } from "./credits";
import { useLingo } from "./lingo";
import { Tape, thinkingName } from "./parts";

const STATUS_TEXT: Record<StepStatus, string> = {
  running: "In progress",
  done: "Done",
  warning: "Done with a caveat",
  skipped: "Skipped",
  error: "Failed",
};

function Mark({ status }: { status: StepStatus }) {
  const base = "mt-0.5 grid size-5 shrink-0 place-items-center rounded-full text-[11px] font-bold";
  const mark =
    status === "running" ? (
      <span className={`${base} border-2 border-foreground`}>
        <span className="size-2 rounded-full bg-foreground motion-safe:animate-pulse" />
      </span>
    ) : status === "done" ? (
      <span className={`${base} bg-foreground text-background`}>✓</span>
    ) : status === "warning" ? (
      <span className={`${base} border-2 border-tungsten text-tungsten`}>!</span>
    ) : status === "error" ? (
      <span className={`${base} bg-safelight text-white`}>×</span>
    ) : (
      <span className={`${base} border-2 border-line`} />
    );
  return (
    <>
      <span aria-hidden>{mark}</span>
      <span className="sr-only">{STATUS_TEXT[status]}:</span>
    </>
  );
}

function QlooCalls({ calls }: { calls: Provenance[] }) {
  // Counts only: calls in a step run in parallel, so summing their durations would overstate the step's time.
  const cached = calls.filter((c) => c.cached).length;
  return (
    <details className="group mt-1.5">
      <summary className="cursor-pointer py-1 font-mono text-[12px] text-tungsten marker:text-edge hover:text-foreground">
        {calls.length} Qloo {calls.length === 1 ? "call" : "calls"}
        {cached > 0 ? `, ${cached} cached` : ""}
      </summary>
      <ul className="mt-1.5 flex flex-col gap-1">
        {calls.map((call, i) => (
          // The request itself is code, so it keeps a code face.
          <li
            key={i}
            className="overflow-x-auto rounded-lg bg-field px-2.5 py-1.5 font-mono text-[11px] leading-4 whitespace-nowrap text-dim"
          >
            <span className="text-foreground">GET {call.path}</span> {new URLSearchParams(call.query).toString()}{" "}
            <span className="text-faint">
              {call.status} {call.cached ? "cached" : `${call.durationMs} ms`}
              {call.mode === "mock" ? " mock" : ""}
            </span>
          </li>
        ))}
      </ul>
    </details>
  );
}

function LlmLine({ trace }: { trace: LlmTrace }) {
  const tried = trace.attempts.filter((a) => a.outcome !== "ok" && a.outcome !== "repaired");
  return (
    <div className="mt-1.5 flex flex-col gap-1 text-[13px] leading-5">
      <p className="flex flex-wrap items-center gap-x-2 text-dim">
        {trace.producedBy.mock ? <Tape>Mock LLM</Tape> : <span className="font-semibold text-foreground">{trace.producedBy.model}</span>}
        {trace.producedBy.reasoning && <span>{thinkingName(trace.producedBy.reasoning)}</span>}
        {trace.attempts.some((a) => a.outcome === "repaired") && <span>needed a second try</span>}
      </p>
      {tried.length > 0 && (
        <p className="text-faint">
          Fell back past {tried.map((a) => `${a.model} (${a.kind ? describeKind(a.kind) : a.outcome})`).join(", ")}
        </p>
      )}
    </div>
  );
}

/**
 * Every step of the run with the Qloo requests and model calls behind it: on the stage while a first treatment
 * is built, in the credits after.
 */
export function Timeline({ steps, size = "credits" }: { steps: StepEvent[]; size?: "credits" | "stage" }) {
  const current = [...steps].reverse().find((s) => s.status === "running");
  const stage = size === "stage";
  // No aria-busy here: screen readers may hold back the live region below until it clears.
  return (
    <section
      aria-labelledby={stage ? undefined : "agent-heading"}
      aria-label={stage ? "Run log" : undefined}
      className="flex flex-col gap-4"
    >
      {!stage && (
        <div>
          <h3 id="agent-heading" className="type-head text-[1.4rem] leading-none">
            Run log
          </h3>
          <p className="mt-1.5 text-[13px] leading-5 text-faint">
            Code makes every Qloo call. The model only plans and writes, citing what Qloo returned.
          </p>
        </div>
      )}
      <p className="sr-only" aria-live="polite">
        {current ? `${current.label}…` : ""}
      </p>
      {steps.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-line px-4 py-4 text-[13px] leading-5 text-faint">
          Each step and every Qloo request behind it will show here.
        </p>
      ) : (
        <ol className="flex flex-col">
          {steps.map((step) => (
            <li key={step.id} className="flex gap-3 border-b border-line py-3 last:border-0">
              <Mark status={step.status} />
              <div className="min-w-0 flex-1">
                <p
                  className={`flex flex-wrap items-baseline justify-between gap-x-3 text-[16px] ${step.status === "skipped" ? "text-faint" : ""}`}
                >
                  <span className={step.status === "running" ? "font-bold" : ""}>{step.label}</span>
                  {step.ms !== undefined && step.status !== "skipped" && (
                    <span className="font-mono text-[13px] text-faint">{(step.ms / 1000).toFixed(1)} s</span>
                  )}
                </p>
                {step.summary && <p className="mt-0.5 text-[14px] leading-5 text-dim">{step.summary}</p>}
                {step.llm && <LlmLine trace={step.llm} />}
                {step.qloo && step.qloo.length > 0 && <QlooCalls calls={step.qloo} />}
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

/**
 * Timeline rows for a treatment that wasn't built just now: the calls and models that originally made it, from the
 * cache or the featured set.
 */
export function replaySteps(t: Treatment, note = "Replayed from cache: no new calls this time.", own = true): StepEvent[] {
  return STEP_ORDER.flatMap((id): StepEvent[] => {
    const qloo = t.qloo.steps[id];
    const llm = t.llm.find((trace) => trace.step === id);
    if (!qloo?.length && !llm) return [];
    // An example was briefed by someone else, so its "your taste" was theirs.
    const label = id === "overlap" && !own ? "Compare with the director's taste" : STEP_LABELS[id];
    return [{ type: "step", id, status: "done", label, qloo, llm }];
  }).map((step, i) => (i === 0 ? { ...step, summary: note } : step)); // the note once, at the top
}

const STRIP_TONE: Record<StepStatus | "pending", string> = {
  pending: "bg-line",
  running: "bg-foreground motion-safe:animate-pulse",
  done: "bg-foreground",
  warning: "bg-tungsten",
  skipped: "bg-line/60",
  error: "bg-safelight",
};

/** Seconds since `startedAt`, ticking once a second. */
function useElapsed(startedAt: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return Math.max(0, Math.round((now - startedAt) / 1000));
}

/**
 * A film leader that follows the run itself: the sweep fills as each step finishes (easing to its new place) and the
 * number counts the steps still to go. Nothing is estimated, so a long write holds it near the end.
 */
function Leader({ settled, total }: { settled: number; total: number }) {
  return (
    <span
      aria-hidden
      className="leader relative grid size-[120px] shrink-0 place-items-center rounded-full sm:size-[132px]"
      style={{ "--sweep": `${Math.round((settled / total) * 360)}deg` } as CSSProperties}
    >
      <span className="absolute inset-x-1.5 top-1/2 h-0.5 -translate-y-1/2 bg-[#121211]" />
      <span className="absolute inset-y-1.5 left-1/2 w-0.5 -translate-x-1/2 bg-[#121211]" />
      <span className="relative grid size-[84px] place-items-center rounded-full border-2 border-foreground bg-background text-[50px] leading-none font-extrabold tabular-nums sm:size-[92px] sm:text-[54px]">
        {Math.max(1, total - settled)}
      </span>
    </span>
  );
}

/** The words before a credit's names: a film's opening titles, or plain labels in unc mode. */
const BILLING: Record<"genz" | "plain", Record<CreditKind, string>> = {
  genz: {
    subject: "Starring the audience of",
    audience: "Featuring a taste for",
    base: "Shot where the fans are",
    style: "Styled in",
    films: "With nods to",
    brands: "Wardrobe by",
    places: "On location at",
  },
  plain: {
    subject: "Audience of",
    audience: "Audience taste",
    base: "Shoot base",
    style: "Style tags",
    films: "Reference films",
    brands: "Wardrobe",
    places: "Locations",
  },
};

/** A credit's role. An artist Qloo doesn't have is named here, in plain type: the name is the brief's, not Qloo's. */
function role(credit: Billed, unc: boolean): string {
  const words = BILLING[unc ? "plain" : "genz"][credit.kind];
  return credit.standInFor ? `${words} ${credit.standInFor}, read through` : words;
}

/**
 * Qloo's names in lime (tape pink when mocked). Lines break between names, not inside one that fits, and never before
 * the dot that separates them.
 */
function Names({ credit, tone }: { credit: Billed; tone: string }) {
  const tags = credit.kind === "audience" || credit.kind === "style";
  return (
    <span className="flex flex-wrap gap-x-[0.3em]">
      {credit.names.map((name, i) => (
        <span key={i} className={tone}>
          {tags ? tagLabel(name) : name}
          {i < credit.names.length - 1 && <span className="text-faint">{"\u00a0·"}</span>}
        </span>
      ))}
    </span>
  );
}

/**
 * What the run has found, billed like a film's opening titles as each step lands: the newest set large, the ones
 * before it small beneath, like end credits. Each enters with a short fade and rise (a fade alone with reduced
 * motion); one a re-plan updates keeps its place. Their room is held from the start, so a credit that wraps or a new
 * one doesn't move what's beneath. Screen readers skip it: the run log reads every step.
 */
function Credits({ steps, mock }: { steps: StepEvent[]; mock: boolean }) {
  const { unc } = useLingo();
  const credits = useCredits(steps);
  const shown = useShown(credits.length);
  const newest = shown > 0 ? credits[shown - 1] : undefined;
  const tone = mock ? "text-tape" : "text-accent";
  return (
    <div aria-hidden className="mt-6 border-t border-line pt-5">
      {/* A role and two lines of names, at the names' size. */}
      <div className="min-h-[calc(1.625rem_+_2.2em)] text-[1.5rem] sm:text-[clamp(1.75rem,2.6vw,2.25rem)]">
        {newest && (
          <div key={newest.kind} className="transition-[opacity,translate] duration-[350ms] starting:translate-y-2.5 starting:opacity-0">
            <p className="text-[15px] leading-5 text-dim">{role(newest, unc)}</p>
            <p className="type-head mt-1.5 leading-[1.1]">
              <Names credit={newest} tone={tone} />
            </p>
          </div>
        )}
      </div>
      {/* Six rows, held on wider screens, where the run log under the stage is in view. */}
      <dl className="mt-6 grid content-start gap-y-2.5 sm:min-h-[10.625rem] sm:grid-cols-[12rem_minmax(0,1fr)] sm:gap-x-5">
        {credits.slice(0, Math.max(0, shown - 1)).map((credit) => (
          <div key={credit.kind} className="grid transition-opacity duration-300 starting:opacity-0 sm:col-span-2 sm:grid-cols-subgrid">
            <dt className="text-[14px] leading-5 text-faint sm:text-right">{role(credit, unc)}</dt>
            <dd className="text-[15px] leading-5 font-semibold">
              <Names credit={credit} tone={tone} />
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/**
 * The stage while a first treatment is being built: the run itself, step by step, instead of an empty frame. Past
 * ten seconds people look away, so it says how long a run usually takes (the depth's hint), which step it's on, and
 * keeps the tab's title counting. What each step finds rolls in as the run's credits.
 */
export function RunStage({
  steps,
  startedAt,
  thinking,
  mock,
}: {
  steps: StepEvent[];
  startedAt: number;
  thinking: Thinking;
  mock: boolean;
}) {
  const elapsed = useElapsed(startedAt);
  const { t } = useLingo();
  const status = (id: (typeof STEP_ORDER)[number]) => steps.find((s) => s.id === id)?.status ?? "pending";
  const settled = steps.filter((s) => s.status !== "running").length;
  const current = [...steps].reverse().find((s) => s.status === "running")?.label;
  useEffect(() => {
    document.title = `Building… ${elapsed} s`;
  }, [elapsed]);
  return (
    <div className="flex flex-col gap-5">
      <div className="surface-dark grain flex flex-wrap items-center gap-x-8 gap-y-6 rounded-[2rem] bg-background p-7 sm:items-start sm:p-9">
        <Leader settled={Math.min(settled, STEP_ORDER.length)} total={STEP_ORDER.length} />
        <div className="min-w-0 flex-[1_1_16rem]">
          <h2 className="type-poster text-[clamp(3rem,6vw,5.25rem)]">{t.cooking}</h2>
          <p className="mt-3 text-[17px] leading-6 text-dim">
            {THINKING[thinking].hint} Qloo first, then the writer.{" "}
            <span aria-hidden className="font-mono text-foreground">
              {elapsed} s
            </span>
          </p>
          <p className="mt-2 text-[15px] font-semibold">
            Step {Math.min(STEP_ORDER.length, settled + 1)} of {STEP_ORDER.length}
            {current ? `: ${current}` : ""}
          </p>
          <Credits steps={steps} mock={mock} />
          {elapsed >= 60 && <p className="mt-2 font-serif text-[1.6rem] leading-tight italic">{t.slowBurn}</p>}
        </div>
      </div>
      {/* One cell per pipeline step, like frames on a strip: a sequence, so it reads left to right. */}
      <ol aria-hidden className="grid gap-1" style={{ gridTemplateColumns: `repeat(${STEP_ORDER.length}, minmax(0, 1fr))` }}>
        {STEP_ORDER.map((id) => (
          <li key={id} title={STEP_LABELS[id]} className={`h-1.5 rounded-full ${STRIP_TONE[status(id)]}`} />
        ))}
      </ol>
      <div className="rounded-[28px] border border-line bg-card p-5 sm:p-6">
        <Timeline steps={steps} size="stage" />
      </div>
    </div>
  );
}
