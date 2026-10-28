# Harga checkout berversi (pricing1 / engine1 / provider2)

Dokumen ini menjelaskan **kontrak uang checkout tanpa promo** yang disimpan
sebagai snapshot berversi pada order. Fokusnya: rincian uang authoritative
(barang, PPN, ongkir, total customer, payable provider), decoder yang fail
closed, dan batas input.

Cakupan yang **tidak** ada di sini: Offer/Coupon, Markdown, Manual Promo Code,
dan hasil UAT/release. Review checkout (token/fingerprint), request key/replay,
result lookup, dan admission rate-limit dibahas pada §12. Semua itu ticket
berikutnya pada
[peta implementasi diskon](../../.scratch/discounts/ticket/map.md) dan
[spec lengkap §4/§8.3/§10/§13](../../.scratch/discounts/plan/discounts-spec.md). Dokumen ini tidak
menyatakan satu pun acceptance ticket sudah lulus.

## 1. Gate versi kontrak

Gate adalah satu baris konfigurasi domain di `system_config` (key
`discounts.contractVersion`), **bukan** env var:

- Pembaca gate: `getDiscountsContractVersion()`
  (`apps/store/src/lib/config.ts`) — membaca `system_config` **tanpa cache**,
  sehingga perubahan nilai berlaku pada request berikutnya (tanpa restart).
- Baris hilang atau nilai `"0"` → **legacy 0**. Nilai `"1"` → kontrak baru.
  Nilai lain (termasuk kosong/`"2"`) **atau** kegagalan baca DB → **throw**,
  tidak pernah diam-diam dianggap legacy.
- Seeder menulis baris ini **eksplisit** dengan value `"0"`
  (`packages/db/src/seed.ts`, bagian system config, dijalankan di kedua mode
  `SEED_MODE`), jadi DB hasil `db:reset && db:seed` berada di legacy 0. Baris yang
  absen (mis. DB lama/manual) tetap dibaca legacy 0, bukan error.
- Gate `1` saat ini hanya dipakai fixture DB **disposable** pada test mock: spec
  menulis baris gate itu sendiri sebelum skenario berjalan. Dokumen ini sengaja
  tidak memuat perintah aktivasi operasional — menaikkan gate di
  staging/production adalah keputusan rollout terpisah yang belum diotorisasi,
  dan gate tetap `0` sampai matriks kompatibilitas §8 terbukti.
- Nilai yang berlaku cukup dibaca dari baris tersebut (read-only), mis.
  `SELECT value FROM system_config WHERE key = 'discounts.contractVersion'`;
  dokumen ini tidak menjadi sumber kebenaran gate.

| Mode | Penulis order baru | Pembaca nominal | Penyimpanan uang |
|---|---|---|---|
| `0` (legacy) | `calculateOrderPricing` (`apps/store/src/lib/order-pricing.ts`) | kolom relational lama | `numeric(15,2)` cents |
| `1` | `buildPricingSnapshot` + kolom versi + `pricing_snapshot` JSONB | decoder versi (strict) | Rupiah integer tersimpan sebagai teks di JSONB, kolom relational tetap diisi dari snapshot yang sama |

## 2. Modul dan decoder

Implementasi pure ada di `packages/db/src/versioned-pricing.ts` (tanpa runtime
DB/HTTP/config) supaya store dan admin memakai kontrak yang sama. Store
mengekspor ulang lewat `apps/store/src/lib/versioned-pricing.ts` (thin
re-export), sehingga modul store tidak mengimpor runtime shared DB.

Konstanta: `PRICING_CONTRACT_VERSION = 1`, `PRICING_ENGINE_VERSION = 1`,
`PROVIDER_CONTRACT_VERSION = 2`.

`readOrderPricing(row)` adalah satu-satunya dispatch versi:

- `pricing_contract_version = 1` → kolom relational `pricing_engine_version`
  dan `provider_contract_version` **wajib** `1`/`2`, lalu payload JSONB di-decode
  strict (`decodePricingSnapshot`).
- `pricing_contract_version = 0`/absen → `pricing_engine_version` dan
  `provider_contract_version` wajib `0`, lalu **decoder legacy eksplisit**
  (`decodeLegacyOrderPricing`) dipakai; snapshot lama tidak ditebak sebagai v1.
