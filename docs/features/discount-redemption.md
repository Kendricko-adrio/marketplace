# Coupon publik dan lifecycle Redemption

Checkout **pickup dan delivery** mendukung Coupon publik dan Manual Promo Code
dalam satu slot. Benefit mencakup nominal/persentase barang serta subsidi ongkir
khusus delivery. UI pembayaran menampilkan pilihan promo dan kode sebelum
rincian biaya; backend tetap menjadi authority eligibility dan total.

Dokumen ini menjelaskan satu Coupon publik goods (nominal tetap atau persentase)
tanpa claim: bagaimana customer memilih, bagaimana order menahan kapasitas
secara atomik, dan bagaimana kapasitas dilepas/dikonsumsi saat pembayaran.
Markdown tetap komponen terpisah dan boleh digabung dengan Coupon.

## 1. Model dan batas

- Satu order maksimal **satu Redemption sepanjang hidupnya**, termasuk setelah
  `released`. Slot promo hanya boleh berisi satu Coupon publik atau satu
  Manual Promo Code dengan benefit barang/ongkir; Markdown bukan Redemption.
- Offer `public` tanpa kode dan tanpa prior claim. Kapasitas mengikuti
  `quota_count`, `budget_amount`, dan `per_client_limit` pada Offer yang sama;
  rename, revision, pause, atau ganti email tidak mereset pemakaian.
- Eligibility (spec §5.1): Offer `enabled`, revision published, waktu server
  aktif (start inklusif, end eksklusif), minimum belanja dari **subtotal setelah
  Markdown**, verified email akun store, benefit goods version1 yang menghasilkan
  nominal positif, serta kapasitas global/per-akun. `contactEmail` order bukan
  pengganti verified email. Benefit `percentage_goods` memakai
  `floor(subtotal × rate / 100)` lalu di-clip ke subtotal dan cap (bila ada);
  cap berlaku sekali per order. Konfigurasi rate/cap tidak valid atau benefit
  yang dibulatkan menjadi 0 (mis. subtotal 50 rate 1%) tidak pernah dipakai.
- Customer tanpa verified email tetap dapat checkout **tanpa** Offer sesuai
  akses checkout existing.

## 2. Picker publik

`POST /api/discounts/available` (read-only, onboarded client) menerima
`{ selectedItemIds, fulfillmentMethod?: "pickup" | "delivery", shippingBeforeSubsidy?, cursor? }` dan mengembalikan
Coupon publik yang relevan:

- hanya Offer publik `enabled` dengan revision published dan waktu aktif;
- Offer yang lolos discovery tetapi belum memenuhi minimum/identitas/kapasitas
  tetap tampil `eligible:false` + `reason`/`reasonMessage` aman;
- urut nama lalu Offer ID, pagination cursor, tanpa kode/manual-only;
- item membawa `benefitKind`, `rate`, `capAmount`, dan `benefitAmount` =
  nominal aktual untuk context itu (bukan nominal fixed yang dikonfigurasi).
  Picker menampilkan `Diskon 10% (maks Rp 20.000)` untuk percentage dan
  `Potongan Rp …` untuk fixed.

Picker tersedia pada langkah pembayaran untuk pickup dan delivery saat
`discounts.contractVersion=1`; langkah kontak pickup juga mempertahankan picker
existing. Input **Punya kode promo?** dan tombol **Terapkan** berada sebelum daftar
Coupon agar mudah ditemukan. Offer disabled tidak bisa dipilih. Memilih Coupon
atau menerapkan kode **tidak** membuat order, hold, atau usage. Preview server
memvalidasi pilihan dan memperbarui total; pilihan terikat ke body
preview/place-order sebagai `promoSelection`.

### Susunan review pembayaran

Review memakai satu kolom dengan kelompok terpisah: produk, detail pengiriman/
pengambilan, kontak pemesan, promo, informasi Midtrans, rincian pembayaran, dan
konfirmasi. Sidebar ringkasan hanya ada pada langkah sebelumnya, bukan diduplikasi
pada pembayaran. Cabang asal dan layanan kurir memiliki label terpisah. Nama
penerima, telepon, alamat, dan kode pos ditampilkan per baris; field panjang wrap
dan kolom detail/kontak menjadi vertikal pada mobile.

