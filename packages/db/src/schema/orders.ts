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

// Orders table (belongs to store clients)
export const orders = pgTable("orders", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => clients.id, { onDelete: "cascade" }),
  addressId: text("address_id").references(() => addresses.id),
  voucherId: text("voucher_id"),
  status: text("status").notNull().default("proses"), // proses | dikirim | selesai | batal
  paymentMethod: text("payment_method"), // qris | va
  paymentStatus: text("payment_status").notNull().default("pending"), // pending | paid | failed
  subtotal: numeric("subtotal", { precision: 15, scale: 2 }).notNull(),
  shippingCost: numeric("shipping_cost", { precision: 15, scale: 2 })
    .notNull()
    .default("0"),
  discount: numeric("discount", { precision: 15, scale: 2 })
    .notNull()
    .default("0"),
  serviceFee: numeric("service_fee", { precision: 15, scale: 2 })
    .notNull()
    .default("1000"),
  total: numeric("total", { precision: 15, scale: 2 }).notNull(),
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
