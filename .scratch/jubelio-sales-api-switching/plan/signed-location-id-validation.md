# Plan: hapus syarat positif pada ID lokasi Jubelio

## Tujuan

Menghilangkan blocker internal yang menolak ID lokasi negatif dari Jubelio tanpa menghapus validasi format, kecocokan cabang, atau financial snapshot. Status plan dicatat hanya di [index fitur](../index.md).

## Approval

- Kesepahaman scope dikonfirmasi dalam percakapan: user memilih **“Validator saja (Recommended)”**. Scope mencakup penghapusan batas positif khusus lokasi, regression tests, dan docs; recovery order lama terpisah.
- Approval complete plan dan acceptance/verification criteria: user menyetujui melalui “oke tolong jalankan perubahan” setelah membaca plan dan ringkasan flow. Implementasi dibatasi validator, regression tests, dan docs; recovery order lama tetap di luar scope.
- Tidak ada izin implisit untuk subagent, commit, deployment, perubahan data existing, atau write Jubelio.

## Temuan audit

Audit menelusuri `locationId`, `location_id`, `loc_id`, `jubelioLocationId`, dan `jubelio_location_id` pada `apps/` dan `packages/`, termasuk penggunaan helper positive-integer, guards checkout, mapping sync, schema, gateway, dan consumers decoder. Generated migration tidak diedit.

| Area | Fakta terverifikasi | Keputusan |
|---|---|---|
| `apps/store/src/lib/jubelio-sales-expected.ts:191` | Decoder contract v2 memakai `requirePositiveInteger(create.locationId, ...)`. Ini satu sumber syarat lokasi positif yang ditemukan. | Ganti khusus pemanggilan untuk lokasi; jangan melonggarkan helper yang juga memvalidasi item/tax ID. |
| `apps/store/src/lib/jubelio-sales-lifecycle.ts:710` | Settlement authority membaca decoder bersama sebelum invoice/payment diteruskan. | Regression coverage di public settlement seam; tidak perlu mengubah orchestrator. |
| `apps/store/src/lib/jubelio-channel-mirror.ts:1250` dan `:1280` | Mirror memakai decoder yang sama, sehingga terdampak syarat positif walaupun tidak punya guard positif lokasi sendiri. | Regression coverage mirror; financial/invoice-link guards tetap berlaku. |
| `apps/store/src/lib/jubelio-sales-client.ts:674` | Create gateway mensyaratkan integer, bukan positif. | Pertahankan; test existing lokasi negatif menjadi regression baseline. |
| `apps/store/src/lib/jubelio-sales-client.test.ts:1657` | Test existing membuktikan create request dan confirmation lokasi `-1`. | Jalankan kembali; bukan bukti test dijalankan pada sesi audit ini. |
| `packages/db/src/jubelio-sync.ts:540` | Sync sudah mengenali outlet dengan `location_id -1`. | Tidak perlu mengubah sync. |
| `packages/db/src/schema/branches.ts:36` | Mapping lokasi memakai kolom integer unique; tidak ada positive check pada definisi ini. | Tidak perlu schema/migration/seeder change. |
| `apps/store/src/features/checkout/checkout-attempt-repository.ts:216` | Lokasi request harus sama dengan mapping cabang aktif. | Pertahankan. |
| `apps/store/src/app/api/checkout/place-order/route.ts:513` | Mapping lokasi yang tidak tersedia ditolak dengan null check. | Pertahankan. |

Bukti domain: [docs lokasi Tangerang](../../../../docs/features/jubelio-sales-orders.md) mencatat `location_id: -1`. Log order `4560babc-ff35-4df5-b5dd-82f5a6d4672a` pada `logs/store.log:471–477` menunjukkan Midtrans settlement berhasil, lalu invoice ditahan oleh settlement authority. Diagnosis database read-only sebelumnya menemukan blocker `SALES_CONTRACT_SHAPE_INVALID: sales create intent locationId must be a positive integer` dan stored location `-1`. Tidak menyimpan raw customer payload atau credentials dalam artefak ini.

## Scope dan acceptance criteria

