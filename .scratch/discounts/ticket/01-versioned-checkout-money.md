# 01 — Checkout dengan snapshot uang berversi

Label: ready-for-agent
Type: task
Status: resolved
Assignee: main-agent
Blocked by: none
Parent: [Map implementasi diskon](map.md)
Spec: [Complete spec](../plan/discounts-spec.md)
Acceptance IDs: F02, T06, P01, P02, D02, D03

## Perilaku yang dibangun

Customer melakukan checkout pickup/delivery **tanpa promo** dengan rincian uang authoritative yang disimpan sebagai snapshot berversi. PPN hanya atas net barang, tanpa service fee. Order detail, repayment dan settlement memakai snapshot/payable yang sama, bukan master/config terbaru.

Ini baseline end-to-end untuk kontrak baru, bukan ticket membuat semua tabel diskon. Implementasikan schema/readers/provider/HTTP/UI yang dibutuhkan baseline saja. Request-wide review/idempotency ada pada02; Markdown/Offer diperkenalkan kemudian, tetap dipagari sehingga perilaku parsial tidak aktif di staging/production.

## Acceptance criteria

- [x] Pickup barang150000, contoh PPN11% → customer166500/provider150000. Delivery barang150000 dan ongkir30000 → customer196500/provider180000. Fee0; jumlah detail Midtrans tepat total. Rate11% hanya fixture, bukan hardcode policy baru.
- [x] Snapshot menyimpan source/effective/net goods, PPN/rate/base, original/net ongkir, expected payable dan versi. Service quote/booking cost tetap original; customer shipping terpisah. Tanpa promo kedua nilainya kebetulan sama, bukan asumsi permanen.
- [x] Repayment, detail store/admin dan settlement/recovery membaca snapshot/order intent. Perubahan master price/tax/address/quote sesudah order tidak mengubah nominal atau memperpanjang expiry.
- [x] Provider contract baru memakai net goods+net shipping untuk SO/invoice/payment dan verifikasi; tidak memakai subtotal secara salah di salah satu recovery branch. Source INTERNAL/tax0/fee0, valid identity/account/unit/tax.
- [x] Unknown versions fail closed; legacy snapshot memakai decoder explicit, bukan diasumsikan versi baru. Tidak ada migration usage voucher/dual-write/backfill fiktif.
- [x] Intent/claim/independent verification existing dipertahankan. Timeout/5xx/missing ID/mismatch1 menahan tahap berikut dan fulfillment; jangan blind retry write. Returned IDs yang ada dipertahankan untuk reconciliation.
- [x] Domain writer/version gate default0, paired compatible readers sebelum aktivasi; test-only gate1 hanya disposable. Tidak mengaktifkan Offer/Markdown yang belum diimplementasikan.
- [x] Bounds money/rate/cart/body pada spec berlaku untuk input baseline; exact arithmetic, no unsafe numeric conversion. Snapshot storage/seed/tests sesuai shared schema/timestamptz/retention untuk record yang disentuh.
- [x] UI baru/berubah, endpoint logs dan enduring docs mengikuti kontrak bersama. Existing pickup/delivery dan stock safety tidak diregresikan.

## Verifikasi

Gunakan L/H untuk nominal literal, T untuk order/intent dan snapshot consistency, B untuk checkout→detail→repayment pickup/delivery, external controlled adapters untuk expected payment/SO/invoice/payment dan ambiguity. Regression finalizer/mirror/booking cost yang terpengaruh wajib diperiksa. P existing dibaca bounded, bukan menjalankan real provider writes.

Tambahkan hanya data/schema/seam yang dibutuhkan slice ini. Full replay/crash acceptance T04 bukan diklaim selesai oleh ticket01; handoff menjelaskan result/snapshot interface yang dipakai02.

## Catatan eksekusi

- Pemilik meminta eksekusi seluruh ticket dan mengizinkan subagent development/test pada sesi ini; hanya main agent menjalankan validation. Tidak ada izin provider writes, commit, push, remote/deployment atau launch.
- Topology ticket01: multi-seam. Lane A (worktree utama): exact pricing/snapshot + schema order, tests L/D. Lane B (`../discounts-provider-01`, detached `d96bdf1`): gateway Sales contract2 + typed provider request, tests H. Kontrak independen; integrasi checkout/lifecycle/UI dilakukan sesudah dua handoff direview main agent, oleh writer integration-only.
- Context7 checkpoint: `/drizzle-team/drizzle-orm-docs` — `numeric` exact string, `jsonb().$type<T>()` hanya compile-time sehingga perlu runtime decoder, transaksi PG; `/vitest-dev/vitest` — `test.each`, literal assertions, `.toThrow`/`.rejects`; `/vercel/next.js` — Route Handler JSON/status/headers. Implementasi memakai source/types installed untuk detail versi spesifik.
- Gate operasional tetap `discounts.contractVersion=0`; aktivasi1 hanya disposable tests. Belum ada acceptance yang dinyatakan pass.

## Answer — baseline terverifikasi, 21 Oktober 2026

**Resolved oleh main agent** sesudah review source/diff terhadap acceptance baseline01 dan repo standards. Izin eksekusi/delegasi berasal dari permintaan pemilik; subagent hanya membaca/mengedit, seluruh commands di bawah dijalankan main. Tidak ada commit, provider nyata, SSH/deployment atau aktivasi staging/production.

### Perubahan dan cakupan acceptance

