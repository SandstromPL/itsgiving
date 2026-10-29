import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The proxy with Supabase and the store stood in for: what it answers for a saved treatment's link before the page
// starts, and that a refreshed session rides on every answer.
const fake = vi.hoisted(() => ({
  configured: true,
  viewer: null as string | null,
  /** Cookies the session refresh sets, if any. */
  refresh: undefined as { name: string; value: string }[] | undefined,
  savedVisible: vi.fn<(id: string, viewer: string | null) => Promise<boolean>>(async () => true),
}));

vi.mock("@/lib/supabase/config", () => ({
  sessionCookie: {},
  supabasePublic: () => (fake.configured ? { url: "https://db.test", publishableKey: "sb_publishable_test" } : null),
}));
vi.mock("@supabase/ssr", () => ({
  createServerClient: (
    _url: string,
    _key: string,
    options: { cookies: { setAll: (c: unknown[], h: Record<string, string>) => void } },
  ) => ({
    auth: {
      async getClaims() {
        if (fake.refresh)
          options.cookies.setAll(
            fake.refresh.map((c) => ({ ...c, options: { path: "/" } })),
            { "cache-control": "private, no-store" },
          );
        return { data: fake.viewer ? { claims: { sub: fake.viewer } } : null };
      },
    },
  }),
}));
vi.mock("@/lib/saved/store", async (original) => ({
  ...(await original<typeof import("@/lib/saved/store")>()),
  savedVisible: fake.savedVisible,
}));

const { proxy } = await import("./proxy");
const { SavedStoreError } = await import("@/lib/saved/store");

const ID = "0b4f7e2a-9c1d-4e5f-8a6b-7c8d9e0f1a2b";
let address = 0;
/** A request from an address of its own, so one test's opens never count against another's. */
const ask = (path: string, headers: Record<string, string> = {}) =>
  proxy(new NextRequest(`https://itsgiving.test${path}`, { headers: { "x-forwarded-for": `203.0.113.${++address}`, ...headers } }));
const rewrittenTo = (response: Response) => new URL(response.headers.get("x-middleware-rewrite") ?? "", "https://x").pathname;

beforeEach(() => {
  fake.configured = true;
  fake.viewer = null;
  fake.refresh = undefined;
  fake.savedVisible.mockReset().mockResolvedValue(true);
});

afterEach(() => vi.restoreAllMocks());

describe("proxy", () => {
  it("lets a treatment this visitor may open through to its page, asking as the signed-in viewer", async () => {
    fake.viewer = "5b0c6a0e-1f2d-4c3b-9a8e-7d6c5b4a3f21";
    const response = await ask(`/s/${ID}`);
    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(fake.savedVisible).toHaveBeenCalledWith(ID, fake.viewer);
  });

  it("answers a link that leads nowhere with the site's 404, the same for a wrong id and an unseen treatment", async () => {
    expect(rewrittenTo(await ask("/s/not-a-treatment"))).toBe("/_saved-gone");
    fake.savedVisible.mockResolvedValue(false);
    expect(rewrittenTo(await ask(`/s/${ID}`))).toBe("/_saved-gone");
    expect(fake.savedVisible).toHaveBeenCalledTimes(1);
  });

  it("answers 503 with a page and Retry-After when the database doesn't", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    fake.savedVisible.mockRejectedValue(new SavedStoreError("checking a saved treatment: PGRST002"));
    const response = await ask(`/s/${ID}`);
    expect(response.status).toBe(503);
    expect(response.headers.get("retry-after")).toBe("60");
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(await response.text()).toContain("saved treatments are offline");
    fake.configured = false;
    expect((await ask(`/s/${ID}`)).status).toBe(503);
  });

  it("answers 429 past 60 opens a minute from one address", async () => {
    const from = { "x-forwarded-for": "198.51.100.7" };
    for (let i = 0; i < 60; i++)
      expect((await proxy(new NextRequest(`https://itsgiving.test/s/${ID}`, { headers: from }))).status).toBe(200);
    const refused = await proxy(new NextRequest(`https://itsgiving.test/s/${ID}`, { headers: from }));
    expect(refused.status).toBe(429);
    expect(Number(refused.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(await refused.text()).toContain("give it a minute");
    expect(fake.savedVisible).toHaveBeenCalledTimes(60);
  });

  it("leaves the saved list and deeper paths to their pages", async () => {
    for (const response of [await ask("/saved"), await ask("/s/a/b")]) expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(fake.savedVisible).not.toHaveBeenCalled();
  });

  it("carries a refreshed session onto every answer, never cached for someone else", async () => {
    fake.refresh = [{ name: "sb-test-auth-token", value: "fresh" }];
    fake.savedVisible.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    for (const response of [await ask(`/s/${ID}`), await ask(`/s/${ID}`), await ask("/saved")]) {
      expect(response.headers.get("set-cookie")).toContain("sb-test-auth-token=fresh");
      expect(response.headers.get("cache-control")).toBe("private, no-store");
    }
  });
});
