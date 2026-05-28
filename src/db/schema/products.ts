import {
  pgTable,
  text,
  timestamp,
  boolean,
  numeric,
  integer,
  primaryKey,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

// Categories table
export const categories = pgTable("category", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  description: text("description"),
  image: text("image"),
  icon: text("icon"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Products table
export const products = pgTable("product", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  description: text("description"),
  basePrice: numeric("base_price", { precision: 15, scale: 2 }).notNull(),
  status: text("status").notNull().default("aktif"), // aktif | habis | arsip
  rating: numeric("rating", { precision: 2, scale: 1 }).default("0"),
  sold: integer("sold").notNull().default(0),
  isFlashSale: boolean("is_flash_sale").notNull().default(false),
  flashSalePrice: numeric("flash_sale_price", { precision: 15, scale: 2 }),
  flashSaleEndsAt: timestamp("flash_sale_ends_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Product to Category junction table (many-to-many)
export const productToCategory = pgTable(
  "product_to_category",
  {
    productId: text("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    categoryId: text("category_id")
      .notNull()
      .references(() => categories.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.productId, t.categoryId] })]
);

// Product Variants table (color, size combinations)
export const productVariants = pgTable("product_variant", {
  id: text("id").primaryKey(),
  productId: text("product_id")
    .notNull()
    .references(() => products.id, { onDelete: "cascade" }),
  sku: text("sku").notNull().unique(),
  color: text("color"),
  size: text("size"),
  price: numeric("price", { precision: 15, scale: 2 }).notNull(),
  stock: integer("stock").notNull().default(0),
  isDefault: boolean("is_default").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Product Images table
export const productImages = pgTable("product_image", {
  id: text("id").primaryKey(),
  variantId: text("variant_id")
    .notNull()
    .references(() => productVariants.id, { onDelete: "cascade" }),
  url: text("url").notNull(),
  displayOrder: integer("display_order").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Relations
export const categoriesRelations = relations(categories, ({ many }) => ({
  productToCategory: many(productToCategory),
}));

export const productsRelations = relations(products, ({ many }) => ({
  variants: many(productVariants),
  productToCategory: many(productToCategory),
}));

export const productToCategoryRelations = relations(
  productToCategory,
  ({ one }) => ({
    product: one(products, {
      fields: [productToCategory.productId],
      references: [products.id],
    }),
    category: one(categories, {
      fields: [productToCategory.categoryId],
      references: [categories.id],
    }),
  })
);

export const productVariantsRelations = relations(
  productVariants,
  ({ one, many }) => ({
    product: one(products, {
      fields: [productVariants.productId],
      references: [products.id],
    }),
    images: many(productImages),
  })
);

export const productImagesRelations = relations(productImages, ({ one }) => ({
  variant: one(productVariants, {
    fields: [productImages.variantId],
    references: [productVariants.id],
  }),
}));
