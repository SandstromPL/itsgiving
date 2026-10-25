"use client";

import { useEffect, useState } from "react";
import { STEP_LABELS, STEP_ORDER, THINKING, type Thinking } from "@/lib/agent/options";
import type { LlmTrace, StepEvent, StepStatus } from "@/lib/agent/types";
import { describeKind } from "@/lib/llm/types";
import type { Provenance } from "@/lib/qloo/client";
import { Tape, thinkingName } from "./parts";

const STATUS_TEXT: Record<StepStatus, string> = {
  running: "In progress",
  done: "Done",
  warning: "Done with a caveat",
  skipped: "Skipped",
  error: "Failed",
};

function Mark({ status }: { status: StepStatus }) {
  const base = "mt-1 grid size-4 shrink-0 place-items-center rounded-full";
  const mark =
    status === "running" ? (
      <span className={`${base} ring-1 ring-tungsten`}>
        <span className="size-1.5 rounded-full bg-tungsten motion-safe:animate-pulse" />
      </span>
    ) : status === "done" ? (
      <span className={`${base} bg-paper text-[10px] font-bold text-ink`}>✓</span>
    ) : status === "warning" ? (
      <span className={`${base} text-[10px] font-bold text-tungsten ring-1 ring-tungsten`}>!</span>
    ) : status === "error" ? (
      <span className={`${base} bg-safelight text-[10px] font-bold text-ink`}>×</span>
    ) : (
      <span className={`${base} ring-1 ring-edge`} />
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
      <summary className="type-evidence cursor-pointer text-[11.5px] text-tungsten marker:text-edge hover:text-paper">
        {calls.length} Qloo {calls.length === 1 ? "call" : "calls"}
        {cached > 0 ? `, ${cached} cached` : ""}
      </summary>
      <ul className="mt-1.5 flex flex-col gap-1">
        {calls.map((call, i) => (
          // The request itself is code, so it keeps a code face.
          <li
            key={i}
            className="overflow-x-auto whitespace-nowrap rounded-sm bg-frame px-2 py-1 font-mono text-[10.5px] leading-4 text-dim"
          >
            <span className="text-paper">GET {call.path}</span> {new URLSearchParams(call.query).toString()}{" "}
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
    <div className="mt-1.5 flex flex-col gap-1 text-xs leading-5">
      <p className="flex flex-wrap items-center gap-x-2 text-dim">
        {trace.producedBy.mock ? <Tape>Mock LLM</Tape> : <span className="text-paper">{trace.producedBy.model}</span>}
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
 * Every step of the run with the Qloo requests and model calls behind it. The rail shows it compact
 * after a run; while a treatment is first being built it takes the stage, larger, without its heading.
 */
export function Timeline({ steps, size = "rail" }: { steps: StepEvent[]; size?: "rail" | "stage" }) {
  const current = [...steps].reverse().find((s) => s.status === "running");
  const stage = size === "stage";
  // No aria-busy here: screen readers may hold back the live region below until it clears.
  return (
    <section
      aria-labelledby={stage ? undefined : "agent-heading"}
      aria-label={stage ? "Run log" : undefined}
      className="flex flex-col gap-3"
    >
      {!stage && (
        <div>
          <h2 id="agent-heading" className="type-head text-lg text-paper">
            Run log
          </h2>
          <p className="mt-1 text-xs leading-5 text-dim">
            Code makes every Qloo call. The model only plans and writes, citing what Qloo returned.
          </p>
        </div>
      )}
      <p className="sr-only" aria-live="polite">
        {current ? `${current.label}…` : ""}
      </p>
      {steps.length === 0 ? (
        <p className="rounded-md border border-dashed border-line px-3 py-4 text-xs leading-5 text-faint">
          Each step and every Qloo request behind it will show here.
        </p>
      ) : (
        <ol className="flex flex-col">
          {steps.map((step) => (
            <li key={step.id} className={`flex gap-3 border-l border-line pl-3 last:border-transparent ${stage ? "pb-5" : "pb-4"}`}>
              <Mark status={step.status} />
              <div className="min-w-0 flex-1">
                <p className={`${stage ? "text-base" : "text-sm"} ${step.status === "skipped" ? "text-faint" : "text-paper"}`}>
                  {step.label}
                  {step.ms !== undefined && step.status !== "skipped" && (
                    <span className="type-evidence ml-2 text-xs text-faint">{(step.ms / 1000).toFixed(1)} s</span>
                  )}
                </p>
                {step.summary && <p className={`mt-0.5 leading-5 text-dim ${stage ? "text-sm" : "text-xs"}`}>{step.summary}</p>}
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
  running: "bg-tungsten motion-safe:animate-pulse",
  done: "bg-paper",
  warning: "bg-tungsten",
  skipped: "bg-edge/40",
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

/** The stage while a first treatment is being built: the run itself, step by step, instead of an empty frame. */
export function RunStage({ steps, startedAt, thinking }: { steps: StepEvent[]; startedAt: number; thinking: Thinking }) {
  const elapsed = useElapsed(startedAt);
  const status = (id: (typeof STEP_ORDER)[number]) => steps.find((s) => s.id === id)?.status ?? "pending";
  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
          <h2 className="type-poster text-[clamp(2.5rem,5vw,4rem)]">Building the treatment</h2>
          <p className="type-evidence text-sm text-dim" aria-hidden>
            {elapsed} s
          </p>
        </div>
        <p className="max-w-[62ch] text-sm leading-6 text-dim">
          {THINKING[thinking].label} thinking: {THINKING[thinking].hint.charAt(0).toLowerCase() + THINKING[thinking].hint.slice(1)} Each
          Qloo request appears below as it happens.
        </p>
      </div>
      {/* One cell per pipeline step, like frames on a strip: a sequence, so it reads left to right. */}
      <ol aria-hidden className="grid grid-cols-10 gap-1">
        {STEP_ORDER.map((id) => (
          <li key={id} title={STEP_LABELS[id]} className={`h-1.5 rounded-full ${STRIP_TONE[status(id)]}`} />
        ))}
      </ol>
      <Timeline steps={steps} size="stage" />
    </div>
  );
}
