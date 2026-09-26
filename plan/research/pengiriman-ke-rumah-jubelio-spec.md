# Draf spec issue — Pengiriman ke rumah via Jubelio Shipment

> Draf lokal untuk ditinjau; **belum diterbitkan ke issue tracker dan belum berlabel `ready-for-agent`**. Disusun dari riset pengiriman ke rumah dan keadaan implementasi Sales Order terbaru. Keputusan yang masih memerlukan bukti vendor/produk ditandai sebagai prasyarat, bukan dianggap sudah disetujui.

## Problem Statement

Pelanggan Okcir saat ini hanya dapat menyelesaikan pesanan dengan mengambilnya di satu cabang. Pelanggan yang ingin barang diantar ke rumah tidak dapat memilih alamat, mengetahui ongkos kirim yang dapat dipertanggungjawabkan, atau mengikuti pengiriman. Staf cabang tidak memiliki alur kemas, resi, serah-terima, dan penanganan kendala yang terhubung ke pesanan. Mengubah checkout tanpa menjaga Sales Order Jubelio, pembayaran Midtrans, dan verifikasi pickup berisiko menagih nominal yang salah, menggandakan pesanan/stock movement, atau menganggap pesanan sudah siap diambil sebelum layak dipenuhi.

## Solution

Pertahankan **Ambil di cabang** dan tambahkan **Kirim ke alamat** untuk keranjang dari satu cabang asal. Pelanggan memilih alamat lengkap dari wilayah Jubelio Shipment atau alamat tersimpan, memilih layanan yang benar-benar tersedia, dan melihat ongkir serta total final sebelum membayar. Harga dan kelayakan dihitung ulang oleh server; alamat, asal, layanan, dan uang dibekukan pada pesanan sehingga pembayaran ulang dan perubahan buku alamat tidak mengubah apa yang dibeli.

Pesanan tetap melalui satu lifecycle Sales Order Jubelio yang sudah dipakai checkout: tahan ketersediaan lokal → buat/konfirmasi Sales Order → Midtrans → settlement invoice/pembayaran terverifikasi. Setelah settlement, pesanan pickup mengikuti alur kode pickup yang ada; pesanan delivery masuk antrean pemenuhan cabang **tanpa kode pickup**. Staf cabang mengemas, memesan pengiriman secara aman melalui Jubelio Shipment, menyimpan resi, mencatat serah-terima, dan menangani exception. Status dari Shipment ditampilkan kepada pemilik pesanan setelah diverifikasi/direkonsiliasi. Jangan aktifkan checkout delivery berbayar atau menjanjikan resi/label otomatis sampai akses tenant, harga, idempotensi/rekonsiliasi, signature webhook, dan alur sandbox tervalidasi. Jika prasyarat tidak terpenuhi, pickup tetap tersedia; pilot tarif tetap + pemesanan manual memerlukan keputusan produk/operasional terpisah.

## User Stories