1. Decoder contract v2 menerima signed safe integer untuk `locationId`: negatif, nol, dan positif tidak ditolak berdasarkan tanda. Nilai diteruskan apa adanya; tidak memakai `Math.abs`, penggantian default, atau remapping.
2. `-1` menjadi regression case utama karena terverifikasi pada Tangerang; tambahkan ID negatif lain untuk memastikan tidak ada hardcode exception `-1`.
3. Nol lolos **validasi format**, bukan otomatis menjadi lokasi provider yang sah. Mapping cabang dan independent provider confirmation tetap wajib; tidak ada klaim bahwa Jubelio memiliki lokasi nol.
4. Nilai hilang/`undefined`, `null`, string numerik, boolean, pecahan, `NaN`, infinity, dan integer di luar safe range tetap ditolak dengan `SALES_CONTRACT_SHAPE_INVALID`. Tidak menambah implicit coercion.
5. Contract version, harga, discount, shipping, payable, item/tax ID, quantity, serta ID SO/invoice/payment tidak dilonggarkan. Legacy branch tidak berubah.
6. Settlement fixture contract v2 dengan lokasi `-1` dapat mencapai invoice/payment confirmed melalui gateway fake yang terkontrol; nominal dan linkage tetap diverifikasi. Invoice dengan lokasi berbeda tetap ditolak.
7. Mirror fixture dengan header/item/request lokasi `-1` yang sama lolos pre-read validation; perbedaan lokasi tetap ditolak. Financial drift dan invoice-link mismatch tetap fail closed.
8. Docs menjelaskan ID lokasi sebagai identifier bertanda, bukan besaran positif, dan tidak menjanjikan order existing pulih otomatis.

## Non-scope

- Recovery order `4560BABC`, backfill, reset ledger, replay webhook, penghapusan blocker existing, atau membuat invoice/payment untuk order nyata.
- Write atau autentikasi POST ke Jubelio, write payment provider, dan pengujian memakai transaksi nyata.
- Menghapus validasi format/kecocokan lokasi, mengubah Home Branch/RBAC, copy UI, atau menambah tombol verifikasi manual.
- Menghapus syarat positif dari item ID, tax ID, SO ID, invoice ID, payment ID, detail ID, quantity, maupun konfigurasi timeout.
- General hardening semua integer guard gateway, refactor modul besar, schema/env/cron/deployment changes.

## Technical blueprint

Layer mengikuti [code organization](../../../../docs/architecture/code-organization.md). Semua path berikut relatif terhadap root repo.

| Path | Aksi | Tanggung jawab / layer | Public test seam |
|---|---|---|---|
| `apps/store/src/lib/jubelio-sales-expected.ts` | modify | Shared provider-contract decoder; validasi signed safe integer khusus lokasi, error terstruktur existing. | `readJubelioSalesOrderExpectation`, `readSettlementAuthorityRecord` |
| `apps/store/src/lib/jubelio-sales-expected.test.ts` | modify | Unit regression format ID lokasi dan authority contract v2. | Dua export decoder di atas; literal independent fixtures |
| `apps/store/src/lib/jubelio-sales-versioned.db.test.ts` | modify | Integration dengan PostgreSQL fixture terisolasi dan gateway fake; settlement negatif serta mismatch lokasi. | `settleJubelioSalesOrder`, ledger/order reads |
| `apps/store/src/lib/jubelio-channel-mirror.test.ts` | modify | Regression pre-read lokasi signed dan mismatch, tanpa provider nyata. | `mirrorPreReadMismatch` |
| `docs/features/jubelio-sales-orders.md` | modify | Dokumentasi kontrak signed lokasi dan batas recovery. | Review terhadap acceptance criteria |
| `.scratch/jubelio-sales-api-switching/index.md` | modify | Approval, status, dan link evidence plan ini tanpa mengubah status plan lain. | Review artefak |

Kontrak export tetap, tidak menambah modul/export baru:

- `readJubelioSalesOrderExpectation(payload: unknown): JubelioSalesOrderExpectation` — contract v2 memakai signed safe integer lokasi; legacy tidak berubah.
- `readSettlementAuthorityRecord(input: { createPayload: unknown; orderRow: PersistedOrderPricingRow }): JubelioSalesOrderExpectation` — menerima lokasi signed melalui decoder, tetap membandingkan dua record immutable.
- Tidak mengubah signature settlement/gateway/mirror. Bila helper dibutuhkan, private dan khusus format lokasi/signed integer; `requirePositiveInteger` untuk item/tax tetap utuh.

Keputusan struktur: perbaiki sumber decoder sekali, bukan bypass terpisah di settlement/mirror. Alternatif mengubah helper positif global ditolak karena melonggarkan identifier lain. Tidak menambah logging data mentah; contextual logging dan error code existing dipertahankan.

## UX blueprint

N/A — backend contract validation saja. Tidak mengubah layout, komponen, copy, state UI, navigation, atau izin Home Branch. Tidak memerlukan prototype atau frontend acceptance baru. UI order lama tidak dijadikan bukti recovery karena recovery dikecualikan.

## Urutan implementasi dan verifikasi

Satu slice terverifikasi; tidak menerbitkan ticket breakdown multi-session.

1. Muat skill `ux-design`, `maintainable-code`, `tdd`, dan `systematic-debugging` sebelum coding/test work; baca panduan backend terkait. Lindungi dirty worktree existing, khususnya perubahan Jubelio lifecycle/client yang tidak termasuk scope edit.
2. Context7: belum diperlukan untuk penyusunan dokumen. Perubahan produksi hanya validasi JavaScript internal, sehingga tidak menyentuh API eksternal. Sebelum menulis test Vitest/DB, lakukan checkpoint Context7 sesuai package/API yang dipakai; bila tidak reachable gunakan installed types/source dan catat fallback. Jangan menulis API library dari ingatan.
3. Tulis failing tests di public decoder, mirror, dan settlement seam untuk `-1`. Main agent menjalankan focused tests untuk membuktikan red; tidak mengakses provider nyata.
4. Ubah hanya guard lokasi decoder, lalu lengkapi matrix invalid values, signed values, dan wrong-location regression. Expected nominal/linkage berasal dari literal fixture, bukan hasil helper yang sedang diuji.
5. Jalankan L0 `npm run verify:types:store`.
6. Jalankan L1 dengan daftar eksplisit:
   ```sh
   npm run verify:unit:slice -- apps/store/src/lib/jubelio-sales-expected.test.ts apps/store/src/lib/jubelio-channel-mirror.test.ts apps/store/src/lib/jubelio-sales-versioned.db.test.ts apps/store/src/lib/jubelio-sales-client.test.ts
   ```
   DB integration memerlukan PostgreSQL dan schema sesuai. Gunakan fixture disposable dengan cleanup terisolasi; jangan mengubah order nyata, `db:reset`, atau menganggap skipped DB suite sebagai pass.
7. Jalankan L2 `npm run verify:batch:unit` sekali setelah slice; simpan log bounded di luar repo dan catat summary/failures. Tidak ada mock E2E yang berubah karena tidak ada UI/routing/auth change. Full legacy `npm run test:e2e` tidak dijalankan tanpa izin terpisah.
8. Sebelum commit/PR, penuhi full suite sesuai AGENTS; commit sendiri tetap butuh izin. Jangan mengulang suite identik yang sudah lulus tanpa perubahan relevan; rekam evidence yang ada.
9. Review diff terhadap acceptance, pastikan tidak ada relaxation pada money/linkage/non-location IDs; update docs dan index dengan evidence. Plan tetap tersimpan saat Done.

## Risiko dan batas klaim

- Perbaikan decoder menghilangkan false blocker, bukan menjamin provider menerima semua integer. Provider tetap source of truth lokasi dan invoice/payment.
- Order lama mungkin tetap blocked karena operation invoice belum ada dan recovery existing bersifat GET-only. Tidak mengubah kebijakan itu dalam slice ini.
- Full suite mungkin terpengaruh dirty worktree existing; laporkan failure dan blocker secara eksplisit, jangan menimpa perubahan unrelated.
- Tahap audit/penyusunan awal tidak menjalankan tests atau mengubah kode aplikasi. Implementasi dan hasil verifikasi sesudah approval dicatat di bawah; tidak melakukan recovery order existing.

