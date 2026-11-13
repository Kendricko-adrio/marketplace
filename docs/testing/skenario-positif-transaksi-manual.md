# Skenario positif transaksi manual: client → admin

Checklist manual untuk **pickup dan delivery**, dari checkout sampai pesanan selesai. Hanya positive case; bukan laporan hasil testing. “Manual” berarti tester menjalankan flow melalui UI, bukan memakai fitur **Selesaikan manual** pada delivery.

## 1. Persiapan

- Gunakan environment testing/sandbox yang disetujui; pembayaran dan booking pengiriman dapat menimbulkan transaksi nyata jika memakai production.
- Siapkan client yang sudah login/onboarding, produk dengan stok cukup, serta admin dengan izin lihat/edit pesanan dan Home Branch yang sama dengan cabang order.
- Pickup: siapkan tanggal/jam pengambilan yang valid. Delivery: siapkan alamat penerima valid, cabang asal siap pengiriman, serta layanan kurir tersedia.
- Catat harga SKU, quantity, rate PPN, promo yang dipakai, dan nomor order. Gunakan nomor order yang sama saat membandingkan client, admin, dan pembayaran.
- Untuk variasi diskon/subsidi, gunakan promo aktif yang syarat, kuota, dan budget-nya terpenuhi. Perhitungan pada §4–5 berlaku untuk **pricing contract 1**; konfirmasi mode environment sebelum memakai contoh. Order legacy mengikuti snapshot/formula legacy, bukan dihitung ulang dengan rumus baru.

## 2. Pickup — transaksi sampai selesai

| No. | Pelaku | Langkah manual | Hasil yang dipastikan |
|---|---|---|---|
| P1 | Client | Pilih cabang, tambahkan produk ke cart, atur quantity, lalu checkout item terpilih. | SKU/varian, cabang, quantity, dan harga sesuai pilihan. |
| P2 | Client | Pilih **Pickup**, isi kontak, tanggal/jam pengambilan valid, lalu lanjut ke **Bayar & Pesan**. | Kontak, cabang, dan jadwal benar; ongkir Rp0. |
| P3 | Client | Periksa rincian pembayaran, gunakan promo valid bila skenario memakainya, setujui review, lalu **Bayar Sekarang**. | Subtotal, diskon, PPN, dan total sesuai §4; nominal pembayaran sama dengan total review. |
| P4 | Client | Selesaikan pembayaran sandbox dengan sukses, lalu buka detail order. | Pembayaran `paid`; setelah invoice/payment Jubelio terverifikasi, order `ready_for_pickup`, kode pickup tersedia, dan nominal tidak berubah. Periksa email siap diambil jika email testing aktif. |
| P5 | Admin | Buka **Pesanan → Pickup**, cari nomor order, buka detail. | Client, cabang, item, quantity, jadwal, status paid, dan rincian nominal cocok dengan order client. |
| P6 | Client + Admin | Client menunjukkan kode pickup; admin verifikasi kode saat barang diserahkan. | Order `completed` di admin dan client; pembayaran tetap `paid`, nominal tetap sama. |

## 3. Delivery — transaksi sampai selesai

