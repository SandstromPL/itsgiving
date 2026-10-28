import type { CompactTag } from "../qloo";
import { VENUE_KIND_VALUES, normalizeName } from "../tools/shared";
import { priceLevelMax } from "./brief";
import { STEP_LABELS, withoutIdentity } from "./options";
import { ladder, relax, report, type Relaxed } from "./pipeline-relax";
import type { Cast } from "./pipeline-resolve";
import { names, toCredit, uniqueBy, type Run } from "./pipeline-run";
import { DEEP_CUT_CEILING, type Plan } from "./plan";
import type { BaseArea } from "./types";

// Executing a plan, in code: its style words become Qloo tags, then come the reference films, wardrobe brands and
// locations near the shoot base, each search relaxed when it finds too little. A re-plan runs it all again.

/** Fewer places than this near the base, and locations are scouted across the city instead. */
const MIN_BASE_PLACES = 3;

/** Tags never used to steer a treatment, whatever the semantic search ranks them (live "intimate" also returns these). */
const UNSAFE_TAG = /adult|erotic|sex|strip|nsfw/i;

export interface Execution {
  wardrobeTags: CompactTag[];
  ambienceTags: CompactTag[];
  missedWords: { wardrobe: string[]; ambience: string[] };
  /** A tag search failed (rather than finding nothing), so a re-plan wouldn't help. */
  tagSearchFailed: boolean;
  references: Relaxed;
  /** Series the audience over-indexes on, found beside the films in the references step. */
  series: Relaxed;
  brands: Relaxed;
  places: Relaxed;
  /** The area the plan based the shoot in; held is false when locations had to come from the whole city. */
  base?: { area: BaseArea; held: boolean };
}

/** a1, b1, a2, b2…: the first few then sample both lists. */
function alternate<T>(a: T[], b: T[]): T[] {
  return Array.from({ length: Math.max(a.length, b.length) }, (_, i) => [a[i], b[i]])
    .flat()
    .filter((item) => item !== undefined);
}

/**
 * Semantic tag search drifts ("intimate" -> "Adult only"), so prefer the tags
 * whose name contains the word (or vice versa), and fall back to the top hit.
 */
export function closestTags(word: string, tags: CompactTag[], max = 2): CompactTag[] {
  const safe = withoutIdentity(tags.filter((t) => t.id.startsWith("urn:tag:") && !UNSAFE_TAG.test(`${t.id} ${t.name}`)));
  const wanted = normalizeName(word);
  const close = safe.filter((t) => {
    const name = normalizeName(t.name);
    return name.length > 0 && (name.includes(wanted) || wanted.includes(name));
  });
  return (close.length > 0 ? close : safe).slice(0, max);
}

async function findTags(run: Run, words: string[], filter: object): Promise<{ tags: CompactTag[]; missed: string[]; errored: boolean }> {
  const results = await Promise.all(
    words.map((query) => run.tool<{ tags: CompactTag[] }>("tags", "find_tags", { query, ...filter, take: 5 })),
  );
  const picked = words.map((word, i) => closestTags(word, results[i].data?.tags ?? []));
  // Only a search that worked and found nothing counts as a miss; a failed request says nothing about the word.
  const missed = words.filter((_, i) => results[i].status !== "error" && picked[i].length === 0);
  return { tags: uniqueBy(picked.flat(), (t) => t.id).slice(0, 4), missed, errored: results.some((r) => r.status === "error") };
}

