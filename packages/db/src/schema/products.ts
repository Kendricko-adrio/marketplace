import {
  pgTable,
  text,
  timestamp,
  boolean,
  numeric,
  integer,
  primaryKey,
  index,
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

// Brands table — product brand dimension, sync-managed (auto-created by the
// SOH import / webhook). No admin CRUD; rows are upserted by slug from the
// CSV "Brand" column (modal value per ART). See packages/db/src/soh-sync.ts.
export const brands = pgTable("brand", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Genders table — product gender dimension, sync-managed (auto-created by the
// SOH import / webhook) from the CSV "sex" column (Men/Women/Unisex/...).
// Distinct from the `gender` column on the `clients` table (onboarding).
export const genders = pgTable("gender", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
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
  // SOH sync fields — populated by the SOH import script / webhook
  // (see packages/db/src/soh-sync.ts). Nullable so admin-created products
  // (no supplier master data) still insert fine.
  articleNumber: text("article_number").unique(), // natural key (ART); nullable unique (multi-NULL OK)
  brandId: text("brand_id").references(() => brands.id), // FK -> brands; sync-managed, nullable
  genderId: text("gender_id").references(() => genders.id), // FK -> genders; sync-managed, nullable
  season: text("season"),
  collection: text("collection"), // CSV "STATUS" — sub-category/collection label, NOT the status enum
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
export const productVariants = pgTable(
  "product_variant",
  {
    id: text("id").primaryKey(),
    productId: text("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    sku: text("sku").notNull().unique(),
    color: text("color"),
    size: text("size"),
    price: numeric("price", { precision: 15, scale: 2 }).notNull(),
    isDefault: boolean("is_default").notNull().default(false),
    // SOH sync fields — supplier barcode + raw discount from CSV.
    // barcode is the supplier EAN (may be non-unique / non-numeric), distinct
    // from our system `sku` (which is generated as `${ART}-${Size}`).
    barcode: text("barcode"),
    discount: text("discount"), // raw disc% from CSV (mixed int/decimal formats, stored as-is)
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [index("product_variant_barcode_idx").on(t.barcode)]
);

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