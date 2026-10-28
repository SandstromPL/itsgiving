import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Treatment } from "../agent/types";
import { SAVED_LIMIT, coverOf, summaryOf, takeKey } from "./shape";
import { SavedStoreError, deleteAccount, deleteSaved, saveTreatment, savedForViewer, savedList, setShared } from "./store";

// A stand-in for supabase-js: each query records its builder calls in order (from, select, eq, insert...) and, when
// awaited, answers with the next scripted reply. The store's own logic is what's under test, not PostgREST.
const fake = vi.hoisted(() => {
  type Call = { method: string; args: unknown[] };
  const state = {
    /** False: the server has no secret key, so there's no client. */
    configured: true,
    queries: [] as { table: string; calls: Call[] }[],
    replies: [] as { data?: unknown; count?: number | null; error?: { code?: string; message: string } | null }[],
    deleteUser: vi.fn(),
    client: {} as unknown,
  };
  state.client = {
    from(table: string) {
      const query = { table, calls: [] as Call[] };
      state.queries.push(query);
      const reply = state.replies.shift() ?? { data: null, error: null };
      const chain: object = new Proxy(
        {},
        {
          get: (_, method) =>
            method === "then"
              ? (resolve: (value: unknown) => void) => resolve(reply)
              : (...args: unknown[]) => {
                  query.calls.push({ method: String(method), args });
                  return chain;
                },
        },
      );
      return chain;
    },
    auth: { admin: { deleteUser: state.deleteUser } },
  };
  return state;
});

vi.mock("../supabase/server", () => ({ adminSupabase: () => (fake.configured ? fake.client : null) }));

const OWNER = "5b0c6a0e-1f2d-4c3b-9a8e-7d6c5b4a3f21";
const SAVED_ID = "0b4f7e2a-9c1d-4e5f-8a6b-7c8d9e0f1a2b";

/** Just enough of a treatment for the saving code: the seal vouches for the rest. */
const treatment = {
  id: "a1b2c3",
  createdAt: "2026-10-26T18:00:00.000Z",
  title: "Almost, in Bandra",
  brief: { format: "music_video", city: "Mumbai" },
  references: [{ entity: { id: "f1", name: "Lunchbox" }, still: "https://image.tmdb.org/t/p/w1280/x.jpg" }],
  subjects: [{ name: "Prateek Kuhad", kind: "artist" }],
  who: { artists: ["Prateek Kuhad"], films: [], standIns: [] },
} as unknown as Treatment;

const row = (overrides: Record<string, unknown> = {}) => ({
  id: SAVED_ID,
  owner_id: OWNER,
  title: "Almost, in Bandra",
  summary: "Music video for Prateek Kuhad, Mumbai",
  cover: null,
  shared: false,
  created_at: "2026-10-27T10:00:00.000Z",
  treatment,
  ...overrides,
});

const calls = (index: number) => fake.queries[index].calls.map(({ method, args }) => [method, ...args]);

/** Whether a query can only touch `owner`'s rows: it filters on owner_id, or it inserts a row that's theirs. */
const scopedTo = (query: (typeof fake.queries)[number], owner: string) =>
  query.calls.some(({ method, args }) => method === "eq" && args[0] === "owner_id" && args[1] === owner) ||
  query.calls.some(({ method, args }) => method === "insert" && (args[0] as { owner_id?: string }).owner_id === owner);

beforeEach(() => {
  fake.configured = true;
  fake.queries.length = 0;
  fake.replies.length = 0;
  fake.deleteUser.mockReset();
});

