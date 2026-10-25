import { z } from "zod";
import { compactEntity, entityList, entityUrn, type CompactEntity } from "../qloo";
import { SEARCHABLE_KINDS, defineTool, normalizeName, plural } from "./shared";

type Resolution =
  /** `among` is set when several titles matched exactly and this one was far better known. */
  | { input: string; status: "resolved"; match: CompactEntity; among?: number }
  | { input: string; status: "ambiguous"; candidates: CompactEntity[] }
  | { input: string; status: "not_found" };

const itemSchema = z.strictObject({
  name: z.string().min(1).describe("The name as the user wrote it, e.g. \"Prateek Kuhad\" or \"In the Mood for Love\"."),
  type: z.enum(SEARCHABLE_KINDS).describe("What kind of thing it is."),
  year: z
    .number()
    .int()
    .min(1870)
    .max(2100)
    .optional()
    .describe("Release year, if the user gave one; disambiguates remakes and same-name titles."),
  city: z.string().min(1).optional().describe("City, for places; disambiguates chains and same-name venues."),
});

function pick(item: z.output<typeof itemSchema>, candidates: CompactEntity[]): Resolution {
  if (candidates.length === 0) return { input: item.name, status: "not_found" };
  const wanted = normalizeName(item.name);
  let exact = candidates.filter((c) => normalizeName(c.name) === wanted);
  if (item.year !== undefined) {
    const sameYear = exact.filter((c) => c.year === item.year);
    if (sameYear.length > 0) exact = sameYear;
  }
  if (item.city) {
    const city = normalizeName(item.city);
    const sameCity = exact.filter((c) =>
      normalizeName(`${c.place?.city ?? ""} ${c.disambiguation ?? ""}`).includes(city),
    );
    if (sameCity.length > 0) exact = sameCity;
  }
  // Like Qloo's own harness: only auto-accept a single exact match; anything
  // else goes back to the user rather than being guessed...
  if (exact.length === 1) return { input: item.name, status: "resolved", match: exact[0] };
  // ...unless one exact match dwarfs the rest: "Aftersun (2022)" means Charlotte Wells' film (popularity
  // 0.999), not the other 2022 Aftersun (0.086). Close calls still go back to the user.
  const [top, next] = [...exact].sort((a, b) => (b.popularity ?? 0) - (a.popularity ?? 0));
  if (top && next && (top.popularity ?? 0) - (next.popularity ?? 0) >= DOMINANT_GAP) {
    return { input: item.name, status: "resolved", match: top, among: exact.length };
  }
  return { input: item.name, status: "ambiguous", candidates: (exact.length > 0 ? exact : candidates).slice(0, 5) };
}

/** How much more popular (0-1 percentile) one same-name title must be to be taken without asking. */
export const DOMINANT_GAP = 0.5;

export const resolveEntities = defineTool({
  name: "resolve_entities",
  description:
    "Turn names the user mentions (artists, films, TV shows, brands, places, people) into Qloo entity IDs. " +
    "Call this before any other Qloo tool whenever you only have a name, and again whenever the user adds new references. " +
    "Each item comes back resolved, ambiguous (with up to 5 candidates) or not found. For ambiguous or missing items, " +
    "ask the user which one they mean instead of guessing.",
  inputSchema: z.strictObject({
    items: z.array(itemSchema).min(1).max(10).describe("Names to resolve, up to 10 per call."),
  }),
  example: {
    items: [
      { name: "Prateek Kuhad", type: "artist" },
      { name: "In the Mood for Love", type: "movie" },
      { name: "Forgotten", type: "movie" },
    ],
  },
  async run(input, { qloo }) {
    const items = await Promise.all(
      input.items.map(async (item) => {
        const response = await qloo.search({ query: item.name, types: entityUrn(item.type), take: 5 });
        return pick(item, entityList(response.data).map((e) => compactEntity(e, { maxTags: 5 })));
      }),
    );
    const resolved = items.filter((i) => i.status === "resolved").length;
    const unclear = items.filter((i) => i.status !== "resolved").map((i) => `"${i.input}" (${i.status.replace("_", " ")})`);
    return {
      status: resolved === items.length ? "ok" : resolved === 0 && items.every((i) => i.status === "not_found") ? "empty" : "needs_input",
      summary:
        `Resolved ${resolved}/${items.length}.` +
        (unclear.length > 0 ? ` Ask the user about ${unclear.join(", ")}.` : ""),
      data: { items },
    };
  },
});

export const importExternalIds = defineTool({
  name: "import_external_ids",
  description:
    "Look up films/TV shows by IMDb ID and artists by Spotify ID, e.g. from a director's TMDB or Letterboxd watch history " +
    "or an artist's Spotify link. Call this when the user supplies IDs or imports a list; it is exact and cheaper than " +
    "resolving names one by one.",
  inputSchema: z
    .strictObject({
      imdb_ids: z
        .array(z.string().regex(/^tt\d{5,10}$/))
        .max(50)
        .optional()
        .describe("IMDb title IDs such as tt0114369."),
      spotify_artist_ids: z
        .array(z.string().regex(/^[A-Za-z0-9]{22}$/))
        .max(50)
        .optional()
        .describe("Spotify artist IDs (the 22-character code in an open.spotify.com/artist/... link)."),
    })
    .refine((v) => (v.imdb_ids?.length ?? 0) + (v.spotify_artist_ids?.length ?? 0) > 0, {
      message: "Provide at least one IMDb or Spotify ID.",
    }),
  example: { imdb_ids: ["tt0114369", "tt0246578", "tt1255953", "tt5323662"] },
  async run(input, { qloo }) {
    const lookups: [string, string[]][] = [
      ["external.imdb.ids", input.imdb_ids ?? []],
      ["external.spotify.ids", input.spotify_artist_ids ?? []],
    ];
    const entities: CompactEntity[] = [];
    for (const [param, ids] of lookups) {
      for (let i = 0; i < ids.length; i += 25) {
        const response = await qloo.entities({ [param]: ids.slice(i, i + 25) });
        entities.push(...entityList(response.data).map((e) => compactEntity(e, { maxTags: 5 })));
      }
    }
    const requested = (input.imdb_ids?.length ?? 0) + (input.spotify_artist_ids?.length ?? 0);
    const foundImdb = new Set(entities.map((e) => e.external?.imdb).filter(Boolean));
    const foundSpotify = new Set(entities.map((e) => e.external?.spotify).filter(Boolean));
    // Only report unmatched IDs when the response echoes external IDs back.
    const unmatched =
      foundImdb.size + foundSpotify.size > 0
        ? [
            ...(input.imdb_ids ?? []).filter((id) => !foundImdb.has(id)),
            ...(input.spotify_artist_ids ?? []).filter((id) => !foundSpotify.has(id)),
          ]
        : undefined;
    return {
      status: entities.length === 0 ? "empty" : "ok",
      summary: `Found ${plural(entities.length, "entity")} for ${plural(requested, "ID")}.`,
      data: { entities, unmatched },
    };
  },
});
