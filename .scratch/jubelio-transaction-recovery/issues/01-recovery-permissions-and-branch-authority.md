# Permission Recovery dan Kewenangan Cabang

Label: wayfinder:grilling
Type: grilling
Status: open
Blocked by: none
Parent: [Recovery Transaksi Jubelio dan Tindak Lanjut Terpadu](../map.md)

## Pertanyaan

Bagaimana RBAC yang configurable mengizinkan recovery sales untuk HQ saat ini dan custom Role khusus di masa depan, tanpa memberikan hak tersebut kepada semua order editor atau mengubah hak fulfillment fisik?

Putuskan kontrak authorization, bukan implementasinya:

- Batas capability antara melihat order/blocker, melihat diagnostik transaksi, menjalankan GET recovery/reconciliation lokal, mengirim retry/melanjutkan operasi pertama kali, dan memberikan attestation atas bukti provider yang didukung.
- Bentuk permission catalog agar hak recovery dapat diberikan secara independen. Bandingkan capability/module recovery terpisah dengan penggunaan permission order; jangan menciptakan action key yang belum didukung tanpa mempertimbangkan catalog/schema existing.
- Prasyarat bagi Role khusus recovery untuk membuka detail order, serta perilaku workspace bersama ketika hak melihat recovery dan visibility Orders berbeda.
- Branch Scope yang dapat diberikan untuk tindakan recovery; apakah recovery terpusat yang berizin dapat bertindak lintas cabang sementara pickup/packing/handoff/booking fisik tetap dibatasi Home Branch.
- Grant awal HQ, tidak diberikannya grant recovery kepada Admin cabang, perlakuan terhadap custom Roles, dan bypass System Owner existing. Jangan diam-diam memberikan hak baru kepada setiap Role dengan `orders:edit`.
- Penerapan Current Policy, user inactive, grant yang dicabut, Authorization Ceiling, dan aturan cakupan view saat tindakan dijalankan.
- Apakah pembacaan aman/konfirmasi lokal dan remote writes membutuhkan capability berbeda atau satu capability mutasi dengan batas yang sesuai.

## Bukti dan batasan

- [Research: keputusan terbuka dan safety constraints](../../../plan/research/jubelio-transaction-recovery-admin.md#10-safety-constraints-for-a-future-design).
- [Glosarium administrasi](../../../CONTEXT.md): Role, Permission Grant, Current Policy, Branch Scope, Home Branch, dan Pickup Verification.
- [Dokumentasi RBAC](../../../docs/features/rbac.md).
- [Permission catalog](../../../packages/db/src/rbac/catalog.ts) dan [constraint grant](../../../packages/db/src/schema/rbac.ts).
- [Review API existing](../../../apps/admin/src/app/api/admin/reviews/sales-operations/route.ts) dan [guard mutasi delivery](../../../apps/admin/src/lib/delivery-follow-up.ts).

Framing yang disepakati: operator awal recovery adalah HQ, dan custom Roles di masa depan harus didukung melalui grants, bukan `role === 'hq'`. HQ-only berlaku untuk recovery sales; staff cabang tetap memiliki tindak lanjut operasional. Kontrak authorization rinci belum disetujui.

## Bukti penyelesaian

Catat matrix action/permission/scope yang disetujui pengguna, dengan contoh:

1. Order editor cabang dapat melihat order dan menangani follow-up operasional existing, tetapi tidak dapat memicu recovery sales.
2. HQ menginvestigasi order di luar Home Branch-nya: jelaskan apa yang dapat dibaca/diubah dan tindakan fisik apa yang tetap ditolak.
3. Custom Role khusus operasional transaksi mendapatkan recovery tanpa harus memperoleh hak order editing atau role administration lain yang tidak diperlukan.
4. Grant dicabut setelah detail dibuka tetapi sebelum retry ditekan: tidak ada efek pada order/provider, dan UI memberikan instruksi recovery yang sesuai hasil sebenarnya.

Jelaskan semantik rollout grant dan dependency minimum pada Orders-view. Detail migration dan implementasi catalog masuk ke spec/build berikutnya yang disetujui.

## Batas pekerjaan

Baca sumber/docs lokal dan lakukan interview dengan pengguna; hanya edit dokumen planning. Load `wayfinder`, `development-workflow`, `grilling`, dan `domain-modeling`. Claim sebelum bekerja. Tidak ada perubahan aplikasi/schema/auth, provider requests, eksekusi, atau delegation. Jangan menyelesaikan membership kasus, bukti retry, atau wireframes di ticket ini.

## Komentar

Dipublikasikan pada 2026-10-13 setelah pengguna menyetujui struktur dan dependencies lengkap sembilan tickets. Ticket tetap open/unclaimed; publikasi bukan jawaban keputusan atau approval implementasi.
