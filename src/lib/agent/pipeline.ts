import { describeKind, generateJson, type LlmResult, type Reasoning } from "../llm";
import type { Brief } from "./brief";
import { STEP_LABELS, withYear, type Thinking } from "./options";
import { assemble, type Written } from "./pipeline-assemble";
import { readAudience, type Audience } from "./pipeline-audience";
import { WRITER_REFS, executePlan, type Execution } from "./pipeline-execute";
import { WRITER_FACES, findPeople, type People } from "./pipeline-people";
import { resolveCast, type Cast } from "./pipeline-resolve";
import { clip, startRun, toCredit, type PipelineDeps, type PipelineOutcome, type Run } from "./pipeline-run";
import {
  SYSTEM_PROMPT,
  cleanWords,
  mockPlan,
  planPrompt,
  planSchema,
  type Plan,
  type PlanContext,
  type PlanDraft,
  type ToneCandidate,
} from "./plan";
import type { AgentEvent, Credit, LlmStep, LlmTrace } from "./types";
import {
  mockDraft,
  normalizeDraft,
  refScrubber,
  writePrompt,
  writeSchema,
  type Ref,
  type TitleCharacter,
  type WriteContext,
} from "./write";

export { closestTags } from "./pipeline-execute";
export { parseTitle } from "./pipeline-resolve";
export type { PipelineDeps, PipelineOutcome } from "./pipeline-run";

// The lean agent: code runs every Qloo tool deterministically and the LLM is
// called at most three times (plan, an optional re-plan, write). Resolve ->
// read audience (+ overlap with the director's films, + the heatmap of where
// the fans are) -> plan (which picks the shoot base) -> find_tags, references,
// wardrobe, locations near the base (relaxing short results) -> write.
// The model steps live here. The Qloo steps and the treatment's assembly have
// modules of their own (pipeline-*.ts), and every step shares the run's state
// through Run (pipeline-run.ts).

/**
 * Time limits per thinking depth, sized from live DeepSeek runs. Deep plans take 4-7 s, and 13-14 s in DeepSeek's busy
 * hours (01:00-04:00 and 06:00-10:00 UTC on weekdays). Since the characters (2026-10-29), deep writes take 35-53 s, and
 * up to 59 s in the busy hours. Quick plans took about 3 s and quick writes 12-18 s (2026-10-25). Each limit leaves room
 * for one fallback to a free model, and the run limit sits under the route's maxDuration: the deep run's 135 s still
 * leaves its plan the first 45 s, as before the write's limit rose from 60 s.
 */
export const TIMING: Record<Thinking, { planMs: number; writeMs: number; runMs: number }> = {
  deep: { planMs: 20_000, writeMs: 75_000, runMs: 135_000 },
  quick: { planMs: 15_000, writeMs: 45_000, runMs: 90_000 },
};
const REASONING: Record<Thinking, Reasoning> = { deep: "high", quick: "low" };
/** Held back while planning, on top of the write's own limit: the Qloo calls before it and one fallback. */
const WRITE_MARGIN_MS = 15_000;
/** How often a model call that is still thinking says so: it keeps the stream and the timeline alive. */
const TICK_MS = 5_000;

/** A thinking depth's time limits, and how much of the run planning leaves for the write. */
function timeLimits(thinking: Thinking) {
  const timing = TIMING[thinking];
  return { ...timing, writeReserveMs: timing.writeMs + WRITE_MARGIN_MS };
}

/** Like clip, but ends on a whole sentence when one fits: a direction cut off mid-word reads as broken. */
export function clipSentences(text: string, max: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const end = clean.lastIndexOf(". ", max - 1);
  return end > max / 2 ? clean.slice(0, end + 1) : clip(clean, max);
}

