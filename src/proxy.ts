import { createServerClient, type SetAllCookies } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { statusPage } from "@/app/s/status-page";
import { RateLimiter, clientIp } from "@/lib/agent/guards";
import { isSavedId } from "@/lib/saved/shape";
import { SavedStoreError, savedVisible } from "@/lib/saved/store";
import { sessionCookie, supabasePublic } from "@/lib/supabase/config";

// Two jobs. It keeps a signed-in session fresh on the pages that read it on the server (a saved treatment, the saved
// list), where a server component can't write a refreshed cookie itself: Supabase's Next.js pattern, without its
// redirect to a login page, since these pages answer signed-out visitors themselves. Everywhere else the browser's
// client refreshes the session, and the static pages never read it. And it answers a saved treatment's link before the
// page starts, so the status is true (Next fixes a page's once it starts streaming): 404 for a treatment this visitor
// can't open, 429 past the limit, 503 when the database is down.

/**
 * Where a saved treatment's link that leads nowhere is sent: an address no route matches, so Next answers with the
 * site's 404 page and its status (app/not-found.tsx), while the visitor keeps the link's address.
 */
const MISSING = "/_saved-gone";

/**
 * Saved treatments one address may open a minute: far more than anyone reads, too few for a script to run up the free
 * database's quota. Every request counts: Next keeps its routing headers from the proxy, so a prefetch looks like an
 * open, and the site's links to a saved treatment don't prefetch. Per server instance, like the site's other limits;
 * IPv6 counts by its /64 (see clientIp).
 */
const opens = new RateLimiter(60, 60_000);

export async function proxy(request: NextRequest) {
  const config = supabasePublic();
  let refreshed: { cookies: Parameters<SetAllCookies>[0]; headers: Record<string, string> } | undefined;
  let viewer: string | null = null;
  if (config) {
    const supabase = createServerClient(config.url, config.publishableKey, {
      cookieOptions: sessionCookie,
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll(cookies, headers) {
          for (const { name, value } of cookies) request.cookies.set(name, value);
          refreshed = { cookies, headers };
        },
      },
    });
    // Nothing may run between creating the client and this call (Supabase's guide): it's what refreshes the session.
    const { data } = await supabase.auth.getClaims();
    viewer = typeof data?.claims.sub === "string" ? data.claims.sub : null;
  }
  const response = (await savedAnswer(request, viewer)) ?? NextResponse.next({ request });
  if (refreshed) {
    for (const { name, value, options } of refreshed.cookies) response.cookies.set(name, value, options);
    // A response that sets a session must never be cached for someone else.
    for (const [key, value] of Object.entries(refreshed.headers)) response.headers.set(key, value);
  }
  return response;
}

/** The answer to a saved treatment's link when its page shouldn't render, or nothing when it should. */
async function savedAnswer(request: NextRequest, viewer: string | null): Promise<NextResponse | undefined> {
  const { pathname } = request.nextUrl;
  const id = /^\/s\/([^/]+)\/?$/.exec(pathname)?.[1];
  if (!id) return undefined;
  if (!isSavedId(id)) return NextResponse.rewrite(new URL(MISSING, request.url), { request });
  const limit = opens.check(clientIp(request.headers));
  if (!limit.ok) {
    const seconds = Math.ceil(limit.retryAfterMs / 1000);
    return statusPage(
      429,
      {
        title: "Try again in a minute: itsgiving",
        heading: "give it a minute",
        text: `Too many saved treatments were opened from your connection in the last minute. Try again in ${seconds} seconds.`,
      },
      seconds,
    );
  }
  try {
    return (await savedVisible(id, viewer)) ? undefined : NextResponse.rewrite(new URL(MISSING, request.url), { request });
  } catch (err) {
    if (!(err instanceof SavedStoreError)) throw err;
    console.error(JSON.stringify({ evt: "saved", action: "check", outcome: "unavailable", error: err.message }));
    return statusPage(
      503,
      {
        title: "Saved treatments are offline: itsgiving",
        heading: "saved treatments are offline",
        text: "The database didn't answer. Try again in a minute; building a new treatment still works.",
      },
      60,
    );
  }
}

export const config = {
  matcher: ["/s/:path*", "/saved"],
};
