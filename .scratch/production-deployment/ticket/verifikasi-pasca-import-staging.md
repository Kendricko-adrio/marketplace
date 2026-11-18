# Verifikasi pasca-import staging — 17 November 2026

## Catatan pembaruan

Checkpoint berikutnya telah menerapkan normalisasi pada release baru dan memasang cron ketiga setelah actual chain3 lulus. Full unit gate, Google/operator/checkout dan bukti scheduled stock tetap Pending. Lihat [evidence penyelarasan](penyelarasan-stock-refresh-staging.md) dan [AC terkini](verifikasi-deployment-staging-fase-2.md). Bagian di bawah adalah histori audit07:19 UTC sebelum perbaikan, bukan status stock cron saat ini.

## Histori status dan batas penutupan

**Credential Google staging belum dipulihkan, checkout tetap paused dan daily stock cron belum aktif.** AC01, AC02, AC06, AC08, AC09, AC11, AC13 dan AC14 **Pending**. Ini kemajuan deployment tertutup, bukan penutupan seluruh deployment.

Pemilik meminta melanjutkan pekerjaan agent setelah import mencapai akhir. Scope mengikuti [plan yang disetujui](../plan/deployment-staging-fase-2.md); tidak ada izin baru untuk transaksi provider, perubahan business rules, commit/push, production, subagent, reset atau penggantian credential Google dengan pasangan legacy. Pemilik memilih credential Google staging terkonfirmasi; file privat belum disediakan pada pemeriksaan sesi ini.

## 1. Rekonsiliasi katalog independen

- Import berantai mencapai halaman196 pada 03:35 UTC, exit0. Tidak menjalankan ulang import atau reset.
- Audit master read-only terpisah, 06:52–07:06 UTC: **196 halaman**, reachedEnd=true, totalCount stabil39.045; tidak ada invalid/duplicate group ID atau missing variant list.
- **39.045 group ID sumber sama persis dengan DB**: tidak ada missing/extra ID.
- Master listing memuat108.501 SKU; DB108.503 SKU. Dua ID tambahan113068/113069 berada pada group34597.
- GET catalog group34597 melalui client existing, termasuk enrichment detail SKU, mengonfirmasi kedua ID tersebut masih ada di catalog provider (3 SKU). Jadi bukan bukti tenant lama atau orphan. Gabungan master listing dan dua catalog-only SKU cocok dengan seluruh108.503 ID DB; tidak ada ID master yang hilang.
- Stock mirror:165.021 rows, timestamp kosong0, stale>24jam0 pada07:19 UTC, local holds negatif0. Oldest timestamp masih16November15:26 UTC; bukan jaminan freshness untuk hari berikutnya.
- Semua angka tersebut berasal dari query DB/source aktual, bukan proyeksi SKU×semua cabang.

Bukti server di `/home/ops/log/marketplace-bootstrap/staging/`: `post-import-source-ids.json`, `post-import-reconciliation.json`, `post-import-targeted-probe.json`, `post-import-preflight.json`. Audit hanya authentication sandbox, master GET dan stock lookup POST read-only yang sudah diizinkan; tidak menyimpan response pelanggan/token.

## 2. Dua scheduler aktif dan terverifikasi

Managed block `MARKETPLACE STAGING PHASE2` dipasang pada crontab `deploy`06:58 UTC. Semua entri non-marketplace dipertahankan. Source tiga wrapper diperiksa terhadap manifest release/base, executable dan syntax Bash valid, secret wrapper cocok dengan runtime store tanpa dicetak.

| Job | Jadwal | Evidence actual | Status |
|---|---|---|---|
| Reservation sweep | Setiap menit |19 scheduled runs sampai07:17 UTC; dua contoh07:16/07:17, success=true, seluruh error/failure/substep0 | Verified |
| Order communications | Setiap menit |19 scheduled runs sampai07:17 UTC; dua contoh07:16/07:17, success=true, sent/retry/failed0 | Verified |
| Stock refresh | Rencana02:00 UTC, `--runs 3` | Baris tetap dikomentari karena manual preflight503 | Pending |

Journald cron terbaca,38 matching entries untuk dua job. Query DB sesudah pemeriksaan: client/order/discount_offer/sales operation/order_email_job semuanya0. Ini bukti scheduler dan no-op sehat, **bukan** bukti pengiriman SMTP/settlement/transaksi provider. Tidak membuat fixture agar job tampak bekerja.

Bukti: `post-import-cron.json`, `post-import-verification.json`; log di `/home/ops/log/marketplace-{sweep,order-comms}/staging/`.

## 3. Stock refresh: kegagalan aktual dan akar perbedaan

Scanner existing mempunyai **59.730 distinct eligible item IDs** melalui join variant→branch_stock→mapped branch. SKU tanpa row lokasi bukan otomatis hilang dan tidak dimasukkan secara fiktif. Kapasitas yang diperlukan: `N=max(1,ceil(59730/20000))=3`.

