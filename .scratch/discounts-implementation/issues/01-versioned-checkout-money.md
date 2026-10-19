# 01 — Checkout dengan snapshot uang berversi

Label: ready-for-agent
Type: task
Status: open
Assignee: none
Blocked by: none
Parent: [Map implementasi diskon](../map.md)
Spec: [Complete spec](../../../plan/discounts-spec.md)
Acceptance IDs: F02, T06, P01, P02, D02, D03

## Perilaku yang dibangun

Customer melakukan checkout pickup/delivery **tanpa promo** dengan rincian uang authoritative yang disimpan sebagai snapshot berversi. PPN hanya atas net barang, tanpa service fee. Order detail, repayment dan settlement memakai snapshot/payable yang sama, bukan master/config terbaru.

Ini baseline end-to-end untuk kontrak baru, bukan ticket membuat semua tabel diskon. Implementasikan schema/readers/provider/HTTP/UI yang dibutuhkan baseline saja. Request-wide review/idempotency ada pada02; Markdown/Offer diperkenalkan kemudian, tetap dipagari sehingga perilaku parsial tidak aktif di staging/production.

## Acceptance criteria

- [ ] Pickup barang150000, contoh PPN11% → customer166500/provider150000. Delivery barang150000 dan ongkir30000 → customer196500/provider180000. Fee0; jumlah detail Midtrans tepat total. Rate11% hanya fixture, bukan hardcode policy baru.
- [ ] Snapshot menyimpan source/effective/net goods, PPN/rate/base, original/net ongkir, expected payable dan versi. Service quote/booking cost tetap original; customer shipping terpisah. Tanpa promo kedua nilainya kebetulan sama, bukan asumsi permanen.
- [ ] Repayment, detail store/admin dan settlement/recovery membaca snapshot/order intent. Perubahan master price/tax/address/quote sesudah order tidak mengubah nominal atau memperpanjang expiry.
- [ ] Provider contract baru memakai net goods+net shipping untuk SO/invoice/payment dan verifikasi; tidak memakai subtotal secara salah di salah satu recovery branch. Source INTERNAL/tax0/fee0, valid identity/account/unit/tax.
- [ ] Unknown versions fail closed; legacy snapshot memakai decoder explicit, bukan diasumsikan versi baru. Tidak ada migration usage voucher/dual-write/backfill fiktif.
- [ ] Intent/claim/independent verification existing dipertahankan. Timeout/5xx/missing ID/mismatch1 menahan tahap berikut dan fulfillment; jangan blind retry write. Returned IDs yang ada dipertahankan untuk reconciliation.
- [ ] Domain writer/version gate default0, paired compatible readers sebelum aktivasi; test-only gate1 hanya disposable. Tidak mengaktifkan Offer/Markdown yang belum diimplementasikan.
- [ ] Bounds money/rate/cart/body pada spec berlaku untuk input baseline; exact arithmetic, no unsafe numeric conversion. Snapshot storage/seed/tests sesuai shared schema/timestamptz/retention untuk record yang disentuh.
- [ ] UI baru/berubah, endpoint logs dan enduring docs mengikuti kontrak bersama. Existing pickup/delivery dan stock safety tidak diregresikan.

## Verifikasi

Gunakan L/H untuk nominal literal, T untuk order/intent dan snapshot consistency, B untuk checkout→detail→repayment pickup/delivery, external controlled adapters untuk expected payment/SO/invoice/payment dan ambiguity. Regression finalizer/mirror/booking cost yang terpengaruh wajib diperiksa. P existing dibaca bounded, bukan menjalankan real provider writes.

Tambahkan hanya data/schema/seam yang dibutuhkan slice ini. Full replay/crash acceptance T04 bukan diklaim selesai oleh ticket01; handoff menjelaskan result/snapshot interface yang dipakai02.

## Batas dan penyelesaian

Baca [kontrak bersama, izin dan testing](../map.md#kontrak-bersama-untuk-semua-ticket) sebelum bekerja. Tidak ada service fee/pembuktian pembayaran-provider Rp0. Tidak ada izin eksekusi, subagent, provider request, commit atau deployment dari ticket ini. Setelah execution berizin, main agent mencatat perubahan/review/commands/acceptance/pass-fail-blocked di Answer sebelum resolved.
