# Verifikasi deployment staging fase 2

## Status terkini — serah terima operasional

[Paket serah terima](handover-staging-fase-2.md) diserahkan tanpa mengubah staging. Pemilik mengambil alih review admin serta pencocokan Shipment/callback secara manual; agent tidak memeriksanya dan tidak menunggu hasilnya untuk menyerahkan dokumentasi. AC06, AC08, AC09, dan AC14 tetap Pending; lihat tabel AC dan batasan di paket serah terima.

## Histori — konfirmasi operator

Pemilik melaporkan reset System Owner, setup Shipment, dan callback provider sudah dilakukan. Pemilik juga menerima pengisian sebagian cabang/konten sebagai cukup untuk fase ini. Checklist operasional U02–U06 dan A02 ditutup sesuai laporan/keputusan tersebut. Ini bukan bukti kelengkapan semua cabang/konten atau verifikasi independen runtime/dashboard/admin. Tidak ada perubahan staging atau test baru; AC06, AC08, AC09, AC14 dan full unit gate tetap Pending. Lihat [checklist terbaru](checklist-outstanding-staging.md).

## Checkpoint teknis — 2026-11-18 15:16 UTC: Google env diterapkan dan scheduled stock terbukti

**Callback/dashboard Google, readiness operasional dan full verification masih Pending.** Pemilik telah memberikan credential Google staging dan meminta pemasangan. Hanya `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` pada dua env staging diganti; store baru healthy dari image ID yang sama, seluruh non-Google env/admin/Caddy/mounts tetap, checkout tetapfalse. Runtime pair cocok dengan input; GET auth healthHTTP200/oktrue. Tidak rebuild, test suite atau Google sign-in/token exchange. [Evidence Google](setup-google-oauth-staging.md).

Pembacaan log/journal yang sudah ada juga mengonfirmasi actual stock scheduler18November02:00 UTC:3/3 success,59.730 IDs/165.021 observations, missing0/failed0. Query read-only15:16 UTC timestamp kosong/stale24h/negative holds0; tidak memanggil ulang job. [Evidence scheduled stock](verifikasi-stock-terjadwal-staging.md). U01/A01/A05 pada [checklist Anda/agent](checklist-outstanding-staging.md) Verified.

### AC → evidence checkpoint18November

| AC | Evidence | Status |
|---|---|---|
| AC01 | Immutable source/image IDs32-file release tetap; store recreate hanya untuk env Google, tanpa build/source change | Verified |
| AC02 | Pair Google staging eksplisit cocok dengan env/runtime; non-Google env dan mode sandbox tetap. Ini konfigurasi, bukan klaim vendor OAuth exchange | Verified |
| AC03 | Evidence journal59/hash/no-op existing; tidak ada schema/migration mutation | Verified |
| AC04 | Evidence reset/reference-only existing; tidak mengulang reset/seed/import | Verified |
| AC05 | Evidence Owner provisioning/login/forced-reset existing, password pribadi tidak diubah agent | Verified |
| AC06 | Data pull/reconciliation dan mirror observations terbukti; penutupan formal legacy verifier masih terpisah | Pending |
| AC07 | Discount1 dan config provider existing dipertahankan; tidak ada perubahan harga/transaksi | Verified |
| AC08 | Belum ada evidence penutupan origin/jam/konten/dashboard callback/Shipment; Google runtime config kini terpasang | Pending |
| AC09 | Evidence smoke/render source existing dipertahankan; Google end-to-end/admin read-only lanjutan belum ditutup | Pending |
| AC10 | Sweep/email scheduled evidence existing, tidak diubah task Google | Verified |
| AC11 | Manual chain17November + actual scheduled chain18November3/3, journal dan query freshness/nonnegative holds | Verified |
| AC12 | Task ini hanya env/recreate/health/read-only evidence; tidak ada agent Google/provider transaction canary | Verified |
| AC13 | Checkout tetapfalse sesuai persetujuan pemilik, diverifikasi sebelum/sesudah restart | Verified |
| AC14 | Checklist diperbarui; full unit gate, operator readiness/callback dan handover final masih Pending | Pending |

## Histori checkpoint — 2026-11-17 13:24 UTC: checkout staging dibuka; input operator/full gate Pending

**Checkout staging tidak lagi dijeda; readiness origin/konten/callback/Google dan full verification masih Pending.** Pemilik meminta “dibuka aja gapapa karena masi staging” serta breakdown outstanding Anda/agent. Flag `checkout.paused` true→false di DB `qadfstore`, lalu store direcreate dari image ID yang sama; healthy13:24:52 UTC. Runtime env termasuk Google/provider identik, admin/Caddy/mounts tidak berubah. Tidak build, test tambahan, transaksi percobaan atau perubahan kode. Bukti: `/home/ops/log/marketplace-bootstrap/staging/checkout-unpause.json`.

Ini pengecualian readiness gate khusus staging yang diminta pemilik, bukan klaim semua transaksi bisa tuntas atau izin agent membuat order/payment/booking. Tidak akan pause ulang hanya karena outstanding input belum selesai tanpa keputusan pemilik/kondisi keselamatan baru.

[Daftar outstanding berlabel Anda/agent](checklist-outstanding-staging.md): input Google, reset Owner, cabang/konten dan dashboard provider milik Anda; penerapan/cek operasional, bukti stock scheduler dan handover milik agent. Full verification dan perubahan verifier formal tetap dicatat Pending/ditunda sesuai arahan tidak mengerjakan test tambahan.

### AC → evidence checkpoint13:24 UTC

| AC | Evidence | Status |
|---|---|---|
| AC01 | Snapshot32 files + image IDs sama; store recreate hanya untuk cache config, tanpa perubahan source/image | Verified |
| AC02 | Google staging terkonfirmasi masih belum disuplai; mode sandbox lain tidak berubah | Pending |
| AC03 | Evidence59 journal/hash/timestamp/no-op existing; tidak ada migration/schema mutation | Verified |
| AC04 | Evidence reset/reference-only existing; tidak mengulang reset/seed/import | Verified |
| AC05 | Owner tetap must-reset; login/realm isolation sudah terbukti, password tidak diubah agent | Verified |
| AC06 | Data pull/reconciliation/fresh mapped observations terbukti; penutupan formal legacy verifier masih terpisah | Pending |
| AC07 | Contract diskon1 dan config/mode provider tetap, tanpa perubahan harga/transaksi | Verified |
| AC08 |25 cabang tanpa origin/jam, footer/static pages kosong, callback/Shipment/Google input menunggu Anda | Pending |
| AC09 | Smoke/render evidence source yang sama dipertahankan; admin lists menunggu Owner reset, tidak menambah test sekarang | Pending |
| AC10 | Sweep/email scheduled evidence existing, tiga cron tetap terpasang | Verified |
| AC11 | Manual chain3 lulus; stock schedule pertama18November09:00 WIB belum terjadi | Pending |
| AC12 | Operasi ini hanya config+store recreation/readback/health, tidak ada agent provider canary | Verified |
| AC13 | Persetujuan eksplisit membuka staging meski readiness Pending; valuefalse dibaca kembali, proses store baru healthy dari image sama | Verified |
| AC14 | Breakdown owner/dependency disediakan; handover final/full verification/operator/scheduled evidence belum ditutup | Pending |

## Histori checkpoint — 2026-11-17 12:12 UTC: normalisasi aktif, tiga cron terpasang; full gate/operator Pending

**Full unit verification tetap Pending; Google credential belum dipulihkan dan checkout tetap paused.** Pemilik menyetujui normalisasi stock refresher, lalu memilih deploy terarah setelah diberi tahu test cancel-race/cleanup rehearsal di luar perubahan masih gagal.

Release32-file `6c5733833af09635de4a4990e5b1ca4ca5a8f9b5+3256bdb32b3632fcd1a440294ccce09b1b3fbe767c3f2fbead0f841519785609` dibangun dari snapshot Git-base+patch, tanpa kode importer percobaan. Store/admin/tools satu source; apps healthy, Caddy/uploads preserved, Google/provider/env lain tidak berubah. Canonical source dan runtime image-ID override pada `/home/ops/log/marketplace-bootstrap/staging/active-release.json`; metadata import lama hanya histori.

Actual refresh chain3 exit0:59.730 IDs/165.021 observations updated, missing0/failed0, seluruh mapped timestamps baru, local holds tetap0. Stock cron02:00 UTC `--runs 3` kini aktif; **bukti run terjadwal belum ada**, AC11 Pending. Smoke release baru3/3 pass + rendered review1440/390. Sweep/email11 scheduled runs/job sehat sesudah rollout. Tidak ada migration/reset/reimport/Owner reprovision/provider business write.

Detail, bounded scope dan evidence: [penyelarasan stock refresh](penyelarasan-stock-refresh-staging.md). Full gate:207/208 files pass,2493 tests pass/1 fail/12 skipped,1 cleanup error; tidak mengubah modul/test unrelated untuk membuat suite hijau.

### AC → evidence checkpoint12:12 UTC

| AC | Evidence | Status |
|---|---|---|
| AC01 | Immutable base+patch32 checksums, empat image bersih satu source, paired APP_RELEASE/runtime IDs; canonical/default aliases sudah direkonsiliasi | Verified |
| AC02 | Sandbox tetap sesuai input; credential Google staging terkonfirmasi belum disuplai | Pending |
| AC03 | Journal59/hash/timestamp/no-op evidence existing; tidak ada schema/journal mutation baru | Verified |
| AC04 | Reset/reference-only evidence existing, tidak ada reset ulang/data dev/tenant lama disalin | Verified |
| AC05 | Satu Owner wajib reset, login/forced-reset/realm isolation kembali terbukti pada smoke baru; password tidak diubah | Verified |
| AC06 | Catalog IDs match dan seluruh observed mapped stock diperbarui; formal full-import report/legacy Cartesian verifier contract belum ditutup—bukan alasan reimport | Pending |
| AC07 | Tax/payment config sandbox dan discount contract1/manifest1 valid, runtime modes tetap | Verified |
| AC08 | Origin/jam25 cabang, konten dan callback/Shipment/Google input masih operator Pending | Pending |
| AC09 | Smoke3/3 + rendered review current release; admin list/remaining UAT menunggu forced reset dan readiness | Pending |
| AC10 | Sweep/email scheduler sehat pada release baru, masing-masing11 runs pasca-rollout, tanpa dummy data | Verified |
| AC11 | N3/59.730 IDs, actual chain3 sukses dan165.021 rows renewed; cron harian terpasang, scheduled execution belum terjadi | Pending |
| AC12 | Stock read-only sandbox + local cron/auth/public smoke saja; orders/clients/sales-operation/email-job0; no provider business write | Verified |
| AC13 | Checkout tetap paused, belum ada konfirmasi aktivasi | Pending |
| AC14 | Source recovery ditutup dan docs diperbarui; full unit gate, scheduled stock, input operator dan handover final belum ditutup | Pending |

