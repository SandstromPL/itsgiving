import type { CompactTag } from "../qloo";
import type { HeatArea, HeatGrid } from "../tools/heatmap";
import { normalizeName } from "../tools/shared";
import type { RankedTag } from "../tools/taste";
import { STEP_LABELS, withoutIdentity } from "./options";
import type { Cast } from "./pipeline-resolve";
import { toCredit, uniqueBy, type Run } from "./pipeline-run";
import type { ToneCandidate } from "./plan";
import type { BaseArea } from "./types";

// The run's second step: three Qloo reads at once, each a step of its own. The audience, where it meets the director's
// own taste, and where in the city it is; the tags the first two find are the tones the plan may choose from.

const MAX_TONE_CANDIDATES = 16;
/** How far a shoot base reaches: places within it are a short unit move apart. */
const BASE_RADIUS_M = 2_000;

/** What the pipeline reads from read_audience. */
interface AudienceRead {
  taste_tags: CompactTag[];
  demographics: { entity_id: string; leans: string }[];
  film_subgenres: RankedTag[];
}

/** What the three reads found, as the plan, the writer and the board use it. */
export interface Audience {
  tasteTags: CompactTag[];
  subgenres: RankedTag[];
  leans: string[];
  /** The traits the audience shares with the director's films. */
  overlap: CompactTag[];
  /** Where in the city the audience over-indexes, strongest first, each with the ref the planner picks it by. */
  areas: BaseArea[];
  heatMap?: HeatGrid;
  candidates: ToneCandidate[];
}

export async function readAudience(run: Run, cast: Cast): Promise<Audience> {
  const { brief, notes, emit, tool, begin } = run;
  const { subjects, director, subjectIds, directorIds, entityNames, cityId } = cast;
  const endAudience = begin("audience", STEP_LABELS.audience);
  const endOverlap = director.length > 0 ? begin("overlap", STEP_LABELS.overlap) : undefined;
  const endHeatmap = begin("heatmap", STEP_LABELS.heatmap);
  const [audience, shared, heat] = await Promise.all([
    tool<AudienceRead>("audience", "read_audience", {
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
  const tasteTags = withoutIdentity(audience.data?.taste_tags ?? []);
  const subgenres = withoutIdentity(audience.data?.film_subgenres ?? []);
  const leans = (audience.data?.demographics ?? []).map((d) =>
    subjects.length > 1 ? `${entityNames.get(d.entity_id) ?? "audience"}: ${d.leans}` : d.leans,
  );
  if (audience.status === "error") notes.push(`The audience read failed (${audience.summary}).`);
  for (const warning of audience.warnings) notes.push(warning);
  endAudience(audience.status === "ok" ? "done" : "warning", audience.summary, { credit: toCredit("audience", tasteTags) });

  let overlap: CompactTag[] = [];
  if (endOverlap && shared) {
    overlap = withoutIdentity(shared.data?.shared_traits ?? []);
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

  return { tasteTags, subgenres, leans, overlap, areas, heatMap, candidates: toneCandidates(overlap, tasteTags) };
}

/** The tones the plan may choose from, as refs T1, T2…: up to six traits shared with the director's films, then the audience's. */
export function toneCandidates(overlap: CompactTag[], tasteTags: CompactTag[]): ToneCandidate[] {
  return uniqueBy(
    [
      ...overlap.slice(0, 6).map((tag) => ({ tag, source: "overlap" as const })),
      ...tasteTags.map((tag) => ({ tag, source: "audience" as const })),
    ].filter((c) => c.tag.id.startsWith("urn:tag:")),
    (c) => normalizeName(c.tag.name),
  )
    .slice(0, MAX_TONE_CANDIDATES)
    .map((c, i) => ({ ...c, ref: `T${i + 1}` }));
}
