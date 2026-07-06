import { pgTable, text, timestamp, integer } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { clients } from "./auth";
import { productVariants } from "./products";
import { branches } from "./branches";

// Cart table (belongs to store clients).
// branchId enforces the "1 cart = 1 branch" rule: all items in a cart must
// belong to the same branch. Null only when the cart is empty.
export const carts = pgTable("cart", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .unique()
    .references(() => clients.id, { onDelete: "cascade" }),
  branchId: text("branch_id").references(() => branches.id, {
    onDelete: "set null",
  }),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Cart Items table
export const cartItems = pgTable("cart_item", {
  id: text("id").primaryKey(),
  cartId: text("cart_id")
    .notNull()
    .references(() => carts.id, { onDelete: "cascade" }),
  variantId: text("variant_id")
    .notNull()
    .references(() => productVariants.id, { onDelete: "cascade" }),
  branchId: text("branch_id").references(() => branches.id, {
    onDelete: "cascade",
  }),
  quantity: integer("quantity").notNull().default(1),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Relations
export const cartsRelations = relations(carts, ({ one, many }) => ({
  user: one(clients, {
    fields: [carts.userId],
    references: [clients.id],
  }),
  branch: one(branches, {
    fields: [carts.branchId],
    references: [branches.id],
  }),
  items: many(cartItems),
}));

export const cartItemsRelations = relations(cartItems, ({ one }) => ({
  cart: one(carts, {
    fields: [cartItems.cartId],
    references: [carts.id],
  }),
  variant: one(productVariants, {
    fields: [cartItems.variantId],
    references: [productVariants.id],
  }),
  branch: one(branches, {
    fields: [cartItems.branchId],
    references: [branches.id],
  }),
}));
