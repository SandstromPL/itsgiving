import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Treatment } from "../agent/types";
import { adminSupabase } from "../supabase/server";
import { SAVED_LIMIT, coverOf, isSavedId, summaryOf, takeKey } from "./shape";

// Saved treatments, read and written by the server alone (the table grants browsers nothing: see the migration in
// supabase/migrations). The secret key passes RLS, so every query here names the owner, or reads one row and checks
// who may see it before returning it.

const TABLE = "saved_treatments";

export interface SavedSummary {
  id: string;
  title: string;
  /** "Music video for Prateek Kuhad, Mumbai". */
  summary: string;
  cover: string | null;
  shared: boolean;
  savedAt: string;
}

export interface SavedTreatment extends SavedSummary {
  ownerId: string;
  treatment: Treatment;
}

/** The database didn't answer as expected (a paused free project answers 540): the caller says saving is unavailable. */
export class SavedStoreError extends Error {}

function db(): SupabaseClient {
  const client = adminSupabase();
  if (!client) throw new SavedStoreError("Accounts aren't set up on this server.");
  return client;
}

function fail(what: string, error: { message: string; code?: string }): never {
  throw new SavedStoreError([`${what}:`, error.code, error.message].filter(Boolean).join(" "));
}

type Row = {
  id: string;
  owner_id: string;
  title: string;
  summary: string;
  cover: string | null;
  shared: boolean;
  created_at: string;
  treatment: Treatment;
};

const summaryFrom = (row: Omit<Row, "owner_id" | "treatment">): SavedSummary => ({
  id: row.id,
  title: row.title,
  summary: row.summary,
  cover: row.cover,
  shared: row.shared,
  savedAt: row.created_at,
});

export type SaveOutcome = { kind: "saved"; id: string; created: boolean } | { kind: "full" } | { kind: "no_account" };

/** Keeps a treatment for its owner; the same take again returns the row it already has. */
export async function saveTreatment(ownerId: string, treatment: Treatment): Promise<SaveOutcome> {
  const take = takeKey(treatment);
  const existing = async () => {
    const { data, error } = await db().from(TABLE).select("id").eq("owner_id", ownerId).eq("take_key", take).maybeSingle();
    if (error) fail("looking up a saved take", error);
    return data?.id as string | undefined;
  };
  const known = await existing();
  if (known) return { kind: "saved", id: known, created: false };

  const { count, error: counted } = await db().from(TABLE).select("id", { count: "exact", head: true }).eq("owner_id", ownerId);
  if (counted) fail("counting saved treatments", counted);
  if ((count ?? 0) >= SAVED_LIMIT) return { kind: "full" };

  const { data, error } = await db()
    .from(TABLE)
    .insert({
      owner_id: ownerId,
      take_key: take,
      title: treatment.title.slice(0, 200),
      summary: summaryOf(treatment),
      cover: coverOf(treatment),
      treatment,
    })
    .select("id")
    .single();
  if (error) {
    // Two saves of one take at once: the second finds the first's row.
    if (error.code === "23505") {
      const id = await existing();
      if (id) return { kind: "saved", id, created: false };
    }
    // The account was deleted on another device and this one's token hasn't expired yet: there's no one to save for.
    if (error.code === "23503") return { kind: "no_account" };
    fail("saving a treatment", error);
  }
  return { kind: "saved", id: data.id as string, created: true };
}

/** Who may see a saved treatment: its owner always, anyone else only while it's shared. */
const visibleTo = (row: Pick<Row, "owner_id" | "shared">, viewerId: string | null) => row.shared || row.owner_id === viewerId;

/** A saved treatment, if this viewer may see it. */
export async function savedForViewer(id: string, viewerId: string | null): Promise<SavedTreatment | null> {
  if (!isSavedId(id)) return null;
  const { data, error } = await db()
    .from(TABLE)
    .select("id, owner_id, title, summary, cover, shared, created_at, treatment")
    .eq("id", id)
    .maybeSingle<Row>();
  if (error) fail("reading a saved treatment", error);
  if (!data || !visibleTo(data, viewerId)) return null;
  return { ...summaryFrom(data), ownerId: data.owner_id, treatment: data.treatment };
}

/**
 * Whether this viewer may open a saved treatment, asked without reading the treatment: the proxy's check, so a link
 * that leads nowhere answers 404 before its page starts.
 */
export async function savedVisible(id: string, viewerId: string | null): Promise<boolean> {
  if (!isSavedId(id)) return false;
  const { data, error } = await db().from(TABLE).select("owner_id, shared").eq("id", id).maybeSingle<Pick<Row, "owner_id" | "shared">>();
  if (error) fail("checking a saved treatment", error);
  return Boolean(data && visibleTo(data, viewerId));
}

/** A person's saved treatments, newest first, without the treatments themselves. */
export async function savedList(ownerId: string): Promise<SavedSummary[]> {
  const { data, error } = await db()
    .from(TABLE)
    .select("id, title, summary, cover, shared, created_at")
    .eq("owner_id", ownerId)
    .order("created_at", { ascending: false })
    .limit(SAVED_LIMIT);
  if (error) fail("listing saved treatments", error);
  return (data ?? []).map(summaryFrom);
}

/** Turns a treatment's share link on or off; false when it isn't this owner's. */
export async function setShared(id: string, ownerId: string, shared: boolean): Promise<boolean> {
  if (!isSavedId(id)) return false;
  const { data, error } = await db()
    .from(TABLE)
    .update({ shared, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("owner_id", ownerId)
    .select("id");
  if (error) fail("sharing a saved treatment", error);
  return (data ?? []).length > 0;
}

/** Deletes a saved treatment; false when it isn't this owner's. */
export async function deleteSaved(id: string, ownerId: string): Promise<boolean> {
  if (!isSavedId(id)) return false;
  const { data, error } = await db().from(TABLE).delete().eq("id", id).eq("owner_id", ownerId).select("id");
  if (error) fail("deleting a saved treatment", error);
  return (data ?? []).length > 0;
}

/**
 * Deletes a person's account: their Supabase user, and with it every treatment they saved (the table's foreign key
 * cascades), so its share links stop working at once. Someone already gone counts as done: a second press, another tab.
 */
export async function deleteAccount(ownerId: string): Promise<void> {
  const { error } = await db().auth.admin.deleteUser(ownerId);
  // Only Supabase's own "no such user" means gone; any other 404 (a wrong project address) must not claim an erasure.
  if (error && !(error.status === 404 && error.code === "user_not_found")) fail("deleting an account", error);
}
