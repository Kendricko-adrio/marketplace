"use client";
import { Label } from "@/components/ui/label";
import { StoreBannerSection } from "@marketplace/ui";
import type { HomepageSectionData } from "@marketplace/ui";

interface StoreBannerSectionFormProps {
  title: string;
  subtitle: string;
}

export default function StoreBannerSectionForm({
  title,
  subtitle,
}: StoreBannerSectionFormProps) {
  const previewSection: HomepageSectionData = {
    id: "preview",
    type: "store_banner",
    title: title || null,
    subtitle: subtitle || null,
    content: {},
    displayOrder: 0,
    isActive: true,
    branches: [],
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <div className="space-y-4">
        <div className="border rounded-lg p-4 bg-muted/30 text-sm text-muted-foreground">
          <p>
            Section ini menampilkan cabang toko yang aktif secara otomatis dari
            database. Tidak ada konfigurasi tambahan yang diperlukan.
          </p>
          <p className="mt-2">
            Pastikan status cabang diatur ke &quot;Aktif&quot; di halaman{" "}
            <a href="/admin/branches" className="text-primary underline">
              Kelola Cabang
            </a>{" "}
            agar muncul di homepage.
          </p>
        </div>
        <div className="space-y-2">
          <Label>Judul (opsional)</Label>
          <p className="text-xs text-muted-foreground">
            Judul dan subtitle diisi di field di atas form ini.
          </p>
        </div>
      </div>

      <div className="rounded-lg border bg-muted/30 p-4">
        <p className="text-xs text-muted-foreground mb-2">Preview</p>
        <div className="rounded-md overflow-hidden">
          <StoreBannerSection section={previewSection} />
        </div>
        <p className="text-xs text-muted-foreground mt-2 text-center">
          Cabang aktif akan muncul otomatis saat dilihat customer
        </p>
      </div>
    </div>
  );
}