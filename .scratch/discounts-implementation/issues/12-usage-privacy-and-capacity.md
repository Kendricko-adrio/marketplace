# 12 — Pemakaian, privacy dan kapasitas

Label: ready-for-agent
Type: task
Status: resolved
Assignee: main-agent
Blocked by: 09
Parent: [Map implementasi diskon](../map.md)
Spec: [Complete spec](../../../plan/discounts-spec.md)
Acceptance IDs: T02, T03, S01, S02, S03, S04, A01, A02, A03, A04, D01, D02, R01

## Perilaku yang dibangun

Admin menelusuri usage nyata dari order/Coupon/code, reserved versus consumed/released, global budget dan kapasitas, serta riwayat yang aman. Daftar/detail order mengikuti Orders grants/branch; summary global bukan alasan membuka customer/codes lintas akses. Capacity edits, pause dan review ambiguity mempertahankan safety transaksi07.

Baca usage generik/versioned; tidak bergantung percentage10/shipping11 untuk demonstrasi fixed-goods yang sudah berfungsi, tetapi mesti kompatibel dengan komponen benefit itu ketika13 mengintegrasikan semuanya.

## Acceptance criteria

- [x] Offer detail menampilkan quota/budget consumed+held dan tersedia secara global. Contoh quota100/consumed90/held10 → available0; budget100000/consumed80000/held20000 → available0. Daftar scoped tidak diklaim sama dengan global totals.
- [x] Promo viewer tanpa Orders:view hanya mendapat aggregate tanpa order/customer identities. Viewer Orders Jakarta hanya melihat entries/detail Jakarta; direct ID/API/export/cursor/count scope tidak membuka Bandung.
- [x] Code literal masked pada list/usage/detail/history/export/general audit bagi non-editor; Audit:view saja bukan bypass. Editor berwenang tetap dapat menelusuri code ID/literal lewat protected interface, tanpa literal runtime logs.
- [x] Capacity initial/increase/removal yang memperbesar memerlukan capacity grants+promo grants. Lowering di bawah consumed+reserved (quota/budget/per-account) ditolak; indexed commitments lookup di bawah Offer lock, tidak unbounded account locks.
- [x] Publish/pause/policy edit bersamaan reserve/consume/release serial konsisten dan diaudit current versions. Perubahan role/session stale tidak mengizinkan mutasi. Rename/revision/code/email change tidak reset usage.
- [x] History menyajikan actual revision/policy/batch/code/action/actor/time dengan attribution aman sesudah FK actor null; stale mutation/receipt replay tidak menimpa live atau menggandakan audit.
- [x] Paid-but-provider-blocked/ambiguous hold dan late-paid-review dapat ditelusuri melalui existing Orders ops workflow. Tidak ada tombol reset usage/force release/retry provider write/refund baru; komunikasi/penyelesaian khusus tetap manual.
- [x] Pause Offer bermasalah hanya menghentikan new reservations; order held tetap snapshot. Tidak mass cancel/reprice/release paksa. Outcome uncertain tetap held/review, refund manual tidak sync/restore usage.
- [x] Ownership/client→orders/Redemption/allocations/accepted requests/provider/shipment evidence retention constraints melindungi histori; catalog references tidak cascade hilang. Attempts hard-delete transaksi ditolak; archival config tidak membuka reuse literal.
- [x] Targeted projection drift ditahan untuk review, tidak reset/rebuild online. UI dan HTTP mengungkap state benar tanpa klaim eventual analytics sebagai authority capacity.
- [x] Real read/list pagination, filters, permissions, visual existing, schema/seed/logs/enduring docs dan tests ikut diperbarui. Retention bukan klaim compliance/erasure workflow baru.

## Verifikasi

T real PG capacity versus reserve/lifecycle races dan retention constraint seam; H read APIs/direct mutations/scoped counts/export/audit payload privacy; B actual admin personas navigasi summary→scoped list→order/history dan safe pause. Assert melalui documented read interfaces, bukan private counters sebagai side channel; SQL hanya untuk schema constraints/setup. Carry actual lifecycle07 tests, bukan menggantinya dengan mocked usage counters.

