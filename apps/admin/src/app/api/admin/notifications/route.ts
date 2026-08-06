import { NextRequest, NextResponse } from "next/server";
import { withPermission } from "@/lib/auth-guard";
import { listNotifications, getNotificationScope } from "@/lib/notifications";
import { requestLogger, serializeError } from "@/lib/logger";

// Force dynamic so query params and auth context are always fresh.
export const dynamic = "force-dynamic";

// GET /api/admin/notifications
// Query params:
//   isRead = all | read | unread (default all)
//   page   = number (default 1)
//   limit  = number (default 20, max 100)
export const GET = withPermission(
  async ({ user }, request: NextRequest) => {
    const log = requestLogger(request, {
      module: "admin-notifications",
      action: "list",
      userId: user.id,
      role: user.role,
    });
    try {
      const { searchParams } = new URL(request.url);
      const isReadParam = searchParams.get("isRead");
      const isRead =
        isReadParam === "read" || isReadParam === "unread"
          ? isReadParam
          : "all";
      const page = parseInt(searchParams.get("page") || "1", 10);
      const limit = Math.min(
        parseInt(searchParams.get("limit") || "20", 10),
        100
      );

      const scope = getNotificationScope(user);
      const { items, total } = await listNotifications(scope, {
        isRead,
        page,
        limit,
      });

      log.info("notifications listed", { isRead, page, limit, total });

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
    } catch (error) {
      log.error("notifications list failed", { error: serializeError(error) });
      return NextResponse.json(
        { success: false, error: "Failed to list notifications" },
        { status: 500 }
      );
    }
  },
  "notifications",
  "view"
);
