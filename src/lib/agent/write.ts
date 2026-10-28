import { z } from "zod";
import type { CompactEntity } from "../qloo";
import type { Brief } from "./brief";
import { subjectPhrase, withYear } from "./options";
import { areaLabel, describeBrief, vibeOf, type ToneCandidate, type Vibe, type Who } from "./plan";
import type { BaseArea } from "./types";

// The writing LLM call. Every Qloo item is listed under a short ref (R1, B1,
// L1, T1) and the schema's enums accept only those refs, so a citation can
// only point at something a tool actually returned.

export interface Ref<T> {
  ref: string;
  item: T;
}

export interface WriteContext extends Who {
  brief: Brief;
  direction: string;
  tone: ToneCandidate[];
  references: Ref<CompactEntity>[];
  brands: Ref<CompactEntity>[];
  places: Ref<CompactEntity>[];
  leans: string[];
  /** The area the locations were scouted in; unset when there was none or it was widened to the whole city. */
  base?: BaseArea;
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
  /** The cited film whose still becomes the cover. */
  cover?: string | null;
  wardrobe?: { ref: string; look: string }[];
  locations?: { ref: string; scene: string }[];
  palette: { name: string; hex: string }[];
  lighting: string[];
  shots: string[];
}

const text = z.string().min(1);
const refEnum = (refs: Ref<unknown>[] | ToneCandidate[]) => z.enum(refs.map((r) => r.ref) as [string, ...string[]]);

