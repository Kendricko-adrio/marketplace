import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { checkPermission, getPermissionsForRole } from "@/lib/permissions";
import type { ModuleName, PermissionAction } from "@/db";

type Role = "admin" | "hq";

export interface AuthContext {
  user: {
    id: string;
    name: string;
    email: string;
    username?: string;
    role: Role;
    branchId: string | null;
    mustResetPassword?: boolean;
    [key: string]: unknown;
  };
}

export function getAdminAccessError(user: AuthContext["user"]): {
  code: "MUST_RESET_PASSWORD" | "BRANCH_REQUIRED";
  error: string;
} | null {
  if (user.mustResetPassword) {
    return { code: "MUST_RESET_PASSWORD", error: "Password reset required" };
  }
  if (user.role === "admin" && !user.branchId) {
    return {
      code: "BRANCH_REQUIRED",
      error: "Admin branch assignment required",
    };
  }
  return null;
}

function accessDeniedResponse(user: AuthContext["user"]): NextResponse | null {
  const denial = getAdminAccessError(user);
  return denial
    ? NextResponse.json({ success: false, ...denial }, { status: 403 })
    : null;
}

export function withAuth(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handler: (ctx: AuthContext, ...args: any[]) => Promise<NextResponse>,
  allowedRoles: Role[] = ["admin"]
) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return async (...args: any[]) => {
    const session = await auth.api.getSession({
      headers: await headers(),
    });

    if (!session) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    if (!allowedRoles.includes(session.user.role as Role)) {
      return NextResponse.json(
        { success: false, error: "Forbidden" },
        { status: 403 }
      );
    }

    const denied = accessDeniedResponse(session.user as AuthContext["user"]);
    if (denied) return denied;

    return handler(
      { user: session.user as AuthContext["user"] },
      ...args
    );
  };
}

export function withPermission(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handler: (ctx: AuthContext, ...args: any[]) => Promise<NextResponse>,
  module: ModuleName,
  action: PermissionAction
) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return async (...args: any[]) => {
    const session = await auth.api.getSession({
      headers: await headers(),
    });

    if (!session) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    const denied = accessDeniedResponse(session.user as AuthContext["user"]);
    if (denied) return denied;

    const permMap = await getPermissionsForRole(session.user.role);
    if (!checkPermission(permMap, module, action)) {
      return NextResponse.json(
        { success: false, error: "Forbidden" },
        { status: 403 }
      );
    }

    return handler(
      { user: session.user as AuthContext["user"] },
      ...args
    );
  };
}

/**
 * Determine the branch scope for the current admin user.
 * - HQ (role="hq"): can see all branches → { mode: "all" }
 * - Unassigned branch admin: throws before any query can be constructed
 * - Branch admin (role="admin" with branchId): → { mode: "own", branchId }
 */
export function getBranchScope(user: AuthContext["user"]):
  | { mode: "all" }
  | { mode: "own"; branchId: string } {
  if (user.role === "hq") {
    return { mode: "all" };
  }
  if (!user.branchId) throw new Error("Admin branch assignment required");
  return { mode: "own", branchId: user.branchId };
}