- Versi lain, atau pasangan versi yang tidak konsisten → fail closed
  (`PRICING_UNSUPPORTED_VERSION`). Tidak ada fallback ke master/config dan tidak
  ada reprice dari harga/pajak/ongkir terbaru.

Kode error kontrak (`PricingContractError`): `PRICING_INPUT_INVALID`,
`PRICING_UNSUPPORTED_VERSION`, `PRICING_SNAPSHOT_CORRUPT`,
`PRICING_SNAPSHOT_TOO_LARGE`.

Ukuran payload diperiksa lebih dulu: melebihi `MAX_SNAPSHOT_BYTES` (256 KiB)
ditolak dengan kode tersendiri `PRICING_SNAPSHOT_TOO_LARGE`, **bukan**
`PRICING_SNAPSHOT_CORRUPT`; batas yang sama dijaga di DB oleh check
`orders_pricing_snapshot_size` (`octet_length(...) <= 262144`).

Decoder strict menolak (`PRICING_SNAPSHOT_CORRUPT`) antara lain: field tak
dikenal, payload bukan objek JSON, mata uang selain `IDR`, line duplikat, uang
bukan integer Rupiah utuh, identitas line (`sourceLineAmount = unit × qty`,
`markdownAmount`, `netLineAmount`) tidak cocok, pickup membawa ongkir,
`serviceFee ≠ 0`, `taxableBase ≠ netGoods`, `ppnAmount` tidak sama dengan hasil
ceil, `total` tidak sama dengan `netGoods + PPN + ongkir`, dan
`expectedProviderPayable ≠ netGoods + shippingCost`.

Batas input builder (`PRICING_INPUT_INVALID`): maksimum `MAX_CART_LINES` = 50
line, quantity `MAX_LINE_QUANTITY` = 1..99, dan id `MAX_ID_LENGTH` = 128
karakter. Decoder menegakkan batas yang sama pada snapshot tersimpan.

Legacy mempertahankan **cents** `numeric(15,2)` (mis. `150000.00`); tidak dipaksa
menjadi integer baru dan tidak dihitung ulang dengan formula v1. Nilai
`expectedProviderPayable` legacy adalah `null` karena kontrak lama tidak punya
konsep itu.

## 3. Rumus baseline (tanpa promo)

Per line `i` dengan quantity `q_i`:

```text
source_goods      = Σ(source_unit_price_i × q_i)
markdown_total    = 0            # Markdown belum ada di kontrak ini
subtotal          = source_goods
goods_discount    = 0            # Coupon/Markdown belum ada di kontrak ini
net_goods         = subtotal
shipping_before   = ongkir quote (0 untuk pickup)
shipping_subsidy  = 0
shipping_net      = shipping_before - shipping_subsidy   # yang dibayar customer
service_fee       = 0            # tidak ditagih, bukan baris charge
taxable_base      = net_goods    # PPN hanya atas barang
ppn               = ceil(net_goods × ppn_rate / 100)      # sekali per order
total_customer    = net_goods + ppn + shipping_net
expected_provider_payable = net_goods + shipping_net     # provider tax/fee 0
```

Konsekuensi yang perlu diingat:

- Ongkir, PPN, dan fee **tidak** masuk dasar pajak. Delivery memakai dasar
  barang saja; ini berbeda dari formula legacy.
- `serviceFee` disimpan `0` dan **tidak boleh disajikan sebagai charge** di UI.
  Baris service fee pada order legacy yang memang nonzero tetap boleh tampil
  sebagai history.
- Rate PPN tetap dari resolver/config existing (`tax.ppnRatePercent`, fallback
  11%); contoh 11% di dokumen ini hanya fixture, bukan rate kebijakan baru.
- Ongkir quote/booking milik provider tetap **original**; yang dikurangi subsidi
  hanya ongkir yang dibayar customer. Karena baseline belum punya subsidi,
  keduanya kebetulan sama — itu bukan asumsi permanen untuk kontrak berikutnya.

## 4. Contoh literal (rate 11% sebagai fixture)

| Kasus | Customer | Provider |
|---|---|---|
| Pickup barang 150000 | PPN 16500, **total 166500** | **payable 150000**, tax/disc 0 |
| Delivery barang 150000 + ongkir 30000 | PPN 16500, **total 196500** | **payable 180000** |
| Delivery, quote/booking cost kurir | tidak ikut dipotong subsidi | tetap original 30000 |
| Baris service fee | **tidak ada** (0, tidak ditagih) | tidak dijurnal |