Rincian biaya menampilkan ongkir **sebelum subsidi**, lalu satu baris subsidi
negatif. Contoh: barang Rp150.000 + PPN Rp16.500 + ongkir Rp30.000 − subsidi
Rp15.000 = total Rp181.500. Ongkir tidak dikurangi subsidi dua kali.

Setiap review promo delivery yang berhasil memperbarui `approvedPricing` dan
origin fingerprint pada intent submit. Mengganti promo mereset checkbox
persetujuan; pembayaran ditahan saat pemeriksaan promo berlangsung. Kode invalid
mempertahankan pilihan dan total valid sebelumnya. Penggantian yang menaikkan
total menunggu dialog konfirmasi; batal mempertahankan promo lama.

## 3. Preview dan review token

Preview pickup menerima `promoSelection`:

```json
{ "kind": "none" }
{ "kind": "public", "offerId": "<offer-id>" }
```

Server mengevaluasi eligibility terhadap subtotal setelah Markdown lalu
menjalankan `evaluatePricing` dengan bentuk benefit ASLI (fixed nominal atau
percentage rate/cap), bukan nominal yang sudah dibulatkan. `pricing.discount`
adalah benefit Coupon (sudah floor/clip/cap), sedangkan `pricing.subtotal` sudah
memperhitungkan Markdown. Nominal hasil eligibility dan hasil pricing wajib sama
persis; selisih sekecil apa pun menggagalkan permintaan, bukan menghasilkan
diskon ambigu. Response menambah `promo` berisi identitas
Offer/revision/benefit dan nominal aktual. Review token menandatangani
fingerprint yang mengikat Offer/revision/benefit/nominal, sehingga token Coupon A
tidak bisa dipakai untuk Coupon B atau benefit yang berubah. Preview tetap tidak
melakukan reservation.

Jika kandidat tidak eligible, preview menjawab error aman tanpa menimpa state
lama: `409 PROMO_UNAVAILABLE`, `409 PROMO_INELIGIBLE`, `409
PROMO_CAPACITY_UNAVAILABLE`, atau `403 EMAIL_VERIFICATION_REQUIRED`.

## 3a. Penggantian dan gugurnya promo (ticket 08)

Pilih/Terapkan adalah **tindakan penggantian**. Bila sudah ada review, browser
mengirim pilihan sebelumnya beserta review token-nya:

```json
{
  "promoSelection": { "kind": "public", "offerId": "<kandidat>" },
  "previous": {
    "reviewToken": "<token review sebelumnya>",
    "promoSelection": { "kind": "public", "offerId": "<pilihan lama>" }
  },
  "acknowledgeInvalidation": false
}
```

- Token `previous` wajib bertanda tangan, belum kedaluwarsa, dan digest pilihan
  promo-nya harus sama dengan `previous.promoSelection`. Bila tidak, preview
  menjawab `409 CHECKOUT_REVIEW_REQUIRED` — klaim "promo lama" tidak bisa
  direkayasa untuk melewati dialog.
- Server mengevaluasi ulang pilihan lama **dan** kandidat pada konteks saat ini,
  lalu membandingkan total FINAL (PPN/ongkir ikut), bukan nominal benefit.
  Pilihan lama yang valid tetapi fingerprint konteksnya (cart, cabang, slot,
  kontak, harga) berbeda berarti approval lama gugur → `409
  CHECKOUT_REVIEW_REQUIRED`, bukan penggantian diam-diam.
- Total naik → response `requiresIncreaseConfirmation: true` + `replacement: {
  previous, candidate, direction, deltaTotal }`; browser menampilkan dialog
  total lama/baru/selisih. Token yang dikembalikan sudah bertanda `inc`, dan
  place-order mewajibkan acknowledgement yang mengikat
  `candidateFingerprint` kandidat tersebut. Batal berarti tidak mengubah apa pun.
- Total sama/turun → penggantian langsung: review/pricing diganti, breakdown
  dihitung ulang, tanpa dialog tambahan dan tanpa reservation baru.
- Kandidat gagal (paused/expired/minimum/kapasitas/identitas) tidak pernah
  menimpa pilihan lama yang masih valid: error `PROMO_*` dikembalikan, review
  token lama tetap dipakai.
