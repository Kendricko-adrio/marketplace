"use client";
import { Suspense, useCallback, useState, useEffect } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Search, Loader2, Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { StatusBadge } from "@/components/ui/status-badge";
import { getStatusTone } from "@marketplace/ui/src/lib/status-presentation";
import { toStoreUrl } from "@/lib/store-url";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";

interface Product {
  id: string;
  name: string;
  slug: string;
  basePrice: string;
  status: string;
  variants: { id: string; price: string; isDefault: boolean }[];
  variantCount: number;
  totalStock: number;
  totalReserved: number;
  totalAvailable: number;
  categories: string[];
  images?: { url: string }[];
}

export default function AdminProductsPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      }
    >
      <ProductsList />
    </Suspense>
  );
}

function ProductsList() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const urlSearch = searchParams.get("search") ?? "";
  const page = Math.max(1, Number(searchParams.get("page") ?? 1) || 1);

  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState(urlSearch);
  const [totalPages, setTotalPages] = useState(1);

  useEffect(() => {
    setSearchTerm(urlSearch);
  }, [urlSearch]);

  // Debounce search input and sync to URL searchParams, resetting page to 1.
  useEffect(() => {
    const trimmed = searchTerm.trim();
    if (trimmed === urlSearch) return;
    const handle = setTimeout(() => {
      const next = new URLSearchParams(searchParams.toString());
      if (trimmed) next.set("search", trimmed);
      else next.delete("search");
      next.delete("page");
      const qs = next.toString();
      router.replace(qs ? `/admin/products?${qs}` : "/admin/products");
    }, 300);
    return () => clearTimeout(handle);
  }, [searchTerm, urlSearch, searchParams, router]);

  const setPageInUrl = (nextPage: number) => {
    const next = new URLSearchParams(searchParams.toString());
    if (nextPage > 1) next.set("page", String(nextPage));
    else next.delete("page");
    const qs = next.toString();
    router.replace(qs ? `/admin/products?${qs}` : "/admin/products");
  };

  const fetchProducts = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        page: String(page),
        limit: "10",
      });
      if (urlSearch) params.set("search", urlSearch);
      const res = await fetch(`/api/admin/products?${params.toString()}`);
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || "Gagal memuat daftar produk.");
      }
      setProducts(data.data);
      setTotalPages(Math.max(1, data.pagination.totalPages));
    } catch {
      setProducts([]);
      setError("Gagal memuat daftar produk.");
    } finally {
      setLoading(false);
    }
  }, [page, urlSearch]);

  useEffect(() => {
    void fetchProducts();
  }, [fetchProducts]);

  const filteredProducts = products;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <h2 className="text-2xl font-bold tracking-tight">Produk</h2>
        <p className="text-sm text-muted-foreground">
          Katalog disinkronkan dari Jubelio (source of truth). Buka detail untuk
          menyinkronkan ulang sebuah produk.
        </p>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle>Daftar Produk</CardTitle>
          <CardDescription>
            Kelola katalog produk, harga, dan stok inventaris Anda.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex gap-4 mb-4">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Cari nama produk..."
                className="pl-8"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
          </div>

          {loading ? (
            <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin text-primary" aria-hidden />
              <span>Memuat produk...</span>
            </div>
          ) : error ? (
            <div
              role="alert"
              className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive"
            >
              <span>{error}</span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void fetchProducts()}
              >
                Coba lagi
              </Button>
            </div>
          ) : (
            <>
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Nama Produk</TableHead>
                      <TableHead>Kategori</TableHead>
                      <TableHead className="text-right">Harga</TableHead>
                      <TableHead className="text-center">Varian</TableHead>
                      <TableHead className="text-right">Stok</TableHead>
                      <TableHead className="text-center">Status</TableHead>
                      <TableHead className="w-[80px] text-right">Aksi</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredProducts.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={7} className="h-24 text-center">
                          Tidak ada produk ditemukan.
                        </TableCell>
                      </TableRow>
                    ) : (
                      filteredProducts.map((product) => (
                        <TableRow key={product.id}>
                          <TableCell className="font-medium">
                            <a
                              href={toStoreUrl(`/products/${product.slug}`)}
                              className="hover:text-primary"
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              {product.name}
                            </a>
                          </TableCell>
                          <TableCell>
                            {product.categories.length > 0
                              ? product.categories.join(", ")
                              : "-"}
                          </TableCell>
                          <TableCell className="text-right">
                            Rp{" "}
                            {parseFloat(product.basePrice).toLocaleString(
                              "id-ID"
                            )}
                          </TableCell>
                          <TableCell className="text-center">
                            {product.variantCount}
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="font-medium">
                              {product.totalAvailable}
                            </div>
                            {product.totalReserved > 0 && (
                              <div className="text-xs text-muted-foreground">
                                {product.totalReserved} reserved
                              </div>
                            )}
                          </TableCell>
                          <TableCell className="text-center">
                            <StatusBadge
                              tone={getStatusTone("product", product.status)}
                              className="capitalize"
                            >
                              {product.status}
                            </StatusBadge>
                          </TableCell>
                          <TableCell className="text-right">
                            <Button asChild variant="ghost" className="h-8 gap-2">
                              <Link href={`/admin/products/${product.id}`}>
                                <Eye className="h-4 w-4" aria-hidden /> Detail
                              </Link>
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>

              <div className="flex items-center justify-end space-x-2 py-4">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page <= 1}
                  onClick={() => setPageInUrl(page - 1)}
                >
                  Sebelumnya
                </Button>
                <span className="text-sm text-muted-foreground">
                  Halaman {page} / {totalPages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page >= totalPages}
                  onClick={() => setPageInUrl(page + 1)}
                >
                  Berikutnya
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
