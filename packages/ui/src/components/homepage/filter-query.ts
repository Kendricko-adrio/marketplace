import type { ProductFilterConfig } from "./types";

/**
 * Build the /products query params shared by every product-filter surface
 * (storefront /products sidebar, homepage carousel "filter" mode, promo cards,
 * admin preview). Field names match the storefront /api/products format —
 * this is the single source of truth for ProductFilterConfig → query string,
 * so adding a filter field here propagates to all surfaces at once.
 */
export function buildProductFilterParams(
  filter: ProductFilterConfig
): URLSearchParams {
  const params = new URLSearchParams();
  if (filter.search) params.set("search", filter.search);
  if (filter.category) params.set("category", filter.category);
  if (filter.brand) params.set("brand", filter.brand);
  if (filter.minPrice) params.set("minPrice", filter.minPrice);
  if (filter.maxPrice) params.set("maxPrice", filter.maxPrice);
  if (filter.hasDiscount) params.set("hasDiscount", "true");
  if (filter.sortOrder) {
    const order = filter.sortOrder;
    if (order === "priceAsc") {
      params.set("sortOrder", "asc");
      params.set("sortBy", "price");
    } else if (order === "priceDesc") {
      params.set("sortOrder", "desc");
      params.set("sortBy", "price");
    } else {
      // newest
      params.set("sortOrder", "desc");
      params.set("sortBy", "createdAt");
    }
  }
  return params;
}

/** `/products?<query>` link for a filter config (e.g. promo card href). */
export function buildProductFilterQuery(filter: ProductFilterConfig): string {
  const qs = buildProductFilterParams(filter).toString();
  return qs ? `/products?${qs}` : "/products";
}

/**
 * Query string (no leading path) with `limit`/`page` appended, for admin
 * preview fetches against the storefront /api/products (via the admin proxy).
 */
export function buildStoreFilterQuery(
  filter: ProductFilterConfig,
  limit: number
): string {
  const params = buildProductFilterParams(filter);
  params.set("limit", String(limit));
  params.set("page", "1");
  return params.toString();
}