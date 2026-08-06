import { pgTable, text, timestamp, boolean, index } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { orders } from "./orders";
import { branches } from "./branches";

// =========================================================
// ADMIN NOTIFICATIONS
// =========================================================
// Real-time notification stream for admin staff. Rows are
// created when significant order lifecycle events happen
// (e.g. a customer successfully pays). Branch admins are
// scoped to their branch; HQ sees notifications for all
// branches.

export const notifications = pgTable(
  "notification",
  {
    id: text("id").primaryKey(),
    type: text("type").notNull().default("order_paid"), // order_paid | order_failed | order_cancelled | etc.
    orderId: text("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    branchId: text("branch_id")
      .notNull()
      .references(() => branches.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    message: text("message"),
    isRead: boolean("is_read").notNull().default(false),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("idx_notifications_branch_unread_created").on(
      t.branchId,
      t.isRead,
      t.createdAt
    ),
    index("idx_notifications_order_id").on(t.orderId),
  ]
);

export const notificationsRelations = relations(notifications, ({ one }) => ({
  order: one(orders, {
    fields: [notifications.orderId],
    references: [orders.id],
  }),
  branch: one(branches, {
    fields: [notifications.branchId],
    references: [branches.id],
  }),
}));

export type Notification = typeof notifications.$inferSelect;
export type NewNotification = typeof notifications.$inferInsert;
