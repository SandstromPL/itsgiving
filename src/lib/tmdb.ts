import { request } from "node:https";
import { defaultSleep, type FetchLike } from "./qloo";

// The Movie Database, used for three things. It turns a director's public TMDB list into IMDb IDs, which Qloo looks up
// exactly (/entities with external.imdb.ids), so an imported film never needs the ambiguity picker. It gives a
// reference film's still: Qloo's image of a film is its poster, whose own lettering fights a treatment's title. And it
// names people, which Qloo doesn't: a reference's characters, for a treatment's characters to be drawn from, and the
// parts an actor is known for.
// Server-side only: the key never reaches the browser. Checked against developer.themoviedb.org on 2026-10-25: list
// details are GET /3/list/{id} (paged), IMDb IDs come from GET /3/{movie|tv}/{id}/external_ids, the limit is about 40
// requests a second, and a read access token goes in a Bearer header while a v3 API key goes in the api_key query
// parameter. GET /3/find/{imdb_id}?external_source=imdb_id gives a film's backdrop_path (live, 2026-10-26: film frames
// without lettering, e.g. Darlings, Riceboy Sleeps), served from image.tmdb.org/t/p/{size}{path}. Live, 2026-10-29: a
// film's characters come from /3/movie/{id}/credits, a series' from /3/tv/{id}/aggregate_credits (each actor's parts
// across its seasons), and an actor's parts from /3/person/{id}/combined_credits.

export const TMDB_BASE_URL = "https://api.themoviedb.org";
export const TMDB_IMAGE_URL = "https://image.tmdb.org/t/p";

export interface TmdbConfig {
  apiKey?: string;
  baseUrl: string;
}

export function tmdbConfigFromEnv(env: Record<string, string | undefined> = process.env): TmdbConfig {
  return { apiKey: env.TMDB_API_KEY?.trim() || undefined, baseUrl: env.TMDB_BASE_URL?.trim() || TMDB_BASE_URL };
}

/** A failure worth showing the director as is: it says what went wrong and what to do. `cause` is for the logs. */
export class TmdbError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    cause?: unknown,
  ) {
    super(message, { cause });
    this.name = "TmdbError";
  }
}

/**
 * A GET over IPv4 only, as a fetch. TMDB's API sits on CloudFront, which lists eight IPv6 addresses and four IPv4 ones.
 * From a network whose IPv6 route to them is broken, Node's own fetch (it gives each address 250 ms) failed whole
 * bursts of lookups with ETIMEDOUT once its first connections had closed: 16 of 32 in a local test (2026-10-27), and
 * still 8 of 32 with 1.5 s an address. Over IPv4 alone, none of 32 failed. Connections are kept alive between calls,
 * unless `fresh` asks for a new one.
 */
function ipv4Get(url: string, init: RequestInit | undefined, fresh: boolean): Promise<Response> {
  return new Promise((resolve, reject) => {
    const req = request(
      url,
      {
        method: "GET",
        family: 4,
        headers: Object.fromEntries(new Headers(init?.headers)),
        signal: init?.signal ?? undefined,
        ...(fresh ? { agent: false } : {}),
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("error", reject);
        res.on("end", () => {
          const status = res.statusCode ?? 502;
          resolve(new Response(status === 204 || status === 304 ? null : Buffer.concat(chunks), { status }));
        });
      },
    );
    req.on("error", reject);
    req.end();
  });
}

export const ipv4Fetch: FetchLike = (url, init) => ipv4Get(url, init, false);

/**
 * The same GET over a connection of its own, for a retry. A run's lookups come in bursts with long gaps between them
 * (the writer thinks for 40 s or more), and a kept-alive connection TMDB has dropped meanwhile fails with ECONNRESET;
 * the retry could draw another such connection from the pool, and did for 1 of 8 actors in each of two featured
 * builds (2026-10-29).
 */
export const freshIpv4Fetch: FetchLike = (url, init) => ipv4Get(url, init, true);

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

/** A film or series as TMDB knows it, found by its IMDb ID. */
export interface TmdbFound {
  kind: "movie" | "tv";
  tmdbId: number;
  /** A 1280 px frame without lettering, when TMDB has one. */
  still?: string;
}

/** One of a title's characters as TMDB credits it: Anna, played by Jessie Buckley. */
export interface TmdbCharacter {
  name: string;
  actor: string;
}

/** A part an actor is known for, as TMDB credits it. */
export interface KnownRole {
  character: string;
  title: string;
  year?: number;
}

/** At most this many requests in flight per client: six stays well under TMDB's 40 requests a second. */
const IN_FLIGHT = 6;

/** Credits that aren't a part to draw on: playing oneself, hosting, narrating, a voice, an uncredited extra. */
const NOT_A_PART = /^(self|himself|herself|themselves|narrator|host|guest|various)\b|\((voice|uncredited)\)/i;

/** TMDB's genres for news, reality and talk shows: an appearance on one isn't a part. */
const NOT_A_SHOW = new Set([10763, 10764, 10767]);

/** A character's name as credited, tidied, or undefined when the credit isn't a part. */
function partName(raw: unknown): string | undefined {
  const name = typeof raw === "string" ? raw.replace(/\s+/g, " ").trim() : "";
  return name && !NOT_A_PART.test(name) ? name.slice(0, 60).trim() : undefined;
}

function stillUrl(path: unknown): string | undefined {
  return typeof path === "string" && /^\/[\w-]+\.(jpg|png|webp)$/.test(path) ? `${TMDB_IMAGE_URL}/w1280${path}` : undefined;
}

