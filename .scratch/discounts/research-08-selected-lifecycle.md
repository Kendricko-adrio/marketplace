# Verifikasi lifecycle mapping terpilih — T1/T2/T3

## Approval dan scope

Pemilik memilih **Setuju, T1–T3 (Recommended)** setelah menerima rincian kasus, endpoint, account/type payment, nominal, side effects, dan global stop. Ini izin API writes **sandbox** pada tiga fixtures baru, bukan implementasi aplikasi atau penutupan tiket otomatis.

Public seams yang diuji: create/edit SO, GET SO, invoice-only conversion/GET invoice, create/GET payment dan association/due, cancel SO eligible/GET cancellation, serta stock lookup. Expected finansial memakai contoh independen di tabel, bukan dihitung dari response. Research probe berurutan satu kasus selesai sebelum kasus berikut; bukan unit/E2E/build/lint/typecheck aplikasi atau red-green implementasi fitur.

Baseline kumulatif37 create attempts. Tambahan maksimal **3 create +3 mirror +2 invoice +2 payment +1 cancel**; auth login dan GET/stock read-only lookup terpisah. Maksimal kumulatif40 create attempts, bukan40 successful SO. Tidak memakai subagent/commit, tidak mengubah aplikasi/schema/master/stock/account mapping/env atau order historis. Tidak memakai endpoint invoice-payment gabungan atau retry write.

## Konstanta dan matriks yang disetujui

SKU157190, group55269 **Celana Okcir Bagus**, location2, unit Buah, price1000000 perunit, source1 INTERNAL, dummy116918, NoTax1/rate0/is_tax_includedfalse. Ongkir sebelum subsidi original_shipment_cost30000, net customer shipping_cost10000; shipping_cost_discount **OMIT** pada create dan mirror. add_disc/tax/add_fee/service_fee/insurance0. Funding merchant/quote/PPN/fee website tetap terpisah sesuai04.

| Kasus | Qty | Gross barang | disc | disc_amount whole-line/total_disc | Net barang | Grand provider | Alur |
| --- | --- | --- | --- | --- | --- | --- | --- |
| T1 | 1 | 1000000 | 10 | 100000 | 900000 | **910000** | Create → full mirror → invoice-only → payment → independent GET/list |
| T2 | 2 | **2000000** | 10 | **200000** | 1800000 | **1810000** | Create → full mirror → invoice-only → payment → independent GET/list |
| T3 | 1 | 1000000 | 10 | 100000 | 900000 | **910000** | Create → full mirror → eligible pre-invoice cancel → GET/stock restore |

T2 membuktikan diskon200000 untuk seluruh baris qty2, bukan dikalikan lagi. Tidak ada rounding/fractional money. Gross T2 mencapai2000000 dan payment1810000 sebagaimana diperlihatkan kepada pemilik sebelum approval. Maksimal4 unit fixtures dapat terpakai/ter-reserve; bila T1/T2 berhasil danT3 canceled, net stock consumed3 unit. Stock terakhir sebelum protokol12/6/6, available6; bukan jaminan current stock, wajib dibaca ulang.

## Endpoint dan input penting

- POST `/login` memakai credentials `.env` yang telah dikonfirmasi sandbox; token hanya in-memory.
- GET dummy/master157190/tax/account lookup, serta filtered invoice/payment lists sebagai baseline. Account2 diverifikasi masih tersedia/readable; tidak mengganti akun otomatis.
- POST read-only `/inventory/items/all-stocks/`, body `{"ids":[157190]}`, sebelum tiap create dan setelah stages yang diperiksa.
- POST `/sales/orders/` untuk create (ID0/no auto), lalu mirror ID/detail asli dari GET. Mirror hanya mengubah marker `Belum Bayar` → `Menunggu Verifikasi`. Semua financial fields/identity/unit/source/original/net dipertahankan, shipping discount tetap absent.
- POST `/sales/packlists/create-invoice`, body `{"salesorder_id":<ID baru>}`, masing-masing satu kali untukT1/T2 setelah pre-read cocok.
- POST `/sales/payments/`, masing-masing satu kali untukT1/T2 setelah invoice terverifikasi: account_id2, payment_type0, payment_id0, payment_no auto, dummy contact/date/ref note, amount910000 atau1810000, satu items association invoice_id dengan payment_detail_id0/payment_amount sama. Ini pencatatan payment di sandbox; tidak ada payment untukT3.
- POST `/sales/orders/cancel/`, body `{"ids":[<ID T3 baru>]}`, hanya sekali untukT3 setelah GET memastikan fixture milik run ini, source/identity/money cocok, aktif, invoice_idnull, tidak paid, dan belum ada invoice/payment dispatch untukT3. Tidak cancel fixtures lain atau post-invoice.

