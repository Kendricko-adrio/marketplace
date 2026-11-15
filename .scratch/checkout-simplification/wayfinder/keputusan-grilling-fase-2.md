# Keputusan sesi grilling fase 2

Acuan: [draft fase 2](../plan/audit-findings-phase-2.md). User mengonfirmasi rangkuman sesi dengan pilihan **“Sesuai (Recommended)”**. Catatan ini merekam keputusan, bukan spesifikasi implementasi atau approval plan lengkap.

## Scope yang disepakati

Pada sesi awal: P0/P1 dahulu; P2 dan persistensi draft ditunda. Pada sesi lanjutan P2, user memilih memasukkan P2 yang dirinci di addendum di bawah dan mengonfirmasi “Sesuai (Recommended)”. **Scope terkini: P0/P1 + P2 pilihan; persistensi draft tetap ditunda.** Tidak mengubah aturan pembayaran, harga, pajak, stock, atau membuat transaksi otomatis.

## Keputusan

| Topik | Keputusan user |
|---|---|
| D01 — hasil pembayaran | `/checkout/result` membaca `order_id` dari redirect, lalu GET detail pesanan owner-scoped. Status mengikuti database, bukan query status Midtrans. Lunas/pending/gagal sesuai data; status asing tetap belum dapat dipastikan. Lunas dengan fulfillment tertahan dijelaskan terpisah. |
| D01 — fallback | Sesi habis: login lalu kembali. Koneksi gagal: Coba lagi. ID hilang/tidak ditemukan: Lihat Pesanan Saya. Akses dibatasi: pesan pembatasan tanpa membuka detail. |
| D01 — detail mobile | Status → pembayaran/total/aksi → alamat atau pickup → barang → bantuan. Tracking kosong ditunda, alamat tetap tersedia. Desktop mempertahankan pola dua kolom. |
| D02 — recovery | Feedback inline utama dekat aksi: memeriksa, belum berubah, diperbarui, atau gagal diperiksa dengan retry. Tidak menduplikasi toast identik; toast hanya jika tidak tersedia inline. Data/isian/request yang sama dipertahankan, tanpa membuat transaksi baru. |
| D03 — WhatsApp | Jika pemeriksaan membuktikan gangguan, ganti tombol mengambang dengan link bantuan biasa pada checkout/detail mobile. Halaman lain tetap. |
| D04 — gagal/batal/unknown | Gagal/batal mengutamakan Lihat Pesanan Saya; Beli lagi per barang tetap tersedia tanpa order otomatis. Status belum pasti mengutamakan Periksa status. Tidak menjanjikan refund yang belum diketahui. Arsip kode completed dan perubahan instruksi completed sebagai P2 ditunda. |
| D05 — draft | Persistensi ditunda; belum ada izin menyimpan data ke browser atau menetapkan TTL. |
| D06 — keterbacaan | User menyerahkan pengaturan teknis kepada agent. Disepakati perbaikan tulisan pucat terbatas pada bagian checkout yang bermasalah, mengikuti desain existing; tidak mengganti tema/admin. Hit area P2 ditunda. |
| D07 — kebijakan | P2 ditunda bersama seluruh P2 lainnya. |

## Sisa P1 yang dikonfirmasi pada penutup sesi

- Tampilkan estimasi pengiriman existing di review.
- Perjelas pilihan alamat dan batasi dropdown agar terbaca pada layar kecil.
- Setelah tujuan berubah, pertahankan invalidasi quote/layanan dan minta customer memilih layanan lagi.
- Promo gugur: jelaskan alasan, total sebelum/sesudah, dan persetujuan lanjut tanpa promo; pertahankan acknowledgement server.
- Loading terlihat, fokus kembali setelah modal ditutup, layout dapat dipakai pada layar kecil dan pembesaran teks.

## Addendum sesi P2 — keputusan terkini

Bagian ini menggantikan penundaan P2 pada keputusan sesi awal di atas; keputusan P0/P1 tetap berlaku.

| Topik | Keputusan user |
|---|---|
| W05 — total turun | Tampilkan selisih inline dekat total; contoh Rp144.300 → Rp138.750: “Total turun Rp5.550 menjadi Rp138.750”. Tanpa dialog baru atau toast yang mengulang pesan sama. |
| D04/W10 — pickup completed | Hilangkan instruksi pickup aktif. Kode tersedia sebagai arsip tertutup melalui “Lihat kode pengambilan”, dengan label arsip dan status selesai. |
| D06/W09 — target dan keterbacaan | Perluas area klik tombol tutup dialog dan ikon sosial footer tanpa membesarkan ikon berlebihan. Perbaiki teks pucat yang tercatat pada footer, cart, dan menu akun. Pertahankan desain existing dan periksa dampak komponen bersama. Perubahan tampilan admin tidak otomatis masuk scope. Perbaikan lokal P1 tetap berlaku; ini bukan izin mengganti token global tanpa batas. |
| D07/W12 — kebijakan | Link “Syarat & ketentuan” dekat checkbox membuka tab baru dengan penanda yang sesuai; tidak toggle persetujuan atau kehilangan isian checkout. Agent memeriksa halaman existing terlebih dahulu. Jika tidak tersedia/tidak memadai, laporkan sebagai blocker; tidak membuat isi legal baru. |
| D05/W11 — draft | Persistensi draft tetap ditunda. Membuka kebijakan di tab baru tidak berarti menambahkan penyimpanan draft. |

User mengonfirmasi shared understanding sesi P2. Keputusan ini menjadi bahan revisi draft bersama P0/P1, bukan approval plan lengkap atau izin coding.

## Fakta yang diverifikasi selama sesi

- Kode mengirim `transaction_details.order_id` ke Midtrans: `apps/store/src/lib/midtrans.ts`.
- Webhook memeriksa notifikasi, order dan nominal, serta memverifikasi status ke Midtrans: `apps/store/src/app/api/webhooks/midtrans/route.ts`.
- Halaman hasil existing membaca query `order_id`, tetapi belum fetch status: `apps/store/src/app/checkout/result/page.tsx`.
- API detail membatasi ID pesanan sekaligus pemilik: `apps/store/src/app/api/orders/[id]/route.ts`.
- Context7 `/websites/midtrans`: [Snap advanced feature](https://docs.midtrans.com/docs/snap-advanced-feature) mengonfirmasi query redirect otomatis `order_id`, `status_code`, `transaction_status`, serta override `callbacks.finish`. [Payment settings](https://docs.midtrans.com/docs/payment-settings) menjelaskan pengaturan tujuan redirect Snap.
- Konfigurasi dashboard Midtrans dan redirect transaksi aktual belum diverifikasi. Keberadaan query pada redirect aktual tidak diklaim sudah diuji.

## Batas dan langkah berikutnya

User mengonfirmasi shared understanding dan penggunaan keputusan ini untuk merevisi draft. Plan tetap Draft. Belum ada izin implementasi, ticket breakdown, perubahan DB/provider, commit, push, atau deployment.

Saat menyintesis revisi plan, muat `to-spec`; finalisasi copy/state/kontrak teknis dan discovery yang masih dibutuhkan, tandai P2 sebagai deferred secara eksplisit, lalu minta approval versi lengkap. Tidak ada aplikasi, tests, atau konfigurasi Midtrans yang diubah/dijalankan dalam sesi ini.
