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
import { createModuleLogger, withRequestContext } from "@/lib/logger";
import { guard, type PolicyContext } from "@/lib/rbac/guard";
import type { Notification } from "@/db";

export const dynamic = "force-dynamic";

/**
 * Module logger untuk route ini: dibuat sekali di module scope, sedangkan
 * `requestId` dibaca dari scope HTTP yang aktif setiap kali log ditulis.
 */
const log = createModuleLogger("admin-notifications-poll");

/**
 * Proyeksi teknis statis untuk field `error`: pesan asli dari DB/driver tidak
 * pernah masuk log.
 */
class NotificationsPollLogError extends Error {
  constructor() {
    super("notifications poll gagal");
    this.name = "NotificationsPollLogError";
  }
}

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
async function pollNotifications(request: NextRequest): Promise<Response> {
  const guardResult = await guard("notifications", "view");
  if (!guardResult.ok) return guardResult.response;
  const { ctx } = guardResult;

  const scope = resolveScope(ctx);
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
      log.info(
        `notifications.poll.initial (unreadCount ${unreadCount}, outcome success)`
      );
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
      log.info(
        `notifications.poll.catch_up (count ${items.length}, unreadCount ${unreadCount}, outcome success)`
      );
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
    log.info(
      `notifications.poll.wakeup (hasData ${data.length > 0}, unreadCount ${unreadCount}, outcome success)`
    );

    return NextResponse.json({
      success: true,
      data,
      unreadCount,
      serverNow: serverNow.toISOString(),
    });
  } catch {
    // Nilai yang tertangkap tidak pernah masuk log: bisa memuat SQL/nilai baris.
    log.error(
      "notifications.poll gagal (outcome error)",
      new NotificationsPollLogError()
    );
    return NextResponse.json(
      { success: false, error: "Failed to poll notifications" },
      { status: 500 }
    );
  }
}

function resolveScope(ctx: PolicyContext): NotificationScope | null {
  const scope = notificationScopeFromAuthorization(ctx.authorization);
  if (!scope) {
    log.warn(
      `notifications.poll scope tidak dapat ditentukan (userId ${ctx.user.id}, reason missing_home_branch, outcome denied)`
    );
  }
  return scope;
}

/**
 * Long-poll tetap di bawah satu request scope: handler ini TIDAK melakukan
 * streaming (menunggu `waitForNotification` lalu `NextResponse.json`), jadi
 * scope selesai sebelum response dikirim dan `x-request-id` tetap konsisten
 * untuk seluruh event poll pada request yang sama.
 */
export const GET = withRequestContext(
  pollNotifications,
  "admin-notifications-poll"
);
