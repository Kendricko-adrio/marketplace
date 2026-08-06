import { db, notifications, branches, orders, clients } from "@/db";
import { eq, and, desc, sql, gt, type SQL } from "drizzle-orm";
import type { AuthContext } from "./auth-guard";

export type NotificationScope =
  | { mode: "all" }
  | { mode: "own"; branchId: string };

export function getNotificationScope(
  user: AuthContext["user"]
): NotificationScope {
  if (user.role === "hq" || !user.branchId) {
    return { mode: "all" };
  }
  return { mode: "own", branchId: user.branchId };
}

export function buildScopeCondition(
  scope: NotificationScope
) {
  if (scope.mode === "all") {
    return undefined;
  }
  return eq(notifications.branchId, scope.branchId);
}

export async function getUnreadCount(scope: NotificationScope): Promise<number> {
  const scopeCondition = buildScopeCondition(scope);
  const whereClause = scopeCondition
    ? and(scopeCondition, eq(notifications.isRead, false))
    : eq(notifications.isRead, false);

  const rows = await db
    .select({ value: sql<number>`count(*)` })
    .from(notifications)
    .where(whereClause);

  return rows[0]?.value ?? 0;
}

export async function getDbNow(): Promise<Date> {
  const result = await db.execute(sql`SELECT now() AS now`);
  const row = result.rows[0] as { now: string } | undefined;
  return row ? new Date(row.now) : new Date();
}

export interface NotificationListItem {
  id: string;
  type: string;
  orderId: string;
  branchId: string;
  title: string;
  message: string | null;
  isRead: boolean;
  readAt: string | null;
  createdAt: string;
  updatedAt: string;
  branch: { id: string; name: string; city: string } | null;
  order: {
    id: string;
    total: string;
    status: string;
    paymentStatus: string;
    customerName: string | null;
  } | null;
}

// Fetch a single notification by id WITH the same joins as listNotifications
// (order total/status/paymentStatus, customer name, branch name/city). Used by
// the real-time poll wakeup path so freshly-emitted notifications arrive with
// their related columns populated instead of just the bare notification row
// (which only carries orderId — leaving Order/Cabang/Status columns empty).
export async function getNotificationItem(
  id: string
): Promise<NotificationListItem | null> {
  const rows = await db
    .select({
      notification: notifications,
      branch: {
        id: branches.id,
        name: branches.name,
        city: branches.city,
      },
      order: {
        id: orders.id,
        total: orders.total,
        status: orders.status,
        paymentStatus: orders.paymentStatus,
      },
      customerName: clients.name,
    })
    .from(notifications)
    .leftJoin(branches, eq(notifications.branchId, branches.id))
    .leftJoin(orders, eq(notifications.orderId, orders.id))
    .leftJoin(clients, eq(orders.userId, clients.id))
    .where(eq(notifications.id, id))
    .limit(1);

  const row = rows[0];
  if (!row) return null;

  return {
    id: row.notification.id,
    type: row.notification.type,
    orderId: row.notification.orderId,
    branchId: row.notification.branchId,
    title: row.notification.title,
    message: row.notification.message,
    isRead: row.notification.isRead,
    readAt: row.notification.readAt?.toISOString() ?? null,
    createdAt: row.notification.createdAt.toISOString(),
    updatedAt: row.notification.updatedAt.toISOString(),
    branch: row.branch?.id
      ? {
          id: row.branch.id!,
          name: row.branch.name!,
          city: row.branch.city!,
        }
      : null,
    order: row.order?.id
      ? {
          id: row.order.id,
          total: row.order.total,
          status: row.order.status,
          paymentStatus: row.order.paymentStatus,
          customerName: row.customerName,
        }
      : null,
  };
}

