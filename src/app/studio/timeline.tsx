"use client";

import type { LlmTrace, StepEvent, StepStatus } from "@/lib/agent/types";
import { describeKind } from "@/lib/llm/types";
import type { Provenance } from "@/lib/qloo/client";
import { Tape } from "./parts";

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
      <span className={`${base} ring-1 ring-line`} />
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
    <details className="mt-1.5 group">
      <summary className="cursor-pointer font-mono text-[11px] text-tungsten marker:text-line hover:text-amber-300">
        {calls.length} Qloo {calls.length === 1 ? "call" : "calls"}
        {cached > 0 ? `, ${cached} cached` : ""}
      </summary>
      <ul className="mt-1.5 flex flex-col gap-1">
        {calls.map((call, i) => (
          <li key={i} className="overflow-x-auto whitespace-nowrap rounded-sm bg-graphite px-2 py-1 font-mono text-[10.5px] leading-4 text-dim">
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
    <div className="mt-1.5 flex flex-col gap-1 text-[11px] leading-4">
      <p className="flex flex-wrap items-center gap-2 text-dim">
        {trace.producedBy.mock ? <Tape>Mock LLM</Tape> : <span className="text-paper">{trace.producedBy.model}</span>}
        {trace.attempts.some((a) => a.outcome === "repaired") && <span>fixed its JSON on a retry</span>}
      </p>
      {tried.length > 0 && (
        <p className="text-faint">
          Fell back past{" "}
          {tried.map((a) => `${a.model} (${a.kind ? describeKind(a.kind) : a.outcome})`).join(", ")}
        </p>
      )}
    </div>
  );
}

export function Timeline({ steps }: { steps: StepEvent[] }) {
  const current = [...steps].reverse().find((s) => s.status === "running");
  // No aria-busy here: screen readers may hold back the live region below until it clears.
  return (
    <section aria-labelledby="agent-heading" className="flex flex-col gap-3">
      <div>
        <h2 id="agent-heading" className="text-sm font-medium text-paper">
          Agent at work
        </h2>
        <p className="mt-1 text-xs leading-5 text-dim">
          Code makes every Qloo call. The model only plans and writes, citing what Qloo returned.
        </p>
      </div>
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
            <li key={step.id} className="flex gap-3 border-l border-line pb-4 pl-3 last:border-transparent">
              <Mark status={step.status} />
              <div className="min-w-0 flex-1">
                <p className={`text-sm ${step.status === "skipped" ? "text-faint" : "text-paper"}`}>
                  {step.label}
                  {step.ms !== undefined && step.status !== "skipped" && (
                    <span className="ml-2 text-xs text-faint">{(step.ms / 1000).toFixed(1)} s</span>
                  )}
                </p>
                {step.summary && <p className="mt-0.5 text-xs leading-5 text-dim">{step.summary}</p>}
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
