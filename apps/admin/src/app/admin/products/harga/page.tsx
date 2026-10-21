import { PriceChangeClient } from "./price-change-client";
import { PriceChangeBulkClient } from "./price-change-bulk-client";

// =========================================================
// /admin/products/harga — manual Markdown per SKU + bulk lintas halaman
// =========================================================
// Flow: pilih produk → pilih SKU → stage (preview) → review → apply.
// Bulk: pilih SKU lintas halaman → stage 1..N row → review → apply bertahap
// (maksimum 25 row / 5 detik per request, resume manual selama pending).
// Review menampilkan base terbaru, harga efektif kini, target, selisih/arah dan
// peringatan; apply memakai source terbaru di dalam transaksi (tidak mewajibkan
// review ulang saat harga bergerak).
export default function PricesPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Harga SKU</h1>
        <p className="text-muted-foreground">
          Target Markdown disimpan per SKU dan hanya tampil sebagai harga coret
          selama lebih rendah dari harga sumber terbaru. Set dan restore selalu
          melewati stage → review → apply dan tercatat di histori immutable.
        </p>
      </div>
      <PriceChangeClient />
      <PriceChangeBulkClient />
    </div>
  );
}
