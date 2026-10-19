# 11 — Subsidi ongkir dan pemisahan biaya kurir

Label: ready-for-agent
Type: task
Status: open
Assignee: none
Blocked by: 09
Parent: [Map implementasi diskon](../map.md)
Spec: [Complete spec](../../../plan/discounts-spec.md)
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

Baca [kontrak bersama](../map.md#kontrak-bersama-untuk-semua-ticket). Tidak ada merchant funding fields provider baru, courier-specific targeting, fee, Rp0 payment proof atau refund tooling. Main agent melakukan TDD/review/verification setelah izin execution, lalu mencatat Answer sebelum resolved; tidak implicit deploy/launch.
