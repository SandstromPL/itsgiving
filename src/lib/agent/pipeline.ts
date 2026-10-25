import { describeKind, generateJson, type LlmDeps, type LlmResult } from "../llm";
import type { CompactEntity, CompactTag, Provenance, QlooClient } from "../qloo";
import { runTool } from "../tools/registry";
import { VENUE_KIND_VALUES, normalizeName } from "../tools/shared";
import type { ToolResult } from "../tools/types";
import { pickKey, priceLevelMax, type Brief } from "./brief";
import { STEP_LABELS } from "./options";
import {
  DEEP_CUT_CEILING,
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
import type { AgentEvent, Ambiguity, LlmStep, LlmTrace, Pick, QlooEvidence, Role, StepId, StepStatus, Treatment } from "./types";
import { mockDraft, writePrompt, writeSchema, type Draft, type Ref, type WriteContext } from "./write";

// The lean agent: code runs every Qloo tool deterministically and the LLM is
// called at most three times (plan, an optional re-plan, write). Resolve ->
// read audience (+ overlap with the director's films) -> plan -> find_tags,
// references, wardrobe, locations (relaxing empty results) -> write.

export interface PipelineDeps {
  qloo: QlooClient;
  llm: LlmDeps;
  now?: () => Date;
}

export type PipelineOutcome =
  | { kind: "treatment"; treatment: Treatment }
  | { kind: "needs_input"; message: string; items: Ambiguity[] }
  | { kind: "failed"; message: string };

type Resolution =
  | { input: string; status: "resolved"; match: CompactEntity; among?: number }
  | { input: string; status: "ambiguous"; candidates: CompactEntity[] }
  | { input: string; status: "not_found" };

interface NameSpec {
  /** Exactly what the director typed; pick keys and questions use it. */
  input: string;
  /** The title to search for, without a trailing "(2011)". */
  name: string;
  year?: number;
  type: "artist" | "movie";
  role: Role;
}

/** "Rockstar (2011)" -> name "Rockstar", year 2011, so same-name titles resolve without a question. */
export function parseTitle(input: string): { name: string; year?: number } {
  const match = /^(.*\S)\s*\((\d{4})\)$/.exec(input.trim());
  if (!match) return { name: input.trim() };
  const year = Number(match[2]);
  return year >= 1870 && year <= 2100 ? { name: match[1], year } : { name: input.trim() };
}

interface Relaxed {
  items: CompactEntity[];
  relaxations: string[];
  error?: string;
}

interface Execution {
  wardrobeTags: CompactTag[];
  ambienceTags: CompactTag[];
  missedWords: { wardrobe: string[]; ambience: string[] };
  /** A tag search failed (rather than finding nothing), so a re-plan wouldn't help. */
  tagSearchFailed: boolean;
  references: Relaxed;
  brands: Relaxed;
  places: Relaxed;
}

const MAX_TONE_CANDIDATES = 16;
/** Time held back for the write step while planning: DeepSeek writes take 12-23 s, plus room for one fallback. */
const WRITE_RESERVE_MS = 30_000;
/** Per-call limits: a plan is a short reply; a DeepSeek write can take over 20 s before it is slow. */
const PLAN_TIMEOUT_MS = 15_000;
const WRITE_TIMEOUT_MS = 35_000;
/** A re-plan means another LLM call, a second round of Qloo calls and the write: skip it when less time is left. */
const REPLAN_MIN_MS = 30_000;

function clip(text: string, max: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean;
}

function uniqueBy<T>(items: T[], key: (item: T) => string): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const k = key(item);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function names(entities: CompactEntity[]): string[] {
  return entities.map((e) => `${e.name}${e.year ? ` (${e.year})` : ""}`);
}

/** Tags never used to steer a treatment, whatever the semantic search ranks them (live "intimate" also returns these). */
const UNSAFE_TAG = /adult|erotic|sex|strip|nsfw/i;

/**
 * Semantic tag search drifts ("intimate" -> "Adult only"), so prefer the tags
 * whose name contains the word (or vice versa), and fall back to the top hit.
 */
export function closestTags(word: string, tags: CompactTag[], max = 2): CompactTag[] {
  const safe = tags.filter((t) => t.id.startsWith("urn:tag:") && !UNSAFE_TAG.test(`${t.id} ${t.name}`));
  const wanted = normalizeName(word);
  const close = safe.filter((t) => {
    const name = normalizeName(t.name);
    return name.length > 0 && (name.includes(wanted) || wanted.includes(name));
  });
  return (close.length > 0 ? close : safe).slice(0, max);
}

/** Apply nudges the code can guarantee, and tidy what the model returned. */
export function normalizePlan(plan: PlanDraft, brief: Brief): Plan {
  const nineties = brief.nudges.includes("more_90s");
  return {
    ...plan,
    direction: clip(plan.direction, 400),
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
  const { signal } = options;
  const runDeadline = options.deadline ?? Number.POSITIVE_INFINITY;
  const trail: Partial<Record<StepId, Provenance[]>> = {};
  const notes: string[] = [];
  const traces: LlmTrace[] = [];
  /** Steps where a Qloo call failed: the treatment is then partial and must not be cached. */
  const failed = new Set<StepId>();
  const warnings = new Set<string>();
  let llmCalls = 0;

  const tool = async <T>(step: StepId, name: string, input: unknown): Promise<ToolResult<T>> => {
    signal.throwIfAborted();
    const result = (await runTool(name, input, { qloo: deps.qloo, signal })) as ToolResult<T>;
    // A request cut off by the run's deadline surfaces here as the abort, not as a tool error.
    signal.throwIfAborted();
    (trail[step] ??= []).push(...result.provenance);
    if (result.status === "error") failed.add(step);
    for (const warning of result.warnings) warnings.add(warning);
    return result;
  };

  const begin = (id: StepId, label: string) => {
    emit({ type: "step", id, status: "running", label });
    const started = Date.now();
    return (status: StepStatus, summary: string, llm?: LlmTrace) =>
      emit({ type: "step", id, status, label, summary, ms: Date.now() - started, qloo: trail[id], llm });
  };

  const llm = async <T>(step: LlmStep, label: string, call: () => Promise<LlmResult<T>>, summarize: (data: T) => string): Promise<T> => {
    const end = begin(step, label);
    llmCalls += 1;
    const result = await call();
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
    end(result.degraded ? "warning" : "done", summarize(result.data), trace);
    return result.data;
  };

  // 1. Resolve the artist, touchstones and the director's films.
  const film = (input: string, role: Role): NameSpec => ({ input, ...parseTitle(input), type: "movie", role });
  const subjectSpecs: NameSpec[] = [
    ...(brief.artist ? [{ input: brief.artist, name: brief.artist, type: "artist" as const, role: "artist" as const }] : []),
    ...brief.touchstones.map((input) => film(input, "touchstone")),
  ];
  const directorSpecs: NameSpec[] = brief.director_films.map((input) => film(input, "director"));
  const endResolve = begin("resolve", STEP_LABELS.resolve);
  const asItems = (specs: NameSpec[]) => ({ items: specs.map(({ name, year, type }) => ({ name, type, ...(year ? { year } : {}) })) });
  const [subjectResult, directorResult] = await Promise.all([
    tool<{ items: Resolution[] }>("resolve", "resolve_entities", asItems(subjectSpecs)),
    directorSpecs.length > 0 ? tool<{ items: Resolution[] }>("resolve", "resolve_entities", asItems(directorSpecs)) : null,
  ]);
  if (subjectResult.status === "error" || !subjectResult.data) {
    endResolve("error", subjectResult.summary);
    return { kind: "failed", message: `Couldn't look up the brief in Qloo: ${subjectResult.error?.message ?? subjectResult.summary}` };
  }
  if (directorResult?.status === "error") notes.push(`Your taste films couldn't be looked up (${directorResult.summary}), so they were left out.`);

  const ambiguities: Ambiguity[] = [];
  const missing: string[] = [];
  const settle = (spec: NameSpec, resolution: Resolution | undefined): CompactEntity | undefined => {
    const key = pickKey(spec.type, spec.input);
    if (resolution?.status === "resolved") {
      if (resolution.among) {
        const m = resolution.match;
        notes.push(`"${spec.input}" matched ${resolution.among} titles in Qloo; Mise used the far better-known ${m.name}${m.year ? ` (${m.year})` : ""}.`);
      }
      return resolution.match;
    }
    if (resolution?.status === "ambiguous") {
      // A pick only counts if it is one of the candidates Qloo returned.
      const chosen = resolution.candidates.find((c) => c.id === brief.picks[key]);
      if (chosen) return chosen;
      ambiguities.push({ key, input: spec.input, role: spec.role, status: "ambiguous", candidates: resolution.candidates });
      return undefined;
    }
    missing.push(spec.input);
    return undefined;
  };
  const subjects = uniqueBy(
    subjectSpecs.map((spec, i) => settle(spec, subjectResult.data?.items[i])).filter((e): e is CompactEntity => Boolean(e)),
    (e) => e.id,
  );
  const director = uniqueBy(
    directorSpecs
      .map((spec, i) => (directorResult?.data ? settle(spec, directorResult.data.items[i]) : undefined))
      .filter((e): e is CompactEntity => Boolean(e)),
    (e) => e.id,
  );

  if (ambiguities.length > 0) {
    // The same title can sit in two lists (touchstones and your taste); one question answers both.
    const questions = uniqueBy(ambiguities, (a) => a.key);
    endResolve("warning", `Need your call on ${questions.map((a) => `"${a.input}"`).join(", ")}.`);
    return { kind: "needs_input", message: "Some names match more than one title in Qloo, so Mise won't guess.", items: questions };
  }
  if (subjects.length === 0) {
    endResolve("error", `Not found: ${missing.join(", ")}.`);
    return {
      kind: "failed",
      message: `Qloo couldn't find ${missing.map((m) => `"${m}"`).join(", ")}. Check the spelling or try another artist or film.`,
    };
  }
  if (missing.length > 0) notes.push(`Not in Qloo's catalog, so left out: ${missing.join(", ")}.`);
  endResolve(
    missing.length > 0 ? "warning" : "done",
    `${names(subjects).join(", ")}${director.length > 0 ? `; your taste: ${director.length} film${director.length === 1 ? "" : "s"}` : ""}.`,
  );

  const subjectIds = subjects.map((e) => e.id);
  const directorIds = director.map((e) => e.id);
  const entityNames = new Map([...subjects, ...director].map((e) => [e.id, e.name]));

  // 2. Read the audience, and where it meets the director's own taste.
  const endAudience = begin("audience", STEP_LABELS.audience);
  const audience = await tool<{ taste_tags: CompactTag[]; demographics: { entity_id: string; leans: string }[] }>(
    "audience",
    "read_audience",
    { entity_ids: subjectIds, take: 15 },
  );
  const tasteTags = audience.data?.taste_tags ?? [];
  const leans = (audience.data?.demographics ?? []).map((d) =>
    subjects.length > 1 ? `${entityNames.get(d.entity_id) ?? "audience"}: ${d.leans}` : d.leans,
  );
  if (audience.status === "error") notes.push(`The audience read failed (${audience.summary}).`);
  for (const warning of audience.warnings) notes.push(warning);
  endAudience(audience.status === "ok" ? "done" : "warning", audience.summary);

  let overlap: CompactTag[] = [];
  if (director.length > 0) {
    const endOverlap = begin("overlap", STEP_LABELS.overlap);
    const result = await tool<{ shared_traits: CompactTag[] }>("overlap", "taste_overlap", {
      group_a_ids: directorIds,
      group_b_ids: subjectIds,
      take: 10,
    });
    overlap = result.data?.shared_traits ?? [];
    endOverlap(result.status === "ok" ? "done" : "warning", result.summary);
  } else {
    emit({ type: "step", id: "overlap", status: "skipped", label: STEP_LABELS.overlap, summary: "Add your own favourite films to find the overlap." });
  }

  const candidates: ToneCandidate[] = uniqueBy(
    [
      ...overlap.slice(0, 6).map((tag) => ({ tag, source: "overlap" as const })),
      ...tasteTags.map((tag) => ({ tag, source: "audience" as const })),
    ].filter((c) => c.tag.id.startsWith("urn:tag:")),
    (c) => normalizeName(c.tag.name),
  )
    .slice(0, MAX_TONE_CANDIDATES)
    .map((c, i) => ({ ...c, ref: `T${i + 1}` }));
  const toneRefs = candidates.map((c) => c.ref);

  // 3. Plan (LLM call 1).
  const who = {
    artistNames: names(subjects.filter((e) => e.kind === "artist")),
    touchstoneNames: names(subjects.filter((e) => e.kind !== "artist")),
    directorNames: names(director),
  };
  const planContext: PlanContext = {
    brief,
    ...who,
    candidates,
    leans,
  };
  const askPlan = (ctx: PlanContext, step: LlmStep) =>
    llm(
      step,
      STEP_LABELS[step],
      () =>
        generateJson(
          {
            name: step,
            system: SYSTEM_PROMPT,
            prompt: planPrompt(ctx),
            schema: planSchema(toneRefs),
            mock: () => mockPlan(ctx),
            effort: "low",
            maxOutputTokens: 2048,
            signal,
            deadline: runDeadline - WRITE_RESERVE_MS,
            minCallMs: 4_000,
            timeoutMs: PLAN_TIMEOUT_MS,
          },
          deps.llm,
        ),
      (plan) => clip(plan.direction, 200),
    ).then((plan) => normalizePlan(plan, brief));
  let plan = await askPlan(planContext, "plan");

  // 4. Execute the plan in code.
  const findTags = async (
    words: string[],
    filter: object,
  ): Promise<{ tags: CompactTag[]; missed: string[]; errored: boolean }> => {
    const results = await Promise.all(
      words.map((query) => tool<{ tags: CompactTag[] }>("tags", "find_tags", { query, ...filter, take: 5 })),
    );
    const picked = words.map((word, i) => closestTags(word, results[i].data?.tags ?? []));
    // Only a search that worked and found nothing counts as a miss; a failed request says nothing about the word.
    const missed = words.filter((_, i) => results[i].status !== "error" && picked[i].length === 0);
    return { tags: uniqueBy(picked.flat(), (t) => t.id).slice(0, 4), missed, errored: results.some((r) => r.status === "error") };
  };

  const relax = async (
    step: StepId,
    toolName: string,
    key: string,
    ladder: [string, Record<string, unknown>][],
  ): Promise<Relaxed> => {
    const relaxations: string[] = [];
    let lastError: string | undefined;
    for (let i = 0; i < ladder.length; i++) {
      const result = await tool<Record<string, CompactEntity[]>>(step, toolName, ladder[i][1]);
      const items = result.data?.[key] ?? [];
      if (result.status !== "error" && items.length > 0) return { items, relaxations };
      // A failed call is treated like an empty one: the next rung is usually lighter (no tag signals), which is
      // exactly what helps when Qloo is slow on a heavy query.
      if (result.status === "error") lastError = result.error?.message ?? result.summary;
      if (i + 1 < ladder.length) relaxations.push(ladder[i + 1][0]);
    }
    return lastError ? { items: [], relaxations, error: lastError } : { items: [], relaxations };
  };

  /** Each rung keeps the previous rung's changes; rungs that change nothing are skipped. */
  const ladder = (base: Record<string, unknown>, rungs: [string, Record<string, unknown>, boolean][]) => {
    const steps: [string, Record<string, unknown>][] = [["", base]];
    for (const [label, patch, applies] of rungs) {
      if (applies) steps.push([label, { ...steps[steps.length - 1][1], ...patch }]);
    }
    return steps;
  };

  const report = (step: StepId, label: string, what: string, relaxed: Relaxed, describe: (items: CompactEntity[]) => string) => {
    if (relaxed.error) {
      notes.push(`${label}: ${relaxed.error}`);
      emit({ type: "step", id: step, status: "error", label, summary: relaxed.error, qloo: trail[step] });
      return;
    }
    if (relaxed.relaxations.length > 0) {
      notes.push(`${what}: nothing matched at first, so Mise ${relaxed.relaxations.join(", then ")}.`);
    }
    const status: StepStatus = relaxed.items.length === 0 || relaxed.relaxations.length > 0 ? "warning" : "done";
    const summary =
      relaxed.items.length === 0
        ? `No ${what.toLowerCase()} matched, even after relaxing.`
        : `${describe(relaxed.items)}${relaxed.relaxations.length > 0 ? ` (relaxed: ${relaxed.relaxations.join(", ")})` : ""}`;
    emit({ type: "step", id: step, status, label, summary, qloo: trail[step] });
  };

  const execute = async (current: Plan): Promise<Execution> => {
    const endTags = begin("tags", STEP_LABELS.tags);
    const [wardrobe, ambience] = await Promise.all([
      // Brand genre tags are hierarchical (urn:tag:genre:brand:fashion:...), so filter by what they apply to, not by type.
      findTags(current.wardrobe_words, { applies_to: "brand" }),
      findTags(current.ambience_words, { applies_to: "place", tag_types: ["ambience", "decor", "setting"] }),
    ]);
    // Two families can share a name (adjective:vintage, aesthetic_property:vintage); show each name once.
    const found = uniqueBy([...wardrobe.tags, ...ambience.tags], (t) => normalizeName(t.name)).map((t) => t.name);
    endTags(
      wardrobe.tags.length > 0 && ambience.tags.length > 0 ? "done" : "warning",
      found.length > 0
        ? `${found.join(", ")}${[...wardrobe.missed, ...ambience.missed].length > 0 ? `; no tags for ${[...wardrobe.missed, ...ambience.missed].map((w) => `"${w}"`).join(", ")}` : ""}.`
        : "None of the style words matched a Qloo tag.",
    );

    const ceiling = DEEP_CUT_CEILING[current.deep_cuts];
    const hasEra = current.era_from !== null || current.era_to !== null;
    const price = priceLevelMax(brief);

    for (const [id, label] of [
      ["references", STEP_LABELS.references],
      ["wardrobe", STEP_LABELS.wardrobe],
      ["locations", STEP_LABELS.locations],
    ] as const) {
      emit({ type: "step", id, status: "running", label });
    }

    const [references, brands, places] = await Promise.all([
      relax(
        "references",
        "reference_films",
        "references",
        ladder(
          // Entity signal only: on the live host, tone tags as signal.interests.tags made this query run
          // 22-60 s and end in a Qloo 504. The tone tags still shape the writing.
          {
            signal_entity_ids: subjectIds,
            kind: "movie",
            from_year: current.era_from ?? undefined,
            to_year: current.era_to ?? undefined,
            max_popularity: ceiling,
            exclude_ids: [...subjectIds, ...directorIds].slice(0, 50),
            take: 10,
          },
          [
            ["dropped the era", { from_year: undefined, to_year: undefined }, hasEra],
            ["lifted the deep-cut ceiling", { max_popularity: undefined }, ceiling !== undefined],
          ],
        ),
      ),
      relax(
        "wardrobe",
        "styling_brands",
        "brands",
        ladder(
          {
            signal_entity_ids: subjectIds,
            style_tag_ids: wardrobe.tags.length > 0 ? wardrobe.tags.map((t) => t.id) : undefined,
            take: 8,
          },
          [["dropped the style tags", { style_tag_ids: undefined }, wardrobe.tags.length > 0]],
        ),
      ),
      relax(
        "locations",
        "scout_locations",
        "locations",
        ladder(
          {
            city: brief.city,
            signal_entity_ids: subjectIds,
            venue_kinds: current.venue_kinds,
            ambience_tag_ids: ambience.tags.length > 0 ? ambience.tags.map((t) => t.id) : undefined,
            require_photo: true,
            price_level_max: price,
            take: 8,
          },
          // Creative choices give way before the director's constraints: venue kinds, then photos, then budget.
          [
            ["widened to every kind of venue", { venue_kinds: VENUE_KIND_VALUES }, current.venue_kinds.length < VENUE_KIND_VALUES.length],
            ["allowed places without photos", { require_photo: false }, true],
            ["lifted the price ceiling", { price_level_max: undefined }, price !== undefined],
          ],
        ),
      ),
    ]);

    report("references", STEP_LABELS.references, "Reference films", references, (items) => names(items).slice(0, 4).join(", "));
    report("wardrobe", STEP_LABELS.wardrobe, "Wardrobe brands", brands, (items) => names(items).slice(0, 5).join(", "));
    report("locations", STEP_LABELS.locations, "Locations", places, (items) => `${items.slice(0, 4).map((p) => p.name).join(", ")} in ${brief.city}`);

    return {
      wardrobeTags: wardrobe.tags,
      ambienceTags: ambience.tags,
      missedWords: { wardrobe: wardrobe.missed, ambience: ambience.missed },
      tagSearchFailed: wardrobe.errored || ambience.errored,
      references,
      brands,
      places,
    };
  };

  let run = await execute(plan);

  // 5. One optional re-plan (LLM call 2 of 3) when a whole set of style words found no Qloo tags.
  // Not when the searches failed (new words won't fix an outage), and not when the time left
  // couldn't cover another plan, a second round of Qloo calls and the write.
  const deadWardrobe = run.wardrobeTags.length === 0;
  const deadAmbience = run.ambienceTags.length === 0;
  const skipReplan = (summary: string) => emit({ type: "step", id: "replan", status: "skipped", label: STEP_LABELS.replan, summary });
  if (!deadWardrobe && !deadAmbience) {
    skipReplan("The first plan found tags for every style.");
  } else if (run.tagSearchFailed) {
    skipReplan("Qloo's tag search failed, so new words wouldn't help; continuing with what came back.");
  } else if (runDeadline - Date.now() < REPLAN_MIN_MS) {
    skipReplan("Not enough time left for another round; continuing with what came back.");
  } else {
    const missed = [...(deadWardrobe ? plan.wardrobe_words : []), ...(deadAmbience ? plan.ambience_words : [])];
    const replanned = await askPlan(
      {
        ...planContext,
        feedback:
          `These words matched no Qloo tags: ${missed.map((w) => `"${w}"`).join(", ")}. ` +
          `Choose different, more common words for ${[deadWardrobe && "wardrobe", deadAmbience && "ambience"].filter(Boolean).join(" and ")}; keep the rest of the plan unless it should change.`,
      },
      "replan",
    );
    // A template re-plan (every live model failed) would replace a real plan with a generic one: keep the first.
    if (traces.at(-1)?.degraded) {
      notes.push("The re-plan fell back to the template, so the first plan was kept.");
    } else {
      plan = replanned;
      run = await execute(plan);
    }
  }

  // 6. Write (the last LLM call).
  const chosenTone = (plan.tone ?? []).map((ref) => candidates.find((c) => c.ref === ref)).filter((c): c is ToneCandidate => Boolean(c));
  const tone = chosenTone.length > 0 ? chosenTone : candidates.slice(0, 3);
  const toRefs = (items: CompactEntity[], prefix: string, max: number): Ref<CompactEntity>[] =>
    items.slice(0, max).map((item, i) => ({ ref: `${prefix}${i + 1}`, item }));
  const writeContext: WriteContext = {
    brief,
    ...who,
    direction: plan.direction,
    tone,
    references: toRefs(run.references.items, "R", 8),
    brands: toRefs(run.brands.items, "B", 6),
    places: toRefs(run.places.items, "L", 6),
    leans,
    names: entityNames,
  };
  const draft = await llm(
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
          maxOutputTokens: 8192,
          signal,
          deadline: runDeadline - 1_000,
          minCallMs: 8_000,
          timeoutMs: WRITE_TIMEOUT_MS,
        },
        deps.llm,
      ),
    (d) => `"${clip(d.title, 60)}": ${clip(d.logline, 160)}`,
  );

  const treatment = assemble({
    id: options.id,
    brief,
    draft,
    writeContext,
    run,
    plan,
    subjects,
    director,
    tasteTags,
    overlap,
    leans,
    notes,
    traces,
    trail,
    deps,
    complete: failed.size === 0,
  });
  if (warnings.size > 0) console.warn(JSON.stringify({ evt: "qloo_warnings", id: options.id, warnings: [...warnings].slice(0, 10) }));
  if (llmCalls > 3) throw new Error(`Pipeline made ${llmCalls} LLM calls; the budget is 3.`);
  return { kind: "treatment", treatment };
}

