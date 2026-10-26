import { createHash } from "node:crypto";
import { z } from "zod";
import { normalizeName } from "../tools/shared";
import { BUDGETS, FORMATS, IMPORT_LIMIT, NUDGES, STAND_IN_LIMIT, THINKING, type Budget, type Format, type Thinking } from "./options";

export { BUDGETS, NUDGES, THINKING, type Budget, type Nudge, type Thinking } from "./options";

// No control characters: names go into LLM prompts, and a line break could forge a prompt section.
const noControl = (value: string) => !/\p{Cc}/u.test(value);
const CONTROL_MESSAGE = "Remove line breaks and control characters.";
const name = z.string().trim().min(1).max(80).refine(noControl, CONTROL_MESSAGE);

export const briefSchema = z
  .strictObject({
    format: z.enum(Object.keys(FORMATS) as [Format, ...Format[]]).default("music_video"),
    artist: z.string().trim().max(80).refine(noControl, CONTROL_MESSAGE).optional(),
    /** Artists with a similar audience, read in the artist's place when Qloo doesn't have them (music videos only). */
    stand_ins: z.array(name).max(STAND_IN_LIMIT).default([]),
    touchstones: z.array(name).max(5).default([]),
    city: name,
    budget: z.enum(Object.keys(BUDGETS) as [Budget, ...Budget[]]).default("indie"),
    director_films: z.array(name).max(8).default([]),
    /** The director's taste imported from a TMDB list or IMDb links (src/lib/agent/taste.ts), looked up by IMDb ID. */
    director_imdb_ids: z
      .array(z.string().regex(/^tt\d{7,10}$/, "IMDb IDs look like tt0118694."))
      .max(IMPORT_LIMIT)
      .default([]),
    /** Ambiguity-picker answers: pickKey(type, name) -> chosen entity ID. */
    picks: z
      .record(z.string().max(120), z.string().min(1).max(120))
      .default({})
      .refine((picks) => Object.keys(picks).length <= 20, "Too many picks."),
    nudges: z.array(z.enum(NUDGES)).max(NUDGES.length).default([]),
    thinking: z.enum(Object.keys(THINKING) as [Thinking, ...Thinking[]]).default("deep"),
  })
  .refine((brief) => Boolean(brief.artist?.trim()) || brief.touchstones.length > 0, {
    message: "Give an artist or at least one touchstone film.",
    path: ["artist"],
  });

export type Brief = z.output<typeof briefSchema>;
export type BriefInput = z.input<typeof briefSchema>;

export function pickKey(type: string, input: string): string {
  return `${type}:${normalizeName(input)}`;
}

function dedupe(names: string[]): string[] {
  const seen = new Set<string>();
  return names.filter((n) => {
    const key = normalizeName(n);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Single spaces only, so prompts and cache keys see one canonical spelling. */
const tidy = (value: string) => value.replace(/\s+/g, " ").trim();

/** Drop empty and duplicate entries so equivalent briefs share a cache key. */
export function normalizeBrief(brief: Brief): Brief {
  return {
    ...brief,
    artist: brief.artist ? tidy(brief.artist) || undefined : undefined,
    stand_ins: dedupe((brief.stand_ins ?? []).map(tidy)),
    touchstones: dedupe(brief.touchstones.map(tidy)),
    city: tidy(brief.city),
    director_films: dedupe(brief.director_films.map(tidy)),
    // A set: the list's order doesn't change the taste, so it mustn't change the cache key or the Qloo request.
    director_imdb_ids: [...new Set(brief.director_imdb_ids ?? [])].sort(),
    nudges: NUDGES.filter((n) => brief.nudges.includes(n)),
  };
}

/** Stable cache key for a brief; the run modes are part of it so mock and live never mix. */
export function briefKey(brief: Brief, modes: { qloo: string; llm: string }): string {
  const canonical = {
    v: 1,
    modes,
    format: brief.format,
    artist: brief.artist ? normalizeName(brief.artist) : null,
    touchstones: brief.touchstones.map(normalizeName).sort(),
    city: normalizeName(brief.city),
    budget: brief.budget,
    director: brief.director_films.map(normalizeName).sort(),
    // Only when present, so briefs without an import (and treatments built before it) keep their keys.
    ...(brief.director_imdb_ids?.length ? { imported: [...brief.director_imdb_ids].sort() } : {}),
    // The same for stand-ins, which also don't depend on their order.
    ...(brief.stand_ins?.length ? { stand_ins: brief.stand_ins.map(normalizeName).sort() } : {}),
    picks: Object.entries(brief.picks).sort(([a], [b]) => a.localeCompare(b)),
    nudges: [...brief.nudges].sort(),
    thinking: brief.thinking,
  };
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex").slice(0, 24);
}

/** Effective price ceiling: the budget's, lowered one notch by the "cheaper locations" nudge. */
export function priceLevelMax(brief: Brief): number | undefined {
  const base = BUDGETS[brief.budget].priceLevelMax;
  if (!brief.nudges.includes("cheaper_locations")) return base;
  return Math.max((base ?? 4) - 1, 1);
}