- Pilihan lama yang gugur → response memuat `replacement.previous.status =
  "invalid"` + reason aman (pada error, di `data.previous`). UI menampilkan
  invalidation notice dan menonaktifkan pembayaran; breakdown kembali ke harga
  tanpa promo. Customer memilih Offer lain, atau menekan "Lanjut tanpa promo":
  preview diulang dengan `promoSelection: none`, `previous`, dan
  `acknowledgeInvalidation: true`. Token hasilnya bertanda `cwo`, dan place-order
  mewajibkan acknowledgement `continueWithoutPromo` yang mengikat
  `candidateFingerprint`.
- `acknowledgeInvalidation` tanpa `previous` ditolak `400 INPUT_INVALID`: lanjut
  tanpa promo yang belum pernah direview tidak butuh acknowledgement khusus.
- Preview tetap read-only: tidak ada Redemption/hold/slot kedua dari
  perbandingan, dan kapasitas tetap dievaluasi ulang di dalam transaksi
  place-order. Preview ulang tidak menghapus accepted result request yang sudah
  ada (replay `requestKey` dibaca sebelum cart/preview).

Kontrak acknowledgement pada place-order:

```json
{
  "acknowledgements": {
    "promoIncrease": { "candidateFingerprint": "<64-hex>" },
    "continueWithoutPromo": { "candidateFingerprint": "<64-hex>" }
  }
}
```

Hanya persyaratan yang ditandatangani token yang diperiksa, dan fingerprint harus
sama persis dengan fingerprint token. `confirmed: true` bebas, token akun lain,
atau fingerprint kandidat lain ditolak `409 CHECKOUT_REVIEW_REQUIRED` dengan
`data.requiresAcknowledgement` sebelum order/usage/stock/intent dibuat.
Acknowledgement adalah bagian intent: replay key yang sama dengan acknowledgement
berbeda menjawab `409 REQUEST_KEY_CONFLICT`.

Aturan dialog hanya berlaku untuk penggantian promo. Reprice delivery yang sudah
ada tetap meminta reapproval komponen walau total turun. Aturan ini juga berlaku
saat customer memilih promo pada review delivery.

## 4. Place order: reservasi atomik

Place order memakai urutan lock spec §9.2: client → checkout request → Offer
identity → Offer usage → client usage → variant/source → order → stock hold →
intent provider. Evaluasi kapasitas diulang **di dalam transaksi** di bawah lock
Offer, jadi hasil preview tidak pernah menjadi izin reservasi dan dua reservasi
untuk Offer yang sama terserialisasi.

Satu commit menulis:

- order + items (nominal Coupon ada di `discount` dan `goodsDiscountAmount`
  per line) + `pricing_snapshot` versi;
- `discount_redemption` status `reserved` (benefit aktual, deadline = expiry
  order, policy/engine/contract version, terms/result snapshot yang menyimpan
  bentuk benefit: `{kind:"fixed_goods",fixedAmount}` atau
  `{kind:"percentage_goods",rate,capAmount}`);
- `discount_redemption_event` `reserved` (event key unik);
- counter `discount_offer_usage` dan `discount_client_usage` (reserved
  count/amount, version);
- `order_discount_allocation` positif per line untuk `markdown` (bila ada) dan
  `offer_goods`; allocation 0 tidak disimpan;
- stock hold lokal, intent Sales Order, dan accepted checkout result.

Kegagalan mana pun me-rollback seluruhnya: tidak ada order, hold, atau usage
parsial. Replay `requestKey` mengembalikan order yang sama tanpa reservasi,
stock, atau dispatch kedua. Kapasitas yang habis saat commit menjawab
`409 PROMO_CAPACITY_UNAVAILABLE` — bukan diskon diperkecil dan bukan order tanpa
promo diam-diam. Review token yang stale, promo yang gugur, atau acknowledgement
penggantian yang hilang/salah kandidat juga menolak sebelum commit
(`409 CHECKOUT_REVIEW_REQUIRED` / `PROMO_*`) — tidak ada order yang dibuat tanpa
promo sebagai fallback otomatis.

Provider (Sales Order) menerima `price` **source** per line, `disc_amount` =
Markdown whole-line + alokasi Coupon whole-line (tidak dikalikan quantity dua
kali), dan `amount` = gross line − diskon. Payable provider = net barang
(kupon), bukan subtotal sebelum Coupon.

## 5. Lifecycle

