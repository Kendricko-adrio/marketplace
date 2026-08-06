import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/auth-guard";
import {
  getNotificationScope,
  listNotifications,
  getNotificationItem,
  getUnreadCount,
  getDbNow,
  type NotificationListItem,
} from "@/lib/notifications";
import { waitForNotification } from "@/lib/notification-broadcaster";
import type { Notification } from "@/db";
import { requestLogger, serializeError } from "@/lib/logger";

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

// GET /api/admin/notifications/poll?since={ISO8601}
// Long-polling endpoint for real-time notifications.
//
// Behavior:
//   - If `since` is omitted, returns immediately with the current unread count
//     and an empty data list, plus `serverNow` so the client can reconnect
//     without losing events.
//   - If `since` is provided and notifications exist with createdAt > since,
//     they are returned immediately.
//   - Otherwise the request waits up to ~25s for a new notification scoped to
//     this admin before returning an empty response.
export const GET = withAuth(
  async ({ user }, request: NextRequest) => {
    const log = requestLogger(request, {
      module: "admin-notifications-poll",
      userId: user.id,
      role: user.role,
    });
    try {
      const scope = getNotificationScope(user);
      const { searchParams } = new URL(request.url);
      const sinceParam = searchParams.get("since");
      const since = sinceParam ? new Date(sinceParam) : undefined;

      // If no `since`, just give the client the current unread count and a
      // fresh server timestamp. This avoids shipping every historical row to
      // the bell on first load.
      if (!since) {
        const unreadCount = await getUnreadCount(scope);
        const serverNow = await getDbNow();
        log.info("poll initial", { unreadCount });
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
        log.info("poll catch-up", { count: items.length, unreadCount });
        return NextResponse.json({
          success: true,
          data: items,
          unreadCount,
          serverNow: serverNow.toISOString(),
        });
      }

      // Wait for a new notification scoped to this admin.
      const notification = await waitForNotification(scope, 25000);
      const unreadCount = await getUnreadCount(scope);
      const serverNow = await getDbNow();

      // waitForNotification returns the bare notification row (no joins), so
      // re-fetch it with the order/branch/customer joins to populate the
      // Order/Cabang/Status columns. Falls back to the raw row if the join
      // lookup misses (e.g. row deleted between emit and fetch).
      let data: NotificationListItem[] = [];
      if (notification) {
        const item = await getNotificationItem(notification.id);
        data = item ? [item] : [rawToItem(notification)];
      }
      log.info("poll wakeup", {
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
      log.error("poll failed", { error: serializeError(error) });
      return NextResponse.json(
        { success: false, error: "Failed to poll notifications" },
        { status: 500 }
      );
    }
  },
  ["admin", "hq"]
);
