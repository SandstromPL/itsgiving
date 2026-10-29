import { afterEach, describe, expect, it, vi } from "vitest";
import type { CompactEntity } from "../qloo";
import { TmdbError, type TmdbClient, type TmdbFound, type TmdbPerson } from "../tmdb";
import { TmdbLookups } from "./pipeline-tmdb";

const film = (id: string, imdb?: string) => ({ id, name: id, tags: [], ...(imdb ? { external: { imdb } } : {}) }) as CompactEntity;
const dropped = () =>
  new TmdbError("Couldn't reach TMDB. Try again.", undefined, Object.assign(new Error("connect"), { code: "ETIMEDOUT" }));

/**
 * A fake TMDB: tt1 has a still and characters, tt2 can't be reached, tt3 has a still but its credits fail; nm1 has a
 * photo and a part, nm2 can't be reached, nm3 has neither, nm4 has a photo but its parts fail, nm9 isn't on TMDB.
 */
function fakeTmdb() {
  const asked: string[] = [];
  const tmdb = {
    configured: true,
    async find(imdb: string): Promise<TmdbFound | undefined> {
      asked.push(`find:${imdb}`);
      if (imdb === "tt2") throw dropped();
      return imdb === "tt9" ? undefined : { kind: "movie", tmdbId: Number(imdb.slice(2)), still: `still-${imdb}` };
    },
    async characters(found: TmdbFound) {
      asked.push(`characters:${found.tmdbId}`);
      if (found.tmdbId === 3) throw dropped();
      return [{ name: "Anna", actor: "Jessie Buckley" }];
    },
    async findPerson(imdb: string): Promise<TmdbPerson | undefined> {
      asked.push(`findPerson:${imdb}`);
      if (imdb === "nm2") throw dropped();
      if (imdb === "nm9") return undefined;
      return { tmdbId: Number(imdb.slice(2)), ...(imdb === "nm3" ? {} : { photo: `photo-${imdb}` }) };
    },
    async roles(person: TmdbPerson) {
      asked.push(`roles:${person.tmdbId}`);
      if (person.tmdbId === 4) throw dropped();
      return person.tmdbId === 1 ? [{ character: "Calum", title: "Aftersun", year: 2022 }] : [];
    },
  } as unknown as TmdbClient;
  return { tmdb, asked };
}

afterEach(() => vi.restoreAllMocks());

describe("TmdbLookups", () => {
  it("gives each title its still and characters, keeps a still when the characters fail, and says why it failed", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { tmdb, asked } = fakeTmdb();
    const lookups = new TmdbLookups(tmdb, new AbortController().signal);
    const films = [film("A", "tt1"), film("B", "tt2"), film("C", "tt3"), film("D"), film("E", "tt9")];
    lookups.start(films);
    // A re-plan's titles are asked about once.
    lookups.start(films.slice(0, 2));
    const looked = await lookups.settled(films, 1_000);
    expect([...looked]).toEqual([
      ["A", { still: "still-tt1", characters: [{ name: "Anna", actor: "Jessie Buckley" }] }],
      ["C", { still: "still-tt3", characters: [] }],
    ]);
    expect(asked.filter((a) => a.startsWith("find"))).toEqual(["find:tt1", "find:tt2", "find:tt3", "find:tt9"]);
    lookups.logTitles();
    expect(warn).toHaveBeenCalledOnce();
    expect(JSON.parse(warn.mock.calls[0][0] as string)).toEqual({
      evt: "tmdb_titles",
      failed: 2,
      of: 4,
      why: ["Couldn't reach TMDB. Try again. ETIMEDOUT"],
    });
  });

  it("waits a moment at most for a slow title, and hands over what came back", async () => {
    const slow = {
      configured: true,
      find: (imdb: string) =>
        new Promise<TmdbFound>((resolve) => setTimeout(() => resolve({ kind: "movie", tmdbId: 1, still: imdb }), imdb === "tt1" ? 0 : 500)),
      characters: async () => [],
    } as unknown as TmdbClient;
    const lookups = new TmdbLookups(slow, new AbortController().signal);
    const films = [film("Fast", "tt1"), film("Slow", "tt2")];
    lookups.start(films);
    const started = Date.now();
    const looked = await lookups.settled(films, 50);
    expect(Date.now() - started).toBeLessThan(400);
    expect([...looked.keys()]).toEqual(["Fast"]);
  });

  it("finds actors' photos and the parts they're known for, and keeps a photo when the parts fail", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { tmdb } = fakeTmdb();
    const lookups = new TmdbLookups(tmdb, new AbortController().signal);
    const people = ["nm1", "nm2", "nm3", "nm4", undefined, "nm9"].map((imdb, i) => film(`P${i + 1}`, imdb));
    const profiles = await lookups.profiles(people);
    expect(Object.fromEntries(profiles)).toEqual({
      P1: { photo: "photo-nm1", known: [{ character: "Calum", title: "Aftersun", year: 2022 }] },
      P4: { photo: "photo-nm4", known: [] },
    });
    expect(JSON.parse(warn.mock.calls[0][0] as string)).toMatchObject({ evt: "tmdb_actors", failed: 2, of: 6 });
  });

  it("finds nothing without a client, with no key, or in mock mode", async () => {
    const { tmdb, asked } = fakeTmdb();
    const unconfigured = { ...tmdb, configured: false } as unknown as TmdbClient;
    for (const client of [undefined, unconfigured]) {
      const lookups = new TmdbLookups(client, new AbortController().signal);
      lookups.start([film("A", "tt1")]);
      expect((await lookups.settled([film("A", "tt1")], 10)).size).toBe(0);
      expect((await lookups.profiles([film("P1", "nm1")])).size).toBe(0);
    }
    expect(asked).toEqual([]);
  });
});
