import type { CSSProperties } from "react";
import type { Treatment } from "@/lib/agent/types";
import { withoutIdentity } from "@/lib/text";
import type { RankedTag } from "@/lib/tools/taste";

// Era looks for a treatment's cover: one film tradition's craft worn over the house look, never in place of it (see
// research/world-cinema-eras.md). An era sets the title's face and colour, a texture over the still, the receipts'
// shape, two stickers, a credit line and one moment when it's picked; the layout, the reader's theme, Qloo's evidence
// and the treatment's words stay as they are. Plain data and functions, like title-fonts.ts: era-layer.tsx draws an era
// on the cover, and the title-card window offers them.

export type EraId = "bombay75" | "paris60" | "hongkong94" | "hollywood54";

/** Words in both registers: Gen Z, and plain for unc mode (lingo.tsx). */
interface Said {
  genz: string;
  unc: string;
}

export interface Era {
  id: EraId;
  /** A place and a year: "Bombay '75". */
  name: string;
  /** The tradition in plain words, for unc mode. */
  plain: string;
  /** The tradition the look borrows from, credited on the cover. */
  credit: string;
  /** What the window says it brings, in a few words. */
  evokes: string;
  /** The title face it starts with (title-fonts.ts). Picking the era picks it, and the director can change it after. */
  font: string;
  /**
   * Our own colours, on the cover only: the title's (AA over the cover's scrim, even on a white still), one the texture
   * tints with, and each sticker's ground and ink. eras.test.ts checks every pair.
   */
  colors: { title: string; tint: string; stickers: [Ink, Ink] };
  stickers: [Said, Said];
  /** Qloo's film subgenres that suggest it, each seen on live Qloo (2026-10-27). */
  tags: string[];
}

interface Ink {
  ground: string;
  ink: string;
}

const subgenre = (value: string) => `urn:tag:subgenre:qloo:${value}`;

export const ERAS: Era[] = [
  {
    id: "bombay75",
    name: "Bombay '75",
    plain: "Hindi popular cinema, 1970s",
    credit: "Look inspired by the hand-painted Hindi film posters of 1970s Bombay.",
    evokes: "hand-painted posters, the triple zoom",
    font: "mumbai",
    colors: {
      title: "#FFE7A3",
      tint: "#0F7C78",
      stickers: [
        { ground: "#C2185B", ink: "#FFE7A3" },
        { ground: "#F7A81B", ink: "#2A0E05" },
      ],
    },
    stickers: [
      { genz: "hero entry", unc: "Hero's entrance" },
      { genz: "it's giving masala", unc: "Masala film" },
    ],
    tags: [subgenre("bollywood")],
  },
  {
    id: "paris60",
    name: "Paris '60",
    plain: "French New Wave, about 1960",
    credit: "Look inspired by the intertitles and jump cuts of the French New Wave, Paris, around 1960.",
    evokes: "black and white, intertitles in three colours",
    font: "symmetry",
    colors: {
      title: "#F7F5EF",
      tint: "#0A0908",
      stickers: [
        { ground: "#0A0908", ink: "#FF4136" },
        { ground: "#0A0908", ink: "#6E8BFF" },
      ],
    },
    stickers: [
      { genz: "jump cut core", unc: "Jump cuts" },
      { genz: "in my new wave era", unc: "French New Wave" },
    ],
    tags: [subgenre("french_new_wave"), subgenre("french_new_wave_influenced"), subgenre("french_new_wave_influence")],
  },
  {
    id: "hongkong94",
    name: "Hong Kong '94",
    plain: "Hong Kong cinema, 1990s",
    credit: "Look inspired by the neon, step-printed nights of 1990s Hong Kong cinema.",
    evokes: "neon gels, step-printed motion",
    font: "neon",
    colors: {
      title: "#C9FFDA",
      tint: "#2BE38B",
      stickers: [
        { ground: "#FFB21E", ink: "#0B1A14" },
        { ground: "#0B1A14", ink: "#C9FFDA" },
      ],
    },
    stickers: [
      { genz: "yearning", unc: "Longing" },
      { genz: "expires: may 1", unc: "Best before May 1" },
    ],
    tags: [subgenre("hong_kong_new_wave"), subgenre("hong_kong_cinema")],
  },
  {
    id: "hollywood54",
    name: "Hollywood '54",
    plain: "Hollywood musical, 1950s",
    credit: "Look inspired by the three-strip colour musicals and Art Deco picture palaces of 1950s Hollywood.",
    evokes: "three-strip colour, a marquee face, the curtain",
    font: "marquee",
    colors: {
      title: "#FFF1C9",
      tint: "#FFD45A",
      stickers: [
        { ground: "#C8102E", ink: "#FFF1C9" },
        { ground: "#0B6E4F", ink: "#FFF1C9" },
      ],
    },
    stickers: [
      { genz: "main character", unc: "The lead" },
      { genz: "yearning in three-strip", unc: "Three-strip colour" },
    ],
    tags: [
      subgenre("hollywood_musical"),
      subgenre("classic_hollywood_musical"),
      subgenre("golden_age_hollywood_musical"),
      subgenre("technicolor_musical"),
    ],
  },
];

