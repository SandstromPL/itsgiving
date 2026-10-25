import { getQlooClient, type CompactEntity, type QlooClient } from "../qloo";
import { TmdbClient, imdbIdsIn, tmdbConfigFromEnv, tmdbListId } from "../tmdb";
import { runTool } from "../tools/registry";
import { IMPORT_LIMIT } from "./options";

// Director taste import: a public TMDB list, or pasted IMDb links, becomes up to IMPORT_LIMIT films that Qloo knows
// exactly by IMDb ID. They join the brief as director_imdb_ids, and the pipeline compares them with the audience
// (taste_overlap). Only titles and IMDb IDs move: nothing about the list's owner is kept or sent to Qloo.

export interface ImportedFilm {
  imdb: string;
  /** As Qloo names it. */
  title: string;
  year?: number;
}

export interface TasteImport {
  source: { kind: "tmdb"; id: string; name: string; total: number } | { kind: "imdb"; total: number };
  /** In Qloo's catalog, in the list's order. */
  found: ImportedFilm[];
  /** Read but not usable: TMDB has no IMDb ID for it, or Qloo doesn't list it (mostly short films). */
  missing: { title: string; year?: number; reason: "no_imdb" | "not_in_qloo" }[];
}

/** A failure the director can act on; the message says what to do. */
export class TasteImportError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
    this.name = "TasteImportError";
  }
}

export interface TasteDeps {
  tmdb: TmdbClient;
  qloo: QlooClient;
}

/** The TMDB client is cheap, so it's built per request: a key added to .env.local works without a restart. */
export function getTasteDeps(): TasteDeps {
  return { tmdb: new TmdbClient(tmdbConfigFromEnv()), qloo: getQlooClient() };
}

async function inPool<T, R>(items: T[], size: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        results[i] = await work(items[i]);
      }
    }),
  );
  return results;
}

export async function importTaste(text: string, deps: TasteDeps, signal?: AbortSignal): Promise<TasteImport> {
  const listId = tmdbListId(text);
  const pasted = imdbIdsIn(text);
  let source: TasteImport["source"];
  let wanted: { imdb?: string; title: string; year?: number }[];
  if (listId) {
    const list = await deps.tmdb.list(listId, IMPORT_LIMIT, signal);
    // Six at a time stays well under TMDB's 40 requests a second.
    const ids = await inPool(list.items, 6, (item) => deps.tmdb.imdbId(item, signal));
    source = { kind: "tmdb", id: list.id, name: list.name, total: list.total };
    wanted = list.items.map((item, i) => ({ imdb: ids[i], title: item.title, year: item.year }));
  } else if (pasted.length > 0) {
    source = { kind: "imdb", total: pasted.length };
    wanted = pasted.slice(0, IMPORT_LIMIT).map((imdb) => ({ imdb, title: imdb }));
  } else {
    throw new TasteImportError("Paste a TMDB list link (themoviedb.org/list/…) or IMDb title links (imdb.com/title/tt…).");
  }

  // Sorted, so the same set of films is the same Qloo request (and a cache hit) however the list was ordered.
  const ids = [...new Set(wanted.flatMap((w) => (w.imdb ? [w.imdb] : [])))].sort();
  let entities: CompactEntity[] = [];
  if (ids.length > 0) {
    const result = await runTool("import_external_ids", { imdb_ids: ids }, { qloo: deps.qloo, signal });
    if (result.status === "error") throw new TasteImportError(`Qloo couldn't look these films up: ${result.summary}`, 502);
    entities = (result.data as { entities: CompactEntity[] }).entities;
  }
  const byImdb = new Map(entities.flatMap((e) => (e.external?.imdb ? [[e.external.imdb, e] as const] : [])));

  const found: ImportedFilm[] = [];
  const missing: TasteImport["missing"] = [];
  for (const w of wanted) {
    const entity = w.imdb ? byImdb.get(w.imdb) : undefined;
    if (w.imdb && entity) {
      if (!found.some((f) => f.imdb === w.imdb))
        found.push({ imdb: w.imdb, title: entity.name, ...(entity.year ? { year: entity.year } : {}) });
    } else {
      missing.push({ title: w.title, ...(w.year ? { year: w.year } : {}), reason: w.imdb ? "not_in_qloo" : "no_imdb" });
    }
  }
  return { source, found, missing };
}
