"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
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
      <div>
        <Button asChild variant="ghost" size="sm" className="mb-2 -ml-2">
          <Link href="/admin/branches">
            <ChevronLeft className="h-4 w-4 mr-1" />
            Kembali ke daftar cabang
          </Link>
        </Button>
        <h2 className="text-2xl font-bold tracking-tight">Tambah Cabang</h2>
        <p className="text-muted-foreground text-sm mt-1">
          Lengkapi data cabang dan wilayah pengirimannya. Cabang berstatus
          aktif langsung tampil di storefront setelah disimpan.
        </p>
      </div>
      <BranchForm mode="create" onSubmit={handleSubmit} />
    </div>
  );
}
