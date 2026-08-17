import { Suspense } from "react";
import InfiniteProductGrid, {
  type Product,
  type Pagination,
} from "@/components/InfiniteProductGrid";
import ProductFilters from "@/components/ProductFilters";
import { buildProductsApiParams } from "@/lib/product-filters";

async function getProducts(searchParams: {
  [key: string]: string | undefined;
}): Promise<{
  success: boolean;
  data: Product[];
  pagination: Pagination;
}> {
  // Forward every active sidebar filter to the API. Centralized in
  // buildProductsApiParams so a dropped param (the category filter was
  // previously missed here) is caught by unit tests.
  const params = buildProductsApiParams(searchParams, 20);

  try {
    const res = await fetch(
      `${
        process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"
      }/api/products?${params.toString()}`,
      { cache: "no-store" }
    );
    const data = await res.json();
    return data;
  } catch (error) {
    console.error("Error fetching products:", error);
    return {
      success: false,
      data: [],
      pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
    };
  }
}

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | undefined }>;
}) {
  const params = await searchParams;
  const productsData = await getProducts(params);
  const { data: products, pagination } = productsData;

  return (
    <div className="container mx-auto px-4 py-8 flex flex-col md:flex-row gap-8">
      <Suspense
        fallback={<div className="w-full md:w-64">Loading filters...</div>}
      >
        <ProductFilters />
      </Suspense>

      <div className="flex-1">
        <div className="mb-6 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 pb-4 border-b">
          <h1 className="text-2xl font-bold">
            {params.search
              ? `Hasil pencarian: "${params.search}"`
              : "Semua Produk"}
          </h1>
          <div className="flex items-center gap-4 w-full sm:w-auto">
            <span className="text-muted-foreground whitespace-nowrap">
              Menampilkan {products.length} dari {pagination.total} produk
            </span>
          </div>
        </div>

        {/* key resets the grid state whenever filters/sort change so the
            accumulated list and pagination start fresh from the new SSR page. */}
        <InfiniteProductGrid
          key={JSON.stringify(params)}
          initialProducts={products}
          initialPagination={pagination}
          searchParams={params}
        />
      </div>
    </div>
  );
}