# 03 — Markdown manual dari admin sampai pembayaran

Label: ready-for-agent
Type: task
Status: resolved
Assignee: main-agent
Blocked by: 02
Parent: [Map implementasi diskon](../map.md)
Spec: [Complete spec](../../../plan/discounts-spec.md)
Acceptance IDs: M01, M02, M03, F02, T06, P01, P02, P03, A01, A04, D01, D02

## Perilaku yang dibangun

Admin berwenang mengubah/menghapus Markdown satu SKU melalui stage→review→apply. Customer melihat harga SKU yang sama pada seluruh cabang dan seluruh surface, lalu membayar nominal tersebut; potongan tercatat sebagai whole-line discount di Jubelio, bukan source price diturunkan atau payment dinaikkan.

Reuse checkout review/idempotency02 dan snapshot01. Buat batch satu-row/manual dengan durable result/revision/audit yang dapat diperluas04, bukan direct-update bypass.

## Acceptance criteria

- [x] Base SKU300000/target150000 → effective150000; katalog/homepage/detail/cart/preview/checkout konsisten. Coretan berasal dari variant yang sama, bukan group RRP atau harga variant lain. Filter/sort/range memakai effective projection yang sama.
- [x] Base menjadi120000 atau sama150000 → tanpa coretan/badge, target tetap tersimpan; base naik400000 → target150000 aktif kembali. Harga sama antar-cabang, stock tetap branch-scoped; sync source tidak menghapus/menimpa target.
- [x] Target baru positif dan di bawah source terbaru saat apply; stale source/Markdown memakai data terbaru tanpa review ulang wajib. Restore melepas Markdown terbaru, memakai base terbaru, tidak menghidupkan target lama lagi. Histori/version monotonic tetap.
- [x] Review admin menunjukkan actual current/base/target/dampak, termasuk kenaikan. Apply/result/revision/current pointer/audit satu transaksi; replay tidak membuat perubahan/audit ganda. No-op tidak membuat revision fiktif.
- [x] `prices:view/edit` dan products view-all ditegakkan pada direct URL/API/history/stage/apply. Re-sync permission bukan harga permission; fresh HQ defaults sesuai spec, custom roles tidak auto-grant. Roles ceiling/coverage/current policy termasuk revoke race tetap berlaku.
- [x] Order contoh source300000→target150000, PPN11% → customer166500/provider150000; provider price300000/disc_amount150000 whole-line, add_disc0/tax0/fee0. Qty2 tidak mengalikan diskon dua kali.
- [x] Order/request/snapshots lama tidak direprice setelah set/restore/source sync. Review checkout yang stale ditolak sebelum order commit; replay accepted order tetap sama.
- [x] Create/invoice/payment/recovery/mirror mendukung kontrak diskon baru dengan independent expected money/IDs/linkage verification. Mirror pre/post invoice informational, preserve money/IDs dan omit shipping discount field. Zero-discount guard dilonggarkan hanya pada validated versioned path, bukan dihapus global.
- [x] Mismatch1/timeout/5xx/missing ID/GET fail menahan tahap berikut, menjaga intent/known IDs dan paid-but-blocked. Tidak blind retry/cancel ambigu. Bukti M1/M2 dipakai bounded, bukan dites ulang otomatis.
- [x] FK revision/current/variant/order references menjaga histori, schema/seed/shared projection dan logs/docs ikut diperbarui; writer gate tetap0 di environment operasional.

## Verifikasi

L/H/B: seluruh surface, variant pairing/filter/sort dan fallback/restore dengan source updates terkendali. T real PG: concurrent apply/source update, one-row replay/no-op/current grants, audit actual before-after dan retention SQL seam. H external controlled SO→invoice→payment→mirror dengan literal independent qty1/qty2; B admin review sampai store checkout/detail/repayment. Pertahankan tests baseline01/02.

## Batas dan penyelesaian

