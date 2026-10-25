import { describe, expect, it } from "vitest";
import { EMPTY_FORM, toBrief } from "@/app/studio/form";
import { createQlooClient } from "../qloo";
import { TmdbClient } from "../tmdb";
import { TasteImportError, importTaste } from "./taste";

const qloo = () => createQlooClient({ mode: "mock", baseUrl: "https://mock.qloo.invalid" });

/** A fake TMDB list: two films the mock catalog knows by IMDb ID, a short it doesn't, and one with no IMDb ID. */
function tmdb() {
  const routes: Record<string, unknown> = {
    "/3/list/7": {
      name: "Favourites",
      item_count: 4,
      items: [
        { id: 1, media_type: "movie", title: "Donnie Darko", release_date: "2001-01-19" },
        { id: 2, media_type: "movie", title: "Juice", release_date: "2017-11-08" },
        { id: 3, media_type: "movie", title: "Se7en", release_date: "1995-09-22" },
        { id: 4, media_type: "movie", title: "Home Video", release_date: "2019-03-01" },
      ],
    },
    "/3/movie/1/external_ids": { imdb_id: "tt0246578" },
    "/3/movie/2/external_ids": { imdb_id: "tt7180392" },
    "/3/movie/3/external_ids": { imdb_id: "tt0114369" },
    "/3/movie/4/external_ids": { imdb_id: null },
  };
  return new TmdbClient({
    apiKey: "key",
    baseUrl: "https://tmdb.test",
    fetch: async (url) => {
      const body = routes[new URL(url).pathname];
      return body ? Response.json(body) : new Response("{}", { status: 404 });
    },
  });
}

describe("importTaste", () => {
  it("turns a TMDB list into the films Qloo knows by IMDb ID, and says what it left out", async () => {
    const result = await importTaste("https://www.themoviedb.org/list/7-favourites", { tmdb: tmdb(), qloo: qloo() });
    expect(result.source).toEqual({ kind: "tmdb", id: "7", name: "Favourites", total: 4 });
    expect(result.found).toEqual([
      { imdb: "tt0246578", title: "Donnie Darko", year: 2001 },
      { imdb: "tt0114369", title: "Se7en", year: 1995 },
    ]);
    expect(result.missing).toEqual([
      { title: "Juice", year: 2017, reason: "not_in_qloo" },
      { title: "Home Video", year: 2019, reason: "no_imdb" },
    ]);
  });

  it("takes pasted IMDb links without needing TMDB", async () => {
    const keyless = new TmdbClient({ baseUrl: "https://tmdb.test" });
    const result = await importTaste("https://www.imdb.com/title/tt0114369/ and https://www.imdb.com/title/tt0246578/", {
      tmdb: keyless,
      qloo: qloo(),
    });
    expect(result.source).toEqual({ kind: "imdb", total: 2 });
    expect(result.found.map((f) => f.title)).toEqual(["Se7en", "Donnie Darko"]);
  });

  it("asks for a list link or IMDb links when given neither", async () => {
    await expect(importTaste("my favourite films", { tmdb: tmdb(), qloo: qloo() })).rejects.toBeInstanceOf(TasteImportError);
  });

  it("puts imported films in the brief as IMDb IDs", () => {
    const form = {
      ...EMPTY_FORM,
      artist: "Prateek Kuhad",
      city: "Mumbai",
      imported: [{ imdb: "tt0246578", title: "Donnie Darko", year: 2001 }],
      importedFrom: "IMDb links",
    };
    expect(toBrief(form).director_imdb_ids).toEqual(["tt0246578"]);
  });
});
