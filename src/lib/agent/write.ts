import { z } from "zod";
import type { CompactEntity } from "../qloo";
import type { Brief } from "./brief";
import { subjectPhrase } from "./options";
import { describeBrief, vibeOf, type ToneCandidate, type Vibe } from "./plan";

// The writing LLM call. Every Qloo item is listed under a short ref (R1, B1,
// L1, T1) and the schema's enums accept only those refs, so a citation can
// only point at something a tool actually returned.

export interface Ref<T> {
  ref: string;
  item: T;
}

export interface WriteContext {
  brief: Brief;
  artistNames: string[];
  touchstoneNames: string[];
  directorNames: string[];
  direction: string;
  tone: ToneCandidate[];
  references: Ref<CompactEntity>[];
  brands: Ref<CompactEntity>[];
  places: Ref<CompactEntity>[];
  leans: string[];
  /** Entity ID -> name, to show which input drove a pick. */
  names: Map<string, string>;
}

export interface Draft {
  title: string;
  logline: string;
  concept: string;
  tone?: { ref: string; note: string }[];
  beats: { title: string; description: string; reference?: string | null }[];
  references?: { ref: string; why: string; borrow: string }[];
  wardrobe?: { ref: string; look: string }[];
  locations?: { ref: string; scene: string }[];
  palette: { name: string; hex: string }[];
  lighting: string[];
  shots: string[];
}

const text = z.string().min(1);
const refEnum = (refs: Ref<unknown>[] | ToneCandidate[]) => z.enum(refs.map((r) => r.ref) as [string, ...string[]]);

