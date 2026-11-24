import { describe, expect, it } from "vitest";
import { buildLoadMoreProductsUrl } from "./infinite-products";

describe("buildLoadMoreProductsUrl", () => {
  it("builds a relative /api/products URL without host/origin", () => {
    const url = buildLoadMoreProductsUrl({ search: "sepatu", category: "sneakers" }, 2, 20);
    expect(url).toBe("/api/products?search=sepatu&category=sneakers&page=2&limit=20");
    expect(url.startsWith("/api/products?")).toBe(true);
    expect(url).not.toContain("http://");
    expect(url).not.toContain("https://");
  });

  it("overrides any existing page param and ignores undefined values", () => {
    const url = buildLoadMoreProductsUrl(
      { page: "1", brand: undefined, sort: "price_asc" },
      3,
      20
    );
    expect(url).toBe("/api/products?sort=price_asc&page=3&limit=20");
  });
});