## Batas dan penyelesaian

Baca [kontrak bersama](../map.md#kontrak-bersama-untuk-semua-ticket). Ini melengkapi ops read/capacity experience, bukan menunda safety dasar07. Staging sign-off/production activation ada di13 dengan izin tersendiri. Tidak ada fee/Rp0 proof/subagent/provider request/commit/deploy otomatis. Main agent merekam review/verification di Answer sebelum resolved.

## Answer

**Status: resolved (main agent).** Usage nyata dari ledger Redemption, privacy
per-grant/scope, kapasitas per-akun, drift fail-closed, pause aman, dan retensi
histori dibangun di atas lifecycle07/09. Gate operasional
`discounts.contractVersion` kembali **0**; tidak ada commit/push/provider write/
remote/deployment/UAT.

### Context7 checkpoint

- `/drizzle-team/drizzle-orm-docs` — perilaku `.onConflictDoNothing({ target })`
  + `.returning()` sudah dikonfirmasi pada ticket 09 dan dipakai ulang untuk
  reservasi canonical code di `createPublicDraftOffer` (baris kosong = literal
  sudah direservasi Offer lain → `409 CODE_CONFLICT`, termasuk setelah arsip).
  Tidak ada signature library baru lain; route/UI memakai pola Next.js/Drizzle
  yang sudah terkonfirmasi pada ticket 06–11.

### Acceptance IDs dan bukti

| ID | Bukti |
| --- | --- |
| T02 | Test DB memastikan rename Offer, perubahan email client, dan penambahan kode **tidak** mengubah `reserved/consumed` count+amount; publish revision baru juga mempertahankan `usage`. |
| T03 | Race PostgreSQL nyata: transaksi reservasi memegang lock Offer + menulis Redemption/event/counter; `PATCH .../policy` menunggu lock lalu menolak kuota di bawah komitmen. Penurunan `perClientLimit` dicek terhadap max `reserved+consumed` per akun (lookup PK terindex, tanpa lock account), dan grant yang dicabut → `403 DENIED`. |
| S01/S02/S03/S04 | Entry usage menampilkan status order/payment, `fulfillmentBlocked` + alasan, dan `latePaidReview`; pause/held snapshot diuji di store (reserve → pause → release tetap jalan, tanpa mass cancel). Test lifecycle07 yang ada tetap dijalankan di batch, bukan diganti mock counter. |
| A01/A02 | `discounts:view` saja = agregat; entries butuh `orders:view`; own-branch dipin ke Home Branch (direct id 404, `branchId` asing 403, page/limit/count tidak melebarkan). Initial/increase/removal kapasitas memperbesar tetap butuh `discount_capacity` + `discounts:edit`; penurunan hanya promo grant selama muat komitmen. |
| A03/A04 | Code literal hanya di detail editor; list/usage/history/audit memakai `maskedCode`+codeId; `audit_log:view` saja ditolak oleh reader usage/history (test). Histori memuat action/revision/draft/policy/code/actor/time; atribusi tetap aman setelah `audit_log.user_id` di-NULL. Stale receipt replay tidak menggandakan audit (test replay existing). |
| D01/D02 | Retention diuji: hard delete order/client/Offer/code/Redemption/variant yang direferensikan ditolak FK `23503`; arsip tidak menghapus baris dan canonical literal tetap tidak bisa dipakai Offer baru. Tidak ada perubahan schema; seed demo konsisten (projection = ledger). |
| R01 | Pause lewat UI: dialog konfirmasi, state `paused`, availability/entry **tidak berubah**, tanpa tombol reset/force-release/refund. Tidak ada mass reprice/cancel; hold lama tetap snapshot. |
| C05/F01 (kompatibilitas baca) | Reader memakai `discount_redemption`/allocation generik, tidak bergantung pada bentuk benefit percentage/shipping; kombinasi penuh tetap diverifikasi ticket 13. |

### Perubahan utama

- **Baru** `apps/admin/src/lib/discount-operations-read.ts` —
  `readDiscountOfferUsage` (agregat global + `availability` consumed/held/
  available + `drift` + entries ter-scope dengan pagination/filter/entryId) dan
  `readDiscountOfferHistory` (referensi revision/draft/code, aktor aman,
  fallback identity dari receipt).
- **Baru** `apps/admin/src/lib/discount-usage-drift.ts` — rekonsiliasi terarah
  projection vs ledger, `readMaxClientCommitment` (indexed).
- `discounts-administration.ts` — drift fail-closed (`USAGE_DRIFT_REVIEW`) pada
  publish/policy, penurunan per-account terhadap komitmen, `capacitySummary`
  pada detail, audit `actorIdentity`, dan `CODE_CONFLICT` stabil untuk create
  kode yang sudah direservasi.
- `rbac/audit-writer.ts` — `actorIdentity` opsional disimpan di payload audit
  (tanpa mengubah event lama).
- Route `GET .../usage` dan `.../history` meneruskan filter aman dan log
  count/scope/drift saja (tanpa identitas/literal).
- UI detail: ringkasan global consumed/held/available + peringatan drift, tabel
  Redemption (filter status, pagination, tautan order, badge late-review/
  fulfillment-blocked), histori dengan aktor/revision; copy list diperbarui.
- Store test: pause mempertahankan hold snapshot dan tetap dapat release.
- E2E baru `e2e/admin/discounts-usage-mock.spec.ts` + registrasi
  `playwright.mock.config.ts`; docs feature/API/testing diperbarui.

### Command, environment, hasil

DB disposable `marketplace_discounts_test_20261026`; gate dinaikkan hanya di
fixture dan dikembalikan ke `0`.

- `npm run verify:types:store` / `verify:types:admin` — PASS.
- `npm run db:check` — PASS.
- Unit slice: `discount-operations-read.test.ts` 4, `discount-operations-read.db.test.ts` 11+1 skip (blocker test), `discounts-administration.db.test.ts` 18, `discounts-administration.test.ts`+audit-writer 32, `discount-reservation.db.test.ts` 15+1 skip — PASS.
- `npm run verify:batch:unit` — **146 files passed / 2 skipped; 1701 passed / 14 skipped** (final run setelah perubahan create-code).
- `npm run verify:batch:e2e -- e2e/admin/discounts-admin-mock.spec.ts e2e/admin/discounts-usage-mock.spec.ts` — **10 passed**; regresi `discounts-coupon-mock` **17/17** PASS. Kegagalan Playwright awal (locator ambigu, format `Rp`, username sign-in) diperbaiki dan dijalankan ulang; laporan dibaca dari Markdown/error-context, bukan PNG.
- Lint: `lint:admin` 0 error (30 warning pre-existing); file store yang diubah (test) typecheck PASS. `lint:store` global tetap gagal pada error pre-existing `Header.tsx` (bukan file tiket ini).
- Verifikasi DB akhir: gate `0`, 0 fixture Offer/client/order/branch/user/role/receipt tersisa.

### Gap yang TIDAK diklaim

- Tidak ada endpoint export diskon/kode (jadi tidak ada saluran literal baru);
  klaim export/privacy diuji pada list/detail/usage/history/audit yang ada.
- Riwayat menampilkan revision/draft/policy/code/action/actor/time; referensi
  `batch` milik histori price-change (ticket 04/05), bukan field Offer.
- Drift ditahan untuk review secara terarah per Offer; tidak ada rekonsiliasi
  massal, repair otomatis, analytics eventual, atau EXPLAIN benchmark baru.
- Retensi ini bukan klaim kepatuhan/erasure workflow; kombinasi penuh
  manual+percentage+shipping, staging UAT, deployment/aktivasi, dan live-provider
  E2E tetap ticket 13/izin terpisah.
