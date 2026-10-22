# Harga Markdown manual per SKU — ticket 03

Halaman admin `/admin/products/harga` dan API `/api/admin/price-changes/**`
mengelola **satu target Markdown per SKU** untuk semua cabang, lalu
memproyeksikannya ke seluruh surface storefront hingga pembayaran. Markdown
adalah **potongan whole-line di provider**, bukan penurunan harga sumber dan
bukan kenaikan nominal pembayaran.

## 1. Model harga

Untuk variant dengan source (harga Jubelio) `B` dan target tersimpan `T`:

- `0 < T < B` → harga efektif `E = T`; coretan/badge aktif, original = `B` dari
  **variant yang sama**.
- `T` null atau `B <= T` → `E = B`; tanpa coretan, **target tetap tersimpan**
  dan aktif kembali saat `B` naik.
- Source sync hanya menulis `product_variant.price`. Modul harga tidak pernah
  menulis effective ke kolom source, sehingga target tidak terhapus oleh sync.
- `restore_base` memindahkan current pointer ke revision baru (target null) dan
  mengikuti source terbaru; histori/version tidak pernah di-reset.

Proyeksi read mengembalikan `sourceUnitPrice`, `effectiveUnitPrice`,
`storedTarget`, `markdownActive`, `markdownRevisionId`, dan `priceVersion`.
Kartu produk memilih variant dengan **effective** termurah (tie: variant ID
stabil), lalu menampilkan source variant itu sebagai coretan. Filter range,
sort harga, filter diskon, dan carousel homepage memakai proyeksi yang sama.
`hasDiscount` berarti ada Markdown efektif pada variant relevan — bukan selisih
`product.base_price` terhadap variant termurah (perilaku lama yang tidak lagi
dipakai).

Implementasi pure: `packages/db/src/markdown-pricing.ts`
(`projectMarkdownPrice`, `computePercentTarget`, `validateSetTarget`).
Ekspresi SQL yang setara: `apps/store/src/lib/variant-price-projection.ts`
(`effectivePriceSql`, `markdownActiveSql`).

## 2. Alur admin

`/admin/products/harga` (gate halaman `prices:view`):

1. Cari produk → pilih SKU (source, effective, status Markdown).
2. Stage satu baris manual: target fixed, atau shortcut persen (server
   membekukan target fixed dari source terbaru, half-up; 85% dari 100001 →
   85001). Restore tidak menerima target.
3. Review menampilkan source saat stage, effective kini, target, dampak
   (arah/rupiah/persen, termasuk kenaikan), dan peringatan
   (`TARGET_NOT_BELOW_SOURCE`, `MARKDOWN_ABSENT`, `SOURCE_PRICE_INVALID`).
4. Apply: satu transaksi per baris — lock batch → row → variant/source →
   current Markdown, validasi target terhadap **source terbaru**, revision
   immutable + current pointer + hasil row + audit. Tidak ada provider/HTTP di
   dalam transaksi.
5. Hasil `applied` / `unchanged` / `failed` + history revision.

Idempotensi:

- Stage memakai `requestKey` unik per actor. Key sama + command sama →
  `200` batch yang sama; command berbeda → `409 REQUEST_KEY_CONFLICT`.
- Replay apply tidak membuat revision/audit kedua. Row yang sudah final
  mengembalikan hasil tersimpan.
- No-op (restore tanpa Markdown atau target identik) menjadi `unchanged`:
  tidak ada revision fiktif, tetapi tetap diaudit sekali.
- Source/target berubah setelah stage **tidak** mewajibkan review ulang: apply
  memakai data terbaru; target yang tidak lagi valid gagal sebagai row tanpa
  menulis target.

## 3. Bulk harga (ticket 04)

Halaman `/admin/products/harga` memuat dua blok: satu baris manual (bagian 2) dan
blok **Bulk harga**. Bulk memakai jalur stage → review → apply yang sama; yang
berbeda hanya jumlah baris per batch dan cara memilih SKU.

### 3.1 Memilih SKU lintas halaman

