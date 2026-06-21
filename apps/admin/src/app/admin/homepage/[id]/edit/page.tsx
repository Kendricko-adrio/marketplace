"use client";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import HomepageSectionForm from "@/components/admin/homepage/HomepageSectionForm";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import Link from "next/link";

interface SectionData {
  id: string;
  type: string;
  title: string | null;
  subtitle: string | null;
  content: unknown;
  displayOrder: number;
  isActive: boolean;
  products?: { id: string; name: string; slug: string; displayOrder: number }[];
}

export default function EditHomepageSectionPage() {
  const params = useParams();
  const router = useRouter();
  const sectionId = params.id as string;

  const [section, setSection] = useState<SectionData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchSection = async () => {
      try {
        const res = await fetch(`/api/admin/homepage/${sectionId}`);
        const data = await res.json();
        if (data.success) {
          setSection(data.data);
        } else {
          setError(data.error || "Gagal memuat section");
        }
      } catch (err) {
        console.error("Error fetching section:", err);
        setError("Gagal memuat section");
      } finally {
        setLoading(false);
      }
    };
    fetchSection();
  }, [sectionId]);

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-4">
        <p className="text-destructive">{error}</p>
        <Button asChild>
          <Link href="/admin/homepage">Kembali</Link>
        </Button>
      </div>
    );
  }

  if (!section) return null;

  const handleSubmit = async (data: Record<string, unknown>) => {
    const res = await fetch(`/api/admin/homepage/${sectionId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    const result = await res.json();
    if (!result.success) {
      throw new Error(result.error || "Gagal memperbarui section");
    }
    router.push("/admin/homepage");
    router.refresh();
  };

  return (
    <div className="max-w-5xl space-y-6">
      <h2 className="text-2xl font-bold tracking-tight">Edit Section</h2>
      <HomepageSectionForm
        mode="edit"
        type={section.type}
        initialData={section}
        onSubmit={handleSubmit}
      />
    </div>
  );
}