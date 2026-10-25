import { NextRequest, NextResponse } from "next/server";
import { createModuleLogger, withRequestContext } from "@/lib/logger";
import { guard, crossBranchNotFound } from "@/lib/rbac/guard";
import {
  notificationScopeFromAuthorization,
  markRead,
  deleteNotification,
} from "@/lib/notifications";

/**
 * Module logger untuk route ini: dibuat sekali di module scope, sedangkan
 * `requestId` dibaca dari scope HTTP yang aktif setiap kali log ditulis.
 */
const log = createModuleLogger("admin-notification-detail");

/**
 * Proyeksi teknis statis untuk field `error`: pesan asli dari DB/driver tidak
 * pernah masuk log.
 */
class NotificationWriteLogError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotificationWriteLogError";
  }
}

type RouteContext = { params: Promise<{ id: string }> };

// PATCH /api/admin/notifications/{id}   [notifications:edit]
// DELETE /api/admin/notifications/{id}  [notifications:delete]
//
// The object seam is the scoped update/delete itself: own-branch scope pins
// the mutation to the Home Branch, so a cross-branch id affects zero rows and
// maps to 404 (existence is not disclosed). All-branch scope is unrestricted.
async function markNotificationRead(
  _request: NextRequest,
  { params }: RouteContext
): Promise<Response> {
  const { id } = await params;
  const guardResult = await guard("notifications", "edit");
  if (!guardResult.ok) return guardResult.response;
  const { ctx } = guardResult;

  const scope = notificationScopeFromAuthorization(ctx.authorization);
  if (!scope) {
    log.warn(
      `notifications.mark_read scope tidak dapat ditentukan (userId ${ctx.user.id}, notificationId ${id}, reason missing_home_branch, outcome denied)`
    );
    return NextResponse.json(
      { success: false, error: "Forbidden", code: "DENIED" },
      { status: 403 }
    );
  }

  try {
    const ok = await markRead(id, scope);
    if (!ok) {
      // Existence is not disclosed: the same 404 for a cross-branch id.
      crossBranchNotFound();
      return NextResponse.json(
        { success: false, error: "Notification not found" },
        { status: 404 }
      );
    }
    log.info(
      `notifications.mark_read (notificationId ${id}, scope ${scope.mode}, outcome success)`
    );
    return NextResponse.json({ success: true });
  } catch {
    log.error(
      `notifications.mark_read gagal (notificationId ${id}, outcome error)`,
      new NotificationWriteLogError("notifications.mark_read gagal")
    );
    return NextResponse.json(
      { success: false, error: "Failed to mark notification as read" },
      { status: 500 }
    );
  }
}

async function removeNotification(
  _request: NextRequest,
  { params }: RouteContext
): Promise<Response> {
  const { id } = await params;
  const guardResult = await guard("notifications", "delete");
  if (!guardResult.ok) return guardResult.response;
  const { ctx } = guardResult;

  const scope = notificationScopeFromAuthorization(ctx.authorization);
  if (!scope) {
    log.warn(
      `notifications.delete scope tidak dapat ditentukan (userId ${ctx.user.id}, notificationId ${id}, reason missing_home_branch, outcome denied)`
    );
    return NextResponse.json(
      { success: false, error: "Forbidden", code: "DENIED" },
      { status: 403 }
    );
  }

  try {
    const ok = await deleteNotification(id, scope);
    if (!ok) {
      crossBranchNotFound();
      return NextResponse.json(
        { success: false, error: "Notification not found" },
        { status: 404 }
      );
    }
    log.info(
      `notifications.delete (notificationId ${id}, scope ${scope.mode}, outcome success)`
    );
    return NextResponse.json({ success: true });
  } catch {
    log.error(
      `notifications.delete gagal (notificationId ${id}, outcome error)`,
      new NotificationWriteLogError("notifications.delete gagal")
    );
    return NextResponse.json(
      { success: false, error: "Failed to delete notification" },
      { status: 500 }
    );
  }
}

export const PATCH = withRequestContext(
  markNotificationRead,
  "admin-notification-detail"
);
export const DELETE = withRequestContext(
  removeNotification,
  "admin-notification-detail"
);
