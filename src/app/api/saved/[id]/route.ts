import { z } from "zod";
import { RateLimiter } from "@/lib/agent/guards";
import { problem, readJson, tooMany } from "@/lib/http";
import { fromElsewhere, sentJson } from "@/lib/saved/shape";
import { SavedStoreError, deleteSaved, setShared } from "@/lib/saved/store";
import { savingConfigured, viewerId } from "@/lib/supabase/server";

// One saved treatment, its owner's only: turn its share link on or off, or delete it. Anyone else gets a 404, the same
// as for a treatment that doesn't exist, so the answer never says whether an id is in use.

const limiter = new RateLimiter(30, 60_000);
const shareSchema = z.strictObject({ shared: z.boolean() });

async function owner(request: Request): Promise<{ id: string } | Response> {
  if (fromElsewhere(request.headers)) return problem(403, "Changes work only from itsgiving's own pages.");
  if (!savingConfigured()) return problem(404, "Saving isn't set up on this server.");
  const id = await viewerId();
  if (!id) return problem(401, "Sign in first.");
  const limit = limiter.check(id);
  if (!limit.ok) return tooMany("changes", limit.retryAfterMs);
  return { id };
}

async function attempt(action: string, run: () => Promise<boolean>, done: () => Response): Promise<Response> {
  const started = Date.now();
  try {
    const found = await run();
    console.log(JSON.stringify({ evt: "saved", action, outcome: found ? "ok" : "not_found", ms: Date.now() - started }));
    return found ? done() : problem(404, "That treatment isn't one of yours.");
  } catch (err) {
    if (!(err instanceof SavedStoreError)) throw err;
    console.error(JSON.stringify({ evt: "saved", action, outcome: "unavailable", error: err.message }));
    return problem(503, "Saved treatments aren't available right now. Try again in a minute.");
  }
}

export async function PATCH(request: Request, { params }: RouteContext<"/api/saved/[id]">) {
  if (!sentJson(request.headers)) return problem(415, "Send JSON.");
  const who = await owner(request);
  if (who instanceof Response) return who;
  const body = await readJson(request, shareSchema, { invalid: 'Send { "shared": true } or { "shared": false }.' });
  if (body instanceof Response) return body;
  const { id } = await params;
  const { shared } = body;
  return attempt(
    shared ? "share" : "unshare",
    () => setShared(id, who.id, shared),
    () => Response.json({ shared }),
  );
}

export async function DELETE(request: Request, { params }: RouteContext<"/api/saved/[id]">) {
  const who = await owner(request);
  if (who instanceof Response) return who;
  const { id } = await params;
  return attempt(
    "delete",
    () => deleteSaved(id, who.id),
    () => new Response(null, { status: 204 }),
  );
}
