# 05 — Excel dan linked retry subset gagal

Label: ready-for-agent
Type: task
Status: resolved
Assignee: main-agent
Blocked by: 04
Parent: [Map implementasi diskon](map.md)
Spec: [Complete spec](../plan/discounts-spec.md)
Acceptance IDs: M03, X01, X02, X03, X04, X05, X06, A01, A04, D02

## Perilaku yang dibangun

Admin mengunduh template/export SKU, mengunggah workbook berversi, mereview accepted/error rows, menerapkan baris valid melalui bounded pipeline04, lalu mengunduh laporan/subset gagal dan mengunggah koreksinya sebagai linked batch baru. Kesalahan tidak disamarkan sebagai keberhasilan seluruh file.

## Acceptance criteria

- [x] Template `.xlsx` satu sheet Harga, A1 marker OKCIR_MARKDOWN_V1, row2 headers resmi dan data row3. SKU text exact, action set_price/restore_base, numeric integer new_price; reference columns resmi tidak menjadi authority.
- [x] set_price wajib target positif/di bawah base terbaru saat apply; restore wajib harga kosong. Blank price bukan restore. Baris blank seluruhnya diabaikan, partly-filled tanpa SKU error. Text nominal/formula/fraction/invalid action gagal row.
- [x] Semua rows SKU duplikat gagal; SKU unknown/error lain tidak menghalangi baris valid. Formula tidak dievaluasi, termasuk reference cells/cached values.
- [x] Rusak/container/signature/unsupported marker/header/sheet tambahan/macro/encrypted/external relationship/ZIP path traversal atau entries invalid menolak file sebelum price writes. Content validation tidak mengandalkan extension/MIME saja.
- [x] Bounds current config1000 nonblank rows/5MiB compressed/25MiB expanded serta limits ZIP entries/cells/text dari spec ditegakkan selama parsing, bukan sesudah unbounded allocation. Tepat batas diterima bila valid; berlebih ditolak tanpa live changes. Library dipilih setelah verifikasi docs/security terkini, bukan asumsi API.
- [x] Upload hanya staging. Baris valid memakai review/latest-data/apply/permissions04. Contoh100 input97 applied/3 failed memberi partial report dengan row number/SKU/action/target/status/reason yang tepat, bukan100 sukses.
- [x] Report/failed subset `.xlsx` dibentuk dari bounded durable row records, text literal tidak menjadi formula. Workbook asli tidak diarsipkan; temporary resources dibersihkan pada success/error/disconnect.
- [x] Failed subset dapat diperbaiki dan diupload menjadi batch baru yang linked origin row/batch valid, key baru, preview dan apply lagi.97 sukses tidak diulang. Replay upload/apply key yang sama tidak membuat hasil ganda; correction berbeda key lama ditolak.
- [x] Putus setelah60 committed/37 pending/3 failed: resume batch sama hanya37 pending;3 final errors memerlukan linked correction, bukan reopen final rows.
- [x] Download/export/template/history juga current grants price-view+product-view-all; mutation price-edit; tidak bocor via direct API. Schema/seed/audit/logs/feature/API/testing docs diperbarui.

## Verifikasi

B browser+actual HTTP/PG untuk upload→preview→apply→partial→report→retry. Independent workbook fixtures untuk valid/fatal/formula/unknown/duplicates/bounds/unsafe export. T untuk linked retry/replay/partial crash dan policy changes; H untuk resource bounds dan all failure no-price-write. Pakai controlled fixture clocks, bukan live provider. Sukses mock workbook bukan benchmark1000 rows atau klaim parser aman tanpa adversarial cases.

## Batas dan penyelesaian

