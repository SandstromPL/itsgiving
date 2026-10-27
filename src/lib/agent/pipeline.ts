import { describeKind, generateJson, type LlmDeps, type LlmResult, type Reasoning } from "../llm";
import { defaultSleep, type CompactEntity, type CompactTag, type Provenance, type QlooClient } from "../qloo";
import type { TmdbClient } from "../tmdb";
import type { HeatArea, HeatGrid } from "../tools/heatmap";
import { runTool } from "../tools/registry";
import { VENUE_KIND_VALUES, normalizeName } from "../tools/shared";
import type { ToolResult } from "../tools/types";
import { pickKey, priceLevelMax, type Brief } from "./brief";
import { NONE_PICK, STAND_IN_LIMIT, STEP_LABELS, isIdentityTag, joinNames, type Thinking } from "./options";
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
import type {
  AgentEvent,
  Ambiguity,
  BaseArea,
  BriefField,
  Credit,
  CreditKind,
  LlmStep,
  LlmTrace,
  Pick,
  QlooEvidence,
  Role,
  StepId,
  StepStatus,
  Treatment,
  TreatmentWho,
} from "./types";
import { mockDraft, normalizeDraft, refScrubber, writePrompt, writeSchema, type Draft, type Ref, type WriteContext } from "./write";

// The lean agent: code runs every Qloo tool deterministically and the LLM is
// called at most three times (plan, an optional re-plan, write). Resolve ->
// read audience (+ overlap with the director's films, + the heatmap of where
// the fans are) -> plan (which picks the shoot base) -> find_tags, references,
// wardrobe, locations near the base (relaxing short results) -> write.

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

type Resolution =
  | { input: string; status: "resolved"; match: CompactEntity; among?: number; note?: string }
  | { input: string; status: "ambiguous"; candidates: CompactEntity[]; exact: boolean }
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
  /** How many the first search found when that was too few to keep (it is then relaxed). */
  firstCount?: number;
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
  /** The area the plan based the shoot in; held is false when locations had to come from the whole city. */
  base?: { area: BaseArea; held: boolean };
}

const MAX_TONE_CANDIDATES = 16;
/** How far a shoot base reaches: places within it are a short unit move apart. */
const BASE_RADIUS_M = 2_000;
/** Fewer places than this near the base, and locations are scouted across the city instead. */
const MIN_BASE_PLACES = 3;

/**
 * Time limits per thinking depth, sized from live DeepSeek runs (2026-10-25): deep plans took 4-6 s and
 * deep writes 22-35 s; quick plans about 3 s and quick writes 12-18 s. Each limit leaves room for one
 * fallback to a free model, and the run limit sits under the route's maxDuration.
 */
export const TIMING: Record<Thinking, { planMs: number; writeMs: number; runMs: number }> = {
  deep: { planMs: 20_000, writeMs: 60_000, runMs: 120_000 },
  quick: { planMs: 15_000, writeMs: 45_000, runMs: 90_000 },
};
const REASONING: Record<Thinking, Reasoning> = { deep: "high", quick: "low" };
/** Held back while planning, on top of the write's own limit: the Qloo calls before it and one fallback. */
const WRITE_MARGIN_MS = 15_000;
/** How often a model call that is still thinking says so: it keeps the stream and the timeline alive. */
const TICK_MS = 5_000;

function clip(text: string, max: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean;
}