/** Apply nudges the code can guarantee, and tidy what the model returned. */
export function normalizePlan(plan: PlanDraft, brief: Brief): Plan {
  const nineties = brief.nudges.includes("more_90s");
  return {
    ...plan,
    direction: clipSentences(plan.direction, 500),
    tone: plan.tone ? [...new Set(plan.tone)].slice(0, 5) : undefined,
    era_from: nineties ? 1990 : null,
    era_to: nineties ? 1999 : null,
    deep_cuts: brief.nudges.includes("deeper_cuts") ? "deep" : plan.deep_cuts,
    wardrobe_words: cleanWords(plan.wardrobe_words),
    ambience_words: cleanWords(plan.ambience_words),
    venue_kinds: [...new Set(plan.venue_kinds)].slice(0, 4),
  };
}

export async function runPipeline(
  brief: Brief,
  deps: PipelineDeps,
  emit: (event: AgentEvent) => void,
  options: { id: string; signal: AbortSignal; deadline?: number },
): Promise<PipelineOutcome> {
  const run = startRun(brief, deps, emit, options);

  // 1. Resolve the artist, touchstones and the director's films, and any artists standing in for an artist Qloo lacks.
  // A name that needs the director's call, or nothing left to read, ends the run here.
  const cast = await resolveCast(run);
  if (cast.kind !== "resolved") return cast;

  // The faces this audience knows need only the names: they're found beside the audience read and the plan.
  const pendingPeople = findPeople(run, cast);
  // Awaited before the write; this only keeps a failure meanwhile from going unhandled.
  pendingPeople.catch(() => {});

  // 2. Read the audience, where it meets the director's own taste, and where in the city it is. None depends on another.
  const audience = await readAudience(run, cast);

  // 3. Plan (LLM call 1).
  const planContext: PlanContext = {
    brief,
    ...cast.who,
    candidates: audience.candidates,
    leans: audience.leans,
    areas: audience.areas,
    directorFit: audience.directorFit.flat().map((e) => withYear(e.name, e.year)),
  };
  let plan = await askPlan(run, planContext, "plan");

  // 4. Execute the plan in code.
  let execution = await executePlan(run, plan, cast, audience.areas);

  // 5. One optional re-plan (LLM call 2 of 3) when a whole set of style words found no Qloo tags.
  const replanned = await replan(run, planContext, plan, execution);
  if (replanned) {
    plan = replanned;
    execution = await executePlan(run, plan, cast, audience.areas);
  }

  // 6. Write (the last LLM call).
  const people = await pendingPeople;
  const written = await writeDraft(run, cast, audience, plan, execution, people);

  const treatment = assemble({ run, cast, audience, plan, execution, people, ...written });
  if (run.warnings.size > 0) console.warn(JSON.stringify({ evt: "qloo_warnings", id: run.id, warnings: [...run.warnings].slice(0, 10) }));
  // What made it partial: the kind of each failure (rate_limit, timeout, upstream…), never Qloo's own text.
  if (run.failures.length > 0) console.warn(JSON.stringify({ evt: "qloo_failed", id: run.id, failed: run.failures.slice(0, 10) }));
  if (run.llmCalls > 3) throw new Error(`Pipeline made ${run.llmCalls} LLM calls; the budget is 3.`);
  return { kind: "treatment", treatment };
}

/**
 * A model call as a step of its own: while the model thinks, the step says so every TICK_MS; then the call's trace is
 * kept, a fallback to the template is noted, and what the model chose is credited.
 */
async function modelStep<T>(
  run: Run,
  step: LlmStep,
  label: string,
  call: () => Promise<LlmResult<T>>,
  summarize: (data: T) => string,
  credited?: (data: T) => Credit | undefined,
): Promise<T> {
  const { emit, notes, traces } = run;
  const end = run.begin(step, label);
  run.llmCalls += 1;
  const started = Date.now();
  const tick = setInterval(
    () =>
      emit({
        type: "step",
        id: step,
        status: "running",
        label,
        summary: `Thinking: ${Math.round((Date.now() - started) / 1000)} s so far.`,
      }),
    TICK_MS,
  );
  let result: LlmResult<T>;
  try {
    result = await call();
  } finally {
    clearInterval(tick);
  }
  const trace: LlmTrace = {
    step,
    producedBy: result.producedBy,
    degraded: result.degraded,
    attempts: result.attempts,
    calls: result.calls,
  };
  traces.push(trace);
  if (result.degraded) {
    const last = [...result.attempts].reverse().find((a) => a.provider !== "mock");
    notes.push(
      `Live models were unavailable for the ${step} step${last?.kind ? ` (${describeKind(last.kind)})` : ""}, so the labelled template wrote it.`,
    );
  }
  // No credit when every live model failed and the template answered: its plan is a stopgap, and its re-plan isn't used.
  end(result.degraded ? "warning" : "done", summarize(result.data), {
    llm: trace,
    credit: result.degraded ? undefined : credited?.(result.data),
  });
  return result.data;
}

