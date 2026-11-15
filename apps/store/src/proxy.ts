import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getSessionCookie } from "better-auth/cookies";

const protectedRoutes = ["/cart", "/checkout", "/account"];

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const sessionToken = getSessionCookie(request, { cookiePrefix: "client" });
  const isProtected = protectedRoutes.some((route) => pathname.startsWith(route));

  if (isProtected && !sessionToken) {
    const loginUrl = new URL("/login", request.url);
    // Pathname AND query: `/checkout/result?order_id=...` must return the
    // customer to the same result page after sign-in. The value stays an
    // internal path; `safeStoreRedirect` still guards external callbacks.
    loginUrl.searchParams.set("callbackUrl", `${pathname}${search}`);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|public|.*\\.).*)"],
};