/** Like clip, but ends on a whole sentence when one fits: a direction cut off mid-word reads as broken. */
export function clipSentences(text: string, max: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const end = clean.lastIndexOf(". ", max - 1);
  return end > max / 2 ? clean.slice(0, end + 1) : clip(clean, max);
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

/** How many names a credit carries: the run stage sets the newest credit large, so a few say it. */
const CREDIT_NAMES = 3;

/** A step's credit for what it found (entities, tags or an area), or none when it found nothing to name. */
function toCredit(kind: CreditKind, found: { name: string }[], standInFor?: string): Credit | undefined {
  const names = uniqueBy(found, (item) => normalizeName(item.name))
    .slice(0, CREDIT_NAMES)
    .map((item) => item.name);
  if (names.length === 0) return undefined;
  return standInFor ? { kind, names, standInFor } : { kind, names };
}

/** a1, b1, a2, b2…: the first few then sample both lists. */
function alternate<T>(a: T[], b: T[]): T[] {
  return Array.from({ length: Math.max(a.length, b.length) }, (_, i) => [a[i], b[i]])
    .flat()
    .filter((item) => item !== undefined);
}

/** Tags never used to steer a treatment, whatever the semantic search ranks them (live "intimate" also returns these). */
const UNSAFE_TAG = /adult|erotic|sex|strip|nsfw/i;

/** An error's message and, where the network gave one, its code (ETIMEDOUT, ECONNRESET): what a log needs to say why. */
function failureReason(err: unknown): string {
  const code = (e: unknown) => (e && typeof e === "object" && "code" in e && typeof e.code === "string" ? e.code : undefined);
  const cause = err instanceof Error ? err.cause : undefined;
  const why = code(err) ?? code(cause) ?? (cause instanceof Error ? code(cause.cause) : undefined);
  return [err instanceof Error ? err.message : String(err), why].filter(Boolean).join(" ");
}

/**
 * Stills for the reference films the writer may cite, keyed by entity ID: TMDB's backdrop of each film it knows by IMDb
 * ID. A film without one keeps Qloo's poster on its card, and a failure only costs the stills, never the treatment. The
 * warning says why they failed, not only how many.
 */
export async function filmStills(films: CompactEntity[], tmdb: TmdbClient | undefined, signal?: AbortSignal): Promise<Map<string, string>> {
  const stills = new Map<string, string>();
  if (!tmdb?.configured) return stills;
  let failed = 0;
  const reasons = new Set<string>();
  await Promise.all(
    films.map(async (film) => {
      if (!film.external?.imdb) return;
      try {
        const still = await tmdb.backdrop(film.external.imdb, signal);
        if (still) stills.set(film.id, still);
      } catch (err) {
        failed++;
        reasons.add(failureReason(err));
      }
    }),
  );
  if (failed > 0) console.warn(JSON.stringify({ evt: "tmdb_stills", failed, of: films.length, why: [...reasons].slice(0, 3) }));
  return stills;
}

/**
 * Semantic tag search drifts ("intimate" -> "Adult only"), so prefer the tags
 * whose name contains the word (or vice versa), and fall back to the top hit.
 */
export function closestTags(word: string, tags: CompactTag[], max = 2): CompactTag[] {
  const safe = tags.filter((t) => t.id.startsWith("urn:tag:") && !UNSAFE_TAG.test(`${t.id} ${t.name}`) && !isIdentityTag(t.name));
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
  const { signal } = options;
  const runDeadline = options.deadline ?? Number.POSITIVE_INFINITY;
  const timing = TIMING[brief.thinking];
  const writeReserveMs = timing.writeMs + WRITE_MARGIN_MS;
  const trail: Partial<Record<StepId, Provenance[]>> = {};
  const notes: string[] = [];
  const traces: LlmTrace[] = [];
  /**
   * Every Qloo call that failed, as step:tool=kind: the treatment is then partial and must not be cached, even when a
   * lighter rung of the same step found what it needed.
   */
  const failures: string[] = [];
  const warnings = new Set<string>();
  let llmCalls = 0;

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

  const begin = (id: StepId, label: string) => {
    emit({ type: "step", id, status: "running", label });
    const started = Date.now();
    return (status: StepStatus, summary: string, { llm, credit }: { llm?: LlmTrace; credit?: Credit } = {}) =>
      emit({ type: "step", id, status, label, summary, ms: Date.now() - started, qloo: trail[id], llm, credit });
  };

  const llm = async <T>(
    step: LlmStep,
    label: string,
    call: () => Promise<LlmResult<T>>,
    summarize: (data: T) => string,
    credited?: (data: T) => Credit | undefined,
  ): Promise<T> => {
    const end = begin(step, label);
    llmCalls += 1;
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
  };

  // 1. Resolve the artist, touchstones and the director's films, and any artists standing in for an artist Qloo lacks.
  const isVideo = brief.format === "music_video";
  const film = (input: string, role: Role): NameSpec => ({ input, ...parseTitle(input), type: "movie", role });
  const musician = (input: string, role: Role): NameSpec => ({ input, name: input, type: "artist", role });
  const artistSpec = brief.artist ? musician(brief.artist, "artist") : undefined;
  const touchstoneSpecs = brief.touchstones.map((input) => film(input, "touchstone"));
  // Stand-ins only speak for a music video's artist. They're looked up with the rest but used only if Qloo lacks the artist.
  const standInSpecs = isVideo && artistSpec ? (brief.stand_ins ?? []).map((input) => musician(input, "stand_in")) : [];
  const subjectSpecs: NameSpec[] = [...(artistSpec ? [artistSpec] : []), ...touchstoneSpecs, ...standInSpecs];
  const directorSpecs: NameSpec[] = brief.director_films.map((input) => film(input, "director"));
  const endResolve = begin("resolve", STEP_LABELS.resolve);
  const asItems = (specs: NameSpec[]) => ({ items: specs.map(({ name, year, type }) => ({ name, type, ...(year ? { year } : {}) })) });
  const imported = brief.director_imdb_ids ?? [];
  const [subjectResult, directorResult, cityResult, importedResult] = await Promise.all([
    tool<{ items: Resolution[] }>("resolve", "resolve_entities", asItems(subjectSpecs)),
    directorSpecs.length > 0 ? tool<{ items: Resolution[] }>("resolve", "resolve_entities", asItems(directorSpecs)) : null,
    // The city as a Qloo locality is more exact than its name: live "New York" by name is the state.
    tool<{ items: Resolution[] }>("resolve", "resolve_entities", { items: [{ name: brief.city, type: "locality" }] }),
    // Imported taste is looked up by IMDb ID: exact, one request for up to 25 films, and nothing to ask about.
    imported.length > 0 ? tool<{ entities: CompactEntity[] }>("resolve", "import_external_ids", { imdb_ids: imported }) : null,
  ]);
  if (subjectResult.status === "error" || !subjectResult.data) {
    endResolve("error", subjectResult.summary);
    return { kind: "failed", message: `Couldn't look up the brief in Qloo: ${subjectResult.error?.message ?? subjectResult.summary}` };
  }
  if (directorResult?.status === "error")
    notes.push(`Your taste films couldn't be looked up (${directorResult.summary}), so they were left out.`);
  const importedFilms = importedResult?.data?.entities ?? [];
  if (importedResult?.status === "error") {
    notes.push(`Your imported films couldn't be looked up (${importedResult.summary}), so they were left out.`);
  } else if (importedResult && importedFilms.length < imported.length) {
    const left = imported.length - importedFilms.length;
    notes.push(
      `${left} of your imported films ${left === 1 ? "isn't" : "aren't"} in Qloo's catalog, so ${left === 1 ? "it was" : "they were"} left out.`,
    );
  }

  const ambiguities: Ambiguity[] = [];
  const missing: NameSpec[] = [];
  const settle = (spec: NameSpec, resolution: Resolution | undefined): CompactEntity | undefined => {
    const key = pickKey(spec.type, spec.input);
    if (resolution?.status === "resolved") {
      if (resolution.among) {
        const m = resolution.match;
        notes.push(
          `"${spec.input}" matched ${resolution.among} titles in Qloo; itsgiving used the far better-known ${m.name}${m.year ? ` (${m.year})` : ""}.`,
        );
      }
      if (resolution.note) notes.push(resolution.note);
      return resolution.match;
    }
    if (resolution?.status === "ambiguous") {
      // A pick only counts if it is one of the candidates Qloo returned, or none of them.
      const chosen = resolution.candidates.find((c) => c.id === brief.picks[key]);
      if (chosen) return chosen;
      if (brief.picks[key] !== NONE_PICK) {
        ambiguities.push({
          key,
          input: spec.input,
          role: spec.role,
          status: "ambiguous",
          exact: resolution.exact,
          candidates: resolution.candidates,
        });
        return undefined;
      }
    }
    missing.push(spec);
    return undefined;
  };
  const settleAll = (specs: NameSpec[]) =>
    specs.map((spec) => settle(spec, subjectResult.data?.items[subjectSpecs.indexOf(spec)])).filter((e): e is CompactEntity => Boolean(e));

  // The artist first: whether Qloo has them decides whether the stand-ins are needed.
  let artist: CompactEntity | undefined;
  let artistMissing = false;
  if (artistSpec) {
    const resolution = subjectResult.data.items[0];
    const answered = brief.picks[pickKey(artistSpec.type, artistSpec.input)] !== undefined;
    const nearMissesOnly = resolution?.status === "not_found" || (resolution?.status === "ambiguous" && !resolution.exact && !answered);
    if (standInSpecs.length > 0 && nearMissesOnly) {
      // The director already named who carries the audience, so Qloo's nearest names aren't worth a question.
      artistMissing = true;
      if (resolution?.status === "ambiguous") {
        notes.push(
          `Qloo's nearest names to "${artistSpec.input}" were ${joinNames(resolution.candidates.slice(0, 3).map((c) => c.name))}.`,
        );
      }
    } else {
      artist = settle(artistSpec, resolution);
      artistMissing = missing.includes(artistSpec);
    }
  }
  const touchstones = settleAll(touchstoneSpecs);
  const standIns = artistMissing ? settleAll(standInSpecs) : [];
  if (artist && standInSpecs.length > 0) notes.push(`Qloo has ${artist.name}, so the stand-in artists weren't needed.`);
  const subjects = uniqueBy([...(artist ? [artist] : []), ...touchstones, ...standIns], (e) => e.id);
  const director = uniqueBy(
    [
      ...directorSpecs
        .map((spec, i) => (directorResult?.data ? settle(spec, directorResult.data.items[i]) : undefined))
        .filter((e): e is CompactEntity => Boolean(e)),
      ...importedFilms,
    ],
    (e) => e.id,
  );

  if (ambiguities.length > 0) {
    // The same title can sit in two lists (touchstones and your taste); one question answers both.
    const questions = uniqueBy(ambiguities, (a) => a.key);
    endResolve("warning", `Need your call on ${questions.map((a) => `"${a.input}"`).join(", ")}.`);
    const message = questions.every((q) => q.exact)
      ? "Some names match more than one title in Qloo, so itsgiving won't guess."
      : questions.every((q) => !q.exact)
        ? "Qloo has nothing under these exact names, so itsgiving won't guess. Pick the right one, or none of them."
        : "Some names need your call before itsgiving goes on.";
    return { kind: "needs_input", message, items: questions };
  }
  // A music video keeps its artist's name whatever Qloo has; only the audience comes from someone else.
  const artistGone = isVideo && artistMissing;
  if (subjects.length === 0) {
    endResolve("error", `Not found: ${missing.map((m) => m.input).join(", ")}.`);
    if (artistGone && brief.artist) {
      const triedStandIns = missing.filter((m) => m.role === "stand_in").map((m) => m.input);
      return {
        kind: "failed",
        field: "stand_ins",
        message:
          triedStandIns.length > 0
            ? `Qloo doesn't have ${brief.artist}, or ${joinNames(triedStandIns)}. Try other artists with a similar audience.`
            : `Qloo doesn't have ${brief.artist}. Name up to ${STAND_IN_LIMIT} artists with a similar audience: the treatment keeps ${brief.artist}'s name and reads their fans instead.`,
      };
    }
    return {
      kind: "failed",
      message: `Qloo couldn't find ${missing.map((m) => `"${m.input}"`).join(", ")}. Check the spelling or try another artist or film.`,
    };
  }
  if (artistGone && brief.artist) {
    notes.push(
      standIns.length > 0
        ? `Qloo doesn't have ${brief.artist}, so the audience was read through ${joinNames(names(standIns))}; the treatment keeps ${brief.artist}'s name.`
        : `Qloo doesn't have ${brief.artist}, so the audience was read from the reference films alone.`,
    );
  }
  const leftOut = missing.filter((m) => !(artistGone && m === artistSpec)).map((m) => m.input);
  if (leftOut.length > 0) notes.push(`Not in Qloo's catalog, so left out: ${leftOut.join(", ")}.`);
  const resolvedLine =
    artistGone && brief.artist
      ? [
          `${brief.artist} (not in Qloo)`,
          ...(standIns.length > 0 ? [`read through ${joinNames(names(standIns))}`] : []),
          ...names(touchstones),
        ]
      : names(subjects);
  endResolve(
    missing.length > 0 || artistGone ? "warning" : "done",
    `${resolvedLine.join(", ")}${director.length > 0 ? `; your taste: ${director.length} film${director.length === 1 ? "" : "s"}` : ""}.`,
    {
      credit: artistGone && brief.artist ? toCredit("subject", [...standIns, ...touchstones], brief.artist) : toCredit("subject", subjects),
    },
  );

  const subjectIds = subjects.map((e) => e.id);
  const directorIds = director.map((e) => e.id);
  const entityNames = new Map([...subjects, ...director].map((e) => [e.id, e.name]));
  const city = cityResult.data?.items[0];
  const cityId = city?.status === "resolved" ? city.match.id : undefined;
  if (city?.status === "resolved" && city.note) notes.push(city.note);

  // 2. Read the audience, where it meets the director's own taste, and where in the city it is. None depends on another.
  const endAudience = begin("audience", STEP_LABELS.audience);
  const endOverlap = director.length > 0 ? begin("overlap", STEP_LABELS.overlap) : undefined;
  const endHeatmap = begin("heatmap", STEP_LABELS.heatmap);
  const [audience, shared, heat] = await Promise.all([
    tool<{ taste_tags: CompactTag[]; demographics: { entity_id: string; leans: string }[] }>("audience", "read_audience", {
      entity_ids: subjectIds,
      take: 15,
    }),
    endOverlap
      ? tool<{ shared_traits: CompactTag[] }>("overlap", "taste_overlap", {
          // Typed films first, then imported ones; Qloo compares up to 25 a side.
          group_a_ids: directorIds.slice(0, 25),
          group_b_ids: subjectIds,
          take: 10,
        })
      : undefined,
    tool<{ areas: HeatArea[]; map?: HeatGrid }>("heatmap", "audience_heatmap", {
      signal_entity_ids: subjectIds,
      city: brief.city,
      ...(cityId ? { locality_id: cityId } : {}),
      areas: 3,
      radius_m: BASE_RADIUS_M,
    }),
  ]);
  const areas: BaseArea[] = (heat.data?.areas ?? []).map((area) => ({ ...area, ref: `A${area.rank}` }));
  const heatMap = heat.data?.map;
  if (heat.status === "error") notes.push(`The heatmap failed (${heat.summary}), so locations were scouted across the city.`);
  endHeatmap(heat.status === "ok" ? "done" : heat.status === "error" ? "error" : "warning", heat.summary);
  // Tags that name who people are (LGBT, a religion, a health condition) never become tone or evidence: see isIdentityTag.
  const tasteTags = (audience.data?.taste_tags ?? []).filter((tag) => !isIdentityTag(tag.name));
  const leans = (audience.data?.demographics ?? []).map((d) =>
    subjects.length > 1 ? `${entityNames.get(d.entity_id) ?? "audience"}: ${d.leans}` : d.leans,
  );
  if (audience.status === "error") notes.push(`The audience read failed (${audience.summary}).`);
  for (const warning of audience.warnings) notes.push(warning);
  endAudience(audience.status === "ok" ? "done" : "warning", audience.summary, { credit: toCredit("audience", tasteTags) });

  let overlap: CompactTag[] = [];
  if (endOverlap && shared) {
    overlap = (shared.data?.shared_traits ?? []).filter((tag) => !isIdentityTag(tag.name));
    endOverlap(shared.status === "ok" ? "done" : "warning", shared.summary);
  } else {
    emit({
      type: "step",
      id: "overlap",
      status: "skipped",
      label: STEP_LABELS.overlap,
      summary: "Add your own favourite films to find the overlap.",
    });
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
    // A music video is for its artist by name, in Qloo or not. A short film's artist only says whose fans it's for,
    // so one Qloo lacks drops out.
    artistNames: isVideo ? (brief.artist ? [artist?.name ?? brief.artist] : []) : artist ? [artist.name] : [],
    touchstoneNames: names(touchstones),
    directorNames: names(director),
    standInNames: names(standIns),
    artistMissing: artistGone,
  };
  const planContext: PlanContext = {
    brief,
    ...who,
    candidates,
    leans,
    areas,
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
            deadline: runDeadline - writeReserveMs,
            minCallMs: 4_000,
            timeoutMs: timing.planMs,
          },
          deps.llm,
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
  let plan = await askPlan(planContext, "plan");

  // 4. Execute the plan in code.
  const findTags = async (words: string[], filter: object): Promise<{ tags: CompactTag[]; missed: string[]; errored: boolean }> => {
    const results = await Promise.all(
      words.map((query) => tool<{ tags: CompactTag[] }>("tags", "find_tags", { query, ...filter, take: 5 })),
    );
    const picked = words.map((word, i) => closestTags(word, results[i].data?.tags ?? []));
    // Only a search that worked and found nothing counts as a miss; a failed request says nothing about the word.
    const missed = words.filter((_, i) => results[i].status !== "error" && picked[i].length === 0);
    return { tags: uniqueBy(picked.flat(), (t) => t.id).slice(0, 4), missed, errored: results.some((r) => r.status === "error") };
  };

  /** Run the ladder until a rung finds enough: `firstMin` for the first rung (a shoot base needs a few places), one after. */
  const relax = async (
    step: StepId,
    toolName: string,
    key: string,
    ladder: [string, Record<string, unknown>][],
    firstMin = 1,
  ): Promise<Relaxed> => {
    const relaxations: string[] = [];
    let lastError: string | undefined;
    let firstCount: number | undefined;
    // A first rung that found some but too few: still better than nothing if every wider rung fails.
    let short: Relaxed | undefined;
    for (let i = 0; i < ladder.length; i++) {
      const result = await tool<Record<string, CompactEntity[]>>(step, toolName, ladder[i][1]);
      const items = result.data?.[key] ?? [];
      if (result.status !== "error" && items.length >= (i === 0 ? firstMin : 1)) return { items, relaxations, firstCount };
      if (result.status !== "error" && items.length > 0) {
        firstCount = items.length;
        short = { items, relaxations: [] };
      }
      // A failed call is treated like an empty one: the next rung is usually lighter (no tag signals), which is
      // exactly what helps when Qloo is slow on a heavy query.
      if (result.status === "error") lastError = result.error?.message ?? result.summary;
      if (i + 1 < ladder.length) relaxations.push(ladder[i + 1][0]);
    }
    if (short) return short;
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

  const report = (
    step: StepId,
    kind: CreditKind,
    label: string,
    what: string,
    relaxed: Relaxed,
    describe: (items: CompactEntity[]) => string,
  ) => {
    if (relaxed.error) {
      notes.push(`${label}: ${relaxed.error}`);
      emit({ type: "step", id: step, status: "error", label, summary: relaxed.error, qloo: trail[step] });
      return;
    }
    if (relaxed.relaxations.length > 0) {
      const first = relaxed.firstCount ? `only ${relaxed.firstCount} matched at first` : "nothing matched at first";
      notes.push(`${what}: ${first}, so itsgiving ${relaxed.relaxations.join(", then ")}.`);
    }
    const status: StepStatus = relaxed.items.length === 0 || relaxed.relaxations.length > 0 ? "warning" : "done";
    const summary =
      relaxed.items.length === 0
        ? `No ${what.toLowerCase()} matched, even after relaxing.`
        : `${describe(relaxed.items)}${relaxed.relaxations.length > 0 ? ` (relaxed: ${relaxed.relaxations.join(", ")})` : ""}`;
    // Relaxed finds are credited too: they are what the treatment uses.
    emit({ type: "step", id: step, status, label, summary, qloo: trail[step], credit: toCredit(kind, relaxed.items) });
  };

  const execute = async (current: Plan): Promise<Execution> => {
    const ceiling = DEEP_CUT_CEILING[current.deep_cuts];
    const hasEra = current.era_from !== null || current.era_to !== null;
    const price = priceLevelMax(brief);
    const base = areas.find((a) => a.ref === current.base) ?? areas[0];

    const endTags = begin("tags", STEP_LABELS.tags);
    // Reference films use the entity signal only, so they needn't wait for the tag search.
    emit({ type: "step", id: "references", status: "running", label: STEP_LABELS.references });
    const pendingReferences = relax(
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
    );
    // Awaited below; this only keeps a failure while the tags are pending from going unhandled.
    pendingReferences.catch(() => {});
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
      // A wardrobe tag, then an ambience one: the credit's few names speak for both.
      { credit: toCredit("style", alternate(wardrobe.tags, ambience.tags)) },
    );

    for (const [id, label] of [
      ["wardrobe", STEP_LABELS.wardrobe],
      ["locations", STEP_LABELS.locations],
    ] as const) {
      emit({ type: "step", id, status: "running", label });
    }

    const [references, brands, places] = await Promise.all([
      pendingReferences,
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
            ...(cityId ? { locality_id: cityId } : {}),
            near: base ? { lat: base.lat, lon: base.lon, radius_m: base.radius_m } : undefined,
            signal_entity_ids: subjectIds,
            venue_kinds: current.venue_kinds,
            ambience_tag_ids: ambience.tags.length > 0 ? ambience.tags.map((t) => t.id) : undefined,
            require_photo: true,
            price_level_max: price,
            take: 8,
          },
          // Creative choices give way before the director's constraints: the base, venue kinds, then photos, then budget.
          [
            [`widened the search from ${base?.name} to all of ${brief.city}`, { near: undefined }, base !== undefined],
            ["widened to every kind of venue", { venue_kinds: VENUE_KIND_VALUES }, current.venue_kinds.length < VENUE_KIND_VALUES.length],
            ["allowed places without photos", { require_photo: false }, true],
            ["lifted the price ceiling", { price_level_max: undefined }, price !== undefined],
          ],
        ),
        base ? MIN_BASE_PLACES : 1,
      ),
    ]);
    // The base held when the first rung (near it) was enough, or was all there was.
    const held = base !== undefined && places.items.length > 0 && places.relaxations.length === 0;

    report("references", "films", STEP_LABELS.references, "Reference films", references, (items) => names(items).slice(0, 4).join(", "));
    report("wardrobe", "brands", STEP_LABELS.wardrobe, "Wardrobe brands", brands, (items) => names(items).slice(0, 5).join(", "));
    report(
      "locations",
      "places",
      STEP_LABELS.locations,
      "Locations",
      places,
      (items) =>
        `${items
          .slice(0, 4)
          .map((p) => p.name)
          .join(", ")} ${held ? `near ${base?.name}, ${brief.city}` : `in ${brief.city}`}`,
    );

    return {
      wardrobeTags: wardrobe.tags,
      ambienceTags: ambience.tags,
      missedWords: { wardrobe: wardrobe.missed, ambience: ambience.missed },
      tagSearchFailed: wardrobe.errored || ambience.errored,
      references,
      brands,
      places,
      base: base ? { area: base, held } : undefined,
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
  } else if (runDeadline - Date.now() < timing.planMs + writeReserveMs) {
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
    base: run.base?.held ? run.base.area : undefined,
    names: entityNames,
  };
  // The reference films' stills come from TMDB while the writer works, so they cost no time.
  const pendingStills =
    deps.qloo.mode === "mock"
      ? Promise.resolve(new Map<string, string>())
      : filmStills(
          writeContext.references.map((r) => r.item),
          deps.tmdb,
          signal,
        );
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
          reasoning: REASONING[brief.thinking],
          maxOutputTokens: 8192,
          normalize: normalizeDraft,
          signal,
          deadline: runDeadline - 1_000,
          minCallMs: 8_000,
          timeoutMs: timing.writeMs,
        },
        deps.llm,
      ),
    (d) => `"${clip(d.title, 60)}": ${clip(d.logline, 160)}`,
  );
  const scrub = refScrubber(
    new Map([
      ...candidates.map((c) => [c.ref, c.tag.name] as const),
      ...[...writeContext.references, ...writeContext.brands, ...writeContext.places].map((r) => [r.ref, r.item.name] as const),
    ]),
  );
  // After a fast write the stills may still be out: wait a moment at most, then go without.
  const none = () => new Map<string, string>();
  const stills = await Promise.race([pendingStills, defaultSleep(1_500, signal).then(none, none)]);

  const treatment = assemble({
    scrub,
    stills,
    id: options.id,
    brief,
    draft,
    writeContext,
    run,
    plan,
    subjects,
    // Plain names for the board; the prompts above carry the films' years.
    who: { artists: who.artistNames, films: touchstones.map((e) => e.name), standIns: standIns.map((e) => e.name) },
    director,
    tasteTags,
    overlap,
    leans,
    areas,
    heatMap,
    notes,
    traces,
    trail,
    deps,
    complete: failures.length === 0,
  });
  if (warnings.size > 0) console.warn(JSON.stringify({ evt: "qloo_warnings", id: options.id, warnings: [...warnings].slice(0, 10) }));
  // What made it partial: the kind of each failure (rate_limit, timeout, upstream…), never Qloo's own text.
  if (failures.length > 0) console.warn(JSON.stringify({ evt: "qloo_failed", id: options.id, failed: failures.slice(0, 10) }));
  if (llmCalls > 3) throw new Error(`Pipeline made ${llmCalls} LLM calls; the budget is 3.`);
  return { kind: "treatment", treatment };
}

