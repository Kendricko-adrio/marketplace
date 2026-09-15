import { pgTable, text, timestamp, jsonb, integer } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { users } from "./auth";
import { branches } from "./branches";

// Audit Log table - tracks admin activities (references admin users table)
export const auditLogs = pgTable("audit_log", {
  id: text("id").primaryKey(),
  userId: text("user_id").references(() => users.id, { onDelete: "set null" }),
  action: text("action").notNull(), // e.g., "UPDATE_STOCK", "CREATE_PRODUCT", etc.
  entityType: text("entity_type").notNull(), // e.g., "product", "order", "user"
  entityId: text("entity_id"),
  changes: jsonb("changes"), // JSON diff of changes
  ipAddress: text("ip_address"),
  // RBAC extensions: the Policy version in force when the event was written,
  // and the Branch classification of the event. Branch references use SET NULL
  // so Audit Events survive later Branch deletion (identity is retained in
  // the changes JSON payload).
  policyVersion: integer("policy_version"),
  // 'global' | 'single_branch' | 'dual_branch' (e.g. old+new Home Branch on a
  // reassignment) | null (legacy unclassified events).
  branchScope: text("branch_scope"),
  branchId: text("branch_id").references(() => branches.id, {
    onDelete: "set null",
  }),
  // Second Branch for reassignment events (the new Home Branch when branchId
  // carries the old one).
  relatedBranchId: text("related_branch_id").references(() => branches.id, {
    onDelete: "set null",
  }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Relations
export const auditLogsRelations = relations(auditLogs, ({ one }) => ({
  user: one(users, {
    fields: [auditLogs.userId],
    references: [users.id],
  }),
  branch: one(branches, {
    fields: [auditLogs.branchId],
    references: [branches.id],
  }),
  relatedBranch: one(branches, {
    fields: [auditLogs.relatedBranchId],
    references: [branches.id],
  }),
}));

// System config — general-purpose key/value settings, edited via SQL (no admin UI
// for now). Loaded once into an in-memory cache at app boot
// (see apps/store/src/lib/config.ts); restart the app to pick up changes.
//
// Known keys (see seed.ts):
//   reservation.ttlMinutes (number) — minutes stock is reserved while a customer
//   is on the Midtrans Snap payment page before the order expires.
//   tax.ppnRatePercent (number) — PPN applied after discount; restart the store
//   process after changing it.
export const systemConfig = pgTable("system_config", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  // Hint for how to parse `value`: "string" | "number" | "json"
  type: text("type").notNull().default("string"),
  description: text("description"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