- **F02/T06/P01/P02 baseline:** pricing1/engine1/provider2 terikat header/item/intent. Pickup150000 → PPN16500/customer166500/provider150000; delivery+30000 → customer196500/provider180000. Midtrans items menjumlah total tepat; SO/invoice/payment memakai payable tersimpan, provider tax/fee0.
- **T06/D03:** store dan admin detail memakai shared pure strict decoder; repayment decode sebelum reuse redirect. Master price/tax/rates berubah tidak mengubah snapshot/deadline. Unknown payload version ditolak pada kedua readers/repayment tanpa request provider tambahan. Own-branch admin tetap404; HQ all-branch dapat membaca.
- **P01/P02 safety:** durable returned IDs, ambiguity/mismatch/linkage/account/type/paid amount/due0 dan no blind POST retry dipertahankan; PG/gateway regression sudah tercakup batch unit. Paid pickup/delivery dan duplicate callback diuji lewat actual loopback HTTP, bukan stub response checkout.
- **D02/D03:** snapshot bounds/exact arithmetic, legacy cents decoder, SQL constraints/retention dan fixture cleanup terintegrasi. SQL0034/0035 hasil drizzle-kit dan fresh disposable schema/seed sudah diverifikasi pada sesi sebelumnya (lihat execution.md); tidak hand-edit. Gate operasional default0 dan fixture1 hanya disposable lalu restore.
- **UI/docs/logs:** fee0 tidak tampil sebagai charge; legacy nonzero tetap tampil. Feature/API/PPN/delivery/provider/testing/deployment-reference docs diselaraskan. Endpoint success/error memakai logger terstruktur. Mock test config menambahkan shared auth secret fixture saja, tidak mengubah auth/guard produksi atau env nyata.

### Evidence main

Environment: root worktree-diskon, HEAD awal d96bdf1 + dirty feature diff; PostgreSQL disposable **marketplace_discounts_test_20261019_v2**, URL eksplisit; provider HTTP hanya loopback3110/3111/3112.

| Gate | Hasil | Artifact |
| --- | --- | --- |
| verify:types:store | PASS setelah perubahan UI/store | /tmp/discounts-resume2-types-store.log |
| verify:types:admin | PASS setelah paired reader | /tmp/discounts-resume2-admin-decoder-types.log |
| Focused lint store8files/admin2files | PASS | /tmp/discounts-resume2-store-lint.log; /tmp/discounts-resume2-admin-lint.log |
| verify:batch:unit | **115files passed;1314tests passed,3skipped** | /tmp/discounts-resume2-t01-batch-unit-final.log |
| versioned checkout input bounds + pickup review | 2passed (bagian GREEN pada run awal, source terkait tidak berubah lagi) | /tmp/discounts-resume2-checkout-browser-red.log |
| versioned pickup UI/Snap/detail/repayment | 1passed (delivery di run sama masih fixture auth RED, kemudian diperbaiki) | /tmp/discounts-resume2-reader-contract-red.log |
| versioned delivery UI/Snap/store+admin/repayment/unknown failclosed | 1passed | /tmp/discounts-resume2-admin-delivery-browser-green.log |
| public HTTP paid pickup + duplicate callback | 1passed | /tmp/discounts-resume2-paid-pickup-browser-green.log |
| public HTTP paid delivery + duplicate callback | 1passed | /tmp/discounts-resume2-admin-delivery-browser-green.log |
| Affected legacy5mock specs | 16passed;1failed karena missing shared auth test env; failing pickup rerun **1passed** setelah config fixture diperbaiki | /tmp/discounts-resume2-t01-mock-regression-final.log; /tmp/discounts-resume2-pickup-regression-green.log |

Semua browser commands memakai `npm run verify:batch:e2e -- <explicit spec paths>` dan grep hanya saat focused recheck. Tidak mengulang assertions/suites yang sudah lulus tanpa perubahan terkait. Tiga unit skips adalah readiness-placeholder guards; actual PostgreSQL behavior suites dijalankan. Itu bukan3 acceptance pass tambahan. RED→GREEN admin dan mock payment tercatat pada execution.md.

### Batas bukti dan handoff02/06

- F02/T06/P01/P02/D02/D03 **hanya konteks baseline tanpa promo**; discounted mapping, Offer usage, checkout-wide request replay/review, dan acceptance integrasi tetap milik ticket selanjutnya.
- Mock channel marker/mirror belum memodelkan seluruh informational edit envelope; failure log best-effort tidak diklaim sebagai live provider proof. Gateway/mirror realPG+controlled-adapter regression berada dalam full unit. SMTP sengaja tidak aktif; tidak ada klaim email terkirim.
- Standard legacy live-provider E2E, build/rehearsal/UAT staging/release/launch belum dijalankan dan tetap gate13/izin terpisah. Ini bukan alasan mengklaim seluruh fitur diskon/rilis selesai.
- Handoff: snapshot/strict decoder dan provider intent versi sudah stabil; frontier **02 dan06** sekarang eligible diklaim paralel di worktree terisolasi. Domain gate tetap0.

## Batas dan penyelesaian

Baca [kontrak bersama, izin dan testing](map.md#kontrak-bersama-untuk-semua-ticket) sebelum bekerja. Tidak ada service fee/pembuktian pembayaran-provider Rp0. Tidak ada izin eksekusi, subagent, provider request, commit atau deployment dari ticket ini. Setelah execution berizin, main agent mencatat perubahan/review/commands/acceptance/pass-fail-blocked di Answer sebelum resolved.
