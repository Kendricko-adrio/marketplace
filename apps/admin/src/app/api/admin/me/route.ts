import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth-guard";

// GET /api/admin/me
// Returns the currently logged-in admin user's id, name, email, role and branchId.
// Used by client pages that need role/branch-based UI decisions.
export const GET = withAuth(async ({ user }) => {
  try {
    return NextResponse.json({
      success: true,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        branchId: user.branchId,
      },
    });
  } catch (error) {
    console.error("Error fetching current admin user:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch current user" },
      { status: 500 }
    );
  }
}, ["admin", "hq"]);
