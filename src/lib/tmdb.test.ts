import { describe, expect, it } from "vitest";
import { TmdbClient, imdbIdsIn, tmdbListId } from "./tmdb";

/** A fake TMDB answering from `routes` ("/path?page=n", or "/path" for any page): a body, or a status code. */
function fakeTmdb(routes: Record<string, unknown>, apiKey = "v3key") {
  const requests: { url: string; auth?: string }[] = [];
  const client = new TmdbClient({
    apiKey,
    baseUrl: "https://tmdb.test",
    fetch: async (url, init) => {
      requests.push({ url, auth: new Headers(init?.headers).get("authorization") ?? undefined });
      const { pathname, searchParams } = new URL(url);
      const route = routes[`${pathname}?page=${searchParams.get("page")}`] ?? routes[pathname];
      if (route === undefined) return new Response("{}", { status: 404 });
      return typeof route === "number" ? new Response("{}", { status: route }) : Response.json(route);
    },
  });
  return { client, requests };
}

const film = (id: number, title: string, date: string) => ({ id, media_type: "movie", title, release_date: date });

describe("tmdbListId", () => {
  it("reads list links in their usual shapes, and bare IDs", () => {
    expect(tmdbListId("https://www.themoviedb.org/list/8273455-my-favourites")).toBe("8273455");
    expect(tmdbListId("themoviedb.org/list/8273455?language=en-US")).toBe("8273455");
    expect(tmdbListId(" 8273455 ")).toBe("8273455");
    expect(tmdbListId("https://www.imdb.com/title/tt0118694/")).toBeUndefined();
    expect(tmdbListId("In the Mood for Love")).toBeUndefined();
  });
});

describe("imdbIdsIn", () => {
  it("finds every IMDb title ID once, in order, in links or bare", () => {
    const text = "https://www.imdb.com/title/tt0118694/ tt0246578, https://m.imdb.com/title/tt0118694/?ref_=x and tt10872600";
    expect(imdbIdsIn(text)).toEqual(["tt0118694", "tt0246578", "tt10872600"]);
    expect(imdbIdsIn("nm0000123 tt123")).toEqual([]);
  });
});

