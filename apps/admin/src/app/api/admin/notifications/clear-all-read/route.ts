import { NextRequest, NextResponse } from "next/server";
import { serializeError } from "@/lib/logger";
import { guard } from "@/lib/rbac/guard";
import {
  notificationScopeFromAuthorization,
  clearReadNotifications,
} from "@/lib/notifications";

// DELETE /api/admin/notifications/clear-all-read   [notifications:delete]
export async function DELETE(request: NextRequest) {
  const guardResult = await guard("notifications", "delete", { request });
  if (!guardResult.ok) return guardResult.response;
  const { logger, ctx } = guardResult;

  try {
    const scope = notificationScopeFromAuthorization(ctx.authorization);
    if (!scope) {
      logger.warn("notifications.clear_read.scope_unresolvable", {
        outcome: "denied",
        reason: "missing_home_branch",
        userId: ctx.user.id,
      });
      return NextResponse.json(
        { success: false, error: "Forbidden", code: "DENIED" },
        { status: 403 }
      );
    }
    const deleted = await clearReadNotifications(scope);
    logger.info("notifications.clear_read", {
      outcome: "success",
      deleted,
      scope: scope.mode,
    });
    return NextResponse.json({ success: true, deleted });
  } catch (error) {
    logger.error("notifications.clear_read.failure", {
      outcome: "error",
      error: serializeError(error),
    });
    return NextResponse.json(
      { success: false, error: "Failed to clear read notifications" },
      { status: 500 }
    );
  }
}