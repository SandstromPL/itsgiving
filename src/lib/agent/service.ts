import { randomUUID } from "node:crypto";
import { getLlm, LlmError, type LlmDeps } from "../llm";
import { getQlooClient, type QlooClient } from "../qloo";
import { briefKey, type Brief } from "./brief";
import { runPipeline } from "./pipeline";
import type { AgentEvent, Treatment } from "./types";
import { RateLimiter, TtlCache } from "./guards";

export interface TreatmentService {
  qloo: QlooClient;
  llm: LlmDeps;
  cache: TtlCache<Treatment>;
  limiter: RateLimiter;
  /** Whole-run budget, under the route's maxDuration. */
  runTimeoutMs: number;
}

let shared: TreatmentService | undefined;

export function getTreatmentService(): TreatmentService {
  shared ??= {
    qloo: getQlooClient(),
    llm: getLlm(),
    cache: new TtlCache<Treatment>(200, 24 * 60 * 60 * 1000),
    // Cached briefs skip this; it only meters fresh runs.
    limiter: new RateLimiter(6, 60 * 1000),
    runTimeoutMs: 55_000,
  };
  return shared;
}

export function cacheKeyFor(brief: Brief, service: TreatmentService): string {
  return briefKey(brief, { qloo: service.qloo.mode, llm: service.llm.mode });
}

/**
 * Run (or replay from cache) one treatment, reporting progress through `emit`.
 * Never throws for expected failures: they become an "error" event.
 */
export async function streamTreatment(
  brief: Brief,
  service: TreatmentService,
  emit: (event: AgentEvent) => void,
  clientSignal: AbortSignal,
): Promise<void> {
  const runId = randomUUID();
  const key = cacheKeyFor(brief, service);
  const started = Date.now();
  const log = (fields: Record<string, unknown>) =>
    console.log(JSON.stringify({ evt: "treatment", runId, key, ms: Date.now() - started, ...fields }));

  const cached = service.cache.get(key);
  emit({ type: "start", runId, qlooMode: service.qloo.mode, llmMode: service.llm.mode, cached: Boolean(cached) });
  if (cached) {
    emit({ type: "treatment", treatment: cached, cached: true });
    emit({ type: "done" });
    log({ outcome: "cache_hit" });
    return;
  }

  const timeout = AbortSignal.timeout(service.runTimeoutMs);
  const signal = AbortSignal.any([clientSignal, timeout]);
  try {
    const outcome = await runPipeline(brief, { qloo: service.qloo, llm: service.llm }, emit, {
      id: key,
      signal,
      deadline: started + service.runTimeoutMs,
    });
    if (outcome.kind === "treatment") {
      const { treatment } = outcome;
      // Don't pin a degraded (template-written) treatment in live mode; retry later for a real one.
      const degraded = treatment.llm.some((t) => t.degraded);
      if (!degraded) service.cache.set(key, treatment);
      emit({ type: "treatment", treatment, cached: false });
      log({
        outcome: "ok",
        degraded,
        writtenBy: `${treatment.writtenBy.provider}:${treatment.writtenBy.model}`,
        llmCalls: treatment.llm.reduce((sum, t) => sum + t.calls, 0),
        qlooCalls: treatment.qloo.calls,
      });
    } else if (outcome.kind === "needs_input") {
      emit({ type: "needs_input", message: outcome.message, items: outcome.items });
      log({ outcome: "needs_input", items: outcome.items.length });
    } else {
      emit({ type: "error", message: outcome.message });
      log({ outcome: "failed", message: outcome.message });
    }
  } catch (err) {
    const aborted = signal.aborted || (err instanceof LlmError && err.kind === "aborted") || (err instanceof Error && err.name === "AbortError");
    if (aborted && clientSignal.aborted) {
      log({ outcome: "client_aborted" });
      return;
    }
    const message = aborted
      ? "This treatment took too long to build. Try again; repeated steps are cached."
      : "Something went wrong while building the treatment.";
    emit({ type: "error", message });
    log({ outcome: aborted ? "timeout" : "crash", error: err instanceof Error ? err.message : String(err) });
    if (!aborted) console.error(err);
  }
  emit({ type: "done" });
}

/** Server-sent event framing: one named event per line block. */
export function sseFrame(event: AgentEvent): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}