Angka-angka ini dihitung dengan `buildPricingSnapshot`; hasilnya juga harus lolos
`decodePricingSnapshot` (identitas yang sama) sebelum dipakai sebagai snapshot
tersimpan.

## 5. Yang disimpan

Header order (kolom relational + `pricing_snapshot` JSONB, ditulis dari satu
snapshot yang sama saat insert):

`pricing_currency` (`'IDR'`), `source_goods_subtotal`, `markdown_total`,
`subtotal`, kolom legacy `discount` (dipakai ulang untuk diskon barang; nama
field snapshot-nya `goodsDiscount`), `net_goods`, `shipping_before_subsidy`,
`shipping_subsidy`, `shipping_cost` (net customer), `merchant_funding`,
`service_fee` (0), `taxable_base`, `ppn_rate`/`ppn_amount`, `total`,
`expected_provider_payable`, `provider_quoted_shipping_cost`,
`provider_billed_shipping_cost`, plus ketiga kolom versi
(`pricing_contract_version`, `pricing_engine_version`,
`provider_contract_version`). Konsistensinya ditegakkan DB lewat check
`orders_pricing_versions_valid`, `orders_pricing_currency_valid`,
`orders_pricing_snapshot_complete`, dan `orders_pricing_snapshot_size`.

Item: `pricing_contract_version=1`, `source_unit_price`, `markdown_amount`,
`goods_discount_amount`, `net_line_amount`, `markdown_revision_id` (null di
baseline).

Catatan:

- `provider_quoted_shipping_cost` dan `provider_billed_shipping_cost` disimpan
  `null` pada baseline: ongkir customer **bukan** bukti biaya provider, dan biaya
  billed yang belum diketahui tetap `null` (tidak pernah `0`).
- `delivery_snapshot` (alamat, origin, parcel, service, pricing) tetap dibekukan
  seperti sebelumnya. `service.shippingCost` adalah ongkir quote **sebelum**
  subsidi; `pricing.shippingCost` adalah ongkir net customer.
- Pembaca memakai snapshot/versi, **bukan** master price/tax/address/quote
  terbaru. Perubahan master setelah order tidak mengubah nominal, snapshot,
  maupun `expiresAt`.

## 6. Provider Sales kontrak v2

Create intent yang disimpan di ledger operasi membawa
`providerContractVersion: 2` beserta `contactId`, `customerName`, `locationId`,
`note`/`refNo`, `originalShipmentCost`, `shippingCost`,
`expectedProviderPayable`, dan lines
`{ itemId, price, quantity, discAmount: 0, taxAmount: 0, unit, taxId }`.

Decoder runtime `apps/store/src/lib/jubelio-sales-expected.ts` memvalidasi dua
record tersimpan dan memastikan keduanya **saling setuju**:

- Intent tanpa field versi = legacy unversioned; baris order wajib `0/0/0`.
  Intent legacy yang membawa field uang v2 dianggap tidak sah.
- `providerContractVersion` eksplisit selain `2` (termasuk `null`) fail closed.
- v2: identity/unit/tax/money tervalidasi, `discAmount`/`taxAmount` wajib `0`,
  `shippingCost ≤ originalShipmentCost`, dan
  `netGoods + shippingCost === expectedProviderPayable`
  (`SALES_CONTRACT_PAYABLE_MISMATCH`).
- `readSettlementAuthorityRecord` mewajibkan baris order persis `1/1/2` lalu
  membandingkan snapshot order dengan intent (`SALES_CONTRACT_RECORD_DRIFT`).
- Kode error: `SALES_CONTRACT_SHAPE_INVALID`, `SALES_CONTRACT_UNSUPPORTED_VERSION`,
  `SALES_CONTRACT_PAYABLE_MISMATCH`, `SALES_CONTRACT_RECORD_DRIFT`.

Aturan verifikasi provider: SO, invoice, dan payment dibandingkan terhadap
**expected** yang tersimpan (net barang + net ongkir), bukan dijumlah ulang dari
response provider, dan bukan `orders.subtotal` pada salah satu recovery branch.
Invoice dicocokkan lewat linkage `SO.invoice_id`; payment butuh tepat satu
association ke invoice yang benar, nominal exact, dan due `0`.

