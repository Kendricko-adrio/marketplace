import { NextRequest, NextResponse } from "next/server";
import { serializeError } from "@/lib/logger";
import { guard, crossBranchNotFound } from "@/lib/rbac/guard";
import { branchScopeFromAuthorization } from "@/lib/rbac/branch-scope";
import {
  notificationScopeFromAuthorization,
  markRead,
  deleteNotification,
} from "@/lib/notifications";

// PATCH /api/admin/notifications/{id}   [notifications:edit]
// DELETE /api/admin/notifications/{id}  [notifications:delete]
//
// The object seam is the scoped update/delete itself: own-branch scope pins
// the mutation to the Home Branch, so a cross-branch id affects zero rows and
// maps to 404 (existence is not disclosed). All-branch scope is unrestricted.
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const guardResult = await guard("notifications", "edit", { request });
  if (!guardResult.ok) return guardResult.response;
  const { logger, ctx } = guardResult;

  const scope = notificationScopeFromAuthorization(ctx.authorization);
  if (!scope) {
    logger.warn("notifications.mark_read.scope_unresolvable", {
      outcome: "denied",
      reason: "missing_home_branch",
      userId: ctx.user.id,
      notificationId: id,
    });
    return NextResponse.json(
      { success: false, error: "Forbidden", code: "DENIED" },
      { status: 403 }
    );
  }

  try {
    const ok = await markRead(id, scope);
    if (!ok) {
      crossBranchNotFound(logger.child({ notificationId: id }));
      return NextResponse.json(
        { success: false, error: "Notification not found" },
        { status: 404 }
      );
    }
    logger.info("notifications.mark_read", {
      outcome: "success",
      notificationId: id,
      scope: scope.mode,
    });
    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error("notifications.mark_read.failure", {
      outcome: "error",
      error: serializeError(error),
    });
    return NextResponse.json(
      { success: false, error: "Failed to mark notification as read" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const guardResult = await guard("notifications", "delete", { request });
  if (!guardResult.ok) return guardResult.response;
  const { logger, ctx } = guardResult;

  const scope = notificationScopeFromAuthorization(ctx.authorization);
  if (!scope) {
    logger.warn("notifications.delete.scope_unresolvable", {
      outcome: "denied",
      reason: "missing_home_branch",
      userId: ctx.user.id,
      notificationId: id,
    });
    return NextResponse.json(
      { success: false, error: "Forbidden", code: "DENIED" },
      { status: 403 }
    );
  }

  try {
    const ok = await deleteNotification(id, scope);
    if (!ok) {
      crossBranchNotFound(logger);
      return NextResponse.json(
        { success: false, error: "Notification not found" },
        { status: 404 }
      );
    }
    logger.info("notifications.delete", {
      outcome: "success",
      notificationId: id,
      scope: scope.mode,
    });
    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error("notifications.delete.failure", {
      outcome: "error",
      error: serializeError(error),
    });
    return NextResponse.json(
      { success: false, error: "Failed to delete notification" },
      { status: 500 }
    );
  }
}