1. Sebagai pelanggan, saya ingin tetap memilih ambil di cabang, sehingga saya tidak kehilangan cara belanja yang sekarang bekerja.
2. Sebagai pelanggan, saya ingin memilih kirim ke alamat ketika cabang dan barang mendukungnya, sehingga barang dapat diterima di rumah.
3. Sebagai pelanggan, saya ingin tahu cabang asal barang, sehingga saya memahami dari mana pesanan dikirim.
4. Sebagai pelanggan dengan barang dari beberapa cabang, saya ingin diberi penjelasan bahwa checkout satu pesanan belum didukung, sehingga saya dapat memisahkan pesanan tanpa kejutan ongkir.
5. Sebagai pelanggan, saya ingin mengisi nama serta telepon penerima, sehingga kurir dapat menghubungi orang yang tepat.
6. Sebagai pelanggan, saya ingin memilih provinsi, kota/kabupaten, kecamatan, dan kelurahan/area yang valid, sehingga tujuan dikenali oleh layanan pengiriman.
7. Sebagai pelanggan, saya ingin memeriksa kode pos dan menulis jalan, nomor rumah, unit, serta patokan, sehingga paket memiliki alamat yang dapat ditemukan.
8. Sebagai pelanggan, saya ingin menyimpan alamat ke buku alamat, sehingga checkout berikutnya lebih cepat.
9. Sebagai pelanggan, saya ingin menetapkan satu alamat utama, sehingga checkout berikutnya langsung memilih tujuan yang biasa saya gunakan.
10. Sebagai pelanggan, saya ingin mengganti atau membuat alamat saat checkout, sehingga saya dapat mengirim hadiah atau pindah tujuan sebelum membayar.
11. Sebagai pelanggan, saya ingin mengedit dan menghapus alamat tersimpan milik saya, sehingga buku alamat tetap akurat.
12. Sebagai pelanggan, saya ingin perubahan alamat tersimpan tidak mengubah alamat pesanan lama, sehingga riwayat dan pengiriman yang telah dibayar tetap benar.
13. Sebagai pelanggan, saya ingin melihat hanya layanan kurir yang berlaku untuk asal, tujuan, dan paket saya, sehingga saya tidak memilih layanan yang tidak tersedia.
14. Sebagai pelanggan, saya ingin melihat ongkir yang akan ditagih dan ETA hanya jika informasinya valid, sehingga saya dapat menilai biaya dan waktu secara realistis.
15. Sebagai pelanggan, saya ingin melihat subtotal, diskon yang berlaku, PPN, biaya layanan, ongkir, dan total, sehingga saya tahu nominal yang dibayar.
16. Sebagai pelanggan, saya ingin diberi tahu apabila alamat, isi keranjang, cabang, atau harga ongkir berubah sebelum pemesanan, sehingga saya dapat menyetujui total baru.
17. Sebagai pelanggan, saya ingin checkout gagal secara jelas jika alamat tidak valid atau tarif tidak tersedia, sehingga saya tidak membayar pesanan dengan ongkir nol yang keliru.
18. Sebagai pelanggan, saya ingin pembayaran ulang memakai nominal dan alamat pesanan yang sama, sehingga percobaan pembayaran baru tidak diam-diam mengubah perjanjian awal.
19. Sebagai pelanggan, saya ingin pesanan belum dibayar tidak memesan kurir, sehingga pembatalan/masa berlaku habis tidak membuat resi atau tagihan kirim.
20. Sebagai pelanggan pickup, saya ingin menerima kode pickup hanya ketika settlement terverifikasi, sehingga proses pengambilan lama tetap aman.
21. Sebagai pelanggan delivery, saya ingin pembayaran berhasil tidak disebut “siap diambil”, sehingga informasi pemenuhan sesuai kenyataan.
22. Sebagai pelanggan delivery, saya ingin melihat alamat tujuan, cabang asal, layanan, dan ongkir pada rincian pesanan saya, sehingga saya dapat mengonfirmasi pesanan.
23. Sebagai pelanggan delivery, saya ingin melihat nomor resi dan tautan pelacakan hanya setelah benar-benar tersedia, sehingga saya tidak menerima informasi palsu.
24. Sebagai pelanggan delivery, saya ingin melihat perubahan status pengiriman yang telah diverifikasi, sehingga saya tahu apakah paket menunggu kurir, sedang dikirim, terkendala, atau diterima.
25. Sebagai pelanggan delivery, saya ingin diberi tahu saat ada kendala yang perlu tindak lanjut, sehingga saya tidak dibiarkan menunggu tanpa kejelasan.
26. Sebagai pelanggan, saya ingin alamat dan telepon saya hanya terlihat oleh saya dan staf berwenang, sehingga data pribadi terlindungi.
27. Sebagai Admin User cabang, saya ingin melihat antrean pesanan delivery yang berasal dari Home Branch saya, sehingga saya dapat mengemas dan memproses pesanan yang menjadi tanggung jawab cabang.
28. Sebagai Admin User cabang berizin, saya ingin hanya dapat menindak pesanan dalam Authorized Branch, sehingga saya tidak dapat mengubah kiriman cabang lain.
29. Sebagai Admin User cabang berizin, saya ingin menandai pesanan siap dikemas dan mengajukan resi setelah pembayaran serta settlement Sales Order terverifikasi, sehingga barang yang belum layak tidak dikirim.
30. Sebagai Admin User cabang berizin, saya ingin melihat nomor resi, hasil booking, ongkir pelanggan, dan harga booking penyedia, sehingga saya dapat mengidentifikasi selisih biaya.
31. Sebagai Admin User cabang berizin, saya ingin mencatat serah-terima ke kurir secara terpisah dari penerbitan resi, sehingga status fisik paket tidak ditebak dari respons API.
32. Sebagai Admin User berizin, saya ingin kasus booking ambigu atau gagal muncul dalam antrean pemeriksaan dengan alasan dan ID yang diketahui, sehingga tidak terjadi pengiriman ganda akibat mengulang permintaan secara buta.
33. Sebagai Admin User berizin, saya ingin peristiwa status ganda atau tidak berurutan tidak memundurkan status akhir, sehingga riwayat pesanan tetap masuk akal.
34. Sebagai Admin User berizin, saya ingin status terkirim/retur/bermasalah dibedakan, sehingga tindakan lanjutan tidak disamakan dengan selesai.
35. Sebagai Admin User berizin, saya ingin hanya pesanan pickup yang bisa diverifikasi dengan kode pickup, sehingga pesanan delivery tidak dapat diselesaikan lewat jalur pengambilan.
36. Sebagai administrator Role, saya ingin Permission Grants pengiriman dapat didelegasikan dengan Branch Scope yang berlaku, sehingga akses booking/pemeriksaan tidak otomatis mengikuti nama Role HQ atau Admin.
37. Sebagai operator, saya ingin kegagalan quote, pembayaran, settlement, booking, webhook, dan rekonsiliasi terekam tanpa membocorkan kredensial atau alamat lengkap, sehingga saya dapat menelusuri kasus dengan aman.
38. Sebagai operator, saya ingin pesanan yang dibayar tetapi settlement atau booking belum terbukti tetap terlihat dan belum dinyatakan selesai, sehingga saya dapat memulihkan kasus tanpa kehilangan pesanan.
39. Sebagai pengelola katalog/cabang, saya ingin asal kirim dan berat/dimensi paket yang valid menjadi prasyarat layanan, sehingga tarif tidak dihitung dengan berat nol atau alamat cabang yang tidak lengkap.
40. Sebagai pengelola toko, saya ingin pickup tetap berfungsi ketika Shipment tidak tersedia, sehingga gangguan provider tidak memaksa perubahan tidak aman pada alur lama.