Returned ID dan ambiguity:

- ID SO/invoice/payment yang sudah dikembalikan provider disimpan/dipertahankan
  segera untuk rekonsiliasi, sebelum langkah verifikasi berikutnya bisa gagal.
- Timeout, 5xx, sukses tanpa ID, GET verifikasi gagal, atau selisih Rp1 menahan
  tahap berikutnya **dan** fulfillment; tidak ada retry POST buta, tidak ada
  cancel/cleanup otomatis atas ambiguity.
- Order yang sudah paid tetap paid; fulfillment tetap diblokir sampai settlement
  terbukti.

## 7. Pembaca yang memakai kontrak ini

| Pembaca | Perilaku |
|---|---|
| `POST /api/checkout/place-order` | gate1: verifikasi review token + fingerprint context, replay request-wide, lalu bangun snapshot sebelum stock/ongkir provider, tulis kolom versi + JSONB dalam transaksi order, intent provider v2 |
| `POST /api/checkout/preview` | gate1: baca harga sumber server lalu bangun snapshot pickup **atau delivery** untuk breakdown review + token review bertanda tangan; gate0 eksplisit 400 `UNSUPPORTED_VERSION` (tanpa fallback legacy). Batas yang sama ditegakkan lebih dulu: body > 256 KiB → 413 `INPUT_LIMIT_EXCEEDED`, shape terpilih tidak valid → 400 `INPUT_INVALID`, selected IDs maksimal 50 ID (masing-masing ≤128 karakter). Read-only: tanpa order, hold, usage, atau provider business write |
| `GET /api/checkout/requests/{requestKey}` | hasil accepted milik client saja; 404 untuk key/owner lain; read-only (tidak requote/reserve/dispatch, tidak memperpanjang expiry) |
| `POST /api/payments/midtrans/create` | decode versi **sebelum** early return redirect; unknown version → tidak ada Snap baru |
| `GET /api/orders/{id}` | decode versi, kembalikan nominal snapshot + `pricingSnapshot` (v1) dan field line versi |
| `POST /api/checkout/delivery-quote` | gate1: bound sumber divalidasi sebelum read region/provider |
| Settlement/recovery provider | `readSettlementAuthorityRecord` sebagai otoritas expected |

## 8. Persyaratan rollout (belum selesai, bukan klaim)

Semua poin di bawah ini **wajib** beres sebelum gate dinaikkan ke 1. Ini daftar
persyaratan, bukan pernyataan bahwa source sudah lengkap:

1. **Admin paired reader — sudah memakai decoder yang sama.** `GET
   /api/admin/orders/{id}` men-select kolom versi + `pricing_snapshot`, lalu
   setelah RBAC/branch scope lolos (cross-branch tetap 404) dan **sebelum** DTO
   uang maupun workflow delivery dibangun memanggil `readOrderPricing` dari
   `@marketplace/db/src/versioned-pricing` (pure, tanpa runtime shared DB).
   `subtotal`, `discount` (v1: `goodsDiscount`), `shippingCost`, `serviceFee`,
   `ppnRate`, `ppnAmount`, `total`, dan `pricingSnapshot` diambil dari snapshot
   tersimpan; baris item memakai quantity, harga efektif, dan net line dari
   snapshot dengan validasi versi line yang sama seperti store. Versi
   unknown/corrupt berhenti sebagai error generik 500 dengan konteks terstruktur
   (kode kontrak + ketiga kolom versi), tanpa reprice dan tanpa provider write
   karena route ini read-only. Halaman admin order detail merender respons API
   tersebut, bukan membaca kolom relational sendiri.
2. **Store account order detail — sudah memakai versi.** `/account/orders/{id}`
   membaca `GET /api/orders/{id}`, yang men-decode versi lalu mengembalikan
   nominal snapshot (`pricingSnapshot` untuk kontrak 1).
3. **Lifecycle/invoice/payment verifier — sudah memakai expected v2.**
   `readSettlementAuthorityRecord` menjadi otoritas: branch v2 membandingkan
   invoice/payment terhadap `expectedProviderPayable` tersimpan, sedangkan branch
   legacy tetap memakai `orders.subtotal` seperti sebelumnya.