describe("TmdbClient", () => {
  it("reads a list's films and series in order, page by page, and skips people", async () => {
    const { client } = fakeTmdb({
      "/3/list/42?page=1": {
        name: "Night films",
        item_count: 3,
        total_pages: 2,
        items: [film(843, "In the Mood for Love", "2000-09-29"), { id: 7, media_type: "person", name: "Wong Kar-wai" }],
      },
      "/3/list/42?page=2": {
        name: "Night films",
        item_count: 3,
        total_pages: 2,
        items: [{ id: 1920, media_type: "tv", name: "Twin Peaks", first_air_date: "1990-04-08" }],
      },
    });
    const list = await client.list("42", 25);
    expect(list).toEqual({
      id: "42",
      name: "Night films",
      total: 3,
      items: [
        { tmdbId: 843, kind: "movie", title: "In the Mood for Love", year: 2000 },
        { tmdbId: 1920, kind: "tv", title: "Twin Peaks", year: 1990 },
      ],
    });
  });

  it("stops paging when an older response repeats the same items, and at the limit", async () => {
    const { client, requests } = fakeTmdb({
      "/3/list/6": { name: "Old style", item_count: 30, items: [film(1, "A", "2001-01-01"), film(2, "B", "2002-01-01")] },
    });
    expect((await client.list("6", 25)).items).toHaveLength(2);
    expect(requests).toHaveLength(2);
    expect((await client.list("6", 1)).items.map((i) => i.title)).toEqual(["A"]);
  });

  it("sends a v3 key as api_key and a read access token as a Bearer header", async () => {
    const v3 = fakeTmdb({ "/3/movie/843/external_ids": { imdb_id: "tt0118694" } }, "abc123");
    expect(await v3.client.imdbId({ tmdbId: 843, kind: "movie", title: "In the Mood for Love" })).toBe("tt0118694");
    expect(v3.requests[0].url).toContain("api_key=abc123");
    expect(v3.requests[0].auth).toBeUndefined();

    const token = fakeTmdb({ "/3/tv/1920/external_ids": { imdb_id: "tt0098936" } }, "eyJhbGciOi.fake.token");
    expect(await token.client.imdbId({ tmdbId: 1920, kind: "tv", title: "Twin Peaks" })).toBe("tt0098936");
    expect(token.requests[0].url).not.toContain("api_key");
    expect(token.requests[0].auth).toBe("Bearer eyJhbGciOi.fake.token");
  });

  it("tries again after a dropped connection or a busy TMDB, but not after a refusal", async () => {
    let calls = 0;
    const flaky = new TmdbClient({
      apiKey: "key",
      baseUrl: "https://tmdb.test",
      fetch: async () => {
        calls += 1;
        if (calls === 1) throw new TypeError("fetch failed");
        if (calls === 2) return new Response("{}", { status: 503 });
        return Response.json({ imdb_id: "tt0118694" });
      },
    });
    await expect(flaky.imdbId({ tmdbId: 843, kind: "movie", title: "In the Mood for Love" })).rejects.toThrow(/TMDB returned 503/);
    expect(calls).toBe(2);
    expect(await flaky.imdbId({ tmdbId: 843, kind: "movie", title: "In the Mood for Love" })).toBe("tt0118694");

    // Dropped connections come in bursts: a third try, a second later, gets through.
    let drops = 0;
    const dropping = new TmdbClient({
      apiKey: "key",
      baseUrl: "https://tmdb.test",
      fetch: async () => {
        drops += 1;
        if (drops <= 2) throw new TypeError("read ECONNRESET");
        return Response.json({ imdb_id: "tt0118694" });
      },
    });
    expect(await dropping.imdbId({ tmdbId: 843, kind: "movie", title: "In the Mood for Love" })).toBe("tt0118694");
    expect(drops).toBe(3);

    const refused = fakeTmdb({ "/3/list/9": 401 });
    await expect(refused.client.list("9", 25)).rejects.toThrow(/rejected/);
    expect(refused.requests).toHaveLength(1);
  });

  it("says what went wrong: no such list, a rejected key, or no key at all", async () => {
    await expect(fakeTmdb({}).client.list("9", 25)).rejects.toThrow(/no public list/);
    await expect(fakeTmdb({ "/3/list/9": 401 }).client.list("9", 25)).rejects.toThrow(/rejected/);
    await expect(new TmdbClient({ baseUrl: "https://tmdb.test" }).list("9", 25)).rejects.toMatchObject({ status: 503 });
  });
});

describe("TmdbClient.backdrop", () => {
  it("finds a film's backdrop by IMDb ID, as a 1280 px image", async () => {
    const { client, requests } = fakeTmdb({
      "/3/find/tt14152140": { movie_results: [{ id: 842924, backdrop_path: "/uBDbyoufp7TGaDDVTHOCxl3dz8p.jpg" }], tv_results: [] },
    });
    await expect(client.backdrop("tt14152140")).resolves.toBe("https://image.tmdb.org/t/p/w1280/uBDbyoufp7TGaDDVTHOCxl3dz8p.jpg");
    expect(new URL(requests[0].url).searchParams.get("external_source")).toBe("imdb_id");
  });

  it("has none for a film TMDB lacks or keeps no backdrop for, and never asks about a malformed ID", async () => {
    const { client, requests } = fakeTmdb({
      "/3/find/tt0000001": { movie_results: [], tv_results: [] },
      "/3/find/tt0000002": { movie_results: [{ id: 2, backdrop_path: null }] },
    });
    await expect(client.backdrop("tt0000001")).resolves.toBeUndefined();
    await expect(client.backdrop("tt0000002")).resolves.toBeUndefined();
    await expect(client.backdrop("nm0000123")).resolves.toBeUndefined();
    expect(requests).toHaveLength(2);
  });
});