## Gate verifikasi dan stop

1. Master/SKU/price/unit/tax/dummy/account dan stock harus cocok sebelum write; stockavailable minimalqty tiap kasus. Tidak mengganti item/lokasi/akun/nominal bila preflight gagal.
2. Dispatch intent dan counter disimpan sebelum setiap business POST; setiap stage maksimal sekali untuk satu fixture. Response sukses tanpa ID atau gagal membaca body sesudah write dianggap ambigu.
3. Setelah create dan mirror, GET memeriksa SO/contact/ref/source/location, detail IDs, qty/price/whole-line discount/line amount, header totals, original30000/net shipping10000/add_disc0/zero fees/tax. Lokasi baris mendukung alias location_id/loc_id dengan conflict check. Hanya marker yang berubah oleh mirror.
4. Invoice GET dan SO GET wajib membuktikan linkage, money tepat, goods discount dan net shipping; original pada SO cukup sesuai scope approved. Missing original metadata pada invoice GET dicatat sebagai keterbatasan yang diterima, bukan proof metadata hilang atau alasan menebak nilainya.
5. Payment GET wajib membuktikan payment ID/amount/account2/type0, tepat satu association ke invoice/SO run ini, payment_amount/grand tepat dan due0. Invoice GET payment_amount harus sama dengan payable, filtered invoice list due0. Jangan membayar gross barang atau total website yang mengandung PPN/fee.
6. Stock setelah T1/T2 seharusnya on_hand berkurangqty, reservation/on_order kembali ke baseline percase setelah conversion. T3 canceled GET harus is_canceledtrue, invoice_idnull, money/identity terpelihara dan stock kembali baseline sebelum create T3. Ketidakcocokan tetap dicatat sebagai gap; tidak adjustment otomatis.
7. **Global stop** pada HTTP5xx/network/timeout/missingID, mismatch, penolakan tak terduga, atau stock tidak cukup. Tidak otomatis melanjutkan kasus berikut setelah stop. Tidak retry create/mirror/invoice/payment/cancel, bahkan bila response GET pertama gagal.
8. Reconciliation setelah stop hanya GET SO/invoice/payment yang teridentifikasi, filtered lists dengan coverage, dan stock lookup read-only. Jika payment POST punya ID tetapi GET gagal, boleh GET/list untuk reconciliation, bukan POST ulang. Public API absence bukan proof rollback. Kasus sisa memerlukan keputusan lanjut pemilik sesuai kondisi.
9. Invoice/payment sukses ditinggalkan sebagai artefak sandbox; tidak cancel post-invoice. Hanya cancellationT3 yang diizinkan. Unknown/cleanup fixtures legacy tetap terpisah, tidak disentuh.

## Evidence dan acceptance

Journal `research-08-selected-lifecycle-results.json`: case labels, field presence, dispatch intent, HTTP/code, IDs/nominal, hasil independent GET/list/stock, status tiap stage dan stop reason. Allowlist projection, bukan raw full request/response; credentials/token/customer PII tidak dicatat.

Semua bukti dibandingkan dengan [scope08 approved](research-08-approved-proof-scope.md). T1/T2/T3 sukses akan mempersempit gap tetapi tidak otomatis menutup08 atau menyelesaikan complete contract09; main agent harus mereview against scope dan evidence existing dahulu. Tidak ada izin memperluas cases atau melakukan implementasi.

## Referensi

