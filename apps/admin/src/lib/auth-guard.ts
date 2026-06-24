import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { NextResponse } from "next/server";

type Role = "admin" | "hq";

export interface AuthContext {
  user: {
    id: string;
    name: string;
    email: string;
    username?: string;
    role: Role;
    branchId: string | null;
    [key: string]: unknown;
  };
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

    return handler(
      { user: session.user as AuthContext["user"] },
      ...args
    );
  };
}

/**
 * Determine the branch scope for the current admin user.
 * - HQ (role="hq" or branchId=null): can see all branches → { mode: "all" }
 * - Branch admin (role="admin" with branchId): → { mode: "own", branchId }
 */
export function getBranchScope(user: AuthContext["user"]):
  | { mode: "all" }
  | { mode: "own"; branchId: string } {
  if (user.role === "hq" || !user.branchId) {
    return { mode: "all" };
  }
  return { mode: "own", branchId: user.branchId };
}