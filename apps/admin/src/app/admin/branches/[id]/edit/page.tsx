"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import BranchForm from "@/components/admin/BranchForm";
import type { BranchFormData } from "@/components/admin/BranchForm";
import { useAuth } from "@/providers/auth-provider";

interface ApiBranch {
  id: string;
  name: string;
  code: string;
  city: string;
  address: string;
  latitude: string | null;
  longitude: string | null;
  operatingHours: BranchFormData["operatingHours"];
  googleMapsUrl: string | null;
  status: string;
}

export default function EditBranchPage() {
  const params = useParams();
  const router = useRouter();
  const branchId = params.id as string;
  const { hasPermission, permissionsLoading } = useAuth();

  const [initialData, setInitialData] = useState<BranchFormData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (permissionsLoading) return;
    if (!hasPermission("branches", "edit")) {
      router.push("/admin/branches?error=forbidden");
      return;
    }

    async function fetchBranch() {
      try {
        const res = await fetch(`/api/admin/branches/${branchId}`);
        const data = await res.json();

        if (!data.success) {
          const msg = data.error || "Cabang tidak ditemukan";
          setError(msg);
          toast.error(msg);
          return;
        }

        const branch: ApiBranch = data.data;

        setInitialData({
          name: branch.name,
          code: branch.code,
          city: branch.city,
          address: branch.address,
          latitude: branch.latitude ?? "",
          longitude: branch.longitude ?? "",
          operatingHours: branch.operatingHours ?? {},
          googleMapsUrl: branch.googleMapsUrl ?? "",
          status: branch.status as "aktif" | "nonaktif",
        });
      } catch {
        const msg = "Gagal memuat data cabang";
        setError(msg);
        toast.error(msg);
      } finally {
        setLoading(false);
      }
    }

    fetchBranch();
  }, [branchId, hasPermission, permissionsLoading, router]);

  async function handleSubmit(data: BranchFormData) {
    const res = await fetch(`/api/admin/branches/${branchId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });

    const result = await res.json();

    if (!result.success) {
      throw new Error(result.error || "Gagal mengupdate cabang");
    }

    router.push("/admin/branches");
  }

  if (permissionsLoading || !hasPermission("branches", "edit")) {
    return null;
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
          onClick={() => router.push("/admin/branches")}
          className="mt-4 text-sm text-primary hover:underline"
        >
          Kembali ke daftar cabang
        </button>
      </div>
    );
  }

  if (!initialData) return null;

  return (
    <div className="max-w-4xl space-y-6">
      <h2 className="text-2xl font-bold tracking-tight">Edit Cabang</h2>
      <BranchForm mode="edit" initialData={initialData} onSubmit={handleSubmit} />
    </div>
  );
}
