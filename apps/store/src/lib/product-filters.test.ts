import { describe, it, expect } from "vitest";
import {
  buildProductsQuery,
  buildProductsApiParams,
  type ProductFilterState,
} from "./product-filters";

const empty: ProductFilterState = {
  search: "",
  category: "",
  brand: "",
  branch: "",
  minPrice: "",
  maxPrice: "",
  sortBy: "createdAt",
  sortOrder: "desc",
};

describe("buildProductsQuery", () => {
  it("returns only page=1 when no filter is set", () => {
    expect(buildProductsQuery(empty)).toBe("page=1");
  });

  it("includes the category slug when selected", () => {
    const q = buildProductsQuery({ ...empty, category: "sepatu" });
    expect(q).toContain("category=sepatu");
  });

  it("includes search, category, and brand together", () => {
    const q = buildProductsQuery({
      ...empty,
      search: "puma",
      category: "celana",
      brand: "puma",
    });
    expect(q).toContain("search=puma");
    expect(q).toContain("category=celana");
    expect(q).toContain("brand=puma");
  });

  it("omits empty optional filters", () => {
    const q = buildProductsQuery({ ...empty, search: "x" });
    expect(q).not.toContain("category=");
    expect(q).not.toContain("brand=");
    expect(q).not.toContain("branch=");
    expect(q).not.toContain("minPrice=");
    expect(q).not.toContain("maxPrice=");
  });

  it("includes the branch id when selected", () => {
    const q = buildProductsQuery({ ...empty, branch: "br-123" });
    expect(q).toContain("branch=br-123");
  });

  it("always resets to page 1", () => {
    expect(buildProductsQuery({ ...empty, search: "a" })).toContain("page=1");
  });

  it("encodes values with spaces and special characters", () => {
    const q = buildProductsQuery({ ...empty, search: "high top" });
    expect(q).toContain("search=high+top");
  });
});

describe("buildProductsApiParams", () => {
  // The /products page forwards the active URL filters to GET /api/products on
  // the initial SSR fetch. A dropped param here silently breaks that filter on
  // first load (the bug: category was missing → filter looked broken).
  it("forwards every sidebar filter, including category", () => {
    const params = buildProductsApiParams({
      search: "sepatu",
      category: "sneakers",
      brand: "nike",
      branch: "br-1",
      minPrice: "10000",
      maxPrice: "500000",
      hasDiscount: "true",
      sortBy: "price",
      sortOrder: "asc",
      page: "2",
    });
    expect(params.get("search")).toBe("sepatu");
    expect(params.get("category")).toBe("sneakers");
    expect(params.get("brand")).toBe("nike");
    expect(params.get("branch")).toBe("br-1");
    expect(params.get("minPrice")).toBe("10000");
    expect(params.get("maxPrice")).toBe("500000");
    expect(params.get("hasDiscount")).toBe("true");
    expect(params.get("sortBy")).toBe("price");
    expect(params.get("sortOrder")).toBe("asc");
    expect(params.get("page")).toBe("2");
  });

  it("forwards the category slug when only category is set", () => {
    const params = buildProductsApiParams({ category: "celana" });
    expect(params.get("category")).toBe("celana");
  });

  it("omits empty/undefined filters and defaults page to 1", () => {
    const params = buildProductsApiParams({});
    expect(params.get("category")).toBeNull();
    expect(params.get("brand")).toBeNull();
    expect(params.get("search")).toBeNull();
    expect(params.get("page")).toBe("1");
  });

  it("applies the page size limit", () => {
    expect(buildProductsApiParams({}, 20).get("limit")).toBe("20");
  });
});
