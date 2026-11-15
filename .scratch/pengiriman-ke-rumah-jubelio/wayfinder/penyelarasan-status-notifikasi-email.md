# Penyelarasan status, notifikasi, dan email delivery

## Tujuan sesi

Mengklarifikasi adjustment delivery sebelum menyusun spec. Menggunakan `grill-with-docs`: interview berdasarkan `grilling`, dengan penajaman istilah berdasarkan `domain-modeling`. Belum ada persetujuan spec atau izin implementasi.

## Kebutuhan yang disampaikan pengguna

- Status Channel Jubelio delivery mengikuti urutan pickup: Belum Bayar → Siap Proses → Selesai.
- Delivery menghasilkan notifikasi pada halaman notifikasi admin.
- Tabel notifikasi memiliki kolom pembeda pickup dan delivery.
- Email delivery mencakup pembayaran berhasil/siap diantar, sedang diantar dengan link tracking, dan sudah sampai.

## Fakta kode

- Pembayaran Midtrans, invoice, dan pembayaran Jubelio menggunakan pipeline bersama: `apps/store/src/app/api/webhooks/midtrans/route.ts` dan `apps/store/src/lib/jubelio-sales-settlement.ts`.
- Cabang delivery mengakhiri settlement sebelum efek pickup dan update channel sukses, tetap paid/processing: `apps/store/src/lib/jubelio-sales-settlement.ts:245`.
- Target Siap Proses saat ini memerlukan ready_for_pickup: `apps/store/src/lib/jubelio-channel-mirror.ts:1014`.
- Notifikasi dan email setelah settlement sukses berada dalam fungsi pickup: `apps/store/src/lib/order-finalize.ts:255`.
- Delivery mempunyai bukti serah-terima petugas dan perkembangan kurir yang berbeda: `packages/db/src/shipment-tracking.ts`.
- Penyelesaian manual bukan bukti barang diterima customer: `docs/features/admin-delivery-workflow.md`.
- Referensi UI existing: `apps/admin/src/app/admin/notifications/page.tsx`.

## Pohon keputusan

1. Arti siap diproses / siap diantar — disepakati: pembayaran customer, invoice, dan pembayaran Jubelio sudah terverifikasi; belum berarti barang dibawa kurir.
   - Turunan: pemicu Siap Proses, notifikasi admin, dan email pertama.
   - Turunan: penanganan Midtrans lunas tetapi pencatatan Jubelio belum terverifikasi.
2. Arti sedang diantar — disepakati: bukti pertama dari catatan serah-terima petugas atau konfirmasi kurir bahwa barang sudah dibawa.
   - Turunan: sumber bukti, link tracking dan fallback, pencegahan pengiriman email berulang.
3. Arti sudah sampai dibanding order ditutup manual — disepakati: email sudah sampai hanya berdasarkan bukti diterima dari kurir; penutupan manual tetap memproyeksikan Selesai. Bukti diterima terlambat boleh mengirim email tanpa membuka order kembali.
   - Turunan: pemicu Selesai dan email ketiga.
4. Notifikasi admin — disepakati: hanya saat delivery siap diproses; kolom Jenis Order (Pickup/Delivery), tanpa filter baru; delivery memakai aksi Buka order.
   - Turunan: jenis kejadian, kolom/label pembeda dan kebutuhan filter; pertahankan batas akses cabang.
5. Keandalan pemberitahuan — disepakati: antrean durable untuk semua email order, retry otomatis 3 kali setelah percobaan awal, jeda 5 menit, retry hasil tidak pasti, supersede email tahap lama; tanpa UI resend.
   - Turunan: retry, kejadian terlambat/tidak berurutan dan penanganan kegagalan.
6. Order existing — disepakati: biarkan apa adanya; seluruh data saat ini adalah development dan project belum live production. Perubahan ditujukan untuk order baru. Pickup ikut antrean/retry untuk semua email order; isi dan pemicu existing dipertahankan.
   - Turunan: koreksi status lama, pemberitahuan historis, dan approval tindakan data terpisah.

## Ronde

### Ronde 1 — batas kejadian

Jawaban pengguna: Q1 setelah Jubelio valid; Q2 bukti pertama (catatan serah-terima atau update kurir); Q3 email sudah sampai hanya berdasarkan bukti diterima. Pertanyaan sebelum ronde ini dibatalkan dan bukan keputusan.

### Ronde 2 — tujuan pemberitahuan dan batas cakupan

Jawaban pengguna: Q4 detail order website; Q5 notifikasi hanya siap diproses; Q6 penutupan manual tetap memproyeksikan Selesai tanpa email sudah sampai; Q7 data lama dibiarkan apa adanya karena seluruh data masih development dan project belum live production.

### Ronde 3 — kegagalan, urutan informasi, dan tampilan

Q8 awalnya meminta penjelasan teknis; setelah penjelasan, pengguna memilih otomatis saja (tanpa tombol admin). Q9 dipilih kondisi terbaru saja; Q10 dipilih kolom saja, tanpa filter baru.

### Ronde 4 — batas retry dan scope pickup

Pengguna memilih Q11 tetap retry untuk hasil pengiriman tidak pasti, menerima risiko email ganda. Q12 memilih pickup juga memakai antrean dan retry baru. Pilihan ini membuka pertanyaan turunan tentang jenis email pickup yang termasuk.