describe("saved treatments' store", () => {
  it("names the owner in every query that reads or writes a person's saved treatments", async () => {
    fake.replies.push({ data: null, error: null }, { count: 3, error: null }, { data: { id: SAVED_ID }, error: null });
    expect(await saveTreatment(OWNER, treatment)).toEqual({ kind: "saved", id: SAVED_ID, created: true });
    fake.replies.push({ data: [], error: null }, { data: [{ id: SAVED_ID }], error: null }, { data: [{ id: SAVED_ID }], error: null });
    await savedList(OWNER);
    expect(await setShared(SAVED_ID, OWNER, true)).toBe(true);
    expect(await deleteSaved(SAVED_ID, OWNER)).toBe(true);

    expect(fake.queries).toHaveLength(6);
    for (const query of fake.queries) {
      expect(query.table).toBe("saved_treatments");
      expect(scopedTo(query, OWNER), JSON.stringify(query.calls)).toBe(true);
    }
    // The new row is the owner's, keyed by its take, with the list's words beside it.
    expect(calls(2)[0]).toEqual([
      "insert",
      {
        owner_id: OWNER,
        take_key: takeKey(treatment),
        title: treatment.title,
        summary: summaryOf(treatment),
        cover: coverOf(treatment),
        treatment,
      },
    ]);
    expect(calls(4)).toEqual([
      ["update", { shared: true, updated_at: expect.any(String) }],
      ["eq", "id", SAVED_ID],
      ["eq", "owner_id", OWNER],
      ["select", "id"],
    ]);
  });

  it("says another owner's treatment isn't theirs to share or delete", async () => {
    fake.replies.push({ data: [], error: null }, { data: [], error: null });
    expect(await setShared(SAVED_ID, "someone-else", false)).toBe(false);
    expect(await deleteSaved(SAVED_ID, "someone-else")).toBe(false);
    expect(fake.queries.every((query) => scopedTo(query, "someone-else"))).toBe(true);
  });

  it("never sends an id that isn't a saved treatment's to the database", async () => {
    expect(await setShared("1 or 1=1", OWNER, true)).toBe(false);
    expect(await deleteSaved("../everything", OWNER)).toBe(false);
    expect(await savedForViewer("not-a-uuid", OWNER)).toBeNull();
    expect(fake.queries).toHaveLength(0);
  });

  it("shows a saved treatment to its owner always, and to anyone else only while it's shared", async () => {
    fake.replies.push({ data: row(), error: null }, { data: row(), error: null }, { data: row(), error: null });
    expect(await savedForViewer(SAVED_ID, OWNER)).toMatchObject({ id: SAVED_ID, ownerId: OWNER, shared: false, treatment });
    expect(await savedForViewer(SAVED_ID, "someone-else")).toBeNull();
    expect(await savedForViewer(SAVED_ID, null)).toBeNull();
    expect(calls(0)).toEqual([
      ["select", "id, owner_id, title, summary, cover, shared, created_at, treatment"],
      ["eq", "id", SAVED_ID],
      ["maybeSingle"],
    ]);

    fake.replies.push({ data: row({ shared: true }), error: null }, { data: null, error: null });
    expect(await savedForViewer(SAVED_ID, null)).toMatchObject({ id: SAVED_ID, shared: true });
    expect(await savedForViewer(SAVED_ID, OWNER)).toBeNull(); // gone
  });

  it(`stops at ${SAVED_LIMIT} saved treatments without writing`, async () => {
    fake.replies.push({ data: null, error: null }, { count: SAVED_LIMIT, error: null });
    expect(await saveTreatment(OWNER, treatment)).toEqual({ kind: "full" });
    expect(fake.queries).toHaveLength(2);
    expect(calls(1)).toEqual([
      ["select", "id", { count: "exact", head: true }],
      ["eq", "owner_id", OWNER],
    ]);

    fake.queries.length = 0;
    fake.replies.push({ data: null, error: null }, { count: SAVED_LIMIT - 1, error: null }, { data: { id: SAVED_ID }, error: null });
    expect(await saveTreatment(OWNER, treatment)).toEqual({ kind: "saved", id: SAVED_ID, created: true });
  });

  it("answers the same take saved again with the row it already has, even when two saves race", async () => {
    // Saved before: found at once, nothing written.
    fake.replies.push({ data: { id: SAVED_ID }, error: null });
    expect(await saveTreatment(OWNER, treatment)).toEqual({ kind: "saved", id: SAVED_ID, created: false });
    expect(fake.queries).toHaveLength(1);
    expect(calls(0)).toEqual([["select", "id"], ["eq", "owner_id", OWNER], ["eq", "take_key", takeKey(treatment)], ["maybeSingle"]]);

    // Another save of the take won the race: the unique key refuses this one (23505), which then finds that row.
    fake.queries.length = 0;
    fake.replies.push(
      { data: null, error: null },
      { count: 4, error: null },
      { data: null, error: { code: "23505", message: "duplicate key value violates unique constraint" } },
      { data: { id: SAVED_ID }, error: null },
    );
    expect(await saveTreatment(OWNER, treatment)).toEqual({ kind: "saved", id: SAVED_ID, created: false });
    expect(fake.queries).toHaveLength(4);
    expect(scopedTo(fake.queries[3], OWNER)).toBe(true);
  });

  it("reports a save for an account deleted elsewhere (23503) as no account, not a failure", async () => {
    fake.replies.push(
      { data: null, error: null },
      { count: 0, error: null },
      { data: null, error: { code: "23503", message: 'insert or update on table "saved_treatments" violates foreign key constraint' } },
    );
    expect(await saveTreatment(OWNER, treatment)).toEqual({ kind: "no_account" });
  });

  it("turns any other database answer into a SavedStoreError the routes report as unavailable", async () => {
    fake.replies.push({ data: null, error: { code: "PGRST301", message: "JWT expired" } });
    await expect(saveTreatment(OWNER, treatment)).rejects.toThrow(new SavedStoreError("looking up a saved take: PGRST301 JWT expired"));

    // A race lost twice over (the winning row then vanished) is a failure too, not a made-up id.
    fake.replies.push(
      { data: null, error: null },
      { count: 0, error: null },
      { data: null, error: { code: "23505", message: "duplicate key" } },
      { data: null, error: null },
    );
    await expect(saveTreatment(OWNER, treatment)).rejects.toThrow(new SavedStoreError("saving a treatment: 23505 duplicate key"));

    fake.replies.push({ data: null, error: { code: "PGRST002", message: "Could not query the database for the schema cache" } });
    await expect(savedList(OWNER)).rejects.toThrow(
      new SavedStoreError("listing saved treatments: PGRST002 Could not query the database for the schema cache"),
    );

    fake.configured = false;
    await expect(savedList(OWNER)).rejects.toThrow(new SavedStoreError("Accounts aren't set up on this server."));
  });

  it("deletes an account by its own id, counting one that's already gone as done", async () => {
    fake.deleteUser.mockResolvedValueOnce({ data: {}, error: null });
    await deleteAccount(OWNER);
    expect(fake.deleteUser).toHaveBeenCalledWith(OWNER);

    fake.deleteUser.mockResolvedValueOnce({ data: null, error: { status: 404, code: "user_not_found", message: "User not found" } });
    await expect(deleteAccount(OWNER)).resolves.toBeUndefined();

    // Any other 404 (a wrong project address) must not pass for an erasure.
    fake.deleteUser.mockResolvedValueOnce({ data: null, error: { status: 404, code: "not_found", message: "Not Found" } });
    await expect(deleteAccount(OWNER)).rejects.toThrow(new SavedStoreError("deleting an account: not_found Not Found"));
  });
});
