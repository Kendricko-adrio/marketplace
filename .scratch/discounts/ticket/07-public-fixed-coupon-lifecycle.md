# 07 — Coupon publik nominal dan lifecycle pembayaran

Label: ready-for-agent
Type: task
Status: resolved
Assignee: main-agent
Blocked by: 03, 06
Parent: [Map implementasi diskon](map.md)
Spec: [Complete spec](../plan/discounts-spec.md)
Acceptance IDs: C01, C05, C06, F01, F02, F03, T01, T02, T03, T04, T05, T06, P01, P02, P03, S01, S02, S03, S04, D01, D02

## Perilaku yang dibangun

Customer memilih Coupon publik fixed-goods tanpa claim pada pickup checkout, bersama Markdown jika ada. Order menahan kuota/budget/jatah secara atomik; paid terverifikasi consume sekali, unpaid yang final dan aman release sekali. Payment/provider ambiguity dan late paid tidak menghilangkan evidence atau merebut kapasitas customer lain.

Ini tracer bullet fixed-public-pickup yang aman, bukan hanya happy path. Reuse admin06, price/provider03 dan checkout02. Pemilihan antar-promo/gugur UX diperinci08; sampai itu tersedia, stale/invalid selection ditolak dengan aman, tidak diteruskan diam-diam.

## Acceptance criteria

- [x] Picker hanya public enabled/active; relevant belum eligible disabled dengan alasan aman. Tanpa prior claim, preview tidak reserve. Verified store email wajib untuk Offer; contactEmail request bukan pengganti. Checkout tanpa Offer tetap sesuai akses existing.
- [x] Fixed benefit sekali/order, clipped ke subtotal setelah Markdown; allocation largest remainder/tie variant ID deterministik. Lines150000+100000/fixed25000 →15000+10000, net225000, PPN24750, customer249750. Qty2 whole-line tidak dikalikan dua kali; source/source-discount tetap terbaca provider.
- [x] Satu Redemption/order sepanjang hidupnya, owner/revision/Offer/benefit/item allocations konsisten. Goods-only slot, Markdown terpisah, allocation0 tidak disimpan; invalid/benefit0 tidak mengonsumsi usage. Tidak menguji alur pembayaran/provider Rp0.
- [x] Order+request result+items/snapshot+allocations+reserved event/counters+stock hold+SO intent satu commit; failure rollback penuh. Same-key replay02 juga tidak menggandakan Redemption/stock/dispatch.
- [x] Dua akun berebut last quota/budget atau akun berebut jatah1/configurable2 tidak oversell, hanya full benefit. Budget sisa15000 untuk benefit20000 ditolak, bukan discount diperkecil. Loser tidak punya order/stock hold parsial atau tagihan lebih tinggi.
- [x] Reserve serial terhadap publish/pause/policy edits. Minimal global bound; lowering quota/budget/per-account di bawah committed consumed+held ditolak. Rename/revision/pause/email baru tidak reset personal usage; email baru wajib verified untuk berikutnya.
- [x] Paid authoritative dan reserved→consumed + projections/event atomik walau Jubelio fulfillment blocked. Duplicate/out-of-order callbacks/sweep idempotent, counters tidak negatif. Provider money/IDs/linkage sesuai snapshot; expected payable bukan subtotal sebelum Coupon.
- [x] Deny/cancel attempt nonterminal, payment retry, deadline lewat dan provider ambiguous tetap reserved; expiry hanya memicu authoritative check. Tidak memperpanjang deadline atau release hanya karena timeout/clock.
- [x] Unpaid terminal dengan definitive never-applied create atau safe pre-invoice cancel confirmed → release sekali bersama accounting terkait. Cancel intent/dispatched/unknown tetap hold, tidak membatalkan post-invoice atau blind retry write.
- [x] Late paid sesudah released dicatat paid+late review, tetap released, fulfillment blocked; tidak reacquire capacity/replacement SO. Jika hold belum dilepas tetapi cancel path aktif, paid consume hold, fulfillment tetap blocked sesuai spec. Active SO tanpa cancel/release mengikuti guarded existing late settlement.
- [x] Refund manual eksternal tidak membangun event sync/ledger/restore usage. Drift projection ditahan untuk review, bukan reset online. Ownership/one-slot/retention/append-only history, source versions dan lock ordering §9 teruji.
- [x] UI picker/total/order detail dan paid-but-blocked status jujur; diagnostics/logs aman dan docs/seed diperbarui. Writer gate operasional tetap0; real-provider proof memakai evidence existing bounded.

