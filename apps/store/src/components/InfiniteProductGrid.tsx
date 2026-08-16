"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, ShoppingCart } from "lucide-react";
import ProductCard from "@/components/ProductCard";
import { Button } from "@/components/ui/button";
import Link from "next/link";

export interface Product {
  id: string;
  name: string;
  slug: string;
  price: string;
  basePrice: string;
  image: string | null;
  collection: string | null;
  gender: string | null;
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
}

const PAGE_SIZE = 20;

export default function InfiniteProductGrid({
  initialProducts,
  initialPagination,
  searchParams,
}: InfiniteProductGridProps) {
  const [products, setProducts] = useState<Product[]>(initialProducts);
  const [page, setPage] = useState<number>(initialPagination.page);
  const [total, setTotal] = useState<number>(initialPagination.total);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(
    initialPagination.page < initialPagination.totalPages
  );

  const sentinelRef = useRef<HTMLDivElement | null>(null);
  // Latest mutable refs so the IntersectionObserver callback reads current
  // state without being re-attached on every state change.
  const loadingRef = useRef(loading);
  const hasMoreRef = useRef(hasMore);
  const pageRef = useRef(page);
  loadingRef.current = loading;
  hasMoreRef.current = hasMore;
  pageRef.current = page;

  const loadMore = useCallback(async () => {
    const nextPage = pageRef.current + 1;
    const params = new URLSearchParams();
    Object.entries(searchParams).forEach(([key, value]) => {
      if (value && key !== "page") params.set(key, value);
    });
    params.set("page", String(nextPage));
    params.set("limit", String(PAGE_SIZE));

    setLoading(true);
    try {
      const res = await fetch(
        `${
          process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"
        }/api/products?${params.toString()}`,
        { cache: "no-store" }
      );
      const data: ProductsResponse = await res.json();
      if (data.success && Array.isArray(data.data)) {
        setProducts((prev) => [...prev, ...data.data]);
        setPage(data.pagination.page);
        setTotal(data.pagination.total);
        setHasMore(data.pagination.page < data.pagination.totalPages);
      } else {
        setHasMore(false);
      }
    } catch (error) {
      console.error("Error loading more products:", error);
      setHasMore(false);
    } finally {
      setLoading(false);
    }
  }, [searchParams]);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && hasMoreRef.current && !loadingRef.current) {
          loadMore();
        }
      },
      { rootMargin: "300px" }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [loadMore]);

  if (products.length === 0) {
    return (
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
    );
  }

  return (
    <div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
        {products.map((product) => {
          const price = parseFloat(product.price || product.basePrice);
          const basePrice = parseFloat(product.basePrice);
          const originalPrice =
            basePrice > price ? basePrice : undefined;
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