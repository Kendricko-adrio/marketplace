# Verifikasi sandbox Jubelio — diskon barang

## Otorisasi dan batas

Pemilik mengonfirmasi `.env` sebagai sandbox terisolasi, mengizinkan login, pemilihan SKU berstok, SO, invoice, payment, cancellation, marker edit, dan menyerahkan rincian pengujian kepada agent. Batas keras: maksimal **5 request create SO**, tanpa retry otomatis. Request create ambigu tetap mengonsumsi budget. Tidak mengubah aplikasi, order lama, atau konfigurasi; tanpa delegasi/commit.

Credentials dibaca privat dari `.env` root main checkout yang ditemukan melalui Git common directory; tidak disalin ke worktree/evidence. Token hanya dalam memory proses. Host API bersama `https://api2.jubelio.com` bukan bukti isolasi; isolasi berasal dari konfirmasi pemilik.

## Prerequisite teramati

- Login berhasil.
- Catalog dan stock endpoint tersedia. SKU `4062449831429` (`item_id: 43842`, harga master Rp259.000) memiliki available 7 di location 9 dan 7 di location 11 pada discovery. SKU `4067896894195` (`43843`, Rp250.000) memiliki available 5 di location 7. Lokasi final mengikuti recheck stok dan kesamaan lokasi kedua SKU.
- Tax record 1 adalah `No Tax`, rate 0. Konfigurasi payment account tersedia; perlu GET account sebelum payment.
- Pencarian customer `sandbox`, `test`, `okcir` tidak menghasilkan dummy. Buat maksimal satu customer dummy berlabel referensi unik, tanpa email/telepon/alamat/PII, berdasarkan otorisasi sandbox terbaru.
- `GET /taxes/` tanpa pagination mengembalikan HTTP 500. Dengan parameter dokumentasi `page=1&pageSize=100` berhasil; penyebab internal provider tidak disimpulkan.

## Protokol bounded yang ditentukan agent

Budget maksimal 5 SO, quantity 1–2 per baris, maksimal dua baris. Harga menggunakan master aktual, bukan mengubah master. Total gross maksimal Rp3.000.000 untuk seluruh suite, maksimal Rp600.000 per SO. Pajak, ongkir, fee nol; `source: 1` INTERNAL; tax ID 1. Ini kondisi eksperimen, bukan keputusan finance production.

| Kasus | Input inti | Expected money independen | Tindakan lanjutan |
|---|---|---|---|
| A | 43842 ×1; tanpa diskon | gross/net Rp259.000 | GET; cancel pre-invoice; cek stok |
| B | 43842 ×1; `disc=0`, `disc_amount=20000` | gross Rp259.000; diskon Rp20.000; net Rp239.000 | GET; marker edit full payload; GET; invoice; GET + SO linkage; payment Rp239.000 sekali; GET association |
| C | 43842 ×2; `disc=0`, `disc_amount=20000` | Hipotesis whole-line: gross Rp518.000; net Rp498.000. Alternatif per-unit memberi net Rp478.000 | GET untuk membedakan; cancel pre-invoice jika state diketahui |
| D | 43842 ×2; `disc=10`, `disc_amount=0` | Persentase 10% = Rp51.800; net Rp466.200; field nominal sengaja nol untuk observasi otoritas field | GET untuk observasi; tidak invoice jika money tidak konsisten; cancel pre-invoice jika state diketahui |
| E | 43842 ×1 dan 43843 ×1; `disc=10` dan nominal konsisten per baris Rp25.900/Rp25.000 | gross Rp509.000; diskon Rp50.900; net Rp458.100; bukan diskon ganda | GET; cancel pre-invoice jika state diketahui |

SO B saja diteruskan sampai satu invoice dan satu payment, hanya jika SO/marker/invoice money cocok. Payment memakai account yang diperiksa via GET dan tipe numerik 0 sesuai kontrak sandbox existing. Jangan mengirim payment mismatch. Invoice/payment dibiarkan sebagai artefak sandbox, tidak dibatalkan setelah invoice.

Marker B: `Belum Bayar` → `Menunggu Verifikasi`; pertahankan nomor SO, detail IDs, identitas, harga, quantity, nominal, tax, total, source, lokasi, note/ref dan seluruh field finansial request yang digunakan. GET sebelum dan sesudah wajib.

