import { describe, it, expect } from "vitest";
import { validateContent, productFilterSchema } from "./homepage-content";

// Backs POST /api/admin/homepage and PATCH /api/admin/homepage/{id} content
// validation. Limits from docs/features/homepage-cms.md.
describe("validateContent", () => {
  it("returns {} for null/undefined content", () => {
    expect(validateContent("banner", null)).toEqual({});
    expect(validateContent("banner", undefined)).toEqual({});
  });

  it("passes through store_banner content unvalidated", () => {
    const content = { anything: [1, 2, 3] };
    expect(validateContent("store_banner", content)).toBe(content);
  });

  it("accepts a valid banner with up to 5 slides", () => {
    const content = {
      slides: [
        { imageUrl: "/uploads/homepage/a.jpg", altText: "A" },
        { imageUrl: "/uploads/homepage/b.jpg" },
      ],
      ctaText: "Belanja",
      autoRotateIntervalSec: 5,
    };
    expect(validateContent("banner", content)).toMatchObject({
      slides: content.slides,
    });
  });

  it("rejects a banner with more than 5 slides", () => {
    const content = {
      slides: Array.from({ length: 6 }, (_, i) => ({
        imageUrl: `/uploads/homepage/${i}.jpg`,
      })),
    };
    expect(() => validateContent("banner", content)).toThrow();
  });

  it("rejects a banner slide without an imageUrl", () => {
    expect(() =>
      validateContent("banner", { slides: [{ altText: "no image" }] })
    ).toThrow();
  });

  it("accepts a valid carousel with a filter and limit", () => {
    const content = {
      mode: "filter",
      filter: { brand: "puma", hasDiscount: true, sortOrder: "priceAsc" },
      limit: 10,
    };
    expect(validateContent("carousel_product", content)).toMatchObject(content);
  });

  it("rejects a carousel with an out-of-range limit", () => {
    expect(() =>
      validateContent("carousel_product", { mode: "manual", limit: 21 })
    ).toThrow();
    expect(() =>
      validateContent("carousel_product", { mode: "manual", limit: 0 })
    ).toThrow();
  });

  it("rejects a carousel with an unknown sortOrder", () => {
    expect(() =>
      validateContent("carousel_product", {
        mode: "filter",
        filter: { sortOrder: "bestseller" },
      })
    ).toThrow();
  });

  it("accepts a valid promo card set (max 6)", () => {
    const content = {
      cards: [
        { id: "c1", imageUrl: "/uploads/homepage/p1.jpg", title: "Promo 1" },
        { id: "c2", imageUrl: "/uploads/homepage/p2.jpg", title: "Promo 2" },
      ],
    };
    expect(validateContent("promo_cards", content)).toMatchObject(content);
  });

  it("rejects more than 6 promo cards", () => {
    const content = {
      cards: Array.from({ length: 7 }, (_, i) => ({
        id: `c${i}`,
        imageUrl: `/uploads/homepage/p${i}.jpg`,
        title: `P${i}`,
      })),
    };
    expect(() => validateContent("promo_cards", content)).toThrow();
  });

  it("accepts a valid announcement bar", () => {
    expect(
      validateContent("announcement_bar", {
        message: "Gratis ongkir!",
        variant: "success",
      })
    ).toMatchObject({ message: "Gratis ongkir!", variant: "success" });
  });

  it("rejects an announcement bar with an unknown variant", () => {
    expect(() =>
      validateContent("announcement_bar", { message: "x", variant: "loud" })
    ).toThrow();
  });
});

describe("productFilterSchema", () => {
  it("accepts a full filter config", () => {
    const parsed = productFilterSchema.parse({
      search: "puma",
      category: "celana",
      brand: "puma",
      minPrice: "10000",
      maxPrice: "500000",
      hasDiscount: true,
      sortOrder: "newest",
    });
    expect(parsed.brand).toBe("puma");
  });

  it("rejects an unknown sortOrder", () => {
    expect(() =>
      productFilterSchema.parse({ sortOrder: "rating" })
    ).toThrow();
  });
});
