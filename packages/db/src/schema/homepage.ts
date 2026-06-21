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

export interface BannerContent {
  imageUrl: string;
  altText?: string;
  ctaText?: string;
  ctaLink?: string;
}

export interface PromoCardItem {
  id: string;
  imageUrl: string;
  title: string;
  linkUrl?: string;
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