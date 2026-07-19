import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getSessionCookie } from "better-auth/cookies";

// Admin routes that require authentication
const adminRoutes = ["/admin"];

// Routes that bypass the mustResetPassword gate (authenticated users who are
// forced to change their password can still visit these).
const mustResetBypassPrefixes = [
  "/reset-password",
  "/api/auth",
  "/api/admin/users", // allow HQ to keep managing users mid-session (defensive)
  "/logout",
];

function isMustResetBypass(pathname: string): boolean {
  return mustResetBypassPrefixes.some((p) => pathname.startsWith(p));
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Read the session cookie using Better Auth's helper so the __Secure- cookie
  // prefix (auto-applied when BETTER_AUTH_URL is https://) is handled
  // transparently. Reading "admin.session_token" directly fails in production
  // HTTPS because the actual cookie name is "__Secure-admin.session_token".
  //
  // IMPORTANT: only pass `cookiePrefix` — do NOT pass `cookieName`. The helper
  // appends a dash when both are set ("admin-session_token"), but Better Auth
  // uses a dot ("admin.session_token"). With only the prefix set, the else
  // branch appends a dot and the default cookieName "session_token" is used,
  // producing the correct name (and __Secure- prefixed variant in HTTPS).
  const sessionToken = getSessionCookie(request, {
    cookiePrefix: "admin",
  });
  const isAuthenticated = !!sessionToken;
  // admin.must_reset is set via document.cookie on the client (no __Secure-
  // prefix) and read back here — keep the plain name.
  const mustReset = request.cookies.get("admin.must_reset")?.value === "1";

  const isAdminRoute = adminRoutes.some((route) => pathname.startsWith(route));

  // Unauthenticated users trying to access admin routes are sent to login.
  if (isAdminRoute && !isAuthenticated) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(loginUrl);
  }

  // Must-reset gate: only applies to admin routes. The actual session validity
  // is checked server-side; a stale cookie alone won't create a redirect loop
  // because /login no longer redirects based solely on cookie presence.
  if (
    isAdminRoute &&
    isAuthenticated &&
    mustReset &&
    !isMustResetBypass(pathname)
  ) {
    const url = new URL("/reset-password", request.url);
    url.searchParams.set("force", "1");
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    // Match all routes except static files and api
    "/((?!api|_next/static|_next/image|favicon.ico|images).*)",
  ],
};