export async function listNotifications(
  scope: NotificationScope,
  options: {
    isRead?: "all" | "read" | "unread";
    page?: number;
    limit?: number;
    since?: Date;
  } = {}
): Promise<{ items: NotificationListItem[]; total: number }> {
  const {
    isRead = "all",
    page = 1,
    limit = 20,
    since,
  } = options;

  const scopeCondition = buildScopeCondition(scope);
  const readCondition =
    isRead === "read"
      ? eq(notifications.isRead, true)
      : isRead === "unread"
      ? eq(notifications.isRead, false)
      : undefined;
  const sinceCondition = since ? gt(notifications.createdAt, since) : undefined;

  const conditions: SQL[] = [
    scopeCondition,
    readCondition,
    sinceCondition,
  ].filter((c): c is SQL => Boolean(c));
  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const offset = (Math.max(1, page) - 1) * limit;

  const rows = await db
    .select({
      notification: notifications,
      branch: {
        id: branches.id,
        name: branches.name,
        city: branches.city,
      },
      order: {
        id: orders.id,
        total: orders.total,
        status: orders.status,
        paymentStatus: orders.paymentStatus,
      },
      customerName: clients.name,
    })
    .from(notifications)
    .leftJoin(branches, eq(notifications.branchId, branches.id))
    .leftJoin(orders, eq(notifications.orderId, orders.id))
    .leftJoin(clients, eq(orders.userId, clients.id))
    .where(whereClause)
    .orderBy(desc(notifications.createdAt))
    .limit(limit)
    .offset(offset);

  const totalRows = await db
    .select({ value: sql<number>`count(*)` })
    .from(notifications)
    .where(whereClause);

  const items: NotificationListItem[] = rows.map((row) => ({
    id: row.notification.id,
    type: row.notification.type,
    orderId: row.notification.orderId,
    branchId: row.notification.branchId,
    title: row.notification.title,
    message: row.notification.message,
    isRead: row.notification.isRead,
    readAt: row.notification.readAt?.toISOString() ?? null,
    createdAt: row.notification.createdAt.toISOString(),
    updatedAt: row.notification.updatedAt.toISOString(),
    branch: row.branch?.id
      ? {
          id: row.branch.id!,
          name: row.branch.name!,
          city: row.branch.city!,
        }
      : null,
    order: row.order?.id
      ? {
          id: row.order.id,
          total: row.order.total,
          status: row.order.status,
          paymentStatus: row.order.paymentStatus,
          customerName: row.customerName,
        }
      : null,
  }));

  return {
    items,
    total: totalRows[0]?.value ?? 0,
  };
}

export async function markAllRead(scope: NotificationScope): Promise<number> {
  const scopeCondition = buildScopeCondition(scope);
  const whereClause = scopeCondition
    ? and(scopeCondition, eq(notifications.isRead, false))
    : eq(notifications.isRead, false);

  const result = await db
    .update(notifications)
    .set({
      isRead: true,
      readAt: new Date(),
      updatedAt: new Date(),
    })
    .where(whereClause)
    .returning({ id: notifications.id });

  return result.length;
}

export async function markRead(
  id: string,
  scope: NotificationScope
): Promise<boolean> {
  const scopeCondition = buildScopeCondition(scope);
  const whereClause = scopeCondition
    ? and(eq(notifications.id, id), scopeCondition)
    : eq(notifications.id, id);

  const result = await db
    .update(notifications)
    .set({ isRead: true, readAt: new Date(), updatedAt: new Date() })
    .where(whereClause)
    .returning({ id: notifications.id });

  return result.length > 0;
}

export async function deleteNotification(
  id: string,
  scope: NotificationScope
): Promise<boolean> {
  const scopeCondition = buildScopeCondition(scope);
  const whereClause = scopeCondition
    ? and(eq(notifications.id, id), scopeCondition)
    : eq(notifications.id, id);

  const result = await db
    .delete(notifications)
    .where(whereClause)
    .returning({ id: notifications.id });

  return result.length > 0;
}

export async function clearReadNotifications(
  scope: NotificationScope
): Promise<number> {
  const scopeCondition = buildScopeCondition(scope);
  const whereClause = scopeCondition
    ? and(scopeCondition, eq(notifications.isRead, true))
    : eq(notifications.isRead, true);

  const result = await db
    .delete(notifications)
    .where(whereClause)
    .returning({ id: notifications.id });

  return result.length;
}
