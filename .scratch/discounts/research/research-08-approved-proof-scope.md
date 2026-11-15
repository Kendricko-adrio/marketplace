# Scope bukti tiket08 yang direvisi dan disetujui

## Approval pemilik

Setelah menerima penjelasan gap research dan empat pertanyaan scope, pemilik memilih:

1. **Ya, fokus mapping terpilih (Recommended)** — keluarkan pembuktian field ongkir/funding yang tidak digunakan dari required proof08; keterbatasannya tetap dicatat, bukan verified.
2. **Per baris, add_disc0 (Recommended)** — scope awal memakai diskon barang per baris; lifecycle add_disc nonzero tidak wajib dibuktikan untuk scope awal.
3. **Pisahkan tindak lanjutnya (Recommended)** — outcome ambigu dan cleanup fixtures lama dipisahkan dari gate bukti kontrak baru, tanpa proof rollback/izin cancel atau publikasi tiket baru.
4. **SO + nominal lifecycle (Recommended)** — original ongkir diverifikasi pada SO; invoice/payment dinilai melalui field nominal dan linkage yang tersedia. Tidak mengklaim original metadata internal invoice verified.

Ini **approval revisi scope/acceptance bukti research08**, bukan penyelesaian tiket, complete contract09, izin implementasi/provider write tambahan, cleanup, subagent atau commit. Mapping barang + net ongkir yang dipilih sebelumnya tidak dibuka kembali.

## Mapping yang menjadi sasaran bukti

- Barang tetap memakai unit price dan diskon SO, bukan workaround penurunan unit price/gross payment.
- Diskon nominal/fixed/capped dialokasikan ke baris; total_disc menjumlahkan diskon baris, add_disc0.
- original_shipment_cost = ongkir sebelum subsidi customer.
- shipping_cost = net ongkir customer setelah subsidi yang eligible/clipped menurut02.
- shipping_cost_discount **OMIT dari request**, bukan0/null/empty string. Default response0 boleh diamati tanpa dianggap request mengirim key.
- Subsidi/funding merchant serta quote/biaya kurir disimpan terpisah di website/order snapshot, mengikuti finance04. Tidak memerlukan writable seller/platform funding field provider sebagai gate08.
- Source INTERNAL dan pemisahan PPN/fee website versus payable Jubelio tidak berubah.

## Bukti aktif yang tetap diperlukan

1. **Nominal baris/agregat:** disc_amount whole-line konsisten untuk qty>1, fixed/capped allocation tepat dan total_disc sesuai penjumlahan; tidak menghitung ulang Rupiah authoritative dari persen GET yang terpotong.
2. **SO terpilih:** identity/source/location/item/qty/unit/tax, original sebelum subsidi, net shipping, diskon dan payable cocok dengan expected independen; shipping_cost_discount absent pada actual request.
3. **Full-payload mirror:** ID/detail IDs dan komponen finansial mapping terpilih terpelihara, hanya marker/status yang ditargetkan berubah.
4. **Invoice:** nominal barang/diskon/net ongkir/payable dan linkage SO–invoice cocok melalui GET independen. Tidak mewajibkan original metadata pada invoice GET yang memang tidak mengekspos field tersebut.
5. **Payment:** nominal exact sama dengan payable provider terverifikasi, association invoice/SO tepat, payment tercatat dan due0. Jangan menyamakan total customer website termasuk PPN/fee dengan payable provider.
6. **Qty>1 pada satu baris sampai lifecycle yang relevan:** bukti SO/interpretasi whole-line saja belum membuktikan preservation sampai invoice/payment. Dua baris masing-masingqty1 bukan pengganti pengujian satu barisqty2.
7. **Safe cancel bila eligible:** kewajiban original08 terkait pre-invoice cancel dan stock consistency tidak dihapus oleh empat keputusan ini. Gunakan evidence existing bila benar-benar cocok; tidak otomatis cancel fixtures yang conversion-nya ambigu atau post-invoice.

