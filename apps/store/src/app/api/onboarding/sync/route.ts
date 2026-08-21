import { NextResponse, type NextRequest } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { safeStoreRedirect } from "@/lib/safe-redirect";
import { getPublicAppUrl } from "@/lib/public-url";

// Syncs the edge cookie `client.onboarding` from the DB state, then redirects
// home. Used when the DB says onboarding is done but the cookie is missing
// (expired or never set) to avoid an infinite redirect loop with middleware.
export async function GET(request: NextRequest) {
  const publicAppUrl = getPublicAppUrl();
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session) {
    const loginUrl = new URL("/login", publicAppUrl);
    loginUrl.searchParams.set("callbackUrl", "/onboarding");
    return NextResponse.redirect(loginUrl);
  }

  const user = session.user as typeof session.user & {
    onboardingCompleted?: boolean;
  };

  if (!user.onboardingCompleted) {
    return NextResponse.redirect(new URL("/onboarding", publicAppUrl));
  }

  const callbackUrl = safeStoreRedirect(
    request.nextUrl.searchParams.get("callbackUrl")
  );
  const target = new URL(callbackUrl, publicAppUrl);
  const res = NextResponse.redirect(target);

  res.cookies.set("client.onboarding", "1", {
    httpOnly: false,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });

  return res;
}
