import { defaultSleep, type CompactEntity } from "../qloo";
import type { KnownRole, TmdbCharacter, TmdbClient } from "../tmdb";

// What TMDB adds to a run, which Qloo doesn't have: each reference's still and top-billed characters, and its actors'
// photos and the parts they're known for. A title's lookup starts as soon as Qloo's list lands and runs beside the rest
// of the run; it is kept for the run, so a re-plan never asks twice. A failure costs a still, a character, a photo or a
// role, never the run: TMDB isn't Qloo's evidence, so `complete` doesn't count it, and the warning says why it failed,
// not only how often.

/** What TMDB knows of a reference. */
export interface TitleLookup {
  still?: string;
  characters: TmdbCharacter[];
}

/** What TMDB knows of an actor: their photo, if it has one, and the parts they're best known for. */
export interface ActorProfile {
  photo?: string;
  known: KnownRole[];
}

/** An error's message and, where the network gave one, its code (ETIMEDOUT, ECONNRESET): what a log needs to say why. */
export function failureReason(err: unknown): string {
  const code = (e: unknown) => (e && typeof e === "object" && "code" in e && typeof e.code === "string" ? e.code : undefined);
  const cause = err instanceof Error ? err.cause : undefined;
  const why = code(err) ?? code(cause) ?? (cause instanceof Error ? code(cause.cause) : undefined);
  return [err instanceof Error ? err.message : String(err), why].filter(Boolean).join(" ");
}

/** Counts a kind of lookup's failures, and logs them once as `evt`. */
class Failures {
  private count = 0;
  private readonly reasons = new Set<string>();

  constructor(private readonly evt: string) {}

  add(err: unknown) {
    this.count++;
    this.reasons.add(failureReason(err));
  }

  log(of: number) {
    if (this.count > 0) console.warn(JSON.stringify({ evt: this.evt, failed: this.count, of, why: [...this.reasons].slice(0, 3) }));
  }
}

/** One run's TMDB lookups. Without a client, or in mock mode (whose films aren't TMDB's), it finds nothing. */
export class TmdbLookups {
  private readonly titles = new Map<string, Promise<TitleLookup | undefined>>();
  private readonly titleFailures = new Failures("tmdb_titles");

  constructor(
    private readonly tmdb: TmdbClient | undefined,
    private readonly signal: AbortSignal,
  ) {}

  private get usable(): TmdbClient | undefined {
    return this.tmdb?.configured ? this.tmdb : undefined;
  }

  /** Starts looking up every title not asked about yet. */
  start(films: CompactEntity[]): void {
    const tmdb = this.usable;
    if (!tmdb) return;
    for (const film of films) {
      const imdb = film.external?.imdb;
      if (!imdb || this.titles.has(imdb)) continue;
      const pending = this.lookUp(tmdb, imdb);
      this.titles.set(imdb, pending);
    }
  }

  private async lookUp(tmdb: TmdbClient, imdb: string): Promise<TitleLookup | undefined> {
    let found;
    try {
      found = await tmdb.find(imdb, this.signal);
    } catch (err) {
      if (!this.signal.aborted) this.titleFailures.add(err);
      return undefined;
    }
    if (!found) return undefined;
    // The still is kept when the characters fail: it came first.
    const still = found.still ? { still: found.still } : {};
    try {
      return { ...still, characters: await tmdb.characters(found, this.signal) };
    } catch (err) {
      if (!this.signal.aborted) this.titleFailures.add(err);
      return { ...still, characters: [] };
    }
  }

  /**
   * What has come back for these titles, by entity ID, after waiting `ms` at most for the rest: a title still out goes
   * without. Lookups never started (no IMDb ID) are skipped.
   */
  async settled(films: CompactEntity[], ms: number): Promise<Map<string, TitleLookup>> {
    const back = new Map<string, TitleLookup>();
    const pending = films.flatMap((film) => {
      const lookup = film.external?.imdb ? this.titles.get(film.external.imdb) : undefined;
      return lookup ? [lookup.then((found) => void (found && back.set(film.id, found)))] : [];
    });
    if (pending.length > 0) {
      const none = () => {};
      await Promise.race([Promise.all(pending), defaultSleep(ms, this.signal).then(none, none)]);
    }
    // A copy: what lands after the wait mustn't change what the caller was given.
    return new Map(back);
  }

  /** Logs the titles' failures, once, when the run is done with them. */
  logTitles(): void {
    this.titleFailures.log(this.titles.size);
  }

  /**
   * What TMDB knows of each actor, by entity ID, for those it knows by the IMDb ID on Qloo's record. The photo is kept
   * when the parts fail: it came first.
   */
  async profiles(people: CompactEntity[]): Promise<Map<string, ActorProfile>> {
    const profiles = new Map<string, ActorProfile>();
    const tmdb = this.usable;
    if (!tmdb) return profiles;
    const failures = new Failures("tmdb_actors");
    await Promise.all(
      people.map(async (person) => {
        if (!person.external?.imdb) return;
        let found;
        try {
          found = await tmdb.findPerson(person.external.imdb, this.signal);
        } catch (err) {
          if (!this.signal.aborted) failures.add(err);
          return;
        }
        if (!found) return;
        let known: KnownRole[] = [];
        try {
          known = await tmdb.roles(found, this.signal);
        } catch (err) {
          if (!this.signal.aborted) failures.add(err);
        }
        if (found.photo || known.length > 0) profiles.set(person.id, { ...(found.photo ? { photo: found.photo } : {}), known });
      }),
    );
    failures.log(people.length);
    return profiles;
  }
}
