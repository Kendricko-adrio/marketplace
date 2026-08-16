import {
  pgTable,
  text,
  timestamp,
  boolean,
  numeric,
  integer,
  jsonb,
  primaryKey,
  index,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

/**
 * Product-level gallery image entry. Populated from Jubelio
 * `/inventory/catalog/{item_group_id}` `images[]` by the Jubelio sync
 * (see packages/db/src/jubelio-sync.ts). URLs are hotlinked from the Jubelio
 * CDN — never downloaded to local storage.
 */
export type ProductImage = {
  url: string;
  thumbnail: string;
  displayOrder: number;
};

// Categories table
export const categories = pgTable("category", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  description: text("description"),
  image: text("image"),
  icon: text("icon"),
  isActive: boolean("is_active").notNull().default(true),
  // Jubelio sync link — natural key for this category in Jubelio
  // (from /inventory/categories/item-categories/). Nullable + unique so
  // admin/legacy categories still insert. See packages/db/src/jubelio-sync.ts.
  jubelioCategoryId: integer("jubelio_category_id").unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// Brands table â€” product brand dimension, sync-managed (auto-created by the
// Jubelio import / webhook). No admin CRUD; rows are upserted by slug from the
// supplier master data. See packages/db/src/jubelio-sync.ts.
export const brands = pgTable("brand", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// Genders table â€” product gender dimension, sync-managed (auto-created by the
// Jubelio import / webhook) from the supplier "sex" value (Men/Women/Unisex/...).
// Distinct from the `gender` column on the `clients` table (onboarding).
export const genders = pgTable("gender", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// Products table
export const products = pgTable("product", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  description: text("description"),
  basePrice: numeric("base_price", { precision: 15, scale: 2 }).notNull(),
  status: text("status").notNull().default("aktif"), // aktif | habis | arsip
  // Sync-managed fields â€” populated by the Jubelio import / webhook
  // (see packages/db/src/jubelio-sync.ts). Nullable so admin-created products
  // (no supplier master data) still insert fine.
  articleNumber: text("article_number").unique(), // natural key (ART); nullable unique (multi-NULL OK)
  brandId: text("brand_id").references(() => brands.id), // FK -> brands; sync-managed, nullable
  genderId: text("gender_id").references(() => genders.id), // FK -> genders; sync-managed, nullable
  season: text("season"),
  // Jubelio sync link — natural key (item_group_id) for this product in Jubelio.
  // Nullable + unique so admin/legacy/CSV products still insert. Populated by
  // the Jubelio import script / webhook (see packages/db/src/jubelio-sync.ts).
  jubelioItemGroupId: integer("jubelio_item_group_id").unique(),
  // Product-level image (card thumbnail) — Jubelio group `thumbnail`, hotlinked
  // from the Jubelio CDN. Used by product cards / cart / order line items.
  thumbnail: text("thumbnail"),
  // Product-level gallery images — Jubelio `/inventory/catalog/{id}` `images[]`,
  // hotlinked. Used by the product detail page gallery. Null for legacy/admin
  // products. Stored as JSONB (never queried per-row, only displayed as a set).
  images: jsonb("images").$type<ProductImage[]>(),
  collection: text("collection"), // CSV "STATUS" â€” sub-category/collection label, NOT the status enum
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
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
export const productVariants = pgTable(
  "product_variant",
  {
    id: text("id").primaryKey(),
    productId: text("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    sku: text("sku").notNull().unique(),
    // Jubelio sync link — natural key (item_id) for this variant in Jubelio.
    // Nullable + unique so admin/legacy variants still insert.
    jubelioItemId: integer("jubelio_item_id").unique(),
    color: text("color"),
    size: text("size"),
    price: numeric("price", { precision: 15, scale: 2 }).notNull(),
    isDefault: boolean("is_default").notNull().default(false),
    // Sync-managed fields â€” supplier barcode + raw discount.
    // barcode is the supplier EAN (may be non-unique / non-numeric), distinct
    // from our system `sku` (which is generated as `${ART}-${Size}`).
    barcode: text("barcode"),
    discount: text("discount"), // raw disc% from CSV (mixed int/decimal formats, stored as-is)
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("product_variant_barcode_idx").on(t.barcode)]
);

// Product Images table (legacy, variant-level). Jubelio-synced products use the
// product-level `thumbnail` + `images` JSONB columns on `products` instead (set
// by packages/db/src/jubelio-sync.ts). This variant-level table is kept for
// backward compatibility with pre-Jubelio admin-uploaded images and the seeder;
// admin product CRUD (which wrote here) is removed now that Jubelio is the
// source of truth. New code should read `products.thumbnail` / `products.images`.
export const productImages = pgTable("product_image", {
  id: text("id").primaryKey(),
  variantId: text("variant_id")
    .notNull()
    .references(() => productVariants.id, { onDelete: "cascade" }),
  url: text("url").notNull(),
  displayOrder: integer("display_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Relations
export const categoriesRelations = relations(categories, ({ many }) => ({
  productToCategory: many(productToCategory),
}));

export const brandsRelations = relations(brands, ({ many }) => ({
  products: many(products),
}));

export const gendersRelations = relations(genders, ({ many }) => ({
  products: many(products),
}));

export const productsRelations = relations(products, ({ many, one }) => ({
  variants: many(productVariants),
  productToCategory: many(productToCategory),
  brand: one(brands, { fields: [products.brandId], references: [brands.id] }),
  gender: one(genders, { fields: [products.genderId], references: [genders.id] }),
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