describe("TmdbClient characters, actors and roles", () => {
  it("names a film's top-billed characters, one per actor, skipping credits that aren't parts", async () => {
    const { client } = fakeTmdb({
      "/3/find/tt13968674": { movie_results: [{ id: 913862, backdrop_path: "/a.jpg" }], tv_results: [] },
      "/3/movie/913862/credits": {
        cast: [
          { name: "Riz Ahmed", character: "Amir", order: 1 },
          { name: "Jessie Buckley", character: "Anna", order: 0 },
          { name: "Riz Ahmed", character: "Amir, older", order: 4 },
          { name: "Luke Wilson", character: "Narrator (voice)", order: 2 },
          { name: "Jeremy Allen White", character: "Ryan", order: 3 },
          { name: "Annie Murphy", character: "Natasha", order: 5 },
        ],
      },
    });
    const found = await client.find("tt13968674");
    expect(found).toEqual({ kind: "movie", tmdbId: 913862, still: "https://image.tmdb.org/t/p/w1280/a.jpg" });
    await expect(client.characters(found!)).resolves.toEqual([
      { name: "Anna", actor: "Jessie Buckley" },
      { name: "Amir", actor: "Riz Ahmed" },
      { name: "Ryan", actor: "Jeremy Allen White" },
    ]);
  });

  it("names a series' characters from its credits across seasons", async () => {
    const { client } = fakeTmdb({
      "/3/find/tt15026724": { movie_results: [], tv_results: [{ id: 128225, backdrop_path: null }] },
      "/3/tv/128225/aggregate_credits": {
        cast: [
          { name: "Choi Woo-shik", order: 0, roles: [{ character: "Choi Woong" }] },
          { name: "Kim Da-mi", order: 1, roles: [{ character: "Kook Yeon-su" }] },
          { name: "A Guest", order: 2, roles: [{ character: "Self" }] },
        ],
      },
    });
    const found = await client.find("tt15026724");
    expect(found).toEqual({ kind: "tv", tmdbId: 128225 });
    await expect(client.characters(found!)).resolves.toEqual([
      { name: "Choi Woong", actor: "Choi Woo-shik" },
      { name: "Kook Yeon-su", actor: "Kim Da-mi" },
    ]);
  });

  it("finds an actor with their photo, and names the two parts they're best known for", async () => {
    const { client, requests } = fakeTmdb({
      "/3/find/nm8958770": { person_results: [{ id: 1, profile_path: "/mescal.jpg" }] },
      "/3/find/nm0000002": { person_results: [{ id: 2, profile_path: null }] },
      "/3/find/nm0000001": { person_results: [] },
      "/3/person/1/combined_credits": {
        cast: [
          {
            media_type: "tv",
            name: "Saturday Night Live",
            character: "Self - Host",
            episode_count: 1,
            vote_count: 5000,
            genre_ids: [35, 10763],
          },
          { media_type: "movie", title: "A Big Film", character: "Bartender", order: 12, vote_count: 9000 },
          { media_type: "tv", name: "A Talk Show", character: "Paul", episode_count: 4, vote_count: 6000, genre_ids: [10767] },
          { media_type: "movie", title: "Gladiator II", character: "Lucius", order: 0, vote_count: 4853, release_date: "2024-11-13" },
          { media_type: "movie", title: "Aftersun", character: "Calum", order: 0, vote_count: 2027, release_date: "2022-10-21" },
          { media_type: "tv", name: "Normal People", character: "Connell Waldron", episode_count: 12, vote_count: 1419 },
        ],
      },
    });
    const found = await client.findPerson("nm8958770");
    expect(found).toEqual({ tmdbId: 1, photo: "https://image.tmdb.org/t/p/h632/mescal.jpg" });
    await expect(client.roles(found!)).resolves.toEqual([
      { character: "Lucius", title: "Gladiator II", year: 2024 },
      { character: "Calum", title: "Aftersun", year: 2022 },
    ]);
    await expect(client.findPerson("nm0000002")).resolves.toEqual({ tmdbId: 2 });
    await expect(client.findPerson("nm0000001")).resolves.toBeUndefined();
    await expect(client.findPerson("tt0118694")).resolves.toBeUndefined();
    expect(requests.map((r) => new URL(r.url).pathname)).toEqual([
      "/3/find/nm8958770",
      "/3/person/1/combined_credits",
      "/3/find/nm0000002",
      "/3/find/nm0000001",
    ]);
  });

  it("keeps six requests in flight at most", async () => {
    let open = 0;
    let most = 0;
    const client = new TmdbClient({
      apiKey: "key",
      baseUrl: "https://tmdb.test",
      fetch: async () => {
        most = Math.max(most, ++open);
        await new Promise((resolve) => setTimeout(resolve, 5));
        open--;
        return Response.json({ movie_results: [] });
      },
    });
    await Promise.all(Array.from({ length: 20 }, (_, i) => client.find(`tt${1_000_000 + i}`)));
    expect(most).toBe(6);
  });
});
