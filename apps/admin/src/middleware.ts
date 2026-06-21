import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Admin routes that require authentication
const adminRoutes = ["/admin"];

// Auth routes (redirect if already logged in — but NOT the password reset
// pages, which authenticated users with mustResetPassword must be able to visit)
const authRoutes = ["/login"];

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

  // Get session token from cookies (admin uses the "admin" prefix)
  const sessionToken = request.cookies.get("admin.session_token")?.value;
  const isAuthenticated = !!sessionToken;
  const mustReset = request.cookies.get("admin.must_reset")?.value === "1";

  // Check if trying to access admin routes without auth
  const isAdminRoute = adminRoutes.some((route) => pathname.startsWith(route));

  if (isAdminRoute && !isAuthenticated) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(loginUrl);
  }

  // Must-reset gate: authenticated users who must change their password are
  // forced to /reset-password?force=1 for everything except the bypass list.
  if (
    isAuthenticated &&
    mustReset &&
    !isMustResetBypass(pathname) &&
    !pathname.startsWith("/api/") &&
    !pathname.startsWith("/_next")
  ) {
    const url = new URL("/reset-password", request.url);
    url.searchParams.set("force", "1");
    return NextResponse.redirect(url);
  }

  // Redirect authenticated users away from auth pages — but only if they
  // don't need to reset their password. A must-reset user landing on /login
  // should also be sent to /reset-password.
  const isAuthRoute = authRoutes.some((route) => pathname.startsWith(route));

  if (isAuthRoute && isAuthenticated) {
    if (mustReset) {
      const url = new URL("/reset-password", request.url);
      url.searchParams.set("force", "1");
      return NextResponse.redirect(url);
    }
    return NextResponse.redirect(new URL("/admin", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    // Match all routes except static files and api
    "/((?!api|_next/static|_next/image|favicon.ico|images).*)",
  ],
};
