# Hasil matriks field diskon dan ongkir item157190

## Ringkasan

Pada2026-10-18 sekitar10:17–10:28UTC, main agent menjalankan protokol yang disetujui pemilik: maksimum10 kasus invoice-only, tanpa mirror/payment/cancel/retry. Fase awal berhenti diH sesuai global stop; pemilik kemudian mengizinkan I/J, agent berhenti lagi setelah I gagal, lalu pemilik memberi izin khusus J. **Seluruh A–J kini sudah dijalankan: A–G menghasilkan7 invoice terverifikasi; H/I/J menghasilkan SO tetapi conversion HTTP500/code23113.**

Pembanding terkuat: D/E/H memakai item/lokasi/harga/qty/diskon barang/net ongkir/grand yang sama. Request D menghilangkan shipping_cost_discount, E mengirim0, H mengirim20000. D/E berhasil invoice, H gagal23113. Jadi nonzero shipping_cost_discount merupakan **kandidat pemicu kondisional pada envelope ini**, bukan diskon barang integer semata atau kewajiban mengirim original_shipment_cost agar error terjadi. Akar jurnal/account mapping dan kontrak gross/net shipping tetap belum diketahui.

## Sumber primer dan otorisasi

- [Protokol lengkap dan approval](research-08-field-matrix-protocol.md).
- [Journal runtime A–H](research-08-field-matrix-results.json), [journal I/checkpointJ](research-08-field-matrix-ij-results.json), [journal J](research-08-field-matrix-j-results.json), dan [laporan kelanjutan I/J](research-08-field-matrix-ij-evidence.md). Journal awal tidak ditimpa; not-run pada snapshot awal bukan status final I/J.
- [Identitas produk dan baseline stock](research-08-field-matrix-item157190.json).
- [Vendor invoice-only](../../docs/jubelio-api/dist.yaml#L9248), [request/response](../../docs/jubelio-api/dist.yaml#L26987).

Semua output adalah proyeksi allowlist; bukan raw full request/response. Credentials/token/customer PII tidak disimpan. Identitas dummy dibaca in-memory. Label ref baru percase membedakan fixtures; tanggal/IDs/ref berbeda antarkasus, bukan request ulang SO yang sama.

## Konstanta

SKU/item157190, product group55269 **Celana Okcir Bagus**, location2, qty1/unit Buah, price1000000, source1 INTERNAL, dummy contact116918, NoTax1/rate0, tanpa fee/insurance/add_disc/PPN. Tidak ada mirror, jadi semua SO memakai marker Belum Bayar saat conversion.

Diskon barang aktif: `disc:10`, `disc_amount:100000`, line amount900000. Tidak ada fractional percentage atau rounding. Inactive: disc0/disc_amount0, line amount1000000. Total expected dihitung independen sebagai net barang + net shipping yang dikirim; tidak dihitung dari response.

## Tabel hasil

OMIT berarti field tidak ada di actual request, bukan null/empty string/0. Semua10 create yang dijalankan HTTP200, GET uang/identity cocok.

| Kasus | Diskon barang | shipping_cost | original_shipment_cost | shipping_cost_discount | Grand expected/GET SO | SO | Hasil invoice |
| --- | --- | --- | --- | --- | --- | --- | --- |
| A | 0 | 0 | OMIT | OMIT | 1000000 | 68426 | HTTP200; invoice45958, GET/linkage/money cocok |
| B | 100000/10% | 0 | OMIT | OMIT | 900000 | 68427 | HTTP200; invoice45959, GET/linkage/money cocok |
| C | 0 | 10000 | OMIT | OMIT | 1010000 | 68428 | HTTP200; invoice45960, GET/linkage/money cocok |
| D | 100000/10% | 10000 | OMIT | OMIT | 910000 | 68429 | HTTP200; invoice45961, GET/linkage/money cocok |
| E | 100000/10% | 10000 | OMIT | **0** | 910000 | 68430 | HTTP200; invoice45962, GET/linkage/money cocok |
| F | 100000/10% | **OMIT** | OMIT | OMIT | 900000 | 68431 | HTTP200; invoice45963, shipping default0, GET/linkage/money cocok |
| G | 100000/10% | 10000 | **30000** | OMIT | 910000 | 68432 | HTTP200; invoice45964, GET/linkage/money cocok; original shipment field tidak tersedia di invoice GET |
| H | 100000/10% | 10000 | OMIT | **20000** | 910000 | 68433 | **HTTP500/code23113**, tanpa invoice ID |
| I | 0 | 10000 | 30000 | 20000 | 1010000 | 68434 | **HTTP500/code23113**, tanpa invoice ID; dijalankan setelah izin kelanjutan |
| J | 100000/10% | 10000 | 30000 | 20000 | 910000 | 68435 | **HTTP500/code23113**, tanpa invoice ID; dijalankan setelah izin khusus pascaI |

A–G invoice GET dan SO GET mempertahankan line/header uang yang diwajibkan serta linkage tepat. Invoice GET payment_amount0 dan filtered invoice list due masing-masing sebesar grand; ketujuh invoice **belum dibayar**, bukan settlement lengkap sampai payment.

G membuktikan create/conversion tetap dapat berhasil dengan original_shipment_cost30000 pada SO tanpa shipping_cost_discount nonzero. Original shipment cost masih tersimpan pada SO GET setelah conversion, tetapi field tersebut **tidak tersedia pada invoice GET**, sehingga preservation metadata itu di invoice internal tidak dianggap terbukti.

## Input/output pembanding D, E, H

### Input D — diskon barang + net ongkir, tanpa metadata subsidi

Potongan actual POST `/sales/orders/` D:

```json
{
  "salesorder_id": 0,
  "source": 1,
  "location_id": 2,
  "sub_total": 1000000,
  "total_disc": 100000,
  "total_tax": 0,
  "shipping_cost": 10000,
  "grand_total": 910000,
  "items": [
    {
      "item_id": 157190,
      "qty_in_base": 1,
      "price": 1000000,
      "disc": 10,
      "disc_amount": 100000,
      "amount": 900000,
      "tax_id": 1,
      "tax_amount": 0,
      "unit": "Buah",
      "location_id": 2,
      "salesorder_detail_id": 0
    }
  ]
}
```

Ini bukan full payload: required identity/tanggal/no/ref dan zero fee fields tidak semua ditampilkan pada snippet. Full financial projection tersimpan pada journal. D **tidak mengirim** original_shipment_cost atau shipping_cost_discount.

Create HTTP200/id68429. Conversion:

```http
POST /sales/packlists/create-invoice
```

```json
{"salesorder_id":68429}
```

Proyeksi response HTTP200:

```json
{"id":45961,"status":"ok"}
```

Proyeksi GET `/sales/invoices/45961`:

```json
{
  "invoice_id": 45961,
  "salesorder_no": "SO-000068429",
  "sub_total": "1000000.0000",
  "total_disc": "100000.0000",
  "shipping_cost": "10000.0000",
  "shipping_cost_discount": "0.0000",
  "grand_total": "910000.0000",
  "payment_amount": "0"
}
```

Perhatikan shipping_cost_discount muncul sebagai default0 di response walaupun tidak dikirim pada D. Karena itu field presence actual input harus dibedakan dari GET.

### Input E — key diskon ongkir explicit0

Financial payload sama dengan D, dengan satu tambahan:

```json
{"shipping_cost_discount":0}
```

Create68430 dan conversion invoice45962 sama-sama HTTP200; GET menunjukkan grand910000, shipping_cost10000, shipping_cost_discount0. Jadi **keberadaan key dengan nilai0 tidak memicu error** pada kasus ini.

### Input H — key diskon ongkir nonzero20000

Financial payload sama dengan D, dengan satu tambahan:

```json
{"shipping_cost_discount":20000}
```

Original_shipment_cost tetap tidak dikirim. Create HTTP200/id68433, GET mempertahankan shipping_cost10000, shipping_cost_discount20000 dan grand910000. Conversion aktual:

```http
POST /sales/packlists/create-invoice
```

```json
{"salesorder_id":68433}
```

Ringkasan journal, **bukan raw response body**:

```json
{"http":500,"errorCode":"23113"}
```

Kode23113 dipetakan vendor menjadi `journal_unbalance`. Tidak ada invoice ID pada response. Tidak mencoba payment, endpoint alternatif, retry atau cancellation untuk SO ini.

## Reconciliation dan side effects

GET SO68433 setelah error: invoice_idnull, is_canceled/is_paidnull, grand910000, shipping_cost10000/shipping_cost_discount20000, original_shipment_costnull, marker Belum Bayar. Absence invoice ID bukan proof rollback conversion.

Filtered lists dengan label dummy dan pagination lengkap menurut totalCount:

- Invoice list10 rows/totalCount10: tiga invoice lama45951/45952/45953 dan tujuh invoice baru45958–45964 yang linked ke SO68426–68432. Tidak terlihat invoice untuk68433 pada filter ini.
- Payment list3 rows/totalCount3: IDs40/42/44, sama dengan baseline. Tidak ada payment baru terlihat pada filter ini.
- Coverage hanya untuk endpoint/filter tersebut, bukan audit semua state internal provider.

Setelah izin kelanjutan, GET I/SO68434 dan J/SO68435 juga menunjukkan invoice_idnull, is_canceled/is_paidnull, serta nominal masing-masing1010000/910000 tetap. Reconciliation filtered lists setelah I/J tetap invoice10/totalCount10 dan payment3/totalCount3, tanpa artefak baru terlihat untuk I/J. Ini bukan proof rollback kedua conversion. [Detail input/output I/J](research-08-field-matrix-ij-evidence.md).

Stock157190/location2 berubah:

| Waktu | on_hand | on_order | available |
| --- | --- | --- | --- |
| Baseline sebelum A | 21 | 1 | 20 |
| Setelah G/sebelum H | 14 | 1 | 13 |
| Reconciliation setelah H | 14 | 2 | 12 |
| Reconciliation setelah I | 14 | 3 | 11 |
| Reconciliation setelah J | 14 | 4 | 10 |

Tujuh invoice baru mengurangi on_hand7 menurut observasi; masing-masing create H/I/J menambah on_order1 dan mengurangi available1. Existing on_order baseline1 tidak disentuh oleh agent. Tidak ada adjustment/cancel untuk mengembalikan stock. SO68433/68434/68435 tetap fixtures investigasi; manual UI/audit disposition diperlukan sebelum cleanup/write berikutnya.

## Kesimpulan dan remaining unknowns

**Terbukti pada envelope yang diuji:**

1. Diskon barang integer10%/100000 dapat diteruskan sampai invoice tanpa ongkir (B/F) maupun dengan net shipping10000 (D).
2. Ongkir10000 saja tanpa metadata subsidi dapat diteruskan sampai invoice (C/D).
3. shipping_cost omitted atau explicit0 sama-sama berhasil untuk kasus barang berdiskon (B/F).
4. shipping_cost_discount omitted atau explicit0 sama-sama berhasil (D/E).
5. original_shipment_cost30000 tanpa diskon ongkir nonzero tidak menghalangi conversion (G), tetapi field metadata tidak tersedia pada invoice GET.
6. Menambahkan **shipping_cost_discount20000** pada financial payload D menghasilkan SO tersimpan tetapi **conversion23113** (H), bahkan tanpa original_shipment_cost dan tanpa mirror.
7. Subsidi dengan original30000/nonzero discount20000/net shipping10000 tetap conversion23113 ketika diskon barang0 (I), sehingga diskon barang tidak diperlukan agar error muncul pada varian ini.
8. G versus J memakai original30000, diskon barang100000, shipping10000/grand910000 yang sama: G shipping_cost_discount omitted berhasil invoice45964; J menambah20000 dan gagal23113. Original shipment metadata tidak menghindari failure nonzero shipping discount pada pembanding tersebut.

**Belum terbukti:**

- Mekanisme internal journal error: apakah shipping_cost harus gross, provider mengurangkan discount lagi, atau account/default journal treatment tertentu diperlukan. Jangan memilih satu dugaan sebagai fakta atau memperbaiki config tanpa izin.
- Semua nilai nonzero/semua sources/endpoints/tax/qty, atau causal universal dari satu fixture failure.
- Outcome internal conversion H/I/J tetap unknown walaupun ketiga kasus sekarang sudah dijalankan; tidak ada invoice ID pada response dan tidak terlihat invoice terkait pada filtered lists, bukan proof rollback.
- Payment preservation untuk ketujuh invoice baru; sengaja tidak diuji karena scope invoice-only.
- Outcome internal conversion H dan disposition fixtures ambigu sebelumnya; tidak ada rollback proof atau cleanup selesai.

**Budget:**10/10 create attempts dan10/10 invoice-only attempts terpakai; kumulatif **33 create attempts**. Semua kasus selesai dieksekusi, bukan semuanya berhasil. Kelanjutan I dan J masing-masing terjadi setelah instruksi/izin pemilik, bukan otomatis melewati stop rule. **Budget habis dan stop business writes aktif**, tanpa retry H/I/J. Penambahan eksperimen atau cleanup memerlukan keputusan dan izin baru.

Tidak ada perubahan aplikasi/schema/master/account mapping/env, unit/E2E/build/lint/typecheck aplikasi, subagent, atau commit. Verifikasi provider dan review journal dilakukan main agent. Tiket08 tetap claimed, tidak otomatis resolved; arah goods-only tidak berubah menjadi approval shipping extended/accounting atau kesiapan launch.

## Follow-up ablation: I/J tanpa shipping_cost_discount

Setelah seluruh A–J, pemilik meminta dua fixtures baru dengan input I/J sama tetapi shipping_cost_discount **benar-benar dihapus**, bukan0. [Protokol dan hasil ablation](research-08-without-shipping-discount.md), [journal](research-08-without-shipping-discount-results.json).

**I-minus SO68436 → invoice45968** berhasil HTTP200/GET verified dengan goods discount0/grand1010000. **J-minus SO68437 → invoice45969** berhasil dengan goods discount100000/grand910000. Original_shipment_cost30000 dan shipping_cost10000 tetap, item/lokasi/price/qty/tax sama; perbedaan financial input dari I/J asli hanya penghilangan key shipping_cost_discount20000. Tidak retry/edit fixtures gagal.

Kedua invoice unpaid; GET mengembalikan shipping_cost_discount0 sebagai default response meskipun omitted pada request. Original shipment metadata masih tersimpan di SO, tidak tersedia pada invoice GET. Perbandingan I versusI-minus dan J versusJ-minus memperkuat kandidat conditional failing request; bukan universal proof field salah atau penjelasan akar accounting/gross-net journal.

Ablation memakai tambahan2/2 create dan2/2 invoice attempts; kumulatif**35 create attempts** pada akhirablation, di luar matriks A–J yang tetap10/10. Stock saat itu157190/location2**on_hand12/on_order4/available8**. Filtered invoice list12/totalCount12, payment list3/totalCount3 tetap. Tidak ada mirror/payment/cancel/retry, cleanup fixtures ambigu lama, perubahan aplikasi/account mapping, validation runs aplikasi, subagent, atau commit.

## Follow-up hipotesis unit persen10/20

Pemilik kemudian mengusulkan unit persen dan menyetujui net shipping konsisten dengan10%/20% dari30000. [Protokol dan hasil](research-08-shipping-percentage.md). P10 field10/net27000/grand927000 **SO68438**, P20 field20/net24000/grand924000 **SO68439**; kedua create/GET berhasil tetapi invoice-only conversion sama-samaHTTP500/code23113. P20 dijalankan setelah izin khusus pasca stopP10, bukan retry.

Tidak ada output independen yang membuktikan unit persen atau amount; GET hanya mempertahankan10.0000/20.0000 dan net/grand yang sudah dihitung di input. Jadi label subsidi20000 dalam matriks ini adalah intended business benefit/candidate mapping, bukan bukti unit field provider. Perbandingan field omitted/0/nonzero tetap bukti input/conversion pada envelope masing-masing, bukan universal unit/causal contract.

Tambahan2/2 attempts, kumulatif terbaru**37 create attempts**; stock157190/location2 akhir12/6/6. Kedua SO invoice_idnull pada reconciliation; filtered invoice/payment lists tetap12/3 artefak dikenal, bukan proof rollback. Tidak ada mirror/payment/cancel/retry atau cleanup otomatis; tidak ada perubahan aplikasi/account mapping, validation runs aplikasi, subagent, atau commit.
