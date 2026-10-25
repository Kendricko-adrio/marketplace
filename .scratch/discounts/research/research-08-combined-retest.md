# Uji endpoint gabungan invoice dan payment untuk subsidi ongkir

## Otorisasi dan batas

Pemilik memilih **Setuju, uji endpoint gabungan (Recommended)** setelah menerima protokol item43825/location2, harga650000, diskon barang20000/net630000, ongkir awal30000/subsidi20000/net10000, payable640000. Izin mencakup login/preflight sandbox, tambahan satu create SO baru, satu full-payload mirror, satu conversion invoice sekaligus payment, lalu verifikasi read-only.

Baseline kumulatif21 create attempts; tambahan maksimal1 attempt, bukan jaminan sukses. Tidak menyentuh SO68422/68423 atau order historis dengan write. Tidak ada retry, cancel, perubahan stock/master/account mapping, aplikasi/schema/env, payment terpisah, subagent, atau commit. Credentials `.env` telah dinyatakan sandbox oleh pemilik; token/PII tidak dicatat.

## Pertanyaan

Apakah `POST /sales/packlists/create-invoice-payment` pada fixture baru dengan representasi subsidi yang sama menerima conversion dan payment, atau kembali menghasilkan HTTP500/code23113 seperti endpoint invoice-only? Item dan harga berbeda dari F6 pertama; keberhasilan/kegagalan bukan isolasi akar error atau proof atomicity provider.

## Protokol sebelum request

1. Login; GET contact dummy116918 (identitas fixture yang sudah dikenal), master43825, NoTax1; lookup stock location2 melalui POST read-only `/inventory/items/all-stocks/`. Pastikan harga650000, aktif, unit Buah dan available>=1. Jika tidak cocok, berhenti tanpa mengganti item/lokasi atau mengubah stock.
2. GET filtered payment list sebagai baseline observasi, tanpa raw customer response. Catat hanya payment IDs/nominal dan pagination coverage.
3. Satu POST `/sales/orders/`: source1 INTERNAL, location2, qty1, price650000, disc3.08, disc_amount20000, line amount630000, sub_total650000, total_disc20000, add_disc0, total_tax0, shipping_cost10000, original_shipment_cost30000, shipping_cost_discount20000, grand_total640000, fee/insurance0. Gunakan ref/note fixture baru unik, tanggal saat request, contact dummy dan unit/tax yang diverifikasi.
4. GET SO: periksa ID, contact/source/location/ref, detail ID, unit/tax, semua nominal terhadap expected independen. Lokasi baris dibaca dari `location_id` atau alias `loc_id`; bila keduanya ada dan berbeda, berhenti.
5. Satu full-payload mirror dari GET dengan ID/detail IDs asli, hanya mengganti channel_status Belum Bayar menjadi Menunggu Verifikasi; GET konfirmasi seluruh nominal/identity dan detail tetap.
6. GET pre-conversion, lalu satu POST `/sales/packlists/create-invoice-payment` dengan `{salesorder_id: <ID fixture baru>}`. **Tidak** memanggil `/sales/packlists/create-invoice` atau POST `/sales/payments/`.
7. Bila sukses dan response memiliki id, perlakukan id sebagai invoice ID, bukan payment ID. GET invoice dan GET SO untuk linkage/money. GET filtered payment list serta detail payment candidates untuk mengonfirmasi actual payment ID, amount, account, association SO/invoice, dan due. Simpan missing/ambiguous evidence sebagai unknown, tidak mengirim payment tambahan untuk melengkapinya.
8. Bila network/5xx/response tanpaID atau mismatch, hentikan business writes. Reconciliation hanya GET detail SO/invoice yang teridentifikasi, filtered invoice/payment lists dan stock lookup read-only. Tidak retry endpoint atau cleanup otomatis, sekalipun invoice_idnull.
9. Artefak sandbox dipertahankan. Journal `.scratch/discounts/research/research-08-combined-retest-results.json` menyimpan dispatch intent sebelum write serta proyeksi allowlist (bukan raw full requests/responses).

