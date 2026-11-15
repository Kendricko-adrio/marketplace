"use client";
export default function StoreBannerSectionForm() {
  return (
    <div className="rounded-lg border bg-muted p-4 text-sm text-muted-foreground">
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
  );
}
