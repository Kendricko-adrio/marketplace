# Draf pertanyaan ke Jubelio — Shipment API (untuk ditinjau & dikirim pemilik)

Status: **sebagian besar terjawab oleh keputusan pemilik (2026-09-27) — lihat `## Jawaban pemilik` di bawah; tidak perlu dikirim ke vendor dalam bentuk ini**; pemilik menegaskan dokumentasi = source of truth sehingga pertanyaan yang sudah dijawab dokumen tidak perlu dikirim. Tidak ada yang dikirim otomatis. Rujukan: kontrak **API Contract Jubelio Shipment v1.8** dan transkripsinya [`docs/jubelio-api/shipment-v1.8.md`](../../docs/jubelio-api/shipment-v1.8.md).

**Pembaruan 2026-09-27 (uji live berizin):** no. **1** (aktivasi produksi) dan **3** (scope kredensial = produksi) **terjawab** oleh uji live — hapus atau ubah menjadi permintaan **kredensial sandbox**; no. **4** terjawab untuk `GET /services/categories` (tidak butuh Bearer), sisanya (wilayah/district/area) belum diuji. Sisa pertanyaan tetap relevan untuk dikirim.

**Pembaruan keputusan tiket 08:** no. **20 tidak perlu dikirim untuk desain MVP**, bukan telah dijawab vendor: pemilik memilih SO pickup/delivery barang saja tanpa ongkir/pajak; website/Midtrans mencatat PPN website dan ongkir delivery. No. 21 masih opsional untuk konsultasi vendor mengenai asuransi; kurir wajib-asuransi dikecualikan sementara.

---

Perkenalkan, kami sedang mengintegrasikan Jubelio Shipment API untuk pengiriman pesanan website (bukan Omnichannel). Kami memegang kontrak **API Contract Jubelio Shipment v1.8**. Mohon konfirmasi poin-poin berikut:

**A. Akses & kontrak**
1. Apakah akun kami sudah diaktifkan untuk Jubelio Shipment API (sandbox dan produksi)? Jika belum, apa langkah aktivasinya?
2. Apakah v1.8 masih kontrak terbaru yang berlaku? Apakah ada perubahan path (mis. `/rates/all` vs `/webstore/rates/all`)?
3. Kami sudah memiliki kredensial sandbox — mohon konfirmasi apakah pasangan `client_id`/`client_secret` tersebut memang untuk environment sandbox (`api-shipment.sandbox.jubelio.com`).
4. Apakah endpoint GET wilayah/kategori (`GET /region/*`, `GET /services/categories`, `GET /regions`) memerlukan Bearer token? (Kontrak tidak menampilkannya secara eksplisit.)

**B. Tarif & tagihan**
5. Satuan field `weight` di level atas request `/rates` dan `/rates/all` — gram? (Contoh `1000`.) Apakah sama dengan `items[].weight` dan `package_detail.weight` yang tertulis gram?
6. Rumus volumetrik: bila `items[]` dan `package_detail` keduanya dikirim, mana yang dipakai dan bagaimana pembulatannya?
7. Harga mana yang benar untuk ditagih ke pelanggan: `rates` atau `final_rates`/`discount_rates`? Kontrak v1.8 (hlm. 16, 18–19) menyuruh memakai `rates` — mohon konfirmasi, terutama bila ada `promotion`.
8. Berapa lama hasil quote tetap berlaku? Apakah harga saat `POST /shipments/create` dijamin sama dengan quote sebelumnya?
9. Kapan biaya ditagih (saat create AWB / saat pickup / selesai), dan bagaimana penanganan bila `price` booking berbeda dari quote?

**C. Booking & siklus hidup AWB**
10. Bolehkah `ref_no` diisi nomor referensi unik milik kami (ID pesanan website)? Apakah ia mencegah dobel booking bila request diulang?
11. Jika request `POST /shipments/create` timeout sebelum kami menerima AWB, bagaimana cara mencari apakah shipment sudah terbentuk? (Kontrak hanya menyediakan lookup berdasarkan AWB.)
12. Aturan lengkap pembatalan (`POST /shipments/cancel`): batas waktu sebelum pickup, kondisi yang membuat kurir menolak, dan kebijakan refund.

