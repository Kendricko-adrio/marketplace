# Spec: PPN checkout dicatat pada Sales Order, invoice, dan payment Jubelio

Tanggal penyusunan: 2026-10-26.
Pemilik status keseluruhan dan navigasi: [index fitur](../index.md). Dokumen ini merupakan hasil `to-spec`, bukan implementation ticket atau izin menjalankan perubahan.

## 1. Pernyataan masalah

Customer sudah membayar PPN di checkout/Midtrans, tetapi kontrak provider aplikasi saat ini mencatat net barang + net ongkir tanpa PPN. Akibatnya, tagihan customer dan nilai SO/invoice/payment Jubelio berbeda. Master pajak tenant memiliki record **PPN11% dengan `tax_id:-2`**, tetapi validator aplikasi mengharuskan tax ID positif dan nominal pajak nol.

Contoh saat ini: customer membayar111000 untuk barang100000 + PPN11000, tetapi Jubelio mencatat100000. Target: keduanya111000, tanpa memungut PPN kedua dari customer.

## 2. Solusi dan keputusan hasil grilling

Keputusan produk yang telah dikonfirmasi pemilik:

1. PPN yang dibayar customer ikut dicatat sebagai pajak barang pada Jubelio; total provider sama dengan total customer, tanpa tagihan tambahan.
2. Berlaku **hanya untuk order/checkout attempt baru setelah aktivasi**. Order dan attempt existing memakai kontrak serta snapshot tersimpannya.
3. Tax ID disimpan di **`system_config`**, nilai tenant yang dibutuhkan sekarang **-2**; **tidak membuat menu admin**.
4. Lepaskan syarat tax ID positif. Tetap validasi signed safe integer, referensi master yang benar, dan penolakan ID0.
5. Jika tax ID tidak valid atau rate website berbeda dari master Jubelio, **blokir checkout sebelum pembayaran**. Tidak fallback ke No Tax, tidak mengikuti rate provider diam-diam.
6. Kebijakan existing tetap: PPN atas **net barang setelah Markdown dan Coupon/Manual Promo Code**, bukan ongkir; ceil sekali pada total dasar, Rupiah utuh; service fee0. Satu slot Offer dan funding subsidi ongkir tidak berubah.

### Approval dan batas wewenang

- Kesepahaman bersama: pemilik menjawab **“iya sudah sesuai”** atas rangkuman lima keputusan grilling, kemudian meminta dibuatkan `to-spec`.
- **Complete spec disetujui pemilik pada 2026-10-26** melalui pesan **“oke sudah saya setujui specnya”**. Approval mencakup scope, blueprint teknis/UX, provider version3, alokasi pajak, kontrak error/copy, acceptance criteria dan test seams dalam dokumen ini. Status keseluruhan dicatat hanya pada index fitur.
- Usulan teknis baru dalam dokumen ini—provider version3, struktur snapshot, alokasi pajak per baris, dan copy error—belum dianggap keputusan yang telah diimplementasikan.
- Gate approval complete spec telah terpenuhi; index fitur dapat menandai Ready. Approval ini tidak otomatis menerbitkan breakdown tickets multi-sesi atau memulai eksekusi pada sesi pencatatan approval ini; breakdown tetap memerlukan persetujuan terpisah. Perubahan scope berikutnya wajib direview ulang.
- Tidak ada izin subagent, commit/push, deployment, perubahan DB/config aktual, atau provider write tambahan dari dokumen ini.

## 3. Bukti yang mendasari