## Referensi

- [Vendor endpoint gabungan](../../../docs/jubelio-api/dist.yaml#L9222).
- [Vendor request/response schema](../../../docs/jubelio-api/dist.yaml#L26987): hanya salesorder_id pada request; response id dideskripsikan sebagai Sales Invoice Number. Tidak mendokumentasikan nominal/akun payment atau atomicity.
- [Retest invoice-only item pengganti](research-08-retest.md#hasil-retest-item60344--error-invoice-sama).
- [Alias lokasi baris pada parser existing](../../../apps/store/src/lib/jubelio-sales-client.ts#L1278).

## Hasil

Dijalankan pada **2026-10-18 sekitar09:47UTC**. [Journal tersanitasi input/output](research-08-combined-retest-results.json). Journal menyimpan proyeksi allowlist, bukan raw full request/response; credentials/token dan customer response tetap tidak dipublikasikan.

| Tahap | Input/expected relevan | Output |
| --- | --- | --- |
| Login/master/tax | dummy116918, item43825, NoTax1 | HTTP200; master650000/aktif/Buah; rate0 |
| Baseline payment list | Filter label dummy existing, page1/pageSize100 | payment40/42/44; returned3/totalCount3 |
| Stock sebelum create | item43825/location2 | on_hand1/on_order0/available1 |
| Create SO | qty1/price650000/disc3.08/disc_amount20000/line amount630000; total_disc20000; original shipping30000/subsidy20000/net shipping10000/grand640000 | HTTP200/id**68424**, detail74709; GET semua money/identity cocok |
| Full-payload mirror | SO68424/detail74709, marker Menunggu Verifikasi; nilai lain dipertahankan | HTTP200/id68424; GET semua nominal dan detail tetap |
| Conversion gabungan | POST `/sales/packlists/create-invoice-payment`, `{"salesorder_id":68424}` | **HTTP500/code23113**, tidak menerima invoice ID |
| GET reconciliation SO | `/sales/orders/68424` | invoice_idnull, is_canceled/is_paidnull, marker Menunggu Verifikasi, grand640000; field shipping tetap30000/20000/10000 |
| Stock reconciliation | item43825/location2 | on_hand1/on_order1/available0 |
| Filtered invoice/payment lists | Filter label dummy existing, masing-masing page1/pageSize100 | Masing-masing3/totalCount3; hanya invoice45951/45952/45953 serta payment40/42/44, tanpa artefak baru terlihat |

**Kesimpulan:** error23113 (`journal_unbalance` menurut vendor code list) tetap terjadi pada endpoint gabungan dalam fixture ini. Mengganti endpoint tidak menghilangkan error yang teramati. Ini bukan bukti akar penyebab, atomicity, atau rollback conversion. Item43825 berbeda dari item60344 pada retest invoice-only, meskipun nominal/header/lokasi/tax sama; perbedaan account mapping antar item belum diisolasi.

**Stop business writes aktif.** Request gabungan telah dikirim sekali, sehingga outcome payment internal tetap unknown; jangan menyebut payment pasti tidak dibuat hanya karena tidak terlihat di API. Tidak ada POST `/sales/payments/` terpisah, retry conversion, cancellation, atau perubahan SO68422/68423. SO68424 masih ada dan stock tersedia menjadi0; artefak dipertahankan, bukan cleanup selesai.

Total: **1 create + 1 mirror + 1 combined conversion attempt**, budget tambahan1/1 habis, kumulatif **22 create attempts**. Tidak memanggil endpoint invoice-only pada fixture ini. Tidak ada perubahan aplikasi/schema/master/account mapping/env, unit/E2E/build/lint/typecheck aplikasi, subagent, atau commit. Verifikasi provider melalui GET/list/stock lookup dan review journal dilakukan main agent.

Next action: manual UI/audit disposition SO68424 dan unknown conversion/payment sebelum cleanup atau write lanjutan. SO68422/68423 tetap memiliki disposition terpisah. Tidak ada izin tambahan, kontak support, atau penutupan tiket08 yang diasumsikan.