**D. Webhook**
13. Kontrak v1.8 (hlm. 21) bertentangan: prosa menyebut SHA-256 payload+secret, contoh Node.js memakai HMAC-SHA256 dengan key = secret. Mana yang benar? Bagaimana encoding raw body persisnya dan format signature (hex)? Mohon **contoh payload sandbox yang sudah ber-signature** untuk kami uji.
14. Daftar event apa saja yang dikirim, apakah ada retry/kirim ulang, dan apakah urutan event dijamin?

**E. Label & operasional**
15. Kontrak v1.8 tidak mencantumkan endpoint label. Apa jalur resmi untuk mendapatkan/mencetak label pengiriman?
16. Apakah ada rate limit pada API Shipment, dan apakah polling `GET /shipments/awb/{awb}` diperbolehkan untuk rekonsiliasi?
17. Apakah status `RETURNED` dan `SHIPMENT_ISSUE` punya sub-kode/keterangan? Mohon daftar kode `tracking.status` kurir bila ada.
18. Untuk pesanan website internal (bukan channel marketplace), apakah wajib membuat Sales Order Omnichannel, dan bagaimana efeknya terhadap stok?
19. **Baru (hasil uji create 2026-09-27):** hasil `POST /shipments/create` di produksi menghasilkan AWB berprefix **`MOCK-`** (contoh `MOCK-JS2420810000000001`) dan `shipment_id` mulai dari 1. Apakah tenant kami masih dalam mode mock/test? Bagaimana proses berpindah ke kurir live, dan apakah booking mock berdampak tagihan?

**F. Asuransi (tambahan dari tiket 03; no. 20 dibatalkan untuk MVP oleh tiket 08)**

20. **Tidak dikirim pada MVP.** Pertanyaan historis mengenai field ongkir dan kesamaan total SO/website digugurkan oleh [keputusan pemilik tiket 08](issues/08-bukti-penerimaan-spec.md), **bukan** telah dijawab vendor. SO pickup/delivery hanya item barang setelah diskon, `tax_amount` item/`total_tax` SO 0 dan tanpa ongkir; invoice/pembayaran Jubelio diverifikasi pada nilai barang SO, sedangkan website/Midtrans memakai snapshot total pelanggan termasuk PPN website dan ongkir delivery. Jangan mengarang field ongkir SO atau menuntut total kedua sistem sama. Jika desain produk berubah nanti, ajukan pertanyaan baru secara terpisah.
21. Apa semantik field `shipping_insurance` pada response `rates`/`rates/all` — premi asuransi (Rp) atau nominal pertanggungan? Uji live kami menampilkan nilai kecil (100–5.100) untuk semua kurir. Bila kami selalu booking dengan `is_insurance: false`, apakah kurir dengan aturan asuransi wajib menurut S&K Jubelio (SiCepat, barang >Rp500.000) tetap dapat di-quote dan di-booking tanpa premi, atau premi terpasang otomatis/tetap ditagih? Apakah ada kurir yang menolak booking tanpa asuransi?

---

Catatan pemakaian: pertanyaan 1–4 menutup tiket "akses & kontrak"; 5–9 memengaruhi tiket quote→pembayaran (06); 10–12 tiket booking/timeout (04, 07); 13–14 tiket webhook (05); 15, 16–18 operasional & spec (08); 20 dibatalkan untuk MVP oleh 08; 21 kebijakan asuransi (03). Hapus nomor yang tidak relevan sesuai kebutuhan.

## Jawaban pemilik (2026-09-27)

