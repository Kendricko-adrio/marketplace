import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { auditLogs, users } from "@/db";
import { eq, desc, or, and } from "drizzle-orm";
import { createModuleLogger, withRequestContext } from "@/lib/logger";
import { guard } from "@/lib/rbac/guard";
import { branchScopeFromAuthorization } from "@/lib/rbac/branch-scope";
import { parsePagination } from "@/lib/pagination";

/**
 * Module logger untuk route ini: dibuat sekali di module scope, sedangkan
 * `requestId` dibaca dari scope HTTP yang aktif setiap kali log ditulis.
 */
const log = createModuleLogger("admin-audit-log");

/**
 * Proyeksi teknis statis untuk field `error`: pesan asli dari DB/driver tidak
 * pernah masuk log.
 */
class AuditLogLogError extends Error {
  constructor() {
    super("audit-log list gagal");
    this.name = "AuditLogLogError";
  }
}

// GET /api/admin/audit-log   [audit_log:view]
//
// Branch-aware Audit Event access from the Current Policy:
//   - own scope  → only events tagged to the Home Branch: `single_branch`
//     events on the Home Branch and `dual_branch` reassignment events
//     involving it as the old or new Branch. Global/system/product-sync
//     events (branchScope "global" or unclassified legacy events) are
//     excluded.
//   - all scope  → branch-tagged and global events alike.
async function auditLogList(request: NextRequest): Promise<Response> {
  const guardResult = await guard("audit_log", "view");
  if (!guardResult.ok) return guardResult.response;
  const { ctx } = guardResult;

  try {
    const scope = branchScopeFromAuthorization(ctx.authorization);
    if (!scope) {
      log.warn(
        `audit-log scope tidak dapat ditentukan (userId ${ctx.user.id}, reason missing_home_branch, outcome denied)`
      );
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

    log.info(
      `audit-log.list (count ${formattedLogs.length}, limit ${limit}, scope ${scope.mode}, outcome success)`
    );
    return NextResponse.json({
      success: true,
      data: formattedLogs,
    });
  } catch {
    // Nilai yang tertangkap tidak pernah masuk log: bisa memuat SQL/nilai baris.
    log.error("audit-log.list gagal (outcome error)", new AuditLogLogError());
    return NextResponse.json(
      { success: false, error: "Failed to fetch audit log" },
      { status: 500 }
    );
  }
}

export const GET = withRequestContext(auditLogList, "admin-audit-log");
