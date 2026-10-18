# Kontrak Bulk Adjustment dan Partial Import

Label: wayfinder:grilling
Type: grilling
Status: resolved
Assignee: main-agent
Blocked by: 01
Parent: [Wayfinder Desain Diskon](../map.md)

## Question

Bagaimana alur manual/bulk/Excel menerapkan baris valid dengan aman dan melaporkan setiap baris gagal?

Putuskan template/versi dan format angka/teks; pemilihan SKU/variant serta shortcut persentase; restore eksplisit; SKU tidak dikenal/duplikat; error fatal pada file dibandingkan error per baris; batas file/baris dan threshold foreground/background; preview baris yang diterima; race base price/harga sekarang saat apply; retry baris gagal tanpa menerapkan ulang yang berhasil; status partial, audit, dan download laporan error yang akurat.

Harga akhir tetap yang sama di seluruh cabang dan penerapan baris valid sudah disepakati. Contoh: 100 baris input, 97 harga berhasil diubah, tiga baris tetap dengan penjelasan error. Bahas juga admin lain mengubah SKU yang sebelumnya valid antara preview dan apply, serta perbaikan hanya pada subset gagal.

## Referensi dan batasan

- [Research admin/import yang direvisi](../../../plan/research/discounts-coupons-promo-codes.md#91-proposed-admin-markdown-ux-and-bulk-excel-import).
- [Proposal schema batch/revision](../../../plan/research/discount-database-design.md#5-markdown-and-excel-tables).
- [SKU unik dan field sumber](../../../packages/db/src/schema/products.ts#L113).

Memerlukan Kebijakan Perubahan Base Price dan Restore Harga Coret. Batch import mengelompokkan tindakan administratif; bukan campaign dan tidak wajib mempunyai masa berlaku bisnis. Upload tidak langsung mengubah harga live, dan baris kosong/tidak disertakan tidak otomatis berarti restore. Jangan menjanjikan bulk operation atomik tanpa batas.

## Bukti penyelesaian

Contoh template dan walkthrough yang disetujui pemilik untuk kasus valid, invalid, partially applied, stale preview, dan retry. Sertakan kategori error dan efek tepat terhadap baris gagal yang tidak berubah.

## Batas pekerjaan

Claim setelah blockers selesai. Muat `grilling`, `domain-modeling`, dan `development-workflow`; gunakan panduan UI/design jika diskusi memerlukan contoh konkret. Hanya artefak Markdown; tidak ada implementasi parser/pemilihan library, upload provider, prototype executable, atau subagent.

## Answer

- Excel memakai harga akhir saja, bukan input persentase.
- Semua baris yang mengacu pada SKU duplikat dalam satu file digagalkan; SKU lain tetap dapat diproses.
- Fase awal membatasi import, bukan mendukung puluhan ribu SKU melalui background job.
- Batas import disimpan di `system_config`, tanpa UI pengaturan; perubahan dilakukan langsung melalui UPDATE database. Konfigurasi ini nantinya wajib dimasukkan ke seeder. Batas awal disetujui: 1.000 baris data, file 5 MiB, hasil dekompresi 25 MiB. Nilai ini usulan konservatif, belum hasil benchmark; belum ada implementasi.

- Template `.xlsx` berversi dengan SKU sebagai teks dan harga angka bulat rupiah tanpa formula. Teks nominal seperti `Rp150.000` ditolak. Sediakan template kosong dan export SKU terpilih.
- Kolom `action` eksplisit: `set_price` atau `restore_base`. `restore_base` wajib tanpa `new_price`; harga kosong sendiri bukan restore.
- Retry melalui download subset gagal dengan alasan error, perbaikan, dan upload sebagai batch baru yang terhubung ke batch asal; tetap melalui preview dan apply.
- File rusak, versi/header salah, atau melebihi batas ditolak seluruhnya. SKU tidak dikenal dan harga invalid menggagalkan baris terkait saja.

- Bulk UI menggunakan shortcut persentase dari Base Price dan menghasilkan target harga tetap. Contoh base Rp300.000 dan Markdown sekarang Rp150.000: input 20% menghasilkan target Rp240.000; preview wajib memperlihatkan kenaikan harga sekarang.
- Bulk UI hanya memproses SKU yang dicentang, dengan pilihan dipertahankan saat pindah halaman; tidak ada otomatis pilih seluruh hasil filter.
- Retry Apply setelah koneksi putus melanjutkan request yang sama tanpa menerapkan ulang baris sukses. Status batch menjadi acuan; perubahan isi memerlukan preview dan request baru.

- Shortcut persen dibulatkan ke rupiah terdekat, dengan pecahan tepat 0,5 dibulatkan naik. Contoh Rp100.001 × 85% → Rp85.001.
- Apply bertahap dan bounded; setiap baris sukses langsung live. Proses terputus dilanjutkan tanpa rollback seluruh batch dan tanpa mengulang baris sukses. Batas 1.000 SKU juga berlaku untuk bulk UI; tidak menjanjikan batch atomik atau background job pada fase awal.
- Satu sheet data; sheet tambahan dan macro ditolak seluruh file. Formula menggagalkan baris terkait dan tidak dievaluasi. Baris sepenuhnya kosong diabaikan; baris sebagian terisi tanpa SKU adalah error. Kolom referensi resmi tidak menentukan identitas/harga; pencocokan SKU persis, tanpa fuzzy matching.
- Alasan bisnis opsional. Laporan memuat nomor baris, SKU, action, target, status, serta alasan error. Audit memuat actor, waktu, hubungan batch asal/retry, dan data aktual sebelum-sesudah.
- Restore tanpa Markdown atau target yang sudah sama dicatat sebagai tidak berubah, bukan perubahan harga. Jumlah diterapkan, tidak berubah, gagal, dan belum selesai dibedakan; proses terputus tidak dilaporkan sebagai hasil final. Semua baris selesai tanpa error = `applied`; sebagian berhasil dan sebagian gagal = `partially_applied`; semua gagal = `failed`.

## Kontrak dan walkthrough untuk konfirmasi akhir

### Template

Kontrak fase awal: `.xlsx` berversi, satu sheet data, kolom input `sku`, `action`, `new_price`. Versi template diperiksa sebelum preview; versi tidak didukung ditolak. Kolom referensi resmi dapat memuat nama produk, variant, base/harga saat export, serta nomor baris asal dan alasan error untuk retry; nilainya bukan sumber harga atau identitas yang authoritative. Download subset gagal tetap memakai kontrak template yang dapat diupload kembali.

| sku (teks) | action | new_price (angka bulat) |
|---|---|---:|
| SHOE-BLACK-42 | set_price | 150000 |
| SHOE-WHITE-40 | restore_base | |

`set_price` memerlukan target positif dan lebih rendah dari base terbaru saat apply. `restore_base` memerlukan harga kosong. Action hilang/tidak dikenal dan kombinasi action/harga invalid menggagalkan baris. SKU tidak disertakan dalam file tidak berubah.

### Preview, konflik, dan penerapan

- Manual/bulk/import masuk ke review sebelum Apply. Upload hanya staging/validasi, bukan perubahan harga live.
- Preview memperlihatkan SKU/variant, base, harga website sekarang, target, operasi, selisih/persentase hasil, status/error, serta jumlah SKU terpilih dan baris diterima. Kenaikan harga website akibat penggantian Markdown harus terlihat.
- Target dari shortcut persen dibekukan menjadi harga akhir saat preview; perubahan base setelah preview tidak menghitung ulang target diam-diam.
- Sesuai keputusan tiket 01, Apply menggunakan base dan Markdown terbaru tanpa wajib review ulang: target masih valid diterapkan; target tidak valid ditolak per baris. Restore melepas Markdown terbaru walaupun sudah diganti admin lain. Audit mencatat kondisi aktual saat apply, bukan hanya snapshot preview.
- Periksa kembali izin dan keberadaan variant saat apply. Baris gagal tidak menulis perubahan harga. Jika izin tidak lagi tersedia, jangan melanjutkan penulisan; hasil yang sudah committed tetap dilaporkan secara akurat.
- Apply berjalan foreground secara bounded, tanpa background job fase awal. Jika terputus, cek status dan lanjutkan request yang sama untuk baris belum selesai. Jangan mengulangi baris sukses atau baris yang sudah final gagal; koreksi baris gagal memakai batch retry baru.
- Batas awal dari `system_config`: 1.000 baris data nonkosong/SKU bulk, file 5 MiB, hasil dekompresi 25 MiB. Baris invalid tetap dihitung dalam batas data; batas ini bukan klaim performa dan harus diverifikasi saat implementasi. Konfigurasi tanpa UI, dapat diubah langsung lewat DB, dan masuk seeder.

### Kategori error

| Kategori | Contoh | Efek |
|---|---|---|
| Fatal file | Rusak, versi/header salah, sheet tambahan, macro, melebihi batas | File ditolak sebelum perubahan live |
| Identitas baris | SKU kosong/tidak ditemukan, SKU duplikat | Baris terkait gagal; semua baris SKU duplikat gagal |
| Input baris | Formula, teks `Rp150.000`, harga kosong untuk set, action invalid | Baris terkait gagal; formula tidak dievaluasi |
| Harga saat apply | Target nol/negatif/≥ base terbaru | Baris gagal; tidak menimpa harga terbaru |
| Kondisi saat apply | Variant tidak tersedia atau izin berubah | Tidak menulis perubahan yang tidak diizinkan; laporkan kondisi dan hasil committed |
| Proses terputus | Koneksi/request terputus sebelum seluruh hasil diketahui | Bukan sukses final; rekonsiliasi status lalu lanjutkan baris belum selesai |

### Walkthrough

| Kasus | Input/tindakan | Hasil yang diharapkan |
|---|---|---|
| Valid | Base Rp300.000, `set_price` Rp150.000 | Preview lalu Apply; harga website Rp150.000 di semua cabang |
| Invalid | SKU tidak dikenal atau `new_price` berupa teks `Rp150.000` | Error dengan nomor baris, SKU, dan penjelasan; tidak ada perubahan dari baris tersebut |
| Duplikat | SKU sama berharga Rp150.000 dan Rp120.000 | Kedua baris gagal; SKU lain tetap dapat diterapkan |
| Partial | 100 baris, 97 valid, tiga invalid | 97 diterapkan, tiga gagal tanpa perubahan; status `partially_applied`, download tiga baris gagal |
| Stale base, masih valid | Preview base Rp300.000, target Rp150.000; base naik Rp400.000 | Terapkan target tetap Rp150.000 tanpa review ulang |
| Stale base, invalid | Preview target Rp150.000; base turun Rp120.000 sebelum Apply | Baris gagal; tidak menulis target dari import; harga terbaru tetap mengikuti kebijakan tiket 01 |
| Admin lain mengganti Markdown | Preview harga Rp180.000; admin lain mengganti Rp130.000; target batch Rp150.000 masih di bawah base | Target Rp150.000 diterapkan tanpa review ulang; audit sebelum Rp130.000 dan sesudah Rp150.000 |
| Restore | `restore_base`; Markdown terbaru berubah setelah preview | Hapus Markdown terbaru, gunakan base terbaru; target lama tidak aktif kembali |
| Retry koreksi | Perbaiki tiga baris gagal dan upload subset | Batch baru terhubung ke asal; preview/apply hanya subset, 97 sukses sebelumnya tidak diulang |
| Apply terputus | Sebagian baris sudah committed | Status belum final; melanjutkan request yang sama tidak menerapkan ulang baris committed |
| Tidak berubah | Restore tanpa Markdown atau set target yang sudah sama dan masih valid | Catat tidak berubah; jangan mengklaim ada perubahan harga |

Keputusan hanya untuk kontrak planning. Tidak ada implementasi, perubahan schema/seeder, pemilihan parser, tests, provider request, subagent, atau commit. Pemilik mengonfirmasi rangkuman lengkap dan walkthrough melalui `ask_user_question` dengan memilih **Sesuai, selesaikan tiket (Recommended)**. Tiket resolved; konfirmasi ini bukan izin implementasi.

## Comments

Dipublikasikan setelah proposal map lengkap disetujui. Dependencies dipasang setelah seluruh child tersedia.
