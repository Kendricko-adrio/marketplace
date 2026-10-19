# Protokol matriks field diskon dan ongkir

## Status dan alignment

**Approved untuk research sandbox terbatas.** Pemilik meminta eksperimen pengurangan field diskon/ongkir, mengarahkan produk Celana Okcir Bagus lewat157190, dan memilih **Invoice-only (Recommended)**. Scope ini hanya research sandbox, bukan implementasi/mapping accounting final.

Tujuan: menemukan kombinasi request yang berhasil/gagal pada create SO dan terutama conversion invoice, dengan item/lokasi/harga/qty/tax/endpoint tetap. Tidak mengubah existing order, stock, master, akun/config, aplikasi/schema/env, sumber INTERNAL, atau retry request ambigu. Tidak memakai subagent/commit.

## Fakta item dan namespace ID

[Preflight157190 tersanitasi](research-08-field-matrix-item157190.json):

- GET `/inventory/items/157190`: item_group_id**55269**, nama**Celana Okcir Bagus**, aktif, price**1000000**, uom_name**Buah**. sell_unit null, sehingga unit menggunakan uom_name yang terverifikasi, bukan asumsi.
- `product_skus` mengonfirmasi **item_id157190**, item_code Testasd, sell_price1000000, end_qty21.
- Stock157190/location2: **on_hand21/on_order1/available20** saat discovery.
- Nomor55269 yang diperiksa sebelumnya sebagai item_id menunjuk SKU pada group14360, bukan Celana Okcir Bagus. Dalam hasil ini, group ID55269 dan SKU ID55269 berbeda namespace; untuk SO produk yang dimaksud, item_id yang benar adalah157190.
- Account ID fields master null tidak membuktikan akun efektif provider kosong, karena inheritance/default accounting belum diverifikasi. Tidak diubah untuk eksperimen.

## Konstanta dan expected independen

Semua kasus qty1, item157190, location2, source1 INTERNAL, contact dummy116918, unit Buah, NoTax1/rate0, is_tax_included false. Harga master tetap1000000. Tanpa PPN/insurance/additional discount/add_fee/service_fee; seluruh field nominal terkait nol kecuali pada matriks.

Diskon barang `P0`: disc0/disc_amount0, total_disc0, line amount1000000.
Diskon barang `P10`: **disc10/disc_amount100000**, total_disc100000, line amount900000; 1000000×10/100=100000 tepat tanpa rounding.

`sub_total=1000000`, `grand_total = net barang + shipping_cost customer` (shipping_cost omitted diperlakukan expected0 hanya untuk perhitungan independen kasusF; GET tetap harus membuktikan payable). Angka uang/persentase request selalu JSON numbers integer. `add_disc`, `total_tax`, `insurance_cost`, `add_fee`, `service_fee`, serta line tax_amount tetap0. Tidak mengubah unit price untuk menyamarkan diskon.

**OMIT** berarti key benar-benar tidak ada di request, bukan null/empty string/0. Nilai0 berarti key dikirim dengan JSON number0. Tidak ada eksperimen null/empty string pada tranche ini. GET dapat mengisi default field omitted; perbedaan actual request tetap dicatat, tidak disimpulkan hanya dari bentuk GET.

## Matriks lengkap dan urutan eksekusi