## Implementation Decisions

- **Batas domain:** satu order memiliki satu cabang asal dan satu metode `pickup` atau `delivery`; tidak ada split shipment lintas cabang dalam rilis ini. Pelanggan toko (`client`) dan Admin User tetap dua identitas/sesi yang terpisah. Semua order baru tetap memakai Sales Order Jubelio; jangan hidupkan kembali inventory adjustment atau membuat Sales Order kedua khusus delivery.
- **Alamat:** gunakan form tertulis dan hierarki wilayah **Jubelio Shipment**, bukan ID wilayah Omnichannel; simpan ID sebagai string dan verifikasi relasi area–kode pos di server. Buku alamat milik satu client, set-default atomik dengan maksimum satu alamat utama. Alamat yang dipakai order adalah snapshot immutable, bukan hanya foreign key ke buku alamat. Tidak perlu pin peta/koordinat.
- **Asal dan parcel:** siapkan profil pengiriman cabang (kontak, alamat, kode pos, area dan kemampuan kirim) serta data berat/dimensi yang dapat dipercaya; tanpa data yang diperlukan jangan tawarkan tarif/checkout delivery. Master Jubelio yang tersinkron tidak boleh ditimpa sebagai konfigurasi lokal secara sembarangan.
- **Harga:** hanya backend memakai kredensial Shipment untuk mendapatkan opsi layanan; `POST /rates/all` atau `/rates` memakai asal, tujuan, berat/paket. Menurut kontrak v1.8, tarif pelanggan berasal dari `rates`, **bukan** otomatis `final_rates`. Kontrak tidak menjamin quote ID atau TTL; aturan umur quote dan perubahan harga harus didefinisikan aplikasi setelah validasi provider. Ketika keranjang/alamat/cabang berubah, opsi lama tidak sah. Server memvalidasi lagi pada place-order; jika harga berubah, minta persetujuan nominal baru, bukan membuat Midtrans dengan angka dari browser. ETA hanya jika provider memberi nilai yang dapat dipakai.
- **Uang:** snapshot subtotal, diskon, PPN, ongkir, biaya layanan, total dan nilai yang dikirim ke Midtrans maupun Sales Order Jubelio harus konsisten. Re-payment memakai snapshot order dan Sales Order yang sama; jangan mengambil tarif/alamat baru secara diam-diam. Aturan voucher ongkir, dasar pajak ongkir/asuransi, selisih quote–harga booking, dan pihak penanggung selisih memerlukan keputusan bisnis sebelum diaktifkan.
- **Lifecycle:** checkout mempertahankan local hold, durable Sales Order intent, konfirmasi GET, lalu Snap. Midtrans berwenang atas status uang; invoice dan pembayaran Jubelio yang terverifikasi menjadi gerbang fulfillment. Pesanan pickup baru menjadi `ready_for_pickup` dan menerima kode pickup setelah gerbang itu; pesanan delivery yang lolos menjadi siap diproses pengiriman **tanpa** kode pickup/email pickup. Paid-but-blocked tetap paid, mempunyai alasan dan masuk `manual_review`; tidak dibooking. Status fulfillment delivery terpisah dari status uang dan tidak menjadi `completed` hanya karena AWB dibuat. Transisi/constraint skema harus mengikuti semua pembaca status yang ada.
- **Booking:** lakukan setelah settlement terverifikasi dan kesiapan barang dikonfirmasi staf. Persist intent sebelum `POST /shipments/create`, lakukan klaim dispatch satu kali, simpan `shipment_id`, AWB, `ref_no`, kurir/layanan, tracking URL tervalidasi, quote, serta `price` hasil booking. `ref_no` bukan jaminan idempotensi vendor. Setelah timeout tanpa AWB/ID yang diketahui, jangan ulang POST otomatis; masuk pemeriksaan manual sampai ada cara rekonsiliasi yang terbukti. Jangan anggap API Omnichannel `request-awb-order` sebagai booking Shipment.
- **Pelacakan:** callback Shipment terpisah dari webhook Omnichannel; sebelum diaktifkan, minta fixture signed vendor dan buktikan algoritma/encoding signature (kontrak v1.8 ambigu SHA-256 vs HMAC-SHA256). Verifikasi raw body, deduplikasi, tangani urutan event, dan rekonsiliasi dengan GET AWB yang diketahui. Simpan event seperlunya dengan PII teredaksi. `tracking.status` kurir bukan enum `latest_status`; `DELIVERED` terverifikasi (atau bukti yang disepakati) yang mengizinkan penyelesaian delivery, bukan hanya status WMS/label/serah-terima.
- **Otorisasi admin:** gunakan Permission Catalog/Permission Grants per Action dan Branch Scope, dengan Authorized Branch diturunkan di server dari Current Policy/Home Branch. Aksi booking/packing bukan implikasi otomatis dari izin `verify-pickup`; Pickup Verification tetap mensyaratkan Home Branch. Simpan Audit Event untuk tindakan staf; pesanan luar Authorized Branch tidak bocor lewat list, detail, atau mutasi. Jangan memberi hak khusus berdasarkan nama Role HQ/Admin.
- **Penyimpanan dan operasi:** skema bersama saja yang mendefinisikan data baru; migrasi dihasilkan, seeder diperbarui, waktu memakai `timestamptz`. Ledger shipment/riwayat event mendukung satu shipment aktif per order untuk MVP dan riwayat pembatalan/rebook di masa depan. Semua endpoint baru menggunakan logger terstruktur (sukses dan gagal), autentikasi yang sesuai, rate-limit sewajarnya, dan minimisasi PII. Env/cron/webhook menuntut konfigurasi deployment dan dokumentasi API/fitur.
- **Gerbang rilis:** verifikasi akses tenant dan kontrak Shipment terkini, semantik satuan berat/volumetrik dan `rates` vs harga booking, keamanan webhook, aturan timeout, kurir aktif, serta sandbox order website dari quote sampai delivered. Validasi Sales Order yang sudah ada tetap satu-satunya sumber perubahan stok. Bila belum terbukti, metode delivery tetap nonaktif; pilot manual hanya boleh menjadi spesifikasi lanjutan setelah harga dan SOP disetujui.

