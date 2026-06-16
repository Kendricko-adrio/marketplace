import { pgTable, text, timestamp, integer, jsonb } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { clients, users } from "./auth";
import { products } from "./products";

// Audit Log table - tracks admin activities (references admin users table)
export const auditLogs = pgTable("audit_log", {
  id: text("id").primaryKey(),
  userId: text("user_id").references(() => users.id, { onDelete: "set null" }),
  action: text("action").notNull(), // e.g., "UPDATE_STOCK", "CREATE_PRODUCT", etc.
  entityType: text("entity_type").notNull(), // e.g., "product", "order", "user"
  entityId: text("entity_id"),
  changes: jsonb("changes"), // JSON diff of changes
  ipAddress: text("ip_address"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Reviews table (belongs to store clients)
export const reviews = pgTable("review", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => clients.id, { onDelete: "cascade" }),
  productId: text("product_id")
    .notNull()
    .references(() => products.id, { onDelete: "cascade" }),
  rating: integer("rating").notNull(), // 1-5
  comment: text("comment"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Relations
export const auditLogsRelations = relations(auditLogs, ({ one }) => ({
  user: one(users, {
    fields: [auditLogs.userId],
    references: [users.id],
  }),
}));

export const reviewsRelations = relations(reviews, ({ one }) => ({
  user: one(clients, {
    fields: [reviews.userId],
    references: [clients.id],
  }),
  product: one(products, {
    fields: [reviews.productId],
    references: [products.id],
  }),
}));
