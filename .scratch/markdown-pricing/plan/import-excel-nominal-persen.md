# Spesifikasi: Import harga Excel nominal dan persen

## Tujuan

Mempermudah import harga pada `/admin/products/harga`: SKU tidak perlu diubah manual menjadi Text, tersedia contoh langsung di template, action dijelaskan, dan satu workbook dapat berisi input harga nominal maupun diskon persen.

Status keseluruhan plan dicatat hanya di [index fitur](../index.md).

## Approval dan dasar keputusan

- Pengguna mengonfirmasi: seluruh kolom SKU otomatis Text karena validator mewajibkan teks; persen adalah diskon dari source seperti input UI; dua contoh dummy ada langsung di area input.
- Pengguna mengonfirmasi rangkuman scope dan meminta pembuatan spec melalui pesan “oke buatkan specsnya”.
- **Approval complete spec diberikan pengguna** melalui pesan “oke sudah saya setujui. tolong kamu implementasikan perubahannya”. Approval mencakup seluruh kontrak dan acceptance spec ini; implementasi dimulai tanpa delegasi.
- Detail di bawah yang belum disebut eksplisit dalam percakapan merupakan usulan kontrak untuk direview bersama spec ini, khususnya versi workbook, kompatibilitas, penamaan kolom, dan perlakuan baris contoh.
- Tidak ada izin subagent, commit, push, akses remote, deployment, atau provider writes.

## Fakta existing dan referensi

- `apps/admin/src/lib/price-workbook.ts`: marker `markdown_v1`, satu sheet `Harga`, header `sku`, `action`, `new_price`; data mulai baris 3. Template saat ini tanpa data. Writer menggunakan inline strings tetapi belum mendefinisikan format Text untuk seluruh kolom SKU.
- `apps/admin/src/lib/price-changes-administration.ts`: `StagePriceChangeRowInput.discountPercent` tersedia untuk manual/bulk; `workbookRowToStageRow` saat ini selalu memberikan `discountPercent: null`.
- `packages/db/src/markdown-pricing.ts`: `computePercentTarget(sourceUnitPrice, discountPercent)` menggunakan pembulatan half-up ke Rupiah. Parser persen menerima maksimum enam digit desimal, nilai >0 sampai 100, tetapi hasil target nol tetap ditolak.
- `apps/admin/src/app/admin/products/harga/price-change-excel-client.tsx`: flow template → upload/staging → review → apply → laporan/koreksi sudah tersedia.
- Dokumentasi existing: [Markdown pricing](../../../docs/features/markdown-pricing.md).
- Worktree sudah memiliki perubahan terkait harga dan fitur lain. Implementasi wajib memeriksa diff awal, mempertahankan perubahan tersebut, dan tidak menganggapnya hasil pekerjaan spec ini.

## Scope dan non-scope

Termasuk template, export SKU, parser import, staging persen, review, laporan lengkap/subset gagal, retry tertaut, petunjuk Format file, serta tests dan dokumentasi.

Tidak termasuk perubahan perilaku manual/bulk, harga naik, persen dari harga aktif, formula Excel, sheet tambahan, desain ulang halaman, schema/migration/seeder, endpoint baru, atau perubahan deployment. Guard stok/harga/source, RBAC, audit, idempotency, digest review dan foreground apply existing tetap berlaku.

## Kontrak workbook yang diusulkan

### Struktur dan kompatibilitas

- Workbook baru memakai marker **`markdown_v2`** di A1, tetap satu sheet `Harga`.
- Baris 2: **`sku`, `action`, `new_price`, `input_type`**, lalu kolom referensi resmi existing bila diperlukan. Menambahkan kolom di akhir input mempertahankan posisi tiga input lama.
- Data mulai baris 3. `new_price` dipertahankan sebagai identifier untuk membatasi pergantian kontrak, tetapi pada mode `percent` berarti nilai persen, bukan Rupiah.
- Writer template/export/report/subset gagal menghasilkan v2. Reader tetap menerima v1 dan alias marker lama dengan tiga input existing; semua input v1 ditafsirkan sebagai nominal.
- V2 mewajibkan header `input_type`. Header asing/duplikat/hilang/urutan salah tetap fatal. V1 dengan kolom input v2 tidak diterima diam-diam.
- Versi format file dibedakan dari identitas kontrak batch/database existing. Jangan mengubah CHECK database untuk label workbook baru; simpan metadata format input di JSON existing bila diperlukan untuk round-trip.