| Urut/kasus | Diskon barang | shipping_cost | original_shipment_cost | shipping_cost_discount | Expected grand_total | Pembanding/pertanyaan |
| --- | --- | --- | --- | --- | --- | --- |
| 1/A | P0 | 0 | OMIT | OMIT | 1000000 | Baseline tanpa diskon dan ongkir |
| 2/B | P10 | 0 | OMIT | OMIT | 900000 | DibandingA: pengaruh diskon barang saja |
| 3/C | P0 | 10000 | OMIT | OMIT | 1010000 | DibandingA: ongkir customer tanpa diskon barang/subsidi metadata |
| 4/D | P10 | 10000 | OMIT | OMIT | 910000 | DibandingB/C: kombinasi diskon barang dan ongkir biasa |
| 5/E | P10 | 10000 | OMIT | 0 | 910000 | DibandingD: key shipping_cost_discount bernilai0 versus omitted |
| 6/F | P10 | OMIT | OMIT | OMIT | 900000 | DibandingB: shipping_cost omitted versus explicit0 |
| 7/G | P10 | 10000 | 30000 | OMIT | 910000 | DibandingD: original_shipment_cost saja |
| 8/H | P10 | 10000 | OMIT | 20000 | 910000 | DibandingD/E: shipping_cost_discount saja/nonzero |
| 9/I | P0 | 10000 | 30000 | 20000 | 1010000 | DibandingC: subsidi metadata tanpa diskon barang |
| 10/J | P10 | 10000 | 30000 | 20000 | 910000 | DibandingD/G/H/I: kombinasi lengkap dan interaksi |

G/H sengaja mengisolasi metadata, bukan menyatakan representasi accounting lengkap benar. Header payable dikirim eksplisit dan harus cocok pada GET; jangan menganggap provider pasti menghitung net shipping dari original/discount. Nilai actual yang dinormalisasi provider atau error tetap evidence, bukan alasan mengubah formula diam-diam.

Kasus kontrol yang diperkirakan lebih aman dijalankan lebih dahulu; hasil tetap unknown sampai diuji. Jika stop rule terpicu, kasus berikutnya **tidak otomatis dijalankan** walaupun termasuk budget/matriks; laporkan hasil dan sisa kasus untuk keputusan pemilik.

## Budget dan side effects yang diminta

- Tambahan maksimum **10 create attempts**, baseline kumulatif23; maksimum kumulatif33 attempts jika semua kasus didispatch. HTTP500/timeouts/missingID tetap mengonsumsi attempt; bukan10 successful SO.
- Maksimum **10 conversion invoice-only attempts**, satu untuk masing-masing SO yang lolos verifikasi. Nol mirror/edit, nol payment POST/gabungan, nol cancel/retry.
- Maksimum qty10 unit fixtures baru. Stock dapat terpakai/ter-reserve hingga10 unit; satu unit on_order existing tidak disentuh. Recheck sebelum setiap create wajib.
- Invoice yang berhasil dibiarkan sebagai artefak sandbox **belum dibayar**. Tidak cancel post-invoice, tidak auto-cleanup pre-invoice, tidak mengubah stock untuk mengembalikan kondisi.
- Tidak melakukan kontak support, mengubah akun/config, atau menggunakan source lain.

## Protokol aktual per kasus

