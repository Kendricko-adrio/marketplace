/**
 * Pagination + sort parsing shared by list endpoints (e.g. GET /api/products).
 * Extracted from the route so the parsing rules are unit-testable.
 */
export interface ListParams {
  page: number;
  limit: number;
  offset: number;
  sortBy: "price" | "createdAt";
  sortOrder: "asc" | "desc";
}

export function parseListParams(
  searchParams: URLSearchParams,
  defaultLimit = 12
): ListParams {
  const rawPage = parseInt(searchParams.get("page") || "1", 10);
  const rawLimit = parseInt(
    searchParams.get("limit") || String(defaultLimit),
    10
  );
  const page = Math.max(1, Number.isNaN(rawPage) ? 1 : rawPage);
  const limit = Math.max(
    1,
    Math.min(100, Number.isNaN(rawLimit) ? defaultLimit : rawLimit)
  );
  const sortBy = searchParams.get("sortBy") === "price" ? "price" : "createdAt";
  const sortOrder = searchParams.get("sortOrder") === "asc" ? "asc" : "desc";
  return { page, limit, offset: (page - 1) * limit, sortBy, sortOrder };
}
