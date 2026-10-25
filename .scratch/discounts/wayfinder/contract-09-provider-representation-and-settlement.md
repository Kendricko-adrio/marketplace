# Kontrak diskon dan pembayaran Jubelio — tiket 09

Status: disetujui pemilik sebagai kontrak planning, dengan [koreksi scope berikutnya](decision-zero-payment-and-no-service-fee.md): website tanpa service fee; kewajiban pembuktian pembayaran/provider Rp0 dicoret, bukan ditunda. Evidence status mirror post-invoice/payment tersedia pada scope M1/M2. Lihat §7.

Dokumen ini menetapkan keputusan planning, bukan izin implementasi atau request Jubelio. [Tiket 09](09-provider-representation-and-settlement.md) resolved sebagai keputusan setelah kontrak disetujui, tetapi aplikasi belum boleh dianggap siap launch selama syarat pada bagian 7 belum terpenuhi.

## 1. Tujuan dan batas

Nominal diskon website harus tercatat sebagai diskon barang Jubelio, dengan pembayaran yang sesuai dan pemeriksaan independen. Cakupan awal mengikuti keputusan produk: harga coret, maksimal satu kupon atau kode promo barang/ongkir, pickup dan delivery.

Gunakan source INTERNAL dan pajak/fee provider nol. Jangan menyamarkan source, menurunkan unit price untuk menyembunyikan diskon, membayar gross barang, atau mengubah accounting/config provider sebagai jalan pintas. Pilihan akun dan jenis payment mengikuti konfigurasi sah yang diperiksa; sandbox account2/type0 bukan otomatis konfigurasi production.

## 2. Acuan uang dan data yang dibekukan

Website menghitung potongan dan membekukan hasil saat order dibuat. Provider hanya menerima representasinya, bukan menghitung ulang aturan kupon.