## Histori checkpoint — 2026-11-17 07:19 UTC: katalog direkonsiliasi, dua cron aktif; stock/Google/checkout Pending

**Credential Google staging belum dipulihkan, checkout tetap paused dan daily stock cron belum aktif.** Pemilik meminta melanjutkan pekerjaan agent setelah import. Rekonsiliasi196 halaman cocok dengan39.045 group ID dan108.503 SKU (termasuk2 catalog-only SKU terverifikasi). Sweep/email benar-benar berjalan dari scheduler, discount contract1/manifest1 aktif tanpa restart; store smoke2/2 dan rendered review lulus.

Actual stock manual503:20.000 IDs,75.634 updated observations,291 rejected,failed0. Raw sample provider available−1 dinormalisasi0 oleh importer tetapi ditolak refresher; bukan import hilang atau checker Cartesian. Kapasitas59.730 eligibleIDs memerlukan3 invocation. Perubahan app code belum diizinkan; tidak ada reimport/reset/rebuild/restart/provider business write. Laporan dan AC terkini ada di [verifikasi pasca-import](verifikasi-pasca-import-staging.md): AC03/04/05/07/10/12 Verified; AC01/02/06/08/09/11/13/14 Pending. Google hanya boleh memakai file terkonfirmasi yang belum disuplai, bukan pasangan legacy yang ditemukan.

## Histori checkpoint — 2026-11-17 03:37 UTC: seluruh halaman telah ditarik, deployment final Pending

**Penarikan data telah mencapai akhir; checkout tetap paused dan cron belum diaktifkan.** Resume193 berakhir normal `2026-11-17T03:35:08.041700+00:00` (10:35 WIB), `status=resume_complete`, `reachedEnd=true`, lastCompletedPage196, exit0. Container one-shot tidak ada setelah exit normal, bukan crash.

Tail193–196 memproses645 model/3.199 SKU/5.912 stock observations. Kumulatif prefix+resume: **39.045 model,108.503 SKU,165.021 stock observations**. Query database read-only setelah selesai mengonfirmasi **39.045 model,108.503 SKU,165.021 branch_stock rows**; `checkout.paused=true`. Angka matching ini adalah bukti counts, bukan klaim independent source-ID-set/freshness audit lengkap.

Bukti current: `import-resume.json`, `resume-progress.json`, `import.exit=0`, `import-run.log`. Ini laporan resume berantai, bukan fabricated full report dari halaman1. Tidak mengganti report lama atau melonggarkan checker. Source/release final handover, validasi akhir dataset/stock, konfigurasi operator, jobs/scheduler, browser handover dan aktivasi checkout tetap Pending pada AC01/AC06–AC14. Tidak ada perubahan code/env/restart/aktivasi atau provider request tambahan saat cekstatus ini.

## Histori checkpoint — 2026-11-17 03:27 UTC: resume193 berjalan

**Atas permintaan pemilik, resume dilanjutkan dari halaman193 di background, budget600.** Start `2026-11-17T03:27:59.393137+00:00`, checkpoint192 tuntas. Source/image/preserve-hours/supervisor existing sama, tidak ada perubahan code/env/build/test/reset/app/cron/checkout. Runtime start-page193/cap kosong/600 dan flag preserve-hours dikonfirmasi; jam branch sebelum/sesudah sync tetap sama.

Prefix processed diwarisi38.400 model/105.304 SKU/159.109 stock observations, bukan query total unik DB. Report/log run sebelumnya di histori `import-before-resume193-*`; monitor `resume-progress.json`/`import-resume.json`. Belum mencapai akhir; AC06–AC14 dan handover final Pending. Tidak ada auto-retry baru untuk DNS.

## Histori checkpoint — diperiksa 2026-11-17 03:12 UTC: berhenti DNS, checkpoint192

**Import belum selesai dan tidak sedang berjalan.** Resume108 berhenti otomatis `2026-11-17T02:57:45.818726+00:00` (09:57 WIB), exit1. Log menunjukkan `TypeError: fetch failed`, cause `getaddrinfo EAI_AGAIN api2.jubelio.com`; tidak ada response HTTP, bukan checker stok atau bukti rate-limit.

Halaman192 tuntas, gagal saat193. Resume108 memproses17.000 model/35.092 SKU/44.116 stock observations; logical prefix+seluruh resume=38.400 model/105.304 SKU/159.109 stock observations, bukan total unik DB. Terhadap count master awal39.045, sekitar98,3% processed dan sisa perkiraan645 model. `reachedEnd=false`, `import.exit=1`, container sudah tidak ada. Tidak melakukan restart/perubahan code/env/provider request saat cekstatus. Jika diminta lanjut, start berikut **193**, budget600 dan preserve-hours/source existing yang sama. AC06–AC14 dan handover final tetap Pending.

## Histori checkpoint — 2026-11-17 01:23 UTC: resume108 berjalan

**Atas permintaan pemilik, import dilanjutkan di background dari halaman108 dengan budget600; belum selesai.** Start `2026-11-17T01:23:45.906826+00:00`, checkpoint sebelumnya107 tuntas. Menggunakan source, image, preserve-hours flag dan supervisor existing yang sama; tidak mengubah kode/env, tidak build/test/reset atau restart aplikasi/cron/checkout.

Runtime dikonfirmasi running dengan start-page108, cap kosong, budget600, startup preserve-hours=true. Jam branch existing dibandingkan sebelum/sesudah sync dan tetap sama. Progress/log/exit run sebelumnya disimpan dalam histori `import-before-resume108-*`; `baseWritten` diwarisi dari logical processed21.400 model/70.212 SKU/114.993 stock observations, bukan total unik DB. Monitoring authoritative tetap `resume-progress.json`, `import-resume.json`, `import-run.log` dan `import-restart.json`. Supervisor bukan auto-retry; jika gangguan jaringan berulang, run dapat berhenti lagi sesuai script existing. AC06–AC14 dan source/release final handover tetap Pending.

## Histori checkpoint — diperiksa 2026-11-17 01:18 UTC: resume berhenti pada gangguan DNS

**Import belum lengkap dan tidak sedang berjalan.** Resume23 berhenti otomatis `2026-11-16T18:53:36.667240+00:00` (17 November01:53 WIB), exit1; container one-shot sudah tidak ada. Checkpoint terakhir **halaman107 selesai**, halaman108 sedang diminta saat gagal.

Penyebab dari log: `TypeError: fetch failed`, cause teknis `getaddrinfo EAI_AGAIN api2.jubelio.com`. Ini kegagalan resolusi DNS sebelum response HTTP, bukan checker stok, bukan HTTP408, dan bukan bukti429/rate-limit. Script existing tidak retry exception jaringan tersebut; supervisor sebelumnya mencatat outcome, tidak menjadwalkan auto-restart.

Resume memproses17.000 model/46.370 SKU/60.400 stock observations. Logical prefix22+resume=21.400 model/70.212 SKU/114.993 stock observations; bukan total unik DB. Query DB read-only saat cekstatus menemukan **21.406 model,70.237 SKU,115.052 stock rows**. Tidak menafsirkan selisih kecil sebagai data rusak tanpa rekonsiliasi; source data dapat berubah dan totalDB berbeda dari processed counters.

`resume-progress.json` dan `import-resume.json` berstatusfailed, reachedEndfalse, lastHttpErrornull (supervisor hanya mengenali HTTPerror, causeDNS diambil dari log). Tidak ada restart/code/env/provider request saat cekstatus. Kelanjutan yang tepat dari checkpoint adalah **halaman108**, dengan source preserve-hours/budget600 yang sama bila diminta. AC06–AC14 serta release final handover tetap Pending.

## Histori checkpoint — 2026-11-16 17:01 UTC: resume dari halaman23 berjalan

**Import resume berjalan di background pada600 request/menit, dari halaman23; belum mencapai akhir.** Pemilik memilih **Resume23 aman** setelah diberi konteks bahwa `--full` menolak start-page>1, sedangkan jalur start-page existing mengisi jam default07:00–22:00. Persetujuan mencakup penyesuaian minimal untuk mempertahankan jam, tanpa reset/rebuild app/aktivasi checkout/cron.

