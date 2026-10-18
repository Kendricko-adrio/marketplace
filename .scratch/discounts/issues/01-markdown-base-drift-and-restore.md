# Kebijakan Perubahan Base Price dan Restore Harga Coret

Label: wayfinder:grilling
Type: grilling
Status: resolved
Assignee: main-agent
Blocked by: none
Parent: [Wayfinder Desain Diskon](../map.md)

## Question

Apa yang harus terjadi pada harga coret tetap suatu SKU ketika base price Jubelio berubah, selisihnya tidak lagi menjadi diskon yang valid, atau admin mengembalikan harga ke base price?

Detail yang perlu diputuskan:

- Base price turun di bawah atau sama dengan harga tetap; bagaimana harga coret dan harga beli customer ditampilkan secara jujur.
- Kebutuhan review dan ketersediaan checkout dibandingkan fallback otomatis ke base price; jangan memilih default tanpa keputusan pemilik.
- Batas harga minimum jika disetujui, larangan harga nol, dan batas adjustment yang valid.
- Arti tindakan restore serta penanganan konflik versi base price atau adjustment terbaru.
- Snapshot order yang sudah dibuat dibandingkan checkout baru.

Contoh: base price Rp300.000, harga coret tetap Rp150.000, kemudian base price turun menjadi Rp120.000. Bahas juga base naik menjadi Rp400.000, admin mengganti harga coret menjadi Rp120.000, dan tindakan restore secara eksplisit.

Harga yang sama untuk seluruh cabang dan penyimpanan harga akhir tetap sudah disepakati; jangan menanyakan ulang keduanya.

## Referensi dan batasan

- [Keputusan awal dan research](../../../plan/research/discounts-coupons-promo-codes.md#5-recommended-product-markdown-behavior).
- [Research revision harga](../../../plan/research/discount-database-design.md#5-markdown-and-excel-tables).
- [Sync base price](../../../packages/db/src/jubelio-sync.ts#L795).
- [Istilah domain](../../../CONTEXT.md#product-pricing-and-promotions).

Base price tetap dikelola Jubelio. Adjustment harga produk bukan campaign atau inventory adjustment. Nominal order yang sudah dibuat tidak boleh dihitung ulang dari master data terbaru.

## Bukti penyelesaian

Tabel skenario yang dikonfirmasi pengguna: perubahan base price/harga coret, perilaku tampilan dan checkout customer, serta tindakan admin yang diperlukan. Batas kebijakan harus jelas. Simpan jawaban hanya di tiket ini; map cukup menerima ringkasan satu baris dengan link bernama.

## Batas pekerjaan

Claim tiket sebelum mulai. Muat `grilling`, `domain-modeling`, dan `development-workflow`. Hanya dokumen planning dan pemeriksaan lokal read-only; tidak ada implementasi, request provider, subagent, atau penyelesaian tiket HITL lain.

## Answer

- Saat base price ≤ target Markdown, gunakan base price tanpa harga tercoret/badge Markdown. Target tetap tersimpan dan otomatis berlaku lagi ketika base price > target.
- Fallback hanya melewati Markdown; Coupon/Manual Promo Code tetap dapat berlaku sesuai eligibility offer.
- Target Markdown baru/pengganti harus positif dan lebih rendah dari base price saat apply; tanpa floor tambahan atau batas persentase diskon.
- Hapus Markdown (Restore) adalah tindakan eksplisit admin untuk melepas target Markdown. Harga kemudian mengikuti base price Jubelio terbaru dan perubahan berikutnya; target lama tidak otomatis berlaku kembali. Riwayat adjustment tetap dipertahankan.
- Jika base price atau target Markdown berubah setelah form admin dibuka, proses tindakan menggunakan data terbaru tanpa mewajibkan review ulang. Simpan diterapkan hanya jika target tetap positif dan di bawah base price terbaru; jika tidak valid, tolak tindakan. Hapus melepas Markdown terbaru meskipun telah diubah admin lain.
- Nominal order yang sudah dibuat tetap memakai snapshot; perubahan master price hanya memengaruhi harga/checkout baru.

## Tabel skenario terkonfirmasi

| Skenario | Harga dan tampilan customer | Tindakan admin |
|---|---|---|
| Base Rp300.000, target Rp150.000 | Bayar Rp150.000; base Rp300.000 dicoret | Tidak diperlukan |
| Base turun Rp120.000, target Rp150.000 | Bayar Rp120.000; tanpa coretan/badge Markdown; kupon/kode tetap mengikuti eligibility | Tidak diperlukan; target disimpan |
| Base sama dengan target Rp150.000 | Bayar Rp150.000; tanpa coretan/badge Markdown | Tidak diperlukan; target disimpan |
| Setelah fallback, base naik Rp400.000 | Bayar Rp150.000; base Rp400.000 dicoret | Tidak diperlukan; target otomatis berlaku lagi |
| Admin mengganti target menjadi Rp120.000 saat base Rp400.000 | Bayar Rp120.000; base Rp400.000 dicoret; tidak menumpuk dengan target lama | Simpan target pengganti |
| Admin menghapus Markdown saat base Rp400.000 | Bayar Rp400.000 tanpa Markdown; berikutnya mengikuti base terbaru | Hapus Markdown; target lama tidak otomatis aktif lagi |
| Base/target berubah selama form terbuka | Simpan memakai base terbaru jika target masih valid; Hapus melepas Markdown terbaru | Tidak wajib review ulang, termasuk jika admin lain mengganti target |
| Target baru/pengganti nol, negatif, atau ≥ base terbaru | Perubahan ditolak; harga yang berlaku tidak ditimpa oleh input invalid | Perbaiki input |
| Master price berubah setelah order dibuat | Nominal order lama tidak berubah; checkout baru memakai kebijakan harga terbaru | Tidak menghitung ulang order lama |

Pemilik mengonfirmasi rangkuman lengkap dan tabel skenario melalui `ask_user_question` dengan memilih **Sesuai, selesaikan tiket**. Tiket keputusan resolved; konfirmasi ini bukan izin implementasi.

## Comments

Dipublikasikan setelah pemilik secara eksplisit menyetujui proposal lengkap map dengan 12 tiket. Publikasi tidak berarti tiket sudah dijawab atau di-claim.
