# 10 — Percentage goods dengan cap opsional

Label: ready-for-agent
Type: task
Status: resolved
Assignee: main-agent
Blocked by: 08
Parent: [Map implementasi diskon](map.md)
Spec: [Complete spec](../plan/discounts-spec.md)
Acceptance IDs: C02, C05, F01, F02, F03, P01, P02, P03, D02, D03

## Perilaku yang dibangun

Admin menyusun, mensimulasikan dan mempublish percentage-goods Offer dengan cap opsional. Customer memakai benefit itu pada seluruh barang setelah Markdown melalui selection/reservation/payment yang sudah ada; pembulatan/alokasi tepat dan diskon provider cocok snapshot.

Deliver public Coupon end-to-end pada slice ini. Benefit evaluator/admin schema tidak terikat activation public; manual channel09 memakai kontrak benefit yang sama setelah terintegrasi. Kombinasi manual+percentage menjadi integration coverage13, bukan alasan duplicate implementation atau menambah blocker09 ke10.

## Acceptance criteria

- [x] Admin form/draft/review/publish/simulation menerima rate `>0..100` sampai6 fractional digits, cap nullable atau positif; fixed amount tidak ikut terisi. Unsupported params/kind/version/precision berlebih ditolak, bukan silent rounding/default ke fixed.
- [x] Persentase general atas subtotal seluruh barang setelah Markdown, sebelum PPN/ongkir. Minimum memakai subtotal tersebut, tanpa produk/kategori/brand targeting.
- [x] Subtotal450000,10% cap20000 → benefit20000, net430000, PPN47300, total477300. Tanpa cap → benefit45000, net405000, PPN44550, total449550. Cap sekali per order, bukan line/unit.
- [x] Benefit10% atas100005 dibulatkan floor10000. Allocation proportional whole-line/largest remainder dengan tie variant ID stabil; total allocation persis benefit dan nonnegative. Unit details tidak menghitung ulang whole-line dengan rounding berbeda.
- [x] Source100000,target90000,qty2,10% → Markdown20000/Coupon18000/net162000/PPN17820/customer179820/provider162000; provider gross200000/disc38000 whole-line, tidak dikalikan quantity lagi.
- [x] Subtotal50,1% menghasilkan benefit0 dan tidak diterapkan/tidak usage. Invalid config tidak publish. Ini bukan pembuktian pembayaran/provider Rp0.
- [x] Selected Offer replacement memakai total-final confirmation08, preview tanpa hold, capacity reserve full actual benefit07. Budget tak cukup tidak memotong benefit mengikuti sisa, quota/jatah/code identity tidak dipisah oleh benefit type.
- [x] Order/intent snapshots serta SO/invoice/payment/recovery/mirror memakai allocation exact dan original source price; persentase GET yang rounded tidak dipakai menghitung ulang nominal. Selisih1/ambiguity tetap blocked, field shipping discount omitted.
- [x] Stale drafts/current grants/version decoders, schema/seed, logs dan docs tetap mengikuti kontrak; tidak generic evaluator/plugin framework atau benefit kedua per Offer.

## Verifikasi

L literals independen untuk cap/uncapped/fraction/tie/qty2, T public checkout/reservation read results dengan PG nyata, H external payload/independent GET/mirror mismatch, B admin form/simulation→public picker/swap→paid order detail. Contract maps tetap memakai evidence08/M1M2 bounded, bukan universal proof semua fractional post-invoice values atau izin tests live. Carry regression fixed-goods08/07.

## Answer

**Acceptance IDs:** C02, C05, F01, F02, F03, P01, P02, P03, D02, D03.

**Kontrak yang diimplementasikan**

- Benefit goods version1 punya dua bentuk sah: `fixed_goods` (nominal positif)
  dan `percentage_goods` (`rate` `>0..100` maksimal6 digit pecahan, `cap_amount`
  NULL atau positif). Shape check DB menolak field campuran; validator modul
  menolak kind/versi/precision/field asing tanpa pembulatan atau default ke
  fixed. Schema: `packages/db/src/schema/discounts.ts`, migrasi generated
  `packages/db/drizzle/0050_polite_lady_ursula.sql` (diterapkan ke DB disposable;
  `db:check` PASS).
- Satu helper exact dipakai eligibility, admin simulation, preview dan
  place-order: `packages/db/src/discount-pricing.ts` →
  `D = min(floor(subtotal × rate / 100), subtotal, cap)`; fixed tetap
  `min(nominal, subtotal)`. Allocation whole-line proporsional + largest
  remainder + tie variant ID tidak berubah dan sekarang juga melayani
  percentage. Benefit0 (mis. subtotal50 rate1%) tidak eligible/tidak dipakai.
- Candidate store membawa bentuk benefit asli (`benefit`), bukan nominal yang
  sudah dibulatkan; preview/place-order menghitung snapshot dari bentuk itu dan
  menolak jika `goodsDiscount !== benefitAmount` (selisih sekecil apa pun fail
  closed). `terms_snapshot`/`result_snapshot` Redemption menyimpan bentuk benefit.