// Arrays only carry minimums (and refs must come from the enums); the
// maximums are stated in the descriptions and applied in code, so a model that
// writes one shot too many isn't sent back for a repair.
export function writeSchema(ctx: WriteContext): z.ZodType<Draft> {
  const { tone, references, brands, places } = ctx;
  return z.strictObject({
    title: text.describe("2-6 words."),
    logline: text.describe("One sentence."),
    concept: text.describe("80-140 words, present tense."),
    ...(tone.length > 0
      ? {
          tone: z
            .array(z.strictObject({ ref: refEnum(tone), note: text }))
            .min(1)
            .describe("2-5 items: how each tone tag shows up on screen."),
        }
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
      .describe("3-6 beats in order."),
    ...(references.length > 0
      ? {
          references: z
            .array(
              z.strictObject({
                ref: refEnum(references),
                why: text,
                // Not a list of options: Gemini read "palette, framing, movement or texture" as a menu and answered one word.
                borrow: text.describe("One sentence: the specific look or technique to take from this film, and where to use it."),
              }),
            )
            .min(Math.min(2, references.length))
            .describe("2-6 film references."),
          cover: refEnum(references)
            .nullable()
            .describe("The cited film whose look best fits the title and logline: a frame from it is the cover."),
        }
      : {}),
    ...(brands.length > 0
      ? {
          wardrobe: z
            .array(z.strictObject({ ref: refEnum(brands), look: text.describe("Garments, fabrics, colours.") }))
            .min(1)
            .describe("1-4 looks."),
        }
      : {}),
    ...(places.length > 0
      ? {
          locations: z
            .array(z.strictObject({ ref: refEnum(places), scene: text.describe("What happens there.") }))
            .min(1)
            .describe("1-4 locations."),
        }
      : {}),
    palette: z
      .array(
        z.strictObject({
          name: text,
          hex: z
            .string()
            .regex(/^#[0-9A-Fa-f]{6}$/)
            .describe("#RRGGBB"),
        }),
      )
      .min(3)
      .describe("4-6 colours."),
    lighting: z.array(text).min(2).describe("2-4 lighting notes, each a plain sentence."),
    shots: z.array(text).min(3).describe("3-6 shot notes, each a plain sentence."),
  }) as unknown as z.ZodType<Draft>;
}

/** Join an object's text values: what a note sent as {"setup": ..., "purpose": ...} meant to say. */
function flattenNote(note: unknown): unknown {
  if (!note || typeof note !== "object" || Array.isArray(note)) return note;
  const parts = Object.values(note).filter((v): v is string => typeof v === "string" && v.trim().length > 0);
  return parts.length > 0 ? parts.join(" — ") : note;
}

/**
 * DeepSeek's JSON mode sometimes sends lighting or shot notes as objects. Flattening them before
 * validation keeps what it wrote and saves a whole repair call (15-35 s with thinking on). A draft
 * with references but no cover pick gets "none", which the board reads as its first film's still,
 * rather than a repair for the one field that may be empty.
 */
export function normalizeDraft(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const draft = { ...(value as Record<string, unknown>) };
  for (const key of ["lighting", "shots"]) {
    if (Array.isArray(draft[key])) draft[key] = draft[key].map(flattenNote);
  }
  if (Array.isArray(draft.references) && draft.cover === undefined) draft.cover = null;
  return draft;
}

/** Models sometimes leak refs into prose ("the T13 tag", "at L1"); this swaps each for the name it stands for. */
export function refScrubber(names: Map<string, string>): (text: string) => string {
  if (names.size === 0) return (text) => text;
  // Longest first, so T13 is replaced whole rather than as T1 followed by a 3.
  const pattern = new RegExp(`\\b(${[...names.keys()].sort((a, b) => b.length - a.length).join("|")})\\b`, "g");
  return (text) => text.replace(pattern, (ref) => names.get(ref) ?? ref);
}

function entityLine({ ref, item }: Ref<CompactEntity>, ctx: WriteContext): string {
  const bits = [`${ref} ${withYear(item.name, item.year)}`];
  if (item.place) {
    if (item.place.neighborhood) bits[0] += `, ${item.place.neighborhood}`;
    if (item.place.price_level) bits.push(`price ${item.place.price_level}/4`);
  }
  if (item.tags.length > 0) bits.push(item.tags.slice(0, 4).join(", "));
  // Qloo's own read of the room, clipped so six places stay within Groq's tokens-per-minute budget.
  if (item.place?.ambience) bits.push(`"${item.place.ambience.slice(0, 140)}"`);
  // With one subject every pick is "via" it; only spend tokens on this when it discriminates. An artist Qloo lacks
  // drove nothing: their stand-ins did.
  const signals = (ctx.artistMissing ? 0 : ctx.artistNames.length) + ctx.touchstoneNames.length + (ctx.standInNames?.length ?? 0);
  const via = signals > 1 ? (item.because ?? []).map((b) => ctx.names.get(b.entity_id)).filter(Boolean) : [];
  if (via.length > 0) bits.push(`via ${via.slice(0, 2).join(", ")}`);
  return bits.join(" · ");
}

export function writePrompt(ctx: WriteContext): string {
  const parts = [describeBrief(ctx.brief, ctx), "", "DIRECTION", ctx.direction, "", "QLOO EVIDENCE (aggregate taste; ranked best first)"];
  if (ctx.tone.length > 0) parts.push(`Tone tags: ${ctx.tone.map((t) => `${t.ref} ${t.tag.name}`).join("; ")}`);
  if (ctx.leans.length > 0) parts.push(`Audience skew: ${ctx.leans.join("; ")}`);
  if (ctx.references.length > 0) parts.push("Film references:", ...ctx.references.map((r) => entityLine(r, ctx)));
  if (ctx.brands.length > 0) parts.push("Wardrobe brands:", ...ctx.brands.map((r) => entityLine(r, ctx)));
  if (ctx.base) {
    parts.push(
      `Shoot base: ${areaLabel(ctx.base, false)}, where this audience over-indexes (Qloo heatmap). Every location below is within ${ctx.base.radius_m / 1000} km of it.`,
    );
  }
  if (ctx.places.length > 0) parts.push(`Locations in ${ctx.brief.city}:`, ...ctx.places.map((r) => entityLine(r, ctx)));
  parts.push(
    "",
    "TASK",
    "Write the treatment. Cite films, brands and places by ref only in the ref fields; in the text, call them by name",
    "and never write refs (T1, R2, B1, L3) or price levels. For each reference say why it fits this audience and, in one",
    "sentence, the specific look or technique to borrow. For the cover, name the cited film whose look best fits the title",
    "and logline: a frame from it is the cover. Wardrobe looks name garments, fabrics and colours. Location",
    "scenes say what happens there and stay true to the place's Qloo description. Palette: 4-6 named colours. Lighting",
    "and shot notes are plain sentences, concrete and doable on this budget.",
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
    "Coloured fill to separate the subject from the background.",
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
  const vibe = vibeOf(
    ctx.tone.map((t) => t.tag.name),
    ctx.brief.nudges.includes("darker"),
  );
  const subject = subjectPhrase(ctx.artistNames, ctx.touchstoneNames, ctx.brief.format);
  const toneNames = ctx.tone.map((t) => t.tag.name.toLowerCase());
  const refs = ctx.references.slice(0, 4);
  const places = ctx.places.slice(0, 3);
  const brands = ctx.brands.slice(0, 3);
  const palette = PALETTES[vibe];
  const placeName = (i: number) => places[i % Math.max(places.length, 1)]?.item.name ?? ctx.brief.city;
  const isVideo = ctx.brief.format === "music_video";
  const format = isVideo ? "music video" : "short film";
  const beatNames = ["Open", "Drift", "Turn", "Release"];
  // A music video follows its artist and the song; a short film, its lead and the story.
  const beatLines = isVideo
    ? [
        "the artist alone, the city still waking",
        "movement picks up and the frame loosens",
        "a held look, the song's turn",
        "the crowd or the quiet, whichever the song earns",
      ]
    : [
        "the lead alone, the city still waking",
        "the story moves and the frame loosens",
        "a held look, the turn",
        "the crowd or the quiet, whichever the ending earns",
      ];
  const sceneLines = isVideo
    ? ["establish the artist in their element", "the middle section's movement", "the final turn"]
    : ["establish the lead in their world", "the story's middle", "the final turn"];

  return {
    title: TITLES[vibe][hashOf(subject) % TITLES[vibe].length],
    // "after Masaan, for fans of Prateek Kuhad" closes on a phrase of its own, so the clause after it needs a comma.
    logline: `A ${format} ${subject}${!isVideo && ctx.artistNames.length > 0 ? "," : ""} that moves through ${placeName(0)}${places.length > 1 ? ` and ${placeName(1)}` : ""}, cut to the ${toneNames.slice(0, 2).join(" and ") || "textures"} its audience over-indexes on.`,
    concept:
      `${ctx.direction} The film stays close to ${isVideo ? "the performer" : "its lead"} and lets the city do the talking: ` +
      `${places.map((p) => p.item.name).join(", ") || ctx.brief.city} stand in for the ${isVideo ? "song's emotional rooms" : "story's rooms"}. ` +
      (refs.length > 0 ? `Visually it borrows from ${refs.map((r) => r.item.name).join(", ")}. ` : "") +
      (brands.length > 0
        ? `Wardrobe pulls from ${brands.map((b) => b.item.name).join(", ")}, kept within a ${palette
            .slice(0, 3)
            .map((c) => c.name.toLowerCase())
            .join(", ")} palette.`
        : ""),
    ...(ctx.tone.length > 0
      ? { tone: ctx.tone.slice(0, 5).map((t) => ({ ref: t.ref, note: `Let ${t.tag.name.toLowerCase()} set the pace and the framing.` })) }
      : {}),
    beats: beatNames.map((title, i) => ({
      title,
      description: `${placeName(i)}: ${beatLines[i]}.`,
      ...(refs.length > 0 ? { reference: refs[i % refs.length].ref } : {}),
    })),
    ...(refs.length > 0
      ? {
          references: refs.slice(0, Math.max(2, Math.min(refs.length, 4))).map((r, i) => ({
            ref: r.ref,
            why: `Ranks high with this audience${r.item.tags.length > 0 ? ` and shares ${r.item.tags.slice(0, 2).join(" and ").toLowerCase()}` : ""}.`,
            borrow: BORROW[i % BORROW.length],
          })),
          cover: refs[0].ref,
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
      ? {
          locations: places.map((p, i) => ({
            ref: p.ref,
            scene: `The ${beatNames[i].toLowerCase()} beat: ${sceneLines[Math.min(i, 2)]}.`,
          })),
        }
      : {}),
    palette: palette.slice(0, 5),
    lighting: LIGHTING[vibe],
    shots: SHOTS[vibe],
  };
}