4. **Baris service fee di UI — sudah kondisional.** Ringkasan checkout, halaman
   order store, dan row order admin hanya merender baris service fee bila
   nominalnya > 0; baris legacy yang memang nonzero tetap tampil sebagai history.
   Untuk order kontrak baru, `serviceFee` selalu `0` dan tidak pernah disajikan
   sebagai charge.
5. **Matriks kompatibilitas (belum).** Store, admin, sweep, mirror dan stock-sync
   readers harus menerima `pricing1` + `provider2` sebelum writer dibuka.
   `discounts.contractVersion` tetap 0 sampai itu terbukti.

## 9. Verifikasi

Yang perlu dijalankan (bukan hasil yang diklaim dokumen ini):

- Focused unit: pure pricing/decoder (`apps/store/src/lib/versioned-pricing.test.ts`),
  bound input checkout, delivery quote (`delivery-quote.test.ts`),
  lifecycle/settlement. Decoder envelope provider (`jubelio-sales-expected.ts`)
  belum punya test unit khusus; ia hanya dijangkau lewat jalur settlement yang
  memakai `readSettlementAuthorityRecord`.
- Mock E2E: `e2e/store/versioned-checkout-mock.spec.ts` — gate1 pickup review,
  bound input checkout, dan alur delivery quote → Snap → detail → repayment.
  Pastikan spec ini tercakup `testMatch` `playwright.mock.config.ts`; spec yang
  tidak tercakup tidak pernah ikut `verify:batch:e2e`.
- Dokumen ini tidak menjalankan maupun mengklaim hasil test apa pun. Skip bukan
  bukti lulus, dan legacy live-provider E2E butuh izin terpisah.

Lihat [testing](../testing/README.md) untuk command eksplisit dan batas bukti.

## 10. Status bukti

Dokumen ini menjelaskan perilaku repo saat ini, bukan mencatat hasil run. Nominal,
kode error, dan nama kolom di atas berasal dari source yang sama dengan
implementasinya: `packages/db/src/versioned-pricing.ts`,
`packages/db/src/schema/orders.ts`, `apps/store/src/lib/*` (termasuk
`versioned-pricing.test.ts`), `apps/admin/src/app/api/admin/orders/[id]/route.ts`,
dan `packages/db/drizzle/0034_loving_nocturne.sql`
serta `0035_short_lethal_legion.sql` (audit `drizzle-kit`, tidak diedit tangan).

Yang masih harus dibuktikan sebelum gate dinaikkan adalah sisa daftar §8,
terutama matriks kompatibilitas pembaca (sweep, mirror, stock-sync) di luar
pasangan store–admin. Status run (unit, `tsc`, mock E2E) dicatat pada tiket
implementasi masing-masing, bukan di sini.

Tidak ada klaim pass/lulus pada dokumen ini, termasuk untuk acceptance F02,
T06, P01, P02, D02, D03.

## 11. Hubungan dengan dokumen lain

- Formula PPN lama (delivery ikut kena pajak ongkir) tetap ada dan sekarang
  ditandai **LEGACY**: [ppn.md](ppn.md).
- Dua ledger dan settlement delivery: [delivery-orders.md](delivery-orders.md).
- Kontrak provider Sales, ledger operasi dan mirror: [jubelio-sales-orders.md](jubelio-sales-orders.md).
- Alur order end-to-end (repayment, webhook, sweep): [order-flow.md](order-flow.md).
- Markdown per SKU (proyeksi efektif, apply/history, provider whole-line
  discount): [markdown-pricing.md](markdown-pricing.md). Snapshot kontrak 1
  sudah membawa `markdownTotal`/`markdownAmount`/`markdownRevisionId`; ticket
  03 mengisi nilainya dari current pointer dan mewajibkan revision ID saat
  effective < source.

## 12. Review checkout, request key, dan admission (ticket 02)

Bagian ini menjelaskan perilaku yang dibangun di atas kontrak uang §1–§7.

