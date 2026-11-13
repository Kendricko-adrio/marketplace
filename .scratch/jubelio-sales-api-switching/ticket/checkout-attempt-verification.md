# Catatan implementasi dan verifikasi checkout attempt

Ini catatan slice/verification, **bukan breakdown implementation tickets**. Approval complete spec: user “oke setuju. tolong jalankan perubahan”. Status plan hanya di [index](../index.md); kontrak di [spec](../plan/checkout-attempt-before-order.md).

## Checkpoint sebelum coding

- Context7 checkpoint: `/drizzle-team/drizzle-orm` — `check`, composite `foreignKey`, unique constraint dan generated migration dikonfirmasi. Installed `drizzle-orm` 0.45.x dan `drizzle-kit` 0.31.x; partial-index signature perlu dipastikan dari installed types sebelum dipakai.
- Context7 checkpoint: `/vitest-dev/vitest` — `test.each`/assertion `toEqual`, `objectContaining`, `toThrow` dikonfirmasi; tests di public seams sesuai spec.
- Context7 checkpoint: `/midtrans/midtrans-nodejs-client` — SDK error membawa `httpStatusCode`, `ApiResponse`, `rawHttpClientData`; no HTTP response menghasilkan status null. Source terpasang `node_modules/midtrans-client/lib/httpClient.js` dan `lib/snap.js` (1.4.3) dibaca. Tidak ditemukan API pemulihan token existing dari order ID di Snap client terpasang; tidak menganggap GET transaction 404 sebagai bukti tidak ada Snap session. Ambiguity tetap manual review.
- Nullable-owner inventory: store checkout request/recovery, SO operations/lifecycle/settlement, order finalizer/channel mirror/order detail; admin order detail, review, delivery lists/follow-up/shipment, discount read/drift. Seluruhnya harus direview sebelum nullable ownership diaktifkan.
- `cart_item.updated_at` tersedia untuk conditional consumption, bersama ID/variant/branch/quantity. Tidak perlu keputusan product/schema cart baru saat ini.
- Working tree sudah dirty sebelum pekerjaan; perubahan unrelated tidak termasuk evidence pekerjaan ini.

## Slice dan hasil

### Fondasi attempt dan payment claim

- RED → GREEN domain projection: `/tmp/checkout-attempt-domain-red.log`, `/tmp/checkout-attempt-domain-guard-red.log`, lalu `/tmp/checkout-attempt-domain-schema-green.log` (15 tests pass pada 2 file).
- Fondasi schema/reader/seed cleanup: `/tmp/checkout-attempt-foundation-green.log`, 4 file / 33 tests PASS, termasuk DB disposable lokal; typecheck store + admin PASS.
- Ledger ownership: `/tmp/checkout-attempt-ledger-red.log`, `/tmp/checkout-attempt-ledger-api-red.log` → `/tmp/checkout-attempt-ledger-green.log`: 3 file / 39 tests PASS; typecheck store PASS. Existing order-owned sweeps melewati attempt-owned rows agar tidak memakai order ID null.
- Payment concurrency/evidence: `/tmp/checkout-attempt-payment-claim-red.log` → `/tmp/checkout-attempt-payment-claim-green.log`: repository suite 18 PASS; typecheck store PASS. Concurrent connections memperoleh satu claim; unknown tidak melepas hold; ready session belum diekspos sebelum promotion.
- Deadline claim: `/tmp/checkout-attempt-payment-deadline-red.log` → `/tmp/checkout-attempt-payment-deadline-green.log`: focused deadline test PASS setelah injectable clock digunakan. Ini tidak berarti semua acceptance deadline/recovery sudah selesai.
- Generated audit migrations: `0052_cynical_diamondback.sql` (attempt schema), `0053_ordinary_sir_ram.sql` (attempt ownership SO ledger). Fresh disposable schema push PASS; generated 0053 upgrade pada disposable 0052 schema PASS. Schema database aplikasi tidak diubah.
- Demo seed smoke pada DB disposable PASS (`/tmp/checkout-attempt-seed-smoke.log`). Saat ini demo baru mencakup rejected attempt; unresolved/promoted fixtures menunggu integrasi lifecycle berikutnya.
- Tooling limitation: push kedua mencoba menjatuhkan unique constraint `order_item_order_id_unique` yang masih direferensikan allocation FK, walau schema itu unrelated; `drizzle-kit push` bahkan exit 0 sesudah error. Error didiagnosis dari `/tmp/checkout-attempt-ledger-push.log`. Tidak menghapus constraint/FK atau hand-edit audit SQL; untuk upgrade verification hanya generated migration 0053 diterapkan pada DB disposable.

