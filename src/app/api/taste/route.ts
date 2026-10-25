import { z } from "zod";
import { RateLimiter, clientIp } from "@/lib/agent/guards";
import { TasteImportError, getTasteDeps, importTaste } from "@/lib/agent/taste";
import { TmdbError } from "@/lib/tmdb";

// Imports a director's taste: a public TMDB list or pasted IMDb links, as films Qloo knows by IMDb ID.
// At most 26 TMDB calls (8 s each at worst, six at a time) and one Qloo call.
export const maxDuration = 30;

const MAX_BODY_BYTES = 4 * 1024;
const bodySchema = z.strictObject({ source: z.string().trim().min(1).max(2000) });
/** Per IP. An import can cost 26 TMDB calls, so bursts stay small. */
const limiter = new RateLimiter(8, 60_000);

function problem(status: number, error: string, headers?: Record<string, string>) {
  return Response.json({ error }, { status, headers });
}

export async function POST(request: Request) {
  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) return problem(413, "That's too much text to import.");
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return problem(400, "The request body must be JSON.");
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) return problem(400, "Paste a TMDB list link or IMDb links.");

  const limit = limiter.check(clientIp(request.headers));
  if (!limit.ok) {
    const seconds = Math.ceil(limit.retryAfterMs / 1000);
    return problem(429, `Too many imports at once. Try again in ${seconds} s.`, { "retry-after": String(seconds) });
  }

  const started = Date.now();
  try {
    const result = await importTaste(parsed.data.source, getTasteDeps(), request.signal);
    console.log(
      JSON.stringify({
        evt: "taste_import",
        source: result.source.kind,
        found: result.found.length,
        missing: result.missing.length,
        ms: Date.now() - started,
      }),
    );
    return Response.json(result);
  } catch (err) {
    if (err instanceof TmdbError)
      return problem(err.status === 404 || err.status === 429 || err.status === 503 ? err.status : 502, err.message);
    if (err instanceof TasteImportError) return problem(err.status, err.message);
    if (request.signal.aborted) return problem(499, "The import was cancelled.");
    console.error(err);
    return problem(500, "The import failed. Try again.");
  }
}
