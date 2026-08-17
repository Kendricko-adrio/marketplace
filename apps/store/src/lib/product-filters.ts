/**
 * Filter state for the /products sidebar, mapped to the /api/products query
 * string. Kept as a pure helper so the URL-building logic is unit-testable
 * (the ProductFilters client component only collects state and pushes the
 * result).
 */
export interface ProductFilterState {
  search: string;
  category: string;
  brand: string;
  /** Branch id — filters to products with available stock at that branch. */
  branch: string;
  minPrice: string;
  maxPrice: string;
  sortBy: string;
  sortOrder: string;
}

export function buildProductsQuery(filters: ProductFilterState): string {
  const params = new URLSearchParams();

  if (filters.search) params.set("search", filters.search);
  if (filters.category) params.set("category", filters.category);
  if (filters.brand) params.set("brand", filters.brand);
  if (filters.branch) params.set("branch", filters.branch);
  if (filters.minPrice) params.set("minPrice", filters.minPrice);
  if (filters.maxPrice) params.set("maxPrice", filters.maxPrice);
  // Omit the API defaults so the URL stays clean.
  if (filters.sortBy && filters.sortBy !== "createdAt")
    params.set("sortBy", filters.sortBy);
  if (filters.sortOrder && filters.sortOrder !== "desc")
    params.set("sortOrder", filters.sortOrder);
  params.set("page", "1"); // Reset to first page on filter change

  return params.toString();
}

/**
 * Build the query params the `/products` page forwards to `GET /api/products`
 * on the initial SSR fetch. Extracted from the page so the forwarding rules
 * are unit-testable: every sidebar filter must reach the API, or that filter
 * silently breaks on first load (the `category` param was previously dropped
 * here, which made the category filter look broken even though the API and
 * combobox were correct).
 *
 * Unlike `buildProductsQuery` (client → page URL, which omits API defaults to
 * stay clean), this forwards every filter verbatim and pins the page size.
 */
export function buildProductsApiParams(
  searchParams: Record<string, string | undefined>,
  limit = 20
): URLSearchParams {
  const params = new URLSearchParams();

  if (searchParams.search) params.set("search", searchParams.search);
  if (searchParams.category) params.set("category", searchParams.category);
  if (searchParams.brand) params.set("brand", searchParams.brand);
  if (searchParams.branch) params.set("branch", searchParams.branch);
  if (searchParams.minPrice) params.set("minPrice", searchParams.minPrice);
  if (searchParams.maxPrice) params.set("maxPrice", searchParams.maxPrice);
  if (searchParams.hasDiscount)
    params.set("hasDiscount", searchParams.hasDiscount);
  if (searchParams.sortBy) params.set("sortBy", searchParams.sortBy);
  if (searchParams.sortOrder) params.set("sortOrder", searchParams.sortOrder);
  params.set("page", searchParams.page || "1");
  params.set("limit", String(limit));

  return params;
}
