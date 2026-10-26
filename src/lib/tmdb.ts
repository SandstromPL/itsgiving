import { defaultSleep, type FetchLike } from "./qloo";

// The Movie Database, used for two things. It turns a director's public TMDB list into IMDb IDs, which Qloo looks up
// exactly (/entities with external.imdb.ids), so an imported film never needs the ambiguity picker. And it gives a
// reference film's still: Qloo's image of a film is its poster, whose own lettering fights a treatment's title.
// Server-side only: the key never reaches the browser. Checked against developer.themoviedb.org on 2026-10-25: list
// details are GET /3/list/{id} (paged), IMDb IDs come from GET /3/{movie|tv}/{id}/external_ids, the limit is about 40
// requests a second, and a read access token goes in a Bearer header while a v3 API key goes in the api_key query
// parameter. GET /3/find/{imdb_id}?external_source=imdb_id gives a film's backdrop_path (live, 2026-10-26: film frames
// without lettering, e.g. Darlings, Riceboy Sleeps), served from image.tmdb.org/t/p/{size}{path}.

export const TMDB_BASE_URL = "https://api.themoviedb.org";
export const TMDB_IMAGE_URL = "https://image.tmdb.org/t/p";

export interface TmdbConfig {
  apiKey?: string;
  baseUrl: string;
}

export function tmdbConfigFromEnv(env: Record<string, string | undefined> = process.env): TmdbConfig {
  return { apiKey: env.TMDB_API_KEY?.trim() || undefined, baseUrl: env.TMDB_BASE_URL?.trim() || TMDB_BASE_URL };
}

/** A failure worth showing the director as is: it says what went wrong and what to do. */
export class TmdbError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "TmdbError";
  }
}

export interface TmdbListItem {
  tmdbId: number;
  kind: "movie" | "tv";
  title: string;
  year?: number;
}

export interface TmdbList {
  id: string;
  name: string;
  /** Items on the whole list, which can be more than were read. */
  total: number;
  items: TmdbListItem[];
}

/** "https://www.themoviedb.org/list/8273455-favourites", "themoviedb.org/list/8273455" or "8273455" -> "8273455". */
export function tmdbListId(text: string): string | undefined {
  const trimmed = text.trim();
  const fromLink = /themoviedb\.org\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?list\/(\d{1,12})/i.exec(trimmed);
  if (fromLink) return fromLink[1];
  return /^\d{1,12}$/.test(trimmed) ? trimmed : undefined;
}

/** Every IMDb title ID in pasted text (links or bare IDs), once each, in order. */
export function imdbIdsIn(text: string): string[] {
  return [...new Set(text.match(/\btt\d{7,10}\b/g) ?? [])];
}

interface RawItem {
  id?: number;
  media_type?: string;
  title?: string;
  name?: string;
  release_date?: string;
  first_air_date?: string;
}

interface RawList {
  name?: string;
  item_count?: number;
  total_pages?: number;
  /** v3 calls the items `items`; v4 calls them `results`. */
  items?: RawItem[];
  results?: RawItem[];
}

function toItem(raw: RawItem): TmdbListItem[] {
  // Lists can also hold people and collections; only films and series have IMDb title IDs.
  const kind = raw.media_type === "tv" ? "tv" : raw.media_type === "movie" || raw.media_type === undefined ? "movie" : undefined;
  const title = (raw.title ?? raw.name)?.trim();
  if (!kind || typeof raw.id !== "number" || !title) return [];
  const year = Number((raw.release_date ?? raw.first_air_date ?? "").slice(0, 4));
  return [{ tmdbId: raw.id, kind, title, ...(year > 1800 ? { year } : {}) }];
}

function problemFor(status: number): string {
  if (status === 401) return "TMDB rejected this server's key. Check TMDB_API_KEY.";
  if (status === 404) return "TMDB has no public list with that ID. Check the link, and that the list is public.";
  if (status === 429) return "TMDB is busy (rate limited). Try again in a few seconds.";
  return `TMDB returned ${status}. Try again in a moment.`;
}

export class TmdbClient {
  constructor(private readonly options: TmdbConfig & { fetch?: FetchLike; timeoutMs?: number }) {}

