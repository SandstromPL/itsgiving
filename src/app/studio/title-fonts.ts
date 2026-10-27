import type { CSSProperties } from "react";
import type { Treatment } from "@/lib/agent/types";

// The title card's faces and how one is suggested: plain data and functions, shared by the cover's picker, the
// homepage (built on the server) and its "How it works", so none needs another's component code.

/**
 * Cinematic faces for a treatment's title card, each a free Google font standing in for a film look (see
 * research/world-cinema-eras.md). `scale` keeps wide faces inside the cover; the window previews the real title.
 */
export interface TitleFont {
  id: string;
  name: string;
  /** The name in unc mode. */
  plain: string;
  evokes: string;
  style: CSSProperties;
  scale: number;
  /** Neon glows on the dark cover. */
  glow?: boolean;
  /** Painted letters cast a hard shadow. */
  painted?: boolean;
}

export const TITLE_FONTS: TitleFont[] = [
  {
    id: "house",
    name: "house style",
    plain: "House style",
    evokes: "itsgiving's own",
    style: { fontFamily: "var(--font-bricolage), system-ui, sans-serif", fontWeight: 800, letterSpacing: "-0.055em", lineHeight: 0.9 },
    scale: 1,
  },
  {
    id: "mumbai",
    name: "Mumbai local",
    plain: "Hand-painted (Mumbai)",
    evokes: "hand-painted railway signs",
    style: { fontFamily: "var(--font-tc-yatra), serif", fontWeight: 400, lineHeight: 1.05 },
    scale: 0.92,
    painted: true,
  },
  {
    id: "symmetry",
    name: "symmetry era",
    plain: "Geometric (Futura style)",
    evokes: "Wes Anderson's Futura",
    style: {
      fontFamily: "var(--font-tc-jost), sans-serif",
      fontWeight: 600,
      letterSpacing: "0.06em",
      textTransform: "uppercase",
      lineHeight: 1,
    },
    scale: 0.66,
  },
  {
    id: "oscar",
    name: "Oscar bait",
    plain: "Roman capitals (Trajan style)",
    evokes: "the Trajan poster meme",
    style: {
      fontFamily: "var(--font-tc-cinzel), serif",
      fontWeight: 600,
      letterSpacing: "0.08em",
      textTransform: "uppercase",
      lineHeight: 1.05,
    },
    scale: 0.62,
  },
  {
    id: "screenplay",
    name: "screenplay",
    plain: "Screenplay",
    evokes: "a spec script page",
    style: { fontFamily: "var(--font-tc-courier), monospace", fontWeight: 700, textTransform: "uppercase", lineHeight: 1.05 },
    scale: 0.6,
  },
  {
    id: "neon",
    name: "neon noir",
    plain: "Neon",
    evokes: "night-city neon",
    style: { fontFamily: "var(--font-tc-tilt), sans-serif", fontWeight: 400, letterSpacing: "0.01em", lineHeight: 0.98 },
    scale: 0.88,
    glow: true,
  },
  {
    id: "soft",
    name: "70s soft",
    plain: "1970s soft serif",
    evokes: "Cooper Black covers",
    style: {
      fontFamily: "var(--font-tc-fraunces), serif",
      fontWeight: 900,
      fontVariationSettings: "'SOFT' 100, 'WONK' 1",
      letterSpacing: "-0.03em",
      lineHeight: 0.92,
    },
    scale: 0.92,
  },
  {
    id: "fashion",
    name: "fashion film",
    plain: "Didone (Bodoni)",
    evokes: "Vogue-style Bodoni",
    style: { fontFamily: "var(--font-tc-bodoni), serif", fontWeight: 700, fontStyle: "italic", letterSpacing: "-0.02em", lineHeight: 0.92 },
    scale: 0.96,
  },
  {
    id: "y2k",
    name: "Y2K future",
    plain: "Wide futurist (Eurostile style)",
    evokes: "Eurostile chrome",
    style: {
      fontFamily: "var(--font-tc-michroma), sans-serif",
      fontWeight: 400,
      letterSpacing: "0.02em",
      textTransform: "uppercase",
      lineHeight: 1.12,
    },
    scale: 0.5,
  },
  {
    id: "marquee",
    name: "marquee",
    plain: "Art Deco marquee",
    evokes: "a 1950s picture palace",
    style: { fontFamily: "var(--font-tc-limelight), serif", fontWeight: 400, letterSpacing: "0.02em", lineHeight: 1.02 },
    scale: 0.8,
  },
];

export const titleFont = (id: string) => TITLE_FONTS.find((f) => f.id === id) ?? TITLE_FONTS[0];

/** The cover title's style in a face, at a base size that the face's scale shrinks for wide letters. */
export function titleStyle(font: TitleFont, size = "clamp(3.25rem, 7.4vw, 7.75rem)"): CSSProperties {
  return {
    ...font.style,
    fontSize: `calc(${size} * ${font.scale})`,
    textShadow: font.glow
      ? "0 0 6px #8cffc0, 0 0 18px #2bd47d, 0 0 36px #138a55"
      : font.painted
        ? "0.04em 0.05em 0 rgb(0 0 0 / 0.55)"
        : undefined,
  };
}

/** Tone words that point at a face, checked in the order Qloo ranked the tags. */
const BY_TAG: [RegExp, string][] = [
  [/neon|noir|nocturn|night|after dark/i, "neon"],
  [/nostalg|retro|vintage|seventies|70s|groovy/i, "soft"],
  [/chic|fashion|glam|elegan|luxur|stylish|couture/i, "fashion"],
  [/whimsic|quirk|symmetr|deadpan|pastel|twee/i, "symmetry"],
  [/epic|grand|historic|period|sweeping|majestic/i, "oscar"],
  [/futur|sci-?fi|science fiction|cyber|space age|y2k/i, "y2k"],
  [/intimate|introspect|minimal|observ|realis|naturalis|understated/i, "screenplay"],
];

/** What a suggestion reads: the city, the base Qloo's heatmap chose, and the tone and taste tags in Qloo's order. */
export interface TitleFontEvidence {
  mock: boolean;
  city: string;
  base?: string;
  tags: string[];
}

/**
 * The face to start with, and the evidence for it: Mumbai gets its own railway's lettering (the base comes from
 * Qloo's heatmap); elsewhere the first tone tag that points at a face, else the house style.
 */
export function suggestTitleFontFrom(evidence: TitleFontEvidence): { id: string; why: string } {
  const source = evidence.mock ? "The mock" : "Qloo";
  if (/\b(mumbai|bombay)\b/i.test(evidence.city)) {
    return {
      id: "mumbai",
      why: evidence.base ? `${source}'s heatmap based the shoot in ${evidence.base}, Mumbai` : "The shoot is in Mumbai",
    };
  }
  for (const tag of evidence.tags) {
    const hit = BY_TAG.find(([pattern]) => pattern.test(tag));
    if (hit) return { id: hit[1], why: `${source} tags this audience "${tag}"` };
  }
  return { id: "house", why: "No tone tag points at a film look, so it keeps the house style" };
}

export function suggestTitleFont(t: Treatment): { id: string; why: string } {
  return suggestTitleFontFrom({
    mock: t.mock.qloo,
    city: t.brief.city,
    base: t.base?.areas.find((a) => a.ref === t.base?.chosen)?.name,
    tags: [...t.tone.map((tone) => tone.tag.name), ...t.audience.taste_tags.map((tag) => tag.name)],
  });
}
