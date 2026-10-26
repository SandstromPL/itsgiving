// Accounts (sign-in, saving, sharing) run on Supabase. Without its address and publishable key they're off: every
// account control hides itself and the app works as before, as it does in mock mode or a fresh clone.

export interface SupabasePublic {
  url: string;
  publishableKey: string;
}

/** The project's address and publishable key (safe in a browser), or null when accounts aren't set up. */
export function supabasePublic(): SupabasePublic | null {
  // Spelled out in full: Next writes NEXT_PUBLIC_ values into the browser's code only where they're named like this.
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();
  return url && publishableKey ? { url, publishableKey } : null;
}

/** Whether accounts are set up: the same answer on the server and in the browser, both fixed at build. */
export const accountsOn = supabasePublic() !== null;

/**
 * The session cookies' options on top of Supabase's (path "/", SameSite=Lax, readable by the browser's client):
 * Secure in a production build, so they never travel over plain HTTP. Every client here passes the same.
 */
export const sessionCookie = { secure: process.env.NODE_ENV === "production" };

/**
 * Where to go after signing in: a path on this site, or home. `next` arrives in a URL, so anything that could leave
 * the site (another host, `//host`, a backslash trick, a scheme) is refused, including dot segments that collapse
 * into one: "/.//host" resolves to "//host", which a browser reads as another site.
 */
export function returnPath(next: string | null | undefined): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || /[\\\s]/.test(next)) return "/";
  const base = "https://itsgiving.invalid";
  try {
    const url = new URL(next, base);
    if (url.origin !== base || url.pathname.startsWith("//")) return "/";
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return "/";
  }
}