**Review token.** `POST /api/checkout/preview` mengembalikan `reviewToken`
(HMAC-SHA256 dengan kunci turunan `BETTER_AUTH_SECRET` + domain separation
`okcir:discounts:checkout-review:v1`), `expiresAt` (TTL 10 menit), `pricing`, dan
`contextFingerprint`. Payload token hanya `{ v, fp, exp }` — tanpa PII, alamat,
kode, atau rincian harga. Token bukan auth/izin, tidak membekukan harga, slot,
atau kapasitas. Secret hilang → `503 PRICING_UNAVAILABLE` (fail closed).

**Context fingerprint.** SHA-256 kanonik atas selection terurut (cart item id,
variant, quantity, harga satuan ternormalisasi), branch, fulfillment, slot
pickup **atau** snapshot delivery (address/origin/parcel/courier/service),
kontak (digest), pilihan promo `none`, dan versi + breakdown pricing. Duplicate
cart IDs ditolak; urutan input tidak membuat fingerprint berbeda.

**Place order gate1.** Body wajib membawa `requestKey` (UUID), `reviewToken`,
dan `promoSelection`; salah satu hilang/kadaluarsa/tamper atau fingerprint
context berubah → `409 CHECKOUT_REVIEW_REQUIRED` sebelum order, hold, atau
provider write. Untuk delivery, fingerprint dihitung ulang dari snapshot hasil
quote terbaru sehingga approval lama tetap harus diperbarui walau total turun
(`409 DELIVERY_REPRICE_REQUIRED` adalah kontrak reapproval delivery yang sudah
ada). Uang browser hanya acknowledgement; server selalu menghitung ulang.

**Request-wide replay.** Fingerprint intent kanonik = seluruh user intent
(sorted cart IDs, fulfillment/slot/kontak, destination/service/origin,
save-address, promo `none`, fingerprint review, approved pricing ternormalisasi)
tanpa metadata transport. Key sama + fingerprint sama → order yang sama
(`200`), tanpa requote/reprice/reserve/dispatch ulang; fingerprint berbeda →
`409 REQUEST_KEY_CONFLICT`. Replay dibaca dari `checkout_request` **sebelum**
cart/master terbaru, sehingga tetap bekerja setelah cart dibersihkan atau token
kadaluarsa. Key yang reject sebelum commit tidak membuat result fiktif.

**Satu commit.** Order + items + snapshot + optional saved address + stock hold
+ SO intent + accepted result berada dalam satu transaksi dengan urutan lock
client → request → variant/cart → branch/address (SHARE) → stock → operation.
Batas transaksi: lock 2 dtk, statement 5 dtk, wall 10 dtk, retry maksimal 3
attempt hanya untuk `40001`/`40P01` (seluruh transaksi sudah rollback); tidak ada
HTTP provider di dalam lock.

**Status dan recovery.** Order baru `201`; replay `200`; committed tetapi
provider/payment masih `processing`/`manual_review` `202` dengan `orderId`.
Response hilang setelah commit tetap dapat ditemukan lewat `GET
/api/checkout/requests/{requestKey}` (owner saja, `404` untuk key/owner lain).
Crash sebelum external claim: sweep existing boleh meng-claim intent yang belum
pernah dispatched satu kali; outcome `dispatched_unknown` hanya direkonsiliasi
lewat GET, tidak pernah re-POST, dan tidak ada worker/outbox kedua. Retry/repayment
tidak memperpanjang expiry dan tidak membuat payment attempt/order pengganti.

**Feedback saat submit.** Selama request checkout berjalan, halaman cukup
menampilkan spinner dan label `Memproses...` pada tombol bayar yang disabled;
panel generik “Status checkout sebelumnya belum dapat dipastikan” beserta tombol
“Periksa status checkout” tidak ditampilkan. Jika respons hilang, klik berikutnya
pada `Bayar Sekarang` memeriksa request tersimpan dengan key yang sama, bukan
membuat checkout baru. Recovery saat reload dan feedback status definitif dari
server tetap dipertahankan.

**Admission.** `POST /api/checkout/preview` dan `POST /api/checkout/place-order`
memakai counter PostgreSQL `discount_request_window` (bukan Map in-process):
preview 60/account dan 300/IP per 60 detik; place order 10/account dan 60/IP.
Subjek disimpan sebagai HMAC pseudonymous — raw IP dan token tidak masuk log
bisnis. Kedua bucket diperiksa atomik dalam transaksi pendek; melebihi batas →
`429 RATE_LIMITED` + `Retry-After`; tanpa secret/trusted policy/IP valid →
`503 POLICY_UNAVAILABLE` (fail closed). Replay accepted dan read-only result
tidak dihitung sebagai placement baru. Baris window kedaluwarsa dibersihkan
opportunistic (≤100 baris/request setelah 10 menit) tanpa cron baru; tabel ini
ephemeral dan terpisah dari `checkout_request` yang retained.

