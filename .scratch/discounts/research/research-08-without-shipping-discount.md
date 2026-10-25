# Ablation I/J dengan shipping_cost_discount dihapus

## Otorisasi dan tujuan

Setelah hasil matriks10 kasus, pemilik secara eksplisit meminta **jalankan skenario I dan J namun hapus shipping_cost_discount** untuk menguji kandidat pemicu error. Ini research sandbox dengan dua fixtures baru, bukan retry conversion atau edit SO68434/68435 lama. Semua parameter finansial I/J dipertahankan kecuali key tersebut benar-benar **OMIT**, bukan0/null/empty string.

Scope percakapan sudah konkret: maksimal **2 create SO baru dan2 invoice-only conversion attempts**, item157190/location2/qty1/price1000000, original_shipment_cost30000 dan shipping_cost10000 tetap. Baseline kumulatif33 create attempts; maksimal35 setelah dua kasus. Tidak ada mirror/payment/cancel/retry, perubahan stock/master/account mapping/aplikasi/schema/env, subagent, commit atau kontak support. Global stop tetap berlaku pada hasil ambigu/mismatch, sebelum kasus berikutnya; tidak ada cleanup otomatis.

## Expected independen

| Label baru | Pembanding historis | disc | disc_amount / total_disc | Line amount | original_shipment_cost | shipping_cost | shipping_cost_discount | grand_total |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| I-minus | I/SO68434, invoice conversion23113 | 0 | 0 | 1000000 | 30000 | 10000 | **OMIT** | 1010000 |
| J-minus | J/SO68435, invoice conversion23113 | 10 | 100000 | 900000 | 30000 | 10000 | **OMIT** | 910000 |

Source1 INTERNAL, contact dummy116918, unit Buah, NoTax1/rate0, is_tax_includedfalse, add_disc/fee/tax/insurance0. Persentase/uang integer tanpa rounding. Harga tidak diubah untuk menyamarkan diskon. Tanggal/ref/note dan IDs fixtures baru wajar berbeda; input finansial sama dengan pembanding kecuali key subsidi yang dihilangkan.

## Protokol sebelum request

1. Login credentials `.env` yang telah dikonfirmasi sandbox; GET dummy/master157190/SKU157190/price1000000/unitBuah/tax1. Recheck stock location2 sebelum tiap create; bila available<1 atau data tidak cocok, stop tanpa penggantian item/lokasi.
2. GET filtered invoice/payment lists sebagai baseline dan coverage; jangan menyimpan token/credentials/raw customer response/PII.
3. Untuk I-minus lalu J-minus: satu POST `/sales/orders/`, request tanpa key shipping_cost_discount. Simpan dispatch intent dan fieldPresence=OMIT. Pastikan sebelum dispatch key tidak dimiliki payload; tidak boleh menghilangkan original_shipment_cost atau mengubah shipping_cost/grand.
4. GET SO dan GET pre-conversion: periksa identity/source/location/ref/detailID, line/header uang dan original_shipment_cost30000. Catat default provider shipping_cost_discount jika GET mengembalikannya; default response0 bukan berarti key dikirim.
5. Satu POST `/sales/packlists/create-invoice` dengan ID fixture baru, tanpa mirror. Jika sukses, GET invoice dan SO untuk linkage, discount/line/header/payable, payment_amount0 bila tersedia. Catat original_shipment_cost bila invoice GET tidak mengeksposnya; jangan mengklaim preservation metadata internal.
6. Recheck stock setelah case; lanjut case berikut hanya jika verifikasi wajib cocok. Structured HTTP400 definite rejection dicatat terpisah; generic/ambiguous rejection, network/5xx/missing ID atau mismatch menghentikan seluruh business writes. Reconciliation hanya GET/list/stock lookup read-only, tanpa retry/cancel.
7. Semua artifacts dibiarkan di sandbox, invoice sukses belum dibayar. Journal tersanitasi `research-08-without-shipping-discount-results.json` menyimpan allowlist projection, bukan raw full request/response.

## Interpretasi yang diizinkan

Jika kedua ablation sukses, hasil memperkuat **nonzero shipping_cost_discount sebagai pembeda request yang berkaitan dengan failure** pada envelope I/J. J-minus juga merupakan pengulangan independen financial configurationG yang sudah berhasil; bukan retry order yang gagal. Ini bukan bukti semua nilai/sources/endpoint gagal atau bahwa field intrinsik salah: kontrak gross/net shipping dan journal/account mapping bisa menjadi interaksi yang belum diketahui. Tidak memilih root cause atau memperbaiki accounting berdasarkan asumsi.

Jika gagal, jangan menyimpulkan kandidat sudah pasti benar; catat tahap kegagalan dan hentikan writes. Read-only API absence bukan proof rollback.

## Referensi

