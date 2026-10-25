/**
 * Day-1 smoke test: checks the Qloo data Mise depends on, against the live
 * hackathon API (~30 requests).
 *
 *   npm run smoke              live; reads QLOO_API_KEY from the env, .env.local or .env
 *   npm run smoke -- --mock    dry run against the synthetic mock (tests the script, not Qloo)
 *
 * Raw responses are written to .cache/smoke/<timestamp>/ (gitignored). Qloo
 * data must never be committed to the public repo.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  ENTITY_TYPES,
  INSIGHT_MODES,
  QlooError,
  TAG_TYPES,
  compactEntity,
  compactTag,
  createQlooClient,
  entityList,
  extractContributions,
  qlooConfigFromEnv,
  tagList,
  type CompactEntity,
  type InsightsResponse,
  type QlooResult,
} from "../src/lib/qloo";
import { venueTagIds } from "../src/lib/tools/shared";

type Verdict = "PASS" | "WARN" | "FAIL" | "INFO";
interface Check {
  id: string;
  title: string;
  verdict: Verdict;
  detail: string;
}

// IMDb IDs verified against Wikidata (titles from Paritosh's archive).
const VERIFIED_IMDB = {
  tt0114369: "Se7en (1995)",
  tt0246578: "Donnie Darko (2001)",
  tt1255953: "Incendies (2010)",
  tt5323662: "A Silent Voice (2016)",
};
// Non-English titles from the archive/watchlist, resolved by name instead.
const ARCHIVE_TITLES = [
  { name: "Rockstar", year: 2011 },
  { name: "Delhi Belly", year: 2011 },
  { name: "Forgotten", year: 2017 },
  { name: "The Chaser", year: 2008 },
  { name: "Dev.D", year: 2009 },
];
const ARTISTS = ["Prateek Kuhad", "Charli xcx", "Phoebe Bridgers"];
// From Qloo's recipe "resolve-a-spotify-id-to-a-qloo-entity" (Sabrina Carpenter).
const DOCS_SPOTIFY_ID = "74KM79TiuVKeVCqs8QtB0B";
const CITIES = ["Mumbai", "New York City"];
const HOME_CITY = "Raipur"; // nearest big city to Bhilai: coverage is informational only

for (const file of [".env.local", ".env"]) {
  try {
    process.loadEnvFile(file);
  } catch {
    // optional
  }
}

const useMock = process.argv.includes("--mock");
const envConfig = qlooConfigFromEnv();
if (!useMock && envConfig.mode !== "live") {
  console.error("No QLOO_API_KEY found (env, .env.local or .env). Run `npm run smoke -- --mock` for a dry run.");
  process.exit(2);
}
const qloo = createQlooClient({ ...envConfig, mode: useMock ? "mock" : "live", cacheDir: undefined });
const outDir = path.join(".cache", "smoke", new Date().toISOString().replace(/[:.]/g, "-"));
const checks: Check[] = [];
let requests = 0;

async function save(name: string, result: QlooResult<unknown>): Promise<void> {
  requests++;
  await mkdir(outDir, { recursive: true });
  const file = path.join(outDir, `${String(requests).padStart(2, "0")}-${name}.json`);
  await writeFile(file, JSON.stringify({ provenance: result.provenance, warnings: result.warnings, data: result.data }, null, 2));
}

function record(id: string, title: string, verdict: Verdict, detail: string): void {
  checks.push({ id, title, verdict, detail });
  const icon = { PASS: "✔", WARN: "!", FAIL: "✘", INFO: "·" }[verdict];
  console.log(`${icon} [${verdict}] ${title}\n    ${detail}`);
}

async function check(id: string, title: string, body: () => Promise<[Verdict, string]>): Promise<void> {
  try {
    const [verdict, detail] = await body();
    record(id, title, verdict, detail);
  } catch (err) {
    if (err instanceof QlooError) {
      record(id, title, "FAIL", `${err.message}${err.hint ? ` (hint: ${err.hint})` : ""}`);
    } else {
      record(id, title, "FAIL", err instanceof Error ? err.message : String(err));
    }
  }
}

function names(entities: CompactEntity[], max = 6): string {
  return entities.slice(0, max).map((e) => `${e.name}${e.year ? ` (${e.year})` : ""}`).join(", ") || "none";
}

function jaccard(a: string[], b: string[]): number {
  const setA = new Set(a);
  const setB = new Set(b);
  const union = new Set([...setA, ...setB]).size;
  return union === 0 ? 0 : [...setA].filter((x) => setB.has(x)).length / union;
}

async function insightsEntities(name: string, params: Parameters<typeof qloo.insights>[0]) {
  const result = await qloo.insights(params);
  await save(name, result);
  return { result, entities: entityList(result.data).map((e) => compactEntity(e)) };
}

async function main() {
  console.log(`Mise day-1 smoke test: ${qloo.mode.toUpperCase()} against ${qloo.baseUrl}\n`);

  // 0. Connectivity and auth: abort early if the key or host is wrong.
  let authed = true;
  await check("connectivity", "API reachable and key accepted", async () => {
    try {
      const info = await qloo.info();
      await save("info", info);
      return ["PASS", `GET / -> ${info.provenance.status} (${JSON.stringify(info.data).slice(0, 120)})`];
    } catch (err) {
      if (err instanceof QlooError && (err.kind === "auth" || err.kind === "config")) authed = false;
      throw err;
    }
  });
  if (!authed) return;

  // 1. Film import by IMDb ID (TMDB -> IMDb -> Qloo).
  const filmIds: string[] = [];
  await check("imdb_import", "IMDb IDs resolve via /entities", async () => {
    const result = await qloo.entities({ "external.imdb.ids": Object.keys(VERIFIED_IMDB) });
    await save("entities-imdb", result);
    const found = entityList(result.data).map((e) => compactEntity(e));
    filmIds.push(...found.map((e) => e.id));
    const echoed = found.filter((e) => e.external?.imdb).length;
    const verdict = found.length >= 3 ? "PASS" : found.length > 0 ? "WARN" : "FAIL";
    return [verdict, `${found.length}/4 found: ${names(found)}. External IMDb IDs echoed on ${echoed}.`];
  });

  // 2. Non-English archive titles by name + year.
  await check("archive_search", "Hindi/Korean archive titles resolve by name", async () => {
    const lines: string[] = [];
    let hits = 0;
    for (const title of ARCHIVE_TITLES) {
      const result = await qloo.search({ query: title.name, types: ENTITY_TYPES.movie, take: 5 });
      await save(`search-${title.name}`, result);
      const match = entityList(result.data)
        .map((e) => compactEntity(e))
        .find((e) => e.year === title.year);
      if (match) {
        hits++;
        filmIds.push(match.id);
      }
      lines.push(`${title.name} (${title.year}): ${match ? `found${match.external?.imdb ? ` ${match.external.imdb}` : ""}` : "missing"}`);
    }
    return [hits >= 4 ? "PASS" : hits >= 2 ? "WARN" : "FAIL", `${hits}/${ARCHIVE_TITLES.length}. ${lines.join("; ")}`];
  });

  // 3. Artists, including an Indian indie act, plus a Spotify ID lookup.
  const artistIds = new Map<string, string>();
  await check("artists", "Artists resolve (incl. Indian indie) and Spotify import works", async () => {
    for (const artist of ARTISTS) {
      const result = await qloo.search({ query: artist, types: ENTITY_TYPES.artist, take: 5 });
      await save(`search-${artist}`, result);
      const match = entityList(result.data).find((e) => e.name.toLowerCase() === artist.toLowerCase());
      if (match) artistIds.set(artist, match.entity_id);
    }
    const spotify = await qloo.entities({ "external.spotify.ids": DOCS_SPOTIFY_ID });
    await save("entities-spotify", spotify);
    const viaSpotify = entityList(spotify.data)[0]?.name ?? "nothing";
    const missing = ARTISTS.filter((a) => !artistIds.has(a));
    const verdict = missing.length === 0 ? "PASS" : missing.length < ARTISTS.length ? "WARN" : "FAIL";
    return [verdict, `Found ${artistIds.size}/${ARTISTS.length}${missing.length ? ` (missing: ${missing.join(", ")})` : ""}. Spotify ${DOCS_SPOTIFY_ID} -> ${viaSpotify}.`];
  });

  const [artistA, artistB] = [...artistIds.entries()];
  if (!artistA) {
    record("abort", "Remaining checks need at least one artist", "FAIL", "No artist resolved; see artists check.");
    return;
  }
  const [nameA, idA] = artistA;

  // 4. Cross-domain: different artists -> different film references, with explanations.
  let baseline: CompactEntity[] = [];
  await check("refs_differ", "Different artists give clearly different film references", async () => {
    const a = await insightsEntities(`movies-${nameA}`, {
      "filter.type": ENTITY_TYPES.movie,
      "signal.interests.entities": idA,
      "feature.explainability": true,
      take: 15,
    });
    baseline = a.entities;
    const raw = (a.result.data as InsightsResponse).results?.entities?.[0]?.query?.explainability;
    const explain = raw === undefined
      ? "no explainability returned"
      : `explainability keys: ${Object.keys(raw as object).join(", ") || "(empty)"}; parsed ${extractContributions(raw).length} contributions`;
    if (!artistB) return ["WARN", `${nameA}: ${names(a.entities)}. Only one artist resolved, so no comparison. ${explain}.`];
    const b = await insightsEntities(`movies-${artistB[0]}`, {
      "filter.type": ENTITY_TYPES.movie,
      "signal.interests.entities": artistB[1],
      take: 15,
    });
    const overlap = jaccard(a.entities.map((e) => e.id), b.entities.map((e) => e.id));
    const verdict = a.entities.length === 0 ? "FAIL" : overlap < 0.5 ? "PASS" : "WARN";
    return [verdict, `overlap ${overlap.toFixed(2)}. ${nameA}: ${names(a.entities)} | ${artistB[0]}: ${names(b.entities)}. ${explain}.`];
  });

  // 5. Deep cuts via popularity ceiling; 6. era filter.
  await check("deep_cuts", "filter.popularity.max surfaces less-obvious references", async () => {
    const { entities } = await insightsEntities(`movies-${nameA}-deep`, {
      "filter.type": ENTITY_TYPES.movie,
      "signal.interests.entities": idA,
      "filter.popularity.max": 0.7,
      take: 15,
    });
    const overThreshold = entities.filter((e) => (e.popularity ?? 0) > 0.7).length;
    const overlap = jaccard(entities.map((e) => e.id), baseline.map((e) => e.id));
    const verdict = entities.length === 0 ? "FAIL" : overThreshold === 0 && overlap < 0.8 ? "PASS" : "WARN";
    return [verdict, `${entities.length} results, ${overThreshold} above 0.7, overlap with default ${overlap.toFixed(2)}: ${names(entities)}`];
  });

  await check("era_filter", "filter.release_year pins an era", async () => {
    const { entities } = await insightsEntities(`movies-${nameA}-90s`, {
      "filter.type": ENTITY_TYPES.movie,
      "signal.interests.entities": idA,
      "filter.release_year.min": 1990,
      "filter.release_year.max": 1999,
      take: 10,
    });
    const outside = entities.filter((e) => e.year !== undefined && (e.year < 1990 || e.year > 1999)).length;
    return [entities.length > 0 && outside === 0 ? "PASS" : "WARN", `${entities.length} results, ${outside} outside the 90s: ${names(entities)}`];
  });

  // 7. Wardrobe brands.
  await check("brands", "Brand insights from an artist return fashion/lifestyle brands", async () => {
    const { entities } = await insightsEntities(`brands-${nameA}`, {
      "filter.type": ENTITY_TYPES.brand,
      "signal.interests.entities": idA,
      take: 15,
    });
    const fashion = entities.filter((e) => e.tags.some((t) => /fashion|apparel|cloth|wear|footwear|luxury/i.test(t))).length;
    return [entities.length >= 5 ? "PASS" : entities.length > 0 ? "WARN" : "FAIL", `${entities.length} brands (${fashion} with fashion-like tags): ${names(entities, 8)}`];
  });

  // 8. Audience taste vocabulary; 9. demographics.
  await check("audience_tags", "urn:tag gives a usable taste vocabulary for an artist", async () => {
    const result = await qloo.insights({
      "filter.type": INSIGHT_MODES.tag,
      "signal.interests.entities": idA,
      "filter.tag.types": [TAG_TYPES.keyword_media, TAG_TYPES.style, TAG_TYPES.ambience],
      take: 15,
    });
    await save(`tags-${nameA}`, result);
    const tags = tagList(result.data).map(compactTag);
    return [tags.length >= 5 ? "PASS" : tags.length > 0 ? "WARN" : "FAIL", `${tags.length} tags: ${tags.slice(0, 10).map((t) => t.name).join(", ")}`];
  });

  await check("demographics", "urn:demographics returns age/gender skew", async () => {
    const result = await qloo.insights({ "filter.type": INSIGHT_MODES.demographics, "signal.interests.entities": idA });
    await save(`demographics-${nameA}`, result);
    const block = (result.data as InsightsResponse).results?.demographics?.[0];
    return [block?.query?.age ? "PASS" : "WARN", block ? JSON.stringify(block.query) : "no demographics returned"];
  });

  // 10. Director's archive vs artist: the "your voice, their taste" step.
  await check("compare", "/v2/analysis/compare finds shared traits (archive vs artist)", async () => {
    if (filmIds.length === 0) return ["WARN", "Skipped: no archive films resolved."];
    const result = await qloo.compare({
      "a.signal.interests.entities": filmIds.slice(0, 10),
      "b.signal.interests.entities": idA,
      take: 15,
    });
    await save(`compare-archive-${nameA}`, result);
    const tags = tagList(result.data).map(compactTag);
    return [tags.length >= 3 ? "PASS" : tags.length > 0 ? "WARN" : "FAIL", `${tags.length} shared traits: ${tags.slice(0, 10).map((t) => t.name).join(", ")}`];
  });

  // 11. Ambience tags for locations. /v2/tags needs a query: type filters alone return nothing (2026-10-25).
  const ambienceIds: string[] = [];
  await check("ambience_tags", "Ambience tags exist and semantic tag search works", async () => {
    const listed = await qloo.tags({
      "filter.query": "cozy",
      "feature.semantic_search": true,
      "filter.tag.types": TAG_TYPES.ambience,
      "filter.parents.types": ENTITY_TYPES.place,
      take: 10,
    });
    await save("tags-ambience", listed);
    const ambience = tagList(listed.data).map(compactTag);
    const semantic = await qloo.tags({
      "filter.query": "intimate",
      "feature.semantic_search": true,
      "filter.tag.types": TAG_TYPES.ambience,
      "filter.parents.types": ENTITY_TYPES.place,
      take: 10,
    });
    await save("tags-semantic-intimate", semantic);
    const candidates = tagList(semantic.data).map(compactTag);
    ambienceIds.push(...candidates.slice(0, 3).map((t) => t.id).filter(Boolean));
    const verdict = ambience.length > 0 && candidates.length > 0 ? "PASS" : ambience.length + candidates.length > 0 ? "WARN" : "FAIL";
    return [verdict, `"cozy" -> ${ambience.slice(0, 5).map((t) => t.id).join(", ") || "none"}; "intimate" -> ${candidates.slice(0, 5).map((t) => t.id).join(", ") || "none"}`];
  });

  // 12. Locations with photos in demo cities: as-is, then the way scout_locations asks
  // (filmable venue kinds as the filter, ambience as a ranking signal).
  for (const city of CITIES) {
    await check(`locations_${city}`, `Filmable places with photos in ${city}`, async () => {
      const base = await insightsEntities(`places-${city}`, {
        "filter.type": ENTITY_TYPES.place,
        "filter.location.query": city,
        "signal.interests.entities": idA,
        "filter.exists": "properties.image",
        take: 15,
      });
      let tagged: CompactEntity[] = [];
      if (ambienceIds.length > 0) {
        tagged = (
          await insightsEntities(`places-${city}-ambience`, {
            "filter.type": ENTITY_TYPES.place,
            "filter.location.query": city,
            "signal.interests.entities": idA,
            "filter.tags": venueTagIds(["cafe", "bar", "music_venue", "gallery", "bookstore"]),
            "operator.filter.tags": "union",
            "signal.interests.tags": ambienceIds,
            "operator.signal.interests.tags": "union",
            "filter.exists": "properties.image",
            take: 15,
          })
        ).entities;
      }
      const verdict = base.entities.length >= 5 ? (tagged.length >= 3 || ambienceIds.length === 0 ? "PASS" : "WARN") : base.entities.length > 0 ? "WARN" : "FAIL";
      return [verdict, `${base.entities.length} with photos (${names(base.entities, 5)}); ${tagged.length} filmable and ranked by ambience (${names(tagged, 5)})`];
    });
  }

  await check("home_city", `Coverage near Bhilai (${HOME_CITY}), informational`, async () => {
    try {
      const { entities } = await insightsEntities(`places-${HOME_CITY}`, {
        "filter.type": ENTITY_TYPES.place,
        "filter.location.query": HOME_CITY,
        take: 10,
      });
      return ["INFO", `${entities.length} places: ${names(entities, 5)}`];
    } catch (err) {
      if (err instanceof QlooError && err.kind === "bad_request") return ["INFO", `Not resolvable: ${err.message}`];
      throw err;
    }
  });

  // 13. Entity-type probes for the unresolved doc conflicts.
  await check("type_probes", "Which disputed entity types the hackathon host accepts", async () => {
    const results: string[] = [];
    for (const type of ["urn:entity:videogame", "urn:entity:video_game", "urn:entity:destination"]) {
      try {
        const result = await qloo.insights({ "filter.type": type, "signal.interests.entities": idA, take: 3 });
        await save(`probe-${type.split(":").pop()}`, result);
        results.push(`${type}: ${result.provenance.status} (${entityList(result.data).length} results)`);
      } catch (err) {
        results.push(`${type}: ${err instanceof QlooError ? `${err.status ?? err.kind}` : "error"}`);
      }
    }
    return ["INFO", results.join("; ")];
  });

  // 14. Trending series (not used by Mise yet, so informational).
  await check("trending", "/v2/trending returns a weekly series", async () => {
    const id = filmIds[0] ?? baseline[0]?.id;
    if (!id) return ["WARN", "Skipped: no film ID available."];
    const end = new Date();
    const start = new Date(end.getTime() - 84 * 24 * 60 * 60 * 1000);
    const result = await qloo.trending({
      "filter.type": ENTITY_TYPES.movie,
      "signal.interests.entities": id,
      "filter.start_date": start.toISOString().slice(0, 10),
      "filter.end_date": end.toISOString().slice(0, 10),
    });
    await save("trending", result);
    const points = (result.data as { results?: { trending?: unknown[] } }).results?.trending?.length ?? 0;
    return ["INFO", `${points} weekly points`];
  });
}

main()
  .catch((err) => record("crash", "Smoke test crashed", "FAIL", err instanceof Error ? err.stack ?? err.message : String(err)))
  .finally(async () => {
    const count = (v: Verdict) => checks.filter((c) => c.verdict === v).length;
    await mkdir(outDir, { recursive: true });
    await writeFile(path.join(outDir, "summary.json"), JSON.stringify({ mode: qloo.mode, requests, checks }, null, 2));
    console.log(
      `\n${count("PASS")} pass, ${count("WARN")} warn, ${count("FAIL")} fail, ${count("INFO")} info; ${requests} requests.` +
        `\nRaw responses: ${outDir} (gitignored; do not commit).`,
    );
    process.exitCode = count("FAIL") > 0 ? 1 : 0;
  });
