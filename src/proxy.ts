import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getSupabasePublicEnv } from "@/lib/supabase/env";

/**
 * Runs before every page (SDD §6.3, §7.3 layer 1–2):
 *  - refreshes the Supabase session cookie,
 *  - sends signed-out visitors to /login,
 *  - keeps signed-in users on the step they must finish first (password change, then OTP).
 * This is a convenience gate. Real protection is server-side and in the database (RLS via
 * app.is_active_user), which applies the same rules to every query.
 */
const AUTH_STEPS: Record<string, string> = {
  change_password: "/change-password",
  otp_required: "/verify",
};
const AUTH_PAGES = new Set(["/login", "/verify", "/change-password"]);

function redirectTo(request: NextRequest, pathname: string, base: NextResponse) {
  const url = request.nextUrl.clone();
  const [path, query] = pathname.split("?");
  url.pathname = path;
  url.search = query ? `?${query}` : "";
  const response = NextResponse.redirect(url);
  for (const cookie of base.cookies.getAll()) response.cookies.set(cookie);
  return response;
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const env = getSupabasePublicEnv();
  let response = NextResponse.next({ request });

  if (!env) {
    // Not connected to Supabase yet: only the login page (which explains this) is reachable.
    return pathname === "/login" ? response : redirectTo(request, "/login", response);
  }

  const supabase = createServerClient(env.url, env.publishableKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) response.cookies.set(name, value, options);
        for (const [key, value] of Object.entries(headers ?? {})) response.headers.set(key, value);
      },
    },
  });

  const { data } = await supabase.auth.getClaims();
  const signedIn = Boolean(data?.claims?.sub);

  if (!signedIn) {
    return pathname === "/login" ? response : redirectTo(request, "/login", response);
  }

  const { data: info } = await supabase.rpc("my_session_status");
  const status = (info as { status?: string } | null)?.status ?? "no_profile";

  if (status === "inactive" || status === "no_profile") {
    await supabase.auth.signOut();
    return pathname === "/login" ? response : redirectTo(request, "/login?error=inactive", response);
  }

  const requiredStep = AUTH_STEPS[status];
  if (requiredStep) return pathname === requiredStep ? response : redirectTo(request, requiredStep, response);

  // Fully signed in: auth pages are no longer needed.
  if (AUTH_PAGES.has(pathname)) return redirectTo(request, "/", response);
  return response;
}

export const config = {
  matcher: [
    // Everything except Next.js internals, static brand files, icons, manifest and the service worker.
    "/((?!_next/static|_next/image|brand/|favicon.ico|manifest.webmanifest|sw.js).*)",
  ],
};