  get configured(): boolean {
    return Boolean(this.options.apiKey);
  }

  private async get<T>(path: string, params: Record<string, string | number>, signal?: AbortSignal): Promise<T> {
    const key = this.options.apiKey;
    if (!key) throw new TmdbError("TMDB import isn't set up on this server (TMDB_API_KEY is empty). Paste IMDb links instead.", 503);
    // A read access token is a JWT, kept out of URLs and logs; a v3 API key can only travel as a query parameter.
    const bearer = key.startsWith("eyJ");
    const query = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]));
    if (!bearer) query.set("api_key", key);
    // Two attempts: a fresh connection to TMDB sometimes drops (seen live, 2026-10-25), and a busy TMDB recovers fast.
    for (let attempt = 1; ; attempt++) {
      const timeout = AbortSignal.timeout(this.options.timeoutMs ?? 8_000);
      let response: Response;
      try {
        response = await (this.options.fetch ?? fetch)(`${this.options.baseUrl}${path}?${query}`, {
          headers: { Accept: "application/json", ...(bearer ? { Authorization: `Bearer ${key}` } : {}) },
          signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
        });
      } catch {
        signal?.throwIfAborted();
        if (attempt < 2 && !timeout.aborted) {
          await defaultSleep(300, signal);
          continue;
        }
        throw new TmdbError(timeout.aborted ? "TMDB took too long to answer. Try again." : "Couldn't reach TMDB. Try again.");
      }
      if ((response.status === 429 || response.status >= 500) && attempt < 2) {
        await defaultSleep(600, signal);
        continue;
      }
      if (!response.ok) throw new TmdbError(problemFor(response.status), response.status);
      return (await response.json()) as T;
    }
  }

  /** Up to `max` films and series from a public list, in the list's order. */
  async list(id: string, max: number, signal?: AbortSignal): Promise<TmdbList> {
    const items: TmdbListItem[] = [];
    const seen = new Set<string>();
    let name = "";
    let total = 0;
    for (let page = 1; page <= 5 && items.length < max; page++) {
      const data = await this.get<RawList>(`/3/list/${id}`, { page }, signal);
      name ||= data.name?.trim() ?? "";
      total = data.item_count ?? total;
      const raw = data.items ?? data.results ?? [];
      const fresh = raw.flatMap(toItem).filter((item) => !seen.has(`${item.kind}:${item.tmdbId}`));
      for (const item of fresh) seen.add(`${item.kind}:${item.tmdbId}`);
      items.push(...fresh);
      // Older list responses carry no total_pages: page on only while item_count says more exist and pages add items.
      const more = data.total_pages !== undefined ? page < data.total_pages : fresh.length > 0 && items.length < total;
      if (!more) break;
    }
    return { id, name: name || `TMDB list ${id}`, total: Math.max(total, items.length), items: items.slice(0, max) };
  }

  /** The IMDb ID TMDB holds for a film or series, if it has one. */
  async imdbId(item: TmdbListItem, signal?: AbortSignal): Promise<string | undefined> {
    const data = await this.get<{ imdb_id?: string | null }>(`/3/${item.kind}/${item.tmdbId}/external_ids`, {}, signal);
    return data.imdb_id && /^tt\d{7,10}$/.test(data.imdb_id) ? data.imdb_id : undefined;
  }

  /** A film's (or series') backdrop by its IMDb ID, as a 1280 px image URL, if TMDB has one. */
  async backdrop(imdbId: string, signal?: AbortSignal): Promise<string | undefined> {
    if (!/^tt\d{7,10}$/.test(imdbId)) return undefined;
    type Found = { backdrop_path?: string | null };
    const data = await this.get<{ movie_results?: Found[]; tv_results?: Found[] }>(
      `/3/find/${imdbId}`,
      { external_source: "imdb_id" },
      signal,
    );
    const path = (data.movie_results?.[0] ?? data.tv_results?.[0])?.backdrop_path;
    return path && /^\/[\w-]+\.(jpg|png|webp)$/.test(path) ? `${TMDB_IMAGE_URL}/w1280${path}` : undefined;
  }
}
