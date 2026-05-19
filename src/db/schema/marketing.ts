import {
  pgTable,
  text,
  timestamp,
  boolean,
  numeric,
  integer,
} from "drizzle-orm/pg-core";

// Vouchers table
export const vouchers = pgTable("voucher", {
  id: text("id").primaryKey(),
  code: text("code").notNull().unique(),
  discountType: text("discount_type").notNull(), // percentage | fixed | shipping
  value: numeric("value", { precision: 15, scale: 2 }).notNull(),
  maxDiscount: numeric("max_discount", { precision: 15, scale: 2 }),
  minPurchase: numeric("min_purchase", { precision: 15, scale: 2 })
    .notNull()
    .default("0"),
  quota: integer("quota").notNull().default(100),
  used: integer("used").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
  validFrom: timestamp("valid_from").notNull().defaultNow(),
  validUntil: timestamp("valid_until").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Banners table
export const banners = pgTable("banner", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  imageUrl: text("image_url").notNull(),
  linkUrl: text("link_url"),
  displayOrder: integer("display_order").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
