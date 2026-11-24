"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, ShoppingCart } from "lucide-react";
import ProductCard from "@/components/ProductCard";
import { Button } from "@/components/ui/button";
import { buildLoadMoreProductsUrl } from "@/lib/infinite-products";
import Link from "next/link";

export interface Product {
  id: string;
  name: string;
  slug: string;
  price: string;
  /** Source (Jubelio base) price of the SAME variant; present even on fallback. */
  sourcePrice?: string | null;
  /** True only when this variant's Markdown is effective (target < source). */
  markdownActive?: boolean;
  /** Legacy group RRP — no longer used for the card strikethrough. */
  basePrice: string;
  image: string | null;
  collection: string | null;
  gender: string | null;
  /** True bila minimal satu cabang aktif/mapped memiliki sellable > 0. */
  hasStock: boolean;
  /** Last-known availability only; checkout always confirms live. */
  lastKnownInStock?: boolean;
}

export interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

interface ProductsResponse {
  success: boolean;
  data: Product[];
  pagination: Pagination;
}

interface InfiniteProductGridProps {
  initialProducts: Product[];
  initialPagination: Pagination;
  /** Active URL filters — used to build the "load more" request. */
  searchParams: { [key: string]: string | undefined };
  /** Judul halaman katalog yang ditampilkan sejajar dengan counter live. */
  heading?: string;
}

const PAGE_SIZE = 20;

export default function InfiniteProductGrid({
  initialProducts,
  initialPagination,
  searchParams,
  heading = "Semua Produk",
}: InfiniteProductGridProps) {
  const [products, setProducts] = useState<Product[]>(initialProducts);
  const [page, setPage] = useState<number>(initialPagination.page);
  const [total, setTotal] = useState<number>(initialPagination.total);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(
    initialPagination.page < initialPagination.totalPages
  );

  const sentinelRef = useRef<HTMLDivElement | null>(null);
  // Latest mutable refs so the IntersectionObserver callback reads current
  // state without being re-attached on every state change.
  const loadingRef = useRef(loading);
  const hasMoreRef = useRef(hasMore);
  const pageRef = useRef(page);
  const loadErrorRef = useRef(loadError);
  loadingRef.current = loading;
  hasMoreRef.current = hasMore;
  pageRef.current = page;
  loadErrorRef.current = loadError;

  const loadMore = useCallback(async () => {
    const nextPage = pageRef.current + 1;
    const url = buildLoadMoreProductsUrl(searchParams, nextPage, PAGE_SIZE);

    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) {
        setLoadError("Gagal memuat produk berikutnya.");
        return;
      }
      const data: ProductsResponse = await res.json();
      if (data.success && Array.isArray(data.data)) {
        setProducts((prev) => [...prev, ...data.data]);
        setPage(data.pagination.page);
        setTotal(data.pagination.total);
        setHasMore(data.pagination.page < data.pagination.totalPages);
      } else {
        setLoadError("Gagal memuat produk berikutnya.");
      }
    } catch (error) {
      console.error("Error loading more products:", error);
      setLoadError("Gagal memuat produk berikutnya.");
    } finally {
      setLoading(false);
    }
  }, [searchParams]);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (
          entries[0]?.isIntersecting &&
          hasMoreRef.current &&
          !loadingRef.current &&
          !loadErrorRef.current
        ) {
          loadMore();
        }
      },
      { rootMargin: "300px" }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [loadMore]);

  const headerBlock = (
    <div className="mb-6 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 pb-4 border-b">
      <h1 className="text-2xl font-bold">{heading}</h1>
      <div className="flex items-center gap-4 w-full sm:w-auto">
        <span className="text-muted-foreground whitespace-nowrap">
          Menampilkan {products.length} dari {total} produk
        </span>
      </div>
    </div>
  );

  if (products.length === 0) {
    return (
      <div>
        {headerBlock}
        <div className="text-center py-16">
          <p className="text-muted-foreground text-lg">
            Tidak ada produk yang ditemukan.
          </p>
          <Button asChild variant="outline" className="mt-4">
            <Link href="/products">Lihat Semua Produk</Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div>
      {headerBlock}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
        {products.map((product) => {
          const price = parseFloat(product.price || product.basePrice);
          // Only an ACTIVE Markdown shows a strikethrough, and the original is
          // the same variant's source price — never the group RRP.
          const sourcePrice = product.sourcePrice
            ? parseFloat(product.sourcePrice)
            : undefined;
          const originalPrice =
            product.markdownActive && sourcePrice && sourcePrice > price
              ? sourcePrice
              : undefined;
          return (
            <ProductCard
              key={product.id}
              slug={product.slug}
              title={product.name}
              price={price}
              originalPrice={originalPrice}
              image={product.image || ""}
              gender={product.gender ?? undefined}
              collection={product.collection ?? undefined}
              outOfStock={!product.hasStock}
            />
          );
        })}
      </div>

      {/* Sentinel + footer states */}
      <div ref={sentinelRef} className="mt-10 min-h-[1px]" />

      {loading && (
        <div className="mt-8 flex items-center justify-center gap-2 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span>Memuat lebih banyak produk...</span>
        </div>
      )}

      {loadError && !loading && (
        <div
          role="alert"
          className="mt-8 flex flex-col items-center justify-center gap-3 text-center"
        >
          <p className="text-sm text-destructive">{loadError}</p>
          <Button variant="outline" onClick={loadMore}>
            Coba muat lagi
          </Button>
        </div>
      )}

      {!hasMore && !loading && products.length > 0 && (
        <div className="mt-8 flex items-center justify-center gap-2 text-muted-foreground text-sm">
          <ShoppingCart className="h-4 w-4" />
          <span>
            Semua {products.length} dari {total} produk telah ditampilkan
          </span>
        </div>
      )}
    </div>
  );
}