| Kejadian | Redemption | Counter | Catatan |
|---|---|---|---|
| Place order | `reserved` | reserved +1/+benefit | Satu commit dengan order/stock/intent |
| Deny/cancel attempt, retry, deadline lewat, provider ambigu | tetap `reserved` | tidak berubah | Expiry hanya memicu pemeriksaan authoritative, tidak memperpanjang deadline |
| Paid authoritative | `consumed` + event | reserved −1, consumed +1 | Atomik dengan perubahan order; fulfillment tetap boleh blocked karena settlement Jubelio |
| Unpaid terminal + cancel confirmed / definitive never-applied create | `released` + event | reserved −1 | Release sekali; hanya jalur aman yang sudah terbukti |
| Late paid setelah release | tetap `released` | tidak berubah | Event `late_paid_review` sekali, order paid + blocked, tanpa reacquire kapasitas/SO baru |
| Late paid saat hold belum dilepas | `consumed` | reserved −1, consumed +1 | Cancel path aktif → paid tetap dicatat, fulfillment blocked |
| Refund manual eksternal | tidak ada perubahan | tidak berubah | Tidak ada sync/ledger/restore usage |

`event_key` unik dan conditional transition membuat webhook/sweep duplikat atau
out-of-order menjadi no-op; counter tidak pernah negatif. Bila projection
menyimpang dari Redemption, transaksi gagal tertutup (bukan reset online).

## 6. UI dan status jujur

### Modal pemilihan promo checkout

Checkout pickup/delivery menampilkan ringkasan promo dan tombol **Pilih promo** /
**Ubah promo**, bukan seluruh daftar inline. Modal memakai shared Dialog,
Input, Button, Badge, serta pattern footer/pagination checkout existing.

- Maksimal **10 promo publik per halaman**, tanpa batas jumlah halaman 10.
  Hanya daftar yang scroll; input kode, pagination, pilihan draft, dan action
  tetap berada di luar region daftar.
- Radio mengubah **draft** saja. **Gunakan promo** meminta preview terbaru dan
  baru menerapkan pilihan setelah response server sukses. Batal/X/Escape/overlay
  membuang draft; response terlambat setelah modal ditutup diabaikan.
- **Kode promo → Periksa** memvalidasi tanpa menerapkan. Kandidat kode menampilkan
  kode milik customer, potongan aktual, serta status valid untuk pesanan ini.
  Mengedit kode membatalkan kandidat kode yang diperiksa; kode salah tidak
  mengganti promo aktif. Memilih publik/manual tetap satu slot.
- Sorting dilakukan **global di server sebelum pagination**: eligible, estimasi
  total bayar terendah termasuk PPN, benefit aktual terbesar, expiry terdekat,
  nama, ID. Ineligible berada di belakang dengan reason aman. Badge
  **Paling hemat** bukan auto-apply, dan tidak diulang pada setiap halaman.
- Contoh subtotal Rp100.000, PPN 11%, ongkir Rp16.000: diskon barang Rp10.000
  memberi total Rp115.900 (hemat Rp11.100), lebih hemat daripada subsidi ongkir
  Rp11.000 dengan total Rp116.000. Cap adalah batas, bukan penghematan aktual.
- Draft bertahan saat berpindah halaman. Ringkasan promo aktif berasal dari
  review/projection pilihan terpisah, bukan keberadaan kartu di halaman saat ini.
- Kenaikan total memakai tahap **Total pesanan naik** pada modal yang sama;
  **Batal** kembali ke draft, **Ya, ganti promo** menerapkan kandidat terikat
  fingerprint. Pelepasan promo tetap melalui konfirmasi existing bila total naik.
- Perubahan konteks membatalkan kandidat sementara. Review-required kembali ke
  input dan memvalidasi ulang promo aktif pada review berikutnya; kandidat gagal
  tidak otomatis diterapkan. Tidak ada fallback order tanpa promo diam-diam.
- Error daftar menawarkan **Coba lagi**; daftar kosong tetap menerima kode.
  Validasi harga, kuota, kode, serta ongkir authoritative tetap preview/place-order.
  Discovery tidak menulis hold/Redemption atau memanggil provider per promo.

Modul baru: `apps/store/src/features/discounts/available-promos-service.ts`,
`promo-ranking.ts`, `promo-picker-contract.ts`, serta komponen
`apps/store/src/components/checkout/PromoSelectionDialog.tsx`.
Kontrak numbered dan kompatibilitas cursor: [API reference](../api-reference.md).

### Status applied dan lifecycle existing

