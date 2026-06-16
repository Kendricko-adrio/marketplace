"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import ProductForm from "@/components/admin/ProductForm";
import type { ProductFormData } from "@/components/admin/ProductForm";

interface ApiVariant {
  id: string;
  color: string | null;
  size: string | null;
  price: string;
  stock: number;
  sku: string;
  isDefault: boolean;
  images: { id: string; url: string; displayOrder: number }[];
}

interface ApiProduct {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  basePrice: string;
  status: string;
  categories: { id: string; name: string; slug: string }[];
  variants: ApiVariant[];
}

export default function EditProductPage() {
  const params = useParams();
  const router = useRouter();
  const productId = params.id as string;

  const [initialData, setInitialData] = useState<ProductFormData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchProduct() {
      try {
        const res = await fetch(`/api/admin/products/${productId}`);
        const data = await res.json();

        if (!data.success) {
          setError(data.error || "Produk tidak ditemukan");
          return;
        }

        const product: ApiProduct = data.data;

        setInitialData({
          name: product.name,
          slug: product.slug,
          description: product.description ?? "",
          basePrice: product.basePrice,
          status: product.status as "aktif" | "habis" | "arsip",
          categoryIds: product.categories.map((c) => c.id),
          variants: product.variants.map((v) => ({
            id: v.id,
            color: v.color ?? "",
            size: v.size ?? "",
            price: v.price,
            stock: v.stock,
            sku: v.sku,
            isDefault: v.isDefault,
            images: v.images.map((img) => ({
              id: img.id,
              url: img.url,
              displayOrder: img.displayOrder,
            })),
          })),
        });
      } catch {
        setError("Gagal memuat data produk");
      } finally {
        setLoading(false);
      }
    }

    fetchProduct();
  }, [productId]);

  async function handleSubmit(data: ProductFormData) {
    const res = await fetch(`/api/admin/products/${productId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });

    const result = await res.json();

    if (!result.success) {
      throw new Error(result.error || "Gagal mengupdate produk");
    }

    router.push("/admin/products");
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-16">
        <p className="text-destructive">{error}</p>
        <button
          onClick={() => router.push("/admin/products")}
          className="mt-4 text-sm text-primary hover:underline"
        >
          Kembali ke daftar produk
        </button>
      </div>
    );
  }

  if (!initialData) return null;

  return (
    <div className="max-w-4xl space-y-6">
      <h2 className="text-2xl font-bold tracking-tight">Edit Produk</h2>
      <ProductForm
        mode="edit"
        initialData={initialData}
        onSubmit={handleSubmit}
      />
    </div>
  );
}