**Belum selesai:** reservation attempt terintegrasi promo/stock, SO dispatch/accounting/cancel attempt, promotion, webhook/sweep attempt, HTTP/checkout frontend, admin visibility dan E2E. Alur checkout existing belum dialihkan. Tidak ada klaim issue customer sudah fixed.

Visual gates belum berlaku pada slice backend/domain awal; frontend tetap belum terverifikasi sampai integrasi dan browser review selesai. L2 batch gate belum dijalankan.

### Integrasi lifecycle, route, frontend

- Reservation/promotion/rejection/recovery: `checkout-attempt-repository.db.test.ts` **34 tests PASS** (concurrent same-key → satu order/SO/payment; cart yang berubah tidak dihapus; penolakan SO tanpa order; cancel SO unknown tidak melepas stok; expiry hanya untuk intent yang belum pernah dikirim).
- Promo attempt-owned: `apps/store/src/lib/discount-reservation.db.test.ts -t "same promo capacity"` PASS (reserve + release tanpa order; counter kembali 0).
- Snap readiness: `apps/store/src/lib/midtrans.test.ts` **39 PASS**; hanya 401 terverifikasi yang definitive, 4xx lain/timeout tetap `unknown`. Log SDK tidak lagi mencetak respons mentah.
- Route + frontend: `/api/checkout/place-order` memakai lifecycle attempt untuk checkout kontrak v1; `GET /api/checkout/requests/{key}` membaca attempt lebih dulu; halaman checkout hanya redirect saat `state: promoted`, menampilkan feedback inline, dan menyediakan "Periksa status checkout".
- Admin: `apps/admin/src/features/orders/checkout-attempt-review-repository.db.test.ts` **2 PASS** (own-branch scope, tanpa order); antrean review menampilkan attempt pra-order tanpa link order palsu.
- E2E mock (DB disposable, browser nyata): `e2e/store/checkout-review-mock.spec.ts` **22/22 PASS**; batch `delivery-order + versioned-checkout + discounts-coupon + pickup` **29/29 PASS**; `e2e/admin/checkout-attempt-review-mock.spec.ts` **1/1 PASS**.
- Full unit dengan DB disposable: **1828 passed, 12 skipped, 10 failed**. Sepuluh kegagalan berasal dari state DB bersama, bukan perubahan ini: 9× `DISCOUNTS_INACTIVE` karena suite lain mereset `discounts.contractVersion` ke 0, dan 1× tabrakan `pickup_code` fixture lama. Ketiga file terkait lulus saat dijalankan terisolasi (`19 PASS`, `34 PASS`, `101 PASS/1 skip`).

## Deviasi dan batas

- **Deviasi:** jalur pricing legacy (kontrak 0) masih memakai lifecycle order lama; lifecycle attempt berlaku untuk checkout kontrak v1 yang dipakai checkout baru. Ini dicatat, bukan klaim cakupan penuh.
- `drizzle-kit push` pada DB disposable gagal karena constraint `order_item_order_id_unique` yang direferensikan FK alokasi (unrelated). Upgrade diverifikasi hanya dengan migration generated 0052–0055; DB aplikasi tidak disentuh.
- **UX review gate belum dijalankan sebagai review visual eksplisit** (perbandingan state/label dengan peer page). E2E browser memverifikasi state error/recovery/mobile, tetapi klaim "UX selesai" tidak dibuat sehingga plan tetap In Progress.
- Full `npm run test:e2e` legacy tidak dijalankan (butuh izin terpisah).
