import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { FORMATS, subjectPhrase } from "./options";
import type { Treatment } from "./types";

// Featured treatments: the examples pre-built by `npm run featured` (scripts/featured.ts), so judges and
// first-time visitors see a finished treatment at once, whatever the live rate limits are doing. They
// hold Qloo data, so they live under .cache/ (gitignored) and are built afresh by each deploy's prebuild.

export const FEATURED_FILE = path.join(".cache", "featured", "featured.json");

export interface FeaturedItem {
  slug: string;
  treatment: Treatment;
}

export interface FeaturedFile {
  generatedAt: string;
  items: FeaturedItem[];
}

/** What the empty board's cover cards need, without shipping whole treatments to the browser. */
export interface FeaturedCover {
  slug: string;
  title: string;
  logline: string;
  /** "Music video for Prateek Kuhad / Mumbai" */
  line: string;
  palette: string[];
  still?: string;
}

let memo: { file: string; mtimeMs: number; items: FeaturedItem[] } | undefined;

function isItem(value: unknown): value is FeaturedItem {
  const item = value as FeaturedItem;
  return typeof item?.slug === "string" && typeof item.treatment?.title === "string" && typeof item.treatment.brief?.city === "string";
}

/**
 * The pre-built treatments, re-read only when the file changes; none when it is missing or unreadable.
 * The reads opt out of Turbopack's tracing (which would otherwise pull in the whole project): the file
 * is added to the server bundle by outputFileTracingIncludes in next.config.ts instead.
 */
export function loadFeatured(file = FEATURED_FILE): FeaturedItem[] {
  try {
    const { mtimeMs } = statSync(/*turbopackIgnore: true*/ file);
    if (memo?.file !== file || memo.mtimeMs !== mtimeMs) {
      const parsed = JSON.parse(readFileSync(/*turbopackIgnore: true*/ file, "utf8")) as Partial<FeaturedFile>;
      memo = { file, mtimeMs, items: Array.isArray(parsed.items) ? parsed.items.filter(isItem) : [] };
    }
    return memo.items;
  } catch {
    return [];
  }
}

export function featuredCovers(items: FeaturedItem[] = loadFeatured()): FeaturedCover[] {
  return items.map(({ slug, treatment: t }) => ({
    slug,
    title: t.title,
    logline: t.logline,
    line: `${FORMATS[t.brief.format]} ${subjectPhrase(
      t.subjects.filter((s) => s.kind === "artist").map((s) => s.name),
      t.subjects.filter((s) => s.kind !== "artist").map((s) => s.name),
    )} / ${t.brief.city}`,
    palette: t.palette.map((c) => c.hex),
    still: t.references.find((r) => r.entity.image && !r.entity.image.startsWith("/mock/"))?.entity.image,
  }));
}