Satu manual preflight menggunakan wrapper existing `--runs 1` benar-benar dijalankan; **HTTP503, wrapper exit22**. Log route:

```text
stock refresh incomplete: pages 200, items 20000, observed 75634, missing 291, failed 0
```

Ini bukan HTTP200 yang diklaim sukses, bukan network failure dan bukan checker Cartesian. Sebagian mirror aktual diperbarui; cursor maju ke77945. Tidak mereset cursor atau memalsukan observation timestamp untuk row yang ditolak.

Diagnosis read-only:

- 818 row lokal tidak sama dengan formula mentah `stock-on_order-provider_reserved=available`, tetapi **semua row sesuai `max(0, formula)`**, sebagaimana normalisasi importer existing. Bukan bukti stok hilang/korup.
- 12 pasangan dari sample tersebut dibaca kembali dari provider. Contoh: on_hand0, on_order1, reserved omitted, **available−1**. Importer `flattenStock()` menyimpannya sebagai available0/reserved0, sehingga tetap tidak sellable.
- `selectObservedStock()` menolak12/12 sample karena mensyaratkan semua series, termasuk available, nonnegative. Kontrak normalisasi importer dan refresher berbeda untuk negative availability. Jumlah291 mencakup seluruh rejection pada invocation tersebut; tidak menganggap semua291 sudah diperiksa individual.
- Belum mengubah helper, schema, data sumber, stock values, mapping cabang, atau aturan reject lainnya. Daily cron tetap off; tidak menjalankan ulang loop gagal tanpa perubahan relevan.

Lokasi yang dapat diperiksa: `packages/db/src/jubelio-sync.ts` fungsi `flattenStock`, `packages/db/src/jubelio-stock-refresh.ts` fungsi `selectObservedStock`, dan `apps/store/src/app/api/cron/refresh-jubelio-stock/route.ts` mapping incomplete→503.

**Tindak lanjut yang direkomendasikan:** minta persetujuan perbaikan terarah agar observasi dengan formula mentah yang konsisten dan negative availability dinormalisasi fail-closed menjadi0 seperti importer, lalu buktikan freshness dan local holds lewat unit/DB seam serta manual chain3. Jangan melonggarkan validation untuk malformed/missing/duplicate data atau menambah row nol bagi pasangan yang tidak dikirim provider. Perbaikan app code/deployment baru belum dijalankan dalam sesi ini.

## 4. Aktivasi konfigurasi diskon yang telah disetujui

Mengikuti plan§9D3, `discounts.contractVersion`0→1 pada07:14 UTC. Sebelum UPDATE guarded: DB/role tepat, checkout paused, paired store/admin release sama dan healthy, no public direct app ports, trusted proxy aktif, tanpa order/promo lama; typed limits1000 rows/5MiB/25MiB, tax11%/taxID−2 sesuai evidence sandbox sebelumnya. Manifest `deployment/staging/bootstrap.config.json` diselaraskan ke1, mode600.

Reader gate uncached, jadi tidak restart proses. Tidak membuat promo/order atau menjalankan pricing/provider canary. Checkout tetaptrue. Bukti: `post-import-discount-activation.json`, source `readDiscountsContractVersion()` pada `apps/admin/src/lib/discounts-administration.ts` dan [runbook cutover diskon](../../../docs/deployment-docs/discounts-cutover.md).

## 5. Smoke browser dan rendered review

- Existing opt-in store smoke dijalankan terhadap dataset penuh pada1440/390: **2/2 passed**. Katalog, backend search, halaman2, detail dan literal SKU independen terverifikasi; tanpa pageerror/5xx/overflow.
- Run awal desktop gagal pada guard network: satu public thumbnail dari `www.static-src.com`, bukan API/provider write. DB mengonfirmasi URL exact dan2 produk mapped menggunakan prefix image catalog tersebut.
- Hanya harness smoke diperbaiki: image GET/HEAD untuk origin tersebut **dan prefix `/wcsstore/Indraprastha/images/catalog/`** diperbolehkan; script/API/POST tetap diblokir. Diagnostic sekarang mencatat method/origin/path/resourceType, bukan headers/query/secret. Tidak mengubah app source atau URL image DB.
- Diagnosis memakai Markdown kegagalan. Screenshot hanya dibaca setelah final run lulus: `playwright/results/staging/catalog-staging-store-{desktop,mobile}.png`.
- Rendered detail tetap memakai pola/token existing: desktop image+pilihan SKU/cabang, mobile tersusun vertikal dan carousel lokal; tidak ada horizontal page overflow. Tombol keranjang disabled sebelum memilih cabang. Tidak klik cart/order, tidak redesign atau menyatakan seluruh UX/UAT selesai.
- Admin read-only list masih menunggu pemilik menyelesaikan forced reset. Google OAuth end-to-end tidak diuji.

