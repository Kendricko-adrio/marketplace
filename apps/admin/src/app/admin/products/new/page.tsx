"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import ProductForm from "@/components/admin/ProductForm";
import type { ProductFormData } from "@/components/admin/ProductForm";
import { useAuth } from "@/providers/auth-provider";

export default function NewProductPage() {
  const router = useRouter();
  const { hasPermission, permissionsLoading } = useAuth();

  useEffect(() => {
    if (permissionsLoading) return;
    if (!hasPermission("products", "edit")) {
      router.push("/admin/products?error=forbidden");
    }
  }, [hasPermission, permissionsLoading, router]);

  async function handleSubmit(data: ProductFormData) {
    const res = await fetch("/api/admin/products", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });

    const result = await res.json();

    if (!result.success) {
      throw new Error(result.error || "Gagal membuat produk");
    }

    router.push("/admin/products");
  }

  if (permissionsLoading || !hasPermission("products", "edit")) {
    return null;
  }

  return (
    <div className="max-w-4xl space-y-6">
      <h2 className="text-2xl font-bold tracking-tight">Tambah Produk</h2>
      <ProductForm mode="create" onSubmit={handleSubmit} />
    </div>
  );
}
