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

    return handler({ user: session.user as AuthContext["user"] }, ...args);
  };
}