Baca [kontrak bersama](map.md#kontrak-bersama-untuk-semua-ticket). Tidak ada background worker, archive storage/volume baru atau implicit production config change. Main agent menguji dan mereview setelah execution berizin, lalu merekam evidence di Answer sebelum resolved.

## Answer

Status: resolved. Implementasi di worktree utama `worktree-diskon`; main agent
menjalankan seluruh validasi. Tidak ada commit/push, provider request nyata,
remote/Docker/SSH, atau deployment. Gate operasional tetap `0`; hanya DB
disposable `.env` (`marketplace_discounts_test_20261026`) yang memakai `1`.

### Yang diimplementasikan

- **Container bounded tanpa dependency baru**
  (`apps/admin/src/lib/xlsx-container.ts`): pembacaan ZIP sendiri di atas
  `node:zlib` (`deflateRawSync`/`inflateRawSync`). Urutan penegakan: ukuran file
  terkompresi → struktur EOCD/central directory, satu disk, tanpa ZIP64 →
  jumlah entry (200), nama aman (tolak `..`/absolut/backslash/NUL/duplikat),
  flag enkripsi/metode kompresi → ukuran deklarasi tiap entry dibebankan ke
  budget expanded SEBELUM dekompresi → `inflateRawSync({ maxOutputLength })`
  sebesar ukuran yang sudah dibebankan + verifikasi panjang dan CRC. Header ZIP
  yang berbohong (declared 10 byte, isi 100 000 byte) terbukti ditolak
  `EXPANDED_LIMIT_EXCEEDED`, bukan dialokasikan.
- **Kontrak workbook** (`apps/admin/src/lib/price-workbook.ts`): sheet `Harga`
  tunggal, `A1 = OKCIR_MARKDOWN_V1`, header `sku/action/new_price` + kolom
  referensi resmi (`product_name`, `variant`, `source_price`, `effective_price`,
  `row_number`, `origin_row`, `status`, `error_reason`), data row 3. Parser XML pull sendiri
  (tokenizer + entity decode) menegakkan 100 sel/row, 4096 karakter/sel, dan
  `maxRows` baris non-blank saat membaca. Fatal: container/OLE/encrypted, macro,
  external relationship, sheet tambahan, marker/header salah, traversal,
  duplikat entry, batas entry/cell/text/row/byte. Row error (data, bukan fatal):
  formula (cached value tidak dievaluasi, termasuk di kolom referensi), SKU bukan
  text, SKU kosong pada row terisi sebagian, action asing, `set_price` tanpa
  harga/teks/pecahan/0/negatif/>batas, `restore_base` berharga, SKU duplikat
  (semua kemunculan), `origin_row` invalid. Writer template/export/laporan
  menulis semua text sebagai inline string (literal, tidak pernah `<f>`).
- **Stage dari workbook + linked retry**
  (`price-changes-administration.ts`): `stageWorkbookPriceChange` parse dulu di
  memory (tanpa transaksi), lalu `runStage` bersama jalur manual/bulk. Baris
  valid `pending`, baris gagal **failed final** dengan nomor baris worksheet +
  `resultCode` + raw action/target di preview (tetap non-otoritatif). Koreksi
  wajib `parentBatchId`; setiap `origin_row` unik dan hanya boleh menunjuk row
  `failed` final batch asal (row pending/applied/unchanged atau batch asing →
  `400 ORIGIN_INVALID` sebelum write), disimpan sebagai `origin_retry_row_id`.
  Fingerprint upload mencakup source/template/parent/row sehingga replay key
  sama mengembalikan batch yang sama dan payload berbeda `409`.
- **Template/export/laporan**: `GET .../template`, `POST .../export` (hanya id,
  nilai uang dari server, prefill `set_price` + harga efektif), `GET
  .../{id}/report?subset=all|failed` (dari row durable; subset gagal mengisi
  `origin_row` = nomor baris row itu sendiri sehingga bisa dikoreksi; kolom
  `status` + `error_reason`). Semua route `no-store`, grant `prices:view` +
  `products:view all_branches`, upload `prices:edit`, logging terstruktur tanpa
  isi workbook/daftar SKU; upload dibatasi `content-length` (file + 512 KiB
  envelope) sebelum `formData()`.
- **Schema/migrasi**: `price_change_batch` memakai `template_version`/
  `parent_batch_id` yang sudah ada; constraint row diperluas lewat migrasi
  drizzle-kit `0046_short_pride.sql` + `0047_rainy_captain_cross.sql`: `action`
  boleh `invalid` **hanya** saat `state='failed'`, `input_sku` boleh kosong hanya
  pada row failed, target `set_price` boleh null hanya pada row failed.
- **Seed/reset**: reset tidak lagi memalsukan `state='pending'` (yang akan
  melanggar CHECK row gagal); hanya melepas self-FK `origin_retry_row_id` lalu
  menghapus row sebelum revision/pointer. Seed demo menambah satu batch `xlsx`
  `staged` 2 row pending (`template_version=OKCIR_MARKDOWN_V1`) tanpa revision/
  pointer/harga.
- **UI**: kartu "Excel harga" (`price-change-excel-client.tsx`) — unduh template,
  unggah workbook + alasan, ringkasan counts jujur + tabel baris/status/alasan,
  tombol apply/lanjutkan (satu chunk per klik), unduh laporan/subset gagal, dan
  form koreksi (menampilkan badge "Koreksi tertaut"). Bulk card menambah tombol
  "Export SKU terpilih" yang mengirim hanya id dan mengunduh hasil server.
- **Docs**: `docs/features/markdown-pricing.md` §4 (+schema/verifikasi/batas),
  `docs/api-reference.md` (4 endpoint baru + detail), `docs/testing/README.md`
  (suite + spec baru + `vitest.setup.ts`), `docs/features/seeding.md` (demo
  batch workbook), dan `apps/admin/vitest.setup.ts` yang memuat `.env` sebelum
  module test (memperbaiki suite DB admin yang sebelumnya hanya jalan bila
  `DATABASE_URL` diekspor di shell).

### Context7 checkpoint

- `/websites/nodejs_latest-v24_x_api` — dikonfirmasi bahwa convenience method
  `zlib.inflateRawSync(buffer, options)` menerima `maxOutputLength` (membatasi
  output, default `buffer.kMaxLength`), dan `deflateRawSync`/`crc32` tersedia.
  Implementasi tetap memakai tabel CRC sendiri.
- `/vercel/next.js/v16.2.9` — dikonfirmasi `request.formData()` untuk upload
  multipart di Route Handler dan `Response`/`NextResponse` dengan header
  `Content-Type`/`Content-Disposition` untuk unduhan biner `.xlsx`.
- Tidak ada library parser XLSX pihak ketiga yang ditambahkan: kontainer/format
  ditangani modul internal di atas API Node yang sudah terpasang, sehingga tidak
  ada asumsi API library baru atau supply-chain tambahan.

### Evidence (main agent)

| Check | Hasil | Log/ref |
| --- | --- | --- |
| `verify:types:admin`, `verify:types:store`, `tsc -p packages/db` | PASS | — |
| `lint:admin` | 0 error (warning pre-existing) | — |
| `db:check` + migrasi `0046`/`0047` | PASS (hanya constraint row berubah) | — |
| Focused unit: `xlsx-container.test.ts`, `price-workbook.test.ts` | **29 passed** | — |
| DB: `price-workbook-administration.db.test.ts` + `price-changes-administration.db.test.ts` (serial) | **71 passed** (9 + 33 DB, sisanya pure) | — |
| Batch unit serial | **137 files / 1571 passed / 14 skipped** | `/tmp/t05-batch-unit-final.log` |
| Mock E2E: `price-change-excel-mock`, `price-change-bulk-mock`, `price-change-mock` | **14 passed** | — |
| `db:seed` pada DB disposable + inspeksi seed xlsx batch | PASS; gate akhir `0`, 0 fixture sisa, demo batch bulk 3 pending + xlsx 2 pending | — |

### Bukti per acceptance

- **Template (X02/X06 bagian template)**: HTTP template diverifikasi reader ZIP
  independen: satu sheet, marker A1, header resmi, 2 row (marker+header), tanpa
  `<f>`. Unit test menegakkan sheet/marker/header fatal dan tipe sel.
- **Validasi row (X02)**: unit test + DB test menutup formula/cached, teks
  nominal/pecahan/0/negatif, blank price ≠ restore, restore berharga, action
  asing, SKU numerik, SKU duplikat (semua gagal), partly-filled tanpa SKU,
  blank/reference-only row diabaikan, dan SKU unknown tidak menghalangi baris
  valid (difinalkan `failed` saat apply).
- **Fatal file**: unit test + DB test + E2E macro membuktikan penolakan
  `400 WORKBOOK_REJECTED` + `details.reason` tanpa batch/harga berubah; konten
  divalidasi dari bytes (bukan extension/MIME).
- **Bounds (X06)**: boundary 2-row limit dengan config 2 diterima, 3 ditolak;
  file/expanded/cell/text/entry limit diuji tepat batas vs lebih; expanded
  di-charge sebelum inflate dan bom header bohong ditolak.
- **Upload staging + example 100→97/3 (X01/X03/X04)**: DB test 100 baris (97 valid
  + formula + teks nominal + action asing) → stage 97 pending/3 failed, apply →
  `partially_applied` 97/3, resume final tidak menulis apa pun; laporan `all`
  memuat 100 baris dan subset gagal 3 baris dengan reason tepat. E2E
  memverifikasi harga live belum berubah saat stage dan counts jujur di UI.
- **Report/subset (X04)**: laporan dibentuk dari row durable (bukan arsip upload),
  berisi nomor baris/SKU/action/target/status/reason; text literal (SKU
  `=SUM(A1)` diuji tetap text di export/laporan); byte workbook hanya di memory
  request.
- **Linked retry (X04)**: DB test + E2E: koreksi dengan `origin_row` ke row gagal
  final menjadi batch baru `parent_batch_id` + `origin_retry_row_id`, apply hanya
  baris koreksi; origin pending/applied/asing/unknown ditolak `ORIGIN_INVALID`;
  replay key+file sama `200` batch sama, payload beda `409`; row sukses batch
  asal tidak diulang dan row gagal tidak dibuka kembali.
- **Resume/crash (X03/X04)**: perilaku resume/chunk/`deriveBatchState` berasal dari
  pipeline ticket 04 yang sama (DB test 202 + resume hanya pending, contoh
  60/37/3 dikunci unit); ticket ini menambah bukti bahwa row final gagal tidak
  dapat direopen dan resume setelah final tidak menulis apa pun. Injeksi crash
  literal 60/37/3 tidak dijalankan ulang di sesi ini — perilakunya diverifikasi
  lewat seam yang sama, bukan klaim run baru.
- **A01/A04/D02**: grant matrix (viewer boleh download, tanpa products view-all
  ditolak, tanpa `prices` ditolak, upload butuh edit) diuji di domain + E2E
  (template/report/export/upload 403, direct URL `/admin/no-access`); audit
  `PRICE_CHANGE_STAGED` memuat source/template/parent/rowError; schema shared
  package + `timestamptz`, migrasi dihasilkan drizzle-kit, seed/cleanup
  FK-ordered lulus.

### Gap yang tidak diklaim

- **Tidak ada benchmark 1000 row / 25 MiB** dan tidak ada klaim parser aman untuk
  semua file adversarial di luar kasus yang diuji; batas adalah batas konfigurasi,
  bukan SLA.
- **Suite DB berbagi key config** (`discounts.contractVersion`,
  `discount.import.*`), jadi suite DB admin harus dijalankan serial
  (`--no-file-parallelism` / `verify:batch:unit`); run paralel antar-file dapat
  saling mengubah gate/limit.
- **`drizzle-kit push` tidak dipakai** untuk menerapkan `0046`/`0047` di sesi ini
  karena tool meminta prompt interaktif untuk drift lama `order_item_order_id_unique`
  (di luar scope). Perubahan constraint diterapkan persis dari SQL generated ke
  DB disposable; `db:check` PASS.
- **Standard `npm run test:e2e` live-provider tidak dijalankan** (butuh izin
  terpisah); yang dijalankan adalah mock config terisolasi. UAT staging,
  aktivasi gate `1` di environment operasional, rehearsal rollback, dan release
  tetap gate ticket 13/izin terpisah.
- Mirror provider post-invoice dengan Markdown dan refund/usage privacy tetap
  ticket lanjutan (bukan scope 05).