- Pencarian memakai `GET /api/admin/price-changes/candidates` (`prices:view` +
  `products:view all_branches`): match case-insensitive pada SKU dan nama produk,
  urut `sku asc`, 25 baris per halaman (maks 100). Baris dengan source tidak valid
  tetap muncul (`basePrice`/`effectiveUnitPrice` null, badge "source tidak
  valid"), tidak bisa dicentang, dan tetap dihitung pada total supaya daftar dan
  pagination konsisten.
- Seleksi disimpan per variant di memori halaman, sehingga bertahan saat
  berpindah halaman atau mengganti kata kunci. Checkbox header hanya mencentang
  baris **halaman yang sedang tampil**; tidak ada aksi "pilih seluruh hasil
  filter". Hanya SKU yang dicentang yang dikirim ke server.

### 3.2 Batas jumlah baris

- `discount.import.maxRows` (default `1000`) dibaca **tidak ter-cache** pada
  setiap stage dan apply (`apps/admin/src/lib/discount-import-limits.ts`).
- Nilai invalid membuat operasi baru gagal `503 IMPORT_LIMITS_INVALID`, bukan
  fallback diam-diam ke default. Batas ini adalah batas konfigurasi operasional,
  bukan SLA atau benchmark waktu.
- Menurunkan limit **tidak** menghapus batch/row/revision yang sudah committed.
  Batch pending yang `rowCount`-nya melebihi limit baru ditahan saat apply:
  `haltReason = ROW_LIMIT_EXCEEDED`, tidak ada write row, dan row pending tetap
  pending.
- Body stage dibatasi statis `MAX_STAGE_ROWS_HARD_LIMIT = 5000`; limit efektif
  tetap config di atas, dan kelebihan limit → `400 ROW_LIMIT_EXCEEDED` tanpa
  mutation.

### 3.3 Stage dan review

- Satu aksi berlaku untuk semua SKU terpilih: `set_price` (target fixed per SKU
  atau shortcut persen) atau `restore_base`. Alasan opsional ≤500 karakter.
- Shortcut persen dikirim sebagai `discountPercent`; server menghitung target
  fixed dari **source (Base Price) terbaru** dengan pembulatan half-up lalu
  membekukannya di row stage, sehingga browser tidak pernah menjadi sumber angka.
  Contoh: base 300000 dengan potongan 20% → target 240000 (bukan 80% dari harga
  Markdown 150000 yang sedang aktif); 85% dari 100001 → 85001. Shortcut ini
  menghasilkan target **fixed** (half-up) dan bukan engine benefit percentage
  goods (ticket 10), yang menghitung diskon langsung dari subtotal setelah
  Markdown dengan pembulatan **floor** dan cap opsional.
- Stage menulis satu batch `staged` + seluruh row `pending` + satu audit
  `PRICE_CHANGE_STAGED` per row dalam **satu transaksi**; harga live tidak
  berubah. SKU yang tidak ditemukan atau source tidak valid tetap di-stage dengan
  `variantId: null` + warning, lalu difinalkan `failed` saat apply alih-alih
  menolak seluruh batch; pengecualiannya row shortcut persen, yang ditolak
  `400 INPUT_INVALID` karena target fixed-nya tidak bisa dibekukan. SKU duplikat
  dalam satu batch ditolak `400 INPUT_INVALID`.
- Review menampilkan jumlah baris/diterima/error, total dampak naik dan turun,
  lalu per row: SKU, variant, base saat stage, harga efektif kini, target, dampak
  (arah, rupiah, persen), serta status/warning. Baris `restore_base` menyebut
  "melepas Markdown" bila `storedTargetBefore` ada dan "tidak ada Markdown
  aktif" bila tidak.

### 3.4 Apply bertahap dan resume manual

- Satu klik apply memproses **maksimal 25 row atau 5 detik** per request, mana
  yang lebih dulu (`APPLY_MAX_ROWS_PER_REQUEST`, `APPLY_BUDGET_MS`). Tidak ada
  worker/background job: sisa row hanya dilanjutkan oleh klik berikutnya.
- Tiap row adalah **satu transaksi bounded sendiri** (bukan satu transaksi untuk
  1000 row): re-read policy, lock batch → row → variant/source → current Markdown,
  validasi target terhadap source terbaru, lalu revision immutable + current
  pointer + hasil row + audit dalam commit yang sama.
- Respons `202` selama masih ada row `pending`; `200` saat batch final. UI
  menampilkan counts server apa adanya — mis. 60 diterapkan, 37 pending, 3 gagal
  berarti **belum final**, dan "Lanjutkan apply" hanya memproses 37 row pending.
  Row final tidak pernah diproses ulang.
- Timeout statement/lock tidak pernah dianggap rollback: state row dibaca ulang
  secara durable, row yang sudah final dihitung, dan row yang masih pending
  dikembalikan jujur sebagai pending.
- Satu chunk bisa memproses lebih sedikit dari 25 row bila budget 5 detik habis
  lebih dulu; jumlah row per chunk bukan angka yang dijanjikan.
- `previewDigest` (SHA-256 dari preview yang direview) dicatat sebagai jejak
  audit, bukan token otorisasi.

### 3.5 Hasil yang jujur dan no-op

- Counts `applied/unchanged/failed/pending` selalu menjumlah `rowCount`; batch
  belum final selama `pending > 0`, dan state final mengikuti `applied`,
  `partially_applied`, atau `failed`.
- No-op (target identik dengan target tersimpan, atau restore pada SKU tanpa
  Markdown) menjadi `unchanged` tanpa revision/pointer baru, tetapi tetap satu
  audit `PRICE_CHANGE_UNCHANGED`. Resume tidak mengaudit ulang row final.
- Source/Markdown terbaru dipakai saat apply. Target yang tetap valid diterapkan
  tanpa review ulang wajib; target yang tidak lagi valid gagal sebagai row
  `TARGET_NOT_BELOW_SOURCE` tanpa menulis harga. `restore_base` melepas target
  terbaru, bukan target saat stage.

### 3.6 Idempotensi dan penghentian

- Stage memakai `requestKey` per actor; key sama + command sama → `200` batch yang
  sama, command berbeda → `409 REQUEST_KEY_CONFLICT`.
- Apply punya ledger `price_change_apply_request` dengan unik
  `(actor_identity, request_key)`. Key sama pada batch + digest yang sama
  melanjutkan chunk yang sama tanpa hasil row kedua; key sama dengan
  batch/digest berbeda → `409 REQUEST_KEY_CONFLICT`. Resume memakai key baru per
  klik.
- Grant `prices:view`/`prices:edit` global + `products:view all_branches` dibaca
  ulang di dalam transaksi setiap row. Revoke `prices:edit` di tengah apply
  menghentikan write berikutnya, mencatat `haltReason = POLICY_REVOKED`, dan
  **tidak** me-rollback row yang sudah commit; setelah grant dipulihkan, resume
  melanjutkan sisa row. Bila grant sudah dicabut sebelum request dimulai, respons
  adalah `403 DENIED` dan halt reason tetap dicatat pada batch. Viewer tanpa grant
  tidak bisa membaca hasil batch (`403`/`404`).
- `haltReason` ditampilkan sebagai error, bukan sukses: "Izin edit dicabut; sisa
  baris ditahan." atau "Batch melebihi batas baris terbaru; sisa baris ditahan."

### 3.7 Batas ticket ini

Parser/validator workbook `.xlsx`, template, dan export/laporan subset dibahas di
bagian 4 (**ticket 05**). Bulk di ticket 04 hanya menerima row JSON dari UI (SKU, action,
target fixed atau persen): tidak ada upload file, tidak ada arsip file, dan tidak
ada klaim UAT/aktivasi provider. Bukti test bulk (L/T/B) dicatat di
[testing](../testing/README.md).

## 4. Excel harga: template, upload, laporan, dan retry (ticket 05)

Blok **Excel harga** di `/admin/products/harga` memakai jalur stage → review →
apply yang sama dengan bulk; yang berbeda hanya asal baris (workbook) dan
kelengkapan laporan/retry. Implementasi: `apps/admin/src/lib/xlsx-container.ts`
(container ZIP bounded), `apps/admin/src/lib/price-workbook.ts` (kontrak
workbook), dan `apps/admin/src/lib/price-changes-administration.ts`
(`stageWorkbookPriceChange`, `exportPriceChangeWorkbook`,
`getPriceChangeReport`).

### 4.1 Format template

- Satu workbook `.xlsx` dengan **satu** sheet bernama `Harga`.
- `A1` literal `OKCIR_MARKDOWN_V1`.
- Header row 2: `sku`, `action`, `new_price` (urutan ini), lalu hanya kolom
  referensi resmi `row_number`, `product_name`, `variant`, `source_price`,
  `effective_price`, `origin_row`, `status`, `error_reason`. Header asing/duplikat/hilang/bergeser
  = fatal; kolom referensi **tidak** otoritatif.
- Data mulai row 3. `sku` harus sel text persis (case-sensitive, spasi tidak
  dinormalisasi); `action` literal `set_price`/`restore_base`; `new_price` angka
  integer Rupiah. `set_price` wajib target > 0; `restore_base` wajib harga
  kosong. Harga kosong pada `set_price` **bukan** restore.
- Template kosong, export SKU, laporan, dan subset gagal memakai writer yang
  sama: semua text ditulis sebagai inline string, jadi nilai berawalan `=`,
  `+`, `-`, `@` tetap literal dan tidak pernah menjadi formula.

### 4.2 Parser bounded dan aman

- Container diperiksa dari bytes, bukan extension/MIME: signature ZIP, EOCD,
  central directory, satu disk, tanpa ZIP64; OLE/legacy/encrypted ditolak.
- Entry: maksimum 200, nama wajib aman (tanpa `..`, absolut, backslash, NUL,
  duplikat), flag enkripsi/kompresi tak didukung ditolak, CRC dan ukuran tiap
  entry diverifikasi.
- Batas ditegakkan **selama** membaca: bytes terkompresi (`maxFileBytes`, default
  5 MiB), total bytes setelah dekompresi (`maxExpandedBytes`, default 25 MiB),
  jumlah baris data non-blank (`maxRows`, default 1000), 100 sel/row, dan 4096
  karakter/sel. Ukuran deklarasi tiap entry dibebankan ke budget SEBELUM
  dekompresi, dan `zlib.inflateRawSync` diberi `maxOutputLength` sebesar ukuran
  yang sudah dibebankan itu — header ZIP yang berbohong tidak bisa berubah jadi
  alokasi tak terbatas.
- Macro (`vbaProject.bin`/`macroEnabled`), external relationship
  (`TargetMode="External"`/`xl/externalLinks`), sheet tambahan, marker/header
  salah, dan container rusak = fatal: `400 WORKBOOK_REJECTED` + `details.reason`,
  **sebelum** transaksi stage sehingga tidak ada batch/harga yang berubah.
- Formula tidak dievaluasi, cached value tidak dipercaya: sel formula menggagalkan
  row-nya (termasuk formula pada kolom referensi). Baris yang seluruhnya blank
  diabaikan; baris yang hanya berisi kolom referensi juga diabaikan; baris
  terisi sebagian tanpa SKU gagal row. SKU duplikat menggagalkan **semua**
  kemunculannya (bukan last-row-wins). SKU unknown tidak menghalangi baris valid:
  ia tetap di-stage lalu difinalkan `failed` (`VARIANT_NOT_FOUND`) saat apply.

### 4.3 Upload hanya staging

- Upload tidak pernah mengubah harga. Row valid menjadi `pending`; row yang
  gagal validasi menjadi **failed final** dengan nomor baris sheet, `resultCode`
  (`FORMULA_NOT_SUPPORTED`, `DUPLICATE_SKU`, `SKU_REQUIRED`, `SKU_NOT_TEXT`,
  `ACTION_INVALID`, `PRICE_REQUIRED`, `PRICE_INVALID`, `PRICE_NOT_ALLOWED`,
  `ORIGIN_ROW_INVALID`), dan raw action/target untuk laporan.
- Apply memakai pipeline ticket 04 apa adanya: maksimum 25 row/5 detik per
  request, satu transaksi per row, source/Markdown terbaru, no-op jadi
  `unchanged`, dan counts jujur. Contoh 100 baris input dengan 3 row error:
  stage `pending 97 / failed 3`, apply menghasilkan `97 diterapkan / 3 gagal`
  dan state `partially_applied` — bukan "100 sukses".
- Batch yang belum final hanya melanjutkan row `pending`; row final
  (applied/unchanged/failed) tidak pernah diproses ulang. Error final hanya
  diperbaiki lewat batch koreksi baru, bukan dengan membuka kembali row lama.

### 4.4 Laporan, subset gagal, dan linked retry

- `GET /api/admin/price-changes/{id}/report?subset=all|failed` dibentuk dari row
  durable (bukan arsip upload) dan memuat `row_number`, SKU, action, target,
  `status`, dan `error_reason`. Nilai text tetap literal.
- Subset gagal adalah input retry: tiap baris mengisi `origin_row` dengan nomor
  baris dirinya sendiri. Setelah diperbaiki, file diunggah lewat multipart
  dengan `parentBatchId` batch asal.
- Server memvalidasi linkage sebelum menulis row: batch asal harus ada, setiap
  `origin_row` unik dan menunjuk row **failed final** batch itu. Row
  pending/applied/unchanged tidak bisa dibuka kembali (`400 ORIGIN_INVALID`);
  `origin_row` tanpa parent juga ditolak. Row tertaut menyimpan
  `origin_retry_row_id`, sehingga 97 row sukses batch asal tidak diulang.
- Request key baru per koreksi; replay key+file yang sama mengembalikan batch
  yang sama tanpa duplikasi, file berbeda dengan key lama → `409
  REQUEST_KEY_CONFLICT`.
- Upload workbook asli tidak diarsipkan. Byte file hanya hidup di memory request
  (dibatasi content-length + ukuran file) dan dilepas saat request selesai; yang
  durable hanya row input/hasil/audit.

### 4.5 Izin, log, dan batas

- Template/export/laporan/subset memerlukan `prices:view` global +
  `products:view all_branches`; upload memerlukan `prices:edit`. Grant dibaca
  per request (bukan dari UI), jadi direct API tidak bisa melewati UI.
- Setiap endpoint mencatat structured log: `info` sukses (batch id, counts,
  bytes — tanpa isi workbook/daftar SKU), `warn` untuk penolakan/`409`/fatal
  dengan `reason`, dan `error` kontekstual untuk kegagalan tak terduga.
- Batas row/byte adalah batas konfigurasi operasional (`discount.import.*`),
  bukan SLA atau benchmark. Menurunkan limit tidak menghapus hasil committed.

## 5. Schema dan retensi

Tabel Markdown manual (migrasi `0041_even_wong.sql`), ledger apply ticket 04
(`0045_young_shiva.sql`), dan constraint row workbook ticket 05
(`0046_short_pride.sql`, `0047_rainy_captain_cross.sql`):

- `price_change_batch` — command/attribution, state, counts (selalu menjumlah
  `row_count`), receipt key `(actor_identity, request_key)`, plus
  `template_version` (workbook), `parent_batch_id` (koreksi), `source`
  `manual|bulk|xlsx`.
- `price_change_batch_row` — input/preview non-otoritatif, hasil final
  before/after, `applied_revision_id`, `origin_retry_row_id` (self-FK ke row
  gagal batch asal). Row hasil parser workbook yang gagal disimpan sebagai
  `failed` final: `input_sku` boleh kosong dan `action` boleh `invalid` hanya
  pada state `failed`, dan CHECK menolak row `invalid` yang masih pending.
- `variant_price_revision` — revision immutable: action, target, source,
  effective, previous target/effective, batch/row attribution, actor identity.
  CHECK menolak revision yang mengklaim coretan/effective tidak konsisten.
- `variant_price_current` — satu pointer per variant, `version` = revision_no
  (monotonic), composite FK ke `(variant_id, revision_id)`.
- `price_change_apply_request` — ledger command apply/resume: unik
  `(actor_identity, request_key)`, FK `batch_id` RESTRICT, `preview_digest`
  opsional. Dipakai untuk replay/resume dan konflik key tanpa hasil row kedua.

FK variant/revision/current bersifat `RESTRICT`: histori Markdown melindungi
variant/catalog dari cascade delete. `price_change_batch_row.applied_revision_id`
→ revision adalah FK; arah sebaliknya adalah `UNIQUE(batch_row_id)` agar tidak
ada siklus FK yang membuat seeder tidak bisa menghapus FK-ordered. Seed-cleanup
mereset row (`state='pending'`, `applied_revision_id=NULL`) sebelum revision
dihapus.

Seeder mode demo membuat histori nyata: `SS-WHT-41` aktif 850000→750000,
`SS-BLK-41` tetap aktif setelah source naik ke 900000, `OX-BLK-41` fallback
(source turun ke target 1400000), dan `CS-NVY-40` set lalu restore (pointer ke
revision 2). Seeder juga membuat satu batch bulk `staged` berisi 3 row `pending`
(`SS-WHT-41`, `SS-BLK-41`, `OX-BLK-41`) yang belum menulis revision/pointer dan
tidak mengubah `product_variant.price`, supaya layar bulk punya data demo. Seed
hanya untuk database disposable.

## 6. Checkout dan pembayaran

- Preview pickup/delivery dan cart membangun pricing snapshot dengan
  `sourceUnitPrice` + `effectiveUnitPrice` + `markdownRevisionId`.
- Place order me-revalidasi source **dan** pointer Markdown di dalam transaksi
  (setelah lock variant). Jika effective/revision berbeda dari review →
  `CHECKOUT_REVIEW_REQUIRED` sebelum order/stock/SO dibuat. Order lama tidak
  pernah direprice.
- Provider (Jubelio Sales contract 2): `items[].price` = source, `disc_amount` =
  Markdown whole-line (+ alokasi Offer goods pada slice berikutnya), `amount` =
  gross − disc, `sub_total` = Σgross, `total_disc` = Σdisc, `add_disc`/fee/tax =
  0, `shipping_cost_discount` tidak dikirim. `grand_total`/invoice/payment =
  net goods + net shipping (`expectedProviderPayable`). `disc` persentase
  diturunkan dari nominal, bukan diskon kedua.
- Midtrans item details memakai harga efektif + satu penyesuaian diskon barang;
  jumlah detail tetap sama dengan total snapshot.
- Order/account/admin read membaca snapshot immutable; tidak ada perhitungan
  ulang dari master saat read.

## 7. Otorisasi

Module Global baru `prices` dengan `view`/`edit` saja:

| Tindakan | Grant |
| --- | --- |
| Baca batch/review/history | `prices:view` global + `products:view all_branches` |
| Stage/apply/restore | di atas + `prices:edit` global |

Grant dibaca ulang **di dalam transaksi** setelah SHARE lock Admin User → Role,
sehingga revoke bersamaan menyerialkan write. Fresh seed HQ mendapat
`prices:view/edit`; Admin tidak. Role existing/custom tidak diberi grant
otomatis oleh migrasi. Re-sync produk (`products:edit`) bukan izin harga.

## 8. Bukti verifikasi (ticket 03–05)

- L: `packages/db/src/markdown-pricing.test.ts` (literal §4.1/§4.4, shortcut
  persen, validasi target) dan `apps/store/src/lib/versioned-pricing.test.ts`
  (builder menerima Markdown tervalidasi).
- T: `packages/db/src/variant-pricing.db.test.ts` (constraint/retention/FK),
  `apps/admin/src/lib/price-changes-administration.db.test.ts` (stage/apply/
  replay/no-op/restore/stale source/race/revoke/gate), dan
  `apps/store/src/lib/variant-price-projection.db.test.ts` (SQL vs JS sama).
- H: `apps/store/src/lib/markdown-provider-contract.test.ts` (payload provider,
  decoder intent, cross-check snapshot).
- B: `e2e/store/markdown-mock.spec.ts` (katalog dua cabang, filter/sort,
  kartu/detail/cart/preview, stale review ditolak sebelum commit),
  `e2e/store/markdown-settlement-mock.spec.ts` (pickup source300000→150000:
  Snap 166500, provider gross300000/disc150000, invoice+payment 150000,
  ready_for_pickup) dan `e2e/admin/price-change-mock.spec.ts`
  (stage→review→apply→history, replay, denial direct URL/API).
- T (ticket 05): `apps/admin/src/lib/price-workbook-administration.db.test.ts`
  (upload staging dengan row gagal final, apply parsial + laporan, koreksi
  tertaut dengan replay/konflik/linkage invalid, fatal tanpa batch, limit tepat
  batas, contoh 100→97/3, export literal, izin download/upload).
- L/H (ticket 05): `apps/admin/src/lib/price-workbook.test.ts` (kontrak
  marker/header/row/formula/duplikat/bounds + writer literal) dan
  `apps/admin/src/lib/xlsx-container.test.ts` (signature, traversal, duplikat,
  entry/expanded limit, bom header bohong, CRC, enkripsi).
- B (ticket 05): `e2e/admin/price-change-excel-mock.spec.ts` (template via
  HTTP, upload→preview→apply parsial→laporan/subset, koreksi tertaut tanpa
  mengulang row sukses, replay/409, workbook macro ditolak, denial Admin).

## 9. Batas yang belum ditutup ticket ini

- Bulk/Excel: bulk JSON (bagian 3) dan Excel/template/laporan/retry (bagian 4)
  sudah tersedia; keduanya tetap tunduk pada gate operasional dan grant saat
  request.
- Offer/Coupon dan alokasi goods allocation (ticket 07/10).
- End-to-end provider nyata dan mirror post-invoice dengan Markdown (slice
  berikutnya + evidence bounded); standard live-provider E2E tidak dijalankan.
- UAT staging, aktivasi gate domain `1` di environment operasional, dan
  deployment/rehearsal (ticket 13/izin terpisah).