- Admin: draft/review/publish/simulate/DTO/list/editor mendukung percentage;
  fingerprint publish mengikat rate/cap; route draft memakai zod union strict
  per kind. Seed demo menambah Offer "Diskon Demo 10% (maks Rp20.000)" (gate
  operasional tetap 0).
- Provider/SO memakai `sourceLineAmount − netLineAmount` (Markdown + alokasi
  Coupon whole-line, tidak dikali quantity lagi). Test H baru menolak drift 1
  Rupiah pada `discAmount`/payable.

**File utama yang berubah**

- `packages/db/src/discount-pricing.ts`, `discount-eligibility.ts`,
  `schema/discounts.ts`, `drizzle/0050_polite_lady_ursula.sql`, `seed.ts`
- `apps/admin/src/lib/discounts-administration.ts`,
  `app/api/admin/discounts/[id]/draft/route.ts`,
  `app/admin/discounts/[id]/discount-editor-client.tsx`,
  `app/admin/discounts/discounts-list-client.tsx`
- `apps/store/src/lib/discount-availability.ts`, `discount-selection.ts`,
  `discount-reservation.ts`, `app/api/checkout/preview/route.ts`,
  `app/api/checkout/place-order/route.ts`,
  `components/checkout/PromoSelector.tsx`
- Tests: pricing/eligibility/schema DB/admin unit+DB/store selection+reservation+lifecycle/jubelio-sales-expected; E2E
  `e2e/admin/discounts-admin-mock.spec.ts`, `e2e/store/discounts-coupon-mock.spec.ts`
- Docs: `docs/features/discount-administration.md`, `discount-redemption.md`,
  `markdown-pricing.md`, `seeding.md`, `docs/testing/README.md`, `docs/api-reference.md`

**Evidence (dijalankan main agent)**

- `npm run verify:types:store` → PASS; `npm run verify:types:admin` → PASS.
- `npm run db:check` → PASS (setelah migrasi 0050 via psql ke DB disposable
  `marketplace_discounts_test_20261026`).
- `npm run verify:batch:unit` → **142 files / 1669 passed / 12 skipped** (exit 0).
  Termasuk literal L: cap/uncapped 450000, floor100005, fraction rate
  `12.345678`, tie largest remainder, qty2 source100000→target90000 10%,
  subtotal50 rate1%→0, guard rate/cap/precision, dan drift provider 1 Rupiah.
- Focused L1: pricing+eligibility+schema DB+admin unit+admin DB+selection+
  reservation+availability DB → **152 passed / 3 skipped**.
- `npm run verify:batch:e2e -- e2e/admin/discounts-admin-mock.spec.ts
  e2e/store/discounts-coupon-mock.spec.ts` → **16 passed**. Mencakup admin form
  percentage → simpan → simulasi 149850 → review valid, picker publik
  `Diskon 10% (maks Rp 20.000)`, place order percentage (Redemption
  `benefit_amount 15000`, allocation `offer_goods 15000`, provider
  `price 150000/disc_amount 15000/amount 135000`), dan regresi fixed/replacement/
  manual code.
- `npm run lint:admin` → 0 error (37 warning lama). `npm run lint:store` → satu
  error pre-existing `Header.tsx` (setState dalam effect), tidak berasal dari
  slice ini; warning `_dropped` lama.
- `npm run db:seed` → PASS; gate `discounts.contractVersion` kembali `0`,
  tidak ada fixture test tersisa.

**Context7 checkpoint:** tidak ada API library eksternal baru pada slice ini
(Drizzle hanya perubahan kolom/CHECK yang sudah dikonfirmasi pola-nya pada
ticket sebelumnya; Zod union/strict memakai API yang sudah dipakai repo), jadi
lookup Context7 tidak diperlukan. Tidak ada provider write/remote/commit/deploy.

**Gap yang tidak diklaim**

- Bukan bukti pembayaran/provider Rp0; gateway tetap `expectedProviderPayable`.
- Kombinasi Manual Promo Code + percentage dalam satu checkout dan seluruh
  contract map lintas fitur (M1/M2/evidence08 dalam envelope bounded) tetap
  direkonsiliasi pada ticket 13; mirror mismatch percentage tidak diuji ulang
  secara spesifik di luar drift test pure di atas.
- Tidak ada test live-provider/Jubelio/Midtrans, UAT staging, atau rollout;
  shipping subsidy tetap ticket 11.

## Batas dan penyelesaian

Tidak menambah targeting atau dynamic percentage Markdown; shortcut harga04 tetap half-up menjadi fixed target, bukan engine benefit ini. Baca [kontrak bersama](map.md#kontrak-bersama-untuk-semua-ticket). Izin execution/provider/delegasi/commit/deploy terpisah; main agent menjalankan TDD/review/tests dan mencatat Answer sebelum resolved.
