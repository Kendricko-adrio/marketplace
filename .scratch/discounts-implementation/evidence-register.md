# Evidence register — implementasi diskon (ticket 01–13)

Register ini merekonsiliasi **40 acceptance ID** `plan/discounts-spec.md` §12.2
dengan bukti yang benar-benar dijalankan, bukan rencana. Setiap baris memisahkan
**PASS**, **SKIP**, dan **BLOCKED**; report subagent/mock hijau bukan acceptance.
Sumber tiket per-slice tetap file `.scratch/discounts-implementation/issues/*.md`
(Answer masing-masing) dan `execution.md`.

- Tanggal run integrasi: 2026-10-21/22 (WIB), workspace
  `worktree-diskon`, DB disposable `.env` `marketplace_discounts_test_20261026`.
- Gate `discounts.contractVersion` di DB disposable setelah run: **`0`**
  (dipulihkan fixture E2E; seed menulis eksplisit `0`).
- Provider nyata (Jubelio/Midtrans/Shipment), SMTP live, staging/production,
  SSH/Docker remote, commit/push dan deployment **tidak dijalankan**.

## 1. Command yang dijalankan pada ticket 13

Log lengkap disimpan di luar repo (`/tmp/ticket13-*.log`); ringkasan:

| # | Command | Environment | Hasil | Scope |
|---|---|---|---|---|
| 1 | `npm run verify:types:store` | lokal | PASS | tsc store |
| 2 | `npm run verify:types:admin` | lokal | PASS | tsc admin |
| 3 | `npx vitest run apps/store/src/lib/discounts-integration.db.test.ts` | DB disposable | PASS 5, 1 guard-skip | cross-slice L+T |
| 4 | `npm run verify:batch:unit` | DB disposable, serial | **147 file pass / 2 skip; 1706 test pass / 15 skip** | full unit+DB |
| 5 | `npx playwright test --config=playwright.mock.config.ts e2e/store/discounts-coupon-mock.spec.ts` | mock isolated (port 3110–3112) | **12 passed** | UI/HTTP diskon store |
| 6 | `npx playwright test --config=playwright.mock.config.ts e2e/admin/discounts-admin-mock.spec.ts e2e/admin/discounts-usage-mock.spec.ts` | mock isolated | **10 passed** | admin diskon + privacy/usage |
| 7 | `npx playwright test --config=playwright.mock.config.ts e2e/store/checkout-review-mock.spec.ts e2e/store/markdown-mock.spec.ts` | mock isolated | **25 passed** | regresi review/idempotency/Markdown |
| 8 | `npm run db:check` | `packages/db` | PASS `Everything's fine` | schema/snapshot drift |
| 9 | `npm run build:store` | lokal | PASS | build produksi store |
| 10 | `npm run build:admin` | lokal | PASS | build produksi admin |
| 11 | `npx eslint src/lib/discounts-integration.db.test.ts` | `apps/store` | PASS 0 error (e2e di luar base path lint) | lint file baru |
| 12 | Rehearsal DB baru: `drizzle-kit migrate` → `tsx src/seed.ts` ×2 → `tsx src/reset.ts` | DB disposable baru | PASS (52 migrasi, seed idempotent, 55 tabel→0) | D02 |
| 13 | Rehearsal `SEED_MODE=jubelio` pada DB disposable kedua | DB disposable baru | PASS (0 product/order/cart/Offer; gate `0`) | seed mode |
| 14 | `NODE_ENV=production npx tsx src/seed.ts` | DB rehearsal | **exit 1** `Refusing to seed a production database` | production seed forbidden |

| 15 | `npm run verify:batch:unit` ulang setelah cutover voucher (DATABASE_URL disposable eksplisit) | DB disposable | **148 file pass; 1703 test pass / 12 skip** | regresi pasca-hapus voucher |
| 16 | `npm run build:store` + `npm run build:admin` setelah cutover voucher | lokal | PASS (route `/api/vouchers/validate` hilang dari manifest) | build |
| 17 | `SEED_MODE=demo npx tsx src/seed.ts` pada DB disposable | DB disposable | PASS; `voucher` rows **0**, gate `0` | seed pasca-hapus fixture voucher |
| 18 | `grep -rn "vouchers/validate|computeVoucherDiscount|voucherId"` apps/packages/e2e | lokal | tidak ada consumer tersisa (hanya schema inert + komentar) | preflight legacy |