interface AssembleInput {
  id: string;
  brief: Brief;
  draft: Draft;
  writeContext: WriteContext;
  run: Execution;
  plan: Plan;
  subjects: CompactEntity[];
  director: CompactEntity[];
  tasteTags: CompactTag[];
  overlap: CompactTag[];
  leans: string[];
  notes: string[];
  traces: LlmTrace[];
  trail: Partial<Record<StepId, Provenance[]>>;
  deps: PipelineDeps;
  complete: boolean;
}

/** Map the draft's refs back to Qloo items and attach each item's evidence. */
function assemble(input: AssembleInput): Treatment {
  const { draft, writeContext: ctx, run } = input;
  const evidence = (list: CompactEntity[], tool: string, entity: CompactEntity): QlooEvidence => ({
    tool,
    rank: list.indexOf(entity) + 1,
    of: list.length,
    affinity: entity.affinity,
    popularity: entity.popularity,
    tags: entity.tags,
    because: (entity.because ?? [])
      .map((b) => ({ name: ctx.names.get(b.entity_id) ?? "", score: b.score }))
      .filter((b) => b.name),
  });
  const cite = <K extends string>(
    refs: Ref<CompactEntity>[],
    list: CompactEntity[],
    tool: string,
    picks: ({ ref: string } & Record<K, string>)[] | undefined,
    keys: K[],
    max: number,
  ): Pick<K>[] =>
    uniqueBy(picks ?? [], (p) => p.ref).slice(0, max).flatMap((pick) => {
      const entity = refs.find((r) => r.ref === pick.ref)?.item;
      if (!entity) return [];
      const notes = Object.fromEntries(keys.map((k) => [k, clip(pick[k], 400)])) as Record<K, string>;
      return [{ entity, qloo: evidence(list, tool, entity), notes }];
    });

  // The schema only enforces minimums; the maximums the prompt asked for are applied here.
  const references = cite(ctx.references, run.references.items, "reference_films", draft.references, ["why", "borrow"], 6);
  const wardrobe = cite(ctx.brands, run.brands.items, "styling_brands", draft.wardrobe, ["look"], 4);
  const locations = cite(ctx.places, run.places.items, "scout_locations", draft.locations, ["scene"], 4);
  const cited = new Set([...references, ...wardrobe, ...locations].map((p) => p.entity.id));
  const uncited = (items: CompactEntity[]) => items.filter((e) => !cited.has(e.id));

  const writtenBy = input.traces.find((t) => t.step === "write")?.producedBy ?? { provider: "mock", model: "mise-template", mock: true };
  const calls = Object.values(input.trail).reduce((sum, list) => sum + (list?.length ?? 0), 0);

  return {
    id: input.id,
    createdAt: (input.deps.now?.() ?? new Date()).toISOString(),
    brief: input.brief,
    title: clip(draft.title, 80),
    logline: clip(draft.logline, 300),
    concept: clip(draft.concept, 1500),
    direction: input.plan.direction,
    tone: uniqueBy(draft.tone ?? [], (t) => t.ref).slice(0, 5).flatMap((t) => {
      const candidate = ctx.tone.find((c) => c.ref === t.ref);
      return candidate ? [{ tag: candidate.tag, source: candidate.source, note: clip(t.note, 300) }] : [];
    }),
    beats: draft.beats.slice(0, 6).map((beat) => {
      const ref = beat.reference ? ctx.references.find((r) => r.ref === beat.reference)?.item : undefined;
      return {
        title: clip(beat.title, 60),
        description: clip(beat.description, 500),
        reference: ref ? { id: ref.id, name: ref.name } : null,
      };
    }),
    references,
    wardrobe,
    locations,
    palette: uniqueBy(
      draft.palette.map((c) => ({ name: clip(c.name, 30), hex: c.hex.toUpperCase() })),
      (c) => c.hex,
    ).slice(0, 6),
    lighting: draft.lighting.slice(0, 4).map((l) => clip(l, 300)),
    shots: draft.shots.slice(0, 6).map((s) => clip(s, 300)),
    extras: {
      references: uncited(run.references.items),
      brands: uncited(run.brands.items),
      locations: uncited(run.places.items),
    },
    audience: { taste_tags: input.tasteTags, overlap: input.overlap, leans: input.leans },
    subjects: input.subjects,
    director: input.director,
    notes: input.notes,
    llm: input.traces,
    writtenBy,
    qloo: { mode: input.deps.qloo.mode, calls, steps: input.trail },
    mock: { qloo: input.deps.qloo.mode === "mock", llm: input.traces.some((t) => t.producedBy.mock) },
    complete: input.complete,
    priceLevelMax: priceLevelMax(input.brief),
  };
}