- Perubahan hanya `packages/db/src/jubelio-import-options.ts` (optional `preserveBranchHours?: boolean`, flag `--preserve-branch-hours`), `packages/db/src/import-jubelio.ts` (mode start-page meneruskan undefined operatingHours bila flag dipakai, startup log flag) dan test parser. Helper upsert/source stok, checker, retry dan full-mode guard tidak diubah.
- RED parser mengabaikan flag → GREEN; focused `jubelio-import-options.test.ts` + `jubelio-sync.test.ts` **26/26 pass**; package DB typecheck pass. Tidak menjalankan full suite, E2E, atau build. Context7 N/A: perubahan pure repo-internal option wiring, API package existing tidak berubah. UX visual N/A: CLI saja. Full integration/penutupan deployment tetap Pending, bukan syarat untuk menghentikan job berdasarkan dugaan lain.
- Mode yang dijalankan **resume/start-page existing, bukan `--full`**: `JUBELIO_SYNC_START_PAGE=23`, cap kosong, concurrency2, budget600, `--preserve-branch-hours`. Preflight memverifikasi DB aktual `qadfstore`, env staging dan tidak ada importer kedua. Image dipin dan source-copy readonly memakai tiga file dengan checksum manifest di `resume23-files/manifest.json`; source/override baru direkam dalam `import-restart.json`. Tidak mengubah `.env` aktif atau app containers.
- Start `2026-11-16T17:00:59.082177+00:00`. Runtime diverifikasi running, start-page23/no-cap/600/flagtrue. Jam seluruh branch existing dibandingkan sebelum/sesudah branch sync dan **tetap sama**. Checkpoint sebelum resume adalah22 halaman/4.400 model/23.842 SKU/54.593 stock observations; bukan DBtotal4.840 model.
- Supervisor `resume23-supervisor.py` berjalan via nohup/session terpisah, mengamati stdout CLI saja dan menulis `resume-progress.json`. `lastCompletedPage` hanya maju sesudah baris running-totals (produk/SKU/stock page selesai), bukan saat masters baru diminta. Laporan akhir nanti `import-resume.json` berstatus `resume_complete` atau `failed`; **bukan** full report dari halaman1. `logicalProcessed` adalah prefix+resume processed counters, bukan total unik DB.
- Bukti run gagal sebelumnya disimpan dalam histori `import-before-resume23-*`. Current log tetap `import-run.log`, exit marker dihasilkan supervisor saat selesai. Jika error408 berulang, script existing tetap dapat berhenti: penyesuaian ini tidak diam-diam menambah retry408.
- Pemeriksaan independen17:01 UTC: container running, currentPage23, lastCompletedPage22, resume written0 dan prefix4.400 model. Pemeriksaan akhir sesi mengonfirmasi halaman23–25 tuntas: resume memproses600 model/1.351 SKU/1.791 stock observations, sedang halaman26 dan tidak ada HTTP error tercatat. Logical processed prefix+resume5.000 model, bukan klaim total unik DB. Identitas release final/tools operational adapter perlu direkonsiliasi pada handover; jangan menganggap seluruh app/tools tree unified atau full catalog complete sebelum gate final.

## Histori checkpoint — diperiksa 2026-11-16 16:29 UTC: import berhenti otomatis pada HTTP408

**Full import belum selesai dan tidak sedang berjalan.** Run600 berakhir `2026-11-16T16:15:06.350Z`, exit4, container one-shot sudah dihapus oleh `--rm`. Bukan penghentian manual agent dan bukan penolakan checker SKU×cabang.

Error aktual pada final report: `jubelio-sync: GET /inventory/items/66068 failed (408)`. Script existing retry429/5xx tetapi tidak408, sehingga satu response408 pada detail SKU mengakhiri run. Tidak menyimpulkan408 disebabkan rate limit600; rate-limit terdokumentasi memakai429. Tidak ada source/env/restart baru ketika pemeriksaan status ini.

Run baru menyelesaikan22 halaman/4.400 model/23.842 SKU/54.593 stock observations; halaman23 sudah diminta tetapi enrichment gagal. `reachedEnd=false`; report `incomplete`. Source group set4.600 sudah mencakup halaman23 sebelum upsert; database masih4.840 model/25.046 SKU dari upsert gabungan run sebelumnya. Warning `SOURCE_DRIFT`/DB outside source berasal dari rekonsiliasi run terputus (recheck akhir tidak tercapai), bukan bukti tersendiri data provider berubah/rusak. Data sebelumnya tidak dihapus.

Bukti: `import.json`, `import.exit=4`, `import-run.log` di direktori staging; error1/mismatch2, report mencatat enam reasons. AC06–AC14 tetap Pending. Persiapan P1–P4 tetap terverifikasi terpisah. Langkah berikut perlu kelanjutan import; perubahan retry408 atau mekanisme resume bukan sesuatu yang diam-diam diterapkan pada permintaan cek status.

## Histori checkpoint — 2026-11-16 16:03 UTC: persiapan paralel diverifikasi, import tetap600

**Import masih berjalan, checkout paused dan cron staging0; AC06–AC14 deployment tetap Pending.** Pemilik menyetujui audit konfigurasi, persiapan cron nonaktif, cleanup percobaan optimisasi dan perapian runbook sambil menunggu import. Keempat AC persiapan P1–P4 Verified dengan bukti pada [laporan persiapan paralel](persiapan-paralel-staging.md).

- Read-only DB/runtime audit: 25 cabang mapped (24 aktif), seluruhnya origin/jam belum terisi; HQ lokal terpisah. Footer/static page0; satu Owner masih wajib reset. TTL15, PPN11/tax-2, fallback250g/30×20×10cm, packaging15g sesuai input; diskon contract0 dan pausedtrue tetap dipertahankan.
- Callback secrets terpasang tetapi registrasi dashboard tidak diklaim. Host Shipment runtime berbeda dengan referensi sandbox, dicatat belum terverifikasi; tidak diubah/dipanggil. SMTP_HOST kosong bukan blocker karena source memakai Gmail465.
- Tiga wrapper syntax-valid/executable; log dirs writable; daemon cron aktif; draft managed block seluruhnya commented siap di host. N final/instalasi/eksekusi scheduler masih Pending; tidak memanggil endpoint jobs.
- Empat file source optimisasi dikembalikan identik baseline lokal dan host; test percobaan dihapus hanya setelah checksum cocok; automation/candidate diarsipkan dan env candidate tidak terpakai dihapus. Konfigurasi/source mount aktif tidak disentuh. Disposable test container55442 dibersihkan; development5432 tetap running.
- Runbook dibetulkan agar tidak mengklaim pacing/concurrency5 atau menggunakan tag candidate sebagai release aktif. Default template120 bukan runtime600; monitoring tidak membuat request provider. Tidak ada unit/E2E/build/restart/aktivasi/request Jubelio tambahan, Git commit/push, atau operasi production.
- Cekakhir16:03 UTC: **container import yang sama** running600,17 halaman/3.400 model/17.722 SKU/44.369 stock observations, partial error0. Ini counter run baru, bukan total unik database. Status/data terus berubah selama import.

## Histori checkpoint — 2026-11-16 15:23 UTC: budget600 aktif, configuration-only

**Run baru terkonfirmasi running dengan budget600 request/menit; full import belum selesai, AC06–AC14 Pending.** Pemilik secara eksplisit meminta maksimum600 sesuai dokumentasi, tanpa headroom. Hanya `JUBELIO_SYNC_REQUESTS_PER_MINUTE` pada `.env`/`.env.staging` diubah450→600, lalu satu restart terkontrol importer; tidak ada code/test/build/schema/reset/Owner/app restart atau aktivasi checkout/cron.

Start `2026-11-16T15:23:32.030705+00:00`; image dan source existing read-only mount sama dengan run450, credentials/DSN/release diverifikasi tetap sama. Wrapper existing/nohup dan Compose override source existing dipertahankan. Run baru kembali dari halaman1 dengan upsert; counter report baru tidak berarti data lama dihapus. Bukti run450 di histori `import-before-config600-*`; monitoring tetap `import-restart.json`, `import-run.log`, partial/final report, exit marker dan state container. Budget600 adalah limit client, bukan jaminan throughput600; HTTP429 masih mungkin jika ada penggunaan kuota bersama. Tidak mengaktifkan kembali pipeline optimisasi kode yang sudah dibatalkan.

## Histori checkpoint — 2026-11-16 14:45 UTC: budget450 aktif, configuration-only

**Import berjalan di background dengan `JUBELIO_SYNC_REQUESTS_PER_MINUTE=450`; full import belum selesai, AC06–AC14 tetap Pending.** Pemilik mengoreksi scope menjadi perubahan `.env` saja, bukan implementasi optimisasi kode/tests. Pipeline kode dibatalkan (`import-acceleration-job-status.json`: `cancelled-config-only`); jangan menghidupkannya kembali tanpa izin baru.

- Start baru: `2026-11-16T14:45:16.211533+00:00`. `.env` dan legacy `.env.staging` hanya diubah budget import menjadi450. Tidak rebuild image lagi, tidak restart store/admin, tidak reset DB/Owner, tidak mengaktifkan checkout/cron. Full mode existing tetap mulai halaman1 dan upsert; counter run baru bukan jumlah seluruh produk tersimpan.
- Perubahan kode pacing/cooldown/concurrency **tidak dipakai**. Effective concurrency mengikuti script existing (2 meskipun ENV5), bukan klaim5. Perilaku retry/limiter tetap milik script existing; jangan mengklaim pacing/cooldown baru sudah aktif.
- Build kandidat sebelumnya telah menimpa tag image bootstrap dan image lama tidak dapat di-tag ulang dari config/manifest digest, walaupun container masih running. Sebelum stop, source existing `/app/packages/db/src` disalin dari container aktif ke direktori privat laporan `existing-importer-source-*` (path aktual di `import-restart.json`); tiga file inti dibandingkan byte-for-byte dengan base Git dan cocok. Tidak memakai Docker commit/export sehingga env/secret runtime tidak dibakukan ke image.
- Untuk mempertahankan **kode existing tanpa rebuild**, run baru memakai base image yang tersedia dengan bind-mount source existing read-only ke `/app/packages/db/src`, melalui override konfigurasi yang direkam dalam `import-restart.json`. Source optimisasi di base image tertutup mount tersebut. Ini **bukan** image digest lama; klaim yang diverifikasi adalah source importer existing, bukan same-image. Aplikasi tetap pada image/release sebelumnya.
- Wrapper `release/import-full.sh` unchanged dijalankan melalui `nohup`, dengan `COMPOSE_FILE` berisi Compose staging dan override khusus importer. Runtime Docker dikonfirmasi `running`, budget450, APP_RELEASE sama, credential/DSN identik dengan run sandbox sebelumnya, mount source read-only sesuai. Run/report lama dipertahankan dalam histori `import-before-config450-*`.
- Catatan verifikasi kandidat yang **dibatalkan**: full unit mendapat5fail/2478pass/29skip; tiga kasus membutuhkan demo seed pada DB disposable, satu pickup-code collision, satu assertion race cancel. Sesudah seed disposable, focused105pass/1skip dengan koreksi sementara assertion race. Koreksi test itu dibatalkan kembali saat pemilik meminta config-only. Tidak mengubah runtime cancel flow atau mengklaim full suite kandidat PASS. Perubahan optimisasi lokal/server source kandidat belum dipublish/diaktifkan, jangan ikut commit/deploy tanpa izin baru.
- Status monitoring authoritative: container `staging-full-import-phase2`, `/home/ops/log/marketplace-bootstrap/staging/import-restart.json`, `import-run.log`, lalu partial/final report dan exit marker run baru. Konfigurasi ini mempertahankan headroom terhadap batas dokumentasi600/menit; throughput aktual belum diukur, tidak menjanjikan3,75×.

