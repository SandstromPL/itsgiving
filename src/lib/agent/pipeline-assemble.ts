import type { CompactEntity } from "../qloo";
import { priceLevelMax } from "./brief";
import type { Audience } from "./pipeline-audience";
import type { Execution } from "./pipeline-execute";
import type { People } from "./pipeline-people";
import type { Cast } from "./pipeline-resolve";
import { clip, uniqueBy, type Run } from "./pipeline-run";
import type { Plan } from "./plan";
import type { Pick, QlooEvidence, Treatment } from "./types";
import type { Draft, Ref, WriteContext } from "./write";

// The run's end: the writer's draft becomes the treatment, each cited item with Qloo's evidence for it.

/** What the write step hands on: the draft, what it was written from, and what the board needs besides. */
export interface Written {
  draft: Draft;
  writeContext: WriteContext;
  /** Swaps refs the model leaked into prose for the names they stand for. */
  scrub: (text: string) => string;
  /** Reference films' stills by entity ID (TMDB, from the run's lookups). */
  stills: Map<string, string>;
}

export interface AssembleInput extends Written {
  run: Run;
  cast: Cast;
  audience: Audience;
  plan: Plan;
  execution: Execution;
  people: People;
}

/** Map the draft's refs back to Qloo items and attach each item's evidence. */
export function assemble(input: AssembleInput): Treatment {
  const { run, cast, audience, draft, writeContext: ctx, execution, people } = input;
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

  // The schema only enforces minimums; the maximums the prompt asked for are applied here. Films and series are cited
  // against their own lists (a series is "2 of 6 series"), then kept in the writer's order.
  const isSeries = (ref: string) => ctx.series.some((r) => r.ref === ref);
  const order = (draft.references ?? []).map((p) => p.ref);
  const refOf = new Map([...ctx.references, ...ctx.series].map((r) => [r.item.id, r.ref]));
  const references = [
    ...cite(
      ctx.references,
      execution.references.items,
      "reference_films",
      draft.references?.filter((p) => !isSeries(p.ref)),
      ["why", "borrow"],
      6,
    ),
    ...cite(
      ctx.series,
      execution.series.items,
      "reference_films",
      draft.references?.filter((p) => isSeries(p.ref)),
      ["why", "borrow"],
      2,
    ),
  ]
    .sort((a, b) => order.indexOf(refOf.get(a.entity.id) ?? "") - order.indexOf(refOf.get(b.entity.id) ?? ""))
    .slice(0, 6)
    .map((r) => {
      const still = input.stills.get(r.entity.id);
      return still ? { ...r, still } : r;
    });
  // The writer's cover counts only among the films it cited: the cover is always one of the board's references.
  const coverPick = ctx.references.find((r) => r.ref === draft.cover)?.item.id;
  const cover = references.some((r) => r.entity.id === coverPick) ? coverPick : undefined;
  const wardrobe = cite(ctx.brands, execution.brands.items, "styling_brands", draft.wardrobe, ["look"], 4);
  const locations = cite(ctx.places, execution.places.items, "scout_locations", draft.locations, ["scene"], 4);
  const casting = cite(ctx.casting, people.casting.items, "casting_references", draft.casting, ["role"], 4);
  // A song is kept only as Qloo lists it among the artist's notable songs: a title the model remembers isn't evidence.
  const songOf = (ref: string, song: string | null) => {
    const wanted = (song ?? "").trim().toLowerCase();
    return ctx.music.find((r) => r.ref === ref)?.item.artist?.songs?.find((s) => s.toLowerCase() === wanted) ?? "";
  };
  const music = cite(
    ctx.music,
    people.music.items,
    "music_references",
    draft.music?.map((m) => ({ ref: m.ref, use: m.use, song: songOf(m.ref, m.song) })),
    ["use", "song"],
    4,
  );
  const cited = new Set([...references, ...wardrobe, ...locations, ...casting, ...music].map((p) => p.entity.id));
  const uncited = (items: CompactEntity[]) => items.filter((e) => !cited.has(e.id));

  const directorFit = audience.directorFit.flatMap((list) =>
    list.map((entity) => ({ entity, qloo: evidence(list, "score_for_audience", entity) })),
  );

  const writtenBy = run.traces.find((t) => t.step === "write")?.producedBy ?? {
    provider: "mock",
    model: "itsgiving-template",
    mock: true,
  };
  const calls = Object.values(run.trail).reduce((sum, list) => sum + (list?.length ?? 0), 0);

  return {
    id: run.id,
    createdAt: (run.deps.now?.() ?? new Date()).toISOString(),
    brief: run.brief,
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
    casting,
    ...(run.brief.format === "short_film" ? { music } : {}),
    wardrobe,
    locations,
    base: execution.base
      ? { chosen: execution.base.area.ref, held: execution.base.held, areas: audience.areas, map: audience.heatMap }
      : undefined,
    palette: uniqueBy(
      draft.palette.map((c) => ({ name: clip(c.name, 30), hex: c.hex.toUpperCase() })),
      (c) => c.hex,
    ).slice(0, 6),
    lighting: draft.lighting.slice(0, 4).map((l) => prose(l, 300)),
    shots: draft.shots.slice(0, 6).map((s) => prose(s, 300)),
    extras: {
      references: uncited([...execution.references.items, ...execution.series.items]),
      brands: uncited(execution.brands.items),
      locations: uncited(execution.places.items),
      people: uncited(people.casting.items),
      artists: uncited(people.music.items),
    },
    audience: {
      taste_tags: audience.tasteTags,
      overlap: audience.overlap,
      leans: audience.leans,
      ...(audience.subgenres.length > 0 ? { subgenres: audience.subgenres } : {}),
    },
    subjects: cast.subjects,
    // Plain names for the board; the prompts carry the films' years.
    who: { artists: cast.who.artistNames, films: cast.touchstones.map((e) => e.name), standIns: cast.standIns.map((e) => e.name) },
    director: cast.director,
    ...(directorFit.length > 0 ? { directorFit } : {}),
    notes: run.notes,
    llm: run.traces,
    writtenBy,
    qloo: { mode: run.deps.qloo.mode, calls, steps: run.trail },
    mock: { qloo: run.deps.qloo.mode === "mock", llm: run.traces.some((t) => t.producedBy.mock) },
    complete: run.failures.length === 0,
    priceLevelMax: priceLevelMax(run.brief),
  };
}
