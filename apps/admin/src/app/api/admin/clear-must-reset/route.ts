import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { db } from "@/db";
import { users, adminSessions } from "@/db";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";

// POST /api/admin/clear-must-reset
// Called after a user successfully changes their password via the forced
// reset flow. Clears the mustResetPassword flag so they aren't gated again,
// and revokes other sessions (optional but recommended).
export async function POST() {
  try {
    const session = await auth.api.getSession({
      headers: await headers(),
    });
    if (!session) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    await db
      .update(users)
      .set({ mustResetPassword: false, updatedAt: new Date() })
      .where(eq(users.id, session.user.id));

    // Revoke all other sessions for this user so the old (initial) password
    // can no longer be used. Keep the current session.
    const allSessions = await db
      .select({ id: adminSessions.id, token: adminSessions.token })
      .from(adminSessions)
      .where(eq(adminSessions.userId, session.user.id));

    const currentToken = session.session.token;
    const toRevoke = allSessions.filter((s) => s.token !== currentToken);
    for (const s of toRevoke) {
      await db.delete(adminSessions).where(eq(adminSessions.id, s.id));
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error clearing mustResetPassword:", error);
    return NextResponse.json(
      { success: false, error: "Failed to update" },
      { status: 500 }
    );
  }
}