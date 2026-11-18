# Persiapan paralel saat full import staging

## Scope dan hasil

Pemilik menyetujui empat pekerjaan: audit kesiapan konfigurasi, review persiapan cron, cleanup percobaan optimisasi yang dibatalkan, dan perapian runbook. **Tidak mengaktifkan checkout/cron, restart import/app, mengubah data bisnis, atau mengirim request tambahan ke Jubelio.** Tidak memakai subagent.

Snapshot audit read-only: **2026-11-16 15:53 UTC**. Store/admin healthy; importer tetap container `3774e7c2513a38d088c9918008b8313f64d249aa84c57d037e7dc4817b2c8690`, start `2026-11-16T15:23:32.367637441Z`, budget600. Source mount dan Compose override proses aktif dipertahankan. Bukti server: `/home/ops/log/marketplace-bootstrap/staging/parallel-preparation-audit.json`; salinan aman lokal di temp `staging-parallel-preparation-safe.json`. Audit hanya Docker/config/filesystem dan PostgreSQL dengan `default_transaction_read_only=on`; tidak memanggil endpoint provider atau jobs.

## 1. Konfigurasi yang sudah ada

| Item | Hasil teramati | Batas bukti |
|---|---|---|
| Checkout | `checkout.paused=true` | Tetap tertutup; tidak diubah |
| Diskon | `discounts.contractVersion=0` | Intensional fase tertutup; aktivasi masih Pending |
| Reservation TTL | 15 menit | Nilai DB sesuai input bootstrap |
| PPN | 11%; `jubelio.salesTaxId=-2` | Sesuai evidence master sebelumnya; tidak GET ulang saat import600 |
| Parcel fallback | 250 gram, 30×20×10 cm | Sesuai keputusan pemilik, bukan pengukuran semua SKU |
| Packaging | 15 gram | Nilai positif dan sesuai keputusan pemilik |
| Import Markdown | 1.000 baris; 5 MiB compressed/25 MiB expanded | Batas config tersedia |
| Auth | URL store/admin staging; secret kedua app identik | Nilai secret tidak dicetak |
| Provider | Credential Omnichannel store/import identik; test-account true; direct stock writes false | Tidak memakai ulang credential production lama |
| Midtrans | Mode production false, account2/type0; keys terpasang | Bukan bukti transaksi/key diterima provider |
| Email | SMTP user/pass/from terpasang | `SMTP_HOST` tidak dibaca aplikasi: source memakai `smtp.gmail.com:465`, secure true. Tidak dianggap blocker hanya karena env SMTP_HOST kosong; tidak mengirim email uji |
| Google OAuth | Client ID/secret store terpasang | Google redirect/dashboard dan sign-in end-to-end belum diverifikasi. Admin `socialProviders={}`; tidak menuntut Google callback admin |
| Owner | Satu Owner masih `must_reset_password=true` | Pemilik menyelesaikan lewat login admin; agent tidak mengganti password/bypass |

Referensi: `apps/store/src/lib/email.ts:43`, `apps/admin/src/lib/auth.ts:72`, `apps/store/src/lib/shipment-config.ts`, serta register [verifikasi deployment](verifikasi-deployment-staging-fase-2.md).

## 2. Input operasional cabang

Ada **26 branch**: 25 bermapping Jubelio dan satu HQ administratif lokal. Dari 25 mapping, 24 aktif dan satu nonaktif. **Seluruh25 belum memiliki 11 field origin Shipment dan jam operasional masih `{}`.** Ini fakta kelengkapan lokal, bukan indikasi stok produk salah.

Field origin yang belum terisi: `shipping_phone`, `shipping_address`, `shipping_postal_code`, `shipping_area_id`, `shipping_province_id`, `shipping_city_id`, `shipping_district_id`, serta nama province/city/district/area. Tidak mencetak nomor telepon/alamat aktual. Keberadaan field nanti juga belum membuktikan hierarki provider benar; validasi region belum dijalankan pada audit ini.

