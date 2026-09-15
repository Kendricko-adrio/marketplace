import { NextRequest, NextResponse } from "next/server";
import {
  notificationScopeFromAuthorization,
  listNotifications,
  getNotificationItem,
  getUnreadCount,
  getDbNow,
  type NotificationListItem,
  type NotificationScope,
} from "@/lib/notifications";
import { waitForNotification } from "@/lib/notification-broadcaster";
import { serializeError, type Logger } from "@/lib/logger";
import { guard, type PolicyContext } from "@/lib/rbac/guard";
import type { Notification } from "@/db";

export const dynamic = "force-dynamic";

// Fallback that maps a bare notification row (no joins) into the list-item
// shape with null order/branch. Only used if the joined re-fetch misses.
function rawToItem(notification: Notification): NotificationListItem {
  return {
    id: notification.id,
    type: notification.type,
    orderId: notification.orderId,
    branchId: notification.branchId,
    title: notification.title,
    message: notification.message,
    isRead: notification.isRead,
    readAt: notification.readAt?.toISOString() ?? null,
    createdAt: notification.createdAt.toISOString(),
    updatedAt: notification.updatedAt.toISOString(),
    branch: null,
    order: null,
  };
}

// GET /api/admin/notifications/poll?since={ISO8601}   [notifications:view]
// Long-polling endpoint for real-time notifications.
//
// Behavior:
//   - If `since` is omitted, returns immediately with the current unread count
//     and an empty data list, plus `serverNow` so the client can reconnect
//     without losing events.
//   - If `since` is provided and notifications exist with createdAt > since,
//     they are returned immediately.
//   - Otherwise the request waits up to ~25s for a new notification scoped to
//     this admin's policy branch scope before returning an empty response.
export async function GET(request: NextRequest) {
  const guardResult = await guard("notifications", "view", { request });
  if (!guardResult.ok) return guardResult.response;
  const { logger, ctx } = guardResult;

  const scope = resolveScope(logger, ctx);
  if (!scope) {
    return NextResponse.json(
      { success: false, error: "Forbidden", code: "DENIED" },
      { status: 403 }
    );
  }

  try {
    const { searchParams } = new URL(request.url);
    const sinceParam = searchParams.get("since");
    const since = sinceParam ? new Date(sinceParam) : undefined;

    // If no `since`, just give the client the current unread count and a
    // fresh server timestamp. This avoids shipping every historical row to
    // the bell on first load.
    if (!since) {
      const unreadCount = await getUnreadCount(scope);
      const serverNow = await getDbNow();
      logger.info("notifications.poll.initial", {
        outcome: "success",
        unreadCount,
      });
      return NextResponse.json({
        success: true,
        data: [],
        unreadCount,
        serverNow: serverNow.toISOString(),
      });
    }

    // Catch up: any notifications inserted while this client was disconnected.
    const { items } = await listNotifications(scope, {
      since,
      page: 1,
      limit: 20,
    });

    if (items.length > 0) {
      const unreadCount = await getUnreadCount(scope);
      // IMPORTANT: return the DB's current time (not the latest item's
      // createdAt) as the watermark. The client sends this back as `since`,
      // and the next catch-up compares `createdAt > since`. Because serverNow
      // is captured AFTER the items exist, it is strictly greater than any
      // delivered item's createdAt — so they are excluded next round and the
      // watermark always advances forward. Using the item's own createdAt as
      // the watermark would stick the watermark at that item (truncated to ms
      // by toISOString while the DB stores microseconds) and re-deliver it
      // forever — a hot loop.
      const serverNow = await getDbNow();
      logger.info("notifications.poll.catch_up", {
        outcome: "success",
        count: items.length,
        unreadCount,
      });
      return NextResponse.json({
        success: true,
        data: items,
        unreadCount,
        serverNow: serverNow.toISOString(),
      });
    }

    // Wait for a new notification scoped to this admin's branch scope.
    const notification = await waitForNotification(scope, 25000);
    const unreadCount = await getUnreadCount(scope);
    const serverNow = await getDbNow();

    // waitForNotification returns the bare notification row (no joins), so
    // re-fetch it with the order/branch/customer joins to populate the
    // Order/Cabang/Status columns. Falls back to the raw row if the join
    // lookup misses (e.g. row deleted between emit and fetch). A wakeup for
    // another branch is dropped (stays null) — the next poll re-checks.
    let data: NotificationListItem[] = [];
    if (notification) {
      const inScope =
        scope.mode === "all" || notification.branchId === scope.branchId;
      const item = inScope ? await getNotificationItem(notification.id) : null;
      data = item ? [item] : [];
    }
    logger.info("notifications.poll.wakeup", {
      outcome: "success",
      hasData: data.length > 0,
      unreadCount,
    });

    return NextResponse.json({
      success: true,
      data,
      unreadCount,
      serverNow: serverNow.toISOString(),
    });
  } catch (error) {
    logger.error("notifications.poll.failure", {
      outcome: "error",
      error: serializeError(error),
    });
    return NextResponse.json(
      { success: false, error: "Failed to poll notifications" },
      { status: 500 }
    );
  }
}

function resolveScope(logger: Logger, ctx: PolicyContext): NotificationScope | null {
  const scope = notificationScopeFromAuthorization(ctx.authorization);
  if (!scope) {
    logger.warn("notifications.poll.scope_unresolvable", {
      outcome: "denied",
      reason: "missing_home_branch",
      userId: ctx.user.id,
    });
  }
  return scope;
}