### Matriks input

| action | input_type | new_price | Makna |
|---|---|---|---|
| `set_price` | `price` | Angka integer >0 | Target harga nominal Rupiah |
| `set_price` | `percent` | Angka persen >0 dengan maksimum 6 desimal | Diskon terhadap source saat staging, dibekukan menjadi target Rupiah |
| `restore_base` | kosong | kosong | Lepas override dan kembali mengikuti source |

Untuk `set_price`, tipe kosong/tidak dikenal adalah error baris, bukan fallback nominal. Untuk `restore_base`, tipe atau nilai terisi adalah error baris agar tidak menyamarkan input yang tidak terpakai.

- Nominal: `150000`, tanpa `Rp`, separator ribuan, atau formula.
- Persen: `10` berarti diskon 10%; `12.5` berarti 12,5%. Bukan `0.1` untuk 10%, dan bukan sel berformat Percentage Excel yang menyimpan 10% sebagai 0.1. Kolom nilai menggunakan format angka biasa.
- Batas/range/rounding mengikuti helper manual/bulk. Nilai 100 gagal karena target nol; persen negatif, nol, >100, format tidak sah atau hasil di luar rentang ditolak. Persen kecil yang membulat ke source juga mengikuti guard target existing.
- SKU tetap text case-sensitive, spasi tidak dinormalisasi, formula tidak dievaluasi. SKU duplikat tetap menggagalkan semua kemunculannya.

### Format Text dan contoh

- Semua sel pada kolom A/SKU, termasuk baris input yang belum berisi data, memakai format **Text** melalui column style OOXML. SKU yang sudah ditulis tetap inline string.
- Harga/persen tetap numeric; tidak mengubah seluruh baris menjadi Text. Header/marker tetap text seperti existing.
- Format Text mencegah konversi otomatis saat mengetik. Tidak menjanjikan pemulihan nol yang sudah hilang pada sumber lain; paste yang menimpa format dapat tetap menghasilkan SKU numerik dan harus ditolak validator.
- Template berisi tepat dua contoh berikut pada baris 3–4:

| sku | action | new_price | input_type |
|---|---|---:|---|
| `CONTOH-GANTI-SKU-HARGA` | `set_price` | 150000 | `price` |
| `CONTOH-GANTI-SKU-PERSEN` | `set_price` | 10 | `percent` |

- Kedua SKU contoh diperlakukan khusus sebagai `EXAMPLE_ROW_NOT_REPLACED`: baris gagal final, tidak dapat mengubah harga bahkan bila kebetulan ada SKU nyata dengan nama sama. User mengganti SKU atau menghapus baris; tidak ada baris contoh yang di-skip diam-diam.
- Proteksi hanya untuk dua identifier persis tersebut, bukan seluruh prefix `CONTOH-`. Ini usulan safeguard yang termasuk approval spec.
- Petunjuk di halaman dekat download: **“Template berisi 2 baris contoh. Ganti SKU contoh atau hapus barisnya sebelum upload.”** Tidak menambah baris petunjuk yang akan terbaca sebagai data.
- Export SKU dan laporan tidak menyisipkan contoh. Export SKU existing menghasilkan mode `price` dengan target nominal sesuai perilaku existing.

## Perhitungan, staging, dan round-trip

