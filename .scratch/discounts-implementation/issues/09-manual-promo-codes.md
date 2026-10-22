# 09 — Manual Promo Code dalam slot bersama

Label: ready-for-agent
Type: task
Status: resolved
Assignee: main-agent
Blocked by: 08
Parent: [Map implementasi diskon](../map.md)
Spec: [Complete spec](../../../plan/discounts-spec.md)
Acceptance IDs: C01, C02, C03, C05, C07, T02, A01, A03, A04, D01, D02

## Perilaku yang dibangun

Admin membuat Offer manual-only dan mengelola kode-kodenya. Customer memasukkan kode untuk memakai benefit fixed-goods melalui slot yang sama dengan Coupon publik. Kode baru invalid tidak merusak pilihan lama; pergantian kode tidak mereset usage atau memperbesar kapasitas. Viewer tidak menerima literal kode lewat saluran alternatif.

Re-use fixed benefit/reservation07 dan selection/review08; jangan membuat engine atau counters khusus per code.

## Acceptance criteria

- [x] Public/manual-only adalah activation kind identity tetap; public tidak punya code. Manual code tidak muncul di available public picker. Perubahan activation membutuhkan identitas Offer baru, bukan revision bypass.
- [x] Normalize trim+uppercase, ASCII3–64 alphanumeric awal dan alphanumeric/underscore/hyphen berikutnya, exact canonical uniqueness. Input ` hemat17agustus ` → HEMAT17AGUSTUS; internal spaces/Unicode alias invalid. Unknown/nonaktif/expired memberi alasan aman tanpa code discovery.
- [x] Published code literal/owner immutable dan reserved selamanya; replacement membuat record baru di Offer sama. Kode inactive/archived tidak dapat dialihkan ke Offer lain. Draft code proposals baru direservasi ketika publish/add berhasil, bukan saat mengetik draft.
- [x] Semua kode Offer berbagi quota/budget/per-account history. Rename/revision/kode baru/email change tidak mereset usage; no code binding/subquota/expiry terpisah.
- [x] Customer verified store email memakai manual code sampai order/paid/release melalui transaksi/lifecycle07. Tepat satu Redemption dan source code yang benar disimpan; tidak ada slot tambahan setelah public Coupon.
- [x] Code invalid/kehabisan capacity mempertahankan old valid selection dan total. Candidate valid total naik memakai confirmation08; same/lower direct replace. Jika old sendiri gugur, jalur invalidation/explicit continue-without tetap berlaku.
- [x] Account/IP manual-code limits20/120 per60detik diterapkan pada seluruh HTTP paths yang membawa code, termasuk invalid shape setelah admission; shared IP bukan entitlement. Lintas proses, forged header, Retry-After/503 unavailable teruji. No per-keystroke calls atau literal dalam URL/log.
- [x] Viewer masked di list/detail/API/export/history/audit; hanya promo editor mendapat literal lengkap di protected interface. Audit grant sendiri tidak membuka kode. Store order hanya mengungkap kode milik order customer itu, bukan semua codes Offer.
- [x] Create/add/state receipts/version guards/current policy menjamin lost response tidak menggandakan code/audit atau menimpa edit stale. Code ownership/cardinality constraints dan retention berlaku.
- [x] Schema/canonical indexes/seed/role/UI/logs/API/privacy docs dan Playwright coverage diperbarui; writer gate operasional tetap0.

## Verifikasi

L/H canonical boundary/length/charset; T real PG duplicate publish/add-code, owner immutability, replay, shared last quota dan code-change no reset. B admin code creation/state/masked viewer dan store apply→swap invalid/valid→order/detail. Inspect actual response bodies untuk absence literal di viewer channels, bukan hanya teks layar tersembunyi. H rate windows/trusted IP dengan controlled time, no real provider requests.

## Batas dan penyelesaian

