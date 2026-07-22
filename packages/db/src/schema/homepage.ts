import {
  pgTable,
  text,
  timestamp,
  boolean,
  integer,
  jsonb,
  primaryKey,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { products } from "./products";

export type HomepageSectionType =
  | "banner"
  | "carousel_product"
  | "promo_cards"
  | "announcement_bar"
  | "store_banner";

/**
 * Filter configuration shared by carousel "filter" mode and promo cards.
 * Field names match the /products query string format consumed by the
 * storefront API (see apps/store/src/app/api/products/route.ts).
 */
export interface ProductFilterConfig {
  search?: string;
  category?: string; // category slug
  minPrice?: string;
  maxPrice?: string;
  flashSale?: boolean;
  sortOrder?: "newest" | "priceAsc" | "priceDesc" | "bestseller" | "rating";
}

export type CarouselSortOrder =
  | "newest"
  | "priceAsc"
  | "priceDesc"
  | "bestseller"
  | "rating";

/**
 * Banner hero content. Supports a carousel of 1-5 background images that
 * auto-rotate. Title/subtitle/CTA are shared across all slides.
 */
export interface BannerSlide {
  imageUrl: string;
  altText?: string;
}

export interface BannerContent {
  slides: BannerSlide[];
  ctaText?: string;
  ctaLink?: string;
  autoRotateIntervalSec?: number; // default 5, min 2, max 30
}

/**
 * Carousel product content. Supports two modes:
 * - "manual": products are linked via the homepage_section_product junction
 *   table (productIds passed through the API payload).
 * - "filter": products are resolved dynamically at render time based on the
 *   stored filter config and limit. Junction table is unused in this mode.
 */
export interface CarouselContent {
  mode: "manual" | "filter";
  filter?: ProductFilterConfig;
  limit?: number; // 1-20, default 10
}

export interface PromoCardItem {
  id: string;
  imageUrl: string;
  title: string;
  filter?: ProductFilterConfig; // undefined → non-clickable card
}

export interface PromoCardsContent {
  cards: PromoCardItem[];
}

export interface AnnouncementBarContent {
  message: string;
  variant?: "info" | "warning" | "success";
}

export const homepageSections = pgTable("homepage_section", {
  id: text("id").primaryKey(),
  type: text("type").notNull(), // banner | carousel_product | promo_cards | announcement_bar | store_banner
  title: text("title"),
  subtitle: text("subtitle"),
  content: jsonb("content").notNull().default({}),
  displayOrder: integer("display_order").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const homepageSectionProducts = pgTable(
  "homepage_section_product",
  {
    sectionId: text("section_id")
      .notNull()
      .references(() => homepageSections.id, { onDelete: "cascade" }),
    productId: text("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    displayOrder: integer("display_order").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.sectionId, t.productId] })]
);

export const homepageSectionsRelations = relations(
  homepageSections,
  ({ many }) => ({
    sectionProducts: many(homepageSectionProducts),
  })
);

export const homepageSectionProductsRelations = relations(
  homepageSectionProducts,
  ({ one }) => ({
    section: one(homepageSections, {
      fields: [homepageSectionProducts.sectionId],
      references: [homepageSections.id],
    }),
    product: one(products, {
      fields: [homepageSectionProducts.productId],
      references: [products.id],
    }),
  })
);