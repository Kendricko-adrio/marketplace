import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { eq } from "drizzle-orm";

import { auth } from "@/lib/auth";
import { db, branches as branchesSchema } from "@/db";
import { createLogger, serializeError } from "@/lib/logger";
import { loadPolicy } from "@/lib/rbac/resolver";

// =========================================================
// GET /api/admin/policy/me
// =========================================================
// Returns the caller's Current Policy: Role identity, the exact current
// grants/scopes, Home Branch, and the policy version (role.version). The
// policy is resolved from the database on every call — never cached in the
// session — so role/grant/assignment changes apply on the next request.
//
// Auth: admin-session only (no module authorization gate — this is the
// endpoint the client uses to discover its own policy, including the
// deny-all No-Access case).

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) {
      const logger = createLogger({ module: "policy" });
      logger.warn("policy.me.unauthenticated", { outcome: "denied" });
      return NextResponse.json(
        { success: false, error: "Unauthorized", code: "UNAUTHENTICATED" },
        { status: 401 }
      );
    }

    const logger = createLogger({ module: "policy" });
    const loaded = await loadPolicy(session.user.id);
    if (!loaded) {
      logger.warn("policy.me.unresolvable", {
        outcome: "denied",
        userId: session.user.id,
      });
      return NextResponse.json(
        {
          success: false,
          error: "You do not have access to this resource",
          code: "NO_ACCESS",
        },
        { status: 403 }
      );
    }

    // Home Branch display data (name/code/city) so the policy-aware
    // sidebar and No-Access screen can show placement without a second
    // protected request. Null for System Owners and no-branch states.
    let homeBranch: {
      id: string;
      name: string;
      code: string;
      city: string;
    } | null = null;
    if (loaded.user.homeBranchId) {
      const branchRows = await db
        .select({
          id: branchesSchema.id,
          name: branchesSchema.name,
          code: branchesSchema.code,
          city: branchesSchema.city,
        })
        .from(branchesSchema)
        .where(eq(branchesSchema.id, loaded.user.homeBranchId))
        .limit(1);
      homeBranch = branchRows[0] ?? null;
    }

    const mustResetPassword = Boolean(
      (session.user as { mustResetPassword?: boolean }).mustResetPassword
    );

    logger.info("policy.me.resolved", {
      outcome: "success",
      userId: loaded.user.id,
      roleId: loaded.role.id,
      policyVersion: loaded.policyVersion,
    });

    return NextResponse.json({
      success: true,
      data: {
        user: {
          id: loaded.user.id,
          name: loaded.user.name,
          email: loaded.user.email,
          isActive: loaded.user.isActive,
          homeBranchId: loaded.user.homeBranchId,
          homeBranch,
        },
        role: {
          id: loaded.role.id,
          key: loaded.role.key,
          name: loaded.role.name,
          isSystem: loaded.role.isSystem,
          archived: loaded.role.archived,
        },
        grants: loaded.role.grants,
        policyVersion: loaded.policyVersion,
        mustResetPassword,
      },
    });
  } catch (error) {
    const logger = createLogger({ module: "policy" });
    logger.error("policy.me.failure", {
      outcome: "error",
      error: serializeError(error),
    });
    return NextResponse.json(
      { success: false, error: "Internal server error", code: "INTERNAL" },
      { status: 500 }
    );
  }
}