# Bukti penerimaan spec dan seam pengujian

Type: grilling
Label: wayfinder:grilling
Status: resolved (keputusan penerimaan spec dicatat; spec belum Ready)
Blocked by: 06, 07
Parent: [Menuju spec pengiriman ke rumah via Jubelio Shipment yang siap ditinjau](../map.md)

## Question

Perilaku pengguna/operasional apa dan bukti uji apa yang wajib tercantum di spec final agar pemilik dapat meninjaunya: pickup tidak regresi, checkout delivery dan perubahan quote, snapshot/re-payment, pembatasan admin, paid-but-blocked, booking ambigu, webhook/replay, serta integrasi sandbox yang memang telah diizinkan? Konfirmasikan seam browser/HTTP dan DB-backed khusus concurrency yang masih diusulkan dalam draf. Khusus dari [issue 06](06-kontrak-quote-hingga-pembayaran.md), pastikan representasi ongkir dan kesamaan nominal di Sales Order Omnichannel didukung bukti (pertanyaan vendor no. 20), bukan field rekaan; putuskan bagaimana bukti itu menjadi gerbang penerimaan spec. Catat dengan jelas bukti yang belum tersedia dan keputusan pemilik untuk menerima atau menunggu; tiket ini tidak mengesahkan spec sebagai Ready secara otomatis.

## Keputusan pemilik — sesi grilling tiket 08

Keputusan berikut disetujui pemilik dalam sesi tanya-jawab Q1–Q21. Ini **kontrak penerimaan untuk draf spec**, bukan laporan tes yang sudah lulus, persetujuan Ready, izin implementasi, atau izin menjalankan request ke Jubelio. Keputusan terbaru menggantikan asumsi yang bertentangan pada tiket/draf lama; sinkronisasi dokumen tersebut merupakan pekerjaan lanjutan yang terpisah.

### Skenario penerimaan dan seam

Spec harus menyatakan input/aksi dan hasil yang diharapkan secara eksplisit untuk setiap kelompok berikut; jangan hanya menulis daftar uji generik:

| Kelompok | Perilaku yang harus dapat dibuktikan dengan mock/isolasi |
|---|---|
| Pickup tetap berfungsi | Pelanggan dapat membuat dan membayar pesanan pickup; setelah settlement terverifikasi, kode pickup diterbitkan dan admin dapat menyerahkan barang. Delivery tidak menerima kode pickup. Perubahan nominal SO pickup di bawah adalah **perubahan sengaja**, bukan alasan menghapus pemeriksaan angka. |
| Checkout delivery dan quote | Perubahan alamat, cabang, keranjang/harga, atau layanan membatalkan pilihan lama dan menahan lanjut/bayar selama quote baru dimuat; quote gagal tidak berubah menjadi ongkir nol. Pada Buat pesanan, harga/ongkir berubah harus ditampilkan dan disetujui ulang sebelum order/Midtrans dibuat; layanan yang hilang dipilih ulang. |
| Snapshot dan pembayaran ulang | Order/Midtrans memakai snapshot nominal, alamat, barang, layanan, ongkir dan PPN yang disetujui; pembayaran ulang memakai snapshot yang sama tanpa quote ulang atau perubahan total diam-diam. |
| Izin admin | Visibilitas tunduk pada `orders:view` dan Branch Scope; tindakan penanganan hanya oleh Admin User dengan Home Branch = cabang pesanan, diaudit; uji juga penolakan lintas cabang dan akses owner menurut grant yang berlaku (owner tidak otomatis mengabaikan aturan Home Branch untuk tindakan). |
| Paid-but-blocked dan operasi bermasalah | Settlement ambigu tetap paid-but-blocked dan tidak masuk fulfillment; packing gagal, booking ambigu, dan RETURNED/SHIPMENT_ISSUE muncul di daftar tindak lanjut/filter; alasan wajib dan Audit Event untuk tindakan manual yang disepakati tiket 07. Tidak ada retry create buta atau refund otomatis. |
| Booking dan status | Klaim booking paralel tidak menghasilkan dispatch ganda; timeout setelah POST yang hasilnya tidak diketahui ditahan tanpa retry. `DELIVERED` terverifikasi menyelesaikan delivery, `PICKED_UP` tidak; selesai manual perlu alasan. |
| Webhook dan replay | HTTP callback memverifikasi signature atas raw body menurut dokumen v1.8; signature salah ditolak, duplikat dan out-of-order tidak menggandakan efek atau memundurkan status, dan GET AWB yang diketahui dapat dipakai untuk rekonsiliasi reaktif. Tidak mensyaratkan fixture signed nyata dari vendor. |