1. Parser memvalidasi jenis input, menyimpan mode/nilai asli untuk laporan, dan memisahkan `targetUnitPrice` dari `discountPercent`.
2. Staging persen memakai `computePercentTarget` yang sama dengan manual/bulk, terhadap source yang dibaca di transaksi staging. Contoh source Rp200.000, harga aktif Rp170.000, input `10` → target **Rp180.000**, bukan Rp153.000.
3. Target Rupiah dibekukan pada staging; apply tidak menghitung ulang persentase. Jika source berubah, guard existing menentukan hasil baris; jangan diam-diam menerapkan persen ke source baru.
4. Error bisnis per baris persen, termasuk SKU tidak ditemukan dan target tidak valid, menjadi kegagalan baris workbook; tidak membatalkan staging seluruh baris valid. Ini perlu penanganan khusus karena jalur persen existing dapat melempar error input batch.
5. Simpan mode asli, nilai asli, dan target hasil hitung pada metadata JSON existing. Sertakan informasi input yang relevan pada fingerprint/idempotency; jangan menghilangkan perbedaan `price` dan `percent` hanya karena targetnya sama. Digest review tetap mengikat target dan guard sesuai kontrak existing.
6. Laporan/subset gagal mempertahankan `input_type` dan nilai input asli. `source_price` dan `effective_price` tetap kolom referensi, bukan input harga. Preview UI menampilkan target beku secara terpisah.
7. Koreksi persen merupakan **batch baru** yang menghitung dari source saat koreksi tersebut di-stage; relasi `origin_row` tetap wajib dan hanya boleh menunjuk baris final gagal. Baris sukses asal tidak diputar ulang.
8. Laporan batch lama tanpa metadata mode memakai fallback `price` dan target/raw existing. Tidak mengarang persen dari selisih harga.
9. Validasi container, batas ukuran/baris/ekspansi, larangan formula/macro/external link, struktur satu sheet, permission dan logging existing tidak dilonggarkan.

## Rancangan teknis

Tidak menambah framework/package atau schema. Pertahankan public facade existing agar route tetap tipis. Jangan membangun mesin import generik atau menduplikasi rumus persen.

| Path (root repo) | Aksi | Tanggung jawab / layer | Seam test |
|---|---|---|---|
| `apps/admin/src/lib/price-workbook.ts` | modify | Codec app-local: v1/v2, style Text SKU, dua contoh, validasi mode dan writer round-trip | `apps/admin/src/lib/price-workbook.test.ts` |
| `apps/admin/src/lib/price-workbook.test.ts` | modify | Unit publik parser/writer, termasuk XML styles dan compatibility | API codec |
| `apps/admin/src/lib/price-changes-administration.ts` | modify | Service/facade existing: staging persen, metadata preview, idempotency, export/report; module logger existing | DB integration publik |
| `apps/admin/src/lib/price-workbook-administration.db.test.ts` | modify | Import mixed-mode, gagal parsial, report/retry, permissions dan guard | stage/apply/report |
| `apps/admin/src/lib/price-changes-administration.db.test.ts` | modify bila regression seam memerlukan | Memastikan manual/bulk dan batch legacy tidak berubah | public administration API |
| `apps/admin/src/app/admin/products/harga/price-change-shared.ts` | modify | Tipe DTO frontend untuk metadata mode/nilai; jangan menduplikasi kalkulasi | Konsumsi via E2E/typecheck |
| `apps/admin/src/app/admin/products/harga/price-change-excel-client.tsx` | modify | UI: petunjuk final, mode/nilai review dan target hasil hitung | Excel mock E2E |
| `e2e/admin/price-change-excel-mock.spec.ts` | modify | Perilaku user-visible, download template, review persen dan error/koreksi | Playwright mock |
| `e2e/admin/price-change-prototype-mock.spec.ts` | modify bila assertion format terdampak | Regression layout/copy existing tanpa menghapus coverage | Playwright mock |
| `docs/features/markdown-pricing.md` | modify saat implementasi | Kontrak v2, contoh, kompatibilitas, input persen dan retry | Review dokumentasi |
| `docs/api-reference.md` | modify saat implementasi | Perubahan kontrak upload/download/DTO, endpoint tetap | Review kontrak |

Kontrak exported yang direncanakan (tanpa body):

- `price-workbook.ts`: `WorkbookInputType = "price" | "percent"`; extend `ParsedWorkbookRow` dengan `inputType: WorkbookInputType | null`, `inputTypeRaw: string | null`, `discountPercent: string | null`; `targetRaw` tetap menyimpan nilai input mentah. Tambahkan error codes mode/persen/contoh secara deterministik.
- `PriceWorkbookRow`: tambahan `inputType?: string | null`; `newPrice` tetap `string | number | null`. Writer baru menulis nominal/persen sesuai mode, tidak menebak dari target.
- Signature `parsePriceWorkbook(file, limits): ParsedPriceWorkbook`, `writePriceTemplate(): Uint8Array`, `writePriceWorkbook(rows, options): Uint8Array` tetap; `ParsedPriceWorkbook` mendapat metadata versi format terpisah bila diperlukan, tanpa mengganti identitas kontrak batch.
- `PriceChangePreview`: tambahan optional `inputType`, `inputTypeRaw`, `inputValueRaw` (string/null sesuai field); optional untuk pembacaan batch lama. Gunakan mode normalisasi dan raw untuk menampilkan input invalid tanpa mengeksekusinya.
- Signature `stageWorkbookPriceChange(input: StageWorkbookInput, actorUserId: string): Promise<StagePriceChangeResult>`, `exportPriceChangeWorkbook(input, actorUserId)`, `getPriceChangeReport(batchId, subset, actorUserId)` tetap. `getPriceChangeTemplate` tetap facade download existing.
- `price-change-shared.ts`: perluas tipe preview frontend sesuai DTO server; tidak menambah endpoint/fetch terpisah.

