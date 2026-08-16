"use client";

import { useState, useEffect } from "react";
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
}

export default function ProductDetailPage() {
  const params = useParams();
  const productId = params.id as string;

  const [product, setProduct] = useState<ApiProduct | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    fetchProduct();
  }, [productId]);

  async function fetchProduct() {
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
  }

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
              <div className="grid grid-cols-2 gap-3">
                {gallery.map((url, i) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    key={i}
                    src={url}
                    alt={`${product.name} ${i + 1}`}
                    className="aspect-square w-full rounded-md border object-cover"
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

      {/* Variants */}
      <Card>
        <CardHeader>
          <CardTitle>Varian ({product.variants.length})</CardTitle>
        </CardHeader>
        <CardContent>
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
        </CardContent>
      </Card>
    </div>
  );
}