import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { sessionCookie, supabasePublic } from "./config";

// The browser's Supabase client, used only to sign in and out and to know who's signed in; treatments go through
// the site's own routes. Loaded on demand (account.tsx), so pages that never touch an account don't carry it.

let client: SupabaseClient | null = null;

export function browserSupabase(): SupabaseClient | null {
  const config = supabasePublic();
  if (!config) return null;
  client ??= createBrowserClient(config.url, config.publishableKey, { cookieOptions: sessionCookie });
  return client;
}

export type Provider = "google" | "github";

/** Off to Google or GitHub, then back through /auth/callback to `next`, a path on this site. */
export async function signIn(provider: Provider, next: string): Promise<string | null> {
  const supabase = browserSupabase();
  if (!supabase) return "Sign-in isn't set up on this server.";
  const redirectTo = `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`;
  const { error } = await supabase.auth.signInWithOAuth({ provider, options: { redirectTo } });
  return error ? "Sign-in couldn't start. Try again." : null;
}

export async function signOut(): Promise<void> {
  await browserSupabase()?.auth.signOut();
}
