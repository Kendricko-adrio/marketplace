import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

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

  // Get session token from cookies (admin uses the "admin" prefix).
  // This is only a lightweight existence check; the actual session validity
  // is verified by server components / API routes using auth.api.getSession().
  const sessionToken = request.cookies.get("admin.session_token")?.value;
  const isAuthenticated = !!sessionToken;
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
