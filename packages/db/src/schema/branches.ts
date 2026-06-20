import {
  pgTable,
  text,
  timestamp,
  numeric,
  integer,
  jsonb,
  primaryKey,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { productVariants } from "./products";
import { cartItems } from "./cart";

// Operating hours per day. null means closed that day.
export type DayHours = { open: string; close: string } | null;

export type OperatingHours = {
  monday?: DayHours;
  tuesday?: DayHours;
  wednesday?: DayHours;
  thursday?: DayHours;
  friday?: DayHours;
  saturday?: DayHours;
  sunday?: DayHours;
};

// Branches (physical store locations)
export const branches = pgTable("branch", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  code: text("code").notNull().unique(),
  city: text("city").notNull(),
  address: text("address").notNull(),
  latitude: numeric("latitude", { precision: 10, scale: 7 }),
  longitude: numeric("longitude", { precision: 10, scale: 7 }),
  operatingHours: jsonb("operating_hours")
    .$type<OperatingHours>()
    .notNull()
    .default({}),
  googleMapsUrl: text("google_maps_url"),
  status: text("status").notNull().default("aktif"), // aktif | nonaktif
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Per-variant stock at each branch (source of truth for stock)
export const branchStocks = pgTable(
  "branch_stock",
  {
    branchId: text("branch_id")
      .notNull()
      .references(() => branches.id, { onDelete: "cascade" }),
    productVariantId: text("product_variant_id")
      .notNull()
      .references(() => productVariants.id, { onDelete: "cascade" }),
    stock: integer("stock").notNull().default(0),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.branchId, t.productVariantId] })]
);

export const branchesRelations = relations(branches, ({ many }) => ({
  branchStocks: many(branchStocks),
  cartItems: many(cartItems),
}));

export const branchStocksRelations = relations(branchStocks, ({ one }) => ({
  branch: one(branches, {
    fields: [branchStocks.branchId],
    references: [branches.id],
  }),
  productVariant: one(productVariants, {
    fields: [branchStocks.productVariantId],
    references: [productVariants.id],
  }),
}));