Keputusan struktur: ubah codec dan seam staging existing, bukan memindahkan seluruh facade besar dalam task ini. Alasannya perubahan terfokus dengan regression minimal; refactor besar backend ditolak sebagai non-scope. Semua perubahan backend tetap mengikuti maintainable-code dan structured logging sukses/gagal tanpa PII atau isi workbook lengkap.

### Checkpoint sebelum implementasi

- Spec ini hanya dokumen; tidak menambahkan API library sehingga Context7 belum diperlukan.
- Sebelum coding, baca skill UX, maintainable-code, TDD, Next.js dan panduan organisasi backend yang relevan. Jalankan Context7 untuk API external yang disentuh dan catat ID serta hasil; untuk surface internal/OOXML gunakan source/spec resmi, bukan API spreadsheet library yang tidak terpasang.
- `discovery:` verifikasi representasi style OOXML Text dan column default lewat spesifikasi resmi atau workbook fixture terpercaya; uji round-trip writer/parser dan manual di aplikasi spreadsheet yang tersedia. Jangan mengklaim verifikasi Excel desktop bila hanya memeriksa XML.
- `discovery:` pastikan semua consumer `templateVersion` dan validator header mendukung format v2 terpisah dari identitas database; bila ternyata membutuhkan schema migration, berhenti dan minta persetujuan scope baru.

## Rancangan UX

### Referensi, hierarchy dan reuse

Referensi: panel Import harga Excel existing pada `/admin/products/harga`, dialog manual/bulk pada halaman yang sama untuk arti persen, dan tabs Harga/Import existing untuk konsistensi. Tidak mengganti layout, theme atau primary flow.

1. **Siapkan file**: download template, pemberitahuan contoh yang wajib diganti, disclosure Format file.
2. **Unggah untuk review**: upload dan alasan optional; peringatan upload belum mengubah harga tetap terlihat.
3. **Review & terapkan**: tampilkan mode/nilai input dan target Rupiah, lalu action existing **Terapkan baris valid**; report/retry tetap sekunder.

Reuse komponen existing di `apps/admin/src/components/ui/`: `card.tsx`, `button.tsx` (download/report outline; apply default), `table.tsx`, `badge.tsx`, `input.tsx`, `label.tsx`. Disclosure native `<details>/<summary>` tetap digunakan; tidak perlu komponen visual baru.

### Copy Format file

- “Sheet Harga, versi markdown_v2. File versi lama tetap dapat diunggah.”
- “Kolom: sku, action, new_price, input_type. Jangan mengganti struktur kolom.”
- “set_price: tetapkan harga baru. input_type price untuk nominal Rupiah, atau percent untuk diskon dari harga source.”
- “Contoh: source Rp200.000, new_price 10, input_type percent → target Rp180.000.”
- “restore_base: kembali mengikuti harga source. Kosongkan new_price dan input_type.”
- “SKU harus Text. Isi persen sebagai angka biasa: 10 untuk 10%, bukan sel berformat Percentage atau formula.”
- “Baris gagal dapat diperbaiki melalui subset gagal yang tertaut ke batch asal.”

### Review dan state matrix

Tabel existing tetap menampilkan Baris, SKU, Aksi, Target, Status, Alasan; tambahkan **Input** sebelum Target. Contoh input `Rp150.000`, `10% dari source`, atau `—` untuk restore; Target persen tetap `Rp180.000`. Input invalid ditampilkan literal, bukan dihitung browser.

