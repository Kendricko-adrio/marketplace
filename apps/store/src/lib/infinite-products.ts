/**
 * Bangun URL relatif `/api/products` untuk permintaan halaman berikutnya pada
 * `InfiniteProductGrid`, agar fetch selalu memakai origin yang sama.
 */
export function buildLoadMoreProductsUrl(
  searchParams: { [key: string]: string | undefined },
  nextPage: number,
  pageSize: number
): string {
  const params = new URLSearchParams();
  Object.entries(searchParams).forEach(([key, value]) => {
    if (value && key !== "page") {
      params.set(key, value);
    }
  });
  params.set("page", String(nextPage));
  params.set("limit", String(pageSize));
  return `/api/products?${params.toString()}`;
}
