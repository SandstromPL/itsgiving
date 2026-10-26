// Brief options shared by the server and the browser (no Node imports here).

import type { StepId } from "./types";

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

/** TMDB's required notice, shown wherever an imported TMDB list appears. */
export const TMDB_NOTICE = "This product uses the TMDB API but is not endorsed or certified by TMDB.";

/** "A", "A and B", "A, B and C". */
export function joinNames(names: string[]): string {
  return names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** "for Frank Ocean, after Past Lives and Aftersun": who it is for, and what it is after. */
export function subjectPhrase(artists: string[], touchstones: string[]): string {
  return [artists.length > 0 && `for ${joinNames(artists)}`, touchstones.length > 0 && `after ${joinNames(touchstones)}`]
    .filter(Boolean)
    .join(", ");
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
