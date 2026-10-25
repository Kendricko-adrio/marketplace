# 11 — Subsidi ongkir dan pemisahan biaya kurir

Label: ready-for-agent
Type: task
Status: resolved
Assignee: main-agent
Blocked by: 09
Parent: [Map implementasi diskon](map.md)
Spec: [Complete spec](../plan/discounts-spec.md)
Acceptance IDs: C01, C02, C04, C05, F01, F02, F03, T06, P01, P02, P03, D02, D03

## Perilaku yang dibangun

Admin mempublish shipping-subsidy Offer public/manual. Customer delivery memakai satu benefit ongkir dalam slot yang sama dengan goods Coupon/code. Customer membayar net shipping, tetapi quote/biaya kurir tetap original dan booking tidak ikut diberi subsidi kedua kali.

Depends09 untuk membuktikan kedua activation paths; tidak bergantung percentage10 karena benefit terpisah. Re-use selection08, reservation07, baseline delivery01 dan provider03.

## Acceptance criteria

- [ ] Admin form/draft/simulate/publish shipping memakai cap positif, tanpa rate/fixed goods fields. Delivery dengan valid positive shipping eligible, pickup/ongkir0 disabled dengan alasan. Tanpa kurir targeting khusus.
- [ ] Goods150000, original shipping30000, cap20000 → subsidy20000/net shipping10000/PPN16500/customer176500/provider160000. PPN hanya goods, tanpa service fee. Public dan manual paths keduanya terbukti.
- [ ] Original shipping12000/cap20000 → subsidy12000/net0, sisa8000 hangus, customer166500/provider150000 untuk goods150000/PPN11%. Ini clipping ongkir, bukan pembayaran/provider Rp0 proof.
- [ ] Satu Redemption shipping tanpa item allocation, amount actual subsidy. Budget/full capacity/per-account lifecycle07 berlaku, tidak menambah slot goods dan tidak memasukkan subsidy ke goods disc_amount.
- [ ] Ganti goods↔shipping memakai final-total comparison/confirmation08. Selected shipping lalu pickup/cart/minimum/context invalid memerlukan reselect atau explicit continue-without; invalid perk tidak dibawa ke order.
- [ ] Fresh delivery quote/reprice mengikat selected service/origin/destination/current goods+promo. Failed/empty/stale quote tidak menjadi shipping0 palsu. Preview bukan reservation atau accepted quote permanen.
- [ ] Snapshot membedakan original customer shipping, subsidy/funding merchant, net customer, quote cost, dan billed cost nullable sampai ada evidence. Service shippingCost/parcel/booking expected cost tetap original; pricing shippingCost net. Jangan mengurangi subsidy dua kali atau mengubah courier value sebagai workaround.
- [ ] Packing/booking/payment/settlement/recovery guards membaca komponen snapshot yang benar, bukan equality original quote=net customer. Address/master/price/config changes sesudah order tidak mengubah booking/repayment money.
- [ ] SO original_shipment_cost sebelum subsidi, shipping_cost net, shipping_cost_discount omitted actual request, add_disc0/provider tax/fees0. Invoice/payment/recovery expected net goods+net shipping exact, financial linkage preserve lintas mirror.
- [ ] Qty>1/Markdown + shipping Offer tetap whole-line goods discount yang benar. Mismatch1/ambiguity mempertahankan paid/hold/review sesuai lifecycle, tidak blind retry atau cancel post-invoice.
- [ ] Shipping schema/typed versions/constraints/seed/docs/browser states/current policy/logs diperbarui, no empty future tables, operasional writer gate tetap0 sampai rollout berizin.

## Verifikasi

L independent clipping/money literals; T PG shipping allocation/usage/no second slot dan snapshot ownership; H quote/order/repayment/provider/mirror/packing/booking external controlled seam; B real public/manual delivery flows, pickup invalidation dan swap confirmation. Fixtures membuktikan quote30000/net10000 tetapi booking cost30000 tanpa actual courier creation. Existing evidence T1–T3/M1M2 dibaca bounded, tidak diperluas menjadi izin API sandbox.

## Batas dan penyelesaian