| Evidence | Hasil yang sudah terbukti | Batas |
| --- | --- | --- |
| [Riset schema dan master pajak](../research/jubelio-sales-order-tax-input.md) | `tax_id`, `tax_amount`, `total_tax`, `is_tax_included` tersedia; tenant mempunyai tax-2/rate11 dan NoTax1/rate0 | Tidak menetapkan kepatuhan hukum atau rate untuk tenant lain |
| [Canary SO dan cancel](../research/jubelio-tax-canary-verification.md#hasil-final--pemilihan-item-available-dan-dua-so-berhasil) | SO68448 NoTax100000 dan SO68449 tax-2/tax11000/total111000, create/GET/cancel/stok PASS | Qty1, satu baris, tanpa diskon/ongkir/fee |
| [Canary invoice/payment](../research/jubelio-tax-canary-verification.md#kelanjutan-invoice-dan-payment--berhasil) | SO68450 → invoice45978 → payment67; seluruh request HTTP200; pajak11000, paid111000/due0 | Account2/type0 sandbox; bukan konfigurasi production universal; jurnal accounting UI tidak diaudit |
| [Journal settlement teredaksi](../research/jubelio-tax-invoice-payment-results.json) | Input, IDs, GET independen, pemeriksaan linkage/money dan stok | Fixture dipertahankan paid; stok berkurang1 sesuai izin terdahulu |

Tidak perlu mengulang canary yang sudah PASS. Variasi diskon/ongkir/multi-line/rounding dan mirror ber-tax masih merupakan gap evidence, bukan dianggap sudah lulus.

Dokumen ini menggantikan pemisahan PPN website/provider pada [keputusan finance04](../../discounts/wayfinder/04-tax-and-shipping-subsidy-accounting.md#answer--keputusan-final-disetujui) dan [kontrak provider09](../../discounts/wayfinder/contract-09-provider-representation-and-settlement.md#3-mapping-so) **hanya untuk writer baru setelah aktivasi spec yang disetujui**. Histori/order lama dan aturan finansial lain tetap berlaku. Saat implementasi selesai, dokumen enduring diperbarui dengan batas versi yang eksplisit, bukan menghapus histori.

## 4. User stories

1. Sebagai customer checkout, saya ingin total pembayaran tetap sama, agar pencatatan PPN di Jubelio tidak menambah tagihan saya.
2. Sebagai customer pickup, saya ingin PPN barang tercatat pada SO dan invoice sesuai rincian checkout.
3. Sebagai customer delivery, saya ingin ongkir tetap terpisah dan tidak mendadak dikenai PPN barang.
4. Sebagai customer yang memakai Markdown, saya ingin dasar PPN mengikuti harga barang setelah Markdown.
5. Sebagai customer yang memakai Coupon/Manual Promo Code barang, saya ingin PPN mengikuti net barang setelah potongan yang disetujui.
6. Sebagai customer penerima subsidi ongkir, saya ingin PPN barang tidak berubah hanya karena ongkir disubsidi.
7. Sebagai customer dengan beberapa barang, saya ingin jumlah pajak semua baris sama dengan PPN total checkout, tanpa selisih pembulatan.
8. Sebagai customer, saya ingin checkout ditahan sebelum membayar jika konfigurasi pajak salah, dengan pesan yang jelas dan form tidak hilang.
9. Sebagai customer yang melanjutkan pembayaran order existing, saya ingin nominal awal tidak berubah karena konfigurasi pajak baru.
10. Sebagai operator, saya ingin invoice dan payment Jubelio cocok dengan SO serta total yang dibayar customer.
11. Sebagai operator, saya ingin transaksi yang sudah paid tetap paid bila verifikasi provider gagal, tanpa fulfillment atau duplicate POST yang tidak aman.
12. Sebagai pengelola konfigurasi, saya ingin tax ID dapat ditetapkan melalui database tanpa membuat halaman admin baru.
13. Sebagai operator recovery, saya ingin dapat memeriksa returned IDs dan alasan mismatch tanpa akses ke credentials atau response customer mentah.
14. Sebagai Admin User yang berwenang melihat order, saya ingin order lama dan baru tetap terbaca tanpa mengubah Branch Scope atau permission.

## 5. Keputusan implementasi yang diusulkan

### 5.1 Konfigurasi dan validasi master

- Key baru: **`jubelio.salesTaxId`**, `type:number`, `value:"-2"` untuk tenant yang sudah diteliti. Tetap memakai `tax.ppnRatePercent` sebagai rate website; bukan key rate baru dan bukan hasil hitung otomatis dari tax ID.
- Nilai text DB diparse secara ketat menjadi signed safe integer nonzero; menerima-2 dan ID positif yang benar-benar ada pada master. Tolak kosong,0,pecahan,NaN/Infinity,overflow, format ambigu, dan tipe konfigurasi yang salah. Payload internal tetap number; string `"-2"` tidak boleh lolos sebagai angka pada intent JSON tanpa decoder yang eksplisit.
- Pembacaan pasangan key dilakukan **uncached/fail-closed** melalui repository terfokus, tidak memakai fallback getter generic yang menelan kegagalan DB. Rate divalidasi sebagai desimal canonical0..100 sampai6 digit pecahan, bukan float comparison mentah.
- Pada preview dan sebelum menulis attempt/intent baru, GET master pajak memakai gateway/auth/scheduler existing: `/taxes/?page=N&pageSize=100`, sampai record yang cocok ditemukan atau seluruh daftar selesai. Harus tepat satu record yang cocok, rate sama secara exact, dan mapping pajak keluaran tersedia untuk rate positif. Duplicate/malformed record atau GET gagal berarti unavailable, bukan rate0.
- Tidak ada stale-success cache atau retry write sebagai jalan keluar. Lookup GET hanya sebelum pembekuan attempt; settlement/replay tidak membaca ulang config/master untuk mengganti angka snapshot.
- Setelah attempt berhasil dicatat, tax identity/rate/nominalnya immutable. Perubahan config berikutnya berlaku pada checkout baru, bukan transaksi yang sedang dilanjutkan. Batas atomik praktis adalah snapshot tervalidasi yang ditulis ke attempt; tidak mengklaim transaksi lintas DB dan provider bersifat atomic.
- `JUBELIO_ITEM_TAX_ID` bukan authority baru dan tidak menjadi fallback writer provider3. Order lama sudah memiliki tax ID di intent; pertahankan kompatibilitas script/reader lama tanpa membaca env untuk reprice order.
- Seed DB pengembangan menyertakan konfigurasi-2; aktivasi staging/production harus memverifikasi tenant dan mengisi key secara eksplisit. Jangan menyalin ID antar tenant tanpa GET verifikasi, atau menjalankan seeder penuh pada DB operational.

### 5.2 Versi kontrak: pisahkan order lama dan baru

Usulan teknis: **pricing1 / engine1 / provider3** untuk pencatatan pajak baru. Formula customer tidak berubah; versi provider berubah karena payable dan authority pajak berubah.

| Kontrak tersimpan | Perlakuan |
| --- | --- |
| `0/0/0`, intent tanpa provider version | Legacy existing, pertahankan uang/guard semula |
| `1/1/2` | Existing tanpa pajak provider, payable net barang + net ongkir |
| `1/1/3` | Baru, payable net barang + PPN barang + net ongkir; harus mempunyai tax snapshot valid |
| Unknown/mixed version atau record tidak cocok | Fail closed; jangan fallback ke master/kontrak lama |

- Tambahkan branch decoder3, jangan mengganti makna provider2 secara global. Constraint DB menerima kombinasi baru sambil tetap menerima kombinasi lama yang sah.
- Snapshot provider3 menyimpan **`providerTax`** minimal `{ taxId, ratePercent }`; setiap pricing line menyimpan **`providerTaxAmount`** berupa decimal string Rupiah utuh. Intent create menyimpan identitas/rate serta nominal tax setiap line; paired-record authority harus cocok dengan order/attempt snapshot.
- `PricingSnapshotPayloadV1` menjadi discriminated union provider2/provider3; field wajib v3 tidak dibuat optional sehingga corruption tidak berubah menjadi pajak0. Belum ada kebutuhan tabel baru atau kolom tax ID terpisah pada `orders`: JSONB existing membawa snapshot immutable.
- Snapshot attempt luar tetap `version:1` bila envelope JSON tidak berubah; nested pricing dan create intent membedakan provider3. Pembaca semua app harus mengenal provider3 sebelum writer diaktifkan.
- Builder pure menerima konteks tax tervalidasi untuk menghasilkan3. Kemampuan membangun2 boleh dipertahankan hanya untuk explicit compatibility/test seams; endpoint order baru setelah aktivasi tidak boleh diam-diam memilih2 ketika config hilang.
- Checkout gate `discounts.contractVersion=1` adalah prerequisite writer baru karena kontrak uang berversi existing berada di gate tersebut. Gate0 tidak menjadi fallback order baru tanpa PPN setelah aktivasi; resume legacy tetap dilayani.
- Replay/recovery existing harus dideteksi **sebelum** preflight config/master baru, agar outage pajak atau perubahan key tidak menggagalkan kelanjutan order lama yang sah.

### 5.3 Formula dan alokasi pajak

```text
net_line        = source_price × quantity − whole_line_discount
net_goods       = Σ net_line
ppn_order       = ceil(net_goods × website_rate / 100)
provider_line   = net_line + allocated_line_tax
provider_payable = net_goods + ppn_order + net_shipping
customer_total   = provider_payable                    # service fee0
```

- Source price dan diskon barang tetap mengikuti kontrak existing: `disc_amount` mencakup Markdown + alokasi Coupon per whole line, tidak dikalikan quantity dua kali. Jangan menaikkan `price` untuk menyembunyikan PPN.
- **Usulan alokasi teknis:** hitung pajak exact setiap whole line; ambil floor, lalu bagikan selisih menuju `ppn_order` menurut fractional remainder terbesar. Tie-break `variantId` ascending secara ordinal; jangan bergantung urutan array atau locale. Baris net0 menerima tax0. Jika semua dasar0, seluruh tax0 tanpa pembagian nol.
- Hasil akhir wajib `Σ providerTaxAmount = ppnAmount`, tidak mengubah ceil tingkat order menjadi ceil per line. Gunakan exact integer/BigInt/rate scaled, bukan float epsilon untuk menentukan rate atau alokasi.
- Finalisasi tax line dilakukan **setelah** Markdown/Coupon/shipping subsidy final. Evaluator promo tidak boleh menjatuhkan tax identity saat membangun ulang snapshot, atau membawa alokasi lama setelah benefit berubah.
- Semua bounds uang/quantity dan batas50 baris existing tetap berlaku. Tidak menambah gross/net tax field yang tidak terdokumentasi atau menyamarkan pajak sebagai fee/item barang.

Contoh acceptance independen, rate11%:

| Kasus | Expected |
| --- | --- |
| Pickup barang100000 | Tax11000, line111000, provider/customer111000 |
| Qty2 ×100000 | Whole-line tax22000, line222000; bukan tax11000 yang dikalikan lagi secara salah |
| Barang150000, Coupon20000 | Net130000, tax14300, total144300 |
| Delivery barang150000, ongkir30000 | Tax16500, provider/customer196500 |
| Delivery barang150000, ongkir30000, subsidi20000 | Net ongkir10000, tax16500, provider/customer176500; quote/booking tetap30000 |
| Dua variant net100001 masing-masing | Dasar200002, tax order22001; alokasi11001/11000 menurut tie-break, total222003 |
| Net barang0 dengan net ongkir10000 | Tax0, payable10000; tidak menambah requirement payment0 |

Contoh selain fixture tunggal100000/11000 adalah target yang harus diuji, bukan hasil canary yang sudah terbukti.

### 5.4 JSON provider, invoice, payment, dan mirror

Mapping provider3:

| Field request SO | Sumber |
| --- | --- |
| `is_tax_included` | false |
| `items[].tax_id` | signed tax ID dari snapshot tervalidasi, initial-2 |
| `items[].tax_amount` | `providerTaxAmount` seluruh line |
| `items[].amount` | Source whole-line gross − whole-line discount + line tax |
| `sub_total`, `total_disc` | Gross source dan total whole-line discount existing |
| `total_tax` | Jumlah line tax = `ppnAmount` |
| `grand_total` | Frozen provider payable = total customer |
| Original/net shipping | Mapping existing; `shipping_cost_discount` tetap omitted |
| Fee/header additional discount | Tetap0 |

- Invoice conversion tetap `{ salesorder_id }`; tidak mengirim ulang pajak. GET invoice wajib memeriksa **tax identity dan nominal per line**, bukan hanya header total.
- Payment tetap memakai `amount` dan association `payment_amount` sebesar payable tersimpan, kini termasuk PPN. Tidak menambahkan tax ID/tax amount pada payment request karena pajak dimiliki invoice.
- Account/type payment tetap konfigurasi sah existing; keberhasilan account2/type0 sandbox tidak boleh mengubah default operational.
- Pertahankan returned-ID persistence sebelum GET, at-most-once claim, timeout/5xx/mismatch → manual review, tanpa blind retry atau automatic reprice/cancel. Transaksi paid tetap paid dan fulfillment ditahan sampai invoice/payment sesuai.
- SO `is_paid:null` tidak menjadi alasan menyimpulkan unpaid bila invoice payment amount dan payment association membuktikan paid/due0.
- **Mirror Status Channel wajib version-aware**: full-payload edit mempertahankan tax ID, mode exclusive, nominal line/header, detail IDs, invoice link, diskon dan shipping. Nonzero tax hanya boleh lolos bila persis cocok snapshot provider3. Guard lama tetap berlaku pada2/legacy; jangan menghapus semua guard tax secara global.

### 5.5 Kontrak kegagalan dan logging

Usulan kontrak HTTP baru pada preview/place-order: **503**, `success:false`, `code:"CHECKOUT_TAX_UNAVAILABLE"`, `error:"Checkout belum dapat diproses karena konfigurasi pajak belum sesuai. Silakan coba lagi nanti."`, dan `requestId` mengikuti pola existing; `Cache-Control:no-store`.

- Dipakai untuk config hilang/rusak, tax tidak ditemukan, rate mismatch, dan dependency lookup gagal. Browser tidak menerima credentials, payload master, nama akun, atau rincian rate mismatch internal.
- Pada kegagalan sebelum attempt: tidak ada SO/invoice/payment/Midtrans baru, Promo Reservation, order, perubahan cart, atau hold stok yang tertinggal. Request admission/audit counters yang sudah menjadi proteksi existing boleh tetap tercatat.
- Preview lama tidak dapat mengotorisasi pembayaran bila config tax berubah sebelum placement. Sertakan tax identity/rate/provider version dalam review fingerprint; review stale meminta review ulang, bukan membayar memakai approval lama.
- Jika gagal setelah write mungkin terkirim, gunakan lifecycle/manual-review existing, bukan menyamarkannya sebagai error preflight yang aman untuk create ulang.
- Logger app module-scope: `info` pada keberhasilan checkpoint/use case dan `error` tersanitasi pada kegagalan dependency; reason seperti missing_config/tax_not_found/rate_mismatch untuk diagnosis aman di message. Jangan meneruskan logger/requestId melalui parameter atau mencetak payload/PII/token.

## 6. Rancangan teknis tingkat file

Seluruh path relatif root repo. Blueprint ini termasuk dalam complete spec yang disetujui; file baru adalah rancangan implementasi, bukan klaim sudah ada. Perubahan hanya pada call chain pajak; tidak memindahkan seluruh route besar atau refactor domain lain.

| Path | Aksi / tanggung jawab | Layer | Public seam / test |
| --- | --- | --- | --- |
| `apps/store/src/features/checkout/jubelio-tax-config-repository.ts` | Baru; baca dua key config secara ketat melalui DB app, tanpa fallback cache | repository | `apps/store/src/features/checkout/prepare-checkout-tax-service.test.ts` + integration checkout |
| `apps/store/src/features/checkout/prepare-checkout-tax-service.ts` | Baru; validasi config/master/rate dan hasilkan immutable tax context sebelum pricing baru | service | `apps/store/src/features/checkout/prepare-checkout-tax-service.test.ts` baru |
| `apps/store/src/lib/jubelio-sales-client.ts` | Tambah GET taxes berpagination memakai transport existing; create/GET/invoice/edit version-aware signed ID dan tax money | client | `apps/store/src/lib/jubelio-sales-client.test.ts` |
| `packages/db/src/provider-tax.ts` | Baru; alokasi exact tax whole-line setelah net final, dipakai builder/evaluator dan validasi snapshot | pure domain | `packages/db/src/provider-tax.test.ts` baru |
| `packages/db/src/versioned-pricing.ts` | Builder/read/decode provider2/3, provider payable dan integrity tax snapshot | pure domain | `apps/store/src/lib/versioned-pricing.test.ts` |
| `packages/db/src/discount-pricing.ts` | Propagasi tax context dan realokasi sesudah benefit final | pure domain | `packages/db/src/discount-pricing.test.ts` |
| `packages/db/src/schema/orders.ts` | Union pricing snapshot provider2/3 dan constraint versi; jangan ubah rows existing | schema owner | `packages/db/src/pricing-snapshot.db.test.ts` |
| `packages/db/src/schema/jubelio-sales.ts` | Union create intent provider3 dengan tax context; preserve unversioned/v2 | schema owner / stored contract | `apps/store/src/lib/jubelio-sales-expected.test.ts` |
| `packages/db/src/schema/checkout.ts` | Review nested snapshot typing/promotable contract tanpa mengubah lifecycle existing | schema owner | `apps/store/src/features/checkout/checkout-attempt-repository.db.test.ts` |
| `packages/db/src/schema/system.ts` | Dokumentasikan known key baru; tidak menambah tabel/kolom config | schema owner | Seed/config integration |
| `packages/db/src/seed.ts` | Seed key pengembangan-2 dan fixture kompatibilitas lama/baru; urutan FK existing dipertahankan | seed | DB reset/seed pada DB disposable |
| `packages/db/drizzle/` | Generated migration untuk constraint versi bila schema berubah; nama dihasilkan tool, tidak ditulis manual | generated schema audit | DB constraint tests |
| `apps/store/src/lib/offer-pricing.ts` | Jangan hilangkan tax context ketika rebuild benefit | pure adapter | `apps/store/src/lib/versioned-pricing.test.ts` dan checkout integration |
| `apps/store/src/app/api/checkout/preview/route.ts` | Wire preflight service, final tax snapshot dan HTTP failure; tidak menambah query ke route | HTTP adapter | `e2e/store/checkout-review-mock.spec.ts` |
| `apps/store/src/lib/checkout-delivery-review.ts` | Preview delivery membawa tax context dan mapping final setelah benefit | service existing | `e2e/store/versioned-checkout-mock.spec.ts` |
| `apps/store/src/app/api/checkout/place-order/route.ts` | Preflight writer baru setelah replay lookup; bangun intent dari tax snapshot, jangan query config langsung | HTTP adapter existing | `apps/store/src/app/api/checkout/place-order/route.test.ts` |
| `apps/store/src/lib/checkout-review.ts` | Bind provider tax identity/rate pada review fingerprint, preserve old-attempt replay | pure signing contract | `apps/store/src/lib/checkout-review.test.ts` |
| `apps/store/src/features/checkout/place-order-service.ts` | Preserve provider3 snapshot reserve→SO→Midtrans→promotion, tanpa new master lookup saat replay | service | `apps/store/src/features/checkout/checkout-attempt-repository.db.test.ts` |
| `apps/store/src/lib/jubelio-sales-expected.ts` | Paired-record authority0/2/3; tax identity/allocations/payable wajib cocok | pure decoder | `apps/store/src/lib/jubelio-sales-expected.test.ts` |
| `apps/store/src/lib/jubelio-sales-lifecycle.ts` | Invoice/payment authority dan line tax checks provider3, preserve legacy branches | service existing | `apps/store/src/lib/jubelio-sales-versioned.db.test.ts` |
| `apps/store/src/lib/jubelio-channel-mirror.ts` | Preserve tax pada semua full-payload marker stages, no broad guard removal | service existing | `apps/store/src/lib/jubelio-channel-mirror.test.ts` dan `apps/store/src/lib/jubelio-channel-mirror.db.test.ts` |
| `apps/store/src/app/checkout/page.tsx` | Tangani error pajak inline sebelum payment, reuse layout/review existing | UI | `e2e/store/checkout-review-mock.spec.ts` |
| `apps/store/src/components/checkout/CheckoutTaxFeedback.tsx` | Baru; error preflight tanpa memalsukan durable checkout attempt | UI | `e2e/store/checkout-review-mock.spec.ts` |
| `apps/admin/src/app/api/admin/orders/[id]/route.ts` | Audit compatibility shared reader; ubah hanya bila narrowing provider2 menghalangi3; permission/scope tidak berubah | HTTP adapter | Existing admin order tests + admin typecheck |
| `.env.example`, `deployment/staging/.env.example`, `deployment/production/.env.example` | Jelaskan env tax ID lama bukan authority provider3; DB config prerequisite dan fail-closed, tanpa menaruh credentials | config examples | Review parity deployment docs |
| `docs/features/jubelio-sales-orders.md`, `docs/features/versioned-checkout-pricing.md`, `docs/jubelio-api/README.md`, `docs/api-reference.md`, `docs/deployment-docs/jubelio-sync.md`, `docs/README.md` | Kontrak baru, response error, compatibility, config/cutover dan evidence | dokumentasi enduring | Link/consistency review |

### Kontrak export yang direncanakan — tanpa body implementasi

- Repository baru: `readCheckoutTaxConfig(database?): Promise<CheckoutTaxConfig>`; `CheckoutTaxConfig` membawa `taxId:number` dan `ppnRatePercent:string` yang strict; database default app-local.
- Service baru: `prepareCheckoutTax(input?: { database?: CheckoutTaxDatabase; salesGateway?: Pick<JubelioSalesGateway, "getTaxRecord"> }): Promise<ValidatedProviderTax>`; typed failure `CheckoutTaxUnavailableError` dengan safe internal reason. Tidak menerima Request/logger/requestId.
- Gateway: `getTaxRecord(taxId:number): Promise<JubelioTaxRecord | null>`; DTO minimal tax identity, canonical rate, output account availability. Tambahan tidak mengekspor raw master/customer response.
- Pure module baru: `allocateProviderTax(input: { lines: readonly { variantId:string; netLineAmount:string }[]; ppnRatePercent:string; ppnAmount:string }): readonly { variantId:string; providerTaxAmount:string }[]`.
- Schema: `ValidatedProviderTax = { taxId:number; ratePercent:string }`; shared schema tidak mengimpor tipe app. Pricing union provider3 mewajibkan `providerTax` dan per-line `providerTaxAmount`; create intent3 mewajibkan frozen tax context dan tax amount per line.
- Builder: `buildPricingSnapshot(input: BuildPricingSnapshotInput): PricingSnapshot` dengan input tax context baru; `evaluatePricing(input: EvaluatePricingInput): PricingSnapshot` meneruskan konteks tersebut. Decoder `decodePricingSnapshot(payload:unknown)` dan `readOrderPricing(row:PersistedOrderPricingRow)` mempertahankan signature, return union meluas.
- Authority: `readJubelioSalesOrderExpectation(payload:unknown)` dan `readSettlementAuthorityRecord(input:{ createPayload:unknown; orderRow:PersistedOrderPricingRow })` return union0/2/3; versi0/2 tidak diinterpretasi ulang.
- Create/edit/invoice gateway tetap menggunakan method existing; tipe expected envelope dan invoice line diperluas untuk tax identity/nominal. Invoice/payment endpoint dan method bisnis tetap, bukan endpoint baru.
- Review: `CheckoutReviewPricing` menambah tax snapshot minimal untuk fingerprint provider3; fungsi signing/verifying existing mempertahankan call shape dengan tipe context yang meluas.
- UI baru: `CheckoutTaxFeedback({ message:string; busy:boolean; onReviewAgain:()=>void })`; error preflight bukan `CheckoutAttemptResult` palsu.

### Alasan struktur

- Tax preflight dipisahkan dari transport dan query karena mengoordinasikan config DB dengan master provider serta equality rate. Repository bukan pass-through CRUD, melainkan strict pair read tanpa fallback existing.
- Gateway taxes memakai auth/scheduler Sales existing; tidak menambah token store, HTTP client generik, atau retry layer lain.
- Alokasi/decode money tetap pure di package DB agar reader admin/store satu aturan; package tidak mengambil runtime DB app.
- `CheckoutTaxFeedback` memisahkan preflight tanpa attempt dari feedback attempt durable existing. Reuse tokens/Button/pattern, bukan membentuk attempt palsu agar bisa memakai komponen lama.
- Tidak menaikkan pricing engine versi hanya karena payable provider berubah; provider3 dan discriminated snapshot mengisolasi perubahan tersebut. Bila discovery menemukan incompatibility yang membutuhkan versi harga baru, kembalikan ke review spec, jangan diam-diam mengganti versi.

## 7. Rancangan UX

### Flow dan referensi

- **Halaman:** store `/checkout`, tahap review sebelum redirect Midtrans; berlaku pickup/delivery. Tidak ada halaman atau menu admin baru.
- **Referensi existing:** section **Rincian Pembayaran** dan flow **Periksa ulang pesanan** pada `apps/store/src/app/checkout/page.tsx`; feedback inline `apps/store/src/components/checkout/CheckoutAttemptFeedback.tsx` menjadi referensi style/semantik, bukan model state preflight.
- **Hierarchy:** rincian barang/PPN/ongkir dan total tetap; satu aksi pembayaran existing hanya aktif ketika review valid. Pada error tax, satu aksi **Periksa ulang pesanan**; jangan menampilkan tombol “lanjut tanpa pajak”.

| Elemen | Reuse / baru | Path | Ketentuan |
| --- | --- | --- | --- |
| Breakdown barang/PPN/ongkir/total | Existing | `apps/store/src/app/checkout/page.tsx` | Urutan dan formatting Rupiah tidak diubah; tidak ada PPN kedua |
| Tombol | Existing shared | `packages/ui/src/components/ui/button.tsx` | Import `@/components/ui/button` melalui alias pada `apps/store/tsconfig.json`; varian/spacing/focus mengikuti checkout |
| Feedback pajak preflight | Baru dengan pattern existing | `apps/store/src/components/checkout/CheckoutTaxFeedback.tsx` | `role:alert`, text dan action jelas, fokus setelah gagal |
| Feedback attempt processing/manual review | Existing | `apps/store/src/components/checkout/CheckoutAttemptFeedback.tsx` | Tetap source status durable; jangan diarahkan membuat attempt baru |

State matrix dan copy final yang diusulkan:

| State di `/checkout` | Copy / tampilan | Aksi |
| --- | --- | --- |
| Idle / review valid | Breakdown existing, PPN sekali, total existing | Tombol konfirmasi/payment existing |
| Loading review/retry | **“Memeriksa…”** | Disable duplicate submit |
| Config/tax/rate tidak sesuai | **“Checkout belum dapat diproses karena konfigurasi pajak belum sesuai. Silakan coba lagi nanti.”** | **Periksa ulang pesanan**; payment disabled; form/cart/promo dipertahankan |
| Review stale akibat tax context berubah | **“Rincian pesanan berubah. Periksa kembali sebelum membayar.”** | **Periksa ulang pesanan**; perlu approval review baru |
| Retry berhasil | Feedback error hilang; breakdown valid terlihat | Customer kembali mengonfirmasi, tidak auto-submit/payment |
| Attempt sudah processing/manual review | Copy/status existing dari attempt, bukan tax-preflight banner | Periksa status checkout existing; tidak create ulang |
| Empty cart / belum login / akses tidak sah | Perilaku existing | Tidak diubah spec ini |
| Unsaved form | Input existing tetap ada | Tidak menambah autosave/config form |

- Target viewport320–390px mobile dan1280px desktop, light/dark mengikuti tokens; banner/action tidak overflow atau menutupi rincian total.
- Keyboard: feedback dapat difokuskan setelah failure, action Button native, disabled/busy jelas, status tidak hanya warna. Tidak menaruh tax ID/account internal pada copy customer.
- Tidak ada prototype yang diminta. Review rendered UI dan peer-pattern comparison tetap wajib saat implementasi; passing click test saja tidak cukup.

## 8. Acceptance criteria dan keputusan testing

Public seams utama: **preview/place checkout → provider gateway mock → invoice/payment lifecycle**, ditambah browser checkout. Pure money dan stored decoder mendapat tests terfokus karena rounding/version integrity sulit dibuktikan hanya lewat browser. Seams ini mengikuti perilaku yang digrill: sama total, old-order compatibility, dan blokir sebelum payment; telah disetujui sebagai bagian complete spec pada 2026-10-26, tetapi bukan dianggap sudah ditest.

1. Key-2 valid + website11/master11 menghasilkan provider3, tax line/header benar, total customer/provider sama; Midtrans item details menjumlah ke total yang sama tanpa PPN kedua.
2. ID negatif existing diterima, positive ID valid juga bisa;0,missing,null,string pada intent,pecahan,overflow dan ID tidak ada ditolak. Raw DB text diparse sesuai aturan config, bukan coercion intent.
3. Config DB unavailable/malformed atau taxes GET failure/duplicate record/rate mismatch menghasilkan503/copy yang disepakati; **tidak ada provider business POST/Midtrans baru atau hold/promo/cart mutation**.
4. Kesetaraan rate menerima canonical equivalent `11`, `11.00` dari sumber yang sah; `11` versus `12` ditolak, tanpa fallback rate/default atau auto-reprice.
5. Semua worked money examples §5.3 mendapat literal expected tests: qty2, diskon, shipping/subsidy, multi-line rounding, net0 dengan shipping positif. Jumlah tax line harus tepat ppnAmount; urutan input tidak mengubah alokasi per variant.
6. Builder/evaluator tidak kehilangan tax context setelah Offer berubah. Review fingerprint berubah ketika tax identity/rate/provider version berubah, walaupun total kebetulan sama; stale approval tidak dipakai membayar.
7. Order/attempt v0/v2 existing resume, invoice/payment, cancel dan mirror tetap memakai snapshot lama walaupun key baru hilang/rate berubah/provider taxes outage. Test campuran versi/intent/order mismatch menahan write tanpa fallback.
8. GET SO/invoice memeriksa signed tax ID, tax amount line/header, quantities/prices/discounts/mode, total dan linkage. Header benar tetapi line salah harus gagal. Invoice payment111000/due0 membuktikan lunas walau SO is_paidnull.
9. Paid order dengan invoice/payment mismatch atau timeout mempertahankan paid dan returned IDs, fulfillment tertahan/manual review, tidak membuat write kedua. Concurrent duplicate request/webhook tidak menggandakan SO/invoice/payment.
10. Full-payload marker edits sebelum/sesudah invoice/payment mempertahankan pajak/detail/linkage dan money; ubah marker saja. Verifier unknown/mixed version tetap fail closed.
11. Shared admin reader menerima order0/2/3; view order lama tidak gagal, Branch Scope/permission tidak berubah. Jangan mengubah auth/session boundary.
12. E2E mock checkout membuktikan total unchanged, error inline jelas, payment tidak terbuka saat invalid tax, retry tidak menggandakan submit, dan form/promo/cart dipertahankan.
13. DB tests membuktikan kombinasi versi baru diterima dan unknown/mixed ditolak, promotion attempt tidak membuang frozen tax snapshot; reset/seed DB disposable tetap bekerja.
14. Documents/config templates menjelaskan source DB, fail-closed, compatible readers dan rollback; tidak ada sandbox credential/PII/response customer raw dalam log/evidence.

### Test prior art dan target file

- Config/service: `apps/store/src/features/checkout/prepare-checkout-tax-service.test.ts` baru; DB integration pada `apps/store/src/features/checkout/checkout-attempt-repository.db.test.ts`.
- Pure money/rounding: `packages/db/src/provider-tax.test.ts` baru, `packages/db/src/discount-pricing.test.ts`, `apps/store/src/lib/versioned-pricing.test.ts`.
- Gateway/decoder: `apps/store/src/lib/jubelio-sales-client.test.ts`, `apps/store/src/lib/jubelio-sales-expected.test.ts`.
- Lifecycle/mirror: `apps/store/src/lib/jubelio-sales-versioned.db.test.ts`, `apps/store/src/lib/jubelio-sales-settlement.test.ts`, `apps/store/src/lib/jubelio-channel-mirror.test.ts`, `apps/store/src/lib/jubelio-channel-mirror.db.test.ts`.
- Review/browser: `apps/store/src/lib/checkout-review.test.ts`, `apps/store/src/app/api/checkout/place-order/route.test.ts`, `e2e/store/checkout-review-mock.spec.ts`, `e2e/store/versioned-checkout-mock.spec.ts`, `e2e/store/versioned-settlement-mock.spec.ts`. Extend specs yang sudah diikutkan `playwright.mock.config.ts`; jika kelak perlu spec baru, registrasikan `testMatch` eksplisit.
- Constraints: `packages/db/src/pricing-snapshot.db.test.ts`; admin compatibility lewat endpoint/order reader existing dan admin typecheck.

Tests ditulis RED dahulu, satu vertical slice; nilai expected dari contoh literal di spec, bukan hasil function/provider response yang sama. Mock hanya boundary HTTP/DB/payment; jangan test private helpers atau merusak public seam untuk membuat test hijau.

### Verification ladder saat implementasi

- L0 per slice: `npm run verify:types:store`; tambahkan `npm run verify:types:admin` untuk perubahan shared pricing/schema/reader.
- L1 per slice: `npm run verify:unit:slice -- <explicit paths dari target file di atas yang disentuh slice>`. Isi daftar konkret pada catatan slice; placeholder ini bukan command yang diklaim telah berjalan.
- L2 per batch: `npm run verify:batch:unit` dan `npm run verify:batch:e2e -- e2e/store/checkout-review-mock.spec.ts e2e/store/versioned-checkout-mock.spec.ts e2e/store/versioned-settlement-mock.spec.ts` untuk batch yang menyentuhnya.
- L3 sebelum commit/PR/integrasi: full unit dan suite yang diwajibkan repo. Legacy `npm run test:e2e` tetap membutuhkan izin terpisah; jangan memicu provider nyata dari verification lokal.
- Main agent memeriksa rendered checkout/states, membandingkan pattern, mencatat evidence dan blocker. Reports/artifacts Playwright di `playwright/`; diagnosis failure dari Markdown, bukan membuka screenshot gagal.
- Capture output bounded di log luar repo; catat summary PASS/FAIL dan jangan mengulang suite yang sudah PASS tanpa perubahan yang relevan.

## 9. Urutan implementasi dan aktivasi yang diusulkan

Ini urutan internal, **bukan publikasi breakdown tickets**.

1. Tambah strict config/tax lookup dan pure tax allocation, dengan RED→GREEN tests; belum mengaktifkan writer.
2. Tambah schema/paired reader provider3 dan migration audit, jaga decoder0/2, propagation promo serta admin compatibility.
3. Wire preview/place tax context dan immutable attempt/intent, create/GET tax authority, error UX; tests memastikan tidak ada payment sebelum valid SO.
4. Invoice/payment/mirror provider3 dengan old-order tests dan at-most-once/investigation protections.
5. Jalankan batch integration/UX, perbarui docs/API/deployment guidance, review terhadap complete spec.
6. Aktivasi hanya setelah readers compatible dan schema siap; DB config tenant diverifikasi, kemudian writer baru digunakan. Jangan otomatis mengganti key/config data existing pada startup tanpa prosedur operational yang disetujui.

Generated migration memakai `npm run db:generate`; dev schema sync memakai `npm run db:push`, bukan `db:migrate`. Tidak mengedit generated SQL tangan. Schema tables hanya di `packages/db/src/schema/`; update seed sesuai FK. Dokumentasi cutover mencatat backup, reader-before-writer, drain/check in-flight attempts, serta old-order compatibility.

Rollback tidak boleh mengembalikan binary yang tidak memahami provider3 selama record3 masih ada. Menahan checkout baru lebih aman daripada menyamarkan record3 sebagai2; operasi existing tetap memakai compatible reader/snapshot. Deployment/SSH/restart/DB config operational aktual memerlukan izin eksplisit terpisah.

Context7 checkpoint: **belum dijalankan untuk implementasi**, karena sesi ini hanya menyusun Markdown, tidak menulis API library. Sebelum kode slice pertama, resolve/query versi installed yang disentuh (Drizzle, Next.js, Zod, Vitest/Playwright) dan catat library ID/signature yang dikonfirmasi. Bila tools tidak tersedia, baca installed types/source atau vendor docs dan nyatakan fallback. Jangan menganggap schema Jubelio menggantikan pemeriksaan API framework.

## 10. Discovery dan blocker sebelum Ready/aktivasi

Tidak ada pertanyaan produk baru yang sengaja disisipkan: lima keputusan grilling menjadi dasar. Hal berikut adalah gap teknis/evidence yang harus terlihat, bukan asumsi terselesaikan.

| Item | Cara menutup / batas |
| --- | --- |
| Approval complete spec dan seams/copy/versi/alokasi | Terpenuhi 2026-10-26 melalui “oke sudah saya setujui specnya”; lihat bagian Approval. Bukan evidence implementasi atau izin provider write baru |
| Provider rounding multi-line/diskon/ongkir dan full-payload mirror ber-tax | HTTP mock tests membuktikan kontrak aplikasi; aktivasi membutuhkan bukti provider yang relevan atau konfirmasi vendor. Usulkan protokol sandbox/budget terpisah untuk gap tersebut; **spec ini tidak memberi izin POST tambahan**. Jika provider menghitung ulang berbeda, kembali ke keputusan/spec, jangan mengubah pajak customer diam-diam |
| Audit seluruh caller pure builder/discount evaluator dan type narrowing provider2 | Discovery implementasi pada path yang tercantum; jika perlu modul/entry point baru di luar blueprint, laporkan dan perbarui spec sebelum perluasan scope |
| Seeder/DB operational activation mechanism | Tentukan insert/upsert key yang aman melalui mekanisme repo existing; jangan hand-edit generated migration atau menjalankan seed penuh operational. Catat exact path artefak config-data bila memang diperlukan |
| Gate writer aktif dan DB constraint baseline | Periksa environment target saat aktivasi yang diotorisasi; tidak menganggap workspace lokal sama dengan staging/production |
| Worktree paralel sudah dirty | Terutama checkout route/page dan shared docs; integrasikan tanpa menimpa perubahan task stok/harga lain. Tidak memasukkan file unrelated ke commit |

Gate complete-spec approval telah terpenuhi. Gap provider evidence tetap harus ditutup sebelum klaim siap aktivasi; Ready pada index bukan berarti runtime siap production. Tidak menambah scope audit jurnal pajak legal/UI atau operasi production secara implisit.

## 11. Di luar scope

- Reprice/edit/refund pajak order lama, backfill finansial, atau memperbaiki transaksi existing yang blocked.
- Menu admin pengaturan pajak, CRUD tax master Jubelio, perubahan rate hukum, PPh/withholding atau pemilihan pajak per SKU/kategori/customer.
- Mengubah harga customer, formula PPN barang/ongkir, stacking Offer, service fee, atau kewajiban mendukung payment0.
- Tax-inclusive, multi-rate per order, e-Faktur/Coretax, audit jurnal pajak UI dan compliance legal.
- Mengganti payment account/type production mengikuti sandbox, refund/reversal/cancel post-invoice.
- Refactor massal checkout, auth/RBAC, redesign halaman lain, deploy/restart/SSH atau subagents/commit/push tanpa izin terpisah.

## 12. Catatan akhir dan retirement

Hasil sesi ini hanya spec dan index. Tidak ada kode/schema/config/seed yang diubah, tidak ada request Jubelio baru, tidak ada tests/build/typecheck aplikasi yang dijalankan. Bukti vendor di §3 berasal dari pengujian yang sudah dilaporkan, bukan run baru saat drafting.

Saat implementasi kelak selesai: simpan spec ini di `plan/`; catat Done beserta tanggal/evidence hanya pada index fitur; rangkum kontrak enduring ke docs yang ditentukan; pertahankan evidence dan compatibility notes. Jangan menghapus spec atau menganggap Draft sebagai task siap agent.