interface AssembleInput {
  /** Swaps refs the model leaked into prose for the names they stand for. */
  scrub: (text: string) => string;
  /** Reference films' stills by entity ID (filmStills). */
  stills: Map<string, string>;
  id: string;
  brief: Brief;
  draft: Draft;
  writeContext: WriteContext;
  run: Execution;
  plan: Plan;
  subjects: CompactEntity[];
  who: TreatmentWho;
  director: CompactEntity[];
  tasteTags: CompactTag[];
  overlap: CompactTag[];
  leans: string[];
  areas: BaseArea[];
  heatMap?: HeatGrid;
  notes: string[];
  traces: LlmTrace[];
  trail: Partial<Record<StepId, Provenance[]>>;
  deps: PipelineDeps;
  complete: boolean;
}

/** Map the draft's refs back to Qloo items and attach each item's evidence. */
function assemble(input: AssembleInput): Treatment {
  const { draft, writeContext: ctx, run } = input;
  const prose = (text: string, max: number) => clip(input.scrub(text), max);
  const evidence = (list: CompactEntity[], tool: string, entity: CompactEntity): QlooEvidence => ({
    tool,
    rank: list.indexOf(entity) + 1,
    of: list.length,
    affinity: entity.affinity,
    popularity: entity.popularity,
    tags: entity.tags,
    because: (entity.because ?? []).map((b) => ({ name: ctx.names.get(b.entity_id) ?? "", score: b.score })).filter((b) => b.name),
  });
  const cite = <K extends string>(
    refs: Ref<CompactEntity>[],
    list: CompactEntity[],
    tool: string,
    picks: ({ ref: string } & Record<K, string>)[] | undefined,
    keys: K[],
    max: number,
  ): Pick<K>[] =>
    uniqueBy(picks ?? [], (p) => p.ref)
      .slice(0, max)
      .flatMap((pick) => {
        const entity = refs.find((r) => r.ref === pick.ref)?.item;
        if (!entity) return [];
        const notes = Object.fromEntries(keys.map((k) => [k, prose(pick[k], 400)])) as Record<K, string>;
        return [{ entity, qloo: evidence(list, tool, entity), notes }];
      });

  // The schema only enforces minimums; the maximums the prompt asked for are applied here.
  const references = cite(ctx.references, run.references.items, "reference_films", draft.references, ["why", "borrow"], 6).map((r) => {
    const still = input.stills.get(r.entity.id);
    return still ? { ...r, still } : r;
  });
  // The writer's cover counts only among the films it cited: the cover is always one of the board's references.
  const coverPick = ctx.references.find((r) => r.ref === draft.cover)?.item.id;
  const cover = references.some((r) => r.entity.id === coverPick) ? coverPick : undefined;
  const wardrobe = cite(ctx.brands, run.brands.items, "styling_brands", draft.wardrobe, ["look"], 4);
  const locations = cite(ctx.places, run.places.items, "scout_locations", draft.locations, ["scene"], 4);
  const cited = new Set([...references, ...wardrobe, ...locations].map((p) => p.entity.id));
  const uncited = (items: CompactEntity[]) => items.filter((e) => !cited.has(e.id));

  const writtenBy = input.traces.find((t) => t.step === "write")?.producedBy ?? {
    provider: "mock",
    model: "itsgiving-template",
    mock: true,
  };
  const calls = Object.values(input.trail).reduce((sum, list) => sum + (list?.length ?? 0), 0);

  return {
    id: input.id,
    createdAt: (input.deps.now?.() ?? new Date()).toISOString(),
    brief: input.brief,
    title: prose(draft.title, 80),
    logline: prose(draft.logline, 300),
    concept: prose(draft.concept, 1500),
    direction: input.scrub(input.plan.direction),
    tone: uniqueBy(draft.tone ?? [], (t) => t.ref)
      .slice(0, 5)
      .flatMap((t) => {
        const candidate = ctx.tone.find((c) => c.ref === t.ref);
        return candidate ? [{ tag: candidate.tag, source: candidate.source, note: prose(t.note, 300) }] : [];
      }),
    beats: draft.beats.slice(0, 6).map((beat) => {
      const ref = beat.reference ? ctx.references.find((r) => r.ref === beat.reference)?.item : undefined;
      return {
        title: prose(beat.title, 60),
        description: prose(beat.description, 500),
        reference: ref ? { id: ref.id, name: ref.name } : null,
      };
    }),
    references,
    cover,
    wardrobe,
    locations,
    base: run.base ? { chosen: run.base.area.ref, held: run.base.held, areas: input.areas, map: input.heatMap } : undefined,
    palette: uniqueBy(
      draft.palette.map((c) => ({ name: clip(c.name, 30), hex: c.hex.toUpperCase() })),
      (c) => c.hex,
    ).slice(0, 6),
    lighting: draft.lighting.slice(0, 4).map((l) => prose(l, 300)),
    shots: draft.shots.slice(0, 6).map((s) => prose(s, 300)),
    extras: {
      references: uncited(run.references.items),
      brands: uncited(run.brands.items),
      locations: uncited(run.places.items),
    },
    audience: { taste_tags: input.tasteTags, overlap: input.overlap, leans: input.leans },
    subjects: input.subjects,
    who: input.who,
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
