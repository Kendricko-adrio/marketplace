# Uji diskon integer yang tepat terhadap harga barang

## Hipotesis dan otorisasi

Pemilik menduga ketidaksesuaian persentase diskon terhadap nominal/price menyebabkan error conversion. Pada test sebelumnya, price650000 dan disc3.08 menghasilkan650000×3.08/100=20020, sedangkan disc_amount20000; selisih20. GET mempertahankan nominal20000, tetapi belum membuktikan apakah conversion menghitung ulang persentase.

Pemilik menyetujui **Setuju, endpoint gabungan (Recommended)** untuk tambahan satu create attempt sandbox item43823/location2, price650000, qty1, **disc10**, **disc_amount65000**, net barang585000, net shipping10000, grand595000. Hipotesisnya: bila fractional percentage/mismatch tersebut diperlukan untuk menghasilkan error23113, diskon integer exact akan menghindari error itu. Jika tetap error, fractional percentage/mismatch bukan kondisi yang diperlukan pada varian ini; akar accounting tetap belum otomatis terbukti.

Baseline kumulatif22 create attempts; tambahan maksimal1. Tidak menggunakan ulang atau mengubah SO68422/68423/68424 atau order historis. Izin mencakup login/preflight, satu create baru, satu mirror, satu combined conversion yang dapat membuat invoice/payment, serta verifikasi/reconciliation read-only. Tidak ada invoice-only/payment POST terpisah, retry, cancel, perubahan stock/master/account mapping/aplikasi/schema/env, subagent, atau commit.

## Input dan expected independen

```text
650000 × qty1 × disc10 / 100 = 65000 tepat
650000 − 65000 = 585000
30000 − subsidi20000 = net shipping10000
585000 + 10000 = grand595000
```

Request membawa JSON numbers integer, bukan string persentase pecahan. Tidak memanggil round/toFixed atau menurunkan nominal dari persentase response. Jika GET menampilkan "10.00"/"65000.0000", trailing zero itu format response; nilai numeriknya tetap integer dan wajib sama dengan expected.

Header: sub_total650000, total_disc65000, add_disc0, total_tax0, original_shipment_cost30000, shipping_cost_discount20000, shipping_cost10000, grand_total595000; add_fee/service_fee/insurance_cost0. Line: item43823, location2, qty1, price650000, disc10, disc_amount65000, amount585000, NoTax1, unit Buah. Source INTERNAL1 dan customer dummy116918; reference/note fixture baru unik.

## Protokol sebelum request

1. Login menggunakan credentials `.env` yang telah dikonfirmasi sandbox; GET dummy/master43823/NoTax1, pastikan identitas, harga650000, aktif/unit Buah/rate0. Filtered payment list sebagai baseline. Cek stock location2 via POST read-only `/inventory/items/all-stocks/`; bila available<1 atau data tidak cocok, stop tanpa mengganti item/lokasi.
2. Pastikan seluruh input finansial integer dan 650000×10/100=65000 tanpa sisa. Catat dispatch intent dan maksimal satu create POST `/sales/orders/`.
3. GET fixture baru; verifikasi identity/source/location/ref/detail ID dan seluruh uang terhadap konstanta expected independen. Alias lokasi baris `location_id`/`loc_id` didukung; konflik alias menghentikan write.
4. Satu full-payload mirror menggunakan ID/detail IDs dari GET, ubah hanya marker Belum Bayar menjadi Menunggu Verifikasi; GET ulang, lalu pre-conversion GET. Seluruh uang/detail harus tetap.
5. Satu POST `/sales/packlists/create-invoice-payment` hanya dengan `{salesorder_id: <ID fixture baru>}`. Jangan memanggil endpoint invoice-only atau payment POST terpisah.
6. Jika sukses, response id diperlakukan sebagai invoice ID. GET invoice/SO dan payment lists/detail untuk memeriksa nilai595000, linkage, actual account/payment ID, payment association, serta due0. Missing evidence tetap unknown; tidak menambal dengan payment tambahan.
7. Jika error ambigu/network/5xx/missingID atau mismatch, stop business writes. Reconciliation terbatas GET SO/invoice teridentifikasi, filtered invoice/payment lists, serta stock lookup read-only. Tidak retry/cancel, walaupun invoice_idnull. Artefak sandbox dipertahankan.
8. Simpan input/output proyeksi allowlist pada `research-08-integer-discount-results.json`, tanpa credentials/token/raw customer responses/PII. Ini bukan full raw request/response.

## Batas kesimpulan

