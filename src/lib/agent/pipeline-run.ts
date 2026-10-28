import type { LlmDeps } from "../llm";
import type { CompactEntity, Provenance, QlooClient } from "../qloo";
import type { TmdbClient } from "../tmdb";
import { runTool } from "../tools/registry";
import { normalizeName } from "../tools/shared";
import type { ToolResult } from "../tools/types";
import type { Brief } from "./brief";
import { withYear } from "./options";
import type { AgentEvent, Ambiguity, BriefField, Credit, CreditKind, LlmTrace, StepId, StepStatus, Treatment } from "./types";

// What the pipeline's stages share: the run's inputs and outcomes, the state every stage adds to (Qloo's requests,
// failures and warnings, the model calls, the notes), and a few small helpers. Each stage takes the run as `run`.

export interface PipelineDeps {
  qloo: QlooClient;
  llm: LlmDeps;
  /** For the reference films' stills; without it (or its key) the board shows Qloo's posters on the cards only. */
  tmdb?: TmdbClient;
  now?: () => Date;
}

export type PipelineOutcome =
  | { kind: "treatment"; treatment: Treatment }
  | { kind: "needs_input"; message: string; items: Ambiguity[] }
  /** `field`: the brief field that can fix it, when there is one. */
  | { kind: "failed"; message: string; field?: BriefField };

/** Ends a step `begin` started: its status and summary, with the model call behind it or a credit for what it found. */
export type EndStep = (status: StepStatus, summary: string, extra?: { llm?: LlmTrace; credit?: Credit }) => void;

/** One run's state, handed to each stage. */
export interface Run {
  /** Names the treatment and the run's log lines. */
  id: string;
  brief: Brief;
  deps: PipelineDeps;
  emit: (event: AgentEvent) => void;
  signal: AbortSignal;
  /** When the run must be done, in epoch ms; Infinity when the caller set no deadline. */
  deadline: number;
  /** Every Qloo request so far, by step: each step's event shows its own, and the treatment keeps them all. */
  trail: Partial<Record<StepId, Provenance[]>>;
  /** Caveats for the treatment, in plain words, in the order they came up. */
  notes: string[];
  traces: LlmTrace[];
  /**
   * Every Qloo call that failed, as step:tool=kind: the treatment is then partial and must not be cached, even when a
   * lighter rung of the same step found what it needed.
   */
  failures: string[];
  warnings: Set<string>;
  /** Model calls begun: a run makes three at most. */
  llmCalls: number;
  /** Runs a Qloo tool for a step, keeping its requests, any failure and its warnings. */
  tool: <T>(step: StepId, name: string, input: unknown) => Promise<ToolResult<T>>;
  /** Shows a step as running; the function it returns ends the step, timed from now. */
  begin: (id: StepId, label: string) => EndStep;
}

export function startRun(
  brief: Brief,
  deps: PipelineDeps,
  emit: (event: AgentEvent) => void,
  options: { id: string; signal: AbortSignal; deadline?: number },
): Run {
  const { signal } = options;
  const trail: Run["trail"] = {};
  const failures: string[] = [];
  const warnings = new Set<string>();

  const tool = async <T>(step: StepId, name: string, input: unknown): Promise<ToolResult<T>> => {
    signal.throwIfAborted();
    const result = (await runTool(name, input, { qloo: deps.qloo, signal })) as ToolResult<T>;
    // A request cut off by the run's deadline surfaces here as the abort, not as a tool error.
    signal.throwIfAborted();
    (trail[step] ??= []).push(...result.provenance);
    if (result.status === "error") failures.push(`${step}:${name}=${result.error?.kind ?? "error"}`);
    for (const warning of result.warnings) warnings.add(warning);
    return result;
  };

  const begin = (id: StepId, label: string): EndStep => {
    emit({ type: "step", id, status: "running", label });
    const started = Date.now();
    return (status, summary, { llm, credit } = {}) =>
      emit({ type: "step", id, status, label, summary, ms: Date.now() - started, qloo: trail[id], llm, credit });
  };

  return {
    id: options.id,
    brief,
    deps,
    emit,
    signal,
    deadline: options.deadline ?? Number.POSITIVE_INFINITY,
    trail,
    notes: [],
    traces: [],
    failures,
    warnings,
    llmCalls: 0,
    tool,
    begin,
  };
}

export function clip(text: string, max: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean;
}

export function uniqueBy<T>(items: T[], key: (item: T) => string): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const k = key(item);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export function names(entities: CompactEntity[]): string[] {
  return entities.map((e) => withYear(e.name, e.year));
}

/** How many names a credit carries: the run stage sets the newest credit large, so a few say it. */
const CREDIT_NAMES = 3;

/** A step's credit for what it found (entities, tags or an area), or none when it found nothing to name. */
export function toCredit(kind: CreditKind, found: { name: string }[], standInFor?: string): Credit | undefined {
  const names = uniqueBy(found, (item) => normalizeName(item.name))
    .slice(0, CREDIT_NAMES)
    .map((item) => item.name);
  if (names.length === 0) return undefined;
  return standInFor ? { kind, names, standInFor } : { kind, names };
}
