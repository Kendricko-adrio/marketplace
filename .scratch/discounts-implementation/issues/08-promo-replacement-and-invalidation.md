# 08 — Penggantian dan gugurnya promo

Label: ready-for-agent
Type: task
Status: resolved
Assignee: main-agent
Blocked by: 07
Parent: [Map implementasi diskon](../map.md)
Spec: [Complete spec](../../../plan/discounts-spec.md)
Acceptance IDs: C02, C04, T04, T06

## Perilaku yang dibangun

Customer mengganti Coupon publik yang dipilih dengan persetujuan harga yang benar. Jika total naik, ia harus mengonfirmasi; jika sama/turun, pilihan langsung berganti. Jika promo lama gugur, ia memilih ulang atau secara eksplisit melanjutkan tanpa promo. Tidak ada silent stacking/auto-apply atau kenaikan tagihan diam-diam.

Bangun pada fixed-public07; interface pilihan/acknowledgement harus dapat dipakai manual09, percentage10 dan shipping11 tanpa state machine kedua.

## Acceptance criteria

- [x] Dua Coupon valid: mengganti benefit20000→10000 pada context sama membuat total final naik dan membuka dialog old/new/delta; batal mempertahankan pilihan/total lama. Yang dibandingkan final termasuk PPN/ongkir, bukan nominal benefit saja.
- [x] Penggantian total sama/turun langsung mengganti melalui Pilih/Terapkan dan memperbarui breakdown tanpa dialog kenaikan tambahan. Tidak menciptakan reservation dari preview atau slot kedua.
- [x] Context/review tokens dan candidate fingerprints mengikat previous/candidate/current state. Required increase acknowledgement/continue-without acknowledgment terikat candidate, bukan boolean confirmed bebas atau token akun lain.
- [x] Minimum gugur sesudah cart berubah atau current Offer pause/expired/capacity tidak tersedia → alasan jelas; customer memilih Offer lain atau Lanjut tanpa promo eksplisit dengan total baru. Invalid benefit tidak dipertahankan.
- [x] Percobaan candidate publik unavailable tidak mengganti old selection yang masih valid. Jika old juga invalid, tampilkan invalidation state, bukan mempertahankan diskon palsu. Kasus invalid manual code ditambahkan09.
- [x] Place order menolak stale/invalid/unacknowledged review sebelum order/usage/stock commit. Jika quota habis saat commit, tetap409 tanpa partial order atau otomatis no-promo order; preview ulang tidak menghapus result accepted request yang sudah ada.
- [x] Perubahan fulfillment/context membatalkan relevant approval; shipping→pickup spesifik ditambahkan11. Reprice delivery existing tetap meminta reapproval komponen walau total turun; aturan swap dialog hanya ketika final naik.
- [x] UI keyboard/focus/loading/error sesuai existing theme; network failure tidak menampilkan applied state palsu. Code/PII/tokens tidak masuk logs, docs/HTTP contracts diperbarui.

## Verifikasi

L independent old/new total examples dengan PPN; H/B real preview→candidate→confirm/cancel→place dan changed cart/clock/Offer fixtures. T regression accepted request/replay+reservation07 memastikan no new hold di preview/cancel dan no ghost order pada failed review. UI response bukan stubbed checkout authority.

## Batas dan penyelesaian

