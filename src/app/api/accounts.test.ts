import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sealOf } from "@/lib/agent/seal";
import type { Treatment } from "@/lib/agent/types";
import { SavedStoreError, deleteAccount, deleteSaved, saveTreatment, setShared } from "@/lib/saved/store";
import { confirmedViewerId, sessionSupabase, viewerId } from "@/lib/supabase/server";
import { DELETE as deleteAccountRoute } from "./account/route";
import { DELETE as deleteSavedRoute, PATCH as shareRoute } from "./saved/[id]/route";
import { POST as saveRoute } from "./saved/route";

// The routes that act for a signed-in person: saving a treatment (saved), sharing or deleting one (saved/[id]), and
// deleting the account (account). The store and the session are stand-ins; the routes' own guards, words and statuses
// are what's checked. Each route's rate limit lives as long as its module, so every test signs in as someone new.

vi.mock("@/lib/saved/store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/saved/store")>()),
  saveTreatment: vi.fn(),
  setShared: vi.fn(),
  deleteSaved: vi.fn(),
  deleteAccount: vi.fn(),
}));

vi.mock("@/lib/supabase/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/supabase/server")>()),
  viewerId: vi.fn(),
  confirmedViewerId: vi.fn(),
  sessionSupabase: vi.fn(),
}));

const SECRET = "sb_secret_test";
const SAVED_ID = "0b4f7e2a-9c1d-4e5f-8a6b-7c8d9e0f1a2b";

let people = 0;
/** Signs in someone no other test has been, so no rate limit carries over. */
function signIn(): string {
  const id = `person-${++people}`;
  vi.mocked(viewerId).mockResolvedValue(id);
  vi.mocked(confirmedViewerId).mockResolvedValue(id);
  return id;
}

/** A request from the site's own page, sending JSON, unless `headers` says otherwise. */
function request(method: string, path: string, body?: unknown, headers?: Record<string, string>) {
  return new Request(`https://itsgiving.test${path}`, {
    method,
    headers: headers ?? { "sec-fetch-site": "same-origin", "content-type": "application/json" },
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });
}

const one = (id = SAVED_ID) => ({ params: Promise.resolve({ id }) }) as RouteContext<"/api/saved/[id]">;
const share = (body: unknown, headers?: Record<string, string>) =>
  shareRoute(request("PATCH", `/api/saved/${SAVED_ID}`, body, headers), one());
const unsave = (headers?: Record<string, string>) =>
  deleteSavedRoute(request("DELETE", `/api/saved/${SAVED_ID}`, undefined, headers), one());
const unaccount = (headers?: Record<string, string>) => deleteAccountRoute(request("DELETE", "/api/account", undefined, headers));

/** Just enough of a treatment for the saving code: the seal vouches for the rest. */
const treatment = {
  id: "a1b2c3",
  createdAt: "2026-10-26T18:00:00.000Z",
  title: "Almost, in Bandra",
  brief: { format: "music_video", city: "Mumbai" },
  references: [],
  subjects: [{ name: "Prateek Kuhad", kind: "artist" }],
} as unknown as Treatment;
const save = (body: unknown = { treatment, seal: sealOf(treatment, SECRET) }, headers?: Record<string, string>) =>
  saveRoute(request("POST", "/api/saved", body, headers));

async function answer(response: Response) {
  return { status: response.status, body: response.status === 204 ? null : await response.json() };
}

/** Calls `route` until its limit refuses one, and returns that refusal after checking how many got through. */
async function exhaust(route: () => Promise<Response>, allowed: number): Promise<Response> {
  for (let i = 0; i < allowed; i++) expect((await route()).status, `call ${i + 1}`).not.toBe(429);
  return route();
}

/** The 429 every rate-limited route answers: its words, and the same wait in Retry-After. */
async function expectTooMany(response: Response, what: string) {
  expect(response.status).toBe(429);
  const { error } = (await response.json()) as { error: string };
  expect(error).toMatch(new RegExp(`^Too many ${what} at once\\. Try again in \\d+ s\\.$`));
  expect(response.headers.get("retry-after")).toBe(/(\d+) s\.$/.exec(error)?.[1]);
}

const CROSS_SITE = { "sec-fetch-site": "cross-site", "content-type": "application/json" };
const SAME_SITE = { "sec-fetch-site": "same-site", "content-type": "application/json" };

beforeEach(() => {
  vi.stubEnv("SUPABASE_SECRET_KEY", SECRET);
  vi.mocked(viewerId).mockResolvedValue(null);
  vi.mocked(confirmedViewerId).mockResolvedValue(null);
  vi.mocked(sessionSupabase).mockResolvedValue(null);
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetAllMocks();
  vi.restoreAllMocks();
});