## Open items

- Context7 checkpoint: `/vitest-dev/vitest/v4.1.6` (installed Vitest 4.1.10; dokumentasi v4 terdekat tersedia) — dikonfirmasi `toThrow(expect.objectContaining(...))` dan async `resolves` wajib di-`await`. Sumber: https://github.com/vitest-dev/vitest/blob/v4.1.6/docs/api/expect.md. API DB tidak berubah; tests memakai fixture/helper existing.
- Perubahan produksi memakai validasi JavaScript internal saja, tanpa perubahan API library. Visual review N/A karena tidak ada perubahan UI.
- L2 belum lulus: delapan suite existing memerlukan database disposable dengan prefix `marketplace_discounts_test_*`; environment default saat run menunjuk `storefront`. Jangan bypass safety guard atau menandai Done sebelum gate selesai.

## Hasil implementasi dan verification

- Produksi: hanya guard lokasi pada `apps/store/src/lib/jubelio-sales-expected.ts` diubah dari positive integer menjadi signed safe integer. Helper positif item/tax, consumers settlement/mirror, route, schema, env, dan RBAC tidak diubah.
- Tests: tambah matrix signed/invalid lokasi dan paired-record authority, mirror signed/mismatch/money/linkage, serta settlement delivery `-1` dengan invoice/payment confirmed melalui fake gateway. Fixture mismatch invoice lokasi `15` terhadap intent `-1` tetap manual review tanpa payment.
- Docs enduring: bagian ID lokasi pada `docs/features/jubelio-sales-orders.md` diperbarui, termasuk batas recovery.

| Gate | Hasil aktual | Evidence lokal disposable |
|---|---|---|
| RED decoder | 1 failed, 3 passed; error tepat `sales create intent locationId must be a positive integer` | `/tmp/signed-location-red.log` |
| GREEN decoder awal | 4 passed setelah perbaikan guard | `/tmp/signed-location-green-decoder.log` |
| L0 `npm run verify:types:store` | PASS, exit 0 | `/tmp/signed-location-types.log` |
| L1 empat file eksplisit sesuai plan | 4 files passed; 204 passed, 1 skipped. Skip adalah sentinel `environment blocker` yang memang di-skip ketika DB tersedia; integration settlement baru benar-benar berjalan. | `/tmp/signed-location-slice.log` |
| L2 `npm run verify:batch:unit` | 157 files passed, 8 failed, 3 skipped; 1729 tests passed, 48 skipped. Delapan failure pada suite setup safety guard DB, bukan assertion regresi lokasi. | `/tmp/signed-location-batch.log` |
| Review diff | Guard positif non-location tetap utuh; tidak ada coercion/remapping atau perubahan UI/API/schema. `git diff --check` file kode/tests lulus. | Diff empat file implementasi |

Delapan suite terblokir: `packages/db/src/discount-schema.db.test.ts`, `packages/db/src/rbac/discount-grants.db.test.ts`, `apps/store/src/lib/checkout-admission.db.test.ts`, `apps/admin/src/lib/discount-operations-read.db.test.ts`, `apps/admin/src/lib/discounts-administration.db.test.ts`, `apps/admin/src/lib/price-changes-administration.db.test.ts`, `apps/admin/src/lib/price-workbook-administration.db.test.ts`, dan `apps/admin/src/features/orders/checkout-attempt-review-repository.db.test.ts`. Seluruhnya menolak database non-disposable. Tidak memperbaiki atau menghapus guard ini.

Focused integration menggunakan fixture existing dengan prefix terisolasi dan cleanup; tidak mengubah order `4560BABC`. HTTP gateway tests memakai mock/fake, bukan write Jubelio nyata. Tidak menjalankan legacy E2E, commit, atau deployment. Next action untuk menutup L2: siapkan/konfirmasikan DB disposable ber-schema sesuai dengan nama `marketplace_discounts_test_*`, lalu jalankan batch dengan `DATABASE_URL` eksplisit tanpa mengubah `.env` runtime. Jangan mengulang focused suite yang sudah lulus tanpa perubahan relevan.
