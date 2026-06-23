import {
  pgTable,
  text,
  timestamp,
  boolean,
  integer,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

// Static pages (CMS) — markdown content managed by HQ via /admin/pages.
// Rendered on the storefront at /pages/[slug].
export const staticPages = pgTable("static_page", {
  id: text("id").primaryKey(),
  slug: text("slug").notNull().unique(), // about | terms | contact | privacy | ...
  title: text("title").notNull(),
  content: text("content").notNull().default(""), // markdown source
  isPublished: boolean("is_published").notNull().default(true),
  displayOrder: integer("display_order").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const staticPagesRelations = relations(staticPages, () => ({}));