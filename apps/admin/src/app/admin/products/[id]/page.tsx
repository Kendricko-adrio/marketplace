"use client";

import { useCallback, useState, useEffect } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

interface ApiVariant {
  id: string;
  sku: string;
  color: string | null;
  size: string | null;
  price: string;
  barcode: string | null;
  isDefault: boolean;
  jubelioItemId: number | null;
  images: { id: string; url: string; displayOrder: number }[];
}

interface ApiBranchStockRow {
  variantId: string;
  sku: string;
  size: string | null;
  color: string | null;
  stock: number;
  reservedStock: number;
  available: number;
}

interface ApiBranchStockGroup {
  id: string;
  name: string;
  code: string;
  city: string;
  status: string;
  rows: ApiBranchStockRow[];
}

interface ApiBranchStock {
  scope: "all" | "own";
  branches: ApiBranchStockGroup[];
}

interface ApiProduct {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  basePrice: string;
  status: string;
  thumbnail: string | null;
  images: { url: string; thumbnail: string; displayOrder: number }[] | null;
  jubelioItemGroupId: number | null;
  categories: { id: string; name: string; slug: string }[];
  variants: ApiVariant[];
  branchStock: ApiBranchStock;
}

export default function ProductDetailPage() {
  const params = useParams();
  const productId = params.id as string;

  const [product, setProduct] = useState<ApiProduct | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);

  const fetchProduct = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/products/${productId}`);
      const data = await res.json();
      if (data.success) {
        setProduct(data.data);
      } else {
        toast.error(data.error || "Produk tidak ditemukan");
      }
    } catch {
      toast.error("Gagal memuat produk");
    } finally {
      setLoading(false);
    }
  }, [productId]);

  useEffect(() => {
    void fetchProduct();
  }, [fetchProduct]);

  async function handleSync() {
    setSyncing(true);
    try {
      const res = await fetch(`/api/admin/products/${productId}/sync`, {
        method: "POST",
      });
      const data = await res.json();
      if (data.success) {
        toast.success(
          `Tersinkron dari Jubelio — ${data.data.variants} varian, ${data.data.stockRows} baris stok`
        );
        fetchProduct();
      } else {
        toast.error(data.error || "Gagal menyinkronkan");
      }
    } catch {
      toast.error("Gagal menyinkronkan dari Jubelio");
    } finally {
      setSyncing(false);
    }
  }

  const statusBadge: Record<string, "default" | "destructive" | "secondary"> = {
    aktif: "default",
    habis: "destructive",
    arsip: "secondary",
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!product) {
    return (
      <div className="space-y-4">
        <Link href="/admin/products">
          <Button variant="ghost" className="gap-2">
            <ArrowLeft className="h-4 w-4" /> Kembali
          </Button>
        </Link>
        <p className="text-muted-foreground">Produk tidak ditemukan.</p>
      </div>
    );
  }

  // Gallery: prefer product-level images (Jubelio catalog), fall back to the
  // first variant's images (legacy), then the thumbnail.
  const gallery =
    product.images && product.images.length > 0
      ? product.images.map((i) => i.url)
      : product.variants[0]?.images.map((i) => i.url) ??
        (product.thumbnail ? [product.thumbnail] : []);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <Link href="/admin/products">
          <Button variant="ghost" className="gap-2">
            <ArrowLeft className="h-4 w-4" /> Kembali
          </Button>
        </Link>
        {product.jubelioItemGroupId && (
          <Button onClick={handleSync} disabled={syncing} className="gap-2">
            {syncing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            Sync dari Jubelio
          </Button>
        )}
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        {/* Gallery */}
        <Card>
          <CardHeader>
            <CardTitle>Gambar</CardTitle>
            <CardDescription>Disediakan oleh Jubelio (hotlinked).</CardDescription>
          </CardHeader>
          <CardContent>
            {gallery.length > 0 ? (
              <div className="flex gap-3 overflow-x-auto pb-2">
                {gallery.map((url, i) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    key={i}
                    src={url}
                    alt={`${product.name} ${i + 1}`}
                    className="h-40 w-40 shrink-0 rounded-md border object-cover"
                  />
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Tidak ada gambar.</p>
            )}
          </CardContent>
        </Card>

        {/* Info */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-2">
              <CardTitle>{product.name}</CardTitle>
              <Badge variant={statusBadge[product.status] ?? "secondary"} className="capitalize">
                {product.status}
              </Badge>
            </div>
            <CardDescription>{product.slug}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div>
              <span className="text-muted-foreground">Harga (RRP): </span>
              <span className="font-medium">
                Rp {parseFloat(product.basePrice).toLocaleString("id-ID")}
              </span>
            </div>
            {product.jubelioItemGroupId && (
              <div>
                <span className="text-muted-foreground">Jubelio item_group_id: </span>
                <span className="font-mono">{product.jubelioItemGroupId}</span>
              </div>
            )}
            <div>
              <span className="text-muted-foreground">Kategori: </span>
              {product.categories.length > 0
                ? product.categories.map((c) => c.name).join(", ")
                : "-"}
            </div>
            {product.description && (
              <div className="pt-2">
                <span className="text-muted-foreground">Deskripsi:</span>
                <div
                  className="prose prose-sm mt-1 max-w-none text-foreground"
                  dangerouslySetInnerHTML={{ __html: product.description }}
                />
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Variants + per-branch stock, tabbed in one container */}
      <Card>
        <CardHeader>
          <CardTitle>Varian & Stok</CardTitle>
          <CardDescription>
            Varian produk dan stok per cabang. Stok bersumber dari Jubelio.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="variants">
            <TabsList>
              <TabsTrigger value="variants">
                Varian ({product.variants.length})
              </TabsTrigger>
              <TabsTrigger value="stock">Stok</TabsTrigger>
            </TabsList>

            {/* Varian — existing variant table */}
            <TabsContent value="variants">
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Default</TableHead>
                      <TableHead>SKU</TableHead>
                      <TableHead>Ukuran</TableHead>
                      <TableHead>Warna</TableHead>
                      <TableHead className="text-right">Harga</TableHead>
                      <TableHead>Barcode</TableHead>
                      <TableHead>Jubelio item_id</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {product.variants.map((v) => (
                      <TableRow key={v.id}>
                        <TableCell>{v.isDefault ? "✓" : ""}</TableCell>
                        <TableCell className="font-mono text-xs">{v.sku}</TableCell>
                        <TableCell>{v.size || "-"}</TableCell>
                        <TableCell>{v.color || "-"}</TableCell>
                        <TableCell className="text-right">
                          Rp {parseFloat(v.price).toLocaleString("id-ID")}
                        </TableCell>
                        <TableCell className="font-mono text-xs">{v.barcode || "-"}</TableCell>
                        <TableCell className="font-mono text-xs">
                          {v.jubelioItemId ?? "-"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </TabsContent>

            {/* Stok — per-variant stock grouped by branch, role-scoped */}
            <TabsContent value="stock">
              <p className="mb-4 text-sm text-muted-foreground">
                {product.branchStock.scope === "all"
                  ? "Menampilkan semua cabang."
                  : "Menampilkan cabang Anda saja."}
              </p>
              {product.branchStock.branches.length > 0 ? (
                <div className="space-y-6">
                  {product.branchStock.branches.map((branch) => (
                    <div key={branch.id} className="space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <h4 className="text-sm font-semibold">{branch.name}</h4>
                        <Badge
                          variant={
                            branch.status === "aktif" ? "default" : "secondary"
                          }
                          className="capitalize"
                        >
                          {branch.status}
                        </Badge>
                        <span className="text-xs text-muted-foreground">
                          {branch.city} · {branch.code}
                        </span>
                      </div>
                      {branch.rows.length > 0 ? (
                        <div className="rounded-md border">
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead>SKU</TableHead>
                                <TableHead>Ukuran</TableHead>
                                <TableHead>Warna</TableHead>
                                <TableHead className="text-right">Stok</TableHead>
                                <TableHead className="text-right">Reserved</TableHead>
                                <TableHead className="text-right">Tersedia</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {branch.rows.map((row) => (
                                <TableRow key={row.variantId}>
                                  <TableCell className="font-mono text-xs">
                                    {row.sku}
                                  </TableCell>
                                  <TableCell>{row.size || "-"}</TableCell>
                                  <TableCell>{row.color || "-"}</TableCell>
                                  <TableCell className="text-right">{row.stock}</TableCell>
                                  <TableCell className="text-right">
                                    {row.reservedStock}
                                  </TableCell>
                                  <TableCell className="text-right">
                                    {row.available}
                                  </TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </div>
                      ) : (
                        <p className="text-sm text-muted-foreground">
                          Belum ada data stok untuk produk ini di cabang ini.
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  {product.branchStock.scope === "all"
                    ? "Belum ada data stok untuk produk ini di cabang manapun."
                    : "Belum ada data stok untuk produk ini di cabang Anda."}
                </p>
              )}
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}