| Kode | Nama | Status |
|---|---|---|
| 0 | Transit | aktif |
| 001 | WEBSITE ADF | aktif |
| 202 | ADF OUTLET BEKASI | aktif |
| 203 | ADF OUTLET BSD SERPONG | aktif |
| 204 | ADF OUTLET BINTARO | aktif |
| 205 | ADF OUTLET CIBUBUR | aktif |
| 208 | ADF OUTLET JABABEKA | aktif |
| 209 | ADF OUTLET KOTA WISATA | aktif |
| 331 | MULTI DPK ADF OUTLET | aktif |
| 332 | MULTI RAWA ADF OUTLET | aktif |
| 334 | ADF OUTLET TANGERANG | aktif |
| 335 | MULTI SMB ADF OUTLET | aktif |
| 336 | ADF OUTLET KARAWANG | aktif |
| 337 | MONO SMB ADF OUTLET PUMA | aktif |
| 338 | MONO DPK ADF OUTLET PUMA | aktif |
| 401 | ALSUT MULTI ADF OUTLET | aktif |
| 40135 | dago 123 | nonaktif |
| 402 | ADF OUTLET BOGOR | aktif |
| 403 | ADF OUTLET DAGO BANDUNG | aktif |
| 405 | ADF OUTLET RAWAMANGUN 1 | aktif |
| 500 | ADF OUTLET RIAU BANDUNG | aktif |
| 508 | ADF OUTLET BROOKS PURI INDAH MALL | aktif |
| 509 | ADF OUTLET FATMAWATI | aktif |
| 555 | Brooks Kota Kasablanka Mall | aktif |
| ERKE | ERKE STORE | aktif |

**Keputusan/input pemilik:** tentukan branch yang benar-benar melayani pickup/delivery, lalu isi origin dan jam melalui `/admin/branches`. Jangan otomatis menganggap lokasi bernama Transit/WEBSITE atau semua mapping sebagai cabang pickup/delivery; jangan mengubah status/eligibility berdasarkan tebakan nama. HQ administratif bukan origin/stock branch. Tidak menurunkan scope menjadi pickup-only.

## 3. Konten dan callback

- `footer_config`: **0 row**; storefront menggunakan fallback bawaan, bukan konten yang sudah disetujui. Kelola melalui `/admin/footer`.
- `static_page`: **0 row**; isi konten about/contact/privacy/terms sesuai kebijakan pemilik melalui `/admin/pages`. Tidak membuat legal copy atau nomor kontak fiktif.
- Secret webhook Omnichannel dan dedicated Shipment sudah terpasang. Keberadaan secret bukan bukti callback sudah didaftarkan.

| Dashboard/layanan | URL staging yang harus dikonfirmasi operator | Status audit |
|---|---|---|
| Jubelio Omnichannel | `https://dev-store.adfsport.cloud/api/webhooks/jubelio` | Registrasi/signature actual Pending |
| Jubelio Shipment | `https://dev-store.adfsport.cloud/api/webhooks/jubelio-shipment` | Registrasi/delivery actual Pending |
| Midtrans sandbox | `https://dev-store.adfsport.cloud/api/webhooks/midtrans` | Dashboard notification URL dan transaksi actual Pending |
| Google Cloud, store | `https://dev-store.adfsport.cloud/api/auth/callback/google` | Redirect URI/dashboard dan sign-in actual Pending |

**Temuan host Shipment:** runtime memakai `https://api-shipment.jubelio.com`; referensi proyek `docs/jubelio-api/README.md` mencantumkan host sandbox terpisah `https://api-shipment.sandbox.jubelio.com`. Ini **ketidakselarasan yang belum diverifikasi**, bukan bukti credential salah atau izin mengganti URL. Jangan quote/booking/auth Shipment sebelum host dan credential lingkungan target dicocokkan. Audit tidak memanggil kedua host, tidak mengubah env, dan tidak melakukan mutasi dashboard.

## 4. Persiapan cron nonaktif

| Pemeriksaan | Hasil |
|---|---|
| Crontab staging aktif | 0 entry; tidak diubah |
| Cron daemon | active |
| Tools host | bash/curl/flock tersedia |
| Tiga wrapper | `bash -n` valid, executable untuk deploy |
| Folder log | Tiga path di bawah `/home/ops/log/marketplace-{sweep,order-comms,stock-refresh}/staging` tersedia dan writable |
| Cron secret | Env file cocok dengan runtime store dan parser wrapper stock; nilai tidak dicetak |
| Draft managed block | `/home/ops/log/marketplace-bootstrap/staging/cron-staging-pending.txt`, semua jadwal dikomentari |
| Sweep/email | Rencana setiap menit; belum dipanggil/dijadwalkan |
| Stock | Rencana02:00 UTC host; `FINAL_N` menunggu eligible IDs final, bukan default1 yang diklaim mencakup semua |

`N=max(1,ceil(eligibleIds/20000))`, range1..12 sesuai wrapper. Tentukan setelah import lengkap dengan join scanner, bukan seluruh kombinasi SKU×cabang. Jumlah SKU sekarang belum final. Install nantinya hanya satu managed block, preserve entri non-marketplace; catat dua eksekusi scheduler. Manual no-op tidak membuktikan email delivery/settlement.

