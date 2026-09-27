# Booking dan timeout Shipment

Type: research
Label: wayfinder:research
Status: resolved
Blocked by: none
Parent: [Menuju spec pengiriman ke rumah via Jubelio Shipment yang siap ditinjau](../map.md)

## Pertanyaan

Bagaimana aplikasi membuat dan merekonsiliasi Shipment tanpa booking ganda, khususnya ketika respons `POST /shipments/create` hilang sebelum AWB diterima? Pisahkan fakta kontrak/vendor dan hasil uji dari keputusan operasional pemilik. **Cancel dikecualikan dari MVP** sesuai [tiket 03](03-kebijakan-nominal-delivery-mvp.md). Kebijakan quote/persetujuan ongkir ada di [tiket 06](06-kontrak-quote-hingga-pembayaran.md), sedangkan webhook/status ada di [tiket 05](05-webhook-dan-bukti-status.md).

## Alur dan keputusan operasional pemilik

1. **Buat Sales Order (SO) dan simpan quote.** Saat SO dibuat, simpan `rates` yang dipilih sebagai snapshot ongkir quote pada record shipping yang terkait dengan order. Keputusan ini tidak mengubah jumlah yang telah disetujui/dibayar pelanggan.
2. **Kirim create.** Kirim `POST /shipments/create` satu kali untuk booking tersebut. Buat satu record per booking yang terkait dengan order; simpan AWB dan nilai Jubelio yang diterima. Jika kelak ada booking pengganti, buat record baru dan pertahankan booking/AWB lama sebagai riwayat.
3. **Create berhasil.** Simpan `price` dari respons create. Jika respons create juga berisi `price_bill`, simpan; jika tidak, lakukan `GET /shipments/awb/{awb}` setelah AWB tersedia untuk membacanya. Bila GET gagal, create tetap dianggap berhasil jika respons create dan AWB sudah tersimpan.
4. **GET detail gagal.** Coba GET otomatis maksimal **3 request total** (percobaan pertama + maksimal 2 retry), hanya untuk timeout/kegagalan jaringan/HTTP 5xx. Jangan retry untuk 4xx. Jika tetap gagal, tandai `price_bill` belum tersedia dan serahkan ke rekonsiliasi admin; jangan polling tanpa batas dan jangan mengulang POST create.
5. **Create ambigu sebelum AWB diterima.** Simpan `rates`, biarkan `price`/`price_bill` kosong, tandai record perlu rekonsiliasi dan tahan order dari proses pengiriman yang mengasumsikan booking berhasil. Jangan retry `POST /shipments/create` sampai dipastikan booking pertama tidak ada. Jika Jubelio tidak dapat memastikan, tetap tahan dan eskalasi ke Jubelio—jangan retry dengan asumsi.
6. **Tampilan order admin.** Tampilkan nilai terpisah dengan label sumber: `rates` (quote), `price` (harga booking dari respons create), dan `price_bill` (nilai Jubelio dari detail AWB). Jika nilai yang tersedia berbeda, tandai selisih dengan warna merah. Kebijakan nominal mengikuti tiket 03: pelanggan membayar tepat `rates`; selisih ditanggung toko, booking tetap dilanjutkan dan selisih dicatat untuk laporan/audit.

## Sudah diketahui

- Pemilik mengizinkan ID order sebagai `ref_no`; pada satu uji create/detail, nilai itu tersimpan utuh.
- **Uji idempotensi langsung (tenant mode mock pada host produksi URL, 2026-09-27):** dua `POST /shipments/create` berurutan dengan body identik dan `ref_no=DUMMY-IDEMP-TEST-01` memberi HTTP 201 dan mengembalikan `shipment_id=2`, AWB `MOCK-JS2420810000000002`, serta `price=7500` pada kedua respons. Tidak terlihat duplikasi pada pengulangan sequential ini.
- Pemilik memilih **tetap konservatif**: hasil mock tersebut tidak cukup untuk mengizinkan retry create setelah timeout. Jangan retry sampai booking pertama dipastikan tidak ada; jika tidak bisa dipastikan, tahan dan eskalasi. Hasil ini bukan jaminan kontraktual/live dan belum membuktikan request bersamaan atau payload berbeda. Token tidak dicatat; tidak ada cancel.
- Pemilik menyatakan timeout ditangani dengan cek GET AWB dan rekonsiliasi manual di admin tanpa polling. Ini menyelesaikan kasus AWB sudah diketahui, bukan kasus respons create hilang sebelum AWB diketahui.
- Dalam satu uji mode mock, create menghasilkan `price=7500` sama dengan `rates=7500`; respons GET detail juga memuat `price_bill=7500`. Uji ini tidak membuktikan kesamaan nilai pada mode live.
- Pada hasil uji yang tercatat, respons create memuat `price`; `price_bill` terbaca dari GET detail AWB. Jangan mengasumsikan `price_bill` ada pada respons create.
- Kebijakan nominal/selisih diselesaikan di [tiket 03](03-kebijakan-nominal-delivery-mvp.md): pelanggan membayar tepat `rates`, tanpa markup; semua selisih dengan `price`/biaya penyedia ditanggung toko tanpa ambang; booking tetap dilanjutkan dan selisih dicatat; tidak ada tagihan ulang kepada pelanggan. `price_bill` ditangani secara prosedural/pencatatan; definisi vendor tidak menjadi blocker tiket ini.
- **Cancel tidak digunakan pada MVP dan dikeluarkan dari tiket ini.** Siklus cancel mode mock yang pernah diuji adalah bukti historis saja; tidak ada riset/aksi cancel dalam lingkup tiket ini.