| No. | Pelaku | Langkah manual | Hasil yang dipastikan |
|---|---|---|---|
| D1 | Client | Pilih produk/cabang, checkout, pilih **Delivery**, isi kontak dan pilih/isi alamat penerima valid. | Item, quantity, penerima, telepon, alamat, dan cabang asal benar. |
| D2 | Client | Pilih layanan kurir, lanjut ke **Bayar & Pesan**, gunakan promo valid bila diperlukan, lalu periksa review. | Kurir/layanan benar; ongkir quote, subsidi, ongkir net, diskon barang, PPN, dan total sesuai §4. |
| D3 | Client | Setujui review, klik **Bayar Sekarang**, dan selesaikan pembayaran sandbox. | Nominal pembayaran sama dengan review; setelah verifikasi settlement, order `processing`/`paid`, alamat/layanan tetap, tanpa kode/instruksi pickup. |
| D4 | Admin | Buka **Pesanan → Delivery → Perlu dikerjakan**, cari nomor order dan periksa detail. | Item, penerima, alamat, layanan, cabang, status paid, dan nominal cocok dengan client; tahap **Siapkan barang**. |
| D5 | Admin | Siapkan barang sesuai quantity, lalu **Tandai siap**. | Tahap **Barang siap**; belum ada booking hanya karena barang ditandai siap. |
| D6 | Admin | Buka **Pesan pengiriman**, cek barang/alamat/layanan/ongkir, lalu konfirmasi booking. | Booking berhasil, AWB/resi tersedia, tahap **Menunggu penjemputan**; total tagihan client tidak berubah. |
| D7 | Admin | Setelah paket benar-benar diserahkan ke kurir, pilih **Catat serah terima**. | Serah terima tercatat; order masuk monitoring, belum completed hanya karena ada AWB/serah terima. |
| D8 | Client + Admin | Pantau tracking; gunakan update kurir/simulator sandbox yang terkontrol sampai `DELIVERED`, lalu muat ulang detail. | Tracking/resi cocok; setelah bukti `DELIVERED` terverifikasi, order `completed`/`paid` di client dan admin. Total tetap sama. |

## 4. Field nominal yang wajib dicocokkan

Bandingkan **review checkout → popup/halaman pembayaran → detail client → detail admin**. Popup pembayaran wajib cocok pada **total**, tidak harus menampilkan seluruh breakdown. Field teknis yang tidak tersedia di UI dapat diperiksa melalui respons detail order/DB read-only oleh tim teknis; jangan menganggap field yang tidak tampil bernilai nol.

| Field / label | Yang harus benar |
|---|---|
| Harga SKU/varian dan quantity | Harga per unit × quantity dihitung untuk item terpilih saja; SKU/varian tidak tertukar. |
| Harga sumber (`sourceGoodsSubtotal`) | Jumlah harga sumber per unit × quantity, sebelum Markdown. |
| Markdown (`markdownTotal`) | Jumlah potongan harga SKU × quantity; tidak dipotong lagi sebagai diskon promo. |
| **Subtotal** (`subtotal`) | Harga sumber − Markdown; merupakan total barang setelah Markdown, sebelum diskon promo. |
| **Diskon** (`discount` / `goodsDiscount`) | Diskon promo barang saja; nilai sesuai promo yang disetujui. Subsidi ongkir bukan diskon barang. |
| Barang net (`netGoods`) | Subtotal − diskon barang. |
| Ongkir awal (`shippingBeforeSubsidy`) | Quote layanan yang dipilih sebelum subsidi; pickup = Rp0. |
| Subsidi ongkir (`shippingSubsidy`) | Potongan sesuai promo, maksimal sebesar ongkir awal. Pickup = Rp0. |
| **Ongkos Kirim** (`shippingCost`) | Ongkir awal − subsidi, yaitu ongkir yang dibayar client. Pickup = Rp0. |
| **PPN (%)** (`ppnRate`) | Rate yang tersimpan pada order; contoh 11% di bawah bukan kewajiban rate environment. |
| **PPN nominal** (`ppnAmount`) | `ceil(netGoods × rate / 100)`, dibulatkan ke atas sekali per order. Ongkir tidak masuk dasar PPN kontrak 1. |
| Biaya layanan (`serviceFee`) | Kontrak 1 = Rp0; tidak ada tambahan charge layanan. |
| **Total Pembayaran** (`total`) | Barang net + PPN + ongkir net; sama dengan nominal yang dibayar di Midtrans dan total pada client/admin. |
| Nama/status/benefit promo | Promo yang dipilih sesuai order. Baris **Promo** di admin adalah informasi benefit; jangan menguranginya lagi jika sudah masuk Diskon atau subsidi ongkir. |

