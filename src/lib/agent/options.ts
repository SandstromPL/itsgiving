// Brief options shared by the server and the browser (no Node imports here).

import type { StepId, TreatmentWho } from "./types";

export { excerpt, isIdentityTag } from "../text";

/** Iterate chips: each one re-runs plan and write with a nudge. */
export const NUDGES = ["darker", "more_90s", "deeper_cuts", "cheaper_locations"] as const;
export type Nudge = (typeof NUDGES)[number];

export const NUDGE_LABELS: Record<Nudge, string> = {
  darker: "Darker",
  more_90s: "More 90s",
  deeper_cuts: "Deeper cuts",
  cheaper_locations: "Cheaper locations",
};

export const BUDGETS = {
  shoestring: { label: "Shoestring", priceLevelMax: 2 },
  indie: { label: "Indie", priceLevelMax: 3 },
  premium: { label: "Premium", priceLevelMax: undefined },
} as const;
export type Budget = keyof typeof BUDGETS;

export const FORMATS = { music_video: "Music video", short_film: "Short film" } as const;
export type Format = keyof typeof FORMATS;

/**
 * How long DeepSeek thinks. Deep is the default: blind judges rated its treatments clearly higher.
 * Quick thinks less and saves about 10 s (benchmark, 2026-10-25).
 */
export const THINKING = {
  deep: { label: "Deep", hint: "The strongest treatment, in about 40 s." },
  quick: { label: "Quick", hint: "A little less considered, in about 30 s." },
} as const;
export type Thinking = keyof typeof THINKING;

/** Films a director can import as their taste: taste_overlap compares up to 25 entities a side. */
export const IMPORT_LIMIT = 25;

/** Artists that can stand in for one Qloo doesn't have. */
export const STAND_IN_LIMIT = 3;

/** The answer to "which one did you mean?" when it is none of Qloo's candidates. */
export const NONE_PICK = "none";

/** TMDB's required notice, shown wherever an imported TMDB list appears. */
export const TMDB_NOTICE = "This product uses the TMDB API but is not endorsed or certified by TMDB.";

/** A TMDB image at another of its sizes: covers take w1280, cards w780. */
export function tmdbSize(url: string, size: "w300" | "w780" | "w1280"): string {
  return url.replace(/(image\.tmdb\.org\/t\/p\/)w\d+\//, `$1${size}/`);
}

/**
 * The reference film whose still (TMDB's backdrop) is a treatment's cover: the one the writer chose for it, else the
 * first with a still (treatments built before the writer chose). Never a poster, whose own lettering fights the title;
 * with no still the cover is the palette alone.
 */
export function coverReference<R extends { entity: { id: string }; still?: string }>(t: {
  cover?: string;
  references: R[];
}): R | undefined {
  return t.references.find((r) => r.still && r.entity.id === t.cover) ?? t.references.find((r) => r.still);
}

export function coverStill(t: { cover?: string; references: { entity: { id: string }; still?: string }[] }): string | undefined {
  return coverReference(t)?.still;
}

const SMALL_WORDS = new Set(["a", "an", "and", "as", "at", "by", "for", "in", "of", "on", "or", "the", "to", "with"]);

/**
 * A Qloo tag's name as a chip shows it. Qloo mixes "love", "new york city" and "Quirkily Humorous": an all-lowercase
 * name is put in title case to match, and anything already capitalized (R&B, LGBT, Quirkily Humorous) is left alone.
 */
export function tagLabel(name: string): string {
  if (name !== name.toLowerCase()) return name;
  return name.replace(/[a-z][\w'’-]*/g, (word, at: number) =>
    at > 0 && SMALL_WORDS.has(word) ? word : word[0].toUpperCase() + word.slice(1),
  );
}

/** "A", "A and B", "A, B and C". */
export function joinNames(names: string[]): string {
  return names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/**
 * Who it is for and what it is after. A music video is for its artist: "for Frank Ocean, after Forgotten". A short
 * film is after its films, and an artist only says whose fans it is for: "after Past Lives, for fans of Prateek Kuhad".
 */
export function subjectPhrase(artists: string[], touchstones: string[], format: Format = "music_video"): string {
  const after = touchstones.length > 0 && `after ${joinNames(touchstones)}`;
  if (format === "short_film") return [after, artists.length > 0 && `for fans of ${joinNames(artists)}`].filter(Boolean).join(", ");
  return [artists.length > 0 && `for ${joinNames(artists)}`, after].filter(Boolean).join(", ");
}

/** Who a treatment names, by role; treatments built before it kept names fall back to their subjects' kinds. */
export function treatmentWho(t: { who?: TreatmentWho; subjects: { name: string; kind?: string }[] }): TreatmentWho {
  return (
    t.who ?? {
      artists: t.subjects.filter((s) => s.kind === "artist").map((s) => s.name),
      films: t.subjects.filter((s) => s.kind !== "artist").map((s) => s.name),
      standIns: [],
    }
  );
}

/** Qloo files some musicians only as people (Raftaar, 2026-10-26); either way, their fans are an audience. */
const isMusician = (kind?: string) => kind === "artist" || kind === "person";

/**
 * Whose taste a heatmap shows: "Prateek Kuhad's audience", or "the audience for Frank Ocean and Forgotten (2017)".
 * Films carry their year, since so many titles are shared.
 */
export function audiencePhrase(subjects: { name: string; kind?: string; year?: number }[]): string {
  const artists = subjects.filter((s) => isMusician(s.kind)).map((s) => s.name);
  const others = subjects.filter((s) => !isMusician(s.kind)).map((s) => (s.year ? `${s.name} (${s.year})` : s.name));
  if (artists.length === 1 && others.length === 0) return `${artists[0]}'s audience`;
  const who = [...artists, ...others];
  return who.length > 0 ? `the audience for ${joinNames(who)}` : "this audience";
}

/** The pipeline's steps in the order they run (overlap and re-plan are often skipped). */
export const STEP_ORDER: StepId[] = [
  "resolve",
  "audience",
  "overlap",
  "heatmap",
  "plan",
  "tags",
  "references",
  "wardrobe",
  "locations",
  "replan",
  "write",
];

/** Timeline labels, shared so a treatment replayed from cache shows the same steps the server names. */
export const STEP_LABELS: Record<StepId, string> = {
  resolve: "Find the names in Qloo",
  audience: "Read the audience",
  overlap: "Compare with your taste",
  heatmap: "Map where the fans are",
  plan: "Plan the creative direction",
  tags: "Translate style words into Qloo tags",
  references: "Pull reference films",
  wardrobe: "Pick wardrobe brands",
  locations: "Scout locations",
  replan: "Re-plan the style words",
  write: "Write the treatment",
};
