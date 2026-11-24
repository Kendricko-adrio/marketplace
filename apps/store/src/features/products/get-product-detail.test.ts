import { describe, it, expect, vi } from "vitest";

vi.mock("@/db", () => ({
  db: {},
  products: {},
  productVariants: {},
  productToCategory: {},
  categories: {},
  productImages: {},
  branchStocks: {},
  branches: {},
  brands: {},
  genders: {},
}));

vi.mock("@/lib/variant-price-projection", () => ({
  readVariantProjections: vi.fn(),
}));

import { buildProductMetadata, type ProductDetailDto } from "./get-product-detail";

function makeProduct(overrides: Partial<ProductDetailDto> = {}): ProductDetailDto {
  return {
    id: "prod-1",
    name: "Classic Leather Oxford",
    slug: "classic-leather-oxford-formal",
    description: "<p>Sepatu <strong>kulit</strong> formal untuk acara resmi.</p>",
    basePrice: "1900000",
    status: "aktif",
    brand: "OxfordCo",
    gender: "Men",
    collection: "Formal",
    season: "FW25",
    articleNumber: "SEED-OX-003",
    images: [{ url: "https://cdn.example.com/product-main.jpg" }],
    categories: [{ id: "cat-1", name: "Formal Shoes", slug: "formal-shoes" }],
    variants: [
      {
        id: "var-1",
        sku: "OX-BLK-42",
        color: "Black",
        size: "42",
        price: "1500000",
        sourcePrice: "1900000",
        storedTarget: null,
        markdownActive: true,
        markdownRevisionId: "rev-1",
        isDefault: true,
        images: ["https://cdn.example.com/variant-1.jpg"],
        branchStock: [],
      },
    ],
    colors: ["Black"],
    sizes: ["42"],
    ...overrides,
  };
}

describe("buildProductMetadata", () => {
  it("returns safe fallback metadata when product is null", () => {
    const meta = buildProductMetadata(null);

    expect(meta.title).toBe("Produk tidak ditemukan | ADF Sports");
    expect(meta.openGraph).toBeUndefined();
  });

  it("formats title, strips HTML from description, and sets Open Graph image from default variant", () => {
    const meta = buildProductMetadata(makeProduct());

    expect(meta.title).toBe("Classic Leather Oxford | ADF Sports");
    expect(meta.description).toBe("Sepatu kulit formal untuk acara resmi.");
    expect(meta.openGraph).toEqual({
      title: "Classic Leather Oxford | ADF Sports",
      description: "Sepatu kulit formal untuk acara resmi.",
      images: ["https://cdn.example.com/variant-1.jpg"],
    });
  });

  it("trims plain-text description to at most 160 characters", () => {
    const longText = "Sepatu lari ringan dengan bantalan responsif ".repeat(6);
    const meta = buildProductMetadata(
      makeProduct({ description: `<p>${longText}</p>` })
    );

    expect(typeof meta.description).toBe("string");
    expect((meta.description as string).length).toBeLessThanOrEqual(160);
    expect((meta.description as string).endsWith("...")).toBe(true);
  });

  it("falls back safely when description is null or empty and no images exist", () => {
    const meta = buildProductMetadata(
      makeProduct({
        description: "   <p></p>  ",
        images: [],
        variants: [
          {
            id: "var-1",
            sku: "OX-BLK-42",
            color: "Black",
            size: "42",
            price: "1500000",
            isDefault: true,
            images: [],
            branchStock: [],
          },
        ],
      })
    );

    expect(meta.title).toBe("Classic Leather Oxford | ADF Sports");
    expect(meta.description).toBe("Beli Classic Leather Oxford di ADF Sports.");
    expect(meta.openGraph).toEqual({
      title: "Classic Leather Oxford | ADF Sports",
      description: "Beli Classic Leather Oxford di ADF Sports.",
      images: undefined,
    });
  });
});
