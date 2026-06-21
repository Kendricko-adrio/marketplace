"use client";
import { useSearchParams } from "next/navigation";
import { useRouter } from "next/navigation";
import HomepageSectionForm from "@/components/admin/homepage/HomepageSectionForm";
import { Loader2 } from "lucide-react";
import { Suspense } from "react";

export default function NewHomepageSectionPage() {
  return (
    <Suspense
      fallback={
        <div className="flex justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      }
    >
      <NewSectionContent />
    </Suspense>
  );
}

function NewSectionContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const type = searchParams.get("type") || "";

  if (!type) {
    router.push("/admin/homepage");
    return null;
  }

  const handleSubmit = async (data: Record<string, unknown>) => {
    const res = await fetch("/api/admin/homepage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    const result = await res.json();
    if (!result.success) {
      throw new Error(result.error || "Gagal membuat section");
    }
    router.push("/admin/homepage");
    router.refresh();
  };

  return (
    <div className="max-w-5xl space-y-6">
      <h2 className="text-2xl font-bold tracking-tight">Tambah Section Baru</h2>
      <HomepageSectionForm mode="create" type={type} onSubmit={handleSubmit} />
    </div>
  );
}