## Histori checkpoint — 2026-11-16 14:23 UTC: optimisasi disetujui, verifikasi/aktivasi background

**Target450 belum aktif pada pemeriksaan terakhir; import lama masih berjalan120 request/menit.** Checkpoint14:16 UTC: 20 halaman/4.000 model/21.260 SKU/51.581 stock observations, partial error0. AC06–AC14 tetap Pending.

- Pemilik memilih **Percepat (Recommended)**:450 request/menit paced, concurrency5, semua login/retry ikut budget, cooldown semua request importer minimal60 detik pada429 atau Retry-After yang lebih lama; satu restart terkontrol full dari halaman1 dengan upsert tanpa reset. Tidak mengubah checker/parcel/Owner, checkout/cron tetapoff.
- Technical blueprint slice kecil: `packages/db/src/jubelio-sync.ts` (HTTP client; pacing/cooldown bersama, public seam `fetchMastersPage`); `packages/db/src/jubelio-import-options.ts` (input contract `FullJubelioImportOptions.concurrency?: number`, validator ENV positive integer/default2); `packages/db/src/import-jubelio-service.ts` (memakai input concurrency, dependency override dipertahankan, startup log nilai aktual). Tests pada `packages/db/src/jubelio-sync.http.test.ts`, `packages/db/src/jubelio-import-options.test.ts`, dan regression existing `packages/db/src/jubelio-sync.test.ts`. Staging defaults dan fixture config di `deployment/staging/{docker-compose.yml,.env.example,deployment-config.test.mjs}`; dokumentasi `docs/deployment-docs/staging-phase-2-deployment.md`. UX visual/list-table gates N/A: tidak mengubah UI/routing/auth atau bentuk data katalog.
- Context7 `/websites/jubelio`:600/menit dan429 tunggu1 menit. `/vitest-dev/vitest/v4.1.12` (installed4.1.10): fake timers, advanceTimersByTimeAsync, stubEnv/stubGlobal/resetModules/cleanup. Tidak menebak API package.
- TDD: pacing RED request login/master sama-sama0ms → GREEN200ms; cooldown RED request paralel lolos sebelum60 detik → GREEN; HTTP-date/terminal429/login429 RED→GREEN; ENV concurrency5/invalid values RED→GREEN. Focused3 files **41/41 pass**. DB migration disposable + focused full-import/checkout seams **10/10 pass**. DB/store/admin typechecks pass; Compose/context2/2 pass.
- Final unit pertama gagal karena DB disposable baru masih0 tabel; bukti relation missing diperiksa, lalu migrator resmi dipakai **hanya pada DB disposable port55442**. Full run berikutnya terinterupsi tool sebelum summary, tidak dihitung PASS. Full serial suite kini dijalankan ulang di background; belum ada klaim final PASS. Database development5432 dan staging tidak dimigrasikan/reset untuk optimisasi ini.
- Prepared release: `6c5733833af09635de4a4990e5b1ca4ca5a8f9b5+230b7cc4946c0853187896ba1c4768550255755937c97a1330088826878d5401` (**30 file /92.451 bytes**). Server base replay via temporary Git index dan checksum30 file cocok. Empat image build memiliki markerBuilt tanpa failed-to-solve. `.env.acceleration` mode600 disiapkan; env aktif dan container import lama belum diganti. Source/manifest `.next` merupakan kandidat, bukan identitas runtime aktif sebelum cutover.
- Karena pemilik meminta background, proses Node detached lokal PID32132 menjalankan `C:/Users/USER/AppData/Local/Temp/import-acceleration-background.cjs`. Status: `C:/Users/USER/AppData/Local/Temp/import-acceleration-job-status.json` (14:23:12 UTC `phase=validating`); logs unit/deploy pada direktori temp yang sama. **Jangan menjalankan pipeline/import kedua sebelum memastikan job ini tidak aktif.**
- Jika full unit exit0, job otomatis SSH menjalankan `/home/ops/log/marketplace-bootstrap/staging/release/remote-activate-acceleration.py`: verifikasi checksum/candidate env/image/credential unchanged, checkout paused dan cronoff; stop hanya importer existing yang identitasnya cocok; tunggu wrapper selesai dan arsipkan log/report; aktifkan env450/5 + manifest30; recreate paired apps dari image siap, periksa healthy/HTTPS; jalankan importer lewatnohup, konfirmasi env450 serta startup log effective concurrency5 dan jumlah data tidak menurun. Jika tests gagal, **tidak menyentuh import lama**. Bila activation gagal, status lokal `blocked-deployment` dan status server `acceleration-cutover-status.json` menjelaskan fase; jangan mengasumsikan rollback/restart otomatis.
- Static checks Node dan Python activation script pass. Disposable PostgreSQL `marketplace-import-acceleration-tests` masih dibutuhkan job unit yang berjalan; cleanup hanya container ini setelah validation selesai, bukan `storefront-postgres`.

### AC slice percepatan → evidence

| AC slice | Evidence | Status |
|---|---|---|
| Pacing450 tanpa burst dan hard cap600, login/retry ikut budget | Public HTTP fake-clock tests, termasuk target450 dan request paralel | Verified |
| Semua request importer menunggu minimal60 detik saat429/Retry-After lebih lama | Tests tanpa/pendek/panjang/HTTP-date, terminal429 dan login429 | Verified |
| Concurrency ENV5 benar-benar masuk full-mode tanpa menghilangkan field | Options tests/default/invalid, service input wiring, regression full-import fixture10pass | Verified |
| Final integration tidak regresi | Full unit background belum summary; types3 target dan config/context2pass | Pending |
| Runtime450/effective5 berjalan background setelah satu restart tanpa reset/aktivasi checkout | Pipeline bersyarat sedangvalidating; import lama120 tetaprunning | Pending |
| Kenaikan throughput aktual dan full catalog selesai | Belum diukur, final report belum ada | Pending |

## Histori checkpoint — 2026-11-16 10:34 UTC: full import dijalankan ulang

**Full import sandbox berjalan ulang; katalog masih parsial sampai proses mencapai akhir. AC06–AC14 tetap Pending.** Pemilik secara eksplisit meminta rerun script existing dan melarang penghentian berdasarkan dugaan coverage sebelumnya. Tidak mengubah checker/importer, tidak mereset database, tidak membuat ulang Owner, dan tidak mengaktifkan checkout/cron.

- Start: `2026-11-16T10:34:58.007316+00:00`. Wrapper existing `release/import-full.sh` diverifikasi checksum sama dengan salinan lokal sebelum dijalankan melalui `nohup` pada session terpisah.
- Command tetap `tsx src/import-jubelio.ts --full --expected-database=qadfstore --report-file=/reports/import.json` di service bootstrap/container `staging-full-import-phase2`; mulai dari halaman 1 dengan upsert existing, bukan resume page2 atau reset data.
- Target DB/env staging dan kesesuaian credential bootstrap/store diperiksa privat tanpa mencetak secret. Tidak memakai credential production lama atau membuat business write provider.
- Dua pemeriksaan Docker terpisah mengonfirmasi container `running`. Pada pemeriksaan setelah start, belum ada marker failure, partial/final report baru, atau exit marker. Ini bukti proses mulai/berjalan, bukan bukti seluruh katalog selesai.
- Bukti run pertama dipindahkan sebagai histori log ke `/home/ops/log/marketplace-bootstrap/staging/history/import-before-rerun-20261116T103458Z/`, bukan backup database. Exit143/report lama tidak ditampilkan sebagai hasil rerun.
- Run baru: `import-run.log`, `import-restart.json`, lalu `import.json.partial`/`import.json` dan `import.exit` setelah dihasilkan proses, di direktori staging yang sama. Tidak ada penghentian otomatis tambahan berdasarkan jumlah pasangan stok pada sample.
- Tidak ada code/library API baru, build, schema sync atau perubahan dependency; Context7 dan rerun tests tidak diperlukan untuk eksekusi ulang script existing ini. Evidence unit/browser sebelumnya tidak dipakai sebagai klaim full import selesai.

### Temuan percepatan import — belum ada perubahan runtime

- Context7 checkpoint `/websites/jubelio`: dokumentasi resmi `https://docs.jubelio.com/dist.yaml` mengonfirmasi **600 request/menit**, HTTP429 meminta menunggu **1 menit**. Salinan repo `docs/jubelio-api/dist.yaml:189–194` konsisten. Ini menggantikan ketidakpastian limit sebelumnya, bukan bukti bahwa seluruh kuota bebas dari aktivitas lain.
- Container import memiliki `JUBELIO_SYNC_REQUESTS_PER_MINUTE=120`, `JUBELIO_SYNC_CONCURRENCY=5`; tetapi full-mode service memakai `dependencies.concurrency ?? 2`, dan CLI hanya meneruskan `{db}`, sehingga effective concurrency tetap 2. SKU parcel GET berurutan per group; ukuran halaman200 tidak berarti satu request untuk seluruh detail.
- Checkpoint 2026-11-16 13:42 UTC: running, 18 halaman/3.600 model/18.823 SKU/47.011 stock observations, partial error0. Throughput sekitar1.150 model/jam; tidak menyimpulkan server CPU/DB bottleneck tanpa pengukuran.
- Usulan untuk keputusan pemilik: target450 request/menit dengan request-start pacing, concurrency5 benar-benar diterapkan, login/retry ikut budget, shared cooldown seluruh importer minimal60 detik untuk429 (atau Retry-After lebih lama). Sisakan150/menit terhadap limit dokumentasi, hindari importer paralel; tidak menganggap budget process-local sebagai kuota global semua client.
- Konfigurasi dimuat saat startup: menerapkan usulan memerlukan perubahan kecil limiter/concurrency dan restart terkontrol. Full-mode existing tetap mulai halaman1 dengan upsert; tidak reset database/membuat Owner ulang, tidak menghilangkan parcel atau mengubah checker, checkout/cron tetapoff. Potensi kenaikan budget3,75× bukan jaminan throughput/ETA.
- Fakta belum diketahui: throughput/429 aktual pada target450. Keputusan user: apakah mengizinkan perubahan dan restart terkontrol. Di luar scope: mengubah checker, mengurangi field/data, melewati rate limit, business writes provider. Proses existing tidak dihentikan saat penyelidikan ini.