Setiap SO menggunakan note/ref unik dengan prefix `DISCOUNT-VERIFY-`. Simpan hanya case, IDs, field money/stock relevan, HTTP status, dan kesimpulan terukur. Jangan log raw customer/provider body atau token. Sebelum setiap create, recheck available SKU pada lokasi yang dipilih. Outcome network/5xx/missing ID yang ambigu menghentikan business writes untuk rekonsiliasi GET/manual review, tanpa retry.

## Batas kesimpulan

Ini bukti pendahuluan terbatas diskon barang, bukan penyelesaian tiket 08 yang masih bergantung pada keputusan finance tiket 04. `add_disc`, subsidi ongkir, taxable base nonzero, alokasi capped dengan remainder, refund/post-invoice cancellation, dan integrasi aplikasi tidak dinyatakan verified oleh suite ini. Kebijakan finansial production tetap memerlukan keputusan pemilik.

## Hasil

Run `DISCOUNT-VERIFY-2026-10-14T15-58-21-705Z` dijalankan pada 2026-10-14 UTC. Evidence terstruktur: [sandbox-results.json](sandbox-results.json).

| Kasus | Hasil aktual |
|---|---|
| A — baseline | Create HTTP 200, SO **68408**. GET membuktikan qty 1, harga Rp259.000, diskon/pajak nol, total Rp259.000. Cancel HTTP 200 dan GET `is_canceled: true`; stock location 2 kembali `on_hand: 4`, `on_order: 0`, `available: 4`. |
| B — nominal nonzero | Request qty 1, harga Rp259.000, `disc: 0`, `disc_amount: 20000`, line/net/header Rp239.000 dikirim sekali. Create mengembalikan **HTTP 500 tanpa ID SO**. Outcome ambigu, bukan bukti provider menolak nominal-only secara definitif. |
| B — marker/invoice/payment | **Tidak dikirim** karena create B belum terkonfirmasi. |
| C/D/E | **Tidak dijalankan** setelah stop rule aktif. |

Total **2 dari maksimal 5 request create SO**. Hanya satu SO mendapat ID terkonfirmasi. Tidak ada retry business write, perubahan aplikasi/guard, order lama, atau eksperimen production. Tidak ada unit/E2E/build/lint yang dijalankan karena scope ini eksperimen API provider, bukan delivery implementasi aplikasi.

### Rekonsiliasi read-only setelah HTTP 500

- Filter customer dummy pada `GET /wms/sales/orders/ready-to-process/` mengembalikan nol baris.
- Filter yang sama pada `GET /sales/orders/cancel/` mengembalikan SO 68408 yang sudah dibatalkan.
- Stock SKU 43842/location 2 tetap `on_hand: 4`, `on_order: 0`, `available: 4`.
- Coverage list dibatasi status endpoint. Tidak ditemukannya SO dan stock yang tetap **tidak membuktikan** write B tidak diterapkan. Tidak menebak SO ID, tidak menggunakan fallback pencarian note yang tidak terdokumentasi, dan tidak membuat ulang SO.

### Rekonsiliasi manual dari pemilik

Pemilik mengirim dua screenshot UI Jubelio setelah stop: detail SO `SO-000068408` dan daftar Transaksi Penjualan/Pesanan dengan filter `Semua`. Detail memperlihatkan referensi kasus A, source INTERNAL, quantity 1, harga/total Rp259.000, diskon dan pajak nol. Baris teratas daftar adalah SO 68408; baris berikutnya SO 68407 bertanggal lebih lama. Pemilik menyatakan hanya order tersebut yang muncul untuk pengujian ini.

Bukti operator ini memperkuat bahwa kasus B belum terlihat sebagai pesanan baru di UI. Screenshot kedua adalah daftar pesanan, bukan audit history event SO. Coverage yang terlihat tetap satu halaman UI; tidak menjadi bukti transaksi backend rollback atau root cause HTTP 500. Jangan menyimpulkan `disc_amount` tidak didukung atau melakukan blind retry dari ketiadaan baris saja. Screenshot detail/daftar juga tidak menampilkan bukti eksplisit cancellation; status canceled kasus A tetap bersumber dari GET provider yang telah direkam.