**Khusus biaya delivery di admin:** cek **Ongkir checkout**, **Biaya booking**, **Tagihan kurir**, dan **Rincian selisih**. Biaya booking/tagihan kurir dapat berbeda dari ongkir client; selisih tidak menambah pembayaran client. Tagihan yang belum tersedia bukan Rp0. Contoh: ongkir checkout Rp20.000, booking Rp25.000, tagihan Rp30.000 → selisih terhadap checkout Rp5.000 dan Rp10.000, tanpa mengubah total order.

**Jika memeriksa Jubelio:** cocokkan SO/invoice/payment dengan `expectedProviderPayable` dan versi kontrak pada order. Provider contract **3** memasukkan PPN sehingga payable = barang net + PPN + ongkir net; contract **2** tidak memasukkan PPN sehingga payable = barang net + ongkir net. Jangan memakai satu rumus untuk semua order/history.

## 5. Variasi positive case dan contoh amount

Ulangi flow §2/§3 dengan order baru untuk setiap baris yang relevan. Fixture contoh: **harga sumber Rp100.000 × quantity 2**, tanpa Markdown kecuali baris terakhir, **PPN 11%**, ongkir delivery **Rp30.000**. Sesuaikan data aktual dengan promo/quote yang benar-benar tersedia; jangan memaksa contoh menjadi tarif kurir.

| Variasi | Metode | Subtotal | Diskon barang | Barang net | Subsidi | Ongkir net | PPN | Total client |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| Tanpa promo | Pickup | 200.000 | 0 | 200.000 | 0 | 0 | 22.000 | **222.000** |
| Tanpa promo | Delivery | 200.000 | 0 | 200.000 | 0 | 30.000 | 22.000 | **252.000** |
| Promo barang fixed Rp20.000 | Pickup | 200.000 | 20.000 | 180.000 | 0 | 0 | 19.800 | **199.800** |
| Promo barang fixed Rp20.000 | Delivery | 200.000 | 20.000 | 180.000 | 0 | 30.000 | 19.800 | **229.800** |
| Promo subsidi ongkir Rp15.000 | Delivery | 200.000 | 0 | 200.000 | 15.000 | 15.000 | 22.000 | **237.000** |
| Markdown menjadi Rp90.000/unit + promo barang Rp20.000 | Pickup / Delivery | 180.000 | 20.000 | 160.000 | 0 | 0 / 30.000 | 17.600 | **177.600 / 207.600** |

Untuk menguji kedua cara aktivasi promo, jalankan variasi diskon barang menggunakan **kupon publik**, lalu order terpisah dengan **manual promo code** valid. Satu order memakai satu pilihan promo, bukan kupon publik + kode manual sekaligus. Markdown tetap dapat digabung dengan promo yang eligible.

## 6. Catatan hasil singkat

Salin per order: `Tanggal | Tester | Variasi | Nomor order | Metode | Subtotal | Diskon | PPN | Ongkir net | Total review/payment/client/admin | Status akhir | Lulus/belum diverifikasi | Bukti`.

Lulus jika seluruh langkah positive case terpenuhi, total sesuai perhitungan, rincian client/admin konsisten, serta status akhir `completed`/`paid`. Dokumen ini belum menyatakan skenario sudah dijalankan.

### Referensi

- [Alur pickup dan pembayaran](../features/order-flow.md)
- [Workflow delivery admin](../features/admin-delivery-workflow.md)
- [Kontrak pricing dan field snapshot](../features/versioned-checkout-pricing.md)
- [Promo checkout dan subsidi ongkir](../features/discount-redemption.md)
- [Settlement Jubelio, termasuk kontrak provider3](../features/jubelio-sales-orders.md#kontrak-provider3--ppn-pada-so-invoice-dan-payment)
- Implementasi breakdown admin: `apps/admin/src/app/admin/orders/[id]/page.tsx`.