1. Login memakai credentials `.env` yang telah dinyatakan sandbox; token hanya in-memory. GET dummy116918, master157190/SKU157190/price1000000/unitBuah, dan NoTax1. Pastikan seluruh konstanta cocok. Jika tidak, stop; tidak mencari fixture pengganti otomatis.
2. Recheck stock157190/location2 sebelum setiap create. Bila available<1, stop. Simpan baseline filtered invoice/payment lists untuk observasi, tanpa raw customer response.
3. Bentuk payload A–J sesuai matriks. `salesorder_id=0`, `salesorder_no="[auto]"`, tanggal saat request, note/ref baru unik berisi run+case, channel_status Belum Bayar. Contact/customer dummy berasal GET; required line fields lengkap, IDs detail0 saat create. Simpan dispatch intent sebelum satu POST `/sales/orders/`.
4. Response create harus memiliki ID valid. GET `/sales/orders/{id}`: konfirmasi id/contact/source/location/ref, satu line SKU/qty/price/unit/tax/detailID, discount/amount/header payable expected. Baca lokasi baris melalui `location_id` atau `loc_id`, berhenti jika konflik. Untuk field omitted: catat default provider; nominal nol/null/missing boleh dicatat sebagai default hanya untuk metadata tidak diwajibkan, tetapi payable/line/header wajib readable dan tepat.
5. **Tidak melakukan mirror** pada rangkaian ini: langsung GET pre-conversion, lalu satu POST `/sales/packlists/create-invoice` dengan `{salesorder_id:<fixture ID>}`. Pilihan ini menghilangkan edit/mirror sebagai variabel tambahan, tetapi berarti hasil sukses tidak otomatis membuktikan jalur lama dengan mirror aman.
6. Jika conversion sukses, response id diperlakukan sebagai invoice ID; GET invoice dan GET SO untuk linkage. Periksa line price/qty/disc/disc_amount/amount dan header goods discount/tax/payable/shipping terhadap expected, serta payment_amount0 bila terbaca. Catat field metadata shipping yang tersedia/tidak tersedia pada invoice; tidak menganggap omitted invoice field otomatis nol atau preservation proven. Stock lookup setelah case, lalu lanjut case berikut hanya jika seluruh verifikasi wajib cocok.
7. Jika field metadata yang dikirim tidak terpelihara di SO, mandatory money/identity mismatch, response sukses tanpa ID, HTTP5xx/network/timeout, atau response error ambigu: **stop seluruh business writes**, lakukan reconciliation read-only, lalu laporkan. Tidak otomatis lanjut ke kasus berikut atau mengulangi case yang sama dengan ref baru.
8. Structured HTTP400 yang jelas menolak request dicatat sebagai definite rejection, bukan error journal dan bukan successful case. Reconciliation/read stock sebelum case independen berikutnya boleh lanjut dalam matriks yang disetujui bila penolakan benar-benar definite. HTTP400 generik/ambigu, auth failure, atau status yang tidak jelas tetap stop.
9. Reconciliation terbatas GET SO/invoice fixture yang diketahui, filtered invoice/payment lists dengan pagination coverage, detail invoice candidates yang teridentifikasi, dan stock lookup read-only. Absence pada API bukan proof rollback; fixture ambigu tidak di-cancel.
10. Journal `research-08-field-matrix-results.json` menyimpan input field presence (OMIT vs0), case label, HTTP/code, IDs, quantity/nominal, hasil verifikasi dan stop reason. Proyeksi allowlist, bukan raw full request/response; token/credentials/customer PII tidak disimpan.

## Acceptance dan batas kesimpulan

- Hasil tiap kasus dibedakan: not-run, definite rejection, SO mismatch, invoice conversion error, invoice verified, atau invoice verification unknown/mismatch. HTTP200 saja bukan bukti sukses kontrak.
- Laporan memuat actual input/output tersanitasi, perbandingan kasus terdekat, perubahan stock dan artefak yang ditinggalkan, serta field/kombinasi yang menjadi kandidat penyebab pada envelope ini.
- Tidak menyebut causal universal hanya dari satu case. Perbedaan G/H/J dapat mengidentifikasi conditional failing combination, bukan membuktikan akar exception internal atau accounting yang tepat.
- Jika A gagal, dugaan bukan hanya diskon/subsidi: baseline/account/inventory/endpoint perlu diteliti dahulu; jangan menghabiskan sisa cases.
- Tidak menjalankan aplikasi, unit/E2E/build/lint/typecheck; tidak ada perubahan aplikasi. Semua verifikasi provider dimiliki main agent. Tidak menyelesaikan tiket08/09 atau mengubah scope finance lewat eksperimen ini.

## Referensi