Baca [kontrak bersama](../map.md#kontrak-bersama-untuk-semua-ticket). Tidak menambah prior claim, best-promo auto-choice, extra slot atau persistent customer coupon wallet. Tidak ada izin implementasi/provider writes/subagents/commit/deploy dari ticket. Main agent melakukan validasi dan mencatat Answer sebelum resolved.

## Answer

**Status: resolved (main agent, sesi 21–22 Oktober 2026).** Implementasi seluruh
acceptance ticket 08 untuk **pickup Coupon publik**. Tidak ada commit, push,
provider request nyata, remote/Docker, deployment, atau UAT. Gate operasional
`discounts.contractVersion` kembali `0` setelah semua run (diverifikasi lewat
query DB), dan fixture E2E (`discount_offer`/`orders`/`discount_redemption`
berprefix `e2e-discounts-coupon`) terhapus bersih.

### Yang dibangun

- **Preview penggantian** (`apps/store/src/app/api/checkout/preview/route.ts`):
  body pickup kini menerima `previous: { reviewToken, promoSelection }` dan
  `acknowledgeInvalidation?: boolean` (strict). Server memverifikasi token
  `previous` (tanda tangan + expiry), mencocokkan digest pilihan promo dengan
  payload token, mengevaluasi ulang pilihan lama **dan** kandidat pada konteks
  saat ini, lalu membandingkan **total final** (PPN/ongkir ikut). Response
  menambah `requiresIncreaseConfirmation`,
  `requiresContinueWithoutPromoAcknowledgement`, dan `replacement`
  (`previous.status` valid/invalid, `candidate`, `direction`, `deltaTotal`).
  Konteks yang berubah sejak review lama → 409 `CHECKOUT_REVIEW_REQUIRED`;
  kandidat gagal tidak mengganti pilihan lama; kedua promo gugur → error dengan
  `data.previous` (invalidation state). Semua jalur tetap read-only (tanpa
  Redemption/hold/slot kedua).
- **Review token** (`apps/store/src/lib/checkout-review.ts`): payload bertanda
  tangan menambah `p` (SHA-256 digest jenis+Offer ID pilihan) serta flag `inc`
  (kenaikan total) / `cwo` (lanjut tanpa promo setelah gugur). Verifikasi
  mengembalikan `{ fingerprint, promoDigest,
  requiresPromoIncreaseAcknowledgement,
  requiresContinueWithoutPromoAcknowledgement }`; flag hanya sah dari payload
  bertanda tangan; dua flag sekaligus tidak pernah ditandatangani.
- **Pure seam baru** (`apps/store/src/lib/promo-replacement.ts`):
  `comparePromoReplacement` (total final, delta signed, arah increase/same/
  decrease) dan `evaluatePromoAcknowledgements` (hanya persyaratan dari token
  yang diperiksa; ack harus menunjuk candidate fingerprint yang sama). Modul ini
  netral terhadap jenis pilihan (`none`/`public`) sehingga manual09, percentage10,
  dan shipping11 dapat memakai kontrak yang sama tanpa state machine kedua.
- **Place order** (`apps/store/src/app/api/checkout/place-order/route.ts`):
  body menerima `acknowledgements` strict; persyaratan berasal dari token,
  dicek **sebelum** order/Redemption/usage/stock/intent. Kegagalan → 409
  `CHECKOUT_REVIEW_REQUIRED` + `data.requiresAcknowledgement`, tanpa order/stock
  hold parsial dan tanpa order tanpa promo otomatis. Ack adalah bagian intent
  canonical (request key sama + ack berbeda → 409 `REQUEST_KEY_CONFLICT`).
- **UI** (`apps/store/src/app/checkout/page.tsx`,
  `apps/store/src/components/checkout/PromoSelector.tsx`): picker juga tampil di
  langkah review; Pilih/Terapkan memanggil preview penggantian; dialog
  `Total pesanan naik` (Radix `Dialog`: focus trap/Escape, tombol Batal/Ya,
  loading `pendingOfferId`) hanya saat final naik; Batal mempertahankan review
  lama. Pilihan yang gugur tidak dihapus: notice alasan + tombol "Lanjut tanpa
  promo"; total berdiskon tidak lagi ditampilkan (fallback harga dasar) dan
  pembayaran dinonaktifkan sampai customer memilih ulang/eksplisit lanjut.
  Kegagalan jaringan tidak mengubah state review/pilihan.
- **Docs**: `docs/features/discount-redemption.md` (§3a baru, UI, modul),
  `docs/api-reference.md` (preview `previous`/`acknowledgeInvalidation` +
  response, place-order `acknowledgements`), `docs/testing/README.md` (bukti
  ticket 08). Tidak ada perubahan schema/seed, jadi tidak ada migrasi baru dan
  `db:check` tidak dijalankan.

### Acceptance dan evidence

Context7 checkpoint: tidak diperlukan — slice ini tidak menambah API library
baru; semua pemakaian (Next route handler, zod `strictObject`/`discriminatedUnion`,
shadcn/Radix `Dialog` wrapper yang sudah dipakai `app/cart/page.tsx`, `BigInt`)
sudah dipakai di repo. DB disposable `marketplace_discounts_test_20261026`
(`DATABASE_URL` di `.env`).

| Acceptance | Bukti |
| --- | --- |
| Dua Coupon valid: naik → dialog old/new/delta; batal mempertahankan | L: `promo-replacement.test.ts` (138750→155400, +16650, sama/turun); B: `discounts-coupon-mock.spec.ts` test 1 (dialog 138750/155400/+16650, Batal, konfirmasi) |
| Sama/turun langsung, tanpa reservation/slot kedua | L: arah `decrease`/`same`; B: test 2 (155400→138750 tanpa dialog); test 1 memeriksa `pending_remote_stock=0`, `available_stock=5`, 0 Redemption sebelum place-order |
| Token/fingerprint mengikat previous/candidate/current; ack terikat candidate | L: `checkout-review.test.ts` (digest `p`, flag `inc`/`cwo`, tamper payload ditolak, dua flag ditolak), `promo-replacement.test.ts` (ack salah kandidat/boolean bebas ditolak); B: ack `promoIncrease.candidateFingerprint` = `token.fp`, replay/`REQUEST_KEY_CONFLICT` |
| Minimum/pause/kapasitas gugur → alasan jelas + pilih ulang/Lanjut tanpa promo | B: test 3 (Offer dipause: notice + total 166500, preview lanjut 409 `PROMO_UNAVAILABLE`, "Lanjut tanpa promo" → token `cwo` + order tanpa diskon), test 5 (cart 1→2 → 409 `CHECKOUT_REVIEW_REQUIRED`, review baru 321900) |
| Candidate unavailable tidak mengganti old valid; old invalid → invalidation state | B: test 4 (kandidat paused → 409, pilihan/total lama tetap, tanpa dialog); test 3 (old invalid → fallback total + tombol bayar hilang) |
| Place order menolak stale/invalid/unacknowledged sebelum commit; kuota habis 409 tanpa parsial; replay tidak menghapus result | B: test 4 (kuota global dihabiskan → 409 `PROMO_CAPACITY_UNAVAILABLE`, jumlah order sama, 0 Redemption, stock 5); test 1 (replay 200 order sama; ack berbeda 409; replay setelah Offer dipause tetap total tersimpan) |
| Perubahan fulfillment/context membatalkan approval; reprice delivery tetap reapproval; dialog hanya saat naik | B: test 5 (context berubah → 409 + step kontak); regresi `delivery-order-mock` (36 passed pada batch 5 spec) membuktikan reprice walau total turun tetap minta reapproval komponen |
| UI/theme/log/docs | Radix Dialog focus/Escape + loader + alert aman; log hanya id/reason/arah/fingerprint (tanpa token/kode/PII); docs diperbarui |

Command + hasil (semua dijalankan main agent, final state):

- `npm run verify:types:store` PASS; `npm run verify:types:admin` PASS.
- Focused ESLint pada 8 file tersentuh PASS. Catatan: `npm run lint:store`
  global masih gagal pada error **pre-existing** `Header.tsx`
  (`react-hooks/set-state-in-effect`, file tidak diubah ticket ini).
- `npm run verify:unit:slice -- apps/store/src/lib/checkout-review.test.ts apps/store/src/lib/promo-replacement.test.ts`
  → **17 passed**.
- `npm run verify:batch:unit` → **138 files passed / 3 skipped, 1584 tests
  passed / 14 skipped** (`/tmp/t08-unit-final.log`).
- `npx playwright test --config=playwright.mock.config.ts e2e/store/discounts-coupon-mock.spec.ts`
  → **8 passed** (3 ticket 07 + 5 ticket 08).
- Regresi mock `pickup-mock`, `versioned-checkout-mock`, `checkout-review-mock`,
  `delivery-order-mock`, `markdown-mock` → **36 passed**
  (`/tmp/t08-e2e-regression.log`).
- Gate `discounts.contractVersion=0`, 0 fixture offer/order/Redemption berprefix
  E2E setelah run.

### Gap yang tidak diklaim

- Promo **delivery** (termasuk penggantiannya), Manual Promo Code, percentage,
  dan shipping subsidy tetap ticket 11/09/10; kontrak `previous` +
  `acknowledgements` disiapkan agar mereka tidak membangun state machine kedua.
- Acknowledgement `continue_without_promo` hanya ditandatangani bila token promo
  yang pernah direview ada; bila customer belum pernah review, aksi eksplisit
  "Lanjut tanpa promo" + review baru dengan total penuh adalah jalur yang dipakai
  (tanpa flag token, karena tidak ada approval promo yang hilang).
- "Kuota habis saat commit" disimulasikan lewat fixture SQL (pemakai lain
  menghabiskan kuota) dan Offer pause; bukan race dua akun HTTP nyata (dimiliki
  ticket 12/13).
- Legacy `npm run test:e2e`, live-provider proof, UAT staging, deployment dan
  rollout tidak dijalankan (butuh izin/environment terpisah). Tidak ada test
  yang di-skip sebagai pengganti bukti.