export async function executePlan(run: Run, plan: Plan, cast: Cast, areas: BaseArea[]): Promise<Execution> {
  const { brief, emit, begin } = run;
  const { subjectIds, directorIds, cityId } = cast;
  const ceiling = DEEP_CUT_CEILING[plan.deep_cuts];
  const hasEra = plan.era_from !== null || plan.era_to !== null;
  const price = priceLevelMax(brief);
  const base = areas.find((a) => a.ref === plan.base) ?? areas[0];

  const endTags = begin("tags", STEP_LABELS.tags);
  // References use the entity signal only, so they needn't wait for the tag search.
  emit({ type: "step", id: "references", status: "running", label: STEP_LABELS.references });
  // Entity signal only: on the live host, tone tags as signal.interests.tags made this query run 22-60 s and end in a
  // Qloo 504. The tone tags still shape the writing. Series are searched the same way, beside the films.
  const titles = (kind: "movie" | "tv_show", take: number) =>
    relax(
      run,
      "references",
      "reference_films",
      "references",
      ladder(
        {
          signal_entity_ids: subjectIds,
          kind,
          from_year: plan.era_from ?? undefined,
          to_year: plan.era_to ?? undefined,
          max_popularity: ceiling,
          exclude_ids: [...subjectIds, ...directorIds].slice(0, 50),
          take,
        },
        [
          ["dropped the era", { from_year: undefined, to_year: undefined }, hasEra],
          ["lifted the deep-cut ceiling", { max_popularity: undefined }, ceiling !== undefined],
        ],
      ),
    );
  const pendingReferences = titles("movie", 10);
  const pendingSeries = titles("tv_show", 6);
  // Awaited below; this only keeps a failure while the tags are pending from going unhandled.
  pendingReferences.catch(() => {});
  pendingSeries.catch(() => {});
  const [wardrobe, ambience] = await Promise.all([
    // Brand genre tags are hierarchical (urn:tag:genre:brand:fashion:...), so filter by what they apply to, not by type.
    findTags(run, plan.wardrobe_words, { applies_to: "brand" }),
    findTags(run, plan.ambience_words, { applies_to: "place", tag_types: ["ambience", "decor", "setting"] }),
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

  const [references, series, brands, places] = await Promise.all([
    pendingReferences,
    pendingSeries,
    relax(
      run,
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
      run,
      "locations",
      "scout_locations",
      "locations",
      ladder(
        {
          city: brief.city,
          ...(cityId ? { locality_id: cityId } : {}),
          near: base ? { lat: base.lat, lon: base.lon, radius_m: base.radius_m } : undefined,
          signal_entity_ids: subjectIds,
          venue_kinds: plan.venue_kinds,
          ambience_tag_ids: ambience.tags.length > 0 ? ambience.tags.map((t) => t.id) : undefined,
          require_photo: true,
          price_level_max: price,
          take: 8,
        },
        // Creative choices give way before the director's constraints: the base, venue kinds, then photos, then budget.
        [
          [`widened the search from ${base?.name} to all of ${brief.city}`, { near: undefined }, base !== undefined],
          ["widened to every kind of venue", { venue_kinds: VENUE_KIND_VALUES }, plan.venue_kinds.length < VENUE_KIND_VALUES.length],
          ["allowed places without photos", { require_photo: false }, true],
          ["lifted the price ceiling", { price_level_max: undefined }, price !== undefined],
        ],
      ),
      base ? MIN_BASE_PLACES : 1,
    ),
  ]);
  // The base held when the first rung (near it) was enough, or was all there was.
  const held = base !== undefined && places.items.length > 0 && places.relaxations.length === 0;

  // One step, two searches: what had to give for the series goes into the notes, and its finds into the summary.
  if (series.relaxations.length > 0 && series.items.length > 0) {
    run.notes.push(
      `Series: ${series.firstCount ? `only ${series.firstCount} matched at first` : "nothing matched at first"}, so itsgiving ${series.relaxations.join(", then ")}.`,
    );
  }
  if (series.error) run.notes.push(`${STEP_LABELS.references}: series: ${series.error}`);
  const withSeries = series.items.length > 0 ? `; series: ${names(series.items).slice(0, 3).join(", ")}` : "";
  report(
    run,
    "references",
    "films",
    STEP_LABELS.references,
    "Reference films",
    references,
    (items) => `${names(items).slice(0, 4).join(", ")}${withSeries}`,
  );
  report(run, "wardrobe", "brands", STEP_LABELS.wardrobe, "Wardrobe brands", brands, (items) => names(items).slice(0, 5).join(", "));
  report(
    run,
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
    series,
    brands,
    places,
    base: base ? { area: base, held } : undefined,
  };
}
