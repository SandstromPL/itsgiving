import { z } from "zod";
import type { CompactEntity } from "../qloo";
import type { KnownRole } from "../tmdb";
import type { Brief } from "./brief";
import { aboveBudget, budgetPhrase, joinNames, openingLine, priceLine, subjectPhrase, withYear } from "./options";
import { areaLabel, describeBrief, vibeOf, type ToneCandidate, type Vibe, type Who } from "./plan";
import type { BaseArea } from "./types";

// The writing LLM call. Every Qloo item is listed under a short ref (R1, B1,
// L1, T1) and the schema's enums accept only those refs, so a citation can
// only point at something a tool actually returned. TMDB's characters get refs
// too (C1), so a character can only be drawn from one TMDB credits.

export interface Ref<T> {
  ref: string;
  item: T;
}

/** A character in one of the references, as TMDB credits it: what the story's people may be drawn from. */
export interface TitleCharacter {
  title: CompactEntity;
  name: string;
  actor: string;
}

export interface WriteContext extends Who {
  brief: Brief;
  direction: string;
  tone: ToneCandidate[];
  references: Ref<CompactEntity>[];
  /** Series the audience over-indexes on (S refs): references too, but never the cover. */
  series: Ref<CompactEntity>[];
  /** Characters in the first films and series (C refs), from TMDB: empty without it, and in mock mode. */
  characters: Ref<TitleCharacter>[];
  /** Actors the audience over-indexes on (P refs), as faces for the story's people. */
  casting: Ref<CompactEntity>[];
  /** The parts each actor is best known for, by entity ID (TMDB). */
  roles: Map<string, KnownRole[]>;
  /** A short film's music: artists the audience over-indexes on (M refs). Empty for a music video, whose song is given. */
  music: Ref<CompactEntity>[];
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
  /** The story's people. `from` (a C ref), `take` and `face` (a P ref) are null or "" when there's nothing to cite. */
  characters: {
    name: string;
    who: string;
    wants: string;
    hides: string;
    presence: string;
    look: string;
    arc: string;
    beats: number[];
    from: string | null;
    take: string;
    face: string | null;
  }[];
  music?: { ref: string; song: string | null; use: string }[];
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
  const { tone, references, series, characters, casting, music, brands, places } = ctx;
  // A beat or a reference may point at a film or a series; the cover is always a film's still.
  const titles = [...references, ...series];
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
          ...(titles.length > 0 ? { reference: refEnum(titles).nullable() } : {}),
        }),
      )
      .min(3)
      .describe("3-6 beats in order."),
    ...(titles.length > 0
      ? {
          references: z
            .array(
              z.strictObject({
                ref: refEnum(titles),
                why: text,
                // Not a list of options: Gemini read "palette, framing, movement or texture" as a menu and answered one word.
                borrow: text.describe("One sentence: the specific look or technique to take from this title, and where to use it."),
              }),
            )
            .min(Math.min(2, titles.length))
            .describe(series.length > 0 ? "2-6 references: films, and at most 2 series." : "2-6 film references."),
          ...(references.length > 0
            ? {
                cover: refEnum(references)
                  .nullable()
                  .describe("The cited film whose look best fits the title and logline: a frame from it is the cover."),
              }
            : {}),
        }
      : {}),
    // No minimum, and filled in when it's missing (normalizeDraft): a draft without its people keeps the rest, rather
    // than costing a repair call. Every field is always there, so the shape never depends on what was found.
    characters: z
      .array(
        z.strictObject({
          name: text.describe("Invented, fitting the city and the story."),
          who: text.describe("Under 20 words: their age range, what they do, where they stand in the story."),
          wants: text.describe("Under 12 words."),
          hides: text.describe("Under 12 words: what they keep back, which an actor can play."),
          presence: text.describe("Under 16 words: how they move and speak, what the part asks of an actor."),
          look: text.describe("Under 12 words: garments, fabrics, colours."),
          arc: text.describe("Under 16 words: where we meet them and where we leave them."),
          beats: z.array(z.number()).describe("The beats they're in, by number."),
          from:
            characters.length > 0
              ? refEnum(characters).nullable().describe("The listed character (C ref) they're drawn from, or null.")
              : z.null().describe("Null: no characters are listed."),
          take: z.string().describe("Under 12 words: what to take from that character, not a copy. Empty when from is null."),
          face:
            casting.length > 0
              ? refEnum(casting).nullable().describe("An actor (P ref) as a reference for the part, a different one each, or null.")
              : z.null().describe("Null: no actors are listed."),
        }),
      )
      .describe("2-3 characters."),
    ...(music.length > 0
      ? {
          // No minimum, like casting: a draft without music keeps the rest rather than costing a repair.
          music: z
            .array(
              z.strictObject({
                ref: refEnum(music),
                song: z.string().nullable().describe("One of that artist's songs exactly as listed, or null."),
                use: text.describe("Where and how it's used: a needle drop at a beat, or the score's direction."),
              }),
            )
            .describe("2-4 music references."),
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

/** A beat number as models send them: 2, "2" or "Beat 2". Anything else is left for the schema to refuse. */
function beatNumber(beat: unknown): unknown {
  if (typeof beat !== "string") return beat;
  const digits = /\d+/.exec(beat);
  return digits ? Number(digits[0]) : beat;
}

/** A character with the fields that may be empty filled in as empty, and its beats as numbers. */
function fillCharacter(person: unknown): unknown {
  if (!person || typeof person !== "object" || Array.isArray(person)) return person;
  const filled: Record<string, unknown> = { from: null, take: "", face: null, beats: [], ...person };
  if (Array.isArray(filled.beats)) filled.beats = filled.beats.map(beatNumber);
  return filled;
}

/**
 * DeepSeek's JSON mode sometimes sends lighting or shot notes as objects. Flattening them before
 * validation keeps what it wrote and saves a whole repair call (15-35 s with thinking on). A draft
 * with references but no cover pick gets "none", which the board reads as its first film's still,
 * rather than a repair for the one field that may be empty. The same goes for a draft without its
 * characters, or a character without a source, a face or its beats.
 */
export function normalizeDraft(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const draft = { ...(value as Record<string, unknown>) };
  for (const key of ["lighting", "shots"]) {
    if (Array.isArray(draft[key])) draft[key] = draft[key].map(flattenNote);
  }
  if (Array.isArray(draft.references) && draft.cover === undefined) draft.cover = null;
  draft.characters = Array.isArray(draft.characters) ? draft.characters.map(fillCharacter) : (draft.characters ?? []);
  return draft;
}

/** Models sometimes leak refs into prose ("the T13 tag", "at L1"); this swaps each for the name it stands for. */
export function refScrubber(names: Map<string, string>): (text: string) => string {
  if (names.size === 0) return (text) => text;
  // Longest first, so T13 is replaced whole rather than as T1 followed by a 3.
  const pattern = new RegExp(`\\b(${[...names.keys()].sort((a, b) => b.length - a.length).join("|")})\\b`, "g");
  return (text) => text.replace(pattern, (ref) => names.get(ref) ?? ref);
}

/** "M1 Phoebe Bridgers · Indie Rock, Indie Folk · songs: Motion Sickness, Kyoto, Garden Song". */
function artistLine({ ref, item }: Ref<CompactEntity>): string {
  const genres = item.artist?.genres ?? item.tags.slice(0, 3);
  const songs = item.artist?.songs?.slice(0, 3) ?? [];
  return [`${ref} ${item.name}`, genres.join(", "), songs.length > 0 ? `songs: ${songs.join(", ")}` : ""].filter(Boolean).join(" · ");
}

/** "P1 Paul Mescal · known as Lucius in Gladiator II (2024); Calum in Aftersun (2022)". */
function actorLine({ ref, item }: Ref<CompactEntity>, roles: Map<string, KnownRole[]>): string {
  const known = (roles.get(item.id) ?? []).map((role) => `${role.character} in ${withYear(role.title, role.year)}`);
  return known.length > 0 ? `${ref} ${item.name} · known as ${known.join("; ")}` : `${ref} ${item.name}`;
}

function entityLine({ ref, item }: Ref<CompactEntity>, ctx: WriteContext): string {
  const bits = [`${ref} ${withYear(item.name, item.year)}`];
  if (item.place) {
    if (item.place.neighborhood) bits[0] += `, ${item.place.neighborhood}`;
    if (item.place.price_level) bits.push(`price ${item.place.price_level}/4`);
  }
  if (item.tags.length > 0) bits.push(item.tags.slice(0, 4).join(", "));
  const price = priceLine(item.brand?.price);
  if (price) bits.push(price);
  // Qloo's own read of the room, clipped so six places stay within Groq's tokens-per-minute budget.
  if (item.place?.ambience) bits.push(`"${item.place.ambience.slice(0, 140)}"`);
  const hours = openingLine(item.place?.hours);
  if (hours) bits.push(`open ${hours}`);
  if (item.place?.fits?.length) bits.push(`suits ${item.place.fits.join(", ").toLowerCase()}`);
  // A title's archetypes and traits are Qloo's for the whole film; its characters are TMDB's, each with its own ref.
  if (item.film?.archetypes?.length) bits.push(`archetypes: ${item.film.archetypes.join(", ")}`);
  if (item.film?.traits?.length) bits.push(`traits: ${item.film.traits.join(", ")}`);
  const people = ctx.characters.filter((c) => c.item.title.id === item.id);
  if (people.length > 0) bits.push(`characters: ${people.map((c) => `${c.ref} ${c.item.name} (${c.item.actor})`).join(", ")}`);
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
  if (ctx.series.length > 0) parts.push("Series:", ...ctx.series.map((r) => entityLine(r, ctx)));
  // An actor's Qloo tags say little a part needs: their name, and the parts TMDB says they're known for.
  if (ctx.casting.length > 0) parts.push("Actors (faces this audience knows):", ...ctx.casting.map((r) => actorLine(r, ctx.roles)));
  if (ctx.music.length > 0) parts.push("Music (artists this audience plays):", ...ctx.music.map(artistLine));
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
    "Write the treatment. Cite films, series, characters, actors, brands and places by ref only in the ref fields; in the",
    "text, call them by name and never write refs (T1, R2, S1, C1, P1, B1, L3) or price levels. For each reference say why it fits this audience and,",
    "in one sentence, the specific look or technique to borrow; a series may be one or two of them. For the cover, name the",
    "cited film whose look best fits the title and logline: a frame from it is the cover. Wardrobe looks name garments, fabrics and colours. Location",
    "scenes say what happens there and stay true to the place's Qloo description. Palette: 4-6 named colours. Lighting",
    "and shot notes are plain sentences, concrete and doable on this budget.",
  );
  const pricey = ctx.brands.filter(({ item }) => aboveBudget(item, ctx.brief.budget)).map(({ item }) => item.name);
  if (pricey.length > 0) {
    parts.push(
      `On ${budgetPhrase(ctx.brief.budget)}, ${joinNames(pricey)} ${pricey.length > 1 ? "are" : "is"} a reference to rent or match, not to buy: say so in that look.`,
    );
  }
  parts.push(
    `Characters: 2-3 people for this story${ctx.brief.format === "music_video" ? "; the artist plays themselves and isn't one of them, so sketch the people around them" : ""}.`,
    `Give each an invented name that fits ${ctx.brief.city} and the story, who they are (age range, what they do, where they stand in the story),`,
    "what they want, what they hide, how they move and speak, their look, where we meet and leave them, and the beats they're in by number.",
    "Keep every line short, as in a casting breakdown: the sketch is read at a glance.",
  );
  if (ctx.characters.length > 0) {
    parts.push(
      "Draw each from one of the characters listed under the titles (C refs), and say in a few words what to take, not a copy; or set from to null.",
    );
  }
  if (ctx.casting.length > 0) {
    parts.push(
      "Where an actor (P refs) fits a part, give that character a different actor from the others, as a reference for the presence it needs, not an offer.",
    );
  }
  parts.push(
    "Write about the characters and their parts, never an actor's looks or life, and don't describe an actor's other roles.",
    "A character's traits come from the story and the titles, never from who the audience is.",
  );
  if (ctx.music.length > 0) {
    parts.push(
      "Music: pick 2-4 of the artists (M refs) for needle drops or the score's direction, and say where each is used. Name a",
      "song only from that artist's listed songs, exactly as written; otherwise leave song null.",
    );
  }
  if (ctx.places.some(({ item }) => item.place?.hours)) {
    parts.push("Where a place lists its hours, a scene can use them: shoot before it opens or on the day it's closed.");
  }
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

/**
 * The template writer's people, by format: parts more than people, since it knows no story. Each is [name, who], and
 * the beats it's in (of the template's four).
 */
const TEMPLATE_PEOPLE: Record<Brief["format"], [string, string, number[]][]> = {
  music_video: [
    ["The one the artist keeps almost meeting", "Never quite in the same shot as the artist until the last beat.", [2, 4]],
    ["A friend at the edge of the frame", "Sees what the artist won't say.", [1, 3]],
    ["A stranger in the last shot", "Arrives once, and changes how the ending reads.", [4]],
  ],
  short_film: [
    ["The lead", "Carries the film: we see the city through them.", [1, 2, 3, 4]],
    ["The one the lead keeps almost meeting", "Always a step out of time with the lead.", [2, 4]],
    ["A friend who sees it first", "Says the thing the lead can't.", [3]],
  ],
};
/** The template writer's notes on where its music goes. */
const MUSIC_USES = [
  "Under the opening, low enough to hear the street through it.",
  "A needle drop at the turn, cut hard on the downbeat.",
  "Over the last shot and into the credits.",
];

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
          references: [...refs.slice(0, Math.max(2, Math.min(refs.length, 4))), ...ctx.series.slice(0, 1)].map((r, i) => ({
            ref: r.ref,
            why: `Ranks high with this audience${r.item.tags.length > 0 ? ` and shares ${r.item.tags.slice(0, 2).join(" and ").toLowerCase()}` : ""}.`,
            borrow: BORROW[i % BORROW.length],
          })),
          cover: refs[0].ref,
        }
      : {}),
    characters: TEMPLATE_PEOPLE[ctx.brief.format].map(([name, who, beats], i) => ({
      name,
      who,
      wants: "To be seen without having to ask for it.",
      hides: "How much the last time cost them.",
      presence: "Someone who can hold a long, quiet close-up.",
      look: `Worn-in pieces in ${palette[i % palette.length].name.toLowerCase()}.`,
      arc:
        i === 0
          ? "Alone at the start; not alone at the end."
          : `In for the ${beats.map((b) => beatNames[b - 1].toLowerCase()).join(" and ")}.`,
      beats,
      from: ctx.characters[i]?.ref ?? null,
      take: ctx.characters[i] ? "How much they leave unsaid." : "",
      face: ctx.casting[i]?.ref ?? null,
    })),
    ...(ctx.music.length > 0
      ? {
          music: ctx.music.slice(0, 3).map((m, i) => ({
            ref: m.ref,
            song: m.item.artist?.songs?.[0] ?? null,
            use: MUSIC_USES[i],
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