| No | Jawaban pemilik | Implikasi untuk desain |
|---|---|---|
| 1 | Akun sudah aktif | Konsisten bukti live |
| 2 | v1.8 adalah versi terakhir yang akan dipakai | Kontrak terkunci ke v1.8 |
| 3 | Kredensial yang dipakai adalah **kredensial sandbox** (dikonfirmasi), dioperasikan **via URL produksi** | Koreksi interpretasi sebelumnya: bukan "produksi-scope", melainkan **sandbox tenant pada URL prod** — konsisten dengan AWB `MOCK-` |
| 4 | Ya, terjawab (GET kategori tanpa Bearer) | Cukup; district/area ikuti perilaku yang teramati saat dibutuhkan |
| 5 | `weight` dalam **gram** (semua level) | Konversi gram di server kita |
| 6 | Tidak perlu rumus volumetrik sendiri; kirim nilai sesuai kontrak, vendor yang hitung | Kirim `items[]`/`package_detail` apa adanya; jangan implementasi kalkulasi sendiri |
| 7 | Tentukan sendiri dari hasil uji + API | **Pakai `rates`** — bukti live: 19/19 sampel `rates == final_rates`, kontrak menyuruh `rates`, booking `price` == `rates`; simpan `final_rates` hanya untuk audit |
| 8 | **Tidak ada TTL; harga dijamin** | Quote dapat diikat ke order tanpa kebijakan kedaluwarsa; tetap cek ulang `price` == `rates` saat create (rekonsiliasi) |
| 9 | Tagihan kurir di luar cakupan app; yang penting request benar | Ketidakpastian charge diterima pemilik |
| 10 | `ref_no` boleh diisi ID pesanan kami | Korelasi order↔shipment resmi |
| 11 | Cek via **GET AWB** | Timeout → tandai untuk tinjauan admin (AWB terlihat di dashboard Jubelio) |
| 12 | Aturan cancel mengacu hasil uji | Cancel sebelum pickup terbukti; kasus kurir-live ditangani SOP manual |
| 13 | **Ikuti dokumentasi** (contoh kode PDF: HMAC-SHA256, key = secret, message = payload+secret) | Implementasi verifikasi webhook per contoh dokumen; validasi dengan event nyata pertama |
| 14 | Terima semua event yang dikirim, tanpa asumsi urutan | Desain event-agnostic + dedupe + rekonsiliasi GET AWB |
| 15 | Pemilik bertanya apa itu label → dijelaskan (lembar resi/barcode pada paket); **belum dibutuhkan di mode mock** | Tunda sampai kurir live |
| 16 | **Tanpa polling**; rekonsiliasi **manual di menu admin** | Tanpa cron reconcile; admin paste/lihat AWB dari dashboard Jubelio |
| 17 | Pemilik bertanya maksudnya → dijelaskan | Status `RETURNED`/`SHIPMENT_ISSUE` ditampilkan mentah di admin untuk tindakan manual |
| 18 | **Sales Order Omnichannel wajib** untuk pesanan website | Desain order→SO + stok mengikuti `jubelio-sales-api-migration.md` |
| 19 | Benar: **sandbox tenant via URL produksi** (mode mock); pembayaran di luar kebutuhan app | App cukup mengirim request yang benar; peralihan kurir-live = urusan vendor/pemilik |
| 20 | Tidak diperlukan untuk desain MVP sesuai keputusan pemilik di tiket 08; **tidak dijawab vendor** | SO hanya barang, pajak 0 dan tanpa ongkir bagi pickup/delivery; website/Midtrans punya total sendiri, masing-masing diverifikasi terhadap snapshot |
| 21 | Belum dijawab — baru ditambahkan dari tiket 03 (2026-09-27), kandidat dikirim ke vendor | Kebijakan asuransi tiket 03 berlaku dengan default aman (`is_insurance` false; kurir wajib-asuransi dikecualikan) sampai terkonfirmasi |

**Sisa terbuka (tidak menghalangi desain):** jalur label saat kurir live dan semantik `shipping_insurance`/kurir wajib-asuransi (no. 21). No. 20 telah ditarik dari daftar MVP oleh keputusan pemilik, bukan dibuktikan sebagai fakta API. **Ditutup oleh keputusan pemilik (2026-09-27, tiket 05):** pertanyaan 13–14 (signature & event webhook) tidak perlu dikirim ke vendor — dokumentasi = source of truth; fixture tidak dibutuhkan; webhook akan diuji manual oleh pemilik; semantik `RETURNED`/`SHIPMENT_ISSUE` tampil mentah manual (no. 17 pun tidak lagi menghalangi).