## Histori checkpoint — 2026-11-15 17:21 UTC: preview parsial aktif

**Preview store/admin dapat dibuka (healthy/HTTP200), tetapi full import dan acceptance keseluruhan belum terpenuhi; AC06–AC14 Pending.** Import tetap dihentikan; hanya 200 product groups, 1.183 SKU dan 4.080 observed stock rows dari sandbox. Checkout paused, diskon contract 0, cron staging 0, client/order 0. Tidak ada perubahan importer/verifier atau normalisasi stok yang tidak dikirim menjadi nol.

### Pelurusan: fakta laporan versus prediksi checker

Pembacaan ulang langsung `import.json.partial` sesudah pertanyaan pemilik mengonfirmasi: `status=partial`, `pagesVisited=1`, `reachedEnd=false`, `finishedAt=null`, `errors=[]`, `mismatches=[]`, `reasons=[]`, `stockPairsRequested=0`, `stockPairsCovered=4080`. Final `import.json` tidak ada; exit marker tetap 143 setelah agent melakukan Docker stop.

**29.575 adalah proyeksi agent dari rumus kode pada sample pertama, bukan angka kegagalan yang dikeluarkan job.** `stockPairsRequested` baru dihitung sesudah loop seluruh halaman selesai; pemeriksaan/reconciliation akhir belum tercapai. Empty mismatch/reasons pada partial juga bukan bukti verifikasi akhir lulus. Ada indikasi ketidakcocokan kriteria coverage dengan respons sparse, tetapi belum ada final report yang membuktikan keseluruhan import gagal atau data hasil import salah. Penghentian merupakan keputusan operasional agent berdasarkan indikasi tersebut, bukan penolakan otomatis script/provider. Frasa "blocker"/prediksi gagal pada histori tidak boleh dibaca sebagai observed final failure. Tidak ada perubahan importer/verifier, resume, atau provider request baru dalam pembacaan ulang ini.

### Persetujuan dan hasil preview

- Pemilik memilih **Buka preview parsial**; pengecualian urutan membuka app sebelum full import complete dicatat eksplisit. Pemilik meminta penjelasan detail masalah import, **bukan** approval audit/addendum/perubahan stock policy.
- `docker compose -p staging --env-file .env up -d --no-build store admin` membuka paired app; health keduanya `healthy`, HTTPS store `/` dan admin `/login` HTTP200/TLS verification 0. Volume/Caddy dipertahankan.
- Smoke pertama: **1 admin pass, 2 store fail**. Markdown failure dibaca, image kegagalan tidak dibuka. Assertion katalog/page2/search/detail sudah tercapai, tetapi guard mencatat request di luar origin store.
- Diagnosis browser menunjukkan **20 request GET image** ke public CDN `https://jb-assets.sgp1.cdn.digitaloceanspaces.com` pada satu katalog page; bukan quote/order/payment/booking dan bukan request memakai credential provider. Test guard diperbaiki hanya untuk GET/HEAD dengan resource type `image` pada origin CDN tersebut; tidak membuka API host atau POST eksternal.
- Delta dari release pertama **hanya** `e2e/store/staging-deployment.spec.ts`. Tidak mengubah importer, verifier, stock data, atau app business code. Full patch baru diverifikasi terhadap base melalui temporary Git index `read-tree` + `git apply --cached --check`, seluruh 25 file checksums cocok, empat image dibangun dari source terkini dan paired app direcreate.
- Release preview terkini: `6c5733833af09635de4a4990e5b1ca4ca5a8f9b5+93f51c15483c009aa163ff808b488c9202aa858b38cb0e2fa469ce8ad2b2daef`, patch **77.349 bytes / 25 file**. SHA/patch dan IDs pertama di histori bawah sudah digantikan untuk app aktif, bukan bukti current release.
- Image store aktif: `sha256:b063a8317b0d58ed7bb865f9a395918672283d5202ffbf473bb6865dd510d3b5`; admin aktif: `sha256:9297e49ac7eaea1b0c73683ce136c77adaa39302415a28c2a1294716884bf30a`; migrate: `sha256:bbc8e14867db2f253af5890fbdbfcd34c12dd93294d858a97fc3e4cde7b7657a`; bootstrap: `sha256:a8d9617c8fea904d3adcb8046d5f59d05f1b768818aa60e30127af00c7d225ce`. Resolved Compose empat service diperiksa ulang terfilter: seluruh `APP_RELEASE` sama dengan manifest preview baru; tidak ada credential production lama yang diaktifkan kembali.
- Final `STAGING_SMOKE=true ... npx playwright test --config=playwright.staging.config.ts --reporter=line`: **3/3 pass** (store desktop, store mobile, admin Owner forced-reset/realm isolation). Tidak mengganti password Owner, submit checkout, membuat akun client/order, quote/payment/booking, atau menjalankan cron.
- Passing full unit serial **208 files / 2.484 pass / 12 skipped** tetap valid: delta sesudahnya hanya guard smoke E2E, bukan logic/unit tests/dependencies. Tidak mengulang full suite tanpa perubahan relevan. Test/browser snapshots terbaru berada di `playwright/results/staging/`; final log `C:/Users/USER/AppData/Local/Temp/staging-preview-playwright-v2.log`.
- Rendered review dilakukan pada daftar/detail store dan login admin, viewport **1440 dan 390**: screenshot sukses diinspeksi, tidak ada horizontal overflow, image CDN tampil, focus keyboard terlihat, form login memakai label existing. Reuse visual mengikuti source release tanpa CSS/component redesign. Mobile masih memakai filter panjang di atas katalog dan floating WhatsApp menutupi sebagian area kanan Reset Filter—catatan pola existing, tidak diperbaiki diam-diam dalam deployment. Tidak mengklaim full UX/UAT state order/admin operations.
- MCP browser tidak dapat memulai karena Chrome channel tidak terpasang; tidak mengubah harness/install browser. Manual verification memakai bundled Chromium dari Playwright terpasang. Context7 `/microsoft/playwright/v1.62.1` dan installed `node_modules/playwright-core/types/types.d.ts` dikonsultasikan untuk routing/resourceType/Chromium context APIs.
- Manual DOM review guest catalog/admin-login (desktop/mobile): keempatnya HTTP200, overflow false, error count 0, blocked request 0. Tidak mengetik password pada manual screenshots. Artefak aman di `playwright/mcp/staging-preview/{render-review.json,catalog-1440.png,catalog-390.png,admin-login-1440.png,admin-login-390.png}`.
- Server `/home/ops/log/marketplace-bootstrap/staging/preview-status.json` mencatat snapshot 17:21:06 UTC: semua 25 source checksums cocok; dua app healthy; data 200/1.183/4.080; Owner 1 wajib reset; client/order 0; paused=true; contract=0; cron aktif 0; import exit143 dan final success report tidak ada.

### Masalah data yang benar-benar teramati

1. **Blocker completeness stock:** respons sparse tidak memenuhi asumsi semua SKU × seluruh cabang. Diagnosis dan lokasi kode ada di histori 16:49; tidak ada bukti omission berarti nol, tidak ada bypass guard.
2. **Katalog parsial akibat penghentian:** baru satu halaman, bukan source API catalog gagal mengembalikan seluruh data. Master melaporkan sekitar 39.045 product groups. UI list saat review menampilkan 163 produk sesuai filter sellable dari 200 group yang sudah tersimpan; angka tampilan bukan jumlah seluruh group database.
3. **Kualitas parcel:** pada halaman pertama `dataQuality.skusMissingParcelDimensions=496` dari 1.183 SKU. Artinya data berat/dimensi belum dinormalisasi menjadi parcel valid, bukan SKU hilang. Penyebab spesifik data sumber/mapping belum disimpulkan. Fallback 250 gram/30×20×10 cm dan packaging 15 gram sesuai keputusan pemilik, bukan pengukuran semua SKU. `productGroupsMissingImage=0`, `productGroupsMissingDescription=0` pada **sample pertama saja**.
4. **Volume import:** minimal teoretis 11 jam sebelumnya mengasumsikan hanya satu SKU/group; actual sample memiliki 1.183 SKU/200 group dan masing-masing SKU memerlukan GET tambahan. Angka itu bukan ETA; durasi perlu dihitung ulang setelah kontrak coverage benar. Tidak melanjutkan crawl yang sudah diketahui belum bisa membuktikan kelengkapan.
5. Origin/jam branch/konten/callback belum siap adalah input operasional yang ditunda sesuai pilihan pemilik, **bukan** bukti importer harus menebak data tersebut. Semua tetap Pending.

### AC → evidence terkini

