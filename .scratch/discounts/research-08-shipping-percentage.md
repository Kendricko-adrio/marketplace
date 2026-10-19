# Uji hipotesis shipping_cost_discount sebagai persentase

## Otorisasi dan pertanyaan

Pemilik mengusulkan shipping_cost_discount sebagai persentase, bukan nominal, dan meminta nilai10/20. Setelah menerima dua pilihan protokol, pemilik memilih **Sesuai hipotesis persen (Recommended)**: net shipping harus konsisten dengan10%/20% dari original shipment30000. Ini tidak sama dengan hanya mengganti field10/20 sambil mempertahankan net10000.

Spec vendor yang diperiksa hanya mendeskripsikan Shipping cost discount/type number/example0; tidak memberi unit eksplisit. [Field](../../docs/jubelio-api/dist.yaml#L25710), [field response lain](../../docs/jubelio-api/dist.yaml#L30412). Persentase tetap **hipotesis**, bukan fakta provider. Eksperimen20000 terdahulu tidak membuktikan satuan Rupiah secara independen.

Izin: maksimal **2 create fixtures sandbox dan2 invoice-only conversion attempts**, tanpa mirror/payment/cancel/retry/perubahan stock/master/account mapping/aplikasi/schema/env atau write pada fixtures lama. Baseline35 create attempts, maksimal37. Global stop pada hasil ambigu/mismatch; jika P10 gagal ambigu, P20 tidak otomatis dijalankan sebelum keputusan lanjut. Credentials `.env` telah dikonfirmasi sandbox, token hanya in-memory.

## Input dan expected independen

Konstanta: SKU157190/product group55269 Celana Okcir Bagus, location2, qty1, price1000000, unit Buah, source1 INTERNAL, dummy116918, NoTax1/rate0, tanpa fee/insurance/add_disc/PPN. Goods disc10/disc_amount100000/net900000, seluruhnya integer exact.

| Kasus | original_shipment_cost | shipping_cost_discount request | Hipotesis benefit Rupiah | shipping_cost net request | grand_total request |
| --- | --- | --- | --- | --- | --- |
| P10 | 30000 | **10** | 30000×10/100=3000 | **27000** | **927000** |
| P20 | 30000 | **20** | 30000×20/100=6000 | **24000** | **924000** |

Tidak ada rounding atau fractional percentage. Net shipping dihitung oleh probe sebagai candidate yang konsisten dengan hipotesis; **provider belum dibuktikan menghitung benefit3000/6000 sendiri**. Ref/note/date dan IDs unik karena fixtures baru, bukan retry.

## Protokol sebelum request

1. Login, GET dummy/master157190/SKU/price1000000/unitBuah/NoTax1 dan filtered invoice/payment baselines. Stock location2 dicek ulang sebelum tiap create, minimal available1; ketidakcocokan membuat stop tanpa fixture pengganti/stock adjustment.
2. Bentuk payload P10 laluP20 sesuai tabel. `salesorder_id=0`, no auto, tanggal saat request, label ref unik, marker Belum Bayar, required line fields lengkap. Simpan dispatch intent dan nominal/field presence sebelum satu create POST `/sales/orders/` per case.
3. GET fixture dan pre-conversion: verifikasi identity/qty/detail/unit/source/location, barang/diskon/tax/header/net shipping/grand terhadap expected independen. Catat actual original/discount values. Jika provider menormalisasi field di luar nilai request, jangan menganggapnya otomatis salah atau benar: catat observasi lalu stop sebelum conversion untuk review; jangan menghitung ulang financial payload diam-diam.
4. Satu POST `/sales/packlists/create-invoice` hanya dengan ID fixture baru yang lolos verifikasi. Tidak memakai endpoint gabungan/payment POST/mirror.
5. Jika sukses dan response ID valid, GET invoice+SO untuk linkage/money dan metadata yang tersedia. Catat apakah output benar-benar memberi efek Rupiah3000/6000 secara independen atau hanya mempertahankan nilai request; HTTP200 sendiri bukan proof unit persen. Invoice baru dibiarkan unpaid.
6. Pada network/5xx/missingID/ambiguous rejection/money mismatch: stop semua business writes, reconciliation hanya GET SO/invoice teridentifikasi, filtered lists dengan pagination coverage, dan stock lookup read-only. Tidak retry/cancel. Structured HTTP400 definite rejection dicatat sebagai penolakan, bukan failure journal; case independen berikut boleh lanjut sesuai batas hanya setelah state/stock read cocok.
7. Journal `.scratch/discounts/research-08-shipping-percentage-results.json` menyimpan proyeksi allowlist, bukan raw full requests/responses. Token/credentials/customer PII tidak dicatat.

## Batas kesimpulan

Sukses invoice dengan field10/20 akan membuktikan acceptance/preservation pada kombinasi ini, belum otomatis unit persen karena net/grand dihitung di input. Kegagalan tetap23113 hanya membuktikan mengganti field ke10/20 dengan candidate net shipping belum menghindari error; bukan proof universal menolak semantik persen. Kontrak gross/net shipping, journal/account mapping dan business source lain tetap unknown. Tidak mengubah keputusan accounting/mapping atau kesiapan launch.

## Referensi

- [Ablation tanpa field berhasil](research-08-without-shipping-discount.md), [journal](research-08-without-shipping-discount-results.json).
- [Matriks A–J](research-08-field-matrix-evidence.md).
- [Vendor invoice-only](../../docs/jubelio-api/dist.yaml#L9248) dan [conversion schema](../../docs/jubelio-api/dist.yaml#L26987).

## Hasil

**P10 danP20 kini sudah dijalankan; keduanya create SO berhasil tetapi conversion invoice-only HTTP500/code23113.** P20 dijalankan setelah izin khusus pemilik pasca stopP10. Tambahan2/2 create/invoice attempts terpakai, kumulatif37 create attempts. Unit field tetap belum terbukti persen maupun amount.

### Checkpoint P10

Dijalankan2026-10-18 sekitar10:54UTC. [Journal P10 dan status P20 pada checkpoint](research-08-shipping-percentage-results.json).

Input finansial P10:

```json
{
  "sub_total": 1000000,
  "total_disc": 100000,
  "original_shipment_cost": 30000,
  "shipping_cost_discount": 10,
  "shipping_cost": 27000,
  "grand_total": 927000,
  "items": [{"item_id":157190,"qty_in_base":1,"price":1000000,"disc":10,"disc_amount":100000,"amount":900000}]
}
```

Create HTTP200/**SO68438**, detail74723. GET serta pre-conversion mempertahankan semua nominal/identity; shipping_cost_discount disimpan sebagai `"10.0000"`, bukan transformasi eksplisit ke benefit3000. Satu POST `/sales/packlists/create-invoice` dengan `{"salesorder_id":68438}` kembali **HTTP500/code23113**, tanpa invoiceID. Global stop sebelum P20, tanpa retry/payment/mirror/cancel.

Reconciliation SO68438: invoice_idnull, is_canceled/is_paidnull, grand927000, original30000/discount10/net shipping27000 tetap. Stock157190/location2 **on_hand12/on_order5/available7**, dari12/4/8 sebelum P10. Filtered invoice list12/totalCount12 dan payment3/totalCount3 tetap artefak yang dikenal; tidak terlihat invoice baru terkait P10 pada filter ini, bukan proof rollback.

**Kesimpulan terbatas:** field10 dengan net ongkir yang dihitung menurut hipotesis10% belum menghindari error23113. Unit field tetap **belum terbukti persen atau amount**, karena GET hanya mempertahankan nilai request dan invoice conversion gagal. Ini bukan proof universal bahwa persen pasti tidak didukung; gross/net contract/account mapping tetap unknown.

Terpakai1/2 create/invoice attempts, kumulatif**36 create attempts**. **P20 not-run** pada checkpoint ini; satu slot tersisa tidak dijalankan otomatis setelah stop. Perlu keputusan lanjut khusus P20; tidak retry P10 atau mengubah SO68438. Tidak ada perubahan aplikasi/schema/master/account mapping/env, application validation runs, subagent, atau commit.

### Izin khusus P20 setelah checkpoint P10

Setelah menerima hasil P10 dan reconciliation, pemilik memilih **Ya, jalankan P20**. Izin khusus ini mencakup satu fixture baru P20, shipping_cost_discount20/original30000/net shipping24000/grand924000, seluruh konstanta barang/tax/source tetap. Maksimal satu create dan satu invoice-only conversion, menggunakan slot terakhir dari limit2; baseline36/maksimal37 create attempts. Login/master/stock/GET baselines diperiksa ulang, tanpa mirror/payment/cancel/retry atau write pada P10/fixtures lama. Setelah hasil, tidak ada business write lanjutan; bila ambigu hanya reconciliation read-only. Journal terpisah `research-08-shipping-percentage-p20-results.json`, tanpa menimpa journal P10.

### Hasil P20 dan kesimpulan akhir

Dijalankan2026-10-18 sekitar10:55UTC. [Journal P20](research-08-shipping-percentage-p20-results.json).

Potongan input finansial:

```json
{
  "sub_total": 1000000,
  "total_disc": 100000,
  "original_shipment_cost": 30000,
  "shipping_cost_discount": 20,
  "shipping_cost": 24000,
  "grand_total": 924000,
  "items": [{"item_id":157190,"qty_in_base":1,"price":1000000,"disc":10,"disc_amount":100000,"amount":900000}]
}
```

Create HTTP200/**SO68439**, detail74724. GET dan pre-conversion semua nominal/identity cocok; raw shipping_cost_discount `"20.0000"` tetap nilai request, bukan transformasi eksplisit ke benefit6000. Satu POST `/sales/packlists/create-invoice` dengan `{"salesorder_id":68439}` mendapat **HTTP500/code23113**, tanpa invoiceID. Seluruh business writes dihentikan.

Reconciliation GET SO68439: invoice_idnull, is_canceled/is_paidnull, marker Belum Bayar, grand924000, original30000/discount20/net shipping24000 tetap. Stock157190/location2 **on_hand12/on_order6/available6**, dari12/5/7 sebelumP20. Filtered invoice list12/totalCount12 dan payment3/totalCount3 tetap artefak dikenal, tanpa invoice/payment baru terlihat untukP20 pada filter tersebut; bukan audit internal/proof rollback.

| Kasus | Field request | Net shipping input | Grand input/GET SO | SO | Invoice conversion |
| --- | --- | --- | --- | --- | --- |
| P10 | 10 | 27000 | 927000 | 68438 | HTTP500/code23113 |
| P20 | 20 | 24000 | 924000 | 68439 | HTTP500/code23113 |

**Interpretasi:** mengganti field ke10/20 dengan financial input konsisten terhadap hipotesis persentase dari ongkir30000 belum menghindari failure pada jalur INTERNAL/invoice-only ini. Tidak ada provider-computed benefit3000/6000 yang terverifikasi independen; net/grand sudah dihitung probe di input, GET mempertahankannya, dan conversion gagal. Jadi **unit persen maupun amount tetap unknown**, bukan proof bahwa persen pasti salah atau bahwa amount sudah benar. Gross/net semantics dan journal/account mapping tetap perlu bukti independen.

Penyebutan subsidi20000 pada eksperimen terdahulu merupakan intended business benefit/candidate mapping; jangan memperlakukannya sebagai proof unit field provider. Hasil ablation tanpa field tetap valid sebagai pembanding acceptance/conversion, tetapi tidak menyelesaikan pertanyaan unit.

Terpakai**2/2 create dan2/2 invoice attempts**, kumulatif**37 create attempts**. Tidak ada mirror/payment/cancel/retry atau write pada P10/fixtures lama. ArtefakP10/P20 tetap aktif/pre-invoice menurut GET dan memerlukan manual UI/audit disposition sebelum cleanup. Tidak ada perubahan aplikasi/schema/master/account mapping/env, unit/E2E/build/lint/typecheck aplikasi, subagent, atau commit. Tidak ada budget/izin write berikutnya otomatis; tiket08 tetap claimed.