## Testing Decisions

- Uji perilaku yang terlihat dari batas publik, bukan pemanggilan helper, bentuk state internal, atau jumlah fungsi. Misalnya: pelanggan mengganti alamat setelah menerima opsi kirim → checkout meminta ongkir baru; pembayaran ulang tetap memakai total yang dibekukan; callback ganda tidak menghasilkan dua AWB. Ekspektasi angka dan status berasal dari kontrak/fixture independen, bukan hasil fungsi yang sedang diuji.
- **Seam utama:** alur browser + HTTP checkout/order di storefront (termasuk kembali dari pembayaran dan akun/alamat) serta browser + HTTP order admin. Perluas pola Playwright checkout dan admin orders yang sudah ada; uji pickup lama berdampingan dengan delivery, pembatasan Branch Scope, tampilan resi, kasus paid-but-blocked, dan akses owner. Seluruh interaksi eksternal yang destruktif memakai fixture/isolasi sandbox terkontrol, bukan menulis produksi.
- **Seam keamanan dan pemulihan yang perlu:** uji HTTP webhook Shipment dan route admin terhadap status DB/operasi durable dengan fixture signature vendor; uji DB-backed untuk set-default bersamaan, klaim booking paralel, snapshot alamat/harga, settlement-vs-booking, replay/out-of-order, dan kegagalan setelah provider POST. Utamakan seam request/hasil order; gunakan uji adapter/kontrak provider hanya untuk bentuk API, signature, dan kasus timeout yang tidak mungkin dibuktikan lewat browser.
- Prior art: suite Playwright checkout storefront, orders dan sales-review-queue admin; uji lifecycle/ledger Sales Order dan hold stok yang sudah DB-backed. Jalankan unit suite dan E2E terkait UI/routing/auth sebelum menganggap fitur selesai; uji sandbox Shipment terpisah sebagai bukti integrasi aktual, bukan disamakan dengan test double. Jangan mengklaim pengujian tersebut sudah berjalan untuk spec ini.

