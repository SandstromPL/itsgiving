import { RateLimiter } from "@/lib/agent/guards";
import { problem, tooMany } from "@/lib/http";
import { fromElsewhere } from "@/lib/saved/shape";
import { SavedStoreError, deleteAccount } from "@/lib/saved/store";
import { confirmedViewerId, savingConfigured, sessionSupabase } from "@/lib/supabase/server";

// Deletes the signed-in person's itsgiving account and everything they saved, so their share links stop working. Only
// ever their own (the id comes from their session, confirmed with Supabase: a copied token from a session that has
// signed out can't do it), and only from this site's pages. Their Google or GitHub account is untouched; signing in
// again starts a new, empty account.

/** Per person: deleting is one confirmed click, so only a stuck button comes near this. */
const limiter = new RateLimiter(5, 60_000);

export async function DELETE(request: Request) {
  if (fromElsewhere(request.headers)) return problem(403, "Your account can be deleted only from itsgiving's own pages.");
  if (!savingConfigured()) return problem(404, "Accounts aren't set up on this server.");
  const id = await confirmedViewerId();
  if (!id) return problem(401, "Sign in first.");
  const limit = limiter.check(id);
  if (!limit.ok) return tooMany("tries", limit.retryAfterMs);

  const started = Date.now();
  try {
    await deleteAccount(id);
  } catch (err) {
    if (!(err instanceof SavedStoreError)) throw err;
    console.error(JSON.stringify({ evt: "account", action: "delete", outcome: "unavailable", error: err.message }));
    return problem(503, "Your account couldn't be deleted just now. Try again in a minute.");
  }
  // Sign this browser out too. Supabase answers that the person no longer exists, which its client takes as done and
  // clears the session cookies anyway. Their other devices lost their refresh tokens with the account; what's left of
  // their access tokens lapses within the hour, and nothing can be saved to an account that's gone.
  await (await sessionSupabase())?.auth.signOut().catch(() => undefined);
  console.log(JSON.stringify({ evt: "account", action: "delete", outcome: "ok", ms: Date.now() - started }));
  return new Response(null, { status: 204 });
}
