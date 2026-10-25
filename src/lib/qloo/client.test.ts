import { describe, expect, it, vi } from "vitest";
import { MemoryCache } from "./cache";
import { QlooClient, type FetchLike, type Provenance } from "./client";
import { QlooError } from "./errors";
import { serializeParams, validateInsightsParams } from "./params";

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

function liveClient(fetchImpl: FetchLike, extra: Partial<ConstructorParameters<typeof QlooClient>[0]> = {}) {
  return new QlooClient({ mode: "live", apiKey: "test-key", fetch: fetchImpl, sleep: async () => {}, ...extra });
}

describe("serializeParams", () => {
  it("comma-joins arrays, drops empty values and sorts keys", () => {
    expect(
      serializeParams({
        take: 5,
        "signal.interests.entities": ["A", "B"],
        "filter.type": "urn:entity:movie",
        skipped: undefined,
        empty: [],
        "feature.explainability": true,
      }),
    ).toEqual({
      "feature.explainability": "true",
      "filter.type": "urn:entity:movie",
      "signal.interests.entities": "A,B",
      take: "5",
    });
  });
});

describe("validateInsightsParams", () => {
  it("flags parameters Qloo would silently ignore for the filter.type", () => {
    const warnings = validateInsightsParams({ "filter.type": "urn:entity:movie", "filter.price_level.max": "2" });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("filter.price_level.max");
  });

  it("accepts documented parameters", () => {
    expect(
      validateInsightsParams({
        "filter.type": "urn:entity:movie",
        "filter.release_year.min": "1990",
        "signal.interests.entities": "A",
        "feature.explainability": "true",
      }),
    ).toEqual([]);
  });
});

describe("QlooClient", () => {
  it("calls the hackathon host with X-Api-Key and records provenance", async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => jsonResponse({ results: [] }, 200, { "x-qloo-request-id": "req-1" }));
    const seen: Provenance[] = [];
    const client = liveClient(fetchImpl).recording((p) => seen.push(p));

    const result = await client.search({ query: "Radiohead", types: "urn:entity:artist", take: 3 });

    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://hackathon.api.qloo.com/search?query=Radiohead&take=3&types=urn%3Aentity%3Aartist");
    expect((init?.headers as Record<string, string>)["X-Api-Key"]).toBe("test-key");
    expect(init?.method).toBe("GET");
    expect(result.provenance).toMatchObject({ path: "/search", status: 200, requestId: "req-1", cached: false, mode: "live" });
    expect(seen).toHaveLength(1);
  });

  it("refuses to run live without a key", async () => {
    const client = new QlooClient({ mode: "live", fetch: async () => jsonResponse({}) });
    await expect(client.info()).rejects.toMatchObject({ kind: "config" });
  });

  it("retries 429 with Retry-After and then succeeds", async () => {
    const sleep = vi.fn(async () => {});
    const fetchImpl = vi
      .fn<FetchLike>()
      .mockResolvedValueOnce(jsonResponse({ error: { reason: "slow down" } }, 429, { "retry-after": "2" }))
      .mockResolvedValueOnce(jsonResponse({ results: { entities: [] } }));
    const result = await liveClient(fetchImpl, { sleep }).insights({ "filter.type": "urn:entity:movie", take: 1 });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(2000);
    expect(result.data).toEqual({ results: { entities: [] } });
  });

  it("does not retry 401 and labels it as an auth error with the reason", async () => {
    const fetchImpl = vi.fn<FetchLike>(
      async () =>
        new Response(JSON.stringify({ error: { reason: "API keys mismatch", code: 401 } }), {
          status: 401,
          headers: { "content-type": "text/plain" },
        }),
    );
    const error = await liveClient(fetchImpl)
      .info()
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(QlooError);
    expect(error).toMatchObject({ kind: "auth", status: 401, reason: "API keys mismatch", retryable: false });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("labels 403 as forbidden (unsupported type), not as a bad key", async () => {
    const fetchImpl = async () => jsonResponse({ error: { reason: "You do not have permission to access urn:entity:music" } }, 403);
    await expect(liveClient(fetchImpl).insights({ "filter.type": "urn:entity:music" })).rejects.toMatchObject({
      kind: "forbidden",
    });
  });

  it("gives up after three attempts on 5xx", async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => jsonResponse({ error: "boom" }, 503));
    await expect(liveClient(fetchImpl).info()).rejects.toMatchObject({ kind: "upstream", retryable: true });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("treats a 404 from /search as no results", async () => {
    const result = await liveClient(async () => jsonResponse({ error: { reason: "No results" } }, 404)).search({ query: "zzz" });
    expect(result.data).toEqual({ results: [] });
    expect(result.provenance.status).toBe(404);
  });

  it("serves repeat requests from the cache, except the health check's info()", async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => jsonResponse({ results: [] }));
    const client = liveClient(fetchImpl, { cache: new MemoryCache() });
    await client.search({ query: "Drive" });
    const second = await client.search({ query: "Drive" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(second.provenance.cached).toBe(true);
    await client.info();
    await client.info();
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("doesn't cache a response as large as a city heatmap", async () => {
    const heatmap = Array.from({ length: 4_000 }, (_, i) => ({
      location: { latitude: i, longitude: i, geohash: "te7u102" },
      query: { affinity: 0.5 },
    }));
    const fetchImpl = vi.fn<FetchLike>(async () => jsonResponse({ results: { heatmap } }));
    const client = liveClient(fetchImpl, { cache: new MemoryCache() });
    const params = { "filter.type": "urn:heatmap", "filter.location.query": "Mumbai", "signal.interests.entities": "A" };
    await client.insights(params);
    const second = await client.insights(params);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(second.provenance.cached).toBe(false);
  });

  it("retries a body that fails mid-stream, and stops retrying once the run is aborted", async () => {
    const broken = () => new Response(new ReadableStream({ start: (c) => c.error(new TypeError("terminated")) }), { status: 200 });
    const fetchImpl = vi
      .fn<FetchLike>()
      .mockResolvedValueOnce(broken())
      .mockResolvedValueOnce(jsonResponse({ results: [] }));
    const result = await liveClient(fetchImpl, { sleep: async () => {} }).search({ query: "Drive" });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(result.data).toEqual({ results: [] });

    const controller = new AbortController();
    const hanging = vi.fn<FetchLike>(async () => {
      controller.abort(new Error("run deadline"));
      throw new DOMException("aborted", "AbortError");
    });
    const scoped = liveClient(hanging).recording(() => {}, controller.signal);
    await expect(scoped.search({ query: "Drive" })).rejects.toThrow("run deadline");
    expect(hanging).toHaveBeenCalledTimes(1);
  });

  it("keeps a good response when the cache write fails", async () => {
    const cache = { get: async () => undefined, set: async () => Promise.reject(new Error("EROFS")) };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = await liveClient(async () => jsonResponse({ results: [] }), { cache }).search({ query: "Drive" });
    expect(result.data).toEqual({ results: [] });
    warn.mockRestore();
  });

  it("surfaces silently-ignored parameter warnings", async () => {
    const result = await liveClient(async () => jsonResponse({ results: { entities: [] } })).insights({
      "filter.type": "urn:entity:artist",
      "filter.release_year.min": 2000,
    });
    expect(result.warnings[0]).toContain("filter.release_year.min");
  });
});
