import { createHash } from "node:crypto";
import { z } from "zod";
import { normalizeName } from "../tools/shared";
import { BUDGETS, FORMATS, NUDGES, type Budget, type Format } from "./options";

export { BUDGETS, NUDGES, type Budget, type Nudge } from "./options";

const name = z.string().trim().min(1).max(80);

export const briefSchema = z
  .strictObject({
    format: z.enum(Object.keys(FORMATS) as [Format, ...Format[]]).default("music_video"),
    artist: z.string().trim().max(80).optional(),
    touchstones: z.array(name).max(5).default([]),
    city: name,
    budget: z.enum(Object.keys(BUDGETS) as [Budget, ...Budget[]]).default("indie"),
    director_films: z.array(name).max(8).default([]),
    /** Ambiguity-picker answers: pickKey(type, name) -> chosen entity ID. */
    picks: z
      .record(z.string().max(120), z.string().min(1).max(120))
      .default({})
      .refine((picks) => Object.keys(picks).length <= 20, "Too many picks."),
    nudges: z.array(z.enum(NUDGES)).max(NUDGES.length).default([]),
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

/** Drop empty and duplicate entries so equivalent briefs share a cache key. */
export function normalizeBrief(brief: Brief): Brief {
  return {
    ...brief,
    artist: brief.artist?.trim() || undefined,
    touchstones: dedupe(brief.touchstones),
    director_films: dedupe(brief.director_films),
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
    picks: Object.entries(brief.picks).sort(([a], [b]) => a.localeCompare(b)),
    nudges: [...brief.nudges].sort(),
  };
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex").slice(0, 24);
}

/** Effective price ceiling: the budget's, lowered one notch by the "cheaper locations" nudge. */
export function priceLevelMax(brief: Brief): number | undefined {
  const base = BUDGETS[brief.budget].priceLevelMax;
  if (!brief.nudges.includes("cheaper_locations")) return base;
  return Math.max((base ?? 4) - 1, 1);
}
