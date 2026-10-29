// Brief options shared by the server and the browser (no Node imports here).

import type { CompactEntity, CompactPlace, Weekday } from "../qloo";
import { withYear } from "../text";
import type { StepId, TreatmentWho } from "./types";

export { excerpt, isIdentityTag, withYear, withoutIdentity } from "../text";

/** Iterate chips: each one re-runs plan and write with a nudge. */
export const NUDGES = ["darker", "more_90s", "deeper_cuts", "cheaper_locations"] as const;
export type Nudge = (typeof NUDGES)[number];

export const NUDGE_LABELS: Record<Nudge, string> = {
  darker: "Darker",
  more_90s: "More 90s",
  deeper_cuts: "Deeper cuts",
  cheaper_locations: "Cheaper locations",
};

/**
 * What a budget reaches. `brandReferenceFrom`: the US-dollar price a brand's pieces start at from which, on this
 * budget, its look is a reference to rent or match rather than buy. `castCeiling`: the popularity percentile above which
 * a face is out of reach (live, an indie ceiling of 0.9 kept Tripti Dimri and Sayani Gupta and left out Sanya Malhotra).
 */
export const BUDGETS = {
  shoestring: { label: "Shoestring", priceLevelMax: 2, brandReferenceFrom: 75, castCeiling: 0.85 },
  indie: { label: "Indie", priceLevelMax: 3, brandReferenceFrom: 150, castCeiling: 0.9 },
  premium: { label: "Premium", priceLevelMax: undefined, brandReferenceFrom: undefined, castCeiling: undefined },
} as const;
export type Budget = keyof typeof BUDGETS;

const dollars = (value: number) => `$${value.toLocaleString("en-US")}`;

/** A brand's price range from Qloo: "$20–150", "from $300" or "up to $90". */
export function priceLine(price?: { min?: number; max?: number }): string | undefined {
  const { min, max } = price ?? {};
  if (min !== undefined && max !== undefined) return min === max ? dollars(min) : `${dollars(min)}–${max.toLocaleString("en-US")}`;
  if (min !== undefined) return `from ${dollars(min)}`;
  return max !== undefined ? `up to ${dollars(max)}` : undefined;
}

/** "an indie budget", "a shoestring budget". */
export function budgetPhrase(budget: Budget): string {
  const label = BUDGETS[budget].label.toLowerCase();
  return `${/^[aeiou]/.test(label) ? "an" : "a"} ${label} budget`;
}

/** True when a brand's pieces start above what the budget buys (BUDGETS.brandReferenceFrom). */
export function aboveBudget(brand: Pick<CompactEntity, "brand">, budget: Budget): boolean {
  const from = BUDGETS[budget].brandReferenceFrom;
  const min = brand.brand?.price?.min;
  return from !== undefined && min !== undefined && min >= from;
}

const DAY_NAMES: Record<Weekday, string> = {
  monday: "Mon",
  tuesday: "Tue",
  wednesday: "Wed",
  thursday: "Thu",
  friday: "Fri",
  saturday: "Sat",
  sunday: "Sun",
};
const WEEK = Object.keys(DAY_NAMES) as Weekday[];

/**
 * A place's week in one line, to read after "Open": days with the same hours run together ("Tue–Sun 12:00–15:30; closed
 * Mon", "daily 09:00–23:00", "24 hours, every day"). Days Qloo doesn't list are left out, and a week listed as closed
 * every day reads as unknown: live, those were places still trading.
 */
export function openingLine(hours?: CompactPlace["hours"]): string | undefined {
  if (!hours) return undefined;
  const runs: { from: Weekday; to: Weekday; value: string }[] = [];
  for (const day of WEEK) {
    // Hours kept before 2026-10-28 say "00:00–00:00" for open round the clock.
    const value = hours[day]?.replace(/^(\d\d:\d\d)–\1$/, "24 hours");
    const last = runs.at(-1);
    if (value === undefined) continue;
    if (last && last.value === value && WEEK.indexOf(day) === WEEK.indexOf(last.to) + 1) last.to = day;
    else runs.push({ from: day, to: day, value });
  }
  if (runs.length === 0 || runs.every((r) => r.value === "closed")) return undefined;
  if (runs.length === 1 && runs[0].from === "monday" && runs[0].to === "sunday") {
    return runs[0].value === "24 hours" ? "24 hours, every day" : `daily ${runs[0].value}`;
  }
  const days = ({ from, to }: { from: Weekday; to: Weekday }) => (from === to ? DAY_NAMES[from] : `${DAY_NAMES[from]}–${DAY_NAMES[to]}`);
  const open = runs.filter((r) => r.value !== "closed").map((r) => `${days(r)} ${r.value}`);
  const closed = runs.filter((r) => r.value === "closed").map(days);
  return [...open, ...(closed.length > 0 ? [`closed ${closed.join(", ")}`] : [])].join("; ");
}

/** A website as its readable name: "https://www.thalassa.in/menu" -> "thalassa.in". */
export function siteName(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export const FORMATS = { music_video: "Music video", short_film: "Short film" } as const;
export type Format = keyof typeof FORMATS;

/**
 * How long DeepSeek thinks. Deep is the default: blind judges rated its treatments clearly higher.
 * Quick thinks less and is faster: since the characters, a deep build takes 45-65 s and a quick one about 43 s
 * (live, 2026-10-29).
 */
export const THINKING = {
  deep: { label: "Deep", hint: "The strongest treatment, in about a minute." },
  quick: { label: "Quick", hint: "A little less considered, in about 40 s." },
} as const;
export type Thinking = keyof typeof THINKING;

/** Films a director can import as their taste: taste_overlap compares up to 25 entities a side. */
export const IMPORT_LIMIT = 25;

/** Artists that can stand in for one Qloo doesn't have. */
export const STAND_IN_LIMIT = 3;

/** The brief's other limits, shared by the server's schema (brief.ts) and the form, so the form catches what the server would refuse. */
export const BRIEF_LIMITS = { touchstones: 5, directorFilms: 8, name: 80 } as const;

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

/** A treatment's subject line from the names it kept: "for Prateek Kuhad", or "after Past Lives, for fans of …". */
export function treatmentSubject(t: Parameters<typeof treatmentWho>[0] & { brief: { format: Format } }): string {
  const who = treatmentWho(t);
  return subjectPhrase(who.artists, who.films, t.brief.format);
}

/** Qloo files some musicians only as people (Raftaar, 2026-10-26); either way, their fans are an audience. */
const isMusician = (kind?: string) => kind === "artist" || kind === "person";

/**
 * Whose taste a heatmap shows: "Prateek Kuhad's audience", or "the audience for Frank Ocean and Forgotten (2017)".
 * Films carry their year, since so many titles are shared.
 */
export function audiencePhrase(subjects: { name: string; kind?: string; year?: number }[]): string {
  const artists = subjects.filter((s) => isMusician(s.kind)).map((s) => s.name);
  const others = subjects.filter((s) => !isMusician(s.kind)).map((s) => withYear(s.name, s.year));
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
  "casting",
  "music",
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
  casting: "Find casting references",
  music: "Find the music they play",
  plan: "Plan the creative direction",
  tags: "Translate style words into Qloo tags",
  references: "Pull reference films and series",
  wardrobe: "Pick wardrobe brands",
  locations: "Scout locations",
  replan: "Re-plan the style words",
  write: "Write the treatment",
};
