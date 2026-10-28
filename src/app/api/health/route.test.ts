import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { QlooError, getQlooClient, type Provenance } from "@/lib/qloo";
import { GET } from "./route";

// connection() needs a real request around it; here there's none, and nothing to wait for.
vi.mock("next/server", () => ({ connection: async () => {} }));

const qloo = getQlooClient();
const provenance: Provenance = { method: "GET", path: "/", query: {}, status: 200, durationMs: 312, cached: false, mode: qloo.mode };
const answered = () => Promise.resolve({ data: {}, provenance, warnings: [] });

let ip = 0;
/** A request from an address no other test has used, so the per-address limit never carries over. */
const fresh = () => new Headers({ "x-forwarded-for": `198.51.100.${++ip}` });
const get = (headers: Headers = fresh()) => GET(new Request("https://itsgiving.test/api/health", { headers }));

let clock = Date.parse("2026-10-28T00:00:00Z");

beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
});

afterAll(() => {
  vi.useRealTimers();
});

beforeEach(() => {
  // Each test starts after the last one's check has expired.
  clock += 10 * 60_000;
  vi.setSystemTime(clock);
  vi.restoreAllMocks();
});

describe("GET /api/health", () => {
  it("answers as before, and asks Qloo at most once every five minutes", async () => {
    const info = vi.spyOn(qloo, "info").mockImplementation(answered);
    const first = await get();
    expect(first.status).toBe(200);
    const body = await first.json();
    expect(body).toEqual({ ok: true, mode: qloo.mode, baseUrl: qloo.baseUrl, provenance, llm: expect.any(Object) });
    expect(Object.keys(body.llm)).toEqual(["mode", "chain", "dailyCallsLeft"]);
    expect(body.llm.chain.at(-1)).toBe("mock:itsgiving-template");

    vi.setSystemTime(clock + 5 * 60_000 - 1);
    expect(await (await get()).json()).toEqual(body);
    expect(info).toHaveBeenCalledTimes(1);

    vi.setSystemTime(clock + 5 * 60_000);
    expect((await get()).status).toBe(200);
    expect(info).toHaveBeenCalledTimes(2);
  });

  it("shares one Qloo call between requests that arrive while it runs", async () => {
    let finish: () => void = () => {};
    const info = vi.spyOn(qloo, "info").mockImplementation(() => new Promise((resolve) => (finish = () => resolve(answered()))));
    const both = Promise.all([get(), get()]);
    await vi.waitFor(() => expect(info).toHaveBeenCalled());
    finish();
    expect((await both).map((r) => r.status)).toEqual([200, 200]);
    expect(info).toHaveBeenCalledTimes(1);
  });

  it("keeps Qloo's refusal for the minute too, with the same 503 as before", async () => {
    const info = vi
      .spyOn(qloo, "info")
      .mockRejectedValue(new QlooError({ kind: "auth", status: 401, message: "Qloo / returned 401: Unauthorized", path: "/" }));
    const first = await get();
    expect(first.status).toBe(503);
    const body = await first.json();
    expect(body).toEqual({
      ok: false,
      mode: qloo.mode,
      baseUrl: qloo.baseUrl,
      error: {
        kind: "auth",
        status: 401,
        message: "Qloo / returned 401: Unauthorized",
        hint: "Check the key and that QLOO_BASE_URL is https://hackathon.api.qloo.com; hackathon keys get 401 on api.qloo.com.",
      },
      llm: expect.any(Object),
    });
    const again = await get();
    expect(again.status).toBe(503);
    expect(await again.json()).toEqual(body);
    expect(info).toHaveBeenCalledTimes(1);
  });

  it("fails on a fault that isn't Qloo's answer, and doesn't keep it", async () => {
    const info = vi.spyOn(qloo, "info").mockRejectedValueOnce(new TypeError("boom")).mockImplementation(answered);
    await expect(get()).rejects.toThrow("boom");
    expect((await get()).status).toBe(200);
    expect(info).toHaveBeenCalledTimes(2);
  });

  it("limits each address to 10 a minute with the routes' usual 429, and no Qloo call", async () => {
    const info = vi.spyOn(qloo, "info").mockImplementation(answered);
    const busy = fresh();
    for (let i = 0; i < 10; i++) expect((await get(busy)).status).toBe(200);
    const refused = await get(busy);
    expect(refused.status).toBe(429);
    const { error } = (await refused.json()) as { error: string };
    expect(error).toMatch(/^Too many health checks at once\. Try again in \d+ s\.$/);
    expect(refused.headers.get("retry-after")).toBe(/(\d+) s\.$/.exec(error)?.[1]);
    expect((await get()).status).toBe(200); // another address isn't held up
    expect(info).toHaveBeenCalledTimes(1);
  });
});
