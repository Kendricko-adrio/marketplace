import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { auditLogs, users } from "@/db";
import { eq, desc, or, and } from "drizzle-orm";
import { guard } from "@/lib/rbac/guard";
import { branchScopeFromAuthorization } from "@/lib/rbac/branch-scope";
import { serializeError } from "@/lib/logger";
import { parsePagination } from "@/lib/pagination";

// GET /api/admin/audit-log   [audit_log:view]
//
// Branch-aware Audit Event access from the Current Policy:
//   - own scope  → only events tagged to the Home Branch: `single_branch`
//     events on the Home Branch and `dual_branch` reassignment events
//     involving it as the old or new Branch. Global/system/product-sync
//     events (branchScope "global" or unclassified legacy events) are
//     excluded.
//   - all scope  → branch-tagged and global events alike.
export async function GET(request: NextRequest) {
  const guardResult = await guard("audit_log", "view", { request });
  if (!guardResult.ok) return guardResult.response;
  const { logger, ctx } = guardResult;

  try {
    const scope = branchScopeFromAuthorization(ctx.authorization);
    if (!scope) {
      logger.warn("audit-log.scope_unresolvable", {
        outcome: "denied",
        reason: "missing_home_branch",
        userId: ctx.user.id,
      });
      return NextResponse.json(
        { success: false, error: "Forbidden", code: "DENIED" },
        { status: 403 }
      );
    }

    const { searchParams } = new URL(request.url);
    const { limit } = parsePagination(null, searchParams.get("limit"), 50);

    // Own scope: Home Branch events, including reassignment moves that touch
    // the Home Branch as the old (branchId) or new (relatedBranchId) Branch.
    const whereCondition =
      scope.mode === "own"
        ? or(
            and(
              eq(auditLogs.branchScope, "single_branch"),
              eq(auditLogs.branchId, scope.branchId)
            ),
            and(
              eq(auditLogs.branchScope, "dual_branch"),
              or(
                eq(auditLogs.branchId, scope.branchId),
                eq(auditLogs.relatedBranchId, scope.branchId)
              )
            )
          )
        : undefined;

    const logs = await db
      .select({
        log: auditLogs,
        user: {
          id: users.id,
          name: users.name,
          email: users.email,
        },
      })
      .from(auditLogs)
      .leftJoin(users, eq(auditLogs.userId, users.id))
      .where(whereCondition)
      .orderBy(desc(auditLogs.createdAt))
      .limit(limit);

    const formattedLogs = logs.map((row) => ({
      ...row.log,
      user: row.user || { name: "System", email: null },
    }));

    logger.info("audit-log.list", {
      outcome: "success",
      count: formattedLogs.length,
      scope: scope.mode,
    });
    return NextResponse.json({
      success: true,
      data: formattedLogs,
    });
  } catch (error) {
    logger.error("audit-log.failure", {
      outcome: "error",
      error: serializeError(error),
    });
    return NextResponse.json(
      { success: false, error: "Failed to fetch audit log" },
      { status: 500 }
    );
  }
}