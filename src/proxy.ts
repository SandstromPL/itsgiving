import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { sessionCookie, supabasePublic } from "@/lib/supabase/config";

// Keeps a signed-in session fresh on the pages that read it on the server (a saved treatment, the saved list), where
// a server component can't write a refreshed cookie itself. Supabase's Next.js pattern, without its redirect to a
// login page: these pages answer signed-out visitors themselves. Everywhere else the browser's client refreshes the
// session, and the static pages never read it.

export async function proxy(request: NextRequest) {
  const config = supabasePublic();
  if (!config) return NextResponse.next({ request });
  let response = NextResponse.next({ request });
  const supabase = createServerClient(config.url, config.publishableKey, {
    cookieOptions: sessionCookie,
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(list, headers) {
        for (const { name, value } of list) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of list) response.cookies.set(name, value, options);
        // A response that sets a session must never be cached for someone else.
        for (const [key, value] of Object.entries(headers)) response.headers.set(key, value);
      },
    },
  });
  // Nothing may run between creating the client and this call (Supabase's guide): it's what refreshes the session.
  await supabase.auth.getClaims();
  return response;
}

export const config = {
  matcher: ["/s/:path*", "/saved"],
};
