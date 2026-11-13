# Evidence implementasi TX-01–TX-06

Register bukti untuk [spesifikasi perbaikan keandalan transaksi](../plan/perbaikan-keandalan-transaksi-tx01-tx06-spec.md).
File ini adalah evidence, bukan ticket breakdown. Status plan tetap hanya di
[`index.md`](../index.md).

## Kondisi awal sesi

- `HEAD` = `d75a44266af21e9a70329bced1f7a97640dd7e50` (identik snapshot spec), branch `worktree/diskon`.
- Working tree awal: `AGENTS.md` termodifikasi + `.scratch/order-flow/` untracked (tidak ikut commit).
- Approval pengguna: complete spec disetujui, dikerjakan bertahap §15.1–§15.5, commit per langkah, DB disposable diizinkan, final gate penuh §16.5.
- Database disposable: `marketplace_discounts_test_tx01` (Postgres 16 lokal, schema di-`db:push`). DB development pengguna tidak disentuh.

## Deviation log

| Tanggal | Deviation | Alasan | Dampak |
|---|---|---|---|
| TX-01 | `reconcilePendingPayment` menerima dependency `claimPaid`/`failOrder` selain `gateway`/`loadWork`/`clock`. | Matriks §7.2 harus bisa dibuktikan deterministik tanpa PostgreSQL; `.test.ts` murni tidak boleh menunggu DB. | Tidak menambah seam produksi baru; default tetap use case existing. |
| TX-01 | `failOrderWithEvidence` menerima `paymentAttributes` opsional dan `reasonCode` hanya untuk log. | Kompatibilitas jalur webhook existing yang menyimpan `paymentMethod`/`midtransTransactionId` pada claim yang sama. | Tidak mengubah kontrak HTTP; tidak menambah write kedua. |
| TX-01 | Spec E2E `transaction-recovery-mock.spec.ts`/`checkout-resume-mock.spec.ts` ditulis setelah slice TX-06 selesai. | Satu spec harus menutup customer→admin untuk lima risiko; menulis dua kali akan menduplikasi helper. | AC yang butuh bukti browser tetap `Pending` sampai final gate. |

## Register AC

Status per langkah; `Verified` hanya bila evidence aktual sudah dijalankan.

| AC | Status | Evidence |
|---|---|---|
| AC01 | Verified (unit) | `apps/store/src/features/payments/reconcile-pending-payment-service.test.ts` — GET pending → expire conflict → GET paid, `claimPaid` sekali, `failOrder` tidak dipanggil. Bukti E2E real-HTTP menyusul di final gate. |
| AC02 | Verified (unit) | `midtrans-payment-client.test.ts` (timeout/500/malformed/412 → `unknown`) + `reconcile-pending-payment-service.test.ts` (unknown → defer, tanpa mutasi). |
| AC03 | Verified (unit+PG) | `reconcile-pending-payment-service.test.ts` (expire authoritative → evidence `provider_expired`) + `fail-order-service.db.test.ts` (evidence amount/order mismatch tidak mengubah apa pun). |
| AC04 | Pending | Guard `already_paid`/`payment_active` ada di PG test; uji barrier konkuren webhook-vs-cancel belum dijalankan. |
| AC05 | Verified (unit) | `reconcile-pending-payment-service.test.ts` — not_found tanpa durable never-sent proof → `manual_review`, tanpa fail/release. |
| AC06–AC46 | Pending | Slice TX-02…TX-06 belum diimplementasi. |
| AC22 | Verified (PG, sebagian) | `fail-order-service.db.test.ts` — status gagal + cancel intent satu commit; dispatch throw tetap meninggalkan `intent` durable. |
| AC27 | Pending | Repair obligation historis baru tersedia sebagai repository; pengujian evidence gate menyusul. |

## Command evidence

| Slice | Command | Hasil |
|---|---|---|
| TX-01 | `npm run verify:unit:slice -- apps/store/src/features/payments/payment-evidence.test.ts` | 1 file / 8 test pass |
| TX-01 | `npm run verify:unit:slice -- apps/store/src/features/payments/midtrans-payment-client.test.ts` | 1 file / 7 test pass |
| TX-01 | `npm run verify:unit:slice -- apps/store/src/features/payments/reconcile-pending-payment-service.test.ts` | 1 file / 8 test pass |
| TX-01 | `npm run verify:unit:slice -- apps/store/src/app/api/cron/sweep-reservations/route.test.ts` (sebelum wiring route) | RED: 2 gagal — route belum memakai use case |
| TX-01 | `npm run verify:unit:slice -- apps/store/src/app/api/cron/sweep-reservations/route.test.ts` (setelah wiring) | 1 file / 6 test pass |
| TX-01 | `DATABASE_URL=…marketplace_discounts_test_tx01 npm run verify:unit:slice -- apps/store/src/features/orders/fail-order-service.db.test.ts` | 1 file / 6 test pass |
| TX-01 | `npm run verify:unit:slice -- apps/jubelio-mock/src/server.test.ts` | 1 file / 43 test pass |
| TX-01 | `npm run verify:types:store` | pass |
| TX-01 | `npm run lint:store` | 0 error (warning pre-existing + warning baru yang sudah dibersihkan) |

## TX-02 (slice 2)

| AC | Status | Evidence |
|---|---|---|
| AC06 | Verified (PG) | `initialize-order-payment-service.db.test.ts` — dua pemanggil paralel (initial legacy + repayment): tepat 1 Snap create, satu `ready`, satu `processing`; `orders.snap_redirect_url` tersimpan. |
| AC07 | Verified (PG) | Idem — provider throw setelah request diterapkan menghasilkan `processing`, session tetap `dispatched_unknown`, order tetap `pending_payment`, tanpa cancel op. |
| AC08 | Verified (parsial) | Adapter: hanya HTTP 401 + `error_messages` yang definitive (test lama `midtrans.test.ts`); 412/timeout/4xx generik → `unknown`. PG: `definitive_rejection` tertulis `rejected` lalu failure + cancel obligation. |
| AC09 | Verified (PG) | Session `ready` dipakai ulang (`replayed: true`, 0 provider call), `expires_at`/`expected_amount` tidak berubah; claim menolak order milik client lain. |
| AC10 | Pending | Uji fault persistence `recordOrderPaymentOutcome` di PostgreSQL belum ada; parity test memakai double. |
| AC11 | Verified (PG) | Redirect historis → `adopted_redirect` tanpa provider call; order historis tanpa redirect → `legacy_unknown`/`manual_review`, bukan intent baru. |
| AC12 | Pending (browser) | Copy 202 dan navigasi ke order owned sudah diimplementasi (`checkout/page.tsx`, `place-order/route.ts`); rendered review + spec Playwright belum dijalankan. |
| AC27 | Pending | Repair obligation historis tersedia di repository; gate evidence fresh belum diuji. |
| AC41 | Verified (PG) | `seed-cleanup` + `retained-order-fixtures` menghapus `order_payment_session` sebelum `orders`; `place-order-repository.db.test.ts` cleanup ikut diperbarui. |

Catatan perilaku yang berubah (disetujui spec §16.3): exception/timeout pada pembuatan
pembayaran **tidak lagi** memicu `claimAndFailOrder` (compensation). Parity test
`route.lifecycle-parity.test.ts` diubah: hasilnya `202 PAYMENT_INITIALIZATION_UNKNOWN`,
tanpa event `compensate`.
