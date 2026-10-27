import "server-only";
import { createServerClient } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { connection } from "next/server";
import { sessionCookie, supabasePublic } from "./config";

/**
 * A client that reads the visitor's session from their cookies, a new one per request. In a route handler it also
 * writes a refreshed session back; a server component can't set cookies, and the proxy (src/proxy.ts) refreshes
 * sessions on the pages that read them.
 */
export async function sessionSupabase(): Promise<SupabaseClient | null> {
  const config = supabasePublic();
  if (!config) return null;
  const store = await cookies();
  return createServerClient(config.url, config.publishableKey, {
    cookieOptions: sessionCookie,
    cookies: {
      getAll: () => store.getAll(),
      setAll(list) {
        try {
          for (const { name, value, options } of list) store.set(name, value, options);
        } catch {
          // Called from a server component, which can't set cookies: the proxy keeps those pages' sessions fresh.
        }
      },
    },
  });
}

/**
 * Who's signed in, checked against the project's signing keys: their user id, or null when nobody is. Only for a real
 * request: the check reads the clock (is the token expired?) and may fetch the keys, and a page that depends on who's
 * asking must not be worked out ahead of time by a prefetch, which would carry the visitor's cookies but no request.
 */
export async function viewerId(): Promise<string | null> {
  await connection();
  const supabase = await sessionSupabase();
  if (!supabase) return null;
  const { data } = await supabase.auth.getClaims();
  const sub = data?.claims?.sub;
  return typeof sub === "string" && sub ? sub : null;
}

/**
 * Who's signed in, asked of Supabase itself rather than read off the token: a session that signed out, or an account
 * that's gone, no longer counts, though its token would verify until it expires. A round trip, so only for what can't
 * be undone.
 */
export async function confirmedViewerId(): Promise<string | null> {
  await connection();
  const supabase = await sessionSupabase();
  if (!supabase) return null;
  const { data } = await supabase.auth.getUser();
  return data.user?.id ?? null;
}

/** How long the server waits for the database: a slow or paused project then reads as unavailable, not a hung page. */
const DATABASE_TIMEOUT_MS = 8_000;

let admin: SupabaseClient | null = null;

/**
 * The server's own client, with the secret key. It passes RLS, so the one module that uses it (saved/store.ts) names
 * the owner in every query. It holds no session, so one serves every request.
 */
export function adminSupabase(): SupabaseClient | null {
  const config = supabasePublic();
  const secret = process.env.SUPABASE_SECRET_KEY?.trim();
  if (!config || !secret) return null;
  admin ??= createClient(config.url, secret, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: {
      fetch: (input, init) => {
        const timeout = AbortSignal.timeout(DATABASE_TIMEOUT_MS);
        return fetch(input, { ...init, signal: init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout });
      },
    },
  });
  return admin;
}
