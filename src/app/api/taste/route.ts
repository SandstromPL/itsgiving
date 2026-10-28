import { z } from "zod";
import { RateLimiter, clientIp } from "@/lib/agent/guards";
import { TasteImportError, getTasteDeps, importTaste } from "@/lib/agent/taste";
import { problem, readJson, tooMany } from "@/lib/http";
import { TmdbError } from "@/lib/tmdb";

// Imports a director's taste: a public TMDB list or pasted IMDb links, as films Qloo knows by IMDb ID.
// At most 26 TMDB calls (8 s each at worst, six at a time) and one Qloo call.
export const maxDuration = 30;

const MAX_BODY_BYTES = 4 * 1024;
const bodySchema = z.strictObject({ source: z.string().trim().min(1).max(2000) });
/** Per IP. An import can cost 26 TMDB calls, so bursts stay small. */
const limiter = new RateLimiter(8, 60_000);

export async function POST(request: Request) {
  const body = await readJson(request, bodySchema, {
    tooLarge: { length: MAX_BODY_BYTES, message: "That's too much text to import." },
    invalid: "Paste a TMDB list link or IMDb links.",
  });
  if (body instanceof Response) return body;

  const limit = limiter.check(clientIp(request.headers));
  if (!limit.ok) return tooMany("imports", limit.retryAfterMs);

  const started = Date.now();
  try {
    const result = await importTaste(body.source, getTasteDeps(), request.signal);
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
