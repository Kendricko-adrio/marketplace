import { NextRequest, NextResponse } from "next/server";
import { createModuleLogger, withRequestContext } from "@/lib/logger";
import { guard } from "@/lib/rbac/guard";
import {
  listNotifications,
  notificationScopeFromAuthorization,
} from "@/lib/notifications";

// Force dynamic so query params and auth context are always fresh.
export const dynamic = "force-dynamic";

/**
 * Module logger untuk route ini: dibuat sekali di module scope, sedangkan
 * `requestId` dibaca dari scope HTTP yang aktif setiap kali log ditulis
 * (`withRequestContext` di export handler membuka scope tersebut).
 */
const log = createModuleLogger("admin-notifications");

/**
 * Proyeksi teknis statis untuk field `error`: pesan asli dari DB/driver tidak
 * pernah masuk log, hanya pesan yang ditulis module ini. Kontrak HTTP-nya tetap
 * 500 + envelope lama.
 */
class NotificationsListLogError extends Error {
  constructor() {
    super("notifications list gagal");
    this.name = "NotificationsListLogError";
  }
}

// GET /api/admin/notifications                          [notifications:view]
// Query params:
//   isRead = all | read | unread (default all)
//   page   = number (default 1)
//   limit  = number (default 20, max 100)
async function listNotificationsHandler(request: NextRequest): Promise<Response> {
  const guardResult = await guard("notifications", "view");
  if (!guardResult.ok) return guardResult.response;
  const { ctx } = guardResult;

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
      log.warn(
        `notifications.list scope tidak dapat ditentukan (userId ${ctx.user.id}, reason missing_home_branch, outcome denied)`
      );
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

    log.info(
      `notifications.list (isRead ${isRead}, page ${page}, limit ${limit}, total ${total}, scope ${scope.mode}, outcome success)`
    );

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
  } catch {
    // Nilai yang tertangkap tidak pernah masuk log: bisa memuat SQL/nilai baris.
    log.error(
      "notifications.list gagal (outcome error)",
      new NotificationsListLogError()
    );
    return NextResponse.json(
      { success: false, error: "Failed to list notifications" },
      { status: 500 }
    );
  }
}

export const GET = withRequestContext(
  listNotificationsHandler,
  "admin-notifications"
);
