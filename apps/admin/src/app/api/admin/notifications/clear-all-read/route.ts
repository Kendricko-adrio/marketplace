import { NextRequest, NextResponse } from "next/server";
import { createModuleLogger, withRequestContext } from "@/lib/logger";
import { guard } from "@/lib/rbac/guard";
import {
  notificationScopeFromAuthorization,
  clearReadNotifications,
} from "@/lib/notifications";

/**
 * Module logger untuk route ini: dibuat sekali di module scope, sedangkan
 * `requestId` dibaca dari scope HTTP yang aktif setiap kali log ditulis.
 */
const log = createModuleLogger("admin-notifications-clear-read");

/**
 * Proyeksi teknis statis untuk field `error`: pesan asli dari DB/driver tidak
 * pernah masuk log.
 */
class ClearReadLogError extends Error {
  constructor() {
    super("notifications clear_read gagal");
    this.name = "ClearReadLogError";
  }
}

// DELETE /api/admin/notifications/clear-all-read   [notifications:delete]
async function clearReadNotificationsHandler(
  _request: NextRequest
): Promise<Response> {
  const guardResult = await guard("notifications", "delete");
  if (!guardResult.ok) return guardResult.response;
  const { ctx } = guardResult;

  try {
    const scope = notificationScopeFromAuthorization(ctx.authorization);
    if (!scope) {
      log.warn(
        `notifications.clear_read scope tidak dapat ditentukan (userId ${ctx.user.id}, reason missing_home_branch, outcome denied)`
      );
      return NextResponse.json(
        { success: false, error: "Forbidden", code: "DENIED" },
        { status: 403 }
      );
    }
    const deleted = await clearReadNotifications(scope);
    log.info(
      `notifications.clear_read (deleted ${deleted}, scope ${scope.mode}, outcome success)`
    );
    return NextResponse.json({ success: true, deleted });
  } catch {
    // Nilai yang tertangkap tidak pernah masuk log: bisa memuat SQL/nilai baris.
    log.error(
      "notifications.clear_read gagal (outcome error)",
      new ClearReadLogError()
    );
    return NextResponse.json(
      { success: false, error: "Failed to clear read notifications" },
      { status: 500 }
    );
  }
}

export const DELETE = withRequestContext(
  clearReadNotificationsHandler,
  "admin-notifications-clear-read"
);