- Checkout pickup: picker Coupon, breakdown `subtotal` (setelah Markdown),
  `Diskon promo`, PPN, dan total; nama promo yang dipakai ditampilkan di review.
- Picker tampil juga pada langkah review sehingga penggantian terjadi tanpa
  kehilangan review. Pilihan yang gugur tidak dihapus diam-diam: card menampilkan
  alasan aman + tombol "Lanjut tanpa promo", dan total berdiskon tidak lagi
  ditampilkan sampai customer memilih ulang/eksplisit lanjut. Kegagalan jaringan
  tidak menampilkan applied state palsu (state hanya berubah dari response
  server yang sukses).
- `GET /api/orders/{id}` menambah `promo: { name, benefitAmount, status,
  consumedAt, releasedAt } | null` milik customer itu sendiri. Halaman detail
  menampilkan status promo (`reserved`/`consumed`/`released`) dan notice
  "Pembayaran diterima, pesanan menunggu verifikasi" untuk order `paid` yang
  fulfillment-nya blocked — tanpa menyiratkan siap diambil.
- Admin order detail menerima `promo` read-only (nama Offer, benefit, status)
  untuk review operasional; tidak ada identitas customer lain atau kode.

## 7. Endpoint dan modul

| Seam | Perilaku |
|---|---|
| `POST /api/discounts/available` | Daftar Coupon publik + reason disabled (read-only) |
| `POST /api/checkout/preview` | `promoSelection` `none`/`public`; `previous` + `acknowledgeInvalidation` untuk penggantian/invalidation; pricing + token terikat |
| `POST /api/checkout/place-order` | Reservasi atomik + order/stock/intent; `acknowledgements` terikat candidate fingerprint; error promo terpetakan |
| `GET /api/orders/{id}` | `promo` status milik order customer |
| `GET /api/admin/orders/{id}` | `promo` read-only untuk ops |

Modul: `packages/db/src/discount-eligibility.ts` (pure eligibility),
`packages/db/src/discount-pricing.ts` (pure money/allocation),
`apps/store/src/lib/discount-availability.ts` (discovery read-only),
`discount-selection.ts` (evaluasi kandidat), `discount-reservation.ts`
(lock + re-evaluasi + insert/counter/allocation), `discount-lifecycle.ts`
(consume/release/late review), `promo-replacement.ts` (perbandingan total final +
persetujuan terikat fingerprint), serta integrasi `order-finalize.ts`,
`jubelio-sales-lifecycle.ts`, dan `checkout-recovery.ts`.

## 8. Verifikasi

- `packages/db/src/discount-eligibility.test.ts`, `discount-pricing.test.ts` —
  literal eligibility, clip, allocation, Markdown + Coupon.
- `packages/db/src/discount-redemption-schema.db.test.ts` — constraint SQL
  (one Redemption/order, ownership, event transition, allocation shape).
- `apps/store/src/lib/discount-availability.db.test.ts`,
  `discount-selection.db.test.ts` — discovery/eligibility read-only, tanpa
  reservasi.
- `apps/store/src/lib/discount-reservation.db.test.ts` — race kuota/budget/jatah,
  serial terhadap pause, consume/release sekali, late review, rollback penuh.
- `apps/store/src/lib/discount-lifecycle-flow.db.test.ts` — paid/cancel/reject/
  late settlement lewat public lifecycle interface.
- `apps/store/src/lib/checkout-review.test.ts` — binding fingerprint promo.
- `e2e/store/discounts-coupon-mock.spec.ts` — picker → total → place →
  provider line discount → order detail → paid-but-blocked (mock-only).

## 8a. Ops read, privacy, dan pause (ticket 12)

- Agregat kapasitas adalah **global** (satu projection per Offer); daftar
  Redemption adalah view operasional yang mengikuti grant `orders:view` dan
  scope cabang. Total daftar tidak pernah diklaim sama dengan total global.
- Viewer promo tanpa `orders:view` hanya menerima `consumed/held/available`
  global tanpa identitas order/customer/cabang. Viewer own-branch tidak dapat
  membuka entri cabang lain lewat direct id (404), filter `branchId` (403), page,
  atau count. Kode hanya tampil sebagai `maskedCode` + `codeId`.
- Entri membawa status order/payment, cabang, penanda `fulfillmentBlocked`, dan
  `latePaidReview` supaya paid-but-provider-blocked/ambiguity dan late paid
  dapat ditelusuri lewat detail order existing. Tidak ada reset usage, force
  release, retry provider write, atau refund baru.