export const eraOf = (id: EraId): Era => ERAS.find((e) => e.id === id) ?? ERAS[0];

export const isEraId = (id: string): id is EraId => ERAS.some((e) => e.id === id);

/** The era's name in the reader's register. */
export const eraName = (era: Era, unc: boolean) => (unc ? era.plain : era.name);

/** The colours the era's CSS reads (eras.css), set on the board that wears it. None of them is a theme colour. */
export function eraStyle(era: Era | null): CSSProperties | undefined {
  if (!era) return undefined;
  return {
    "--era-title": era.colors.title,
    "--era-tint": era.colors.tint,
    "--era-a": era.colors.stickers[0].ground,
    "--era-b": era.colors.stickers[1].ground,
  } as CSSProperties;
}

export interface EraSuggestion {
  era: Era;
  /** The Qloo subgenre that points to it, with its place in Qloo's list. */
  tag: RankedTag;
  why: string;
}

/**
 * The era a treatment's audience points to, with Qloo's evidence: the best-ranked film subgenre that one of the eras
 * borrows from. None when no tradition is among them, or the treatment predates the read. A tag that says who people
 * are never suggests one, even if it were listed.
 */
export function suggestEraFrom(subgenres: RankedTag[] | undefined, mock: boolean): EraSuggestion | undefined {
  for (const tag of withoutIdentity(subgenres ?? [])) {
    const era = ERAS.find((e) => e.tags.includes(tag.id));
    if (!era) continue;
    const affinity = typeof tag.affinity === "number" ? ` (affinity ${tag.affinity.toFixed(3)})` : "";
    return {
      era,
      tag,
      why: `${mock ? "The mock" : "Qloo"} ranks ${tag.name} ${tag.rank} of ${tag.of} film subgenres for this audience${affinity}`,
    };
  }
  return undefined;
}

export const suggestEra = (t: Treatment) => suggestEraFrom(t.audience.subgenres, t.mock.qloo);

/** The window's words for eras, in both registers. */
export const ERA_LINES = {
  genz: { legend: "era (a film tradition's look)", none: "no era", noneEvokes: "the house look", suggested: "suggested" },
  unc: { legend: "Film look", none: "None", noneEvokes: "itsgiving's own look", suggested: "suggested" },
} as const;

/** Why no era is suggested, when Qloo's subgenres were read and none of the eras' traditions is among them. */
export function noEraLine(t: Treatment): string | undefined {
  const read = t.audience.subgenres;
  if (!read || read.length === 0 || suggestEra(t)) return undefined;
  return `None of these traditions is among the ${read[0].of} film subgenres ${t.mock.qloo ? "the mock" : "Qloo"} ranks highest for this audience, so none is suggested.`;
}
