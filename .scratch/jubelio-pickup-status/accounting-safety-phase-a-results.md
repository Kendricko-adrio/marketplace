# Hasil Tahap A — audit retrospektif Status Channel (2026-09-26)

Sumber: [draf uji](accounting-safety-test-draft.md), [hasil edit terdahulu](edit-channel-status-results-2026-09-26.md), [kontrak API lokal](../../docs/jubelio-api/dist.yaml). Pemilik secara eksplisit mengizinkan **maksimal satu `POST /login`** untuk token in-memory dan GET read-only Tahap A; **tidak** mengizinkan create/edit SO, invoice/payment, stock-read POST, atau Tahap B. Preflight memastikan host dipin ke `https://api2.jubelio.com`, opt-in akun uji aktif, dan kredensial terkonfigurasi; flag itu sendiri **bukan bukti isolasi akun**. Tidak ada raw response, token, kredensial, nama/kontak pelanggan, atau nomor akun yang disimpan. Token hilang bersama proses.

## Request yang dilakukan

- **1 × `POST /login`**, HTTP sukses; tidak ada POST lain.
- **16 × GET**: detail SO 68398, invoice 45944, payment 26; satu halaman daftar payment dengan batas tanggal 2026-09-25 sampai 2026-09-27; 12 halaman daftar jurnal dengan parameter `createdSince=2026-09-25` (maksimum 100 baris per halaman). Tidak ada GET detail jurnal karena tidak ada ID jurnal yang cocok dari halaman yang terjangkau. Tidak ada retry login.
- Tidak ada write SO lama, SO baru, Midtrans, refund/cancel, SSH, deployment, atau implementasi aplikasi.

## Observasi teredaksi

| Pemeriksaan | Hasil | Batas kesimpulan |
|---|---|---|
| SO 68398 GET | `channel_status=Siap Proses`, invoice ID 45944, total 1000, satu item | Snapshot saat ini; baseline sebelum edit hanya dari jurnal uji sebelumnya. |
| Invoice 45944 GET | ID 45944, total 1000 | Invoice yang diketahui masih dapat dibaca. |
| Payment 26 GET | ID 26, jumlah 1000, satu asosiasi invoice | Payment yang diketahui masih dapat dibaca. |
| Daftar payment bertanggal | `totalCount=6`; keenamnya dibaca dan **payment 26 ditemukan** | Positive control berhasil untuk jendela ini; tidak membuktikan semua payment/jurnal tersembunyi atau source-link yang benar. Berbeda dari filter `q=<SO>` pada uji lama yang gagal menemukan payment 26. |
| Daftar jurnal | `totalCount=95.540`; hanya **1.200/95.540** baris dibaca sesuai cap 12 halaman; **tidak ada** `source_doc_no` yang persis cocok dengan nomor SO/invoice/payment yang diketahui di halaman itu | **Tidak lengkap.** Tidak boleh menyimpulkan tidak ada jurnal, reversal, re-posting, atau dampak akuntansi. Parameter `createdSince` tidak terbukti membatasi daftar ke fixture; perilaku filtering/pagination belum divalidasi. Tidak ada positive control jurnal yang dapat ditemukan. |

## Kesimpulan dan stop gate

**Inkonklusif untuk keamanan finansial edit SO ber-invoice.** Bukti ini menambah verifikasi bahwa payment yang sudah diketahui dapat ditemukan dari daftar *bertanggal*; belum memberikan baseline/himpunan jurnal lengkap sebelum/sesudah edit. Ketiadaan kecocokan jurnal di 1.200 baris pertama dari 95.540 **bukan** bukti nihilnya efek finansial. Risiko edit vendor bersamaan/TOCTOU juga belum terbukti dapat dikendalikan. Sesuai [gate #01](ticket-breakdown-draft.md), spesifikasi **tetap Draft/belum Ready**; jangan jalankan Tahap B otomatis karena sumber audit jurnal belum terbukti lengkap.

**Langkah berikut yang memerlukan keputusan/akses baru:** minta Jubelio menjelaskan jalur audit otoritatif yang dapat menelusuri invoice/payment/SO ke seluruh jurnal (termasuk perubahan/reversal dan cara melihat histori), serta aturan edit full-save SO ber-invoice dan konflik edit vendor. Bila penelitian GET tambahan diperlukan, login baru adalah POST baru sehingga minta izin spesifik lagi jika token tidak tersedia. Uji prospektif satu SO baru hanya layak **setelah** sumber audit sebelum/sesudah tervalidasi dan izin POST tersendiri untuk tiap jenis operasi/scope diperoleh; eksperimen yang tidak dapat mengamati efek tersembunyi tidak memenuhi gate.
