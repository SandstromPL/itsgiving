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

function joinNames(names: string[]): string {
  return names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** "for Frank Ocean, after Past Lives and Aftersun": who it is for, and what it is after. */
export function subjectPhrase(artists: string[], touchstones: string[]): string {
  return [artists.length > 0 && `for ${joinNames(artists)}`, touchstones.length > 0 && `after ${joinNames(touchstones)}`]
    .filter(Boolean)
    .join(", ");
}

/** Timeline labels, shared so a treatment replayed from cache shows the same steps the server names. */
export const STEP_LABELS: Record<StepId, string> = {
  resolve: "Resolve names in Qloo",
  audience: "Read the audience",
  overlap: "Compare with your taste",
  plan: "Plan the creative direction",
  tags: "Translate style words into Qloo tags",
  references: "Pull reference films",
  wardrobe: "Pick wardrobe brands",
  locations: "Scout locations",
  replan: "Re-plan the style words",
  write: "Write the treatment",
};
