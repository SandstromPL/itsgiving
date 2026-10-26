import { z } from "zod";
import { compactEntity, entityList, entityUrn, localityKind, type CompactEntity, type QlooEntity } from "../qloo";
import { SEARCHABLE_KINDS, defineTool, normalizeName, plural } from "./shared";

type Resolution =
  /**
   * `among` is set when several titles matched exactly and this one was far better known; `note` says when a
   * place name was read as something other than Qloo's first match.
   */
  | { input: string; status: "resolved"; match: CompactEntity; among?: number; note?: string }
  /** `exact` is false when no candidate has the name as typed: they are near misses, and may all be wrong. */
  | { input: string; status: "ambiguous"; candidates: CompactEntity[]; exact: boolean }
  | { input: string; status: "not_found" };

const itemSchema = z.strictObject({
  name: z.string().min(1).describe('The name as the user wrote it, e.g. "Prateek Kuhad" or "In the Mood for Love".'),
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
    const sameCity = exact.filter((c) => normalizeName(`${c.place?.city ?? ""} ${c.disambiguation ?? ""}`).includes(city));
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
  if (exact.length > 0) return { input: item.name, status: "ambiguous", candidates: exact.slice(0, 5), exact: true };
  // Nothing has the name as typed. Search still returns Qloo's closest names, which for an artist it doesn't have
  // are other artists entirely (live "Chaar Diwaari" gave "Chaartaar"), so only plausible slips are offered.
  const near = candidates.filter((c) => nearMiss(wanted, normalizeName(c.name)));
  return near.length > 0
    ? { input: item.name, status: "ambiguous", candidates: near.slice(0, 5), exact: false }
    : { input: item.name, status: "not_found" };
}

/** How much more popular (0-1 percentile) one same-name title must be to be taken without asking. */
export const DOMINANT_GAP = 0.5;

/** Levenshtein distance between two normalized names. */
function editDistance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++)
      row[j] = Math.min(previous[j] + 1, row[j - 1] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    previous = row;
  }
  return previous[b.length];
}

/**
 * A candidate worth asking about when nothing matched exactly: a small typo away ("Radiohed"), or sharing a whole
 * word of three letters or more with what was typed ("Kendrick" for Kendrick Lamar).
 */
export function nearMiss(wanted: string, name: string): boolean {
  if (editDistance(wanted, name) <= Math.max(1, Math.floor(wanted.length / 6))) return true;
  const words = new Set(wanted.split(" ").filter((word) => word.length >= 3));
  return name.split(" ").some((word) => words.has(word));
}

/** Qloo names some states and counties after their main city; a shoot city of that name means the city. */
const WIDER_THAN_A_CITY = new Set(["state", "county", "region", "province", "country"]);

/**
 * A city is never worth a question: take Qloo's first exact match, except that a state or county sharing
 * its name with a city means the city. Live Qloo lists New York State before New York City, and Los Angeles
 * County before the city; Delhi's first match is the state, with no same-name city, so it stays.
 */
function pickLocality(item: z.output<typeof itemSchema>, entities: QlooEntity[]): Resolution {
  if (entities.length === 0) return { input: item.name, status: "not_found" };
  const wanted = normalizeName(item.name);
  const exact = entities.filter((e) => normalizeName(e.name) === wanted);
  const first = exact[0] ?? entities[0];
  const kind = localityKind(first);
  const city = kind && WIDER_THAN_A_CITY.has(kind) ? exact.find((e) => localityKind(e) === "city") : undefined;
  const match = compactEntity(city ?? first, { maxTags: 3 });
  if (!city) return { input: item.name, status: "resolved", match };
  return {
    input: item.name,
    status: "resolved",
    match,
    note: `Qloo's first match for "${item.name}" is the ${kind}, so itsgiving used the city.`,
  };
}

export const resolveEntities = defineTool({
  name: "resolve_entities",
  description:
    "Turn names the user mentions (artists, films, TV shows, brands, places, people, cities) into Qloo entity IDs. " +
    "Call this before any other Qloo tool whenever you only have a name, and again whenever the user adds new references. " +
    "Each item comes back resolved, ambiguous (with up to 5 candidates; exact is false when they are only near misses) " +
    "or not found. For ambiguous or missing items, ask the user which one they mean instead of guessing. An artist with " +
    "no exact match is also looked for among people, since Qloo files some musicians only there. Cities (type locality) " +
    "always resolve to the best match.",
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
    const search = async (name: string, type: z.output<typeof itemSchema>["type"]) =>
      entityList((await qloo.search({ query: name, types: entityUrn(type), take: 5 })).data);
    const compact = (entities: QlooEntity[]) => entities.map((e) => compactEntity(e, { maxTags: 5 }));
    const items = await Promise.all(
      input.items.map(async (item): Promise<Resolution> => {
        const entities = await search(item.name, item.type);
        if (item.type === "locality") return pickLocality(item, entities);
        const found = pick(item, compact(entities));
        if (item.type !== "artist" || found.status === "resolved" || (found.status === "ambiguous" && found.exact)) return found;
        // Qloo files some musicians only as people: live "Raftaar" is a person, not an artist (2026-10-26), and a
        // person's fans are an audience like any other.
        const person = pick({ ...item, type: "person" }, compact(await search(item.name, "person")));
        if (person.status === "resolved") {
          return {
            ...person,
            note: `Qloo lists ${person.match.name} as a person rather than a music artist, so the audience comes from that entry.`,
          };
        }
        return person.status === "ambiguous" && person.exact ? person : found;
      }),
    );
    const resolved = items.filter((i) => i.status === "resolved").length;
    const unclear = items.filter((i) => i.status !== "resolved").map((i) => `"${i.input}" (${i.status.replace("_", " ")})`);
    return {
      status: resolved === items.length ? "ok" : resolved === 0 && items.every((i) => i.status === "not_found") ? "empty" : "needs_input",
      summary: `Resolved ${resolved}/${items.length}.` + (unclear.length > 0 ? ` Ask the user about ${unclear.join(", ")}.` : ""),
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
      summary: `Found ${plural(entities.length, "entity", "entities")} for ${plural(requested, "ID")}.`,
      data: { entities, unmatched },
    };
  },
});
