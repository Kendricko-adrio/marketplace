import { NextRequest, NextResponse } from "next/server";
import { serializeError } from "@/lib/logger";
import { guard } from "@/lib/rbac/guard";
import { notificationScopeFromAuthorization, markAllRead } from "@/lib/notifications";

// POST /api/admin/notifications/mark-all-read   [notifications:edit]
export async function POST(request: NextRequest) {
  const guardResult = await guard("notifications", "edit", { request });
  if (!guardResult.ok) return guardResult.response;
  const { logger, ctx } = guardResult;

  try {
    const scope = notificationScopeFromAuthorization(ctx.authorization);
    if (!scope) {
      logger.warn("notifications.mark_all_read.scope_unresolvable", {
        outcome: "denied",
        reason: "missing_home_branch",
        userId: ctx.user.id,
      });
      return NextResponse.json(
        { success: false, error: "Forbidden", code: "DENIED" },
        { status: 403 }
      );
    }
    const updated = await markAllRead(scope);
    logger.info("notifications.mark_all_read", {
      outcome: "success",
      updated,
      scope: scope.mode,
    });
    return NextResponse.json({ success: true, updated });
  } catch (error) {
    logger.error("notifications.mark_all_read.failure", {
      outcome: "error",
      error: serializeError(error),
    });
    return NextResponse.json(
      { success: false, error: "Failed to mark notifications as read" },
      { status: 500 }
    );
  }
}