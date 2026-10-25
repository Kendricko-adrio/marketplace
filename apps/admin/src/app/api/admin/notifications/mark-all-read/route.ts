import { NextRequest, NextResponse } from "next/server";
import { createModuleLogger, withRequestContext } from "@/lib/logger";
import { guard } from "@/lib/rbac/guard";
import { notificationScopeFromAuthorization, markAllRead } from "@/lib/notifications";

/**
 * Module logger untuk route ini: dibuat sekali di module scope, sedangkan
 * `requestId` dibaca dari scope HTTP yang aktif setiap kali log ditulis.
 */
const log = createModuleLogger("admin-notifications-mark-all-read");

/**
 * Proyeksi teknis statis untuk field `error`: pesan asli dari DB/driver tidak
 * pernah masuk log.
 */
class MarkAllReadLogError extends Error {
  constructor() {
    super("notifications mark_all_read gagal");
    this.name = "MarkAllReadLogError";
  }
}

// POST /api/admin/notifications/mark-all-read   [notifications:edit]
async function markAllNotificationsRead(
  _request: NextRequest
): Promise<Response> {
  const guardResult = await guard("notifications", "edit");
  if (!guardResult.ok) return guardResult.response;
  const { ctx } = guardResult;

  try {
    const scope = notificationScopeFromAuthorization(ctx.authorization);
    if (!scope) {
      log.warn(
        `notifications.mark_all_read scope tidak dapat ditentukan (userId ${ctx.user.id}, reason missing_home_branch, outcome denied)`
      );
      return NextResponse.json(
        { success: false, error: "Forbidden", code: "DENIED" },
        { status: 403 }
      );
    }
    const updated = await markAllRead(scope);
    log.info(
      `notifications.mark_all_read (updated ${updated}, scope ${scope.mode}, outcome success)`
    );
    return NextResponse.json({ success: true, updated });
  } catch {
    // Nilai yang tertangkap tidak pernah masuk log: bisa memuat SQL/nilai baris.
    log.error(
      "notifications.mark_all_read gagal (outcome error)",
      new MarkAllReadLogError()
    );
    return NextResponse.json(
      { success: false, error: "Failed to mark notifications as read" },
      { status: 500 }
    );
  }
}

export const POST = withRequestContext(
  markAllNotificationsRead,
  "admin-notifications-mark-all-read"
);
