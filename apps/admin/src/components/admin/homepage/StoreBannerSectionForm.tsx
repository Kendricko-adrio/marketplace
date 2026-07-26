"use client";
import { Label } from "@/components/ui/label";

export default function StoreBannerSectionForm() {
  return (
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
  );
}