- Pause hanya menolak reservasi **baru**; hold yang sudah ada tetap snapshot dan
  tetap dapat consume/release ke outcome authoritative. Tidak ada mass
  cancel/reprice/force release; refund manual eksternal tidak sync/restore usage.
- Drift projection vs ledger ditahan untuk review pada publish/perubahan
  kapasitas (`USAGE_DRIFT_REVIEW`), tanpa reset/rebuild online. Retensi
  memakai FK RESTRICT pada order/client/Redemption/allocation/provider/shipment;
  hard delete transaksi ditolak dan arsip tidak membuka reuse literal.
- Bukti: `apps/admin/src/lib/discount-operations-read.db.test.ts`,
  `e2e/admin/discounts-usage-mock.spec.ts`, dan test pause/hold di
  `discount-reservation.db.test.ts`.

## 9. Non-goals

Usage/privacy detail dan capacity races lanjutan (12), refund tooling, pembuktian pembayaran
Rp0, UAT staging/rollout (13). Benefit percentage/manual yang digabung dalam
satu order diuji lintas slice pada ticket 13. Gate operasional `discounts.contractVersion`
tetap `0` pada seed sampai rollout berizin.

## 3b. Manual Promo Code dalam slot yang sama (ticket 09)

Manual Promo Code bukan engine kedua: kode hanya **mengaktivasi** Offer
`manual_only` yang memakai revision/benefit fixed-goods, quota/budget,
per-account history, reservation, dan lifecycle yang sama dengan Coupon publik.

- **Kanonik.** Literal di-trim lalu di-uppercase; ASCII 3–64 karakter, karakter
  pertama alfanumerik, sisanya alfanumerik/underscore/hyphen
  (`packages/db/src/discount-code.ts`). Internal space dan alias Unicode ditolak
  sebelum uppercase, sehingga `hemat17agustus` dan ` hemat17agustus ` menuju
  canonical yang sama sementara `HEMAT 17`/`hémät17` tidak pernah sah. Uniqueness
  canonical berlaku global (`discount_code_canonical_unique`).
- **Aktivasi tetap.** `public` tidak punya kode; `manual_only` wajib memakai satu
  kode milik Offer itu (`discount_redemption_activation_kind` + composite FK).
  Perpindahan channel membutuhkan Offer baru, bukan revisi.
- **Slot tunggal.** `promoSelection` menerima `none`/`public`/`manual` (literal
  hanya di request; token/`previous` memakai `codeId`). Kode invalid, nonaktif,
  arsip, atau kehabisan kapasitas mengembalikan reason aman yang sama dan TIDAK
  mengganti pilihan lama yang masih sah; jalur total-naik/`continue without
  promo` dari ticket 08 tetap berlaku. Place-order mengevaluasi ulang di bawah
  lock Offer dan lock baris kode sebelum menulis satu Redemption + allocation.
- **Berbagi kapasitas.** Semua kode satu Offer memakai baris
  `discount_offer_usage`/`discount_client_usage` yang sama; tidak ada subquota,
  expiry, atau binding per kode. Rename/revisi/kode baru/perubahan email tidak
  mereset usage.
- **Rate limit.** Request yang membawa manual code (termasuk shape invalid yang
  lolos authenticated admission) memakai bucket PostgreSQL `code:account` 20 dan
  `code:ip` 120 per 60 detik, ditambahkan pada admission preview/place yang sama.
  Header IP hanya dipercaya di belakang proxy yang meng-overwrite; dev memakai
  loopback. `429 RATE_LIMITED` membawa `Retry-After`; limiter/policy tidak
  tersedia → `503 POLICY_UNAVAILABLE` (fail closed, tanpa fallback header).
- **Privasi.** Literal hanya untuk promo editor (`discounts:view+edit`) pada
  detail admin; list/export/history/audit/API viewer memakai label masked + code
  ID. Store order detail hanya mengungkap kode yang dipakai order customer itu.
  Log tidak pernah memuat kode atau body.

