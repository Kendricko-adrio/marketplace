"use client";

import { useRouter } from "next/navigation";
import ProductForm from "@/components/admin/ProductForm";
import type { ProductFormData } from "@/components/admin/ProductForm";

export default function NewProductPage() {
  const router = useRouter();

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

  return (
    <div className="max-w-4xl space-y-6">
      <h2 className="text-2xl font-bold tracking-tight">Tambah Produk</h2>
      <ProductForm mode="create" onSubmit={handleSubmit} />
    </div>
  );
}