**Belum dilakukan:** pemasangan cron, pemanggilan endpoint, stock refresh, dan bukti scheduled run. Tidak mengambil kuota import600 untuk pekerjaan ini. Draft bukan bukti scheduler aktif.

## 5. Cleanup yang diizinkan

- Restorasi tepat empat file yang berubah hanya karena percobaan optimisasi: `packages/db/src/jubelio-sync.ts`, `packages/db/src/import-jubelio-service.ts`, `packages/db/src/jubelio-import-options.ts`, `packages/db/src/jubelio-import-options.test.ts`. Lokal `git diff --exit-code` terhadap HEAD membuktikan byte-normalized source original; server dibandingkan dengan snapshot running source dan Git base sebelum restore.
- Hapus hanya test HTTP percobaan yang masih cocok checksum candidate. Patch/source candidate disimpan sebagai histori di luar repo, bukan dipakai untuk deployment.
- Kembalikan default/template/assertion konfigurasi percobaan ke baseline. **Tidak menyentuh `.env` aktif600.** Perbedaan default template120 dengan override aktual600 dijelaskan di runbook.
- Candidate manifest/patch dan automation yang dibatalkan dipindahkan ke direktori histori. `.env.acceleration` tidak terpakai dihapus setelah memastikan bukan mount aktif dan identitasnya memang candidate. Pipeline lokal dibatalkan, tidak dihidupkan ulang.
- **Tidak menghapus** source mount/override yang dipakai importer, image, volume, data, Owner, wrappers deployment awal, atau perubahan user lain. Tag image `latest` bukan acuan untuk recreate tanpa pin/review baru setelah import.
- Context7 N/A untuk cleanup ini: restorasi source existing yang telah terverifikasi, audit read-only dan dokumentasi; tidak menulis API library baru. Tidak mengulang unit/E2E/typecheck untuk source yang kembali identik baseline. `bash -n`, checksum, diff dan link checks adalah pemeriksaan static, bukan pemanggilan jobs/provider.

## Pemeriksaan akhir

Pada **2026-11-16 16:03 UTC**, container import memiliki ID/start yang sama, tetap running600; current run17 halaman/3.400 model/17.722 SKU/44.369 stock observations, partial error0. Host timezone `Etc/UTC`. Crontab staging tetap0 dan draft remote seluruhnya commented. Empat file source importer lokal/server identik baseline; tidak ada diff code tersisa dari percobaan. Runbook/template/config candidate sudah dikoreksi di lokal dan host, tanpa menyentuh `.env` aktif atau mount source berjalan. Link Markdown dan `git diff --check` valid.

Container PostgreSQL disposable **milik percobaan ini**, `marketplace-import-acceleration-tests` pada55442, dihapus setelah pipeline dibatalkan; `storefront-postgres` development tetap running. Tidak menjalankan unit/E2E/build baru. Bukti final server: `/home/ops/log/marketplace-bootstrap/staging/parallel-preparation-final.json`.

## AC persiapan dan batas penutupan

| AC | Bukti | Status |
|---|---|---|
| P1 Audit konfigurasi dan daftar input operator | Snapshot DB read-only, flags runtime tanpa secret, daftar branch/konten/callback pada dokumen ini | Verified |
| P2 Persiapan cron tanpa aktivasi | Syntax/execute/log/tool/secret checks dan draft seluruhnya commented, crontab aktif0 | Verified |
| P3 Cleanup hanya percobaan yang dibatalkan | Diff/checksum baseline, HTTP test dihapus terjaga checksum; runtime source/mount dipertahankan | Verified |
| P4 Runbook sesuai600/source existing/monitoring/batas izin | [Runbook](../../../docs/deployment-docs/staging-phase-2-deployment.md), link/static review | Verified |

P1–P4 hanya scope persiapan ini. **Full import, pengisian input, konfirmasi host Shipment/dashboard, aktivasi jobs, bukti scheduler, full browser handover dan pembukaan checkout tetap Pending** pada AC06–AC14 deployment. Tidak menyatakan quote/payment/booking/email/OAuth actual berhasil.

Langkah berikut: pemilik menyelesaikan forced reset, memilih cabang operasional dan menyediakan data origin/jam/konten serta evidence dashboard. Sesudah import mencapai akhir, main agent menutup verifikasi data dan menghitung N; aktivasi tetap tahap terpisah sesuai izin.
