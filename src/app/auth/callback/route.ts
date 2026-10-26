import { NextResponse, type NextRequest } from "next/server";
import { returnPath } from "@/lib/supabase/config";
import { sessionSupabase } from "@/lib/supabase/server";

// Where Google or GitHub sends someone back after they sign in (through Supabase): the one-time code becomes a
// session in cookies, and they return to where they started. `next` is only ever a path on this site, checked twice:
// as a path, then as the address it makes. A cancelled or failed sign-in lands on the saved list, which says so and
// offers to try again. Neither answer may be cached: one sets a session.

function go(path: string, origin: string) {
  const to = new URL(path, origin);
  const response = NextResponse.redirect(to.origin === origin ? to : new URL("/", origin));
  response.headers.set("cache-control", "no-store");
  return response;
}

export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get("code");
  const next = returnPath(searchParams.get("next"));
  const supabase = await sessionSupabase();
  if (code && supabase) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return go(next, origin);
    console.error(JSON.stringify({ evt: "signin", outcome: "exchange_failed", code: String(error.code ?? error.name).slice(0, 60) }));
  } else {
    const reason = code ? "accounts_off" : (searchParams.get("error") ?? "no_code");
    console.log(JSON.stringify({ evt: "signin", outcome: reason.slice(0, 60) }));
  }
  return go("/saved?signin=failed", origin);
}
