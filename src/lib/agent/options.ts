// Brief options shared by the server and the browser (no Node imports here).

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

function joinNames(names: string[]): string {
  return names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** "for Frank Ocean, after Past Lives and Aftersun": who it is for, and what it is after. */
export function subjectPhrase(artists: string[], touchstones: string[]): string {
  return [artists.length > 0 && `for ${joinNames(artists)}`, touchstones.length > 0 && `after ${joinNames(touchstones)}`]
    .filter(Boolean)
    .join(", ");
}