describe("POST /api/saved", () => {
  it("refuses a request from another site, or one that isn't JSON, before looking at the session", async () => {
    signIn();
    const refused = { status: 403, body: { error: "Saving works only from itsgiving's own pages." } };
    expect(await answer(await save(undefined, CROSS_SITE))).toEqual(refused);
    expect(await answer(await save(undefined, SAME_SITE))).toEqual(refused);
    expect(await answer(await save(undefined, { "sec-fetch-site": "same-origin", "content-type": "text/plain" }))).toEqual(refused);
    expect(await answer(await save(undefined, { "sec-fetch-site": "same-origin" }))).toEqual(refused);
    expect(viewerId).not.toHaveBeenCalled();
    expect(saveTreatment).not.toHaveBeenCalled();
  });

  it("says saving isn't set up without the secret key, and asks a signed-out person to sign in", async () => {
    vi.stubEnv("SUPABASE_SECRET_KEY", " ");
    expect(await answer(await save())).toEqual({ status: 404, body: { error: "Saving isn't set up on this server." } });
    expect(viewerId).not.toHaveBeenCalled();

    vi.stubEnv("SUPABASE_SECRET_KEY", SECRET);
    expect(await answer(await save())).toEqual({ status: 401, body: { error: "Sign in to save." } });
    expect(saveTreatment).not.toHaveBeenCalled();
  });

  it("saves a treatment this server sealed: 201 the first time, 200 for the same take again", async () => {
    const owner = signIn();
    vi.mocked(saveTreatment).mockResolvedValueOnce({ kind: "saved", id: SAVED_ID, created: true });
    expect(await answer(await save())).toEqual({ status: 201, body: { id: SAVED_ID } });
    expect(saveTreatment).toHaveBeenCalledWith(owner, treatment);
    vi.mocked(saveTreatment).mockResolvedValueOnce({ kind: "saved", id: SAVED_ID, created: false });
    expect(await answer(await save())).toEqual({ status: 200, body: { id: SAVED_ID } });
    expect(console.log).toHaveBeenCalledWith(expect.stringMatching(/^\{"evt":"saved","action":"save","outcome":"saved","ms":\d+\}$/));
  });

  it("refuses what it can't read, and a treatment with someone else's seal", async () => {
    signIn();
    expect(await answer(await save("{ not json"))).toEqual({ status: 400, body: { error: "The request wasn't JSON." } });
    expect(await answer(await save({ treatment, seal: sealOf(treatment, "another server's key") }))).toEqual({
      status: 400,
      body: { error: "That isn't a treatment this site built, so it can't be saved." },
    });
    expect(saveTreatment).not.toHaveBeenCalled();
  });

  it("answers a full account, a deleted one and an unavailable database in words", async () => {
    signIn();
    vi.mocked(saveTreatment).mockResolvedValueOnce({ kind: "full" });
    expect(await answer(await save())).toEqual({
      status: 409,
      body: { error: "You have 100 saved treatments, as many as there's room for. Delete one to save this." },
    });
    vi.mocked(saveTreatment).mockResolvedValueOnce({ kind: "no_account" });
    expect(await answer(await save())).toEqual({ status: 401, body: { error: "This account was deleted. Sign in again to save." } });
    vi.mocked(saveTreatment).mockRejectedValueOnce(new SavedStoreError("saving a treatment: 540 project paused"));
    expect(await answer(await save())).toEqual({
      status: 503,
      body: { error: "Saving isn't available right now. Try again in a minute." },
    });
    expect(console.error).toHaveBeenCalledWith(
      JSON.stringify({ evt: "saved", action: "save", outcome: "unavailable", error: "saving a treatment: 540 project paused" }),
    );
  });

  it("limits each person to 20 saves a minute", async () => {
    signIn();
    // The limit counts before the body is read, so even unreadable saves use it up.
    await expectTooMany(await exhaust(() => save("{"), 20), "saves");
  });
});