Command evidence: `STAGING_SMOKE=true STAGING_CATALOG_EVIDENCE_FILE=<independent-evidence> npx playwright test --config=playwright.staging.config.ts --project=staging-store-desktop --project=staging-store-mobile --output=playwright/results/staging-post-import` →2 passed. Log lokal privat: `staging-post-import-playwright-final.log` di temporary directory. API Playwright yang dipakai sudah dikonfirmasi pada checkpoint sebelumnya; tidak ada library API baru pada perubahan guard.

Tidak rebuild/restart app, full unit suite, migration, seed, reset atau request transaksi baru. Evidence suite lama tetap berlaku untuk source yang tidak berubah; bukan klaim full suite untuk perbaikan stock yang belum dibuat.

## 6. AC → evidence terkini

| AC | Evidence | Status |
|---|---|---|
| AC01 | Apps tetap release preview yang dipin; original image tags tertimpa saat percobaan sebelumnya, tools memakai adapter source mount. Unifikasi release/image final belum ditutup | Pending |
| AC02 | Jubelio sandbox match dan mode sandbox tetap; pengecualian credential Google staging terkonfirmasi belum disuplai/dipulihkan | Pending |
| AC03 | Evidence existing59 hash/timestamp migrations dan no-op valid; tidak ada schema/journal mutation sesi ini | Verified |
| AC04 | Evidence reset guarded/reference-only lama dipertahankan; tidak mengulang reset; bukan copy data development/tenant lama | Verified |
| AC05 | Satu Owner active/mandatory reset; provisioning, duplicate guard dan login/forced-reset awal terbukti; password pribadi tidak diubah agent | Verified |
| AC06 | Catalog ID reconciliation lulus termasuk2 catalog-only SKU; timestamp/hold checks lulus saat audit. Final stock acceptance/complete-report contract masih tertahan normalisasi dan checker lama | Pending |
| AC07 | Tax/payment mapping sandbox existing, runtime modes, discount limits valid; contract1 dan manifest1 aktual tanpa membuka checkout | Verified |
| AC08 |25 mapped branch masih tanpa origin/jam, footer/static pages kosong; Shipment host/dashboard/callback dan Google input belum ditutup | Pending |
| AC09 | Store2/2 smoke dan rendered review post-full-import lulus; admin list/UAT tertahan forced reset dan readiness | Pending |
| AC10 | Dua scheduler terpasang satu kali;19 scheduled runs/job, body/substep no-op sehat,38 journal entries, entri lain preserved | Verified |
| AC11 | Eligible59.730→N3; actual manual503/missing291, daily stock masih off; perlu perbaikan dan bukti scheduled execution | Pending |
| AC12 | Semua operasi sesi ini sandbox authentication/master-read/stock-read/local-cron;0 business data, tidak ada quote/order/payment/booking/email/OAuth test | Verified |
| AC13 | Checkout tetap paused, belum ada konfirmasi aktivasi terpisah | Pending |
| AC14 | Runbook/evidence diperbarui; handover final menunggu stock fix, credential/input operator dan release reconciliation | Pending |

## 7. Limitations penutupan — item spec yang belum ditutup (verbatim)

- [ ] Seluruh AC01–AC14 Verified dengan command/result target yang relevan; tidak ada PASS dari test yang skipped.
- [ ] Release final dan credentials sandbox dapat diaudit tanpa secret.
- [ ] Data aplikasi lama kosong, journal migration utuh, full import complete dan stock coverage fresh.
- [ ] Owner baru dapat login/reset password; tidak ada akun/order/promo/recovery fixture demo.
- [ ] Origin/jam branch, parcel, konten wajib dan callback configuration tervalidasi; tidak ada pengurangan scope delivery diam-diam.
- [ ] Ketiga scheduler staging benar-benar berjalan, log/permissions benar, dan stock daily coverage dibuktikan.
- [ ] Checkout dibuka hanya setelah konfirmasi operator; tanpa konfirmasi, AC13 tetap Pending dan dilaporkan.
- [ ] Bukti browser terarah dan rendered review tersedia tanpa mengirim provider write yang dilarang.
- [ ] Limitations provider quote/transaksi/callback/email/OAuth yang belum diuji dinyatakan apa adanya.
- [ ] Runbook enduring dan navigasi docs diperbarui; walkthrough actual tercatat.
- [ ] Plan tetap disimpan; index fitur diperbarui dengan tanggal/evidence hanya setelah semua AC Verified.

Beberapa subbagian telah mempunyai evidence di atas, tetapi item gabungan tidak dicentang sebelum seluruh unsurnya terbukti. Bukti browser/admin, release dan handover belum lengkap; item keterbatasan provider dan runbook ikut dibawa untuk closing checklist final, bukan dianggap izin menjalankan canary.
