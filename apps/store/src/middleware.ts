import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getSessionCookie } from "better-auth/cookies";

// Routes that require authentication
const protectedRoutes = ["/cart", "/checkout", "/account"];

// Auth routes (redirect if already logged in)
const authRoutes = ["/login", "/register"];

// Routes that bypass the onboarding gate even when logged in
const onboardingBypassPrefixes = [
  "/onboarding",
  "/auth/verify",
  "/api/auth",
  "/api/onboarding",
  "/forgot-password",
  "/reset-password",
];
const onboardingBypassExact = new Set(["/logout"]);

function isOnboardingBypass(pathname: string): boolean {
  if (onboardingBypassExact.has(pathname)) return true;
  return onboardingBypassPrefixes.some((p) => pathname.startsWith(p));
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Read the session cookie using Better Auth's helper so the __Secure- cookie
  // prefix (auto-applied when BETTER_AUTH_URL is https://) is handled
  // transparently. Reading "client.session_token" directly fails in production
  // HTTPS because the actual cookie name is "__Secure-client.session_token".
  //
  // IMPORTANT: only pass `cookiePrefix` — do NOT pass `cookieName`. The helper
  // appends a dash when both are set ("client-session_token"), but Better Auth
  // uses a dot ("client.session_token"). With only the prefix set, the else
  // branch appends a dot and the default cookieName "session_token" is used,
  // producing the correct name (and __Secure- prefixed variant in HTTPS).
  const sessionToken = getSessionCookie(request, {
    cookiePrefix: "client",
  });
  const isAuthenticated = !!sessionToken;
  // client.onboarding is set via document.cookie on the client (no __Secure-
  // prefix) and read back here — keep the plain name.
  const onboardingDone = request.cookies.get("client.onboarding")?.value === "1";

  // Check if trying to access protected routes without auth
  const isProtectedRoute = protectedRoutes.some((route) =>
    pathname.startsWith(route)
  );

  if (isProtectedRoute && !isAuthenticated) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(loginUrl);
  }

  // Redirect authenticated users away from auth routes
  const isAuthRoute = authRoutes.some((route) => pathname.startsWith(route));

  if (isAuthRoute && isAuthenticated && onboardingDone) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  // Onboarding gate: if logged in but onboarding not done, force to /onboarding
  // for all routes except the bypass list.
  if (
    isAuthenticated &&
    !onboardingDone &&
    !isOnboardingBypass(pathname) &&
    !pathname.startsWith("/api/") &&
    !pathname.startsWith("/_next") &&
    pathname !== "/"
  ) {
    return NextResponse.redirect(new URL("/onboarding", request.url));
  }

  // Also gate the homepage for logged-in-but-not-onboarded users.
  if (isAuthenticated && !onboardingDone && pathname === "/") {
    return NextResponse.redirect(new URL("/onboarding", request.url));
  }

  // If already onboarded and trying to visit /onboarding, send home.
  if (isAuthenticated && onboardingDone && pathname.startsWith("/onboarding")) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|public).*)",],
};