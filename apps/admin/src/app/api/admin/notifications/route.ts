import { NextRequest, NextResponse } from "next/server";
import { serializeError } from "@/lib/logger";
import { guard } from "@/lib/rbac/guard";
import { branchScopeFromAuthorization } from "@/lib/rbac/branch-scope";
import {
  listNotifications,
  notificationScopeFromAuthorization,
} from "@/lib/notifications";

// Force dynamic so query params and auth context are always fresh.
export const dynamic = "force-dynamic";

// GET /api/admin/notifications                          [notifications:view]
// Query params:
//   isRead = all | read | unread (default all)
//   page   = number (default 1)
//   limit  = number (default 20, max 100)
export async function GET(request: NextRequest) {
  const guardResult = await guard("notifications", "view", { request });
  if (!guardResult.ok) return guardResult.response;
  const { logger, ctx } = guardResult;

  try {
    const { searchParams } = new URL(request.url);
    const isReadParam = searchParams.get("isRead");
    const isRead =
      isReadParam === "read" || isReadParam === "unread" ? isReadParam : "all";
    const page = parseInt(searchParams.get("page") || "1", 10);
    const limit = Math.min(parseInt(searchParams.get("limit") || "20", 10), 100);

    const scope = notificationScopeFromAuthorization(ctx.authorization);
    if (!scope) {
      // Fail closed: own-branch grant without a server-pinned Home Branch.
      logger.warn("notifications.scope_unresolvable", {
        outcome: "denied",
        reason: "missing_home_branch",
        userId: ctx.user.id,
      });
      return NextResponse.json(
        { success: false, error: "Forbidden", code: "DENIED" },
        { status: 403 }
      );
    }

    const { items, total } = await listNotifications(scope, {
      isRead,
      page,
      limit,
    });

    logger.info("notifications.list", {
      outcome: "success",
      isRead,
      page,
      limit,
      total,
      scope: scope.mode,
    });

    return NextResponse.json({
      success: true,
      data: items,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    logger.error("notifications.list.failure", {
      outcome: "error",
      error: serializeError(error),
    });
    return NextResponse.json(
      { success: false, error: "Failed to list notifications" },
      { status: 500 }
    );
  }
}