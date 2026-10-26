// Brief options shared by the server and the browser (no Node imports here).

import type { StepId, TreatmentWho } from "./types";

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

/**
 * A short excerpt of a longer text: whole sentences when one fits, else whole words and an ellipsis. Never cut
 * mid-word, as a CSS line clamp does ("a quiet dining experi…").
 */
export function excerpt(text: string, max: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const end = clean.lastIndexOf(". ", max - 1);
  if (end > max / 2) return clean.slice(0, end + 1);
  const space = clean.lastIndexOf(" ", max - 1);
  return `${clean.slice(0, space > 0 ? space : max - 1).replace(/[,;:]$/, "")}…`;
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
  resolve: "Resolve names in Qloo",
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