export function writeSchema(ctx: WriteContext): z.ZodType<Draft> {
  const { tone, references, brands, places } = ctx;
  return z.strictObject({
    title: text.describe("2-6 words."),
    logline: text.describe("One sentence."),
    concept: text.describe("80-140 words, present tense."),
    ...(tone.length > 0
      ? { tone: z.array(z.strictObject({ ref: refEnum(tone), note: text })).min(1).max(5).describe("How each tone tag shows up on screen.") }
      : {}),
    beats: z
      .array(
        z.strictObject({
          title: text.describe("2-4 words."),
          description: text.describe("1-2 sentences."),
          ...(references.length > 0 ? { reference: refEnum(references).nullable() } : {}),
        }),
      )
      .min(3)
      .max(6),
    ...(references.length > 0
      ? {
          references: z
            .array(z.strictObject({ ref: refEnum(references), why: text, borrow: text.describe("What to borrow: palette, framing, movement or texture.") }))
            .min(Math.min(2, references.length))
            .max(6),
        }
      : {}),
    ...(brands.length > 0
      ? { wardrobe: z.array(z.strictObject({ ref: refEnum(brands), look: text.describe("Garments, fabrics, colours.") })).min(1).max(4) }
      : {}),
    ...(places.length > 0
      ? { locations: z.array(z.strictObject({ ref: refEnum(places), scene: text.describe("What happens there.") })).min(1).max(4) }
      : {}),
    palette: z
      .array(z.strictObject({ name: text, hex: z.string().regex(/^#[0-9A-Fa-f]{6}$/).describe("#RRGGBB") }))
      .min(3)
      .max(6),
    lighting: z.array(text).min(2).max(4),
    shots: z.array(text).min(3).max(6),
  }) as unknown as z.ZodType<Draft>;
}

function entityLine({ ref, item }: Ref<CompactEntity>, ctx: WriteContext): string {
  const bits = [`${ref} ${item.name}${item.year ? ` (${item.year})` : ""}`];
  if (item.place) {
    if (item.place.neighborhood) bits[0] += `, ${item.place.neighborhood}`;
    if (item.place.price_level) bits.push(`price ${item.place.price_level}/4`);
  }
  if (item.tags.length > 0) bits.push(item.tags.slice(0, 4).join(", "));
  // With one subject every pick is "via" it; only spend tokens on this when it discriminates.
  const via = ctx.artistNames.length + ctx.touchstoneNames.length > 1 ? (item.because ?? []).map((b) => ctx.names.get(b.entity_id)).filter(Boolean) : [];
  if (via.length > 0) bits.push(`via ${via.slice(0, 2).join(", ")}`);
  return bits.join(" · ");
}

export function writePrompt(ctx: WriteContext): string {
  const parts = [
    describeBrief(ctx.brief, ctx),
    "",
    "DIRECTION",
    ctx.direction,
    "",
    "QLOO EVIDENCE (aggregate taste; ranked best first)",
  ];
  if (ctx.tone.length > 0) parts.push(`Tone tags: ${ctx.tone.map((t) => `${t.ref} ${t.tag.name}`).join("; ")}`);
  if (ctx.leans.length > 0) parts.push(`Audience skew: ${ctx.leans.join("; ")}`);
  if (ctx.references.length > 0) parts.push("Film references:", ...ctx.references.map((r) => entityLine(r, ctx)));
  if (ctx.brands.length > 0) parts.push("Wardrobe brands:", ...ctx.brands.map((r) => entityLine(r, ctx)));
  if (ctx.places.length > 0) parts.push(`Locations in ${ctx.brief.city}:`, ...ctx.places.map((r) => entityLine(r, ctx)));
  parts.push(
    "",
    "TASK",
    "Write the treatment. Cite films, brands and places only by ref. For each reference say why it fits this audience",
    "and what to borrow. Wardrobe looks name garments, fabrics and colours. Location scenes say what happens there.",
    "Palette: 4-6 named colours. Lighting and shot notes must be concrete and doable on this budget.",
  );
  return parts.join("\n");
}

const PALETTES: Record<Vibe, { name: string; hex: string }[]> = {
  dark: [
    { name: "Ink", hex: "#0B0F1A" },
    { name: "Sodium", hex: "#E07A1F" },
    { name: "Neon teal", hex: "#14B8A6" },
    { name: "Bruise", hex: "#4C1D95" },
    { name: "Smoke", hex: "#9CA3AF" },
  ],
  tender: [
    { name: "Chai", hex: "#C8A27A" },
    { name: "Dusk rose", hex: "#D8A7A0" },
    { name: "Monsoon green", hex: "#4F6D5A" },
    { name: "Lamp", hex: "#F2C77B" },
    { name: "Ink blue", hex: "#23395B" },
  ],
  bright: [
    { name: "Chalk", hex: "#F5F1E8" },
    { name: "Tangerine", hex: "#F97316" },
    { name: "Pool", hex: "#38BDF8" },
    { name: "Bubblegum", hex: "#F472B6" },
    { name: "Jet", hex: "#111827" },
  ],
};

const LIGHTING: Record<Vibe, string[]> = {
  dark: [
    "Practical-led night exteriors: streetlights and signage as the key, no fill.",
    "Hard top light indoors so faces fall into shadow.",
    "Haze in every interior to catch the practicals.",
  ],
  tender: [
    "Soft, bounced window light; warm and low-contrast.",
    "Tungsten practicals in frame (table lamps, string lights) to motivate the light.",
    "Golden-hour exteriors shot against the sun for halation.",
  ],
  bright: [
    "High-key and even, with saturated gels for colour pops.",
    "Hard daylight exteriors with crisp shadows.",
    "Coloured fill to separate the artist from the background.",
  ],
};

const SHOTS: Record<Vibe, string[]> = {
  dark: [
    "Slow push-ins on static wides",
    "Long lens through glass and rain-streaked windows",
    "Handheld follow through night crowds",
    "Overhead city cutaways between verses",
  ],
  tender: [
    "Locked-off wides held a beat too long",
    "Close-ups on hands and small objects",
    "Gentle handheld two-shots",
    "One unbroken take for the bridge",
  ],
  bright: ["Whip-pans between set-ups", "Low-angle wides", "Performance close-ups straight to lens", "Match cuts on movement"],
};

const TITLES: Record<Vibe, string[]> = {
  dark: ["After Hours", "Sodium Nights", "Night Shift"],
  tender: ["Small Hours", "Slow Weather", "Window Light"],
  bright: ["Loud Colour", "High Noon", "Daylight Club"],
};

const BORROW = ["the colour palette", "the framing", "the camera movement", "the texture and grain", "the pacing", "the production design"];

function hashOf(textValue: string): number {
  let h = 0;
  for (const ch of textValue) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h;
}

/** Deterministic writer for mock mode and for when every LLM fails; output is labelled "Mock LLM". */
export function mockDraft(ctx: WriteContext): Draft {
  const vibe = vibeOf(ctx.tone.map((t) => t.tag.name), ctx.brief.nudges.includes("darker"));
  const subject = subjectPhrase(ctx.artistNames, ctx.touchstoneNames);
  const toneNames = ctx.tone.map((t) => t.tag.name.toLowerCase());
  const refs = ctx.references.slice(0, 4);
  const places = ctx.places.slice(0, 3);
  const brands = ctx.brands.slice(0, 3);
  const palette = PALETTES[vibe];
  const placeName = (i: number) => places[i % Math.max(places.length, 1)]?.item.name ?? ctx.brief.city;
  const format = ctx.brief.format === "music_video" ? "music video" : "short film";
  const beatNames = ["Open", "Drift", "Turn", "Release"];

  return {
    title: TITLES[vibe][hashOf(subject) % TITLES[vibe].length],
    logline: `A ${format} ${subject} that moves through ${placeName(0)}${places.length > 1 ? ` and ${placeName(1)}` : ""}, cut to the ${toneNames.slice(0, 2).join(" and ") || "textures"} its audience over-indexes on.`,
    concept:
      `${ctx.direction} The film stays close to the performer and lets the city do the talking: ` +
      `${places.map((p) => p.item.name).join(", ") || ctx.brief.city} stand in for the song's emotional rooms. ` +
      (refs.length > 0 ? `Visually it borrows from ${refs.map((r) => r.item.name).join(", ")}. ` : "") +
      (brands.length > 0 ? `Wardrobe pulls from ${brands.map((b) => b.item.name).join(", ")}, kept within a ${palette.slice(0, 3).map((c) => c.name.toLowerCase()).join(", ")} palette.` : ""),
    ...(ctx.tone.length > 0
      ? { tone: ctx.tone.slice(0, 5).map((t) => ({ ref: t.ref, note: `Let ${t.tag.name.toLowerCase()} set the pace and the framing.` })) }
      : {}),
    beats: beatNames.map((title, i) => ({
      title,
      description: `${placeName(i)}: ${["the artist alone, the city still waking", "movement picks up and the frame loosens", "a held look, the song's turn", "the crowd or the quiet, whichever the song earns"][i]}.`,
      ...(refs.length > 0 ? { reference: refs[i % refs.length].ref } : {}),
    })),
    ...(refs.length > 0
      ? {
          references: refs.slice(0, Math.max(2, Math.min(refs.length, 4))).map((r, i) => ({
            ref: r.ref,
            why: `Ranks high with this audience${r.item.tags.length > 0 ? ` and shares ${r.item.tags.slice(0, 2).join(" and ").toLowerCase()}` : ""}.`,
            borrow: BORROW[i % BORROW.length],
          })),
        }
      : {}),
    ...(brands.length > 0
      ? {
          wardrobe: brands.map((b, i) => ({
            ref: b.ref,
            look: `${b.item.name} pieces in ${palette[i % palette.length].name.toLowerCase()} and ${palette[(i + 2) % palette.length].name.toLowerCase()}, worn-in rather than new.`,
          })),
        }
      : {}),
    ...(places.length > 0
      ? { locations: places.map((p, i) => ({ ref: p.ref, scene: `The ${beatNames[i].toLowerCase()} beat: ${i === 0 ? "establish the artist in their element" : i === 1 ? "the middle section's movement" : "the final turn"}.` })) }
      : {}),
    palette: palette.slice(0, 5),
    lighting: LIGHTING[vibe],
    shots: SHOTS[vibe],
  };
}