| ID | Evidence terkini | Status |
|---|---|---|
| AC01 | Base+patch preview baru, base replay check, 25 checksum, empat image build dan paired app healthy pada release sama | Verified |
| AC02 | Sandbox secret transfer/compare, source/env/context/image guards; credential production lama tidak dipakai/diaktifkan kembali | Verified |
| AC03 | Journal 59 hash/timestamp sesuai release dan rerun migrator no-op; migrations tidak berubah pada refresh smoke | Verified |
| AC04 | Reset data lama guarded tanpa backup, struktur/journal/volumes dipertahankan; data sekarang hanya referensi dan partial sandbox baru | Verified |
| AC05 | Seed reference-only/idempotent, satu Owner aktif wajib reset, duplicate OWNER_EXISTS; browser login/forced-reset berhasil, tanpa reset password otomatis | Verified |
| AC06 | Import berhenti setelah page1; 200 groups/1.183 SKU/4.080 stock rows, belum ada final report; sparse coverage unresolved | Pending |
| AC07 | PPN/account master dan runtime wiring ada, tetapi diskon contract masih 0 dan seluruh activation readiness belum ditutup | Pending |
| AC08 | Origin/jam/parcel quality/konten/callback belum tervalidasi lengkap; scope ditunda eksplisit, tidak diisi dummy | Pending |
| AC09 | Healthy/HTTPS, 3 smoke pass dan rendered review preview; seluruh admin read-only surfaces/remaining states menunggu forced reset pemilik dan readiness config | Pending |
| AC10 | Cron staging tetap 0; belum ada dua scheduled sweep/email run | Pending |
| AC11 | Full eligible count/N/freshness/daily scheduler belum dibuktikan | Pending |
| AC12 | Seluruh tindakan checkpoint teramati read-only/auth yang diizinkan, tanpa business write; audit akhir sisa import/jobs/browser scope belum ada | Pending |
| AC13 | Checkout tetap paused, belum ada approval aktivasi; tidak ada order/provider canary | Pending |
| AC14 | Runbook/evidence/approval preview tercatat; penutupan full deliverable dan walkthrough remaining steps belum terpenuhi | Pending |

## Histori checkpoint — 2026-11-15 16:49 UTC

**Store/admin staging masih maintenance (HTTP 502); AC06–AC14 Pending.** Source/image baru telah disiapkan, migration/reset/reference/Owner dijalankan, tetapi full import dihentikan karena blocker coverage stock nyata. App containers berstatus `created`, tidak berjalan; Caddy tetap berjalan dan checkout tetap paused. Tidak ada klaim deployment user path selesai.

### Release dan eksekusi target yang terverifikasi

- Base SHA: `6c5733833af09635de4a4990e5b1ca4ca5a8f9b5`.
- Patch SHA-256: `174d9311d83a831823ab2f0938a67a55dad24fa2f8a5342b5f8bb4d9b525b75f`; 25 file allowlist, 77.112 bytes. Server `git apply --check` dan seluruh checksum file/mode sesuai. Tidak membawa `.scratch`, env, secret atau output testing dalam patch.
- Identitas runtime: `<base-sha>+<patch-sha256>` identik store/admin/bootstrap/migrate. Source berasal dari pinned fetch + patch; tidak ada commit/Git push, operasi database/domain/container production, atau subagent.
- Image store: `sha256:7e12ed150b35f21425c1c90304fa12ca234d756382f35b1928a6a04efc338588`.
- Image admin: `sha256:ba81835806fb02f39c44a8a8fe280c50d0daef8d0a45ebcdc0e0e804f571f6a0`.
- Image migrate: `sha256:144b28a704ddcbd33c97baa678cd64b0323a6dd570af49fd9ef0720ea4e27fa1`.
- Image bootstrap/import: `sha256:fb6d44ebc58d76e6a7fd89bc354ccf2de1952186123cfef947b0f6417f14b481`.
- Build serial store/admin/migrate/bootstrap exit 0; tools preflight before-migrate `PREFLIGHT_OK`. Import CLI wrong-target guard menghasilkan exit nonzero dan `FULL_IMPORT_REFUSED` sebelum provider call, bukan code literal `PRODUCTION_TARGET_MISMATCH` pada stdout CLI ini.
- Negative context fixture dan image filename checks empat image tidak menemukan actual env/password/manifest di image. Candidate runtime Compose dan container env dibandingkan dengan sumber lokal dalam proses privat, hanya boolean/metadata aman yang dikeluarkan. Credential server lama tidak dipakai untuk request provider. `.env` dan legacy `.env.staging` diganti sandbox mode 600, manifest aktual 600, Owner secret pada direktori privat 700/file 600. Local Owner file di luar repo diberi ACL hanya user saat ini; kesalahan ACL file pada persiapan didiagnosis dan diperbaiki sebelum file dibaca/dikirim.
- Bentuk prefix key Midtrans tidak dipakai sebagai bukti credential valid; mode runtime dipin sandbox dan nilainya sesuai env lokal, tetapi transaksi/validitas key belum diuji.
- Khusus `CRON_SECRET`, encoding server dinormalisasi menjadi unquoted dengan karakter aman yang tervalidasi, tanpa mengganti nilainya. Ini diperlukan karena wrapper stock existing hanya menghapus double quote, bukan single quote. Tidak ada request job dengan secret nyata pada checkpoint ini.
- Satu cron staging lama dinonaktifkan dengan baris non-marketplace dipertahankan; wrapper lama ditunggu berhenti, writer store/admin dan mock dihentikan. Mock dihapus terarah tanpa volume. Container app lama kemudian diganti dengan **container baru belum dimulai**, untuk menghindari restart binary/credentials production lama secara tidak sengaja.
- Target aktual `qadfstore` / `qmarketplace`, bukan superuser, tidak memiliki CREATEDB; tidak ada public table owner asing atau inbound FK lintas schema pada preflight.
- Migration 16 → 59 exit 0; semua hash **dan timestamp** journal cocok dengan SQL release Linux. Sesudah reset, seluruh public base table kosong, fingerprint tabel/index dan seluruh journal identik; rerun migrator no-op.
- Reference seed `REFERENCE_SEED_APPLIED`, rerun `REFERENCE_SEED_ALREADY_APPLIED`; Owner CLI tepat satu Owner aktif dan `must_reset_password=true`, rerun `OWNER_EXISTS`. Sebelum import: nol client/order/product/promo/provider-operation demo. Data lama sudah dibuang tanpa backup sesuai izin; tidak ada restore atau fallback production.
- Volumes tetap `staging_uploads`, `staging_caddy_data`, `staging_caddy_config`; Caddy tidak direcreate. Public HTTPS store/admin saat maintenance: HTTP502, TLS verification 0.

### Final gate lokal dan batas browser

- Full unit awal gagal karena nama DB/fixture dan test isolation lama; focused failures kemudian menunjukkan konflik global `discounts.contractVersion` antar DB suites paralel. Focused empat suite secara serial: **81/81 pass**, tanpa perubahan business code.
- Serial run pertama memakai direct Node runner juga mengungkap npm runner environment hilang dan default Sales runtime dimatikan terlalu awal pada harness validasi. Penyebab diperiksa dari test/source: `npm_execpath` dan npm PATH diperlukan fixture dev runner; delivery-sweep fixture perlu konstruksi gateway, tetapi menolak payload sebelum request. Validasi akhir memakai npm script resmi, dummy credentials dan guard network eksternal supaya tidak ada provider call nyata dari unit suites.
- Satu assertion concurrent cancel-race sempat menerima `not_dispatchable` alih-alih `cancel_started`; source menjalankan dua operasi via `Promise.all`. Tidak mengubah runtime/test itu di scope deployment. Focused file lulus pada kondisi harness yang diperbaiki; catatan race tidak disembunyikan.
- Final `npm run verify:batch:unit` pada PostgreSQL disposable terisolasi: **208 files pass; 2.484 tests pass, 12 skipped; exit 0**. Full unit default yang gagal sebelumnya tetap dicatat; passing serial run adalah evidence final setelah diagnosis shared-DB parallelism/environment.
- Typechecks store/admin/DB exit 0; config/context fixture 2/2 pass; wrapper stock/email pass pada Linux, termasuk `real_flock=1`.
- `STAGING_SMOKE=true npx playwright test --config=playwright.staging.config.ts --list --reporter=line`: **3 tests / 2 files** ditemukan. Ini hanya discovery/parse, **bukan** hasil browser PASS. Browser execution dan rendered review belum dijalankan karena aplikasi belum dimulai.
- Container PostgreSQL disposable `marketplace-staging-phase2-tests` dan volume test milik sesi ini dihapus setelah validasi; container development `storefront-postgres` tetap berjalan. Tidak ada mutation pada database development pengguna.

### Blocker baru: respons stock sparse versus guard Cartesian

Full import durable dimulai sekitar 16:32 UTC menggunakan sandbox. Pada committed page pertama:

| Ukuran | Hasil aktual |
|---|---|
| Product groups | 200 |
| SKU unik | 1.183 |
| Pasangan stock provider yang teramati/ditulis | 4.080 |
| Branch provider | 25 |
| Ekspektasi guard Cartesian | 1.183 × 25 = 29.575 |
| Error/mismatch pada partial report | 0 / 0; belum merupakan rekonsiliasi final |

Diagnosis read-only tambahan dengan POST stock lookup yang sudah diizinkan:

- Batch 1, 10, dan 100 ID masing-masing mengembalikan 1, 10, 100 item; **semua item ID yang diminta ditemukan**. Response fields hanya `locations`/`data`, bukan pagination yang terpotong pada sample tersebut.
- Daftar locations memuat 25 cabang, tetapi `location_stocks` setiap item hanya memuat sebagian cabang. Pada batch 100, jumlah row per item berkisar 0–14; sample satu item memiliki 3/25 row. Ini observation, **bukan** bukti bahwa pasangan yang tidak dikirim bernilai nol.
- `packages/db/src/import-jubelio-service.ts:314` menetapkan `stockPairsRequested = sourceSkus.size * outletIds.length`; `packages/db/src/jubelio-import-report.ts:156–160` menolak covered < requested sebagai `MISSING_STOCK_OBSERVATIONS`.
- Verifier juga menghitung jumlah SKU × jumlah branch (`packages/db/src/production-bootstrap/production-bootstrap-repository.ts:445–453`) lalu menuntut equality pada `verify-production-service.ts:288–298`.
- OpenAPI lokal `docs/jubelio-api/dist.yaml:5124` dan schema `getInventoryResponse` mendeskripsikan array lokasi/stok, tetapi tidak menetapkan bahwa setiap pasangan pasti hadir atau bahwa omission boleh dianggap nol. Tidak ada normalisasi nol, pengurangan SKU/branch, atau pelonggaran verifier yang dilakukan.
- Kesimpulan kode: untuk response sparse seperti yang teramati, melanjutkan crawl saja tidak membuktikan kondisi dense yang diminta verifier. Belum ada final `FULL_IMPORT_INCOMPLETE` dari provider run; agent menghentikan job **sebelum akhir** agar tidak menghabiskan banyak jam pada kontrak coverage yang belum benar.

