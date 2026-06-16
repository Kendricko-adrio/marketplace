import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Admin routes that require authentication
const adminRoutes = ["/admin"];

// Auth routes (redirect if already logged in)
const authRoutes = ["/login"];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Get session token from cookies (admin uses the "admin" prefix)
  const sessionToken = request.cookies.get("admin.session_token")?.value;
  const isAuthenticated = !!sessionToken;

  // Check if trying to access admin routes without auth
  const isAdminRoute = adminRoutes.some((route) => pathname.startsWith(route));

  if (isAdminRoute && !isAuthenticated) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(loginUrl);
  }

  // Redirect authenticated users away from auth pages
  const isAuthRoute = authRoutes.some((route) => pathname.startsWith(route));

  if (isAuthRoute && isAuthenticated) {
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