Catatan skip: 15 test skip pada run #4 (dan 12 pada run #15 setelah `.env` berubah) adalah guard environment
(`it.skipIf(schemaState.ready)`/opt-in sentinel) yang justru gagal keras bila
prasyarat DB hilang; 2 file skip adalah project workspace tanpa test yang cocok.
Tidak ada skip yang dipakai sebagai bukti lulus. Playwright yang gagal tidak
pernah dibaca dari PNG; run ini tidak ada kegagalan.

## 2. Traceability 40 acceptance ID

Seam: **L** pure/pricing, **T** real PostgreSQL, **H** HTTP/app boundary,
**B** Playwright mock, **P** evidence provider bounded, **D** schema/migration.

| ID | Status | Seam | Evidence (file/command) |
|---|---|---|---|
| M01 | PASS | L/T/B | `packages/db/src/markdown-pricing.test.ts`; `packages/db/src/variant-pricing.db.test.ts`; `apps/store/src/lib/variant-price-projection.db.test.ts`; `e2e/store/markdown-mock.spec.ts` (run #7) |
| M02 | PASS | L/T/B | `markdown-pricing.test.ts` (fallback/restore/naik), `apps/admin/src/lib/price-changes-administration.db.test.ts` (restore/base terbaru), `markdown-mock` |
| M03 | PASS | L/T/H/B | `price-changes-administration.db.test.ts` (apply memakai source terbaru, audit actual, replay), order read di mock E2E |
| X01 | PASS | L/H/B | `apps/admin/src/lib/price-workbook-administration.db.test.ts`; `e2e/admin/price-change-bulk-mock.spec.ts`; `price-changes-administration.db.test.ts` |
| X02 | PASS | L/H/B | `price-workbook-administration.db.test.ts`, `e2e/admin/price-change-excel-mock.spec.ts` (fatal vs row error, tanpa evaluasi formula) |
| X03 | PASS | T/H/B | `price-changes-administration.db.test.ts` (apply 97/3, no-op/pending), `price-change-bulk-mock` |
| X04 | PASS | T/H/B | `price-changes-administration.db.test.ts` (60/37/3, resume, retry batch linked); `price-workbook-administration.db.test.ts` |
| X05 | PASS | T/H/B | `price-changes-administration.db.test.ts` (revoke/halt/resume, source berubah, permission), mock admin |
| X06 | PASS | L/T/H | `packages/db/src/discount-import-limits.test.ts`; `price-workbook-administration.db.test.ts` (batas 1000/5MiB/25MiB/chunk) |
| C01 | PASS | T/H/B | `discount-selection.db.test.ts`; `discount-reservation.db.test.ts`; `e2e/store/discounts-coupon-mock.spec.ts` (run #5) |
| C02 | PASS | L/H/B | `apps/store/src/lib/promo-replacement.test.ts`; `discounts-coupon-mock` (dialog naik/batal/sama-turun) |
| C03 | PASS | H/B | `discount-selection.db.test.ts` (kode invalid/capacity tidak mengganti), `discounts-coupon-mock` (kode manual invalid mempertahankan pilihan lama) |
| C04 | PASS | L/H/B | `promo-replacement.test.ts`; `checkout-review-mock.spec.ts` (invalidation/continue without/review guard, run #7) |
| C05 | PASS | L/T/H/B | `discount-eligibility.test.ts` (start inklusif/end eksklusif, WIB, min/verified/canonical/limit); `discounts-administration.db.test.ts`; mock E2E |
| C06 | PASS | T/H/B | `discount-reservation.db.test.ts` (dua akun rebut kuota/budget terakhir), `discounts-coupon-mock` (409 tanpa order/stock parsial) |
| C07 | PASS | H/B | `checkout-admission.db.test.ts` (bucket PG lintas koneksi, forged header, 503 fail-closed); `checkout-review-mock` (429/Retry-After); `discounts-coupon-mock` (limit kode) |
| F01 | PASS | L/T/H/B | `discount-pricing.test.ts`; `discount-eligibility.test.ts`; `discounts-integration.db.test.ts` (manual percentage qty2 multi-line cap, alokasi 12308/7692); `discounts-coupon-mock` (manual percentage place 15000) |
| F02 | PASS | L/H/B | `discount-pricing.test.ts` (PPN net barang, service fee0, payable); `discounts-integration.db.test.ts` (PPN 40700/40150/42900); `jubelio-sales-expected.test.ts`; `payment-item-details.test.ts`; mock E2E |
| F03 | PASS | L/T/H/B | `discount-eligibility.test.ts` (benefit0/invalid tidak dipakai); `discounts-administration.test.ts` (unknown kind/version ditolak saat publish); tanpa test pembayaran Rp0 |
| T01 | PASS | T/H | `discount-reservation.db.test.ts`; `discount-shipping.db.test.ts` (jatah/budget); usage read `discount-operations-read.db.test.ts` |
| T02 | PASS | T/H/B | `discounts-administration.db.test.ts`; `discount-operations-read.db.test.ts` (rename/email/pause/code tidak reset usage); E2E review invalidation |
| T03 | PASS | T/H | `discounts-administration.db.test.ts`; `discount-reservation.db.test.ts` (policy/publish/pause serial vs reserve, limit di bawah komitmen ditolak) |
| T04 | PASS | T/H/B | `checkout-review.test.ts`; `checkout-request.db.test.ts`; `checkout-review-mock` (same-key paralel, lost response, crash, changed intent 409) — run #7 |
| T05 | PASS | T/H | `discount-lifecycle-flow.db.test.ts`; `order-finalize.test.ts`; `discounts-integration.db.test.ts` (consume sekali); duplicate/out-of-order/sweep |
| T06 | PASS | L/T/H/B | `promo-replacement.test.ts`; `checkout-review-mock` (source price change → review baru); order snapshot tests di `versioned-pricing.test.ts`/`versioned-checkout-mock` (regresi) |
| P01 | PASS (bounded) | L/H/P | `jubelio-sales-expected.test.ts`; `jubelio-sales-versioned.db.test.ts`; `markdown-provider-contract.test.ts`; evidence08/T1–T3 dipakai bounded, tidak diulang |
| P02 | PASS (bounded) | T/H/P | `jubelio-sales-operations.db.test.ts`; `jubelio-sales-recovery.db.test.ts`; `checkout-review-mock` fault injection; mirror `jubelio-channel-mirror.db.test.ts` |
| P03 | PASS (bounded) | H/P | `jubelio-channel-mirror.db.test.ts`; `versioned-settlement-mock.spec.ts` (regresi); M1/M2 existing, bukan paid authority |
| S01 | PASS | T/H/B | `discount-lifecycle-flow.db.test.ts`; `checkout-review-mock`/`versioned-settlement` (hold+deadline tetap); `order-finalize.test.ts` |
| S02 | PASS | T/H/P | `discount-lifecycle-flow.db.test.ts` (release sekali, tanpa cancel post-invoice); T3 evidence bounded |
| S03 | PASS | T/H/B | `discount-lifecycle-flow.db.test.ts` (late paid release/blocked, hold dikonsumsi tanpa reacquire) |
| S04 | PASS | T | `discount-lifecycle-flow.db.test.ts` (event unsupported ditolak); tidak ada mutation refund baru |
| A01 | PASS | T/H/B | `discounts-administration.db.test.ts`; `price-changes-administration.db.test.ts` (direct API/denial/revoke); `e2e/admin/rbac-security.spec.ts` |
| A02 | PASS | T/H/B | `discounts-administration.db.test.ts` (capacity grant), `packages/db/src/rbac/discount-grants.db.test.ts`, `seed-*` tests, `rbac` E2E |
| A03 | PASS | H/B | `discounts-usage-mock.spec.ts` (viewer aggregate-only, scope branch, masked); `discount-operations-read.db.test.ts`; route audit |
| A04 | PASS | T/H/B | `discounts-administration.db.test.ts` (draft/stale409/diff/audit); `discounts-admin-mock.spec.ts` (run #6) |
| D01 | PASS | T/D | `discount-schema.db.test.ts`; `discount-redemption-schema.db.test.ts`; `discount-code-schema.db.test.ts`; `order-retention.db.test.ts`; rehearsal FK 81 constraint |
| D02 | PASS lokal / **BLOCKED deployment** | D | Generated SQL tidakdiedit; rehearsal lokal 52 migrasi + seed ×2 + reset PASS; deployment rehearsal target belum tersedia (izin terpisah) |
| D03 | PASS | L/T/H | `versioned-pricing.test.ts` (`PRICING_UNSUPPORTED_VERSION`); `discount-pricing.test.ts` (unknown kind/versi gagal); `discounts-administration.test.ts` (publish menolak) |
| R01 | **BLOCKED** (pause PASS) | T/H/B/D | Pause satu Offer: `discounts-usage-mock.spec.ts`, `discount-operations-read.db.test.ts` PASS. UAT staging pemilik/tester, sign-off dan release evidence **belum tersedia** |

## 3. Coverage detail proposal (spec §12.2 paragraf tambahan)

| Coverage | Evidence |
|---|---|
| Code charset/panjang 3–64, canonical alias | `packages/db/src/discount-code.test.ts`; `discount-code-schema.db.test.ts` |
| Rate maks 6 digit, total overflow/unsafe numeric | `discount-pricing.test.ts`; `discount-eligibility.test.ts` |
| 50 varian/qty99, request byte bounds | `versioned-pricing.test.ts`; `checkout-input.test.ts`; `checkout-review-mock` (413) |
| Token expired/client mismatch | `checkout-review.test.ts`; `checkout-review-mock` |
| Fingerprint ordering/duplicate IDs | `checkout-review.test.ts`; `checkout-review-mock` (canonical/duplikat) |
| Code guessing/per-IP forged header | `checkout-admission.db.test.ts`; `discounts-coupon-mock` |
| Paired original/net courier costs | `discount-shipping.db.test.ts`; `discounts-integration.db.test.ts`; `jubelio-sales-shipping.test.ts` |
| Source sync versus apply | `price-changes-administration.db.test.ts` |
| Policy revoke saat resume | `price-changes-administration.db.test.ts` (revoke/halt/resume) |
| Receipt actor-null retention | `discount-operations-read.db.test.ts` |
| Draft tanpa capacity tidak publish | `discounts-administration.db.test.ts` |
| Simulasi admin tanpa hold/quote promise | `discounts-administration.db.test.ts`; `discounts-admin-mock` |
| Unknown decoder / never-dispatched intent recovery | `versioned-pricing.test.ts`; `checkout-review-mock` (sweep never-dispatched) |

## 4. Rehearsal migration/seed (disposable, bukan data nyata)

DB baru `marketplace_discounts_rehearsal_20261026` dan
`..._rehearsal_jubelio_20261026` (keduanya di-drop setelah pengujian).

- `drizzle-kit migrate` → 52 migrasi generated diterapkan; tidak ada SQL diubah.
- `seed.ts` dua kali → PASS (FK-ordered cleanup + idempotensi).
- Inspeksi: gate `discounts.contractVersion='0'`; **0** kolom `timestamp` tanpa
  timezone; **81** FK; demo fixture berisi `fixed_goods`2, `percentage_goods`1,
  `shipping`2, 3 kode manual, usage reserved/consumed, Redemption
  reserved/consumed/released.
- `SEED_MODE=jubelio` pada DB baru → 0 product/variant/order/cart/Offer/kode/
  Redemption/price batch; gate `0`. (Client demo dan voucher legacy tetap
  ter-seed; voucher adalah sisa route legacy dan tidak dipakai checkout baru.)
- `NODE_ENV=production seed.ts` → exit 1 `Refusing to seed a production database`.
- `reset.ts` → 55 tabel → 0 (`All tables dropped successfully`).
- Tidak ada reset DB pengguna/nyata; DB disposable `.env` tidak di-reset agar
  fixture suite lain tetap utuh.

## 5. Preflight legacy, deployment, trusted IP

- **Legacy voucher (dihapus atas keputusan pemilik 2026-10-22)**:
  `apps/store/src/app/api/vouchers/validate/route.ts`, `lib/vouchers`+test,
  `docs/features/vouchers.md`, entri `docs/api-reference.md`, blok seed voucher,
  test voucher di `e2e/store/checkout.spec.ts`, dan `voucherId` pada DTO admin
  sudah dihapus. Endpoint menjadi 404; tidak ada consumer/fallback subtotal
  browser. Tabel `voucher` dan kolom `orders.voucher_id` dibiarkan inert sampai
  keputusan migrasi destruktif terpisah.
- **Trusted IP**: Caddy menimpa `X-Real-IP`/`X-Forwarded-For` dengan
  `remote_host`; store hanya `expose`, bukan `ports`. Sebelum ticket ini,
  `deployment/{staging,production}/docker-compose.yml` **tidak** meng-set
  `CHECKOUT_TRUST_PROXY`, sehingga production akan gagal tertutup
  `503 POLICY_UNAVAILABLE`. Diperbaiki pada ticket ini (lihat §6).
- **Batas request**: checkout 256 KiB dibaca streaming + `413
  INPUT_LIMIT_EXCEEDED` (`apps/store/src/lib/checkout-input.ts`, diuji
  `checkout-input.test.ts` + mock E2E); import admin memakai
  `discount.import.*` (1000 baris/5 MiB/25 MiB) diuji
  `discount-import-limits.test.ts` + workbook DB test. Caddy tidak membatasi
  body; app adalah otoritas. Verifikasi runtime terhadap proxy ter-deploy
  **belum** dijalankan (environment tidak tersedia).

## 6. Ringkasan perubahan ticket 13

- `apps/store/src/lib/discounts-integration.db.test.ts` (baru): cross-slice
  L+T manual×percentage Markdown qty>1/multi-line, public×fixed, manual×shipping
  delivery, publish/pause setelah preview, consume.
- `e2e/store/discounts-coupon-mock.spec.ts`: fixture + test manual×percentage
  browser (total149850, benefit/allocation/provider15000, detail order).
- `deployment/{staging,production}/docker-compose.yml`: `CHECKOUT_TRUST_PROXY:
  "true"` untuk store (fail-closed tanpa itu di production).
- `docs/deployment-docs/discounts-cutover.md` (baru) + index README;
  `docs/testing/README.md` bagian regresi cross-slice/rehearsal.
- Cutover legacy voucher: hapus route/lib/test/docs/seed fixture/E2E test dan
  `voucherId` DTO admin; update `docs/features/seeding.md`, API reference,
  cutover doc. Schema `voucher`/`orders.voucher_id` tetap inert.

## 7. Gate eksternal (belum boleh diklaim selesai)

| Gate | Status | Alasan |
|---|---|---|
| UAT staging pemilik/tester (functional/visual/no service fee/breakdown/privacy/partial Excel/safe pause) | **BLOCKED** | Tidak ada environment staging berizin pada sesi ini; sign-off belum ada |
| Standard `npm run test:e2e` (live-provider) | **BLOCKED** | Berisi write provider nyata; butuh otorisasi terpisah. Mock suite tidak menggantikan |
| Deployment rehearsal/rollback target (backup/restore, paired image, gate activation) | **BLOCKED** | Butuh SSH/Docker/deploy dan jendela maintenance berizin |
| Rilis publik/aktivasi gate `1` | **BLOCKED** | Acceptance/sign-off/izin operasi belum lengkap; gate tetap `0` |
| Cutover legacy voucher | **RESOLVED (lokal)** | Keputusan pemilik: dihapus; route 404, tanpa consumer/seed; tabel/kolom inert menunggu migrasi destruktif terpisah |

### Insiden environment (dicatat, bukan kegagalan kode)

Pada 2026-10-22 22:31 WIB file root `.env` berubah eksternal (bukan oleh
agent) menjadi `DATABASE_URL=.../storefront` + `SEED_MODE=jubelio`. Satu command
`npm run db:seed` yang dijalankan sebelum perubahan diketahui mengenai DB dev
`storefront`, bukan DB disposable. DB itu sekarang berisi 2 client/2 user tanpa
katalog (mode Jubelio); agent **tidak** me-reset atau memodifikasinya lebih
lanjut. Run unit yang memakai `.env` itu ditolak guard disposable (20 file
gagal karena `storefront`), sehingga **tidak** dipakai sebagai evidence; run
resmi diulang dengan `DATABASE_URL` disposable eksplisit dan PASS. Recovery DB
dev (`SEED_MODE=demo db:reset && db:seed` atau restore backup) menunggu
keputusan pemilik.

**Kesimpulan jujur:** implemented + tested (lokal/mock/PG disposable) untuk
40 ID sebagaimana tabel di atas; **UAT belum**, **launchable belum** dan
**actually activated tidak** (gate `0`, tidak ada deployment/provider write).
