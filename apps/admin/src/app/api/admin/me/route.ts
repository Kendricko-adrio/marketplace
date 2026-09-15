import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { createLogger, serializeError } from "@/lib/logger";

// GET /api/admin/me
// Authentication-only identity endpoint: returns the currently signed-in
// admin user's id, name, email, assigned Role id, and Home Branch id. No
// module authorization gate — this carries no protected business data, and
// the legacy `role` name field is gone (assignment is `roleId` + `branchId`).
// Policy discovery (grants/scopes) lives in /api/admin/policy/me.
export const dynamic = "force-dynamic";

export async function GET() {
  const logger = createLogger({ route: "me" });

  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) {
      logger.warn("me.unauthenticated", { outcome: "denied" });
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    logger.info("me.resolved", {
      outcome: "success",
      userId: session.user.id,
    });

    return NextResponse.json({
      success: true,
      user: {
        id: session.user.id,
        name: session.user.name,
        email: session.user.email,
        roleId: session.user.roleId ?? null,
        branchId: session.user.branchId ?? null,
      },
    });
  } catch (error) {
    logger.error("me.failure", {
      outcome: "error",
      error: serializeError(error),
    });
    return NextResponse.json(
      { success: false, error: "Failed to fetch current user" },
      { status: 500 }
    );
  }
}