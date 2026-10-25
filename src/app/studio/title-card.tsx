"use client";

import { useId, type CSSProperties } from "react";
import type { Treatment } from "@/lib/agent/types";
import { useLingo } from "./lingo";

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

/**
 * The face to start with, and the evidence for it: Mumbai gets its own railway's lettering (the base comes from
 * Qloo's heatmap); elsewhere the first tone tag that points at a face, else the house style.
 */
export function suggestTitleFont(t: Treatment): { id: string; why: string } {
  const source = t.mock.qloo ? "The mock" : "Qloo";
  if (/\b(mumbai|bombay)\b/i.test(t.brief.city)) {
    const base = t.base?.areas.find((a) => a.ref === t.base?.chosen);
    return {
      id: "mumbai",
      why: base ? `${source}'s heatmap based the shoot in ${base.name}, Mumbai` : "The shoot is in Mumbai",
    };
  }
  const tags = [...t.tone.map((tone) => tone.tag.name), ...t.audience.taste_tags.map((tag) => tag.name)];
  for (const tag of tags) {
    const hit = BY_TAG.find(([pattern]) => pattern.test(tag));
    if (hit) return { id: hit[1], why: `${source} tags this audience "${tag}"` };
  }
  return { id: "house", why: "No tone tag points at a film look, so it keeps the house style" };
}

/** The cover's "Title card" button and the window it opens: pick a face, see the cover change behind it. */
export function TitleCardPicker({
  title,
  fontId,
  suggestion,
  onPick,
}: {
  title: string;
  fontId: string;
  suggestion: { id: string; why: string };
  onPick: (id: string) => void;
}) {
  const id = useId();
  const { t: lines, unc } = useLingo();
  const current = titleFont(fontId);
  const suggested = titleFont(suggestion.id);
  const label = (f: TitleFont) => (unc ? f.plain : f.name);
  return (
    <>
      <button
        type="button"
        popoverTarget={id}
        className="inline-flex min-h-11 items-center gap-2 rounded-full bg-accent px-4 py-2 text-sm font-bold text-[#121211] print:hidden"
      >
        <svg
          aria-hidden
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
        >
          <path d="M4 7V4h16v3M9 20h6M12 4v16" />
        </svg>
        Title card: {label(current)}
      </button>
      <div id={id} popover="auto" className="window" role="dialog" aria-labelledby={`${id}-title`}>
        <div className="flex items-center justify-between gap-3 border-b-2 border-[#121211] bg-[#f7f5f0] py-1 pr-1 pl-4">
          <span aria-hidden className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-full border-2 border-[#121211]" />
            <span className="size-2.5 rounded-full border-2 border-[#121211]" />
            <span className="size-2.5 rounded-full border-2 border-[#121211] bg-[#121211]" />
          </span>
          <span className="font-mono text-[13px] text-[#2b2925]">title card</span>
          <button
            type="button"
            popoverTarget={id}
            popoverTargetAction="hide"
            aria-label="Close"
            className="grid size-11 place-items-center rounded-xl text-[#121211] hover:bg-[#eeebe4]"
          >
            <svg
              aria-hidden
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.4"
              strokeLinecap="round"
            >
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>
        <div className="flex flex-col gap-3 px-5 pt-5">
          <h2 id={`${id}-title`} className="type-head text-[2.1rem] leading-none text-[#121211]">
            {lines.titleWindow}
          </h2>
          <p className="text-[15px] leading-6 text-[#4a4741]">Sets the title in a cinematic face. It carries into the PDF.</p>
          <div className="rounded-xl border border-dashed border-[#c9c1af] bg-[#fffdf6] px-3 py-2.5 font-mono text-[12.5px] leading-[1.6] text-[#2b2925]">
            <p className="font-semibold">why {label(suggested)} is suggested</p>
            <p>{suggestion.why}</p>
          </div>
        </div>
        <fieldset className="flex flex-col gap-2 px-5 py-4">
          <legend className="sr-only">Title typeface</legend>
          {TITLE_FONTS.map((f) => (
            <label
              key={f.id}
              className="flex min-h-16 cursor-pointer items-center justify-between gap-3 rounded-2xl border-2 border-[#e5e0d5] bg-white px-3.5 py-2.5 text-[#121211] hover:border-[#8c867b] has-checked:border-[#121211] has-checked:bg-accent has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-[#121211]"
            >
              <input
                type="radio"
                name={`${id}-font`}
                value={f.id}
                checked={f.id === fontId}
                onChange={() => onPick(f.id)}
                autoFocus={f.id === fontId}
                className="sr-only"
              />
              <span className="flex min-w-0 flex-col gap-1">
                <span className="truncate" style={{ ...f.style, fontSize: `max(15px, calc(1.5rem * ${f.scale}))`, lineHeight: 1.15 }}>
                  {title}
                </span>
                <span className="text-[13px] text-[#4a4741]">
                  <span className="font-bold text-[#121211]">{label(f)}</span>, {f.evokes}
                </span>
              </span>
              {f.id === suggestion.id && (
                <span className="shrink-0 rounded-full border-[1.5px] border-[#121211] bg-white px-2.5 py-1 text-xs font-bold">
                  suggested
                </span>
              )}
            </label>
          ))}
        </fieldset>
        <div className="flex justify-end border-t border-[#dad5ca] px-5 pt-3.5 pb-5">
          <button
            type="button"
            popoverTarget={id}
            popoverTargetAction="hide"
            className="rounded-full bg-[#121211] px-5 py-3 text-[15px] font-bold text-white"
          >
            Done
          </button>
        </div>
      </div>
    </>
  );
}
