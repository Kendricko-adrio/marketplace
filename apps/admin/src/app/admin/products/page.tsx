"use client";
import { useCallback, useState, useEffect } from "react";
import Link from "next/link";
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
import { Badge } from "@/components/ui/badge";
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
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  // Debounce the search input so we only hit the DB after the user stops typing.
  useEffect(() => {
    const handle = setTimeout(() => {
      setDebouncedSearch(searchTerm.trim());
    }, 400);
    return () => clearTimeout(handle);
  }, [searchTerm]);

  // Reset to the first page whenever the (debounced) search term changes.
  useEffect(() => {
    setPage(1);
  }, [debouncedSearch]);

  const fetchProducts = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        limit: "10",
      });
      if (debouncedSearch) params.set("search", debouncedSearch);
      const res = await fetch(`/api/admin/products?${params.toString()}`);
      const data = await res.json();
      if (data.success) {
        setProducts(data.data);
        setTotalPages(data.pagination.totalPages);
      }
    } catch (error) {
      console.error("Error fetching products:", error);
    } finally {
      setLoading(false);
    }
  }, [page, debouncedSearch]);

  useEffect(() => {
    void fetchProducts();
  }, [fetchProducts]);

  const getStatusBadge = (status: string) => {
    const variants: Record<string, "default" | "destructive" | "secondary"> = {
      aktif: "default",
      habis: "destructive",
      arsip: "secondary",
    };
    return variants[status] || "secondary";
  };

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
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
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
                            <Link
                              href={`/products/${product.slug}`}
                              className="hover:text-primary"
                              target="_blank"
                            >
                              {product.name}
                            </Link>
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
                            <Badge
                              variant={getStatusBadge(product.status)}
                              className="capitalize"
                            >
                              {product.status}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right">
                            <Link href={`/admin/products/${product.id}`}>
                              <Button variant="ghost" className="h-8 gap-2">
                                <Eye className="h-4 w-4" /> Detail
                              </Button>
                            </Link>
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
                  onClick={() => setPage(page - 1)}
                >
                  Previous
                </Button>
                <span className="text-sm text-muted-foreground">
                  Page {page} of {totalPages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page >= totalPages}
                  onClick={() => setPage(page + 1)}
                >
                  Next
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
