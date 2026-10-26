import { randomUUID } from "node:crypto";
import { getLlm, LlmError, type LlmDeps } from "../llm";
import { getQlooClient, type QlooClient } from "../qloo";
import { briefKey, type Brief } from "./brief";
import { loadFeatured, type FeaturedItem } from "./featured";
import { TIMING, runPipeline } from "./pipeline";
import type { AgentEvent, Treatment } from "./types";
import { RateLimiter, TtlCache } from "./guards";

export interface TreatmentService {
  qloo: QlooClient;
  llm: LlmDeps;
  cache: TtlCache<Treatment>;
  limiter: RateLimiter;
  /** Whole-run budget. Unset, the brief's thinking depth sets it (TIMING), under the route's maxDuration. */
  runTimeoutMs?: number;
  /** Pre-built treatments (scripts/featured.ts), answered like cache hits that never expire. */
  featured?: () => FeaturedItem[];
}

let shared: TreatmentService | undefined;

export function getTreatmentService(): TreatmentService {
  shared ??= {
    qloo: getQlooClient(),
    llm: getLlm(),
    cache: new TtlCache<Treatment>(200, 24 * 60 * 60 * 1000),
    // Cached briefs skip this; it only meters fresh runs.
    limiter: new RateLimiter(6, 60 * 1000),
    featured: () => loadFeatured(),
  };
  return shared;
}

export function cacheKeyFor(brief: Brief, service: TreatmentService): string {
  return briefKey(brief, { qloo: service.qloo.mode, llm: service.llm.mode });
}

function featuredTreatment(key: string, service: TreatmentService): Treatment | undefined {
  // Featured treatments are built from live data, so a mock run is never answered with one.
  if (!service.featured || service.qloo.mode !== "live" || service.llm.mode !== "live") return undefined;
  return service.featured().find((item) => cacheKeyFor(item.treatment.brief, service) === key)?.treatment;
}

/**
 * The cached or featured treatment for a brief. A quick brief also takes a deep one: better, and just
 * as instant.
 */
export function cachedTreatment(brief: Brief, service: TreatmentService): Treatment | undefined {
  const lookup = (b: Brief) => {
    const key = cacheKeyFor(b, service);
    return service.cache.get(key) ?? featuredTreatment(key, service);
  };
  const exact = lookup(brief);
  if (exact || brief.thinking === "deep") return exact;
  return lookup({ ...brief, thinking: "deep" });
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

  const cached = cachedTreatment(brief, service);
  emit({ type: "start", runId, qlooMode: service.qloo.mode, llmMode: service.llm.mode, cached: Boolean(cached) });
  if (cached) {
    emit({ type: "treatment", treatment: cached, cached: true });
    emit({ type: "done" });
    log({ outcome: "cache_hit" });
    return;
  }

  const runMs = service.runTimeoutMs ?? TIMING[brief.thinking].runMs;
  const timeout = AbortSignal.timeout(runMs);
  const signal = AbortSignal.any([clientSignal, timeout]);
  // Every await in the pipeline honours `signal`, but racing it as well guarantees the client gets
  // "error" and "done" at the deadline even if some call ignores the abort.
  const stopped = new Promise<never>((_, reject) => {
    if (signal.aborted) reject(signal.reason);
    signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  });
  const pipeline = runPipeline(brief, { qloo: service.qloo, llm: service.llm }, emit, {
    id: key,
    signal,
    deadline: started + runMs,
  });
  pipeline.catch(() => {}); // if the race is lost, its later rejection is expected
  stopped.catch(() => {});
  try {
    const outcome = await Promise.race([pipeline, stopped]);
    if (outcome.kind === "treatment") {
      const { treatment } = outcome;
      // Only pin a full treatment: a template-written one (live models down) or one missing a Qloo
      // section (a failed call) would otherwise be replayed for 24 hours after the cause has passed.
      const degraded = treatment.llm.some((t) => t.degraded);
      const problems = validationProblems(treatment);
      if (!degraded && treatment.complete) service.cache.set(key, treatment);
      emit({ type: "treatment", treatment, cached: false });
      log({
        outcome: "ok",
        degraded,
        complete: treatment.complete,
        writtenBy: `${treatment.writtenBy.provider}:${treatment.writtenBy.model}`,
        llmCalls: treatment.llm.reduce((sum, t) => sum + t.calls, 0),
        qlooCalls: treatment.qloo.calls,
        // Why each step went the way it did: which models failed and how, without the raw upstream text.
        attempts: treatment.llm.map((t) => `${t.step}:${t.attempts.map((a) => `${a.model}=${a.kind ?? a.outcome}`).join(",")}`),
        ...(problems.length > 0 ? { problems } : {}),
      });
    } else if (outcome.kind === "needs_input") {
      emit({ type: "needs_input", message: outcome.message, items: outcome.items });
      log({ outcome: "needs_input", items: outcome.items.length });
    } else {
      emit({ type: "error", message: outcome.message, ...(outcome.field ? { field: outcome.field } : {}) });
      log({ outcome: "failed", message: outcome.message });
    }
  } catch (err) {
    const aborted =
      signal.aborted || (err instanceof LlmError && err.kind === "aborted") || (err instanceof Error && err.name === "AbortError");
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

/**
 * What each rejected reply got wrong, in the validator's words, one line per invalid or repaired attempt:
 * the server log keeps it so a failed write can be diagnosed after the fact.
 */
export function validationProblems(treatment: Treatment): string[] {
  return treatment.llm.flatMap((t) =>
    t.attempts
      .filter((a) => (a.outcome === "invalid" || a.outcome === "repaired") && a.message)
      .map((a) => `${t.step}:${a.model}: ${a.message?.replace(/\s+/g, " ")}`),
  );
}

/** Server-sent event framing: one named event per line block. */
export function sseFrame(event: AgentEvent): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}