Baca [kontrak bersama](map.md#kontrak-bersama-untuk-semua-ticket). Tidak ada merchant funding fields provider baru, courier-specific targeting, fee, Rp0 payment proof atau refund tooling. Main agent melakukan TDD/review/verification setelah izin execution, lalu mencatat Answer sebelum resolved; tidak implicit deploy/launch.

## Answer

**Acceptance IDs:** C01, C02, C04, C05, F01, F02, F03, T06, P01, P02, P03, D02, D03 — seluruh checkbox tiket terpenuhi untuk scope ticket 11; bukti di bawah dijalankan main agent pada worktree `worktree/diskon` dan DB disposable `marketplace_discounts_test_*`. Tidak ada commit/push/remote/deploy/provider write nyata.

### Yang berubah

- Shared: `packages/db/src/discount-pricing.ts` (benefit `shipping`, `offerBenefitAmount`, clipping, guard subsidi kedua), `discount-eligibility.ts` (reason `FULFILLMENT_NOT_ELIGIBLE`, budget/kuota memakai subsidi aktual), `versioned-pricing.ts` (`merchantFunding === shippingSubsidy`), `schema/discounts.ts` + migrasi generated `drizzle/0051_numerous_sebastian_shaw.sql` (kind/scope/shape shipping), `seed.ts` (Offer publik cap20000 + Offer manual cap15000 kode `ONGKIRHEMAT`).
- Admin: `discounts-administration.ts` + draft route zod + editor UI — draft/review/publish/simulate shipping hanya cap positif, simulasi delivery menampilkan ongkir asli/subsidi/net.
- Store: `discount-selection.ts`, `discount-availability.ts` (+ route), `discount-reservation.ts` (satu allocation `offer_shipping` tanpa item), `offer-pricing.ts` (satu jalur apply benefit), `checkout-review.ts` (fingerprint ongkir original/subsidi), `checkout-delivery-review.ts` (delivery promo public/manual + replacement/invalidation), `place-order` (quote fresh → benefit → approval NET → snapshot original/net; pickup memakai bentuk benefit asli), checkout page (picker delivery, breakdown subsidi/net).
- Docs: `docs/features/discount-administration.md`, `discount-redemption.md`, `versioned-checkout-pricing.md`, `seeding.md`, `docs/api-reference.md`, `docs/testing/README.md`.

### Evidence (pass)

- L: `npm run verify:unit:slice -- packages/db/src/discount-pricing.test.ts packages/db/src/discount-eligibility.test.ts` → **70 passed**; mencakup literals 150000/30000/cap20000 → subsidi20000/net10000/PPN16500/total176500/payable160000; 12000/cap20000 → subsidi12000/net0/total166500/payable150000 sisa8000 hangus; pickup/ongkir0 ditolak; Markdown qty2 + shipping (line net180000, goodsDiscount0, total209800); guard bentuk cap.
- T (PostgreSQL nyata): `npm run verify:unit:slice -- apps/store/src/lib/discount-shipping.db.test.ts` → **2 passed, 1 skip guard**; satu Redemption shipping, satu allocation `offer_shipping` `order_item_id NULL` amount20000, `goods_discount_amount`0, usage/budget/per-account memakai subsidi aktual, pickup disabled.
- H (controlled adapter/pure): `apps/store/src/lib/jubelio-sales-shipping.test.ts` → **3 passed**; intent 30000/10000/payable160000, request `original_shipment_cost`30000/`shipping_cost`10000/`grand_total`160000/`add_disc`0/tax0, tanpa `shipping_cost_discount`, disc_amount barang0; drift 1 Rupiah ditolak.
- Batch unit (L2): `npm run verify:batch:unit` → **144 files / 1685 passed / 13 skipped**.
- B (Playwright mock, app HTTP + PG nyata + provider loopback): `e2e/store/checkout-review-mock.spec.ts` → **20 passed**, termasuk (a) pickup dengan Offer shipping → `409 PROMO_INELIGIBLE`; (b) delivery publik ongkir30000 cap20000 → preview total176500/subsidi20000/net10000, swap ke coupon kecil → `requiresIncreaseConfirmation` + direction `increase` (prev176500 → 190950), place 201 dengan snapshot `delivery_snapshot.service.shippingCost=30000`, pricing net10000, merchant funding20000, satu allocation shipping, intent provider 30000/10000/160000; (c) delivery manual `ONGKIRMOCK15` → subsidi15000/net15000/total181500, Redemption `manual_only` + code, allocation shipping; (d) cart berubah setelah review → request lama ditolak (404/409), bukan dipakai.
- B admin: `npx playwright test --config=playwright.mock.config.ts e2e/admin/discounts-admin-mock.spec.ts` → **6 passed**, termasuk draft shipping cap/simulasi delivery 176500 + subsidi20.000/review valid/publish.
- Regresi E2E terdampak: `delivery-order-mock.spec.ts` + `discounts-coupon-mock.spec.ts` → **18 passed** (snapshot/repayment stabil, reprice, settlement, coupon pickup).
- Types: `npm run verify:types:store` dan `npm run verify:types:admin` PASS. Schema: `drizzle-kit check` PASS; migrasi 0051 diterapkan ke DB disposable; `npm run db:seed` PASS.
- Gate akhir `discounts.contractVersion = 0`; tidak ada fixture test tersisa (cleanup spec/DB). Context7 checkpoint: tidak ada API library baru/berubah yang dipakai (pekerjaan memakai API internal repo yang sudah dikonfirmasi pada slice sebelumnya), sehingga tidak ada lookup baru.

### Gap yang tidak diklaim

- Live provider Jubelio/Midtrans/Shipment dan UAT/staging/rollout tidak dijalankan (izin terpisah); `providerBilledShippingCost` tetap nullable dan belum diisi karena tidak ada evidence billed.
- `npm run test:e2e` legacy tidak dijalankan (live-provider writes).
- Explicit continue-without-promo khusus shipping tidak punya test E2E sendiri; jalur kode generik ticket 08 sudah teruji untuk coupon dan dipakai sama. Kombinasi manual+shipping lintas semua benefit direkonsiliasi di ticket 13.
