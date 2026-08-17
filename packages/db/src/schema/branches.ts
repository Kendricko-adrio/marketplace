import {
  pgTable,
  text,
  timestamp,
  numeric,
  integer,
  jsonb,
  primaryKey,
  check,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";
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
  // Jubelio sync link — natural key (location_id) for this branch in Jubelio
  // (from /locations/list). Nullable + unique so admin/legacy branches still
  // insert. `code` is set to Jubelio `location_code`. See jubelio-sync.ts.
  jubelioLocationId: integer("jubelio_location_id").unique(),
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
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  check("branch_status_valid", sql`${t.status} in ('aktif', 'nonaktif')`),
]);

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
    // Quantity already deducted from Jubelio for pending_payment orders. It is
    // lifecycle/audit state, not subtracted from `stock` again because Jubelio
    // on-hand already includes the deduction. Cleared on payment success or
    // after a compensating Jubelio release is confirmed.
    reservedStock: integer("reserved_stock").notNull().default(0),
    // Units held locally while the Jubelio adjustment result is not confirmed.
    // Confirmed reservations are already reflected in `stock` (Jubelio
    // on-hand), so storefront availability is `stock - pendingRemoteStock`.
    pendingRemoteStock: integer("pending_remote_stock").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.branchId, t.productVariantId] }),
    check("branch_stock_nonnegative", sql`${t.stock} >= 0`),
    check("branch_reserved_stock_nonnegative", sql`${t.reservedStock} >= 0`),
    check(
      "branch_pending_remote_stock_nonnegative",
      sql`${t.pendingRemoteStock} >= 0`
    ),
  ]
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
