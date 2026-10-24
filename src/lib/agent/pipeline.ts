import { generateJson, type LlmDeps, type LlmResult } from "../llm";
import type { CompactEntity, CompactTag, Provenance, QlooClient } from "../qloo";
import { runTool } from "../tools/registry";
import type { ToolResult } from "../tools/types";
import { pickKey, priceLevelMax, type Brief } from "./brief";
import {
  DEEP_CUT_CEILING,
  SYSTEM_PROMPT,
  cleanWords,
  mockPlan,
  planPrompt,
  planSchema,
  type Plan,
  type PlanContext,
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
  | { input: string; status: "resolved"; match: CompactEntity }
  | { input: string; status: "ambiguous"; candidates: CompactEntity[] }
  | { input: string; status: "not_found" };

interface NameSpec {
  name: string;
  type: "artist" | "movie";
  role: Role;
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
  references: Relaxed;
  brands: Relaxed;
  places: Relaxed;
}

const MAX_TONE_CANDIDATES = 16;

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

/** Apply nudges the code can guarantee, and tidy what the model returned. */
export function normalizePlan(plan: Plan, brief: Brief): Plan {
  let { era_from: from, era_to: to } = plan;
  if (brief.nudges.includes("more_90s")) [from, to] = [1990, 1999];
  if (from !== null && to !== null && from > to) [from, to] = [to, from];
  return {
    ...plan,
    direction: clip(plan.direction, 400),
    tone: plan.tone ? [...new Set(plan.tone)] : undefined,
    era_from: from,
    era_to: to,
    deep_cuts: brief.nudges.includes("deeper_cuts") ? "deep" : plan.deep_cuts,
    wardrobe_words: cleanWords(plan.wardrobe_words),
    ambience_words: cleanWords(plan.ambience_words),
  };
}

export async function runPipeline(
  brief: Brief,
  deps: PipelineDeps,
  emit: (event: AgentEvent) => void,
  options: { id: string; signal: AbortSignal },
): Promise<PipelineOutcome> {
  const { signal } = options;
  const trail: Partial<Record<StepId, Provenance[]>> = {};
  const notes: string[] = [];
  const traces: LlmTrace[] = [];
  let llmCalls = 0;

  const tool = async <T>(step: StepId, name: string, input: unknown): Promise<ToolResult<T>> => {
    signal.throwIfAborted();
    const result = (await runTool(name, input, { qloo: deps.qloo })) as ToolResult<T>;
    (trail[step] ??= []).push(...result.provenance);
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
        `Live models were unavailable for the ${step} step${last?.kind ? ` (${last.kind.replace("_", " ")})` : ""}, so the labelled template wrote it.`,
      );
    }
    end(result.degraded ? "warning" : "done", summarize(result.data), trace);
    return result.data;
  };

  // 1. Resolve the artist, touchstones and the director's films.
  const subjectSpecs: NameSpec[] = [
    ...(brief.artist ? [{ name: brief.artist, type: "artist" as const, role: "artist" as const }] : []),
    ...brief.touchstones.map((name) => ({ name, type: "movie" as const, role: "touchstone" as const })),
  ];
  const directorSpecs: NameSpec[] = brief.director_films.map((name) => ({ name, type: "movie", role: "director" }));
  const endResolve = begin("resolve", "Resolve names in Qloo");
  const asItems = (specs: NameSpec[]) => ({ items: specs.map(({ name, type }) => ({ name, type })) });
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
    const key = pickKey(spec.type, spec.name);
    if (resolution?.status === "resolved") return resolution.match;
    if (resolution?.status === "ambiguous") {
      // A pick only counts if it is one of the candidates Qloo returned.
      const chosen = resolution.candidates.find((c) => c.id === brief.picks[key]);
      if (chosen) return chosen;
      ambiguities.push({ key, input: spec.name, role: spec.role, status: "ambiguous", candidates: resolution.candidates });
      return undefined;
    }
    missing.push(spec.name);
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
    endResolve("warning", `Need your call on ${ambiguities.map((a) => `"${a.input}"`).join(", ")}.`);
    return { kind: "needs_input", message: "Some names match more than one title in Qloo, so Mise won't guess.", items: ambiguities };
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
  const endAudience = begin("audience", "Read the audience");
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
  endAudience(audience.status === "ok" ? "done" : "warning", audience.summary);

  let overlap: CompactTag[] = [];
  if (director.length > 0) {
    const endOverlap = begin("overlap", "Compare with your taste");
    const result = await tool<{ shared_traits: CompactTag[] }>("overlap", "taste_overlap", {
      group_a_ids: directorIds,
      group_b_ids: subjectIds,
      take: 10,
    });
    overlap = result.data?.shared_traits ?? [];
    endOverlap(result.status === "ok" ? "done" : "warning", result.summary);
  } else {
    emit({ type: "step", id: "overlap", status: "skipped", label: "Compare with your taste", summary: "Add your own favourite films to find the overlap." });
  }

  const candidates: ToneCandidate[] = uniqueBy(
    [
      ...overlap.slice(0, 6).map((tag) => ({ tag, source: "overlap" as const })),
      ...tasteTags.map((tag) => ({ tag, source: "audience" as const })),
    ].filter((c) => c.tag.id.startsWith("urn:tag:")),
    (c) => c.tag.id,
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
      step === "plan" ? "Plan the creative direction" : "Re-plan the style words",
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
          },
          deps.llm,
        ),
      (plan) => clip(plan.direction, 200),
    ).then((plan) => normalizePlan(plan, brief));
  let plan = await askPlan(planContext, "plan");

  // 4. Execute the plan in code.
  const findTags = async (words: string[], filter: object): Promise<{ tags: CompactTag[]; missed: string[] }> => {
    const results = await Promise.all(
      words.map((query) => tool<{ tags: CompactTag[] }>("tags", "find_tags", { query, ...filter, take: 3 })),
    );
    const missed = words.filter((_, i) => (results[i].data?.tags.length ?? 0) === 0);
    const tags = uniqueBy(
      results.flatMap((r) => (r.data?.tags ?? []).slice(0, 2)).filter((t) => t.id.startsWith("urn:tag:")),
      (t) => t.id,
    ).slice(0, 4);
    return { tags, missed };
  };

  const relax = async (
    step: StepId,
    toolName: string,
    key: string,
    ladder: [string, Record<string, unknown>][],
  ): Promise<Relaxed> => {
    const relaxations: string[] = [];
    for (let i = 0; i < ladder.length; i++) {
      const result = await tool<Record<string, CompactEntity[]>>(step, toolName, ladder[i][1]);
      if (result.status === "error") return { items: [], relaxations, error: result.error?.message ?? result.summary };
      const items = result.data?.[key] ?? [];
      if (items.length > 0) return { items, relaxations };
      if (i + 1 < ladder.length) relaxations.push(ladder[i + 1][0]);
    }
    return { items: [], relaxations };
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
    const endTags = begin("tags", "Translate style words into Qloo tags");
    const [wardrobe, ambience] = await Promise.all([
      // Brand genre tags are hierarchical (urn:tag:genre:brand:fashion:...), so filter by what they apply to, not by type.
      findTags(current.wardrobe_words, { applies_to: "brand" }),
      findTags(current.ambience_words, { applies_to: "place", tag_types: ["ambience", "decor", "setting"] }),
    ]);
    const found = [...wardrobe.tags, ...ambience.tags].map((t) => t.name);
    endTags(
      wardrobe.tags.length > 0 && ambience.tags.length > 0 ? "done" : "warning",
      found.length > 0
        ? `${found.join(", ")}${[...wardrobe.missed, ...ambience.missed].length > 0 ? `; no tags for ${[...wardrobe.missed, ...ambience.missed].map((w) => `"${w}"`).join(", ")}` : ""}.`
        : "None of the style words matched a Qloo tag.",
    );

    const toneTagIds = (current.tone ?? [])
      .map((ref) => candidates.find((c) => c.ref === ref)?.tag.id)
      .filter((id): id is string => Boolean(id))
      .slice(0, 5);
    const ceiling = DEEP_CUT_CEILING[current.deep_cuts];
    const hasEra = current.era_from !== null || current.era_to !== null;
    const price = priceLevelMax(brief);

    for (const [id, label] of [
      ["references", "Pull reference films"],
      ["wardrobe", "Pick wardrobe brands"],
      ["locations", "Scout locations"],
    ] as const) {
      emit({ type: "step", id, status: "running", label });
    }

    const [references, brands, places] = await Promise.all([
      relax(
        "references",
        "reference_films",
        "references",
        ladder(
          {
            signal_entity_ids: subjectIds,
            signal_tag_ids: toneTagIds.length > 0 ? toneTagIds : undefined,
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
            ["dropped the tone tags", { signal_tag_ids: undefined }, toneTagIds.length > 0],
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
            tag_mode: "bias",
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
            ambience_tag_ids: ambience.tags.length > 0 ? ambience.tags.map((t) => t.id) : undefined,
            tag_mode: "require",
            require_photo: true,
            price_level_max: price,
            take: 8,
          },
          [
            ["let the ambience tags rank instead of filter", { tag_mode: "bias" }, ambience.tags.length > 0],
            ["allowed places without photos", { require_photo: false }, true],
            ["lifted the price ceiling", { price_level_max: undefined }, price !== undefined],
          ],
        ),
      ),
    ]);

    report("references", "Pull reference films", "Reference films", references, (items) => names(items).slice(0, 4).join(", "));
    report("wardrobe", "Pick wardrobe brands", "Wardrobe brands", brands, (items) => names(items).slice(0, 5).join(", "));
    report("locations", "Scout locations", "Locations", places, (items) => `${items.slice(0, 4).map((p) => p.name).join(", ")} in ${brief.city}`);

    return {
      wardrobeTags: wardrobe.tags,
      ambienceTags: ambience.tags,
      missedWords: { wardrobe: wardrobe.missed, ambience: ambience.missed },
      references,
      brands,
      places,
    };
  };

  let run = await execute(plan);

  // 5. One optional re-plan (LLM call 2 of 3) when a whole set of style words found no Qloo tags.
  const deadWardrobe = run.wardrobeTags.length === 0;
  const deadAmbience = run.ambienceTags.length === 0;
  if (deadWardrobe || deadAmbience) {
    const missed = [...(deadWardrobe ? plan.wardrobe_words : []), ...(deadAmbience ? plan.ambience_words : [])];
    plan = await askPlan(
      {
        ...planContext,
        feedback:
          `These words matched no Qloo tags: ${missed.map((w) => `"${w}"`).join(", ")}. ` +
          `Choose different, more common words for ${[deadWardrobe && "wardrobe", deadAmbience && "ambience"].filter(Boolean).join(" and ")}; keep the rest of the plan unless it should change.`,
      },
      "replan",
    );
    run = await execute(plan);
  } else {
    emit({ type: "step", id: "replan", status: "skipped", label: "Re-plan the style words", summary: "The first plan found tags for every style." });
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
    "Write the treatment",
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
  });
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
  ): Pick<K>[] =>
    uniqueBy(picks ?? [], (p) => p.ref).flatMap((pick) => {
      const entity = refs.find((r) => r.ref === pick.ref)?.item;
      if (!entity) return [];
      const notes = Object.fromEntries(keys.map((k) => [k, clip(pick[k], 400)])) as Record<K, string>;
      return [{ entity, qloo: evidence(list, tool, entity), notes }];
    });

  const references = cite(ctx.references, run.references.items, "reference_films", draft.references, ["why", "borrow"]);
  const wardrobe = cite(ctx.brands, run.brands.items, "styling_brands", draft.wardrobe, ["look"]);
  const locations = cite(ctx.places, run.places.items, "scout_locations", draft.locations, ["scene"]);
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
    tone: uniqueBy(draft.tone ?? [], (t) => t.ref).flatMap((t) => {
      const candidate = ctx.tone.find((c) => c.ref === t.ref);
      return candidate ? [{ tag: candidate.tag, source: candidate.source, note: clip(t.note, 300) }] : [];
    }),
    beats: draft.beats.map((beat) => {
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
    ),
    lighting: draft.lighting.map((l) => clip(l, 300)),
    shots: draft.shots.map((s) => clip(s, 300)),
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
    priceLevelMax: priceLevelMax(input.brief),
  };
}