Pada **16:49:12 UTC**, `docker stop --time 30 staging-full-import-phase2` menghentikan job baca; exit marker **143**. `import.json.partial` dipertahankan, **tidak ada** `import.json` final/success. Tidak ada restart import, reset ulang, atau business write provider. Data partial baru dipertahankan untuk investigasi/idempotent rerun; tidak menyalin kembali data development atau tenant lama.

Snapshot DB read-only **16:56:43 UTC** mengonfirmasi kondisi setelah stop: journal 59, Owner 1, client/order 0, product 200, variant 1.183, branch_stock 4.080, negative holds 0, missing timestamp pada row yang benar-benar teramati 0, `checkout.paused=true`; tidak ada entri cron marketplace staging aktif. Container store/admin `created`, import container sudah tidak ada, Caddy tetap berjalan. Timestamp lengkap pada 4.080 row tidak berarti coverage 29.575 pasangan sudah terpenuhi.

Fakta yang belum diketahui: arti omission dan apakah ada source/mode resmi untuk memperoleh coverage lengkap. Perlu audit kontrak/provider dan addendum teknis importer/verifier/tests sebelum perubahan kode; jangan meminta pemilik menebak fakta tersebut. Keputusan pemilik yang diperlukan: apakah melanjutkan scope perbaikan ini, dan apakah app boleh dinyalakan sebagai preview katalog **parsial** dengan checkout tetap paused atau tetap maintenance. Tidak otomatis memperluas scope atau menandai full import complete.

### Keputusan sesudah blocker

Pemilik meminta penjelasan detail masalah import; **belum** menyetujui audit/addendum atau perubahan importer/verifier. Secara terpisah, pemilik memilih **Buka preview parsial**, mengizinkan start store/admin baru sebelum full import complete, dengan checkout tetap paused, cron tetap mati, health/browser hanya read-only/login Owner tanpa provider transaction. Ini pengecualian urutan §9 C → D yang eksplisit, bukan penerimaan full import atau coverage stock. Hasil start/smoke dicatat pada checkpoint berikutnya.

### Artefak server untuk melanjutkan

Direktori `/home/ops/log/marketplace-bootstrap/staging/` menyimpan `release/release-manifest.json`, `release/release.patch`, build/preflight/migration/reset aggregate/reference/Owner logs, `journal-before-reset.json`, `before-reset-counts.json`, `after-reset-counts.json`, `after-reference-counts.json`, `checkpoint-counts.json`, `import-run.log`, `import.json.partial`, `import.exit`, dan `import-stopped-reason.json`. Private Owner files berada di `.private/`; **jangan dicetak**.

Local safe runtime manifest: `C:/Users/USER/AppData/Local/Temp/marketplace-staging-release/runtime-safe.json` (snapshot sebelum job dihentikan; state import pada snapshot itu bukan status terkini). Final unit log: `C:/Users/USER/AppData/Local/Temp/staging-final-unit-serial.log`. Independent catalog projection dari GET sandbox ada di `release/catalog-evidence.json`; tidak membuktikan bahwa full katalog sudah diimpor.

### AC → evidence checkpoint 16:49 UTC

| ID | Evidence target/checkpoint | Status |
|---|---|---|
| AC01 | Pinned base+patch, 25 checksum, build empat image dan identitas container; tidak ada operasi target production | Verified |
| AC02 | Secure transfer allowlist, resolved/container boolean comparison terhadap lokal; import benar-benar login/master-read sandbox; image/context/permission checks | Verified |
| AC03 | 59/59 journal hash+timestamp, after-migrate preflight, rerun no-op | Verified |
| AC04 | Guarded truncate, public counts kosong, fingerprint struktur/index/journal tetap, volumes tetap; tanpa backup | Verified |
| AC05 | Reference-only seed/rerun, satu Owner aktif wajib reset, duplicate bootstrap OWNER_EXISTS, nol fixture demo sebelum import | Verified |
| AC06 | Baru 200 groups/1.183 SKU/4.080 observed stock pairs; import dihentikan, final report tidak ada; blocker sparse coverage | Pending |
| AC07 | Tax/account master cocok dan payment type punya evidence; diskon contract masih 0 dan readiness runtime aktif belum lengkap | Pending |
| AC08 | Parcel/packaging disetujui, tetapi origin/jam/konten/callback ditunda secara eksplisit; tidak memakai dummy | Pending |
| AC09 | Image tersedia dan container baru created, TLS valid tetapi HTTP502; smoke belum dieksekusi/rendered review belum ada | Pending |
| AC10 | Templates dan Linux wrapper test lulus; scheduler belum dipasang/dijalankan setelah import | Pending |
| AC11 | Full catalog belum tersedia untuk N aktual; belum ada full freshness/stock scheduler run | Pending |
| AC12 | Checkpoint ini hanya auth + master GET + stock read-only POST yang diizinkan; audit akhir seluruh tahap/jobs/browser belum ada | Pending |
| AC13 | `checkout.paused=true`, belum ada izin aktivasi; tetap tertutup sesuai keputusan pemilik | Pending |
| AC14 | Runbook/navigasi/register tersedia; walkthrough apps/jobs/browser dan penutupan deliverable masih tertahan | Pending |

## Histori checkpoint lanjutan 2026-11-15 — persiapan deployment tertutup

Belum ada perubahan yang terlihat pada staging; AC01–AC14 masih Pending pada checkpoint persiapan ini. Implementasi lokal tidak dihitung sebagai deployment.

### Keputusan pemilik setelah checkpoint awal

- Pemilik memberikan identitas/password awal Owner melalui chat, menggantikan pilihan file privat. Password tidak dicantumkan dalam artefak ini dan wajib diganti saat login pertama; tidak mengganti password pribadi otomatis demi tes.
- Packaging ditetapkan **15 gram** melalui `ask_user_question`, terpisah dari fallback parcel 250 gram/30×20×10 cm.
- Pemilik memilih **Deploy, checkout tetap dijeda**: mengizinkan origin/jam cabang, konten dan evidence callback dilengkapi setelah cutover. Ini deviasi urutan input §9 tahap A yang disetujui eksplisit; AC08 dan AC13 tetap Pending. Tidak mengurangi delivery menjadi pickup-only atau mengarang config.
- Discovery read-only lokal: 24 dari 25 cabang provider tidak memiliki origin lengkap; satu kandidat memiliki alamat hanya 4 karakter dan bukan evidence data operasional yang sah. Tidak menyalin data tersebut/fixture legal ke staging baru.

- Penemuan tambahan: `fetchStocks()` aktual mengirim **POST `/inventory/items/all-stocks/`**, bukan GET seperti asumsi spec. Sebelum ada request tersebut/reset, pemilik memilih **Izinkan stock lookup** untuk full import, verifikasi dan scheduler sandbox, payload batch `{ids}`. Izin ini tidak meliputi business write/quote/booking dan tidak pernah memakai credentials server lama.
- Master preflight: 39.045 product groups; full import minimal satu catalog GET dan satu SKU GET/group, sehingga pada budget 120 request/menit perkiraan bawah sekitar 11 jam, belum latency/retry/varian tambahan. Full import tetap tanpa cap; durasi bukan SLA.
- GET master pajak lanjutan membuktikan tepat satu tax ID -2, rate 11.00, `tax_out` string nonblank. Payment account 2 tersedia; payment type numerik 0 mengikuti evidence sandbox yang sama pada `docs/features/jubelio-sales-orders.md` dan riset tax-canary. Tidak ada canary baru.

### Context7 checkpoint

- `/docker/compose` — `config --format json`, environment hanya berasal dari wiring service, serta read-only bind dengan `create_host_path=false`.
- `/vitest-dev/vitest/v4.1.12` — async beforeAll/afterAll, timeout hook/test; terpasang 4.1.10, tidak ada API baru khusus patch version yang dipakai.
- `/drizzle-team/drizzle-orm-docs` — migrator `--config`, `out`, PostgreSQL `dbCredentials.url`. Baseline dipersiapkan dengan migrator resmi pada salinan migration test sementara; SQL generated repo tidak diedit.
- `/microsoft/playwright/v1.62.1` — context routing/abort dan `serviceWorkers=block`; smoke terpisah tanpa legacy auth/webServer, trace/video/screenshot otomatis dimatikan pada login privat.
- Visual redesign N/A: tidak mengubah UI, flow, token, atau business API. Rendered review deployment tetap diperlukan pada akhir.

### Deviasi file test yang diperlukan

Full suite mengungkap `scripts/jubelio-test-isolation.test.mts` masih mengunci konfigurasi production lama. Assertion diperbarui ke sandbox staging yang sudah disetujui; path test ini ditambahkan ke allowlist distribusi. Tidak menambah business behavior atau mengubah fixture/API. RED berasal dari full suite sebelum perubahan assertion.

### Evidence persiapan lokal