Per baris barang simpan: identity barang, quantity, harga awal per unit dari Jubelio, harga setelah potongan harga coret, nominal potongan harga coret seluruh baris, alokasi kupon barang seluruh baris, dan net barang. Alokasi/pembulatan mengikuti [keputusan 02](02-offer-eligibility-and-money-basis.md#answer--keputusan-final-disetujui).

Per order simpan: jumlah harga awal barang, total potongan harga coret, subtotal setelah harga coret sebelum kupon, total kupon barang, net barang, ongkir sebelum subsidi, subsidi/funding merchant, net ongkir customer, quote/biaya kurir, dasar/rate/nominal PPN, total customer (tanpa service fee), dan expected tagihan Jubelio. Simpan identitas aturan/harga yang digunakan serta versi kontrak dan hubungan order–SO–invoice–payment.

Potongan harga coret dan kupon tetap dapat dibedakan di website walaupun digabung pada baris Jubelio. Ongkir sebelum subsidi tidak otomatis sama dengan biaya kurir. Jangan mengurangi subsidi atau diskon dua kali.

PPN hanya atas net barang, dibulatkan ke atas sekali dari total dasar sesuai [keputusan finance 04](04-tax-and-shipping-subsidy-accounting.md#answer--keputusan-final-disetujui). Ongkir dan fee tidak menjadi dasar PPN. Midtrans dan pembayaran lanjutan memakai total/data tersimpan, bukan harga/promo/ongkir terbaru.

## 3. Mapping SO

| Field | Kontrak |
| --- | --- |
| `items[].price` | Harga awal per unit yang dibekukan saat order dibuat |
| `items[].qty_in_base` | Quantity barang |
| `items[].disc_amount` | Potongan harga coret + alokasi kupon barang untuk seluruh baris; tidak dikalikan quantity lagi |
| `items[].disc` | Persentase turunan: `100 × disc_amount / (price × qty)` untuk gross positif; bukan potongan tambahan |
| `items[].amount` | `price × qty − disc_amount` |
| `sub_total` | Jumlah gross barang sebelum seluruh potongan |
| `total_disc` | Jumlah `disc_amount` semua baris |
| `add_disc` | `0`; tidak memakai header discount nonzero |
| `original_shipment_cost` | Ongkir customer sebelum subsidi; pickup nol |
| `shipping_cost` | Net ongkir customer setelah subsidi; pickup nol |
| `shipping_cost_discount` | Tidak ada pada actual request; bukan `0`, `null`, atau empty string |
| `tax_amount`, `total_tax`, `add_fee`, `service_fee` | Nol; tax record tetap harus valid dengan rate nol, bukan ID pajak sembarang |
| `grand_total` | Net barang + net ongkir customer |

Funding subsidi merchant, biaya kurir, dan PPN tidak otomatis dijurnal provider. Website tidak mengenakan service fee; field fee provider pada tabel di atas tetap nol, bukan biaya customer. Tidak memakai writable funding field yang tidak digunakan pada mapping terpilih.

Nominal Rupiah menjadi acuan. Persentase GET provider yang dibulatkan tidak boleh digunakan untuk menghitung ulang diskon. Saat create, persentase diturunkan dari nominal tanpa pembulatan dini; saat mirror, persentase GET yang sudah pendek boleh dipertahankan jika nominal dan seluruh pemeriksaan lain cocok. Persentase bukan alasan membolehkan selisih uang.

Baris gross nol tidak boleh dibagi nol atau dipaksakan memakai rumus persen; dukungannya belum diklaim dari evidence. Tidak ada kewajiban membuktikan settlement provider Rp0 menurut koreksi scope pemilik pada bagian 7; jangan menambah nominal sebagai workaround.

## 4. Kontrak per tahap dan pemeriksaan

Expected uang berasal dari snapshot lokal dan intent request tersimpan, bukan sekadar menjumlahkan ulang response provider lalu menyebutnya cocok. Format decimal strings seperti `10000.0000` boleh dinormalisasi; selisih Rp1 tidak boleh diterima. Noise serialisasi bukan toleransi bisnis.

| Tahap | Syarat konfirmasi |
| --- | --- |
| Create SO | GET independen memastikan SO/contact/source/cabang/referensi, identity baris, quantity, unit price, nominal diskon, net baris, gross/discount/net total, original/net ongkir serta pajak/fee/header discount sesuai expected. Simpan detail IDs yang diperlukan untuk edit berikutnya. HTTP200 saja bukan bukti. |
| Mirror tulisan Status Channel | GET sebelum edit harus cocok dengan identity, state, data keuangan dan hubungan invoice yang diharapkan. Payload memakai SO/detail IDs asli, unit/lokasi/source/tax identity dan seluruh uang tetap; hanya tulisan status yang berubah. Shipping discount tetap omitted. GET sesudah edit membuktikan perubahan status dan preservation. |
| Invoice | Tetap alur invoice-only lalu payment terpisah. GET SO dan invoice memastikan hubungan ID, contact/cabang, baris/quantity/unit price/diskon/net, total diskon/net ongkir/payable dan kondisi invoice yang benar. Jangan wajibkan `invoice.salesorder_id` ketika null: gunakan linkage SO `invoice_id` dan bukti identity lain. Original ongkir wajib terbukti pada SO; tidak mengklaim metadata internal invoice yang tidak terekspos. |
| Payment | Hanya setelah invoice cocok dengan expected payable. Nominal payment = payable tersebut, bukan total customer atau subtotal lama. GET payment membuktikan ID, nominal, akun/jenis sesuai intent dan tepat satu hubungan ke invoice/SO yang benar; paid amount invoice sama dengan payable dan remaining due nol. HTTP200/flag `SO.is_paid` saja tidak cukup. |
| Cancel | Hanya SO yang aman dibatalkan sebelum invoice, dengan identity/state terverifikasi dan tidak ada invoice/payment yang sudah dikirim atau ambigu. Verifikasi canceled serta stock kembali sesuai mekanisme existing. Tidak mengizinkan cancel post-invoice/refund. |

Mirror adalah informasi status, bukan bukti pembayaran atau izin fulfillment. Kegagalan mirror tidak mengubah bukti customer sudah bayar maupun mengubah uang/order website. Tindakan edit setelah invoice memerlukan bukti bagian 7; pemilik tidak memilih menonaktifkan sinkronisasi tersebut sebagai scope launch. Bukti bounded M1/M2 kini tersedia melalui pengujian sandbox berizin terpisah, bukan izin mengubah aplikasi atau melakukan edit di luar scope.

## 5. State gagal atau belum pasti

- Intent dicatat sebelum write, dispatch diklaim sekali melalui ledger existing; jangan membuat sistem SO/payment kedua. Request provider tetap di luar transaksi DB.
- Selisih identity/quantity/uang atau hubungan dokumen yang salah menghentikan tahap berikutnya. Jangan memperbaiki nominal secara otomatis di provider.
- Timeout, HTTP5xx, sukses tanpa ID, atau kegagalan membaca konfirmasi sesudah write dianggap belum pasti; jangan kirim ulang transaksi secara otomatis. GET/list yang relevan boleh digunakan untuk reconciliation sesuai batas akses; belum ditemukan di list bukan bukti rollback.
- Jika tidak dapat dibuktikan benar, tahan dan arahkan ke pemeriksaan manual dengan ID, tahap, expected/observed amount, dan alasan yang aman dari PII. Simpan ID hasil write segera bila tersedia agar bisa diperiksa, bukan dibuat ulang.
- Penolakan yang definitif berbeda dari hasil ambigu, tetapi tidak memberi izin retry write otomatis. Tidak ada cancel/cleanup otomatis terhadap outcome ambigu.
- Bukti Midtrans paid tetap dicatat; order yang pembayaran Jubelionya belum terverifikasi tidak boleh masuk fulfillment normal. Pemakaian jatah kupon mengikuti keputusan 03, bukan dibatalkan hanya karena provider bermasalah.
- Mirror yang gagal dicatat untuk pemeriksaan tanpa membatalkan settlement yang sudah terbukti. Kegagalan informasi status tidak boleh membuka/menutup fulfillment sendiri.

## 6. Versi dan contoh acceptance

Order dan intent payload baru memiliki versi kontrak yang eksplisit. Mirror/recovery memakai versi tersimpan, tidak menerapkan formula baru pada payload lama. Versi tidak dikenal atau data wajib tidak lengkap ditahan, bukan ditebak. Order lama tetap memakai snapshot lamanya, tetapi karena aplikasi belum live, tidak ada proyek migrasi/backfill atau pemulihan khusus data dev/staging dalam scope tiket ini. Pernyataan data boleh diubah tidak menjadi izin reset/delete sekarang.

Contoh berikut merupakan expected independen; PPN 11% hanya untuk ilustrasi. Website tidak mengenakan service fee. Satu kupon/kode per order tetap berlaku.

| Kasus | Uang barang dan ongkir | Tagihan Jubelio | Total customer |
| --- | --- | --- | --- |
| Pickup, harga coret + kupon | Base300000 → harga coret150000, kupon15000; net135000, PPN14850 | 135000 | 149850 |
| Kupon nominal/capped dua baris | Gross259000+250000, alokasi10177+9823=20000; net489000, PPN53790 | 489000 | 542790 |
| Delivery, subsidi ongkir | Base1000000 → harga coret900000; original30000−subsidi20000=net10000, PPN99000 | 910000 | 1009000 |
| Quantity2 | Gross2000000, diskon whole-line200000; net1800000, net ongkir10000, PPN198000 | 1810000 | 2008000 |
| Subsidi menghabiskan ongkir | Net barang900000; original12000/subsidi12000/net0; PPN99000 | 900000 | 999000 |

Pemeriksaan implementasi berikutnya wajib mencakup mapping per baris/agregat, nominal/persen dibulatkan provider, quantity>1, harga coret+kupon, fixed/capped, shipping0/tanpa subsidi/dengan subsidi, snapshot pembayaran lanjutan, versi, duplicate callbacks/dispatch, mismatch/ambiguity, safe cancel dan mirror sesuai state. Ini acceptance planning, bukan klaim tests aplikasi sudah berjalan.

## 7. Bukti tersedia dan syarat sebelum launch

### Fakta yang sudah didukung

[Evidence 08](../research/research-08-evidence.md) dan [T1–T3](../research/research-08-selected-lifecycle.md#review-acceptance-tiket08) mendukung diskon whole-line, fixed/capped dua baris, precision nominal, original/net ongkir tanpa shipping discount request, mirror sebelum invoice/cancel, invoice/payment exact untuk qty1/qty2 dan safe cancel yang eligible. Original metadata invoice tidak terekspos dan tidak diwajibkan. GET shipping discount default0 bukan mismatch field presence request.

### Status kewajiban evidence dan koreksi scope pemilik

1. **Sinkronisasi tulisan status setelah invoice — terpenuhi pada scope M1/M2.** [Protokol, hasil dan review main agent](../research/research-09-post-invoice-mirror.md#hasil-kelanjutan-dan-review-main-agent) membuktikan marker sesudah invoice (`Menunggu Verifikasi`) dan sesudah payment (`Siap Proses` → `Selesai`) mempertahankan SO/detail, invoice/detail dan payment/detail IDs, linkage, seluruh uang/diskon/ongkir dan stock pada dua fixtures baru. SO68443/invoice45974/payment59, qty1/payable910000; SO68444/invoice45975/payment61, qty2/payable1810000; association tepat, due0. Actual shipping discount field tetap omitted. Ini menutup gap stage provider08 pada envelope source INTERNAL/tax0/account2/type0, satu baris qty1/qty2/diskon10%/original30000/net shipping10000. Bukan proof universal semua input/config atau tests aplikasi; integration dan coverage acceptance aplikasi tetap wajib sebelum aktivasi. Tidak ada perubahan scope kontrak atau izin implementasi dari hasil ini.
2. **Outstanding 2 — dicoret oleh pemilik, bukan ditunda.** [Koreksi scope pembayaran dan service fee](decision-zero-payment-and-no-service-fee.md) menegaskan pembayaran Rp0 tidak termasuk scope operasional, dijaga melalui prosedur admin dan pemilik bisnis, serta website tidak mengenakan service fee. Tidak ada kewajiban merancang atau membuktikan settlement pembayaran/provider Rp0 sebagai acceptance test atau launch gate. Contoh fee Rp2.000 ditarik. Ini keputusan scope, bukan bukti dukungan provider Rp0 atau asumsi invoice otomatis settled.

Implementasi dan pengujian aplikasi sesuai kontrak tetap pekerjaan mendatang, bukan selesai lewat tiket planning atau pencoretan outstanding 2. Jika ditemukan konfigurasi/input di luar batas bukti, jangan mengklaim dukungan universal atau diam-diam mengubah kontrak; bawa gap konkret untuk keputusan/bukti tambahan sebelum diaktifkan.

Unit `shipping_cost_discount`, funding fields yang tidak digunakan, header discount nonzero, serta cleanup outcome legacy tetap di luar scope awal yang disepakati pada08. Tidak membukanya kembali sebagai syarat baru; outcome lama tidak dianggap rollback/canceled. Tidak ada izin provider write, perubahan config, implementasi, subagent, commit, atau cleanup dari persetujuan dokumen ini.

## 8. Persetujuan

Pemilik mengonfirmasi kesepahaman dan meminta draft melalui `ask_user_question` dengan pilihan **Sesuai, tulis draft (Recommended)**. Setelah menerima link dokumen lengkap beserta ringkasan dua launch gates dan batas izin, pemilik memberikan approval akhir melalui **Setuju, finalkan (Recommended)**. Tiket09 resolved sebagai kontrak keputusan; pada approval awal dua launch gates bagian 7 masih terbuka. Approval kontrak tidak mengizinkan implementasi, provider testing/writes, subagent, commit, atau launch. Pengujian status post-invoice berikutnya memperoleh izin terpisah; hasil dan status evidence terkini tercatat pada §7 serta [research09](../research/research-09-post-invoice-mirror.md).

Verifikasi sesi ini: pembacaan evidence08, keputusan02/04, glossary, dokumentasi dan kode existing untuk mapping/create/mirror, invoice/payment serta operation ledger; review kontrak terhadap jawaban pemilik dan aritmetika contoh independen. Tidak ada request Jubelio atau unit/E2E/build/lint/typecheck aplikasi.
