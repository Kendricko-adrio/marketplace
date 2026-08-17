import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";
import { orders } from "./orders";

export type JubelioStockOperationPayload = {
  locationId: number;
  items: Array<{
    variantId: string;
    itemId: number;
    quantity: number;
    description: string;
  }>;
};

export const jubelioStockOperations = pgTable(
  "jubelio_stock_operation",
  {
    id: text("id").primaryKey(),
    orderId: text("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    type: text("type").notNull(), // reserve | release
    status: text("status").notNull().default("pending"),
    note: text("note").notNull().unique(),
    payload: jsonb("payload").$type<JubelioStockOperationPayload>().notNull(),
    remoteAdjustmentId: integer("remote_adjustment_id"),
    attemptCount: integer("attempt_count").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("jubelio_stock_operation_order_type_unique").on(
      t.orderId,
      t.type
    ),
    index("idx_jubelio_stock_operation_retry").on(t.status, t.nextAttemptAt),
    check(
      "jubelio_stock_operation_type_valid",
      sql`${t.type} in ('reserve', 'release')`
    ),
    check(
      "jubelio_stock_operation_status_valid",
      sql`${t.status} in ('pending', 'in_flight', 'applied', 'committed', 'reconciling', 'failed', 'manual_review')`
    ),
    check(
      "jubelio_stock_operation_attempt_nonnegative",
      sql`${t.attemptCount} >= 0`
    ),
  ]
);

export const jubelioStockOperationsRelations = relations(
  jubelioStockOperations,
  ({ one }) => ({
    order: one(orders, {
      fields: [jubelioStockOperations.orderId],
      references: [orders.id],
    }),
  })
);