- [Preflight dan pemeriksaan namespace](research-08-field-matrix-item157190.json).
- [Catatan persiapan](research-08-field-matrix.md).
- [Vendor saveSalesOrderRequest](../../docs/jubelio-api/dist.yaml#L24893).
- [Vendor invoice-only](../../docs/jubelio-api/dist.yaml#L9248) dan [schema conversion](../../docs/jubelio-api/dist.yaml#L26987).
- [Stock lookup read-only](../../docs/jubelio-api/dist.yaml#L5124).
- [Parser alias lokasi existing](../../apps/store/src/lib/jubelio-sales-client.ts#L1278).

## Approval

Pemilik memilih **Setuju, maksimal10 kasus (Recommended)** pada pertanyaan approval protokol lengkap. Ini mengizinkan A–J berurutan, maksimal10 create dan10 invoice-only attempts, tanpa mirror/payment/cancel/retry; global stop pada hasil ambigu atau mismatch tetap berlaku. Approval bukan izin aplikasi/commit, perubahan accounting, atau kelanjutan otomatis sesudah stop.

## Hasil eksekusi

Dijalankan2026-10-18 sekitar10:17UTC. [Laporan evidence](research-08-field-matrix-evidence.md), [journal](research-08-field-matrix-results.json). **A–G invoice verified**, H create berhasil namun conversion23113, **I/J not-run** sesuai global stop. Terpakai8/10 create dan8/10 invoice attempts; kumulatif31 create attempts. Tidak ada mirror/payment/cancel/retry atau perubahan order historis. Global stop aktif; dua slot sisa tidak dipakai otomatis.

## Otorisasi kelanjutan I/J

Setelah menerima laporan H dan reconciliation, pemilik secara eksplisit memerintahkan **jalankan I dan J dulu**. Agent melanjutkan **dua kasus independen yang belum pernah dibuat**, bukan retry H atau perubahan SO existing. I: diskon barang0, original30000/subsidi20000/net shipping10000, grand1010000. J: diskon barang10%/100000, komponen shipping sama, grand910000. Konstanta item157190/location2/price1000000/qty1/NoTax1 tetap.

Gunakan dua slot tersisa: maksimal2 create dan2 invoice-only attempts baru, total matriks tetap maksimal10 dan kumulatif maksimal33 create attempts. Login/master/dummy/tax/stock dan filtered list baselines dibaca ulang. Tidak ada mirror/payment/cancel/retry, perubahan stock/account mapping/aplikasi, atau write pada H dan fixtures lama. **Global stop tetap berlaku: jika I ambigu atau mismatch, reconciliation read-only lalu berhenti sebelum J.** Tidak ada izin melanjutkan otomatis sesudah stop baru. Journal continuation terpisah: `research-08-field-matrix-ij-results.json`; journal awal tidak ditimpa.

### Checkpoint I dan izin khusus J

I dibuat **SO68434**, GET nominal1010000 cocok, tetapi satu conversion invoice-only kembaliHTTP500/code23113. Global stop dijalankan sebelum J; reconciliation read-only menunjukkan invoice_idnull, filtered invoice/payment lists tanpa artefak baru, stock14/3/11. [Evidence checkpointI](research-08-field-matrix-ij-evidence.md).

Setelah menerima outcome ambigu I, pemilik memilih **Ya, jalankan J (Recommended)** pada pertanyaan izin terpisah. J boleh dijalankan sebagai **satu fixture baru** dengan disc10/nominal100000/net900000, original30000/subsidy20000/net shipping10000, grand910000. Maksimal satu create dan satu invoice-only conversion setelah preflight/GET cocok, tanpa mirror/payment/cancel/retry atau write pada I/H/fixtures historis. Ini menggunakan **slot terakhir**, bukan tambahan di luar limit10. Kumulatif sebelumJ32, maksimal sesudahJ33 create attempts. Hentikan seluruh business writes setelah hasilJ; bila ambigu hanya reconciliation read-only. Journal khusus `research-08-field-matrix-j-results.json`, tanpa menimpa journalI.

### Hasil akhir kelanjutan

J dibuat **SO68435**, GET seluruh nominal910000 cocok, tetapi satu conversion invoice-only kembaliHTTP500/code23113. Reconciliation menunjukkan invoice_idnull dan stock14/4/10; filtered invoice/payment lists tetap10/3 artefak yang sudah dikenal, bukan proof rollback. [Evidence I/J](research-08-field-matrix-ij-evidence.md), [journalJ](research-08-field-matrix-j-results.json).

Seluruh A–J kini dieksekusi:7 invoice verified(A–G),3 conversion errors23113(H/I/J). Budget matriks10/10 create dan10/10 invoice attempts habis, kumulatif33 create attempts. Tidak ada mirror/payment/cancel/retry atau perubahan order historis. Stop business writes aktif; tidak ada slot tersisa atau izin cleanup otomatis.
