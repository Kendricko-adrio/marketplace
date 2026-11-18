# Handover operasional staging fase 2

Handover dokumentasi diserahkan atas permintaan pemilik. Checkout tetap terbuka sesuai keputusan sebelumnya (`checkout.paused=false` pada checkpoint terakhir). Tidak ada akses server, perubahan runtime, test, atau transaksi baru untuk handover ini. Checkpoint teknis terakhir yang dirujuk: 18 November 2026, 15:16 UTC. Handover operasional bukan persetujuan produksi atau penutupan seluruh acceptance criteria (AC).

## Referensi operasi

- [Store staging](https://dev-store.adfsport.cloud/products) · [Admin staging](https://dev-admin.adfsport.cloud/login) · [Runbook staging](../../../docs/deployment-docs/staging-phase-2-deployment.md).
- Compose project `staging`, database `qadfstore`; snapshot aktif dan image ID terpin tercatat di `/home/ops/log/marketplace-bootstrap/staging/active-release.json`. Gunakan pointer ini, bukan tag mutable, untuk operasi berikutnya.
- Migrasi 16→59 dan reset data aplikasi tercatat. Import sandbox mencapai akhir dan rekonsiliasi mencatat 39.045 model / 108.503 SKU. Jangan mengulang reset, seed, import, atau provisioning Owner untuk menutup bukti yang tersisa.
- Sweep reservasi dan komunikasi order berjalan tiap menit. Stock refresh pukul 02:00 UTC (09:00 WIB), `--runs 3`; [run terjadwal pertama](verifikasi-stock-terjadwal-staging.md) sukses 3/3, mencakup 165.021 observasi dengan 0 missing/failed.
- Kontrak diskon versi 1 aktif. Pada checkpoint terakhir, Sales test-account aktif, direct stock writes nonaktif, dan Midtrans sandbox. Credential [Google staging](setup-google-oauth-staging.md) cocok dengan runtime dan auth health HTTP 200; login Google end-to-end tidak diverifikasi.

## Tanggung jawab setelah serah terima

| Item | Pemilik dan batas |
|---|---|
| Reset Owner | Sudah dilakukan menurut pemilik; tidak perlu diulang. |
| Cabang dan konten | Pengisian sebagian diterima pemilik untuk fase ini. Tidak ada klaim bahwa semua cabang/konten lengkap. |
| Konfigurasi Shipment dan callback | Dilaporkan sudah dilakukan. Pemilik menangani pencocokan environment Shipment dan URL dashboard secara manual; tidak diperiksa agent. |
| Review admin | Pemilik menangani review manual bila diperlukan; agent tidak mengakses sesi admin. |
| Verifier import dan full unit gate | Ditunda; tidak perlu dijalankan untuk serah terima operasional. Verifier lama mengasumsikan SKU × seluruh cabang; full gate terakhir belum lulus karena assertion cancel-race dan error cleanup rehearsal. |

## AC → bukti dan batasan

| AC | Bukti atau batasan | Status |
|---|---|---|
| AC01–AC05, AC07, AC10–AC13 | Bukti release, konfigurasi, migrasi/reset, Owner provisioning, diskon, scheduler dan izin checkout ada di [register AC](verifikasi-deployment-staging-fase-2.md). | Verified |
| AC06 | Import dan rekonsiliasi terbukti; verifier formal ditunda. | Pending |
| AC08 | Data parsial diterima untuk fase ini; setup provider dilaporkan selesai, pencocokan manual oleh pemilik tidak tercatat sebagai bukti agent. | Pending |
| AC09 | Smoke/render sebelumnya tersedia; review admin dialihkan ke pemilik dan bukti tambahan belum tercatat. | Pending |
| AC14 | Paket serah terima tersedia; penutupan formal dan full unit gate belum tercapai. | Pending |

Checkout terbuka tidak membuktikan pickup, delivery atau pembayaran berhasil. Quote/booking, transaksi provider, delivery SMTP, callback aktual dan sign-in Google end-to-end tidak diuji oleh agent. Tidak ada aksi yang harus dilakukan pemilik untuk menerima dokumen handover ini.

### Butir penutupan yang belum terverifikasi — verbatim dari §16 plan

- [ ] Seluruh AC01–AC14 Verified dengan command/result target yang relevan; tidak ada PASS dari test yang skipped.
- [ ] Data aplikasi lama kosong, journal migration utuh, full import complete dan stock coverage fresh.
- [ ] Owner baru dapat login/reset password; tidak ada akun/order/promo/recovery fixture demo.
- [ ] Origin/jam branch, parcel, konten wajib dan callback configuration tervalidasi; tidak ada pengurangan scope delivery diam-diam.
- [ ] Bukti browser terarah dan rendered review tersedia tanpa mengirim provider write yang dilarang.
- [ ] Runbook enduring dan navigasi docs diperbarui; walkthrough actual tercatat.
- [ ] Plan tetap disimpan; index fitur diperbarui dengan tanggal/evidence hanya setelah semua AC Verified.
