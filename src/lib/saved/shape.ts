import { z } from "zod";
import { FORMATS, coverStill, subjectPhrase, treatmentWho } from "../agent/options";
import type { Treatment } from "../agent/types";

// What a saved treatment looks like on the way in, and the few words kept beside it so a list never loads whole
// treatments. Pure, so it's tested without a database (store.ts does the reading and writing).

/** At most this many treatments per person: about 6 MB at their usual 50-60 KB, far inside the free database. */
export const SAVED_LIMIT = 100;

/** A save request's body: one treatment (50-60 KB as built) and its seal, with room to spare. */
export const SAVE_BODY_LIMIT = 400_000;

/**
 * A change to saved treatments must come from this site's own pages. The session cookies are SameSite=Lax, which
 * stops other sites but not other hosts on the same site; browsers say where a request came from (Sec-Fetch-Site),
 * so anything not same-origin is refused. Tools that send no such header aren't browsers, and hold no one's cookies.
 */
export function fromElsewhere(headers: Headers): boolean {
  const site = headers.get("sec-fetch-site");
  return site !== null && site !== "same-origin";
}

/** A body that claims to be JSON: a cross-site form can't send that without a preflight the site never answers. */
export function sentJson(headers: Headers): boolean {
  return (headers.get("content-type") ?? "").toLowerCase().startsWith("application/json");
}

/** A saved treatment's id is its address, /s/<id>: a UUID, checked before it reaches a query. */
export function isSavedId(id: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
}

/** The take saved: its brief key and its build time. A replay keeps both, so saving the same board twice is one row. */
export function takeKey(t: Pick<Treatment, "id" | "createdAt">): string {
  return `${t.id}:${t.createdAt}`;
}

/** The line under a title in a list: "Music video for Prateek Kuhad, Mumbai". */
export function summaryOf(t: Treatment): string {
  const who = treatmentWho(t);
  const subject = subjectPhrase(who.artists, who.films, t.brief.format);
  return `${FORMATS[t.brief.format]}${subject ? ` ${subject}` : ""}, ${t.brief.city}`.slice(0, 300);
}

/** The list's picture: the cover's own still, or none (the cover is then its palette). */
export function coverOf(t: Treatment): string | null {
  return coverStill(t) ?? null;
}

// Only the fields the saving code and a list need are checked; the seal vouches for the rest.
const saveBody = z.object({
  treatment: z.looseObject({
    id: z.string().min(1).max(100),
    createdAt: z.string().min(1).max(40),
    title: z.string().min(1).max(200),
    brief: z.looseObject({ format: z.enum(["music_video", "short_film"]), city: z.string().max(100) }),
    references: z.array(z.looseObject({ still: z.string().max(500).optional() })),
    subjects: z.array(z.looseObject({ name: z.string() })),
  }),
  seal: z.string().min(1).max(200),
});

export type SaveRequest = { ok: true; treatment: Treatment; seal: string } | { ok: false; status: 400 | 413; message: string };

/**
 * A save request's body, read. The treatment returned is the JSON as sent, not the validator's copy: the seal is
 * over that text, key order and all.
 */
export function readSaveRequest(text: string): SaveRequest {
  if (text.length > SAVE_BODY_LIMIT) return { ok: false, status: 413, message: "That treatment is too large to save." };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, status: 400, message: "The request wasn't JSON." };
  }
  if (!saveBody.safeParse(raw).success) return { ok: false, status: 400, message: "That isn't a treatment this site built." };
  const { treatment, seal } = raw as { treatment: Treatment; seal: string };
  return { ok: true, treatment, seal };
}
