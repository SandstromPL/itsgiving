import { RateLimiter } from "@/lib/agent/guards";
import { sealHolds } from "@/lib/agent/seal";
import { problem, tooMany } from "@/lib/http";
import { fromElsewhere, readSaveRequest, SAVED_LIMIT, sentJson } from "@/lib/saved/shape";
import { SavedStoreError, saveTreatment } from "@/lib/saved/store";
import { savingSecret, viewerId } from "@/lib/supabase/server";

// Saves a treatment to the signed-in person's account: one this server built (its seal holds), at most 100 each.
// Saving the same take again answers with the row it already has.

/** Per person: saving is one click, so even a busy session stays far under this. */
const limiter = new RateLimiter(20, 60_000);

export async function POST(request: Request) {
  if (fromElsewhere(request.headers) || !sentJson(request.headers)) return problem(403, "Saving works only from itsgiving's own pages.");
  const secret = savingSecret();
  if (!secret) return problem(404, "Saving isn't set up on this server.");
  const owner = await viewerId();
  if (!owner) return problem(401, "Sign in to save.");

  const limit = limiter.check(owner);
  if (!limit.ok) return tooMany("saves", limit.retryAfterMs);

  // Not readJson: the seal is over the treatment as sent, key order and all, so this keeps the JSON rather than zod's copy.
  const read = readSaveRequest(await request.text());
  if (!read.ok) return problem(read.status, read.message);
  if (!sealHolds(read.treatment, read.seal, secret)) return problem(400, "That isn't a treatment this site built, so it can't be saved.");

  const started = Date.now();
  try {
    const outcome = await saveTreatment(owner, read.treatment);
    console.log(JSON.stringify({ evt: "saved", action: "save", outcome: outcome.kind, ms: Date.now() - started }));
    if (outcome.kind === "full")
      return problem(409, `You have ${SAVED_LIMIT} saved treatments, as many as there's room for. Delete one to save this.`);
    if (outcome.kind === "no_account") return problem(401, "This account was deleted. Sign in again to save.");
    return Response.json({ id: outcome.id }, { status: outcome.created ? 201 : 200 });
  } catch (err) {
    if (!(err instanceof SavedStoreError)) throw err;
    console.error(JSON.stringify({ evt: "saved", action: "save", outcome: "unavailable", error: err.message }));
    return problem(503, "Saving isn't available right now. Try again in a minute.");
  }
}