- [Hasil I/J asli dan izin](research-08-field-matrix-ij-evidence.md), [journalI](research-08-field-matrix-ij-results.json), [journalJ](research-08-field-matrix-j-results.json).
- [Matriks kontrol A–J](research-08-field-matrix-evidence.md).
- [Vendor create SO](../../../docs/jubelio-api/dist.yaml#L24893), [invoice-only](../../../docs/jubelio-api/dist.yaml#L9248).
- [Alias lokasi existing](../../../apps/store/src/lib/jubelio-sales-client.ts#L1278).

## Hasil

Dijalankan2026-10-18 sekitar10:36UTC. **Kedua ablation berhasil sampai invoice terverifikasi.** [Journal tersanitasi](research-08-without-shipping-discount-results.json). Key shipping_cost_discount benar-benar tidak ada pada input POST create, dibuktikan fieldPresence=OMIT dan guard payload sebelum dispatch; bukan diisi0.

| Pembanding | shipping_cost_discount actual request | Diskon barang | Grand | SO | Hasil conversion |
| --- | --- | --- | --- | --- | --- |
| I asli | 20000 | 0 | 1010000 | 68434 | HTTP500/code23113, tanpa invoice ID |
| **I-minus** | **OMIT** | 0 | 1010000 | **68436** | **HTTP200/invoice45968**, GET money/identity/linkage cocok |
| J asli | 20000 | 100000/10% | 910000 | 68435 | HTTP500/code23113, tanpa invoice ID |
| **J-minus** | **OMIT** | 100000/10% | 910000 | **68437** | **HTTP200/invoice45969**, GET money/identity/linkage cocok |

Item157190/location2/price1000000/qty1, original_shipment_cost30000 dan shipping_cost10000 tetap pada keempat kasus; tidak ada perubahan account/config/mirror atau field finansial lain antara masing-masing pembanding. Ref/tanggal/IDs berbeda karena fixtures baru, bukan edit/retry SO gagal.

### Input finansial create I-minus

```json
{
  "sub_total": 1000000,
  "total_disc": 0,
  "original_shipment_cost": 30000,
  "shipping_cost": 10000,
  "grand_total": 1010000,
  "items": [{"item_id":157190,"qty_in_base":1,"price":1000000,"disc":0,"disc_amount":0,"amount":1000000}]
}
```

### Input finansial create J-minus

```json
{
  "sub_total": 1000000,
  "total_disc": 100000,
  "original_shipment_cost": 30000,
  "shipping_cost": 10000,
  "grand_total": 910000,
  "items": [{"item_id":157190,"qty_in_base":1,"price":1000000,"disc":10,"disc_amount":100000,"amount":900000}]
}
```

Snippets adalah financial projection, bukan full raw payload. Semua required identity/date/unit/tax/detail0/zero fee fields ikut dikirim sesuai protokol; key subsidi tidak dikirim.

### Conversion dan output

```http
POST /sales/packlists/create-invoice
```

Input I-minus `{"salesorder_id":68436}` → HTTP200/proyeksi `{"id":45968,"status":"ok"}`.
Input J-minus `{"salesorder_id":68437}` → HTTP200/proyeksi `{"id":45969,"status":"ok"}`.

GET invoice45968 mempertahankan goods discount0, line1000000, shipping10000/grand1010000; invoice45969 mempertahankan goods discount100000, line900000, shipping10000/grand910000. GET SO masing-masing terhubung ke invoice yang tepat, seluruh identity/detail/nominal cocok.

Kedua invoice GET mengembalikan `shipping_cost_discount:"0.0000"` meskipun key omitted pada request. Ini default response provider, **bukan bukti agent mengirim0**. Kedua invoice payment_amount0 dan due penuh pada filtered list; keduanya **unpaid**, bukan settlement sampai payment.

SO GET setelah conversion tetap menyimpan original_shipment_cost30000. Field original_shipment_cost tidak tersedia pada invoice GET; preservation metadata internal invoice tidak diklaim.

### Stock, lists dan artefak

Stock157190/location2 sebelum I-minus14/4/10, setelah I-minus13/4/9, setelah J-minus**12/4/8** (on_hand/on_order/available). Dua invoice baru mengurangi on_hand2 menurut observasi; on_order4 tidak berubah. Tidak ada adjustment/cancel, cleanup existing reservation, atau write pada SO68434/68435 maupun fixtures lama lain.

Filtered invoice list12 rows/totalCount12: artefak yang dikenal ditambah invoice45968/45969 yang sesuai SO68436/68437. Filtered payment list tetap3/totalCount3, IDs40/42/44. Coverage lengkap menurut totalCount untuk endpoint/filter yang dipakai, bukan audit semua state internal. Unknown rollback/disposition H/I/J lama tidak terjawab oleh keberhasilan fixtures baru ini.

### Kesimpulan dan batas

**Dua pasangan kontrol mendukung dengan kuat bahwa penambahan shipping_cost_discount20000 membedakan request yang gagal23113 dari request yang sukses invoice pada konfigurasi ini.** I-minus sukses tanpa diskon barang; J-minus sukses dengan diskon barang integer exact. Original_shipment_cost30000 tetap ada pada kedua request sukses, sehingga tidak perlu menghilangkan field itu untuk memperoleh invoice pada envelope tersebut.

Ini bukan bukti field shipping_cost_discount intrinsik salah atau semua nilai nonzero pasti gagal. Definisi gross/net shipping, recomputation, serta journal/default account treatment belum dibuktikan. Jangan menyimpulkan double subtraction atau mengubah mapping/config aplikasi diam-diam. Funding merchant tidak dianggap otomatis tercatat pada provider hanya karena invoice sukses dengan net shipping.

Tambahan budget**2/2 create dan2/2 invoice attempts** terpakai, kumulatif**35 create attempts**. Tidak ada mirror/payment/cancel/retry atau perubahan aplikasi/schema/master/account mapping/env; unit/E2E/build/lint/typecheck aplikasi, subagent, dan commit tidak dijalankan. Verifikasi provider serta review journal dilakukan main agent. Tidak ada business write lanjutan yang diizinkan otomatis; tiket08 tetap claimed, bukan resolved.
