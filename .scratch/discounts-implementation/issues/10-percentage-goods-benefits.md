# 10 — Percentage goods dengan cap opsional

Label: ready-for-agent
Type: task
Status: open
Assignee: none
Blocked by: 08
Parent: [Map implementasi diskon](../map.md)
Spec: [Complete spec](../../../plan/discounts-spec.md)
Acceptance IDs: C02, C05, F01, F02, F03, P01, P02, P03, D02, D03

## Perilaku yang dibangun

Admin menyusun, mensimulasikan dan mempublish percentage-goods Offer dengan cap opsional. Customer memakai benefit itu pada seluruh barang setelah Markdown melalui selection/reservation/payment yang sudah ada; pembulatan/alokasi tepat dan diskon provider cocok snapshot.

Deliver public Coupon end-to-end pada slice ini. Benefit evaluator/admin schema tidak terikat activation public; manual channel09 memakai kontrak benefit yang sama setelah terintegrasi. Kombinasi manual+percentage menjadi integration coverage13, bukan alasan duplicate implementation atau menambah blocker09 ke10.

## Acceptance criteria

- [ ] Admin form/draft/review/publish/simulation menerima rate `>0..100` sampai6 fractional digits, cap nullable atau positif; fixed amount tidak ikut terisi. Unsupported params/kind/version/precision berlebih ditolak, bukan silent rounding/default ke fixed.
- [ ] Persentase general atas subtotal seluruh barang setelah Markdown, sebelum PPN/ongkir. Minimum memakai subtotal tersebut, tanpa produk/kategori/brand targeting.
- [ ] Subtotal450000,10% cap20000 → benefit20000, net430000, PPN47300, total477300. Tanpa cap → benefit45000, net405000, PPN44550, total449550. Cap sekali per order, bukan line/unit.
- [ ] Benefit10% atas100005 dibulatkan floor10000. Allocation proportional whole-line/largest remainder dengan tie variant ID stabil; total allocation persis benefit dan nonnegative. Unit details tidak menghitung ulang whole-line dengan rounding berbeda.
- [ ] Source100000,target90000,qty2,10% → Markdown20000/Coupon18000/net162000/PPN17820/customer179820/provider162000; provider gross200000/disc38000 whole-line, tidak dikalikan quantity lagi.
- [ ] Subtotal50,1% menghasilkan benefit0 dan tidak diterapkan/tidak usage. Invalid config tidak publish. Ini bukan pembuktian pembayaran/provider Rp0.
- [ ] Selected Offer replacement memakai total-final confirmation08, preview tanpa hold, capacity reserve full actual benefit07. Budget tak cukup tidak memotong benefit mengikuti sisa, quota/jatah/code identity tidak dipisah oleh benefit type.
- [ ] Order/intent snapshots serta SO/invoice/payment/recovery/mirror memakai allocation exact dan original source price; persentase GET yang rounded tidak dipakai menghitung ulang nominal. Selisih1/ambiguity tetap blocked, field shipping discount omitted.
- [ ] Stale drafts/current grants/version decoders, schema/seed, logs dan docs tetap mengikuti kontrak; tidak generic evaluator/plugin framework atau benefit kedua per Offer.

## Verifikasi

L literals independen untuk cap/uncapped/fraction/tie/qty2, T public checkout/reservation read results dengan PG nyata, H external payload/independent GET/mirror mismatch, B admin form/simulation→public picker/swap→paid order detail. Contract maps tetap memakai evidence08/M1M2 bounded, bukan universal proof semua fractional post-invoice values atau izin tests live. Carry regression fixed-goods08/07.

## Batas dan penyelesaian

Tidak menambah targeting atau dynamic percentage Markdown; shortcut harga04 tetap half-up menjadi fixed target, bukan engine benefit ini. Baca [kontrak bersama](../map.md#kontrak-bersama-untuk-semua-ticket). Izin execution/provider/delegasi/commit/deploy terpisah; main agent menjalankan TDD/review/tests dan mencatat Answer sebelum resolved.