Bulk/Excel ditangani04/05; jangan membangun seluruh import pipeline di sini. Tidak ada Offer/Redemption, service fee atau proof pembayaran/provider Rp0. Baca [kontrak bersama](../map.md#kontrak-bersama-untuk-semua-ticket); izin eksekusi dan semua tindakan sensitif tetap terpisah. Main agent menjalankan tests/review dan merekam Answer sebelum resolved.

## Answer

Status: resolved. Implementasi di worktree utama `worktree/diskon`; main agent
menjalankan seluruh validation. Tidak ada commit/push, provider nyata, remote,
Docker remote, atau deployment. Gate operasional tetap `0` (hanya DB disposable
yang memakai `1`).

### Yang diimplementasikan

- **Kontrak harga (L):** `packages/db/src/markdown-pricing.ts` —
  `projectMarkdownPrice` (target aktif hanya saat `0<target<source`; fallback
  menyimpan target), `computePercentTarget` (half-up; 85% dari 100001 → 85001),
  `validateSetTarget`. `buildPricingSnapshot` menerima line Markdown
  (effective < source wajib `markdownRevisionId`; sebaliknya wajib null).
- **Schema (D):** `price_change_batch`, `price_change_batch_row`,
  `variant_price_revision`, `variant_price_current`
  (`packages/db/src/schema/prices.ts`) + migrasi drizzle-kit
  `0041_even_wong.sql` dan `0042_mushy_shocker.sql` (CHECK module `prices`).
  FK/CHECK: money whole-Rupiah, target/action shape, markdown/effective/previous
  consistency, counts = row_count, unique revision per variant dan per batch
  row, current composite ownership FK, retention RESTRICT. Seeder demo membuat
  revision set/fallback/restore + batch applied; seed-cleanup dan reset row
  diurutkan FK-aman.
- **Admin (T/H/B):** `apps/admin/src/lib/price-changes-administration.ts` —
  stage satu row manual (request key, percent shortcut dibekukan server),
  detail/review, apply satu transaksi (lock policy→batch→row→variant→current;
  validasi target vs source terbaru; revision + pointer + hasil + audit), no-op
  `unchanged` tanpa revision, replay tanpa duplikasi, history paginasi. Route
  `POST /api/admin/price-changes`, `GET /api/admin/price-changes/{id}`,
  `POST .../apply`, `GET /api/admin/prices/{variantId}/history`; UI
  `/admin/products/harga` (stage→review→apply→history) + nav.
- **RBAC:** Global Module `prices` (`view/edit` saja) di katalog, SQL CHECK,
  matrix label, dan fresh HQ seed; `products:view all_branches` diwajibkan
  berdampingan. Domain writer membaca gate `discounts.contractVersion` tanpa
  cache dan me-revalidasi policy di dalam transaksi.
- **Store projection (L/H/B):** `apps/store/src/lib/variant-price-projection.ts`
  (SQL effective/markdown + bulk reader = pure projection). Dipakai di katalog
  (filter range/sort/`hasDiscount`), homepage (filter + linked carousel),
  detail, cart, delivery quote data, checkout preview (pickup/delivery), dan
  kartu/detail/cart/homepage UI. Original/coretan selalu dari variant yang sama.
- **Checkout/pembayaran (T/H/B):** place-order membangun snapshot Markdown,
  memuat projection, dan me-revalidasi source + pointer Markdown di dalam
  transaksi; perubahan antara review dan commit → 409
  `CHECKOUT_REVIEW_REQUIRED` sebelum order/hold/SO. Midtrans item details
  memakai harga efektif.
- **Provider (H/P):** payload create = source price + whole-line
  `disc_amount` (0..gross) + `disc` persentase turunan, tax0; guard zero-disc
  hanya dilonggarkan pada jalur versioned tervalidasi. Decoder intent menghitung
  net goods = gross − disc dan menolak tax≠0/disc>gross; cross-check snapshot
  memverifikasi source gross, net goods, dan Σdisc = markdown + goods discount.
  Invoice/payment verification memakai gross−disc dan expected payable; mirror
  pre-read membandingkan `disc_amount`/amount/total_disc.
- **Docs:** `docs/features/markdown-pricing.md`, API reference, RBAC, database,
  testing README, versioned-pricing terkait.

### Evidence (main agent, bukan laporan child)

| Check | Hasil | Log |
| --- | --- | --- |
| `verify:types:store` / `verify:types:admin` | PASS | — |
| Focused lint file store berubah | 0 error (1 warning pre-existing `_dropped`) | — |
| `lint:admin` | 0 error (warning pre-existing) | — |
| Unit + SQL batch serial (`verify:batch:unit`) | **127 files / 1429 passed / 3 skipped** | `/tmp/t03-batch-unit-final.log` |
| SQL: `variant-pricing.db.test.ts` + `seed-cleanup.test.ts` | 14 passed | `/tmp/t03-sql-db.log` |
| SQL admin: `price-changes-administration.db.test.ts` (termasuk revoke + race apply) | 12 passed | `/tmp/t03-sql-admin.log` |
| SQL store: `variant-price-projection.db.test.ts` | 2 passed | `/tmp/t03-sql-store.log` |
| Mock E2E penuh (`verify:batch:e2e`) | **85 passed** | `/tmp/t03-mock-e2e-final2.log` |
| `db:generate` + `db:check` | PASS | — |
| Push + seed DB disposable `marketplace_discounts_test_20261024_v2` | PASS | — |

Skip pada batch unit adalah placeholder readiness environment yang sudah
terdokumentasi (Sales versioned/operations/channel-mirror); perilaku PG aktualnya
berjalan pada suite DB terpisah / E2E mock di atas.

### Batas / gap yang tidak diklaim

- **Mirror post-invoice dengan diskon** belum membentuk PUT nyata pada E2E:
  pre-read loopback gagal lebih dulu dengan `EDIT_SHAPE_INCOMPLETE`
  (informational, tidak memblokir paid/fulfillment). Perbandingan disc/amount/
  total_disc pada `mirrorPreReadMismatch` diuji unit; PUT dengan `disc_amount`
  yang dipertahankan belum dieksekusi end-to-end.
- **Homepage carousel UI** memakai field proyeksi baru, tetapi belum punya
  spec Playwright khusus (API filter/linked sudah memakai helper yang sama).
- Bulk/Excel, Offer/allocation, percentage/shipping tetap milik ticket 04–12.
- Standard `npm run test:e2e` live-provider **tidak dijalankan** (butuh izin
  provider terpisah); yang dijalankan adalah isolated mock config. UAT staging,
  aktivasi gate `1` di environment operasional, migration deployment,
  rehearsal, dan release tetap gate ticket 13/izin terpisah.
- `npm run lint:store` penuh masih gagal pada `Header.tsx` (error pre-existing,
  tidak disentuh ticket ini); lint file yang berubah bersih.
