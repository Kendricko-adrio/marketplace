import { NextRequest, NextResponse } from "next/server";
import { withPermission } from "@/lib/auth-guard";
import { getNotificationScope, clearReadNotifications } from "@/lib/notifications";
import { requestLogger, serializeError } from "@/lib/logger";

// DELETE /api/admin/notifications/clear-all-read
export const DELETE = withPermission(
  async ({ user }, request: NextRequest) => {
    const log = requestLogger(request, {
      module: "admin-notifications",
      action: "clear-read",
      userId: user.id,
      role: user.role,
    });
    try {
      const scope = getNotificationScope(user);
      const deleted = await clearReadNotifications(scope);
      log.info("read notifications cleared", { deleted });
      return NextResponse.json({ success: true, deleted });
    } catch (error) {
      log.error("clear read notifications failed", {
        error: serializeError(error),
      });
      return NextResponse.json(
        { success: false, error: "Failed to clear read notifications" },
        { status: 500 }
      );
    }
  },
  "notifications",
  "delete"
);
