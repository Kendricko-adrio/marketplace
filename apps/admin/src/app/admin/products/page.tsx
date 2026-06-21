"use client";
import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Edit,
  Trash2,
  Plus,
  MoreHorizontal,
  Search,
  Loader2,
} from "lucide-react";
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
  categories: string[];
  images?: { url: string }[];
}

export default function AdminProductsPage() {
  const router = useRouter();
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  useEffect(() => {
    fetchProducts();
  }, [page]);

  async function fetchProducts() {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/products?page=${page}&limit=10`);
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
  }

  const getStatusBadge = (status: string) => {
    const variants: Record<string, "default" | "destructive" | "secondary"> = {
      aktif: "default",
      habis: "destructive",
      arsip: "secondary",
    };
    return variants[status] || "secondary";
  };

  const filteredProducts = products.filter((product) => {
    if (!searchTerm) return true;
    return product.name.toLowerCase().includes(searchTerm.toLowerCase());
  });

  async function handleDelete(id: string, name: string) {
    const confirmed = window.confirm(
      `Yakin ingin menghapus produk "${name}"? Tindakan ini tidak dapat dibatalkan.`
    );
    if (!confirmed) return;

    try {
      const res = await fetch(`/api/admin/products/${id}`, { method: "DELETE" });
      const data = await res.json();
      if (data.success) {
        fetchProducts();
      } else {
        alert(data.error || "Gagal menghapus produk");
      }
    } catch {
      alert("Gagal menghapus produk");
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <h2 className="text-2xl font-bold tracking-tight">Produk</h2>
        <Link href="/admin/products/new">
          <Button className="gap-2">
            <Plus className="h-4 w-4" /> Tambah Produk
          </Button>
        </Link>
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
                      <TableHead className="text-right">Total Stok</TableHead>
                      <TableHead className="text-center">Status</TableHead>
                      <TableHead className="w-[80px] text-right">
                        Aksi
                      </TableHead>
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
                              href={`/products/${product.id}`}
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
                            {product.totalStock}
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
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" className="h-8 w-8 p-0">
                                  <MoreHorizontal className="h-4 w-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuLabel>Aksi</DropdownMenuLabel>
                                <DropdownMenuItem
                                  className="cursor-pointer gap-2"
                                  onSelect={() =>
                                    router.push(
                                      `/admin/products/${product.id}/edit`
                                    )
                                  }
                                >
                                  <Edit className="h-4 w-4" /> Edit
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                  className="cursor-pointer gap-2 text-destructive focus:text-destructive focus:bg-destructive/10"
                                  onSelect={() =>
                                    handleDelete(product.id, product.name)
                                  }
                                >
                                  <Trash2 className="h-4 w-4" /> Hapus
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
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
