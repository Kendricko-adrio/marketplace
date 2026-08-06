import { NextRequest, NextResponse } from "next/server";
import { withPermission } from "@/lib/auth-guard";
import {
  getNotificationScope,
  markRead,
  deleteNotification,
} from "@/lib/notifications";
import { requestLogger, serializeError } from "@/lib/logger";

// PATCH /api/admin/notifications/{id}/read
export const PATCH = withPermission(
  async ({ user }, request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;
    const log = requestLogger(request, {
      module: "admin-notifications",
      action: "mark-read",
      userId: user.id,
      role: user.role,
      notificationId: id,
    });
    try {
      const scope = getNotificationScope(user);
      const ok = await markRead(id, scope);
      if (!ok) {
        return NextResponse.json(
          { success: false, error: "Notification not found" },
          { status: 404 }
        );
      }
      log.info("notification marked read");
      return NextResponse.json({ success: true });
    } catch (error) {
      log.error("mark read failed", { error: serializeError(error) });
      return NextResponse.json(
        { success: false, error: "Failed to mark notification as read" },
        { status: 500 }
      );
    }
  },
  "notifications",
  "edit"
);

// DELETE /api/admin/notifications/{id}
export const DELETE = withPermission(
  async ({ user }, request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;
    const log = requestLogger(request, {
      module: "admin-notifications",
      action: "delete",
      userId: user.id,
      role: user.role,
      notificationId: id,
    });
    try {
      const scope = getNotificationScope(user);
      const ok = await deleteNotification(id, scope);
      if (!ok) {
        return NextResponse.json(
          { success: false, error: "Notification not found" },
          { status: 404 }
        );
      }
      log.info("notification deleted");
      return NextResponse.json({ success: true });
    } catch (error) {
      log.error("delete notification failed", { error: serializeError(error) });
      return NextResponse.json(
        { success: false, error: "Failed to delete notification" },
        { status: 500 }
      );
    }
  },
  "notifications",
  "delete"
);