describe("PATCH and DELETE /api/saved/[id]", () => {
  it("asks for JSON first, then refuses changes from another site, before looking at the session", async () => {
    signIn();
    expect(await answer(await share({ shared: true }, { "sec-fetch-site": "same-origin", "content-type": "text/plain" }))).toEqual({
      status: 415,
      body: { error: "Send JSON." },
    });
    const refused = { status: 403, body: { error: "Changes work only from itsgiving's own pages." } };
    expect(await answer(await share({ shared: true }, CROSS_SITE))).toEqual(refused);
    expect(await answer(await unsave(CROSS_SITE))).toEqual(refused);
    expect(await answer(await unsave(SAME_SITE))).toEqual(refused);
    expect(viewerId).not.toHaveBeenCalled();
    expect(setShared).not.toHaveBeenCalled();
    expect(deleteSaved).not.toHaveBeenCalled();
  });

  it("says saving isn't set up without the secret key, and asks a signed-out person to sign in", async () => {
    vi.stubEnv("SUPABASE_SECRET_KEY", "");
    const off = { status: 404, body: { error: "Saving isn't set up on this server." } };
    expect(await answer(await share({ shared: true }))).toEqual(off);
    expect(await answer(await unsave())).toEqual(off);

    vi.stubEnv("SUPABASE_SECRET_KEY", SECRET);
    const signedOut = { status: 401, body: { error: "Sign in first." } };
    expect(await answer(await share({ shared: true }))).toEqual(signedOut);
    expect(await answer(await unsave())).toEqual(signedOut);
    expect(setShared).not.toHaveBeenCalled();
    expect(deleteSaved).not.toHaveBeenCalled();
  });

  it("turns a share link on or off for its owner, and reads the body strictly", async () => {
    const owner = signIn();
    vi.mocked(setShared).mockResolvedValue(true);
    expect(await answer(await share({ shared: true }))).toEqual({ status: 200, body: { shared: true } });
    expect(setShared).toHaveBeenLastCalledWith(SAVED_ID, owner, true);
    expect(await answer(await share({ shared: false }))).toEqual({ status: 200, body: { shared: false } });

    expect(await answer(await share("{ not json"))).toEqual({ status: 400, body: { error: "The request body must be JSON." } });
    const shape = { status: 400, body: { error: 'Send { "shared": true } or { "shared": false }.' } };
    expect(await answer(await share({ shared: "yes" }))).toEqual(shape);
    expect(await answer(await share({ shared: true, owner_id: "someone-else" }))).toEqual(shape);
    expect(setShared).toHaveBeenCalledTimes(2);
  });

  it("deletes its owner's treatment, and gives anyone else the same 404 as a missing one", async () => {
    const owner = signIn();
    vi.mocked(deleteSaved).mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    expect(await answer(await unsave())).toEqual({ status: 204, body: null });
    expect(deleteSaved).toHaveBeenCalledWith(SAVED_ID, owner);
    expect(await answer(await unsave())).toEqual({ status: 404, body: { error: "That treatment isn't one of yours." } });

    vi.mocked(setShared).mockRejectedValueOnce(new SavedStoreError("sharing a saved treatment: 540 project paused"));
    expect(await answer(await share({ shared: true }))).toEqual({
      status: 503,
      body: { error: "Saved treatments aren't available right now. Try again in a minute." },
    });
  });

  it("limits each person to 30 changes a minute, shares and deletes together", async () => {
    signIn();
    vi.mocked(deleteSaved).mockResolvedValue(true);
    vi.mocked(setShared).mockResolvedValue(true);
    let turn = 0;
    await expectTooMany(await exhaust(() => (++turn % 2 ? unsave() : share({ shared: true })), 30), "changes");
  });
});

describe("DELETE /api/account", () => {
  it("refuses a request from another site before looking at the session", async () => {
    signIn();
    const refused = { status: 403, body: { error: "Your account can be deleted only from itsgiving's own pages." } };
    expect(await answer(await unaccount(CROSS_SITE))).toEqual(refused);
    expect(await answer(await unaccount(SAME_SITE))).toEqual(refused);
    expect(confirmedViewerId).not.toHaveBeenCalled();
    expect(deleteAccount).not.toHaveBeenCalled();
  });

  it("says accounts aren't set up without the secret key, and asks a signed-out person to sign in", async () => {
    vi.stubEnv("SUPABASE_SECRET_KEY", "");
    expect(await answer(await unaccount())).toEqual({ status: 404, body: { error: "Accounts aren't set up on this server." } });
    vi.stubEnv("SUPABASE_SECRET_KEY", SECRET);
    // Only a session Supabase still vouches for counts; a token that would merely verify (viewerId) doesn't.
    vi.mocked(viewerId).mockResolvedValue("person-with-a-copied-token");
    expect(await answer(await unaccount())).toEqual({ status: 401, body: { error: "Sign in first." } });
    expect(deleteAccount).not.toHaveBeenCalled();
  });

  it("deletes the signed-in person's own account and signs this browser out", async () => {
    const id = signIn();
    const signOut = vi.fn().mockResolvedValue({ error: null });
    vi.mocked(sessionSupabase).mockResolvedValue({ auth: { signOut } } as unknown as Awaited<ReturnType<typeof sessionSupabase>>);
    expect(await answer(await unaccount())).toEqual({ status: 204, body: null });
    expect(deleteAccount).toHaveBeenCalledWith(id);
    expect(signOut).toHaveBeenCalledOnce();

    vi.mocked(deleteAccount).mockRejectedValueOnce(new SavedStoreError("deleting an account: unexpected_failure boom"));
    expect(await answer(await unaccount())).toEqual({
      status: 503,
      body: { error: "Your account couldn't be deleted just now. Try again in a minute." },
    });
  });

  it("limits each person to 5 tries a minute", async () => {
    signIn();
    await expectTooMany(await exhaust(() => unaccount(), 5), "tries");
  });
});
