import { z } from "zod";

/**
 * Per-type homepage section content validation, shared by
 * POST /api/admin/homepage and PATCH /api/admin/homepage/{id}.
 * Extracted so the validation rules are unit-testable.
 */

export const productFilterSchema = z.object({
  search: z.string().optional(),
  category: z.string().optional(), // category slug
  brand: z.string().optional(), // brand slug
  minPrice: z.string().optional(),
  maxPrice: z.string().optional(),
  hasDiscount: z.boolean().optional(),
  sortOrder: z.enum(["newest", "priceAsc", "priceDesc"]).optional(),
});

const bannerSlideSchema = z.object({
  imageUrl: z.string(),
  altText: z.string().optional(),
});

const bannerContentSchema = z.object({
  slides: z.array(bannerSlideSchema).max(5).default([]),
  ctaText: z.string().optional(),
  ctaLink: z.string().optional(),
  autoRotateIntervalSec: z.number().int().min(2).max(30).optional(),
});

const carouselContentSchema = z.object({
  mode: z.enum(["manual", "filter"]),
  filter: productFilterSchema.optional(),
  limit: z.number().int().min(1).max(20).optional(),
});

const promoCardItemSchema = z.object({
  id: z.string(),
  imageUrl: z.string(),
  title: z.string(),
  filter: productFilterSchema.optional(),
});

const promoCardsContentSchema = z.object({
  cards: z.array(promoCardItemSchema).max(6).default([]),
});

const announcementBarContentSchema = z.object({
  message: z.string(),
  variant: z.enum(["info", "warning", "success"]).optional(),
});

/**
 * Per-type content validator. Returns the validated content or throws a
 * ZodError the caller can pass back to the client.
 */
export function validateContent(type: string, content: unknown): unknown {
  if (content === null || content === undefined) return {};
  switch (type) {
    case "banner":
      return bannerContentSchema.parse(content);
    case "carousel_product":
      return carouselContentSchema.parse(content);
    case "promo_cards":
      return promoCardsContentSchema.parse(content);
    case "announcement_bar":
      return announcementBarContentSchema.parse(content);
    case "store_banner":
    default:
      return content;
  }
}