| State | Copy / perilaku final |
|---|---|
| Idle/template | “Template berisi 2 baris contoh. Ganti SKU contoh atau hapus barisnya sebelum upload.”; Unduh template tersedia |
| Disclosure tertutup/terbuka | “Format file”; dapat dibuka via keyboard; menampilkan copy di atas |
| Belum upload | “Hasil review akan muncul setelah file diunggah.” |
| File dipilih/belum upload | Nama file terlihat melalui kontrol file existing; belum ada staging/perubahan harga |
| Upload/apply loading | Tombol existing disabled dan indikator loading; tidak mengizinkan submit ganda |
| Review siap | Input dan target hasil hitung terlihat; “Upload belum mengubah harga.” tetap ada |
| Contoh tertinggal | Baris failed `EXAMPLE_ROW_NOT_REPLACED`; bantuan “Ganti SKU contoh dengan SKU produk atau hapus baris contoh, lalu unggah kembali.” |
| Mode tidak valid | Baris failed; “Gunakan input_type price atau percent untuk set_price.” |
| Persen tidak valid | Baris failed; “Isi diskon persen yang menghasilkan harga lebih dari Rp0 dan di bawah harga source.”; code teknis tetap tersedia pada laporan |
| Restore membawa nilai/tipe | Baris failed; “Kosongkan new_price dan input_type untuk restore_base.” |
| Workbook fatal | Existing “Workbook ditolak: <reason>”; tidak ada batch/harga berubah |
| Sukses/parsial/pending | Count/status existing; sukses baris berarti langsung mengubah harga; lanjutkan apply bila pending |
| Semua baris gagal | Apply disabled karena tidak ada pending; report/subset gagal tersedia |
| Retry | Download subset gagal → perbaiki → unggah koreksi; relasi asal dan mode/nilai dipertahankan |
| Tanpa izin edit | Download/report tetap sesuai izin existing; “Upload dan penerapan harga memerlukan izin edit harga.” |

Viewport review: desktop 1440px dan mobile 390px. Tabel boleh scroll horizontal di region sendiri; halaman tidak overflow. Disclosure, upload dan tombol dapat digunakan keyboard, focus terlihat, heading/label semantik dipertahankan. Status tidak color-only. Bandingkan typography/spacing/action dengan panel serta dialog existing; tidak mengklaim WCAG penuh dari satu test. Tidak ada prototype baru yang diminta.

## Acceptance criteria dan testing

1. Download template v2 berisi dua contoh persis, SKU text dan column Text style untuk baris baru. Nilai contoh nominal/persen numeric. Header/marker/sheet sesuai kontrak.
2. Input manual SKU `00123` pada kolom A mempertahankan leading zero pada aplikasi spreadsheet yang diverifikasi. SKU numerik hasil paste tetap ditolak, bukan dinormalisasi diam-diam.
3. Dua contoh tertinggal gagal tanpa write, termasuk jika data DB kebetulan mempunyai identifier tersebut. Mengganti SKU dummy menghasilkan row normal.
4. Mixed workbook nominal/persen/restore dapat di-stage dan di-review tanpa price write; apply hanya mengubah baris valid sesuai permission dan guard.
5. Source Rp200.000 dengan input persen 10 menghasilkan target Rp180.000 walaupun harga aktif Rp170.000. Case pembulatan independen: source Rp100.001, persen 15 → Rp85.001.
6. Invalid mode, persen negatif/nol/100/>100, lebih dari enam desimal, sel Percentage tersimpan 0.1 (harus diperlakukan sebagai 0,1%, bukan 10%), formula, SKU hilang/unknown/duplikat, dan restore dengan input terisi teruji. Unknown SKU persen gagal per baris tanpa menggagalkan baris valid lain.
7. Target persen dibekukan, replay request idempotent, perubahan source setelah review tidak menyebabkan re-derive, dan digest/guard existing tidak dibypass.
8. Report/full/subset/retry mempertahankan tipe dan nilai input asli; failed subset menunjuk final failed rows yang tepat; batch lama fallback nominal; retry tidak memutar ulang sukses.
9. V1/alias lama masih diterima, struktur v2 tidak salah diterima sebagai v1, dan proteksi container/bounds tetap lulus.
10. UI menjelaskan dua action, nominal/persen, basis source, dan contoh; E2E menguji mode/input/target terlihat serta state error/retry/tanpa izin relevan. Render desktop/mobile dan keyboard direview terhadap referensi existing.