Screenshot berisi baris customer lain; data/identitas tersebut tidak disalin ke evidence. Gambar asli tidak disalin dari clipboard sementara ke repo.

### Artefak dan tindak lanjut

Customer dummy **116918** tetap ada, tanpa email/telepon/alamat customer asli. SO 68408 tetap tersimpan canceled. State B memerlukan pemeriksaan operator melalui UI Jubelio atau support menggunakan customer dummy, prefix/run referensi di atas, timestamp request di evidence, dan nominal Rp239.000. Jika ditemukan SO B, catat ID dan verifikasi lewat GET sebelum menentukan disposition; jangan cancel/invoice/pay otomatis.

Endpoint accounts pada dokumentasi lokal `/accounts/lookup/all` mengembalikan 404; varian trailing slash `/accounts/lookup/all/` berhasil dan membuktikan configured account ID **2** tersedia. Account mapping juga dapat dibaca. Temuan ini tidak mengubah konfigurasi aplikasi.

**Kesimpulan run awal:** akses sandbox, baseline zero-discount, dan cancellation baseline terverifikasi; diskon nonzero pada saat itu belum terverifikasi. Budget tersisa bukan izin blind retry ketika outcome ambigu belum diketahui.

## Investigasi lanjutan setelah pemeriksaan UI pemilik

Pemilik memeriksa UI dan meminta penelusuran error, termasuk kontrak API/web search. Di bawah otorisasi bounded yang sama, agent menjalankan dua kasus pembeda dengan referensi baru (bukan retry B); rincian hipotesis/protokol sebelum request dan hasil ada di [investigasi HTTP 500](sandbox-error-investigation.md).

- **F, request create ke-3:** harga Rp259.000 ×1, `disc=10`, `disc_amount=25900`, total Rp233.100. Berhasil SO **68409**, GET membuktikan nominal/total tepat dan diskon tidak ganda. Cancel pre-invoice terverifikasi; stok kembali 4.
- **G, request create ke-4:** seluruh money sama dengan F, hanya `disc` diubah menjadi 0 (timestamp/ref baru). HTTP **500**, message generik `An internal server error occurred`, tanpa code spesifik/ID SO. Stock tetap 4 dan status list terfilter kosong; outcome tetap ambigu dan write dihentikan lagi.
- Total kumulatif **4/5 request create**. SO 68408 dan 68409 canceled terkonfirmasi; B/G tanpa ID tetap manual-review, tidak diretry. Tidak ada marker, invoice, atau payment dikirim. Tidak ada request ke-5 otomatis.

**Kesimpulan tahap F/G:** satu representasi diskon nonzero persentase+nominal konsisten terbukti bekerja; nominal-only dengan `disc=0` gagal pada dua kasus yang diuji. Root cause exception backend belum diketahui.

## Hasil H — persentase diturunkan dari nominal

Pemilik kemudian mengarahkan agar `disc` dihitung dari nominal diskon. Request terakhir dalam budget awal menggunakan harga Rp259.000 ×1, `disc = 20000 / 259000 × 100 = 7.722007722007722`, `disc_amount: 20000`, net Rp239.000.

Create berhasil SO **68410**. GET mengembalikan `disc: "7.72"` tetapi nominal diskon tetap **Rp20.000**, line/header net tetap **Rp239.000**. Cancellation pre-invoice dan stock restore terverifikasi; tanpa invoice/payment/marker. Request lengkap dengan timestamp aktual dan proyeksi response ada di [investigasi H](sandbox-error-investigation.md#h--nominal-rp20000-dengan-persentase-hasil-perhitungan-http-200), evidence `H-input`/`H-money`/`H-complete`.

Budget awal kini **5/5 request create**, tiga SO terkonfirmasi dan canceled (68408/68409/68410); B/G tetap unknown, tidak diretry. Tidak ada create ke-6 dalam scope ini. Bukti H tidak otomatis mengizinkan implementasi atau membuktikan quantity >1, seluruh fixed/capped nominal, marker/invoice/payment nonzero, pajak/ongkir, atau readiness aplikasi. Status keputusan finance/bukti lengkap mengikuti tiket masing-masing; suite ini tidak menutupnya.