## Keputusan

- Q1: Siap Proses dan email pertama menunggu pembayaran customer, invoice Jubelio, dan pembayaran Jubelio terverifikasi.
- Q2: Email sedang diantar dipicu bukti pertama: catatan serah-terima petugas atau konfirmasi barang dibawa dari kurir; hanya sekali untuk tahap ini.
- Q3: Email sudah sampai hanya dikirim berdasarkan bukti diterima dari kurir, bukan penutupan manual.
- Q4: Link email sedang diantar membuka detail order website, dengan login sesuai proteksi existing.
- Q5: Notifikasi admin hanya saat delivery siap diproses; bukan tiga notifikasi perjalanan.
- Q6: Status Channel Selesai berarti penanganan order berakhir, termasuk penutupan manual. Email sudah sampai tetap memerlukan bukti diterima dari kurir.
- Q7: Tidak ada koreksi/backfill data lama, termasuk 000068453; project belum live production, seluruh data existing adalah development. Fokus order baru.
- Q8: Pengguna memilih retry otomatis saja setelah penjelasan teknis. Tugas email disimpan di database; 1 percobaan awal + maksimal 3 retry dengan jeda 5 menit untuk kegagalan sementara. Kegagalan akhir dicatat; tanpa status/tombol resend admin baru. Status order dan pembayaran tidak dibatalkan oleh kegagalan email. Q11: hasil pengiriman tidak pasti tetap dicoba ulang dalam batas yang sama; risiko duplikasi dijelaskan dan diterima.
- Q9: Kirim kondisi terbaru saja; email tahap lama yang belum dikirim atau masih menunggu retry tidak dikirim setelah order maju ke tahap berikutnya.
- Q10: Tambahkan kolom Jenis Order dengan penanda Pickup/Delivery; tanpa filter jenis baru, perilaku halaman lainnya dipertahankan.
- Q12: Pickup juga mendapat antrean dan retry baru; isi dan pemicu email pickup existing dipertahankan.
- Q13: Semua email order termasuk dalam antrean/retry: tiga email delivery baru, email pickup siap diambil/selesai, dan email pembayaran gagal untuk kedua jenis order. Email autentikasi di luar scope.
- Definisi Delivery Siap Diproses, Delivery Mulai Diantar, Delivery Sudah Sampai, dan Order Selesai dicatat di `CONTEXT.md`.

## Rangkuman untuk konfirmasi pemahaman

- Order baru: delivery mengikuti Status Channel Belum Bayar → Siap Proses → Selesai dengan verifikasi pembayaran/invoice/payment yang sama seperti pickup.
- Siap Proses memicu satu notifikasi admin dan email delivery pembayaran diterima/sedang disiapkan. Bukan klaim barang sudah dibawa kurir.
- Mulai diantar dipicu bukti pertama serah-terima petugas atau barang dibawa dari kurir; email memuat link detail order website.
- Bukti diterima dari kurir memicu Selesai dan email sudah sampai. Penutupan manual tetap Selesai, tanpa email sudah sampai.
- Halaman notifikasi menambah kolom Jenis Order (Pickup/Delivery), tanpa filter baru. Pertahankan akses cabang dan perilaku existing.
- Semua email order pickup/delivery memakai antrean database dan retry otomatis: satu percobaan awal + maksimal tiga retry dengan jeda lima menit. Hasil tidak pasti tetap retry, risiko duplikasi diterima; cegah duplikasi pemicu sejauh dapat dikendalikan aplikasi.
- Jangan mengirim email tahap lama yang belum dikirim ketika order telah melampaui tahap itu. Kegagalan email tidak membatalkan pembayaran/pesanan.
- Tidak menambah UI resend atau email penutupan manual; email autentikasi tidak diubah.
- Data development lama dibiarkan apa adanya; tidak ada backfill status/notifikasi/email atau aksi provider untuk order lama.

Usulan wording delivery untuk konfirmasi: “Pembayaran diterima — pesanan sedang disiapkan”, “Pesanan sedang diantar” (link “Lacak pesanan”), dan “Pesanan sudah sampai”. Tidak mengganti wording pickup existing.

Batas keamanan yang dibawa ke spec untuk konfirmasi: kegagalan update label Jubelio tidak menurunkan status Lunas dan tidak membuat ulang pembayaran; gunakan mekanisme sinkronisasi existing yang aman, bukan retry perubahan Jubelio secara buta.

## Konfirmasi dan klarifikasi blueprint

- Pengguna mengonfirmasi rangkuman dengan “Sesuai, lanjut draft spec”. Ini mengizinkan penyusunan draft, bukan implementasi.
- Saat blueprint diperiksa, ditemukan tombol Verifikasi pickup pada seluruh baris notifikasi. Pengguna memilih aksi delivery “Buka order” ke detail tanpa `?verify=1`; aksi pickup tetap existing.
- Pengguna memilih bukti diterima yang valid setelah penutupan manual tetap mengirim email sudah sampai sekali, tanpa membuka kembali order atau mengubah alasan manual.

Status sesi: grilling selesai; [spec lengkap](../plan/penyelarasan-status-notifikasi-email-spec.md) disetujui pengguna pada 2026-11-09 dengan pernyataan “oke sudah approve dari saya untuk specnya”. Approval dicatat di spec dan index fitur; belum ada implementasi atau verifikasi runtime.
