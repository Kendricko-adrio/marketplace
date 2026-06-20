"use client";
import { useRouter } from "next/navigation";
import BranchForm from "@/components/admin/BranchForm";
import type { BranchFormData } from "@/components/admin/BranchForm";

export default function NewBranchPage() {
  const router = useRouter();

  async function handleSubmit(data: BranchFormData) {
    const res = await fetch("/api/admin/branches", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    const result = await res.json();
    if (!result.success) {
      throw new Error(result.error || "Gagal membuat cabang");
    }
    router.push("/admin/branches");
  }

  return (
    <div className="max-w-4xl space-y-6">
      <h2 className="text-2xl font-bold tracking-tight">Tambah Cabang</h2>
      <BranchForm mode="create" onSubmit={handleSubmit} />
    </div>
  );
}