Percentage adalah benefit terpisah10; tidak menjadikan09 prerequisite10 hanya karena keduanya berbagi module. Cross manual+percentage diverifikasi13 setelah integrasi. Baca [kontrak bersama](../map.md#kontrak-bersama-untuk-semua-ticket); no service fee/Rp0 proof, execution/provider writes/delegasi/commit/deploy tetap perlu izin. Main agent mencatat review/evidence di Answer sebelum resolved.

## Answer

**Status: resolved (main agent).** Implementasi Manual Promo Code di atas
benefit fixed-goods/reservation07 dan selection/review08; tanpa engine, counter,
subquota, atau slot kedua per kode. Gate operasional `discounts.contractVersion`
kembali **0** setelah seluruh run; tidak ada commit/push/provider write/remote/
deployment.

### Context7 checkpoint

- `/drizzle-team/drizzle-orm-docs` — memverifikasi bahwa
  `.onConflictDoNothing({ target })` membatalkan insert saat konflik; dipakai
  bersama `.returning()` sehingga baris kosong berarti canonical sudah
  direservasi (bukan insert baru). Perilaku ini juga dibuktikan pada PostgreSQL
  nyata oleh test `CODE_CONFLICT`.
- Slice UI/route memakai pola Next.js route handler, zod strict object, dan
  Drizzle yang sudah dikonfirmasi pada ticket 06–08; tidak ada signature library
  baru di luar pola tersebut.

### Acceptance IDs dan evidence

| ID | Bukti |
| --- | --- |
| C01 | Picker publik hanya `activation_kind='public'`; manual tidak pernah muncul. Satu slot: preview/place manual memakai union `none/public/manual`, tanpa slot kedua. |
| C02 | Penggantian manual→publik memakai jalur total-naik ticket 08 (`promo-replacement` + E2E dialog Batal/konfirmasi); kode invalid tidak mengganti pilihan lama. |
| C03 | Canonical trim+uppercase/ASCII3–64/unique global; unknown/nonaktif/arsip/alias = reason aman sama (`discount-code.test.ts`, `discount-selection.db.test.ts`). |
| C05 | Satu Offer manual = satu benefit fixed-goods; semua kode berbagi `discount_offer_usage`/`discount_client_usage` (`discount-reservation.db.test.ts`). |
| C07 | Bucket PG `code:account` 20 / `code:ip` 120 per 60 detik, lintas dua koneksi, Retry-After 50, forged header diabaikan di dev, fail-closed 503 (`checkout-admission.db.test.ts`); deteksi shape invalid via `carriesManualPromoCode`; UI hanya mengirim saat Terapkan. |
| T02 | Redemption manual menyimpan tepat satu `activation_kind='manual_only'` + `code_id`; kode nonaktif setelah preview → `OFFER_UNAVAILABLE` tanpa usage parsial; race quota/per-account nyata pada PostgreSQL. |
| A01/A03/A04 | Detail/list/history/audit memakai `maskedCode`+codeId; literal hanya editor; audit tidak memuat literal; order store hanya mengungkap kode order itu; create/add/state memakai receipt + version guard; canonical/owner immutable (tidak ada update field tersebut). |
| D01/D02 | Schema `discount_code` + composite ownership FKs + CHECK canonical; migrasi generated 0048/0049; seed demo manual (aktif/nonaktif + Redemption consumed) dan urutan cleanup diperbarui. |

### File utama

- Schema/pure: `packages/db/src/discount-code.ts`, `schema/discounts.ts`
  (tabel `discount_code`, activation CHECK, `code_id` Redemption),
  `schema/checkout.ts` (kind bucket), `discount-eligibility.ts` (channel
  manual), migrasi `drizzle/0048_cooing_black_queen.sql` + `0049_dark_vapor.sql`.
- Admin: `discounts-administration.ts` (create manual/proposals, add-code,
  code state, literal-vs-masked, receipt/audit), route codes baru, UI editor +
  list activation selector.
- Store: `discount-selection.ts` (resolve kode/read-only),
  `discount-reservation.ts` (lock kode + Redemption codeId),
  `checkout-review.ts`/`promo-replacement.ts` (identitas manual codeId),
  preview/place-order, order detail, admission, checkout page + PromoSelector
  (input Terapkan, bukan per keystroke).
- Seed/docs/E2E: `seed.ts`, `seed-cleanup.ts`, docs feature/API/testing/seeding,
  `e2e/admin/discounts-admin-mock.spec.ts`,
  `e2e/store/discounts-coupon-mock.spec.ts`.

### Command dan hasil

- `npm run verify:types:store` / `verify:types:admin` — PASS.
- `npm run db:check` — PASS; migrasi 0048/0049 diterapkan ke DB disposable
  `marketplace_discounts_test_20261026`.
- Lint focused file yang berubah (store & admin) — 0 error. `lint:store` global
  masih gagal pada error pre-existing `Header.tsx` (bukan file tiket ini);
  `lint:admin` global 0 error.
- Unit slice: `discount-code.test.ts` 8, eligibility 17, admin pure 23, admin
  DB 16, code-schema DB 8+1 skip, selection DB 11+1 skip, reservation DB 13+1
  skip, admission DB 6 — semua PASS pada DB yang di-seed ulang.
- `npm run verify:batch:unit` — **141 files / 1628 passed / 12 skipped**.
- Mock E2E `discounts-coupon` + `discounts-admin` — **14 passed** (termasuk
  create manual+add/state+masked viewer, Terapkan→invalid→ganti→place→detail,
  dan invalidation manual→Lanjut tanpa promo). Regresi
  `checkout-review-mock` + `pickup-mock` — **20 passed**.
- `npm run db:seed` — PASS; verifikasi SQL: dua kode demo (aktif/nonaktif), satu
  Redemption manual consumed, gate `0`, tanpa fixture test tersisa.

### Gap yang TIDAK diklaim

- Cross manual+percentage dan kompatibilitas benefit 10/11 — ticket 13.
- Promo delivery/shipping manual — ticket 11; usage/privacy aggregate & capacity
  race lintas proses penuh — ticket 12.
- Tidak ada endpoint export kode (tidak ada saluran literal tambahan); klaim
  performa/load-test rate limiter tidak dibuat.
- UAT staging, deployment, aktivasi rollout, live-provider E2E dan commit/push
  tetap gate/izin terpisah.
