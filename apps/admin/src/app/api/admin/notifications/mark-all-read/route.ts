import { NextRequest, NextResponse } from "next/server";
import { withPermission } from "@/lib/auth-guard";
import { getNotificationScope, markAllRead } from "@/lib/notifications";
import { requestLogger, serializeError } from "@/lib/logger";

// POST /api/admin/notifications/mark-all-read
export const POST = withPermission(
  async ({ user }, request: NextRequest) => {
    const log = requestLogger(request, {
      module: "admin-notifications",
      action: "mark-all-read",
      userId: user.id,
      role: user.role,
    });
    try {
      const scope = getNotificationScope(user);
      const updated = await markAllRead(scope);
      log.info("notifications marked all read", { updated });
      return NextResponse.json({ success: true, updated });
    } catch (error) {
      log.error("mark all read failed", { error: serializeError(error) });
      return NextResponse.json(
        { success: false, error: "Failed to mark notifications as read" },
        { status: 500 }
      );
    }
  },
  "notifications",
  "edit"
);