Testing memakai TDD di public seams: failing tests dahulu, satu vertical slice, lalu green. Mock E2E bukan bukti backend benar; DB integration wajib berjalan dengan DB test yang dikonfigurasi. Jika guard-skip/infrastruktur terblokir, catat sebagai belum terverifikasi.

Verification yang direncanakan, **belum dijalankan**:

- L0 setiap slice: `npm run verify:types:admin`.
- L1 codec: `npm run verify:unit:slice -- apps/admin/src/lib/price-workbook.test.ts`.
- L1 service: `npm run verify:unit:slice -- apps/admin/src/lib/price-workbook-administration.db.test.ts apps/admin/src/lib/price-changes-administration.db.test.ts`.
- L2 batch: `npm run verify:batch:unit` dan `npm run verify:batch:e2e -- e2e/admin/price-change-excel-mock.spec.ts e2e/admin/price-change-prototype-mock.spec.ts`. Kedua spec sudah tercakup testMatch mock existing; tidak perlu mengubah config hanya untuk itu.
- Sebelum commit/PR/integrasi: full unit sesuai aturan repo; legacy `npm run test:e2e` hanya dengan izin terpisah. Record suite yang sudah pass, jangan menjalankan ulang tanpa perubahan relevan.
- Browser render manual dan download/open spreadsheet: record aplikasi yang benar-benar dipakai serta batas verifikasi. Output disposable Playwright hanya di `playwright/`; hasil gagal didiagnosis dari Markdown, bukan screenshot.

## Urutan slice yang diusulkan

1. Template/codec v2, Text SKU, dua contoh, v1 compatibility dan validation: tests codec dahulu.
2. Staging mixed-mode, preview metadata, row-level error, freeze/idempotency, report/retry: DB tests dahulu.
3. Copy dan review UI, E2E, render desktop/mobile, dokumentasi kontrak; jalankan batch gate dan review terhadap spec.

Ini urutan pekerjaan dalam spec, **bukan publikasi multi-session tickets**. Tidak ada ticket breakdown atau delegasi yang diotorisasi.

## Risiko, open item dan penutupan

- Perubahan facade backend existing beririsan dengan dirty worktree: integrasikan secara targeted dan review diff sebelum/sesudah.
- `new_price` pada persen dapat membingungkan; mitigasi label Input di review, contoh nyata dan copy eksplisit. Rename menjadi kolom generik lain tidak termasuk scope ini.
- Compatibility v2, dua identifier contoh yang dilindungi, aturan restore input kosong, dan round-trip mode adalah usulan detail yang perlu approval complete spec ini.
- Discovery teknis di atas harus ditutup sebelum acceptance; tidak boleh diganti dengan tebakan atau perluasan schema diam-diam.
- Deployment/env/cron/domain tidak berubah, sehingga pembaruan deployment N/A.
- Saat selesai: semua acceptance dibuktikan, docs fitur/API diperbarui, evidence dicatat pada artefak fitur, spec dipertahankan, index ditandai Done dengan tanggal dan ringkasan hasil.

## Deviation log


- Tidak ada deviasi kontrak. Refinement kecil dalam kerangka approved: error log staging
  memakai record allowlisted name/message/code; audit stage menambah field input workbook;
  `new_price` laporan berisi raw input; `PERCENT_INVALID` untuk persen tidak sah (0/≥100/format);   
  helper test `stage` menerima `discountPercent` tanpa mengubah perilaku.

## Status per slice

| # | Slice | Status | Bukti |
|---|---|---|---|
| 1 | Template/codec v2 + Text SKU + contoh + v1 compat | Done | codec 32 pass |
| 2 | Staging persen, metadata, retry/report | Done | DB serial 81 pass |
| 3 | Review UI, E2E, render, docs | Done | mock E2E 14/14; detail pada [bukti](../ticket/01-verifikasi-import-excel-nominal-persen.md) |

Blocker luar plan: full unit/types tertahan error `providerTax` milik sesi lain pada
`packages/db/src/discount-pricing.ts` dan `apps/store/src/lib/versioned-pricing.test.ts`.
Legacy `npm run test:e2e` tidak dijalankan.