Bukti existing yang relevan dapat dipakai; jangan mengulang semua eksperimen atau menguji setiap kombinasi universal tanpa gap konkret. Payment/mirror/qty>1 pada konfigurasi ongkir terpilih belum lengkap pada checkpoint approval scope, lalu dipenuhi T1–T3 setelah approval protokol terpisah. [Hasil lifecycle dan review acceptance](research-08-selected-lifecycle.md#review-acceptance-tiket08). Protokol/budget/request actual di luar yang telah selesai tetap memerlukan izin terpisah sebelum write.

### Contoh acceptance, bukan protokol write baru

Net barang900000 + net ongkir10000 → invoice/payment provider910000, association benar/due0. Original30000 tetap terverifikasi di SO; website menyimpan subsidi20000 dan quote/provider cost terpisah. Invoice GET yang tidak menampilkan original tidak dianggap proof metadata hilang dan tidak menghalangi acceptance nominal/linkage yang dipilih.

## Tidak lagi menjadi gate scope awal

- Unit persen/amount, safe settlement dan dukungan semua nilai shipping_cost_discount yang tidak akan dikirim.
- Writable seller/platform funding fields pada endpoint provider yang tidak digunakan oleh mapping terpilih.
- Preservation add_disc nonzero sampai invoice/payment. Tidak menyatakan header discount didukung untuk scope awal.
- Proof original_shipment_cost tersimpan di invoice internal saat public invoice GET tidak mengeksposnya.
- Outcome/cleanup fixtures research lama sebagai penghalang bukti kontrak baru. Pemisahan ini bukan mengubah unknown menjadi sukses, non-application, rollback, canceled atau cleanup selesai.

Input yang tidak dipakai tidak dianggap didukung. Unknown precedence disc-only/nominal-only/inconsistent metadata tetap dicatat sebagai unknown, bukan diberi klaim kontrak universal berdasarkan hasil yang ada.

## Tindak lanjut legacy tetap tercatat

Outcome B/G awal tanpaID dan conversion errors pada SO68422–68425,68433–68435,68438–68439 tetap unknown menurut evidence terakhir. Semua catatan request/response/list/stock dan larangan blind retry tetap berlaku. Public API absence bukan audit rollback; state aman dan izin terpisah wajib sebelum cancellation/cleanup atau write pada order tersebut.

Referensi legacy dipertahankan di [research evidence](research-08-evidence.md) dan journals yang sudah ada; tidak membuat tiket/tracker baru atau kontak support otomatis. Invoice sandbox sukses/unpaid juga bukan objek auto-cancel. Pada checkpoint approval scope, stock tercatat12/6/6 pada item157190/location2; setelah T1–T3, lookup terakhir9/6/3. [Journal lifecycle](research-08-selected-lifecycle-results.json). Pencatatan scope/status ini sendiri bukan fresh API lookup.

## Status dan langkah berikut

Setelah **approval protokol T1–T3**, seluruh kewajiban aktif direview terhadap [hasil lifecycle](research-08-selected-lifecycle.md#review-acceptance-tiket08) dan evidence existing. T1qty1 danT2qty2 membuktikan full mirror → invoice → payment dengan association benar/due0; T3 membuktikan mirror → safe cancel pre-invoice/stock restore. Metadata original invoice dan legacy unknown tetap ditangani sesuai empat keputusan di atas, bukan diam-diam diberi klaim verified.

Tiket08 kini **resolved pada scope terpilih**;09 tetap **open/unclaimed dan sudah unblocked** karena prerequisite08 resolved. Ini tidak menyelesaikan complete mapping contract09 atau mengizinkan implementasi.

Pada pencatatan approval scope belum ada request baru (baseline37); protokol T1–T3 kemudian memakai3 create, sehingga kumulatif sekarang40 create attempts. Tidak ada perubahan aplikasi/schema/master/account mapping/env, unit/E2E/build/lint/typecheck aplikasi, subagent atau commit. Provider writes tambahan, cleanup atau implementasi tetap memerlukan approval terpisah.

## Referensi

- [Mapping ongkir yang dipilih](research-08-selected-shipping-mapping.md).
- [Tiket08](../wayfinder/08-jubelio-nonzero-discount-evidence.md), [tiket09](../wayfinder/09-provider-representation-and-settlement.md).
- [Evidence diskon/lifecycle existing](research-08-evidence.md).
- [Matriks ongkir](research-08-field-matrix-evidence.md), [ablation berhasil](research-08-without-shipping-discount.md).
- [Finance04](../wayfinder/04-tax-and-shipping-subsidy-accounting.md#answer--keputusan-final-disetujui).
