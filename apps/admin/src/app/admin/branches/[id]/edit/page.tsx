"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import BranchForm from "@/components/admin/BranchForm";
import type { BranchFormData } from "@/components/admin/BranchForm";

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

  const [initialData, setInitialData] = useState<BranchFormData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchBranch() {
      try {
        const res = await fetch(`/api/admin/branches/${branchId}`);
        const data = await res.json();

        if (!data.success) {
          setError(data.error || "Cabang tidak ditemukan");
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
        setError("Gagal memuat data cabang");
      } finally {
        setLoading(false);
      }
    }

    fetchBranch();
  }, [branchId]);

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