- [Mapping terpilih](research-08-selected-shipping-mapping.md), [scope bukti approved](research-08-approved-proof-scope.md).
- [Ablation berhasil sampai invoice](research-08-without-shipping-discount.md).
- [Vendor invoice-only](../../docs/jubelio-api/dist.yaml#L9248), [payment request](../../docs/jubelio-api/dist.yaml#L27161), [cancel endpoint](../../docs/jubelio-api/dist.yaml#L8824).
- [Client existing payment verification](../../apps/store/src/lib/jubelio-sales-client.ts#L1993), [schema cancel](../../docs/jubelio-api/dist.yaml#L26045).

## Hasil

Dijalankan **2026-10-18 sekitar11:38UTC**, sesudah approval protokol. [Journal tersanitasi](research-08-selected-lifecycle-results.json). Semua case dan stage berhasil; tidak ada stop/retry atau write tambahan di luar budget.

| Kasus | SO/detail | Invoice | Payment | Grand | Hasil terverifikasi |
| --- | --- | --- | --- | --- | --- |
| T1 qty1 | **68440 / 74725** | **45972** | **55** | **910000** | Full mirror mempertahankan uang/identity; invoice/payment tepat, satu association, due0 |
| T2 qty2 satu baris | **68441 / 74726** | **45973** | **57** | **1810000** | Whole-line discount200000/net barang1800000 dipertahankan setelah mirror/invoice/payment, satu association, due0 |
| T3 qty1 cancel | **68442 / 74727** | Tidak dibuat | Tidak dibuat | 910000 pada SO | Full mirror cocok; satu eligible cancel, GET is_canceledtrue/invoice_idnull, stock restored |

Create dan seluruh mirror HTTP200. Actual create/mirror request tidak memiliki shipping_cost_discount; GET default0 dicatat, bukan input0. Original30000/net shipping10000/zero header discount dan tax/fees dipertahankan pada SO GET sebelum/sesudah stages. Invoice GET memperlihatkan net shipping dan payable, tetapi tidak original metadata; ini batas observasi yang sudah diterima pemilik.

### Input/output T1

Potongan financial input create:

```json
{
  "sub_total": 1000000,
  "total_disc": 100000,
  "add_disc": 0,
  "original_shipment_cost": 30000,
  "shipping_cost": 10000,
  "grand_total": 910000,
  "items": [{"item_id":157190,"qty_in_base":1,"price":1000000,"disc":10,"disc_amount":100000,"amount":900000}]
}
```

SO GET memberi detail74725; full-payload mirror memakai ID68440/detail74725 dan hanya mengubah channel_status menjadi Menunggu Verifikasi. GET marker/identity/money cocok. Invoice-only input `{"salesorder_id":68440}` → HTTP200/invoice45972, diverifikasi GET invoice + SO linkage.

Potongan payment input POST `/sales/payments/`:

```json
{
  "payment_id": 0,
  "payment_no": "[auto]",
  "account_id": 2,
  "payment_type": 0,
  "amount": 910000,
  "items": [{"payment_detail_id":0,"invoice_id":45972,"payment_amount":910000}]
}
```

Identity/date/note/zero fee/unit/tax fields tidak semuanya tampil pada snippets; actual payload mengikuti protokol, bukan full raw request yang dipublikasikan. POST200/id55. Proyeksi GET `/sales/payments/55`:

```json
{
  "payment_id": 55,
  "amount": "910000.0000",
  "payment_type": 0,
  "account_id": 2,
  "invoices": [{"salesorder_id":68440,"invoice_id":45972,"payment_amount":910000,"grand_total":910000,"due":0}]
}
```

Invoice GET payment_amount910000, filtered invoice list due0 dan SO invoice_id45972 cocok. **SO is_paid tetapnull**, jadi flag itu bukan bukti payment source of truth; payment association/due dan invoice paid amount yang dipakai untuk verifikasi.

### Input/output T2 — qty2, bukan nominal perunit

```json
{
  "sub_total": 2000000,
  "total_disc": 200000,
  "add_disc": 0,
  "original_shipment_cost": 30000,
  "shipping_cost": 10000,
  "grand_total": 1810000,
  "items": [{"item_id":157190,"qty_in_base":2,"price":1000000,"disc":10,"disc_amount":200000,"amount":1800000}]
}
```

Expected independen: gross2000000−whole-line discount200000=1800000, tambah net shipping10000=1810000. Bukan mengalikan nominal200000 sekali lagi denganqty2.

Create SO68441, mirror ID/detail74726, GET dan invoice45973 semuanya mempertahankan qty2/price1000000/disc10/nominal200000/line1800000/header1810000. Payment POST1810000 ke invoice45973/account2/type0 sekali → HTTP200/id57. Proyeksi GET:

```json
{
  "payment_id": 57,
  "amount": "1810000.0000",
  "payment_type": 0,
  "account_id": 2,
  "invoices": [{"salesorder_id":68441,"invoice_id":45973,"payment_amount":1810000,"grand_total":1810000,"due":0}]
}
```

Invoice paid amount1810000, list invoice due0, SO invoice_id45973 dan seluruh financial fields cocok. SO is_paid tetapnull sebagaimana T1; tidak dipakai sendirian untuk menyimpulkan settlement.

### T3 — safe cancel hanya fixture eligible

Create SO68442, full mirror ID/detail74727, GET pre-cancel aktif/source INTERNAL/identity/money cocok, invoice_idnull, tidak paid. Belum pernah didispatch invoice/payment untukT3. Request sekali:

```http
POST /sales/orders/cancel/
```

```json
{"ids":[68442]}
```

HTTP200/statusok. GET SO menunjukkan is_canceledtrue/invoice_idnull, original30000/net shipping10000, diskon100000/netbarang900000/grand910000 dan detail74727 tetap. Tidak cancel post-invoice atau fixture historis.

| Waktu T3 | on_hand | on_order | available |
| --- | --- | --- | --- |
| Sebelum create | 9 | 6 | 3 |
| Sesudah create/mirror, sebelum cancel | 9 | 7 | 2 |
| Sesudah cancel | **9** | **6** | **3** |

ReservationT3 pulih ke baseline kasus menurut lookup; tidak ada adjustment stock. Baseline on_order6 dari fixtures lama tidak dibersihkan oleh agent.

## Review acceptance tiket08

Main agent mereview hasil GET/list/stock di atas, bukan hanya exit code script, terhadap [scope approved](research-08-approved-proof-scope.md) dan research existing:

| Kewajiban scope aktif | Bukti | Review |
| --- | --- | --- |
| Precision nominal/whole-line, alokasi fixed/capped dan total_disc | H/R/J existing, [L dua baris](research-08-evidence.md#2-fixedcapped-allocation-dan-lifecycle-dua-baris), ditambahT2 | Terpenuhi pada envelope diuji; tidak mengklaim precedence universal input inconsistent |
| SO mapping original sebelum subsidi + net ongkir, discount field omitted | T1/T2/T3 create/GET dan actual request projections | Terpenuhi |
| Full-payload mirror mempertahankan IDs/money | T1/T2/T3, marker sebelum invoice/cancel | Terpenuhi pada stage yang diuji; bukan klaim semua edits post-invoice |
| Invoice money dan linkage | T1/T2 independent invoice+SO GET | Terpenuhi; original metadata invoice tidak diwajibkan sesuai approval |
| Payment amount/association/account/type/due0 | Payment55 dan57, invoice paid amount dan filtered due list | Terpenuhi |
| Qty>1 satu baris sampai mirror/invoice/payment | T2qty2/disc_amount200000 | Terpenuhi |
| Eligible safe cancel dan stock consistency | T3 plus evidence cancel existing | Terpenuhi |
| Field excluded/header nonzero/legacy unknowns | [Approval scope](research-08-approved-proof-scope.md) | Bukan gate aktif; tidak diberi klaim verified |

**Kesimpulan review:** bukti wajib tiket08 pada scope yang direvisi/disetujui telah terpenuhi. Ini hasil review terhadap approval scope dan protokol, bukan approval implementasi baru atau claim kontrak universal. Tiket08 dapat diselesaikan sebagai research scope terpilih; tiket09 masih perlu complete mapping contract dan approval tersendiri.

## Side effects, limits dan handoff

Stock awal12/6/6 → sesudahT111/6/5 → sesudahT29/6/3 → sesudahT3cancel tetap**9/6/3**. Net consumed3 unit dari invoiceT1/T2; reservationT3 dipulihkan. Existing on_order6 tidak disentuh. Final filtered invoice list14/totalCount14 dan payment5/totalCount5 mencakup invoice45972/45973 serta payment55/57 yang diverifikasi. Coverage hanya endpoint/filter, bukan audit internal provider.

Dipakai tepat **3 create +3 mirror +2 invoice +2 payment +1 cancel**, kumulatif**40 create attempts**. Invoice/paymentT1/T2 ditinggalkan sebagai artefak paid; T3 canceled. Tidak ada retry atau perubahan order historis. Unknown fixtures lama tetap follow-up terpisah sesuai approval, bukan dianggap rollback/canceled/cleanup selesai.

Batas handoff09: source INTERNAL/tax0/account2/type0, original metadata hanya teramati pada SO; mirror yang diuji sebelum invoice/cancel; tidak membuktikan post-invoice cancel/refund atau semua stage/nominal/config. Unit shipping_cost_discount tetap unknown dan field omitted pada mapping dipilih. Header add_disc nonzero tidak didukung oleh kesimpulan scope awal. PPN/fee website dan funding merchant tetap terpisah; jangan menghapus guard aplikasi atau menyimpulkan launch-ready.

Tidak ada perubahan aplikasi/schema/master/account mapping/env, unit/E2E/build/lint/typecheck aplikasi, subagent, atau commit. Verifikasi adalah provider research probe yang diizinkan dan review evidence oleh main agent. Tidak ada izin business write/cleanup tambahan otomatis.
