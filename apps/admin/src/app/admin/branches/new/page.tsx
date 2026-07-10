"use client";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import BranchForm from "@/components/admin/BranchForm";
import type { BranchFormData } from "@/components/admin/BranchForm";
import { useAuth } from "@/providers/auth-provider";

export default function NewBranchPage() {
  const router = useRouter();
  const { hasPermission, permissionsLoading } = useAuth();

  useEffect(() => {
    if (permissionsLoading) return;
    if (!hasPermission("branches", "edit")) {
      router.push("/admin/branches?error=forbidden");
    }
  }, [hasPermission, permissionsLoading, router]);

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

  if (permissionsLoading || !hasPermission("branches", "edit")) {
    return null;
  }

  return (
    <div className="max-w-4xl space-y-6">
      <h2 className="text-2xl font-bold tracking-tight">Tambah Cabang</h2>
      <BranchForm mode="create" onSubmit={handleSubmit} />
    </div>
  );
}