## Out of Scope

- Split order/pengiriman lintas cabang, beberapa paket aktif, COD, asuransi opsional, same-day/instant sebagai janji produk, voucher gratis ongkir, refund otomatis, RTO/klaim otomatis, dan perubahan alamat sesudah booking.
- Pin peta, OpenStreetMap/Nominatim, koordinat untuk quote/booking.
- Label Shipment dan pickup kurir/manifest otomatis **sebelum** endpoint, izin tenant, dan alur nyata terbukti; cetak label tidak boleh diasumsikan dari API Omnichannel atau plugin WooCommerce.
- Migrasi ulang lifecycle Sales Order, mode adjustment lama, stok ganda, atau pengaktifan deployment produksi.
- Pilot ongkir flat/booking manual tanpa keputusan harga, tanggung jawab selisih, prosedur operasional, dan refund yang terpisah.

## Further Notes

- Dokumen riset sumber: `plan/research/pengiriman-ke-rumah-jubelio.md`; kontrak yang ditranskripsi: `docs/jubelio-api/shipment-v1.8.md`. Transkripsi bukan bukti aktivasi tenant atau versi kontrak terbaru. `dist.yaml` adalah API **Omnichannel yang berbeda**.
- Riset awal menggambarkan stock adjustment dan kode pickup langsung setelah pembayaran; implementasi terkini telah beralih ke Sales Order serta gerbang settlement invoice/pembayaran. Spec ini mengikuti keadaan terkini yang dijelaskan pada dokumentasi Sales Order dan rencana cutover, bukan menghidupkan ulang alur riset yang sudah usang. Uji sandbox settlement terbaru masih memiliki kasus invoice ambigu; jangan menyimpulkan semua skenario provider sudah lulus.
- Contoh: client memilih alamat Bandung dan layanan dengan `rates` Rp20.000, lalu mengganti tujuan menjadi Jakarta. Opsi Bandung tidak boleh dipakai lagi; server harus mendapatkan opsi untuk Jakarta dan menampilkan total baru sebelum Midtrans. Jika pembayaran telah dibuat untuk Bandung, perubahan buku alamat berikutnya tidak boleh mengubah alamat snapshot pesanan itu.
- **Konfirmasi seam pengujian diminta sebelum issue diberi status siap:** seam utama yang diusulkan adalah alur HTTP/browser store dan admin, ditambah HTTP webhook serta DB-backed concurrency khusus operasi durable. Belum ada persetujuan eksplisit pengguna atas seam tersebut dalam percakapan ini.