- Resolved Compose test RED pada `APP_ENV=production`, kemudian GREEN setelah wiring sandbox/release/bootstrap. Awalnya Docker CLI pada Windows tidak menemukan plugin karena allowlist environment case-sensitive; diagnosis menunjukkan key `PROGRAMFILES`, diperbaiki dengan filter case-insensitive. Failure tooling ini bukan RED perilaku.
- Fixture Docker context RED membuktikan `apps/store/.env.local` ikut context lama; GREEN setelah nested env/manifests/secrets dan workflow output dikecualikan. Hanya credential dummy dipakai pada fixture export; tidak membangun test image dengan secret nyata.
- `node --test deployment/staging/deployment-config.test.mjs`: **2/2 pass**, no skipped.
- Stock wrapper RED menolak `--runs 2`; GREEN pada default/two runs, bounds 1..12, fail-fast/partial, HTTPS dan schedule. Windows memakai fixture lock; Linux real-flock evidence masih diperlukan.
- SQL reset RED karena berkas belum ada; GREEN sesudah implementasi. Rehearsal disposable memakai baseline 16 migration, legacy branch/user, upgrade resmi ke 59, guarded reset, journal/objek tetap, migrator no-op, reference-only reseed staging.
- Focused `npm run verify:unit:slice -- packages/db/src/migrations/staging-data-reset.db.test.ts packages/db/src/production-bootstrap/production-bootstrap-cli.db.test.ts apps/store/src/lib/jubelio-sales-client.test.ts`: **3 files / 170 tests pass**, no skipped; PostgreSQL container disposable `marketplace-staging-phase2-tests` pada loopback 55442, bukan DB development atau staging.
- `npm run verify:types:store`, `npm run verify:types:admin`, `npx tsc --noEmit -p packages/db/tsconfig.json`: exit 0.
- Wrapper stock/email Git mode diubah menjadi `100755` melalui index metadata saja (blob HEAD tetap, perubahan content unstaged); tidak ada commit/Git push.
- Final full unit pertama memakai DB disposable bernama `staging_deployment_test`: 185 files/2.256 tests pass, 17 files gagal/4 test gagal, 6 files/48 test skipped. Penyebab terverifikasi: 15 suite mensyaratkan prefix `marketplace_discounts_test_`, tiga assertion seeded-RBAC memerlukan fixture demo yang belum disiapkan pada DB test, dan satu test tooling mengunci config staging-live lama. Tidak mengubah guard test atau memakai DB development; tindak lanjut menyiapkan DB disposable berprefix benar + fixture test dan menjalankan ulang focused failures, kemudian final gate.
- Authentication sandbox dari root `.env` lokal + GET taxes/accounts/locations berhasil, tanpa memakai env server. Configured payment account ID 2 ditemukan; 25 location IDs cocok kandidat lokal. Proyeksi awal pajak membaca field yang salah `output_account_id` sehingga boolean false tersebut **bukan** kesimpulan mapping hilang; field provider aktual `tax_out` harus diperiksa sebelum config final.

## Checkpoint awal 2026-11-15 — preflight, menunggu input privat

**Belum ada perubahan yang terlihat pada staging. AC01–AC14 Pending.** Server masih menjalankan release lama. Tidak ada implementasi konfigurasi, transfer secret/source, migration, reset, build, restart, pemasangan cron, commit, atau Git push pada checkpoint ini.

Referensi: [spec yang disetujui](../plan/deployment-staging-fase-2.md), khususnya §5, §9 tahap A, §11–§13.

## Izin dan keputusan sesi ini

- Pemilik meminta deployment ke staging berdasarkan spec: “oke tolong lakukan push ke staging berdasarkan spec berikut: deployment-staging-fase-2.md”. Permintaan dipahami sebagai eksekusi deployment staging, bukan commit/Git push otomatis. Distribusi default tetap base SHA + patch allowlist sesuai §4.4.
- Pemilik menegaskan credentials Jubelio server lama adalah **production**. Dilarang menggunakannya untuk request provider apa pun. Pengganti sandbox harus berasal dari `.env` serta app-local `.env.local` project, dengan DB/domain staging dipertahankan.
- Tidak ada request Jubelio, Shipment, Midtrans, SMTP, atau Google pada checkpoint ini; hanya SSH read-only dan SELECT read-only database lokal.
- Reset tanpa backup/downtime mengikuti scope spec, tetapi belum dimulai. Input fundamental harus tersedia sebelum destructive window.
- Melalui `ask_user_question`, pemilik memilih **File privat** untuk identitas/password Owner; path/file belum diberikan.
- Pemilik menetapkan fallback parcel **250 gram, 30×20×10 cm per unit**. Keputusan ini **tidak** mengonfirmasi berat packaging 999 gram. Berat packaging positif masih perlu input terpisah.
- Checkout tetap mengikuti gate handover terpisah; belum ada izin aktivasi checkout/provider canary. Tidak ada delegasi.

## Pemeriksaan aktual

| Pemeriksaan | Hasil | Batas evidence |
|---|---|---|
| `git status --short`, `git log -5 --oneline` lokal | HEAD `6c5733833af09635de4a4990e5b1ca4ca5a8f9b5`; dirty worktree awal hanya index serta dua dokumen spec/audit existing | Belum ada bundle/release final |
| SSH `remote-server`, `git rev-parse HEAD`, `git status --short` | `/home/ops/marketplace`, HEAD `93d12d89f5b0ab892db27c01def352bdba96af83`, worktree server bersih | Belum memeriksa ulang journal/privilege DB target |
| SSH `docker ps --format` | `staging-store-1` dan `staging-admin-1` healthy; Caddy dan mock lama masih berjalan; tidak ada project production terlihat pada daftar container aktif | Tidak melakukan health HTTP/browser; tidak menyimpulkan seluruh host bebas resource production |
| SSH `free -m`, `df -h` | RAM tersedia sekitar 6.9 GB, disk tersedia sekitar 91 GB | Bukan bukti peak build berhasil |
| Inventory filename/mode server staging | Tidak ada manifest bootstrap/Owner pada folder staging yang diperiksa; file env existing mode 664 | Tidak membaca/mencetak isi secret server |
| Parsing dotenv lokal dengan output hanya nama key/boolean | Root `.env`, `apps/store/.env.local`, `apps/admin/.env.local` tersedia; effective Better Auth secret sama; effective Omnichannel credentials store/admin sama; Midtrans tidak production; input Owner tidak ada | Tidak membandingkan dengan server atau menguji credential provider |
| Validasi tipe env lokal | `JUBELIO_PAYMENT_TYPE` bukan integer | Tidak disalin sebagai config final; perlu evidence kode provider sesuai spec |
| `BEGIN READ ONLY` pada DB localhost, SELECT allowlist system_config lalu `ROLLBACK` | Kandidat TTL 15 menit, PPN 11%, tax ID -2, fallback parcel 250 gram/30×20×10 cm; packaging 999 bertipe `json` | Kandidat, bukan config staging tervalidasi; tax/master perlu GET sandbox; packaging bukan nilai operasional yang disetujui |
| Lookup metadata branch awal | Pencarian `branches` tidak menghasilkan kolom; schema source menunjukkan tabel aktual `branch` | Belum melakukan audit origin/jam cabang lokal; jangan menyimpulkan data branch tidak tersedia |

Tidak menjalankan test, lint, typecheck, build, E2E, atau perubahan DB. Context7 checkpoint: N/A pada checkpoint ini — belum menulis kode atau menyentuh external API surface; hanya membaca konfigurasi/source dan melakukan pemeriksaan operasional read-only.

## Input berikutnya

1. Pemilik menyiapkan file JSON privat di luar repository, misalnya `C:/Users/USER/.pi/secrets/marketplace-staging-owner.json`, dengan properti `name`, `email`, `username`, `password`. Berikan path saja, bukan isi secret. Agent harus membaca file melalui proses yang hanya mengeluarkan status validasi, bukan tool `read` yang menampilkan password.
2. Tetapkan `packagingWeightGrams` sebagai integer positif dari ukuran operasional yang sah; tidak termasuk berat per unit 250 gram.
3. Setelah input tersedia, lanjutkan discovery config/origin/konten/callback, implementasi/tests, validasi release dan sandbox sebelum downtime. Jangan mengarang nilai operasional yang masih tidak diketahui.

## AC → evidence

| ID | Cakupan sesuai §11 spec | Evidence checkpoint ini | Status |
|---|---|---|---|
| AC01 | Release reproducible, paired images/tools, production tidak disentuh | Baseline SHA saja; belum bundle/build | Pending |
| AC02 | Sandbox aktif, env/DSN terisolasi, secret aman | Inventory/boolean lokal saja; belum transfer/compare/login/runtime | Pending |
| AC03 | Migration lengkap, journal valid, rerun no-op | Belum dijalankan | Pending |
| AC04 | Reset data guarded tanpa backup; struktur/journal/volumes utuh | Belum dijalankan | Pending |
| AC05 | Reference-only dan tepat satu Owner baru | File Owner belum tersedia | Pending |
| AC06 | Full import sandbox, integritas dan freshness | Belum ada request provider/import | Pending |
| AC07 | Tax/diskon/payment config valid | Kandidat lokal saja; payment type belum valid | Pending |
| AC08 | Origin/jam, parcel/packaging, konten/callback siap | Fallback parcel disetujui; packaging dan readiness lain belum lengkap | Pending |
| AC09 | Health/HTTPS/browser usable | Metadata container lama healthy; bukan evidence release target | Pending |
| AC10 | Sweep/email installed dan berjalan scheduler | Belum diubah/diverifikasi | Pending |
| AC11 | Daily stock capacity, scheduler/freshness | Belum diubah/diverifikasi | Pending |
| AC12 | Tidak ada business write provider terlarang sepanjang deployment | Tidak ada request provider checkpoint ini; audit end-to-end menunggu eksekusi | Pending |
| AC13 | Checkout aktif hanya setelah gate pemilik/config | Belum ada konfirmasi aktivasi | Pending |
| AC14 | Runbook/evidence final dan limitations | Register awal ini; runbook/walkthrough final belum ada | Pending |

## Limitations terkini — checklist penutupan spec yang belum terpenuhi

Butir berikut disalin verbatim dari §16 spec; belum ditandai selesai:

- [ ] Seluruh AC01–AC14 Verified dengan command/result target yang relevan; tidak ada PASS dari test yang skipped.
- [ ] Data aplikasi lama kosong, journal migration utuh, full import complete dan stock coverage fresh.
- [ ] Owner baru dapat login/reset password; tidak ada akun/order/promo/recovery fixture demo.
- [ ] Origin/jam branch, parcel, konten wajib dan callback configuration tervalidasi; tidak ada pengurangan scope delivery diam-diam.
- [ ] Ketiga scheduler staging benar-benar berjalan, log/permissions benar, dan stock daily coverage dibuktikan.
- [ ] Checkout dibuka hanya setelah konfirmasi operator; tanpa konfirmasi, AC13 tetap Pending dan dilaporkan.
- [ ] Bukti browser terarah dan rendered review tersedia tanpa mengirim provider write yang dilarang.
- [ ] Runbook enduring dan navigasi docs diperbarui; walkthrough actual tercatat.
- [ ] Plan tetap disimpan; index fitur diperbarui dengan tanggal/evidence hanya setelah semua AC Verified.

Quote/transaksi/callback provider nyata, actual SMTP delivery dan Google OAuth end-to-end belum diuji dan tidak akan otomatis ditambahkan sebagai tes deployment.