Trusted IP hanya dari ingress yang menimpa `X-Real-IP` dan mencegah akses
langsung ke app (`CHECKOUT_TRUST_PROXY=true` pada compose staging/production).
Development/mock selalu memakai bucket loopback dan mengabaikan header forged.

**Batas yang belum ada.** Bucket manual-code (20/120) belum dipakai karena kode
manual belum dibangun (ticket 09), dan `POST /api/checkout/delivery-quote` belum
memakai admission bucket preview — dicatat sebagai gap, bukan diklaim selesai.

## 13. Coupon publik fixed-goods dalam snapshot (ticket 07)

Satu Coupon publik boleh menempati slot promo pada checkout pickup. Markdown
tetap komponen terpisah dan boleh digabung. `evaluatePricing` menerima benefit
fixed-goods, meng-clip ke subtotal setelah Markdown, lalu mengalokasikan per
whole line secara proporsional (floor + sisa largest remainder, tie variant ID).
Snapshot menyimpan `goodsDiscount` sebagai `pricing.discount`/`orders.discount`,
`goodsDiscountAmount` per line, dan `netGoods`. PPN dihitung dari `netGoods`;
payable provider = net barang (bukan subtotal sebelum Coupon). Contoh literal:
lines 150000+100000, fixed 25000 → alokasi 15000+10000, net225000, PPN24750,
total249750.

Place order menulis snapshot, Redemption `reserved`, event, counter
global/per-client, dan `order_discount_allocation` (`markdown`/`offer_goods`,
amount positif saja) dalam satu commit dengan order/stock/intent. Sales Order
kontrak v2 menerima `price` source dan `disc_amount` whole-line = Markdown +
alokasi Coupon (tidak dikalikan quantity dua kali); `amount` = gross line −
disc. Detail Midtrans memakai harga efektif + adjustment `discount` (Coupon)
sehingga jumlahnya tetap sama dengan total. Lifecycle paid/consume/release
dijelaskan di [Coupon/Redemption](discount-redemption.md).

## Subsidi ongkir pada kontrak pricing1 (ticket 11)

`shipping_subsidy` kini dapat bernilai positif untuk delivery: `S =
min(shipping_before, cap)`, `shipping_net = shipping_before − S`, dan
`merchant_funding = S`. PPN tetap atas `net_goods`; `total_customer = net_goods +
PPN + shipping_net`; `expected_provider_payable = net_goods + shipping_net`.
Snapshot/decoder menolak `merchant_funding ≠ shipping_subsidy`, subsidi kedua,
pickup berongkir, dan komponen yang tidak konsisten.

Yang WAJIB dibedakan:

- `shipping_before_subsidy` / `service.shippingCost` delivery snapshot:
  ongkir quote/booking ORIGINAL (contoh 30000).
- `shipping_subsidy` + `merchant_funding`: subsidi merchant (contoh 20000).
- `shippingCost` / `pricing.shippingCost`: ongkir NET customer (contoh 10000).
- `providerQuotedShippingCost`: quote cost yang diketahui (delivery: nilai quote).
- `providerBilledShippingCost`: NULL sampai ada evidence billed; diisi lewat
  ledger shipment existing, bukan ditebak.

Packing/booking/recovery membaca komponen original (`service.shippingCost`),
sedangkan invoice/payment/Midtrans/recovery expected membaca net
(`pricing.shippingCost` + `netGoods`). Tidak ada guard yang membandingkan
original quote dengan net customer, dan nilai kurir tidak pernah diubah sebagai
workaround. Literal: barang150000 + ongkir30000 cap20000 → total customer
176500, provider payable160000, booking cost tetap30000; ongkir12000 cap20000 →
total166500, payable150000, sisa8000 hangus.

## 11. Batas promotion (checkout attempt)