function problemFor(status: number): string {
  if (status === 401) return "TMDB rejected this server's key. Check TMDB_API_KEY.";
  if (status === 404) return "TMDB has no public list with that ID. Check the link, and that the list is public.";
  if (status === 429) return "TMDB is busy (rate limited). Try again in a few seconds.";
  return `TMDB returned ${status}. Try again in a moment.`;
}

export class TmdbClient {
  private active = 0;
  private readonly waiting: (() => void)[] = [];

  constructor(private readonly options: TmdbConfig & { fetch?: FetchLike; timeoutMs?: number }) {}

  get configured(): boolean {
    return Boolean(this.options.apiKey);
  }

  /** Runs `work` once fewer than IN_FLIGHT requests are out. A finished request hands its place to the next in line. */
  private async inTurn<T>(work: () => Promise<T>): Promise<T> {
    if (this.active < IN_FLIGHT) this.active++;
    else await new Promise<void>((resolve) => this.waiting.push(resolve));
    try {
      return await work();
    } finally {
      const next = this.waiting.shift();
      if (next) next();
      else this.active--;
    }
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
        response = await this.inTurn(() =>
          (this.options.fetch ?? (attempt === 1 ? ipv4Fetch : freshIpv4Fetch))(`${this.options.baseUrl}${path}?${query}`, {
            headers: { Accept: "application/json", ...(bearer ? { Authorization: `Bearer ${key}` } : {}) },
            signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
          }),
        );
      } catch (err) {
        signal?.throwIfAborted();
        if (attempt < 2 && !timeout.aborted) {
          await defaultSleep(300, signal);
          continue;
        }
        throw new TmdbError(
          timeout.aborted ? "TMDB took too long to answer. Try again." : "Couldn't reach TMDB. Try again.",
          undefined,
          err,
        );
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

  /** A film or series by its IMDb ID, with its still, if TMDB has it. */
  async find(imdbId: string, signal?: AbortSignal): Promise<TmdbFound | undefined> {
    if (!/^tt\d{7,10}$/.test(imdbId)) return undefined;
    type Found = { id?: number; backdrop_path?: string | null };
    const data = await this.get<{ movie_results?: Found[]; tv_results?: Found[] }>(
      `/3/find/${imdbId}`,
      { external_source: "imdb_id" },
      signal,
    );
    const movie = data.movie_results?.[0];
    const hit = movie ?? data.tv_results?.[0];
    if (typeof hit?.id !== "number") return undefined;
    const still = stillUrl(hit.backdrop_path);
    return { kind: movie ? "movie" : "tv", tmdbId: hit.id, ...(still ? { still } : {}) };
  }

  /** A film's (or series') backdrop by its IMDb ID, as a 1280 px image URL, if TMDB has one. */
  async backdrop(imdbId: string, signal?: AbortSignal): Promise<string | undefined> {
    return (await this.find(imdbId, signal))?.still;
  }

  /** A title's top-billed characters, up to three, one per actor: a series' across its seasons. */
  async characters(title: TmdbFound, signal?: AbortSignal): Promise<TmdbCharacter[]> {
    type Member = { name?: string; character?: string; order?: number; roles?: { character?: string }[] };
    const path = title.kind === "movie" ? `/3/movie/${title.tmdbId}/credits` : `/3/tv/${title.tmdbId}/aggregate_credits`;
    const data = await this.get<{ cast?: Member[] }>(path, {}, signal);
    const characters: TmdbCharacter[] = [];
    for (const member of [...(data.cast ?? [])].sort((a, b) => (a.order ?? 999) - (b.order ?? 999))) {
      const name = partName(member.character ?? member.roles?.[0]?.character);
      const actor = member.name?.trim();
      if (!name || !actor || characters.some((c) => c.actor === actor)) continue;
      characters.push({ name, actor });
      if (characters.length === 3) break;
    }
    return characters;
  }

  /**
   * The two parts a person is best known for, by their IMDb ID (nm…): leads or close to them in films (billed in the
   * first four) and regular parts in series (three episodes or more), the titles with the most TMDB votes first.
   * Playing oneself, voices, uncredited parts and talk, news or reality shows don't count.
   */
  async roles(imdbId: string, signal?: AbortSignal): Promise<KnownRole[]> {
    if (!/^nm\d{7,10}$/.test(imdbId)) return [];
    const found = await this.get<{ person_results?: { id?: number }[] }>(`/3/find/${imdbId}`, { external_source: "imdb_id" }, signal);
    const id = found.person_results?.[0]?.id;
    if (typeof id !== "number") return [];
    type Credit = {
      media_type?: string;
      title?: string;
      name?: string;
      character?: string;
      order?: number;
      episode_count?: number;
      vote_count?: number;
      release_date?: string;
      first_air_date?: string;
      genre_ids?: number[];
    };
    const data = await this.get<{ cast?: Credit[] }>(`/3/person/${id}/combined_credits`, {}, signal);
    const parts = (data.cast ?? [])
      .filter((c) => !c.genre_ids?.some((g) => NOT_A_SHOW.has(g)))
      .filter((c) => (c.media_type === "tv" ? (c.episode_count ?? 0) >= 3 : (c.order ?? 0) <= 3))
      .sort((a, b) => (b.vote_count ?? 0) - (a.vote_count ?? 0));
    const roles: KnownRole[] = [];
    for (const credit of parts) {
      const character = partName(credit.character);
      const title = (credit.title ?? credit.name)?.trim().slice(0, 80);
      if (!character || !title || roles.some((r) => r.title === title)) continue;
      const year = Number((credit.release_date ?? credit.first_air_date ?? "").slice(0, 4));
      roles.push({ character, title, ...(year > 1800 ? { year } : {}) });
      if (roles.length === 2) break;
    }
    return roles;
  }
}
