# 07 — Coupon publik nominal dan lifecycle pembayaran

Label: ready-for-agent
Type: task
Status: open
Assignee: none
Blocked by: 03, 06
Parent: [Map implementasi diskon](../map.md)
Spec: [Complete spec](../../../plan/discounts-spec.md)
Acceptance IDs: C01, C05, C06, F01, F02, F03, T01, T02, T03, T04, T05, T06, P01, P02, P03, S01, S02, S03, S04, D01, D02

## Perilaku yang dibangun

Customer memilih Coupon publik fixed-goods tanpa claim pada pickup checkout, bersama Markdown jika ada. Order menahan kuota/budget/jatah secara atomik; paid terverifikasi consume sekali, unpaid yang final dan aman release sekali. Payment/provider ambiguity dan late paid tidak menghilangkan evidence atau merebut kapasitas customer lain.

Ini tracer bullet fixed-public-pickup yang aman, bukan hanya happy path. Reuse admin06, price/provider03 dan checkout02. Pemilihan antar-promo/gugur UX diperinci08; sampai itu tersedia, stale/invalid selection ditolak dengan aman, tidak diteruskan diam-diam.

## Acceptance criteria

- [ ] Picker hanya public enabled/active; relevant belum eligible disabled dengan alasan aman. Tanpa prior claim, preview tidak reserve. Verified store email wajib untuk Offer; contactEmail request bukan pengganti. Checkout tanpa Offer tetap sesuai akses existing.
- [ ] Fixed benefit sekali/order, clipped ke subtotal setelah Markdown; allocation largest remainder/tie variant ID deterministik. Lines150000+100000/fixed25000 →15000+10000, net225000, PPN24750, customer249750. Qty2 whole-line tidak dikalikan dua kali; source/source-discount tetap terbaca provider.
- [ ] Satu Redemption/order sepanjang hidupnya, owner/revision/Offer/benefit/item allocations konsisten. Goods-only slot, Markdown terpisah, allocation0 tidak disimpan; invalid/benefit0 tidak mengonsumsi usage. Tidak menguji alur pembayaran/provider Rp0.
- [ ] Order+request result+items/snapshot+allocations+reserved event/counters+stock hold+SO intent satu commit; failure rollback penuh. Same-key replay02 juga tidak menggandakan Redemption/stock/dispatch.
- [ ] Dua akun berebut last quota/budget atau akun berebut jatah1/configurable2 tidak oversell, hanya full benefit. Budget sisa15000 untuk benefit20000 ditolak, bukan discount diperkecil. Loser tidak punya order/stock hold parsial atau tagihan lebih tinggi.
- [ ] Reserve serial terhadap publish/pause/policy edits. Minimal global bound; lowering quota/budget/per-account di bawah committed consumed+held ditolak. Rename/revision/pause/email baru tidak reset personal usage; email baru wajib verified untuk berikutnya.
- [ ] Paid authoritative dan reserved→consumed + projections/event atomik walau Jubelio fulfillment blocked. Duplicate/out-of-order callbacks/sweep idempotent, counters tidak negatif. Provider money/IDs/linkage sesuai snapshot; expected payable bukan subtotal sebelum Coupon.
- [ ] Deny/cancel attempt nonterminal, payment retry, deadline lewat dan provider ambiguous tetap reserved; expiry hanya memicu authoritative check. Tidak memperpanjang deadline atau release hanya karena timeout/clock.
- [ ] Unpaid terminal dengan definitive never-applied create atau safe pre-invoice cancel confirmed → release sekali bersama accounting terkait. Cancel intent/dispatched/unknown tetap hold, tidak membatalkan post-invoice atau blind retry write.
- [ ] Late paid sesudah released dicatat paid+late review, tetap released, fulfillment blocked; tidak reacquire capacity/replacement SO. Jika hold belum dilepas tetapi cancel path aktif, paid consume hold, fulfillment tetap blocked sesuai spec. Active SO tanpa cancel/release mengikuti guarded existing late settlement.
- [ ] Refund manual eksternal tidak membangun event sync/ledger/restore usage. Drift projection ditahan untuk review, bukan reset online. Ownership/one-slot/retention/append-only history, source versions dan lock ordering §9 teruji.
- [ ] UI picker/total/order detail dan paid-but-blocked status jujur; diagnostics/logs aman dan docs/seed diperbarui. Writer gate operasional tetap0; real-provider proof memakai evidence existing bounded.

## Verifikasi

T PG nyata untuk reserve/consume/release/policy/stock/replay races melalui public mutation/read interfaces dan SQL constraints. Controlled payment/clock/fault adapters untuk deny/expiry/paid/late paid/duplicate sweep dan provider response ambigu/mismatch1. B actual HTTP/DB untuk public pickup Coupon→order→paid/detail serta blocked path. H gateway/mirror verifies exact discount/linkage; P evidence08/T1–T3/M1–M2 bukan request baru.

Bagi pelaksanaan internal menjadi TDD cycles kecil: satu perilaku publik+failing test→minimal implementation→review, tanpa menulis seluruh suite terlebih dahulu. Ticket tetap open/claimed sampai **semua** safety fixed-public-pickup di atas terbukti; tidak memindahkan safety wajib ke13 demi menutup ticket.

## Batas dan penyelesaian

Baca [kontrak bersama](../map.md#kontrak-bersama-untuk-semua-ticket). Manual code/percentage/shipping di09/10/11, refund tooling tetap out of scope. Execution, delegasi, provider requests, commit dan deployment memerlukan izin tersendiri. Main agent merekam Answer/evidence sebelum resolved.