Seam wajib: **browser + HTTP** store/admin untuk perilaku terlihat; **HTTP webhook** untuk autentikasi, status, replay dan penolakan; **DB-backed** untuk keamanan operasi durable/concurrency. Cakup seluruh daftar draf: set-default alamat bersamaan, klaim booking paralel, snapshot vs perubahan alamat/harga, settlement vs booking, replay/out-of-order, serta kegagalan setelah provider POST. Untuk klaim tahan-race, jalankan operasi benar-benar bersamaan pada DB, bukan sekadar dua request berurutan. Tes adapter/kontrak boleh melengkapi kasus payload provider/signature/timeout yang tidak terlihat dari browser. Unit/E2E mengisolasi provider dengan mock; ekspektasi angka/status berasal dari kontrak atau fixture independen, bukan perhitungan fungsi yang diuji. Tidak ada klaim tes tersebut sudah dijalankan untuk fitur ini.

### Nominal SO, website, dan Midtrans — keputusan baru yang mengganti usulan no. 20

Pemilik memilih **tidak mengirim ongkir maupun pajak ke Sales Order Omnichannel, untuk pickup maupun delivery**. Ini keputusan produk berdasar pengalaman uji yang disampaikan pemilik, **bukan klaim bahwa API Jubelio secara universal tidak memiliki field ongkir**. Item SO memakai harga barang dan diskon yang sesuai; `tax_amount` setiap item dan `total_tax` SO bernilai **0**; tidak ada ongkir di SO. Invoice dan pembayaran Jubelio harus diverifikasi terhadap **nilai barang setelah diskon di SO**. Order website dan Midtrans memakai snapshot total pelanggan, termasuk ongkir `rates` untuk delivery dan PPN yang dihitung/dicatat di website; ongkir tetap tercatat terpisah pada order/Midtrans. Dengan demikian **total SO/invoice tidak wajib sama dengan total order/Midtrans**, tetapi setiap sisi wajib konsisten dengan snapshot bagiannya sendiri. Contoh konseptual: barang Rp100.000, ongkir Rp20.000, PPN website RpX (mengikuti rumus website) → SO/invoice Rp100.000, order/Midtrans Rp120.000 + RpX; ini tidak menetapkan tarif pajak baru. SO Rp90.000 untuk barang Rp100.000 tetap salah dan harus ditolak. Untuk pickup tanpa ongkir, selisih SO vs Midtrans berasal dari PPN website; alur pickup dan gerbang settlement/kode pickup tetap wajib benar.

Unit/E2E cukup menggunakan **SO tiruan (mock)**, bukan request Jubelio nyata, untuk menguji payload barang tanpa pajak, konfirmasi SO/invoice/pembayaran dan dua nominal yang sengaja berbeda, termasuk mismatch dan respons ambigu. Pertanyaan vendor no. 20 tentang field ongkir **tidak diperlukan untuk desain MVP ini**; jangan tandai sebagai sudah dijawab vendor atau mengarang field. Keputusan ini mengganti tuntutan awal Q3/Q6 dan usulan kesamaan nominal website→Midtrans→SO pada tiket 03/06/draf. Website menjadi referensi pencatatan PPN pelanggan pada kedua metode. Pemilik **tidak mensyaratkan telaah konsultan pajak**; ini keputusan pemilik, bukan validasi hukum/perpajakan oleh agent. Keputusan lama di tiket 03 yang meminta konfirmasi konsultan pajak harus diselaraskan secara eksplisit sebelum draf spec final diterbitkan.

### Klasifikasi bukti dan uji manual

Pisahkan **(a)** dokumen v1.8/riset serta hasil mode mock yang sudah dicatat, **(b)** tes aplikasi mock/terisolasi yang masih harus ditulis dan dijalankan saat implementasi, dan **(c)** uji integrasi nyata opsional yang akan dilakukan manual oleh pemilik. Hasil `MOCK-` tenant melalui host produksi bukan bukti perilaku kurir live atau fitur aplikasi telah lulus. Jangan mensyaratkan callback Shipment nyata, booking live, fixture vendor, atau verifikasi tenant nyata untuk paket/volumetrik sebagai kriteria kelulusan spec/pekerjaan agent. Sediakan checklist manual opsional berisi langkah dan observasi yang mungkin ingin diperiksa pemilik; jangan mengklaim hasil yang belum dilaporkan atau membuatnya prasyarat. Ini **mengganti** prasyarat uji tenant nyata yang pernah dicatat di tiket 02 dan konsisten dengan keputusan tiket 05 bahwa dokumentasi webhook resmi cukup tanpa fixture nyata.

### Tindak lanjut dokumentasi (bukan izin implementasi)

Selaraskan draf `plan/research/pengiriman-ke-rumah-jubelio-spec.md`, tiket 02/03/06, map, dan draf pertanyaan vendor: hapus persyaratan uji live dan kesamaan total SO yang kini bertentangan; tandai no. 20 tidak diperlukan untuk MVP, bukan terbukti; tulis ulang bagian pajak/SO untuk pickup dan delivery tanpa menutupi perubahan dari perilaku yang ada. Perbarui checklist penerimaan dengan batas klaim bukti di atas. **Spec masih perlu tinjauan dan persetujuan lengkap terpisah sebelum Ready; tiket ini tidak mengubah kode atau membuktikan kelayakan pajak/vendor.**