## Verifikasi

T PG nyata untuk reserve/consume/release/policy/stock/replay races melalui public mutation/read interfaces dan SQL constraints. Controlled payment/clock/fault adapters untuk deny/expiry/paid/late paid/duplicate sweep dan provider response ambigu/mismatch1. B actual HTTP/DB untuk public pickup Coupon→order→paid/detail serta blocked path. H gateway/mirror verifies exact discount/linkage; P evidence08/T1–T3/M1–M2 bukan request baru.

Bagi pelaksanaan internal menjadi TDD cycles kecil: satu perilaku publik+failing test→minimal implementation→review, tanpa menulis seluruh suite terlebih dahulu. Ticket tetap open/claimed sampai **semua** safety fixed-public-pickup di atas terbukti; tidak memindahkan safety wajib ke13 demi menutup ticket.

## Batas dan penyelesaian

Baca [kontrak bersama](map.md#kontrak-bersama-untuk-semua-ticket). Manual code/percentage/shipping di09/10/11, refund tooling tetap out of scope. Execution, delegasi, provider requests, commit dan deployment memerlukan izin tersendiri. Main agent merekam Answer/evidence sebelum resolved.

## Answer

**Status: resolved (main agent, sesi 21–22 Oktober 2026).** Scope eksekusi
disetujui pemilik: **pickup saja** (pemilihan Coupon di delivery tetap milik
ticket 11), seluruh acceptance ticket ini, subagent edit-only diizinkan tetapi
semua validasi/review dijalankan main agent. Gate operasional
`discounts.contractVersion` tetap `0` setelah semua run; tidak ada commit,
push, provider request nyata, remote, Docker, atau deployment.

### Yang dibangun

- **Schema** (`packages/db/src/schema/discounts.ts`, `orders.ts`): tabel
  `discount_redemption`, `discount_redemption_event`,
  `discount_client_usage`, `order_discount_allocation` + unique/composite
  ownership FK/shape CHECK; unique `orders(id,user_id)` dan
  `order_item(order_id,id)` sebagai target FK. Migrasi dihasilkan drizzle-kit:
  `0043_dazzling_juggernaut.sql` (unique parent) dan `0044_futuristic_phalanx.sql`
  (tabel baru). `db:check` PASS. Seed-cleanup dan
  `deleteRetainedOrderFixtures` menghapus events → allocations → Redemption →
  client usage sebelum order/Offer.
- **Pure seam**: `packages/db/src/discount-eligibility.ts` (state/activation/
  waktu/minimum/verified email/benefit>0/kuota/budget/jatah, reason aman +
  `parseMoney`), `discount-pricing.ts` (fixed goods clip + alokasi largest
  remainder, Markdown + Coupon).
- **Store read/selection**: `discount-availability.ts` + `POST
  /api/discounts/available` (discovery publik, disabled reason, cursor,
  read-only); `discount-selection.ts` (evaluasi kandidat); review context/token
  kini mengikat identitas Offer/revision/benefit/nominal.
- **Reservasi atomik**: `discount-reservation.ts` (lock Offer → usage → client
  usage, re-evaluasi authoritative, insert Redemption/event/counter/allocation)
  dipanggil di dalam transaksi place-order setelah order ada. Preview pickup
  menerima `promoSelection: none|public`; delivery menolak `public`.
- **Lifecycle**: `discount-lifecycle.ts` + integrasi `order-finalize.ts`
  (paid consume, late paid/late review), `jubelio-sales-lifecycle.ts`
  (confirmed cancel dan definitive never-applied create release sekali; op
  claim terakhir), `checkout-recovery.ts`. Event key unik + conditional
  transition membuat duplicate/out-of-order no-op; counter tidak negatif.
- **Provider**: Sales Order `price` tetap source, `disc_amount` = Markdown +
  alokasi Coupon whole-line, `amount`/`grand_total` = net barang; detail
  Midtrans memakai harga efektif + adjustment Coupon; `expected_provider_payable`
  dari snapshot.
- **UI/read**: picker `PromoSelector` di checkout pickup, total/diskon jujur,
  `promo` status di order detail store + admin, notice paid-but-blocked.
- **Seed/docs**: demo Offer publik enabled + tiga snapshot Redemption
  (consumed/reserved/released) yang konsisten dengan counter; docs
  `features/discount-redemption.md` baru, api-reference, versioned pricing,
  testing, seeding, index.

### Evidence (disposable `marketplace_discounts_test_20261024_v2`)

- `npm run verify:types:store` PASS; `npm run verify:types:admin` PASS;
  focused lint store/admin PASS; `npm run db:check` PASS.
- SQL/DB focused: `discount-redemption-schema.db.test.ts` 9 passed + 1 blocker
  skipped; `discount-availability.db.test.ts` 5 passed; `discount-selection.db.test.ts`
  6 passed; `discount-reservation.db.test.ts` 11 passed (race kuota/budget/jatah,
  pause serialization, consume/release/late review sekali, rollback penuh);
  `discount-lifecycle-flow.db.test.ts` 7 passed (paid consume, confirmed cancel,
  definitive rejection, late settlement dua arah, deny/cancel defer, deadline
  tidak diperpanjang). Log: `/tmp/discounts-t07-unit*.log`.
- Full serial unit setelah perubahan inti: **131 files / 1479 passed / 46
  skipped** (`/tmp/discounts-t07-unit2.log`). Tambahan test setelah itu hanya
  file yang diuji fokus (qty2 pricing, refund-event rejection, defer check).
- Mock E2E (real app HTTP + PG + loopback provider): batch inti **27 passed**
  (checkout-review, versioned-checkout, versioned-settlement, coupons;
  `/tmp/discounts-t07-e2e-3.log`), regresi terdampak **18 passed** (pickup,
  markdown, markdown-settlement, delivery-order, admin discounts;
  `/tmp/discounts-t07-e2e-4.log`), coupon spesifik **3 passed**
  (`/tmp/discounts-t07-e2e-5.log`), dan run akhir **7 passed** setelah
  penataan ulang lock accounting (`/tmp/discounts-t07-e2e-6.log`). Spec
  `e2e/store/discounts-coupon-mock.spec.ts` terdaftar di kedua `testMatch`;
  literal 138750 / provider 125000 / `disc_amount` 25000.
- Seed demo PASS; query konsistensi: reserved1/consumed1 (Rp25.000), released1
  tidak dihitung, 3 allocation, 5 event, gate kembali `0`.

### Tidak diklaim / gap tersisa

- Pemilihan Coupon di checkout delivery, subsidi ongkir, dan slot
  goods↔shipping: ticket 11. Penggantian promo/konfirmasi kenaikan: ticket 08.
  Manual code: 09. Percentage: 10. Usage privacy/aggregate detail dan capacity
  races lanjutan: 12. UAT/rehearsal/rollout: 13.
- Mirror POST settlement yang sudah ada tetap informational (`EDIT_SHAPE_INCOMPLETE`)
  dan SMTP mock disabled; keduanya bukan perubahan ticket ini dan bukan bukti
  email/mirror end-to-end.
- Tidak ada provider request nyata; bukti P memakai evidence existing bounded.
- Tidak ada commit/push/deployment.
