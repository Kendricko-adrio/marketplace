# Coupon publik dan lifecycle Redemption

Status: ticket 07 terimplementasi untuk **pickup**. Pemilihan promo di checkout
delivery, Manual Promo Code, percentage, dan subsidi ongkir tetap milik ticket
11/09/10.

Dokumen ini menjelaskan satu Coupon publik fixed-goods tanpa claim: bagaimana
customer memilih, bagaimana order menahan kapasitas secara atomik, dan bagaimana
kapasitas dilepas/dikonsumsi saat pembayaran. Markdown tetap komponen terpisah
dan boleh digabung dengan Coupon.

## 1. Model dan batas

- Satu order maksimal **satu Redemption sepanjang hidupnya**, termasuk setelah
  `released`. Slot promo hanya boleh berisi satu Coupon publik atau (nanti) satu
  Manual Promo Code/shipping subsidy; Markdown bukan Redemption.
- Offer `public` tanpa kode dan tanpa prior claim. Kapasitas mengikuti
  `quota_count`, `budget_amount`, dan `per_client_limit` pada Offer yang sama;
  rename, revision, pause, atau ganti email tidak mereset pemakaian.
- Eligibility (spec §5.1): Offer `enabled`, revision published, waktu server
  aktif (start inklusif, end eksklusif), minimum belanja dari **subtotal setelah
  Markdown**, verified email akun store, benefit fixed positif, serta kapasitas
  global/per-akun. `contactEmail` order bukan pengganti verified email.
- Customer tanpa verified email tetap dapat checkout **tanpa** Offer sesuai
  akses checkout existing.

## 2. Picker publik

`POST /api/discounts/available` (read-only, onboarded client) menerima
`{ selectedItemIds, fulfillmentMethod?: "pickup", cursor? }` dan mengembalikan
Coupon publik yang relevan:

- hanya Offer publik `enabled` dengan revision published dan waktu aktif;
- Offer yang lolos discovery tetapi belum memenuhi minimum/identitas/kapasitas
  tetap tampil `eligible:false` + `reason`/`reasonMessage` aman;
- urut nama lalu Offer ID, pagination cursor, tanpa kode/manual-only.

Picker di halaman checkout (step kontak, pickup, gate `discounts.contractVersion=1`)
menampilkan daftar itu; Offer disabled tidak bisa dipilih. Memilih Coupon hanya
mengubah state browser: **tidak** membuat order, hold, atau usage. Pilihan
terikat ke body preview/place-order sebagai `promoSelection`.

## 3. Preview dan review token

Preview pickup menerima `promoSelection`:

```json
{ "kind": "none" }
{ "kind": "public", "offerId": "<offer-id>" }
```

Server mengevaluasi eligibility terhadap subtotal setelah Markdown lalu
menjalankan `evaluatePricing` fixed goods. `pricing.discount` adalah benefit
Coupon (sudah di-clip), sedangkan `pricing.subtotal` sudah memperhitungkan
Markdown. Response menambah `promo` berisi identitas Offer/revision/benefit dan
nominal aktual. Review token menandatangani fingerprint yang mengikat
Offer/revision/benefit/nominal, sehingga token Coupon A tidak bisa dipakai untuk
Coupon B atau benefit yang berubah. Preview tetap tidak melakukan reservation.

Jika kandidat tidak eligible, preview menjawab error aman tanpa menimpa state
lama: `409 PROMO_UNAVAILABLE`, `409 PROMO_INELIGIBLE`, `409
PROMO_CAPACITY_UNAVAILABLE`, atau `403 EMAIL_VERIFICATION_REQUIRED`.

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
  order, policy/engine/contract version, terms/result snapshot);
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
promo diam-diam.

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

- Checkout pickup: picker Coupon, breakdown `subtotal` (setelah Markdown),
  `Diskon promo`, PPN, dan total; nama promo yang dipakai ditampilkan di review.
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
| `POST /api/checkout/preview` | `promoSelection` `none`/`public`; pricing + token terikat |
| `POST /api/checkout/place-order` | Reservasi atomik + order/stock/intent; error promo terpetakan |
| `GET /api/orders/{id}` | `promo` status milik order customer |
| `GET /api/admin/orders/{id}` | `promo` read-only untuk ops |

Modul: `packages/db/src/discount-eligibility.ts` (pure eligibility),
`packages/db/src/discount-pricing.ts` (pure money/allocation),
`apps/store/src/lib/discount-availability.ts` (discovery read-only),
`discount-selection.ts` (evaluasi kandidat), `discount-reservation.ts`
(lock + re-evaluasi + insert/counter/allocation), `discount-lifecycle.ts`
(consume/release/late review), serta integrasi `order-finalize.ts`,
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

## 9. Non-goals

Penggantian promo dan konfirmasi kenaikan total (ticket 08), Manual Promo Code
(09), percentage (10), pemilihan promo shipping/delivery (11), usage/privacy
detail dan capacity races lanjutan (12), refund tooling, pembuktian pembayaran
Rp0, UAT staging/rollout (13). Gate operasional `discounts.contractVersion`
tetap `0` pada seed sampai rollout berizin.