/** The model's plan (on the re-plan, with new style words), with the nudges the code guarantees applied. */
function askPlan(run: Run, ctx: PlanContext, step: LlmStep): Promise<Plan> {
  const { brief, signal } = run;
  const { planMs, writeReserveMs } = timeLimits(brief.thinking);
  // The schema accepts only the refs the prompt lists.
  const toneRefs = ctx.candidates.map((c) => c.ref);
  const areas = ctx.areas ?? [];
  return modelStep(
    run,
    step,
    STEP_LABELS[step],
    () =>
      generateJson(
        {
          name: step,
          system: SYSTEM_PROMPT,
          prompt: planPrompt(ctx),
          schema: planSchema(
            toneRefs,
            areas.map((a) => a.ref),
          ),
          mock: () => mockPlan(ctx),
          effort: "low",
          // A re-plan only swaps style words that found no tags, so it needn't think hard.
          reasoning: step === "plan" ? REASONING[brief.thinking] : "low",
          maxOutputTokens: 2048,
          signal,
          deadline: run.deadline - writeReserveMs,
          minCallMs: 4_000,
          timeoutMs: planMs,
        },
        run.deps.llm,
      ),
    (plan) => {
      const base = areas.find((a) => a.ref === plan.base);
      return `${clip(plan.direction, 200)}${base ? ` Base: ${base.name}.` : ""}`;
    },
    (plan) =>
      toCredit(
        "base",
        areas.filter((a) => a.ref === plan.base),
      ),
  ).then((plan) => normalizePlan(plan, brief));
}

/**
 * A new plan for style words that found no Qloo tags, or nothing when the first plan stands. Not when the searches
 * failed (new words won't fix an outage), and not when the time left couldn't cover another plan, a second round of
 * Qloo calls and the write.
 */
async function replan(run: Run, planContext: PlanContext, plan: Plan, execution: Execution): Promise<Plan | undefined> {
  const { planMs, writeReserveMs } = timeLimits(run.brief.thinking);
  const deadWardrobe = execution.wardrobeTags.length === 0;
  const deadAmbience = execution.ambienceTags.length === 0;
  const skip = (summary: string) => void run.emit({ type: "step", id: "replan", status: "skipped", label: STEP_LABELS.replan, summary });
  if (!deadWardrobe && !deadAmbience) return skip("The first plan found tags for every style.");
  if (execution.tagSearchFailed) return skip("Qloo's tag search failed, so new words wouldn't help; continuing with what came back.");
  if (run.deadline - Date.now() < planMs + writeReserveMs)
    return skip("Not enough time left for another round; continuing with what came back.");
  const missed = [...(deadWardrobe ? plan.wardrobe_words : []), ...(deadAmbience ? plan.ambience_words : [])];
  const replanned = await askPlan(
    run,
    {
      ...planContext,
      feedback:
        `These words matched no Qloo tags: ${missed.map((w) => `"${w}"`).join(", ")}. ` +
        `Choose different, more common words for ${[deadWardrobe && "wardrobe", deadAmbience && "ambience"].filter(Boolean).join(" and ")}; keep the rest of the plan unless it should change.`,
    },
    "replan",
  );
  // A template re-plan (every live model failed) would replace a real plan with a generic one: keep the first.
  if (run.traces.at(-1)?.degraded) {
    run.notes.push("The re-plan fell back to the template, so the first plan was kept.");
    return undefined;
  }
  return replanned;
}