Item dan nominal diskon berubah dibanding fixture sebelumnya karena stock item lama habis; account mapping antar item belum diisolasi. Hasil dapat menguji apakah error tetap teramati dengan angka integer exact, tetapi tidak sendirian membuktikan penyebab error sebelumnya atau seluruh kontrak provider. Subsidi ongkir tetap dikirim, jadi test ini bukan control goods-only.

## Referensi

- [Test gabungan sebelumnya](research-08-combined-retest.md), [journal](research-08-combined-retest-results.json).
- [Discovery item43823](research-08-alternative-item-results.json).
- [Vendor endpoint](../../docs/jubelio-api/dist.yaml#L9222) dan [schema](../../docs/jubelio-api/dist.yaml#L26987).
- [Parser lokasi existing](../../apps/store/src/lib/jubelio-sales-client.ts#L1278).

## Hasil

Dijalankan **2026-10-18 sekitar10:00UTC**. [Journal tersanitasi](research-08-integer-discount-results.json). Semua business writes didispatch sekali sesuai batas; tidak ada create/conversion ulang.

| Tahap | Input/expected relevan | Output |
| --- | --- | --- |
| Integer arithmetic check | price650000×qty1×disc10=6500000; dibagi100 | Remainder0, disc_amount65000 tepat, tanpa rounding |
| Login/contact/master/tax | dummy116918, item43823/location2, NoTax1 | HTTP200; harga650000/aktif/Buah, rate0 |
| Baseline payment list | Filter dummy, page1/pageSize100 | IDs40/42/44; returned3/totalCount3 |
| Stock sebelum create | item43823/location2 | on_hand1/on_order0/available1 |
| Create SO | disc10/disc_amount65000/net585000; original shipping30000/subsidy20000/net10000/grand595000 | HTTP200/**SO68425**, detail74710; GET seluruh money/identity cocok |
| Full-payload mirror | SO68425/detail74710; marker Menunggu Verifikasi; seluruh nilai dipertahankan | HTTP200; GET nominal/detail/marker cocok |
| Combined conversion | POST `/sales/packlists/create-invoice-payment`, `{"salesorder_id":68425}` | **HTTP500/code23113**, tanpa invoice ID |
| GET reconciliation SO | `/sales/orders/68425` | invoice_idnull, is_canceled/is_paidnull, grand595000, marker Menunggu Verifikasi; seluruh diskon/shipping tetap |
| Stock reconciliation | item43823/location2 | on_hand1/on_order1/available0 |
| Filtered invoice/payment lists | Filter label dummy existing, masing-masing page1/pageSize100 | Masing-masing3/totalCount3; hanya invoice45951/45952/45953 dan payment40/42/44 yang sudah dikenal |

GET menampilkan `disc:"10.00"`, `disc_amount:"65000.0000"`, price650000 dan amount585000 dalam format decimal string provider. Nilainya exact integer, bukan pembulatan atau fractional percentage pada request. Input create/mirror menggunakan JSON numbers10/65000.

**Kesimpulan terbatas:** error23113 (`journal_unbalance` menurut vendor code list) tetap muncul ketika persentase dan nominal diskon sama-sama integer serta matematis tepat terhadap price×qty. Dengan demikian, fractional percentage atau selisih disc-versus-nominal bukan kondisi yang diperlukan untuk error pada varian ini. Tidak tepat menyimpulkan seluruh error sebelumnya pasti bukan rounding, bahwa satu field shipping pasti penyebabnya, atau bahwa account mapping sudah benar. Item berbeda dan subsidi tetap dikirim; control goods-only dengan kondisi ini tidak dijalankan.

**Stop business writes aktif.** Tidak retry conversion, payment POST terpisah, cancellation, perubahan stock/master/account mapping/aplikasi, atau write pada SO68422/68423/68424. Combined request sudah didispatch, sehingga efek internal invoice/payment tetap unknown. Filtered lists tidak memperlihatkan artefak baru, tetapi bukan proof rollback. SO68425 dipertahankan sebagai artefak investigasi; stock tersedia menjadi0.

Total **1 create + 1 mirror + 1 combined conversion attempt**; tambahan budget1/1 habis; kumulatif **23 create attempts**, bukan23 successful SO. Manual UI/audit disposition SO68425 diperlukan sebelum cleanup atau write lanjutan; fixtures ambigu sebelumnya tetap terpisah. Tidak ada kontak support atau penutupan required proof08. Tiket tetap claimed. Tidak ada unit/E2E/build/lint/typecheck aplikasi, subagent, atau commit; verifikasi hanya probe provider dan review journal oleh main agent.