## Batas bukti dan ketidakpastian yang diterima untuk MVP

Pemilik memilih menutup tiket dengan caveat: keputusan aman MVP tidak bergantung pada klaim idempotensi—create ambigu ditahan, tidak di-retry sampai booking pertama dipastikan tidak ada, dan dieskalasi jika tidak dapat dipastikan. Pertanyaan berikut dicatat sebagai batas bukti/follow-up vendor non-blocking, bukan prasyarat untuk menutup tiket atau melanjutkan rancangan MVP.

### A. Duplikasi dan idempotensi create

1. Uji sequential mode mock dengan payload identik dan `ref_no` sama mengembalikan Shipment/AWB yang sama. Apakah ini perilaku idempotensi yang dijamin Jubelio, atau hanya perilaku mode mock? Minta konfirmasi kontraktual.
2. Apakah hasil sama berlaku untuk request bersamaan dan request berulang setelah jeda? Apa cakupan kunci uniknya—tenant, kurir, atau lainnya?
3. Jika `ref_no` sama tetapi payload berbeda, apakah Jubelio mengembalikan booking lama, menolak, atau membuat/mengubah Shipment?
4. Untuk respons validasi/HTTP 4xx, apakah Jubelio menjamin Shipment tidak tercipta? Bagaimana dengan HTTP 5xx atau koneksi yang terputus setelah request terkirim?

### B. Timeout sebelum AWB diketahui

1. Apakah tersedia lookup Shipment berdasarkan `ref_no`, endpoint daftar, atau prosedur support untuk menemukan hasil create yang responsnya hilang? Kontrak v1.8 yang ditinjau tidak mendokumentasikan lookup by `ref_no`.
2. Jika lookup tersedia, berapa latensi maksimum sebelum booking dapat ditemukan dan bukti apa yang memastikan tidak ada hasil create?
3. Jika lookup tidak tersedia, informasi apa yang diperlukan support Jubelio untuk mencari booking? Adakah batas waktu/retensi yang memengaruhi pencarian?
4. Apakah ada respons error atau keadaan tertentu yang secara definitif menjamin create tidak membuat Shipment? Tanpa kepastian/lookup, keputusan pemilik adalah menahan order dan eskalasi, bukan retry.

## Batas dan cara riset

- Jangan menyimpulkan jaminan idempotensi umum dari satu uji sequential mode mock. Uji itu hanya membuktikan bahwa dua request identik pada kondisi tersebut mengembalikan AWB yang sama; korelasi/ref_no saja tidak membuktikan perilaku live, concurrent, atau payload berbeda.
- Jangan menyimpulkan lookup berhasil dari instruksi GET AWB: GET tersebut memerlukan AWB, sementara kasus kritis bisa kehilangan AWB bersama respons create.
- Bedakan jawaban tertulis vendor, keputusan pemilik, bukti uji aktual, dan rancangan lokal. Catat “belum diketahui” secara eksplisit.
- Setiap request API memerlukan usulan metode, endpoint, contoh body tersanitasi, langkah dan risiko serta izin pemilik **sebelum request itu**. Tiket ini bukan izin untuk mengirim request; jangan mengulang POST ambigu tanpa keputusan keamanan khusus.
- Pertanyaan vendor boleh dijawab melalui draf/konfirmasi tertulis tanpa mengirim request API. Subagen hanya dengan izin delegasi tersendiri.
