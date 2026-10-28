import type { z } from "zod";

// What the API routes answer when they refuse a request. The pages show `error` as it stands (the treatment stream,
// the taste import, the save, share and delete controls), so each route words its own; the shape is the same for all.

/** An error answer: `{ error: message }` with `status`, plus any headers it needs (Retry-After on a 429). */
export function problem(status: number, message: string, headers?: Record<string, string>): Response {
  return Response.json({ error: message }, { status, headers });
}

/** A rate limit's 429: "Too many <what> at once", with the wait in whole seconds both in the words and in Retry-After. */
export function tooMany(what: string, retryAfterMs: number): Response {
  const seconds = Math.ceil(retryAfterMs / 1000);
  return problem(429, `Too many ${what} at once. Try again in ${seconds} s.`, { "retry-after": String(seconds) });
}

export interface ReadJsonOptions {
  /** The 400's message when the JSON doesn't fit the schema, or a way to word it from zod's error. */
  invalid: string | ((error: z.ZodError) => string);
  /** A longer body (in characters, before it's parsed) gets a 413 with `message`. */
  tooLarge?: { length: number; message: string };
}

/** The request's JSON body, checked against `schema`: the parsed data, or the 400 (or 413) the route answers with. */
export async function readJson<T>(request: Request, schema: z.ZodType<T>, options: ReadJsonOptions): Promise<T | Response> {
  const raw = await request.text();
  if (options.tooLarge && raw.length > options.tooLarge.length) return problem(413, options.tooLarge.message);
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return problem(400, "The request body must be JSON.");
  }
  const parsed = schema.safeParse(body);
  if (parsed.success) return parsed.data;
  return problem(400, typeof options.invalid === "string" ? options.invalid : options.invalid(parsed.error));
}
