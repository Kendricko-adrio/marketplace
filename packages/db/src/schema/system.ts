import { pgTable, text, timestamp, jsonb } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { users } from "./auth";

// Audit Log table - tracks admin activities (references admin users table)
export const auditLogs = pgTable("audit_log", {
  id: text("id").primaryKey(),
  userId: text("user_id").references(() => users.id, { onDelete: "set null" }),
  action: text("action").notNull(), // e.g., "UPDATE_STOCK", "CREATE_PRODUCT", etc.
  entityType: text("entity_type").notNull(), // e.g., "product", "order", "user"
  entityId: text("entity_id"),
  changes: jsonb("changes"), // JSON diff of changes
  ipAddress: text("ip_address"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Relations
export const auditLogsRelations = relations(auditLogs, ({ one }) => ({
  user: one(users, {
    fields: [auditLogs.userId],
    references: [users.id],
  }),
}));

// System config â€” general-purpose key/value settings, edited via SQL (no admin UI
// for now). Loaded once into an in-memory cache at app boot
// (see apps/store/src/lib/config.ts); restart the app to pick up changes.
//
// Known keys (see seed.ts):
//   reservation.ttlMinutes (number) â€” minutes stock is reserved while a customer
//   is on the Midtrans Snap payment page before the order expires.
export const systemConfig = pgTable("system_config", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  // Hint for how to parse `value`: "string" | "number" | "json"
  type: text("type").notNull().default("string"),
  description: text("description"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
