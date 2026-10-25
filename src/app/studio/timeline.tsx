"use client";

import { useEffect, useState } from "react";
import { STEP_LABELS, STEP_ORDER, THINKING, type Thinking } from "@/lib/agent/options";
import type { LlmTrace, StepEvent, StepStatus } from "@/lib/agent/types";
import { describeKind } from "@/lib/llm/types";
import type { Provenance } from "@/lib/qloo/client";
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
      <summary className="cursor-pointer font-mono text-[12px] text-tungsten marker:text-edge hover:text-foreground">
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
        {trace.attempts.some((a) => a.outcome === "repaired") && <span>fixed its JSON on a retry</span>}
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
          <h4 id="agent-heading" className="type-head text-[1.4rem] leading-none">
            Run log
          </h4>
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

/** A film leader: the sweep fills over the expected run, the number counts down from 5. */
function Leader({ elapsed, expected }: { elapsed: number; expected: number }) {
  const progress = Math.min(elapsed / expected, 0.97);
  const count = Math.max(1, 5 - Math.floor((elapsed / expected) * 5));
  return (
    <span
      aria-hidden
      className="relative grid size-[120px] shrink-0 place-items-center rounded-full sm:size-[132px]"
      style={{ background: `conic-gradient(var(--accent) 0 ${progress * 360}deg, #3a3936 ${progress * 360}deg 360deg)` }}
    >
      <span className="absolute inset-x-1.5 top-1/2 h-0.5 -translate-y-1/2 bg-[#121211]" />
      <span className="absolute inset-y-1.5 left-1/2 w-0.5 -translate-x-1/2 bg-[#121211]" />
      <span className="relative grid size-[84px] place-items-center rounded-full border-2 border-foreground bg-background text-[50px] leading-none font-extrabold sm:size-[92px] sm:text-[54px]">
        {count}
      </span>
    </span>
  );
}

/** The stage while a first treatment is being built: the run itself, step by step, instead of an empty frame. */
export function RunStage({ steps, startedAt, thinking }: { steps: StepEvent[]; startedAt: number; thinking: Thinking }) {
  const elapsed = useElapsed(startedAt);
  const { t } = useLingo();
  const status = (id: (typeof STEP_ORDER)[number]) => steps.find((s) => s.id === id)?.status ?? "pending";
  return (
    <div className="flex flex-col gap-5">
      <div className="surface-dark grain flex flex-wrap items-center gap-x-8 gap-y-6 rounded-[2rem] bg-background p-7 sm:p-9">
        <Leader elapsed={elapsed} expected={thinking === "deep" ? 40 : 30} />
        <div className="min-w-0 flex-[1_1_16rem]">
          <h2 className="type-poster text-[clamp(3rem,6vw,5.25rem)]">{t.cooking}</h2>
          <p className="mt-3 text-[17px] leading-6 text-dim">
            {THINKING[thinking].hint} Qloo first, then the writer.{" "}
            <span aria-hidden className="font-mono text-foreground">
              {elapsed} s
            </span>
          </p>
          {elapsed >= 60 && <p className="mt-2 font-serif text-[1.6rem] leading-tight italic">{t.slowBurn}</p>}
        </div>
      </div>
      {/* One cell per pipeline step, like frames on a strip: a sequence, so it reads left to right. */}
      <ol aria-hidden className="grid grid-cols-11 gap-1">
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
