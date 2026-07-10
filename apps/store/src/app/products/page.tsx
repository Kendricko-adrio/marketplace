import { Suspense } from "react";
import ProductCard from "@/components/ProductCard";
import ProductFilters from "@/components/ProductFilters";
import { Button } from "@/components/ui/button";
import Link from "next/link";

interface Product {
  id: string;
  name: string;
  slug: string;
  price: string;
  basePrice: string;
  rating: string | null;
  sold: number;
  image: string | null;
  isFlashSale?: boolean;
  flashSalePrice?: string | null;
}

interface ProductsResponse {
  success: boolean;
  data: Product[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

async function getProducts(searchParams: {
  [key: string]: string | undefined;
}): Promise<ProductsResponse> {
  const params = new URLSearchParams();

  if (searchParams.search) params.set("search", searchParams.search);
  if (searchParams.category) params.set("category", searchParams.category);
  if (searchParams.minPrice) params.set("minPrice", searchParams.minPrice);
  if (searchParams.maxPrice) params.set("maxPrice", searchParams.maxPrice);
  if (searchParams.sortBy) params.set("sortBy", searchParams.sortBy);
  if (searchParams.sortOrder) params.set("sortOrder", searchParams.sortOrder);
  params.set("page", searchParams.page || "1");
  params.set("limit", "12");

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
      pagination: { page: 1, limit: 12, total: 0, totalPages: 0 },
    };
  }
}

// Pagination component
function Pagination({
  currentPage,
  totalPages,
  searchParams,
}: {
  currentPage: number;
  totalPages: number;
  searchParams: { [key: string]: string | undefined };
}) {
  if (totalPages <= 1) return null;

  const createPageUrl = (page: number) => {
    const params = new URLSearchParams();
    Object.entries(searchParams).forEach(([key, value]) => {
      if (value && key !== "page") params.set(key, value);
    });
    params.set("page", page.toString());
    return `/products?${params.toString()}`;
  };

  const pages = [];
  const maxVisiblePages = 5;
  let startPage = Math.max(1, currentPage - Math.floor(maxVisiblePages / 2));
  const endPage = Math.min(totalPages, startPage + maxVisiblePages - 1);

  if (endPage - startPage + 1 < maxVisiblePages) {
    startPage = Math.max(1, endPage - maxVisiblePages + 1);
  }

  for (let i = startPage; i <= endPage; i++) {
    pages.push(i);
  }

  return (
    <div className="mt-12 flex justify-center gap-2">
      {currentPage > 1 && (
        <Link href={createPageUrl(currentPage - 1)}>
          <Button variant="outline" className="w-10 h-10 p-0">
            &lt;
          </Button>
        </Link>
      )}

      {startPage > 1 && (
        <>
          <Link href={createPageUrl(1)}>
            <Button variant="outline" className="w-10 h-10 p-0">
              1
            </Button>
          </Link>
          {startPage > 2 && (
            <Button
              variant="ghost"
              className="w-10 h-10 p-0 cursor-default"
              disabled
            >
              ...
            </Button>
          )}
        </>
      )}

      {pages.map((page) => (
        <Link key={page} href={createPageUrl(page)}>
          <Button
            variant={page === currentPage ? "default" : "outline"}
            className="w-10 h-10 p-0"
          >
            {page}
          </Button>
        </Link>
      ))}

      {endPage < totalPages && (
        <>
          {endPage < totalPages - 1 && (
            <Button
              variant="ghost"
              className="w-10 h-10 p-0 cursor-default"
              disabled
            >
              ...
            </Button>
          )}
          <Link href={createPageUrl(totalPages)}>
            <Button variant="outline" className="w-10 h-10 p-0">
              {totalPages}
            </Button>
          </Link>
        </>
      )}

      {currentPage < totalPages && (
        <Link href={createPageUrl(currentPage + 1)}>
          <Button variant="outline" className="w-10 h-10 p-0">
            &gt;
          </Button>
        </Link>
      )}
    </div>
  );
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
              : params.category
              ? `Kategori: ${params.category}`
              : "Semua Produk"}
          </h1>
          <div className="flex items-center gap-4 w-full sm:w-auto">
            <span className="text-muted-foreground whitespace-nowrap">
              Menampilkan {products.length} dari {pagination.total} produk
            </span>
          </div>
        </div>

        {products.length === 0 ? (
          <div className="text-center py-16">
            <p className="text-muted-foreground text-lg">
              Tidak ada produk yang ditemukan.
            </p>
            <Link href="/products">
              <Button variant="outline" className="mt-4">
                Lihat Semua Produk
              </Button>
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {products.map((product) => (
              <ProductCard
                key={product.id}
                id={product.id}
                title={product.name}
                price={parseFloat(product.price || product.basePrice)}
                originalPrice={
                  product.isFlashSale && product.flashSalePrice
                    ? parseFloat(product.basePrice)
                    : undefined
                }
                image={product.image || ""}
                isFlashSale={product.isFlashSale}
              />
            ))}
          </div>
        )}

        <Pagination
          currentPage={pagination.page}
          totalPages={pagination.totalPages}
          searchParams={params}
        />
      </div>
    </div>
  );
}