Snapshot harga yang disetujui disimpan di `checkout_attempt` sebelum provider
dipanggil. Baris `orders` + `order_item` + `order_discount_allocation` baru
ditulis saat **promotion**, yaitu setelah SO terkonfirmasi dan sesi pembayaran
tersedia, dari snapshot itu — bukan hasil hitung ulang master terbaru. Karena
itu order gagal yang lama tidak lagi dibuat untuk checkout baru; kegagalan
tercatat sebagai attempt `rejected`/`manual_review`. Lihat
[jubelio-sales-orders.md](jubelio-sales-orders.md#checkout-attempt-sebelum-order-plan-checkout-attempt-before-order).

## 12. Kontrak provider3 — PPN checkout dicatat pada SO/invoice/payment

Sejak ticket
[PPN checkout](../../.scratch/jubelio-sales-api-switching/plan/jubelio-sales-order-tax-spec.md)
disetujui, writer order baru memakai **pricing1 / engine1 / provider3**. Formula
customer tidak berubah; yang berubah hanya representasi provider, sehingga
customer tidak ditagih PPN kedua.

| Aspek | provider2 | provider3 |
|---|---|---|
| `expectedProviderPayable` | net barang + net ongkir | net barang + **PPN barang** + net ongkir |
| Snapshot pajak | tidak ada | `providerTax = { taxId, ratePercent }` (immutable) |
| Pajak per baris | tidak ada | `providerTaxAmount` (Rupiah utuh, WAJIB) |
| `total` customer | net barang + PPN + net ongkir | sama (tidak ada tambahan) |

Aturan yang dijaga kode:

- **Tax ID signed**: `parseValidatedProviderTax`
  (`packages/db/src/provider-tax.ts`) menerima safe integer nonnol; tenant riset
  memakai `-2` (PPN 11%). ID `0`, pecahan, overflow, string, dan field asing
  ditolak. `JUBELIO_ITEM_TAX_ID` bukan otoritas provider3.
- **Rate exact**: `providerTax.ratePercent` wajib sama secara exact (integer
  terskala, bukan float) dengan `ppnRatePercent`; `"11"` setara `"11.00"`,
  `11` vs `12` ditolak.
- **Alokasi whole-line**: `allocateProviderTax` menghitung pajak exact tiap
  baris, mengambil floor, lalu membagikan sisa menuju `ppnAmount` menurut
  remainder terbesar dengan tie-break `variantId` ascending ordinal. Baris net 0
  selalu 0. Total `Σ providerTaxAmount === ppnAmount`, bukan ceil per baris.
- **Benefit dihitung ulang**: `evaluatePricing` meneruskan konteks pajak dan
  merealokasi setelah Markdown/Coupon/subsidi ongkir final; `offer-pricing.ts`
  tidak boleh menjatuhkan snapshot ke provider2.
- **Decoder fail closed**: `decodePricingSnapshot` menolak provider3 tanpa
  `providerTax`/`providerTaxAmount`, alokasi yang tidak dapat direproduksi,
  `expectedProviderPayable` yang masih memakai formula provider2, dan kombinasi
  field campuran versi. `readOrderPricing` juga menolak kolom relasional provider
  yang tidak sama dengan versi snapshot.
- **Review fingerprint**: `CheckoutReviewPricing.providerTax` ikut ditandatangani,
  sehingga perubahan tax id/rate menggugurkan approval lama walaupun total
  kebetulan sama.
- **Konfigurasi**: `jubelio.salesTaxId` (system_config, `type:number`) dibaca
  **uncached** bersama `tax.ppnRatePercent` oleh
  `apps/store/src/features/checkout/jubelio-tax-config-repository.ts`; keduanya
  diverifikasi ke master `GET /taxes/` oleh
  `prepare-checkout-tax-service.ts`. Key hilang/invalid, master tidak ditemukan
  atau duplikat, rate berbeda, dan mapping pajak keluaran yang tidak ada =
  `503 CHECKOUT_TAX_UNAVAILABLE` sebelum pembayaran.

Fixture contoh (rate 11%, literal test): pickup barang 100000 → PPN 11000, line
111000, provider = customer 111000; qty2 × 100000 → 22000/222000; Coupon 20000
pada 150000 → 14300/144300; delivery 150000 + ongkir 30000 → 16500/196500;
subsidi ongkir 20000 → net ongkir 10000, tetap 176500; dua baris 100001 → order
22001 dengan alokasi 11001/11000.
