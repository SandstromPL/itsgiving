import { afterEach, describe, expect, it, vi } from "vitest";
import type { CompactEntity } from "../qloo";
import { TmdbError, type TmdbClient, type TmdbFound } from "../tmdb";
import { TmdbLookups } from "./pipeline-tmdb";

const film = (id: string, imdb?: string) => ({ id, name: id, tags: [], ...(imdb ? { external: { imdb } } : {}) }) as CompactEntity;
const dropped = () =>
  new TmdbError("Couldn't reach TMDB. Try again.", undefined, Object.assign(new Error("connect"), { code: "ETIMEDOUT" }));

/** A fake TMDB: tt1 has a still and characters, tt2 can't be reached, tt3 has a still but its credits fail. */
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
    async roles(imdb: string) {
      asked.push(`roles:${imdb}`);
      if (imdb === "nm2") throw dropped();
      return imdb === "nm1" ? [{ character: "Calum", title: "Aftersun", year: 2022 }] : [];
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

  it("finds the parts actors are known for, for those TMDB knows", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { tmdb } = fakeTmdb();
    const lookups = new TmdbLookups(tmdb, new AbortController().signal);
    const roles = await lookups.roles([film("P1", "nm1"), film("P2", "nm2"), film("P3", "nm3"), film("P4")]);
    expect([...roles]).toEqual([["P1", [{ character: "Calum", title: "Aftersun", year: 2022 }]]]);
    expect(JSON.parse(warn.mock.calls[0][0] as string)).toMatchObject({ evt: "tmdb_roles", failed: 1, of: 4 });
  });

  it("finds nothing without a client, with no key, or in mock mode", async () => {
    const { tmdb, asked } = fakeTmdb();
    const unconfigured = { ...tmdb, configured: false } as unknown as TmdbClient;
    for (const client of [undefined, unconfigured]) {
      const lookups = new TmdbLookups(client, new AbortController().signal);
      lookups.start([film("A", "tt1")]);
      expect((await lookups.settled([film("A", "tt1")], 10)).size).toBe(0);
      expect((await lookups.roles([film("P1", "nm1")])).size).toBe(0);
    }
    expect(asked).toEqual([]);
  });
});
