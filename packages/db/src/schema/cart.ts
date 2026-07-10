import { pgTable, text, timestamp, integer } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { clients } from "./auth";
import { productVariants } from "./products";
import { branches } from "./branches";

// Cart table (belongs to store clients).
// A cart can hold items from multiple branches simultaneously. Each individual
// cart item carries its own branchId; the checkout flow groups items by branch
// and only allows a single branch's items per order.
export const carts = pgTable("cart", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .unique()
    .references(() => clients.id, { onDelete: "cascade" }),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Cart Items table — each line is tagged with the branch it was added from.
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
