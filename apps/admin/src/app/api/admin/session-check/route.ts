import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";

// GET /api/admin/session-check
// Returns whether the current session's user must reset their password.
// Called right after login to decide the redirect target.
export async function GET() {
  try {
    const session = await auth.api.getSession({
      headers: await headers(),
    });

    if (!session) {
      return NextResponse.json(
        { success: false, mustResetPassword: false, authenticated: false },
        { status: 200 }
      );
    }

    const mustResetPassword = Boolean(
      (session.user as { mustResetPassword?: boolean }).mustResetPassword
    );

    return NextResponse.json({
      success: true,
      authenticated: true,
      mustResetPassword,
    });
  } catch (error) {
    console.error("Session check error:", error);
    return NextResponse.json(
      { success: false, mustResetPassword: false, authenticated: false },
      { status: 200 }
    );
  }
}