/**
 * The titles whose characters (TMDB's) the writer sees, and how many of each: the first films and series, top-billed
 * first. Every one is a choice the model weighs while it thinks, and its thinking is most of a write's time.
 */
const CHARACTER_TITLES = { films: 5, series: 1, each: 2 };

/** The writer's draft of the treatment, from the final plan and what it found. */
async function writeDraft(run: Run, cast: Cast, audience: Audience, plan: Plan, execution: Execution, people: People): Promise<Written> {
  const { brief, deps, signal } = run;
  const { candidates } = audience;
  const chosenTone = (plan.tone ?? []).map((ref) => candidates.find((c) => c.ref === ref)).filter((c): c is ToneCandidate => Boolean(c));
  const tone = chosenTone.length > 0 ? chosenTone : candidates.slice(0, 3);
  const toRefs = <T>(items: T[], prefix: string, max: number): Ref<T>[] =>
    items.slice(0, max).map((item, i) => ({ ref: `${prefix}${i + 1}`, item }));
  // The characters the story's people may be drawn from: TMDB's, for what has come back of the first titles' lookups. It
  // gets a moment more at most, since the lookups began as the titles landed.
  const titles = [
    ...execution.references.items.slice(0, CHARACTER_TITLES.films),
    ...execution.series.items.slice(0, CHARACTER_TITLES.series),
  ];
  const looked = await run.tmdb.settled(titles, 1_500);
  const characters = titles.flatMap((title) =>
    (looked.get(title.id)?.characters ?? [])
      .slice(0, CHARACTER_TITLES.each)
      .map((c): TitleCharacter => ({ title, name: c.name, actor: c.actor })),
  );
  const writeContext: WriteContext = {
    brief,
    ...cast.who,
    direction: plan.direction,
    tone,
    references: toRefs(execution.references.items, "R", WRITER_REFS.films),
    series: toRefs(execution.series.items, "S", WRITER_REFS.series),
    characters: toRefs(characters, "C", characters.length),
    casting: toRefs(people.casting.items, "P", WRITER_FACES),
    roles: new Map([...people.profiles].map(([id, profile]) => [id, profile.known])),
    music: brief.format === "short_film" ? toRefs(people.music.items, "M", 8) : [],
    brands: toRefs(execution.brands.items, "B", 6),
    places: toRefs(execution.places.items, "L", 6),
    leans: audience.leans,
    base: execution.base?.held ? execution.base.area : undefined,
    names: cast.entityNames,
  };
  const draft = await modelStep(
    run,
    "write",
    STEP_LABELS.write,
    () =>
      generateJson(
        {
          name: "treatment",
          system: SYSTEM_PROMPT,
          prompt: writePrompt(writeContext),
          schema: writeSchema(writeContext),
          mock: () => mockDraft(writeContext),
          effort: "medium",
          reasoning: REASONING[brief.thinking],
          maxOutputTokens: 8192,
          normalize: normalizeDraft,
          signal,
          deadline: run.deadline - 1_000,
          minCallMs: 8_000,
          timeoutMs: TIMING[brief.thinking].writeMs,
        },
        deps.llm,
      ),
    (d) => `"${clip(d.title, 60)}": ${clip(d.logline, 160)}`,
  );
  const scrub = refScrubber(
    new Map([
      ...candidates.map((c) => [c.ref, c.tag.name] as const),
      ...writeContext.characters.map((c) => [c.ref, c.item.name] as const),
      ...[
        ...writeContext.references,
        ...writeContext.series,
        ...writeContext.casting,
        ...writeContext.music,
        ...writeContext.brands,
        ...writeContext.places,
      ].map((r) => [r.ref, r.item.name] as const),
    ]),
  );
  // The references' stills (films and series) came from TMDB with their characters, while the run went on; after a fast
  // write any still out gets a moment more, then the board goes without it.
  const back = await run.tmdb.settled(
    [...writeContext.references, ...writeContext.series].map((r) => r.item),
    1_500,
  );
  run.tmdb.logTitles();
  const stills = new Map([...back].flatMap(([id, found]) => (found.still ? [[id, found.still] as const] : [])));
  return { draft, writeContext, scrub, stills };
}