Endpoint: `POST /api/admin/discounts/{id}/codes` dan
`PATCH /api/admin/discounts/{id}/codes/{codeId}` (lihat
[`docs/api-reference.md`](../api-reference.md)). Verifikasi:
`packages/db/src/discount-code.test.ts`, `discount-code-schema.db.test.ts`,
`apps/admin/src/lib/discounts-administration.db.test.ts`,
`apps/store/src/lib/discount-selection.db.test.ts`,
`discount-reservation.db.test.ts`, `checkout-admission.db.test.ts`, serta
`e2e/admin/discounts-admin-mock.spec.ts` (blok Manual Promo Code) dan
`e2e/store/discounts-coupon-mock.spec.ts` (kasus Manual Promo Code).

## Verifikasi review pembayaran dan promo delivery

Regression browser ada di `e2e/store/checkout-review-mock.spec.ts`, kasus
`delivery payment review exposes working promo and readable sections` pada
1280px dan 390px. Test memakai checkout dan preview HTTP nyata, provider mock
lokal, serta intercept submit untuk memeriksa approval tanpa membuat order
provider tambahan. Kasus HTTP shipping existing tetap menguji place-order nyata.

Cakupan: kode valid/invalid, satu slot publik/manual, diskon barang/subsidi,
dialog kenaikan total (batal/setuju), reset checkbox, keyboard Tab/Enter, harga
pada submit, section berlabel, sidebar tidak diduplikasi, dan tanpa overflow.
Referensi konsistensi visual: langkah Informasi Kontak checkout serta shared
Card/Input/Button/Badge existing; render kedua viewport telah diperiksa.

Context7 checkpoint: `/microsoft/playwright` — locator role/label, web-first
assertions, `setViewportSize`, dan `boundingBox` dikonfirmasi dari dokumentasi.
Perubahan JSX/layout memakai API komponen existing; panduan Next.js terpasang
`node_modules/next/dist/docs/01-app/03-api-reference/01-directives/use-client.md`
juga diperiksa. Tidak ada schema, endpoint, environment, atau deployment baru.

Bukti verifikasi lokal: typecheck store lolos; focused unit 21 passed; full unit
155 file / 1.740 passed / 12 skipped pada DB disposable. Batch E2E awal mencatat
46 passed, tiga kegagalan selector heading lama dan sepuluh test belum berjalan.
Setelah selector diperjelas, recheck hanya kasus gagal/belum berjalan ditambah
dua lifecycle pickup menghasilkan 15 passed (total 61 test unik passed). Legacy
`npm run test:e2e` tidak dijalankan karena memerlukan izin terpisah.

## Subsidi ongkir dalam siklus Redemption (ticket 11)

Satu Redemption shipping memakai lock group dan counter yang sama
(`discount_offer_usage`, `discount_client_usage`, budget, quota, per-account).
Nominal `benefit_amount` adalah subsidi AKTUAL (`min(ongkir, cap)`), bukan cap.
Karena ongkir bukan barang, Redemption ini tidak menulis `offer_goods` dan tidak
mengubah `goods_discount_amount`/`net_line_amount`; allocation-nya tepat satu
baris `offer_shipping` dengan `order_item_id` NULL, `redemption_id`, `benefit_id`,
dan amount subsidi. Unique index `(redemption_id)` pada komponen shipping
mencegah alokasi kedua, sedangkan unique one-redemption-per-order tetap berlaku.

Eligibility shipping hanya untuk delivery dengan ongkir valid positif;
pickup/ongkir0 menghasilkan reason aman `FULFILLMENT_NOT_ELIGIBLE`. Budget
memakai nominal aktual (sisa budget yang lebih kecil menolak seluruh pemakaian,
bukan memotong subsidi). Verifikasi: `packages/db/src/discount-pricing.test.ts`,
`discount-eligibility.test.ts`,
`apps/store/src/lib/discount-shipping.db.test.ts` (PostgreSQL: allocation tanpa
item, usage, per-account, budget aktual), dan
`apps/store/src/lib/jubelio-sales-shipping.test.ts` (intent provider).

## 9. Reservation sebelum order

Redemption dapat ditahan untuk `checkout_attempt` (`checkout_attempt_id`) saat
order belum ada; `order_id` diisi saat promotion tanpa reserve ulang. Counter
global/per-client dipakai bersama, `consumed` tetap mensyaratkan order. Pelepasan
hanya terjadi setelah kegagalan definitif (SO ditolak sebelum diterapkan atau
cancel SO terkonfirmasi) atau reservation kedaluwarsa yang belum pernah dikirim,
dan baris `released` tetap disimpan sebagai bukti.
