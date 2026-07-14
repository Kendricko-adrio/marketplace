import {
  pgTable,
  text,
  timestamp,
  boolean,
  numeric,
  integer,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { clients, users } from "./auth";
import { productVariants } from "./products";
import { branches } from "./branches";

// Addresses table (belongs to store clients)
export const addresses = pgTable("address", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => clients.id, { onDelete: "cascade" }),
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  phone: text("phone").notNull(),
  fullAddress: text("full_address").notNull(),
  city: text("city").notNull(),
  district: text("district").notNull(),
  postalCode: text("postal_code").notNull(),
  isDefault: boolean("is_default").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Orders table (belongs to store clients).
// Phase 1 (pickup-in-store) uses English statuses and pickup fields.
// addressId/shippingCarrier/trackingNumber/shippingCost are retained but
// nullable for future Phase 2 shipping support.
export const orders = pgTable("orders", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => clients.id, { onDelete: "cascade" }),
  branchId: text("branch_id").references(() => branches.id),
  addressId: text("address_id").references(() => addresses.id),
  voucherId: text("voucher_id"),
  // pending_payment | processing | ready_for_pickup | completed | cancelled
  status: text("status").notNull().default("pending_payment"),
  paymentMethod: text("payment_method"), // qris | va
  paymentStatus: text("payment_status")
    .notNull()
    .default("pending"), // pending | paid | failed
  // Pickup-in-store fields (Phase 1)
  pickupCode: text("pickup_code"), // 6-char uppercase alphanumeric, set on payment success
  pickupDate: timestamp("pickup_date"),
  pickupTime: text("pickup_time"), // "HH:mm"
  contactPhone: text("contact_phone").notNull(),
  contactEmail: text("contact_email").notNull(),
  subtotal: numeric("subtotal", { precision: 15, scale: 2 }).notNull(),
  shippingCost: numeric("shipping_cost", { precision: 15, scale: 2 })
    .notNull()
    .default("0"),
  discount: numeric("discount", { precision: 15, scale: 2 })
    .notNull()
    .default("0"),
  serviceFee: numeric("service_fee", { precision: 15, scale: 2 })
    .notNull()
    .default("0"),
  total: numeric("total", { precision: 15, scale: 2 }).notNull(),
  // Midtrans transaction id (from Core API charge response), nullable until charge succeeds
  midtransTransactionId: text("midtrans_transaction_id"),
  // Midtrans Snap redirect URL, saved so user can resume payment if they navigate away
  snapRedirectUrl: text("snap_redirect_url"),
  // Phase 2 shipping fields (nullable, unused in Phase 1)
  shippingCarrier: text("shipping_carrier"),
  trackingNumber: text("tracking_number"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Order Items table
export const orderItems = pgTable("order_item", {
  id: text("id").primaryKey(),
  orderId: text("order_id")
    .notNull()
    .references(() => orders.id, { onDelete: "cascade" }),
  variantId: text("variant_id")
    .notNull()
    .references(() => productVariants.id),
  productName: text("product_name").notNull(),
  variantInfo: text("variant_info"), // e.g., "Hitam / XL"
  price: numeric("price", { precision: 15, scale: 2 }).notNull(),
  quantity: integer("quantity").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Relations
export const addressesRelations = relations(addresses, ({ one, many }) => ({
  user: one(clients, {
    fields: [addresses.userId],
    references: [clients.id],
  }),
  orders: many(orders),
}));

export const ordersRelations = relations(orders, ({ one, many }) => ({
  user: one(clients, {
    fields: [orders.userId],
    references: [clients.id],
  }),
  branch: one(branches, {
    fields: [orders.branchId],
    references: [branches.id],
  }),
  address: one(addresses, {
    fields: [orders.addressId],
    references: [addresses.id],
  }),
  items: many(orderItems),
}));

export const orderItemsRelations = relations(orderItems, ({ one }) => ({
  order: one(orders, {
    fields: [orderItems.orderId],
    references: [orders.id],
  }),
  variant: one(productVariants, {
    fields: [orderItems.variantId],
    references: [productVariants.id],
  }),
}));
