import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getSessionCookie } from "better-auth/cookies";

const protectedRoutes = ["/cart", "/checkout", "/account"];

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const sessionToken = getSessionCookie(request, { cookiePrefix: "client" });
  const isProtected = protectedRoutes.some((route) => pathname.startsWith(route));

  if (isProtected && !sessionToken) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|public|.*\\.).*)"],
};
