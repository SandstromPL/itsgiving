import { EXAMPLES } from "@/lib/agent/examples";
import { featuredCovers, featuredItem, featuredOffered, featuredRun, loadFeatured, type FeaturedRun } from "@/lib/agent/featured";
import { FORMATS, tagLabel, treatmentSubject, withoutIdentity, type Format } from "@/lib/agent/options";
import { suggestTitleFont } from "../studio/title-fonts";

// What the homepage and /examples show of the featured treatments, worked out once at build: both pages are static.
// Only treatments whose own page opens are offered (featuredItem), and only what a card needs reaches the browser.

/** One featured treatment, as a frame on the flatbed and a card on /examples. */
export interface ShowFrame {
  slug: string;
  title: string;
  logline: string;
  /** "Music video for Prateek Kuhad, Mumbai" */
  meta: string;
  format: Format;
  still?: string;
  palette: string[];
  /** The title card's face, as the board suggests it. */
  fontId: string;
  /** The first three tone tags, the ones shared with the director's films marked. */
  tones: { name: string; shared: boolean }[];
}

export interface ShowData {
  /** The server has its keys: no frames then means the build made none, not that it couldn't. */
  live: boolean;
  frames: ShowFrame[];
  run?: FeaturedRun;
  /** Who wrote every featured treatment, when it was one model: "DeepSeek". */
  writer?: string;
}

export function showData(): ShowData {
  const live = featuredOffered();
  const all = live ? loadFeatured() : [];
  const items = EXAMPLES.filter((example) => example.featured).flatMap((example) => featuredItem(example.slug, all) ?? []);
  const covers = featuredCovers(items);
  const frames = items.map(({ slug, treatment: t }, i): ShowFrame => ({
    slug,
    title: t.title,
    logline: t.logline,
    meta: `${FORMATS[t.brief.format]} ${treatmentSubject(t)}, ${t.brief.city}`,
    format: t.brief.format,
    still: covers[i]?.still,
    palette: covers[i]?.palette ?? [],
    fontId: suggestTitleFont(t).id,
    tones: withoutIdentity(t.tone, (tone) => tone.tag.name)
      .slice(0, 3)
      .map((tone) => ({ name: tagLabel(tone.tag.name), shared: tone.source === "overlap" })),
  }));
  const models = new Set(items.map(({ treatment: t }) => t.writtenBy.model.split("-")[0]));
  const writer = models.size === 1 && models.has("deepseek") ? "DeepSeek" : undefined;
  return { live, frames, run: featuredRun(items), writer };
}
