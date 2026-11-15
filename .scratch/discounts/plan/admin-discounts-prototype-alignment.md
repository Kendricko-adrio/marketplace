# Plan: Pemulihan UX Diskon Admin sesuai Prototype

> Status keseluruhan plan hanya dicatat di [`../index.md`](../index.md). Dokumen ini mencatat status per fitur. Draft bukan izin implementasi.

## 1. Tujuan

Memulihkan struktur dan alur pengelolaan Diskon yang sudah direview pemilik pada prototype, menggunakan theme dan komponen admin existing. Fokus pada `/admin/discounts` dan `/admin/discounts/{id}`, bukan menyalin CSS atau seluruh sidebar sandbox prototype.

## 2. Approval dan hubungan dengan pekerjaan existing

- Kesepahaman scope dikonfirmasi pemilik melalui `ask_user_question`, pilihan **Daftar + detail (Recommended)**: tab daftar, informasi kapasitas, tab detail, dialog review, perbaikan label, API read-only pendukung, serta testing dan dokumentasi.
- **Complete plan dan acceptance/verification disetujui pemilik** melalui pesan **oke implementasikan** setelah draft lengkap ditampilkan. Pemilik mengizinkan implementasi langsung oleh main agent.
- Tidak ada izin subagent, publikasi implementation tickets, commit/push, provider writes, remote, deployment, atau aktivasi gate.
- Plan ini merupakan koreksi UX atas implementasi [spec diskon existing](discounts-spec.md), bukan pengganti aturan pricing, lifecycle, authorization, atau release gates di spec tersebut.
- Status plan diskon existing tetap In Progress. Penyelesaian plan UX ini tidak menyelesaikan UAT staging, ticket integrasi, atau izin rilis fitur diskon.

## 3. Bukti dan sumber acuan

| Sumber | Fakta yang menjadi acuan |
|---|---|
| [Feedback pemilik prototype](../prototype/README.md#feedback-pemilik--arah-fungsi-sesuai-style-belum-final) | Pertahankan arah functionality/alur; visual mengikuti admin existing, bukan CSS prototype sebagai final. |
| [Prototype executable](../prototype/app.ts) — `renderDiskon`, `renderPromoTabs`, dialog `promo-review` | Tab jalur promo; revision, kuota/budget tersedia dan kode; empat tab detail; review melalui dialog. |
| [Wireframe approved](../wayfinder/wireframe-06-admin-discounts-and-authorization.md) §5–7 | Draft/live terpisah, stale ditolak, hold/consumed, privacy kode dan scope order. |
| [Daftar existing](../../../apps/admin/src/app/admin/discounts/discounts-list-client.tsx) | Tidak ada tab jalur; kapasitas memilih kuota ATAU budget; formatter benefit belum membedakan shipping. |
| [Editor existing](../../../apps/admin/src/app/admin/discounts/[id]/discount-editor-client.tsx) | Terms, kapasitas/usage, simulasi, review, kode dan audit berada pada satu halaman tanpa tab. |
| [Domain admin](../../../apps/admin/src/lib/discounts-administration.ts) — `DiscountOfferSummaryDto`, `listDiscountOffers` | List sudah membawa activation kind dan masked codes, tetapi belum filter jenis, revision number, benefit kind, atau availability. List bukan channel literal kode, termasuk bagi editor. |
| [Ops read](../../../apps/admin/src/lib/discount-operations-read.ts) | Availability bersifat global; entries mengikuti Orders:view/cabang; list/usage/history selalu masked. |
| [Schema existing](../../../packages/db/src/schema/discounts.ts) | `revisionNo` sudah tersedia. Tidak perlu schema/migration untuk menampilkan revision. |
| [Komponen UI shared](../../../packages/ui/src/components/ui) | Tabs, dialog, card, table, button, dan form existing menjadi acuan implementasi. |

Bukti browser pada investigasi sebelumnya: halaman daftar dan detail lokal memiliki 0 tab; prototype memiliki 2 tab daftar dan 4 tab detail. Data lokal saat diperiksa hanya satu draft belum lengkap, sehingga data/angka fixture prototype bukan target untuk disalin ke database aplikasi. Review/publish dibandingkan dari source, tidak dieksekusi pada database operasional.

## 4. Scope dan non-scope

### Termasuk

1. Daftar dengan tab **Kupon publik / Kode promo**, status filter, pagination, ringkasan benefit/revision/kode dan kuota/budget tersedia.
2. Detail dengan tab **Aturan / Kode / Pemakaian & budget / Riwayat**, identitas/live revision yang jelas, serta simulasi di dalam Aturan.
3. Dialog review perubahan sebelum publish, termasuk loading, validation, conflict, dan failure states.
4. Perbaikan copy, format Rupiah/persentase, serta label benefit shipping.
5. Penambahan kontrak read-only list yang diperlukan, tests pada public seams, dan dokumentasi.

### Tidak termasuk

- Redesign shell, sidebar global, font/theme baru, atau dependency UI baru.
- Halaman Simulasi biaya atau Riwayat & audit global baru; keduanya tetap dalam konteks detail promo.
- Pekerjaan Produk/Harga, import/export, atau perubahan storefront/checkout.
- Perubahan formula diskon/pajak, reservation, capacity authority, permission/default role, canonical code, atau lifecycle order.
- Perubahan schema, migration, seed operasional, atau fixtures demo aplikasi agar menyerupai prototype.
- Workflow baru berupa batalkan draft, force-overwrite, restore arsip, reset usage, release hold, atau refund. Tombol simulasi admin lain/persona/reset demo dari sandbox tidak dibawa ke aplikasi.
- Provider live, aktivasi `discounts.contractVersion`, perubahan env/ports/deployment, dan klaim launch-ready.

## 5. Kontrak perilaku target

### 5.1 Daftar promo

- Tab awal **Kupon publik**; tab **Kode promo** hanya berisi Offer `manual_only`.
- Tab memiliki jumlah hasil sesuai filter status saat ini, dihitung server sebelum pagination. Pergantian tab/status kembali ke halaman 1; tidak memfilter hanya data pada halaman aktif.
- Tombol **Buat draft** membuat jenis sesuai tab aktif, melalui writer existing; dropdown jenis terpisah tidak lagi diperlukan. Jalur tetap immutable setelah create.
- Kolom: **Nama promo / identitas**, **Jalur**, **Benefit**, **Status**, **Revision live**, **Kuota tersedia**, **Budget tersedia**, **Kode**, **Aksi**. Status adanya draft tetap terlihat tanpa menyamarkannya sebagai revision live.
- Nama/benefit/revision live tidak diganti oleh terms draft. Promo tanpa revision terbit jelas berstatus belum publish; jangan mengarang nomor revision dari `version`, `draftVersion`, atau `policyVersion`.
- Label benefit: `Nominal barang Rp 25.000`, `10% barang, maks Rp 20.000`, `10% barang` tanpa cap, atau `Subsidi ongkir, maks Rp 20.000`. Hindari nominal shipping kosong dan prefix `Rp` ganda.
- List menampilkan masked codes beserta status dan jumlah kode dari response existing. Literal tidak ditambahkan ke list, DOM tersembunyi, tooltip, log, atau atribut; literal tetap hanya pada detail editor berwenang.
- Empty/loading/error states spesifik tab. Error fetch bukan dianggap daftar kosong/sukses. Respons request lama tidak boleh mengganti tab/status terbaru saat pengguna berpindah cepat.
- Tidak menambahkan search, bulk action, export, atau auto-refresh realtime sebagai scope baru.

### 5.2 Kapasitas

- Tampilkan kuota dan budget bersamaan, bukan salah satu. Bedakan **batas**, **consumed**, **hold**, dan **tersedia**.
- Angka bersumber dari projection global existing, bukan jumlah entries yang dibatasi cabang atau halaman. Perhitungan uang tetap whole Rupiah exact, bukan floating-point.
- Contoh acceptance literal: kuota 100, consumed 90, hold 10 → **tersedia 0**; budget Rp 2.000.000, consumed Rp 1.800.000, hold Rp 200.000 → **tersedia Rp 0**.
- `null` berarti tidak dibatasi pada dimensi tersebut, bukan nol. Draft yang kedua batasnya kosong diberi konteks kapasitas belum disetel/belum dapat publish, bukan promo siap digunakan tanpa batas.
- Kegagalan membaca projection atau data tidak konsisten tidak diubah menjadi angka 0 yang tampak valid. Tampilkan unavailable/perlu review; jangan memperbaiki atau mereset counter dari read path.
- Ringkasan list adalah observasi kapasitas, bukan jaminan eligibility atau booking kuota. Writer dan reservation existing tetap authority final.
- Deteksi drift lengkap serta guard writer existing tetap dipertahankan; list tidak menjalankan rekonsiliasi seluruh histori untuk setiap baris.

### 5.3 Detail bertab

Header tetap menampilkan nama, jalur immutable, status, **Live: Revision N** atau **Belum dipublish**, indikator draft, serta aksi Jeda/Aktifkan/Arsip sesuai state dan permission existing.

| Tab | Isi |
|---|---|
| **Aturan** | Nama, benefit tunggal, minimum barang setelah Markdown, tanggal WIB, syarat akun store verified, Simpan draft, Review perubahan. Simulasi existing berada pada bagian tersendiri yang dapat dibuka/tutup di tab ini; tetap berlabel tidak menahan stok/kuota dan bukan quote. |
| **Kode** | Pengelolaan kode manual existing. Untuk kupon publik, tampilkan penjelasan tidak memiliki kode tanpa form tambah kode. Editor menerima literal hanya jika response server mengizinkan; viewer tetap masked. |
| **Pemakaian & budget** | Ringkasan global, editor kapasitas dan jatah per akun, warning drift, filter/pagination entries, serta pembatasan Orders:view/cabang existing. |
| **Riwayat** | Audit existing: actor aman, waktu, tindakan, before/after dan referensi revision. Tidak memindahkan literal kode ke riwayat. |

- State form tetap bertahan saat berpindah tab; tidak auto-save dan tidak reset input hanya karena tab panel di-unmount.
- Akses tab tidak memberikan permission tambahan. Viewer tidak memperoleh mutasi; editor tanpa capacity grant tetap mengikuti aturan increase/reduction existing, bukan semua field kapasitas dibuat writable tanpa guard.
- **Simpan kapasitas tetap mutasi live langsung** melalui endpoint policy existing, terpisah dari Simpan draft dan Publish. UI harus menjelaskan hal ini; plan tidak mengubah kapasitas menjadi draft-only.
- Pembaruan usage/filter tidak boleh menghapus terms yang belum disimpan. Setelah mutasi yang mengubah versi, refresh/invalidation terarah memastikan review lama tidak bisa digunakan kembali.
- Tidak menambahkan sistem autosave, leave-page guard, atau URL routing per tab pada scope ini.

### 5.4 Dialog review dan publish

- Tombol **Review perubahan** di Aturan membuka Dialog existing/shared, lalu memanggil endpoint review existing untuk draft yang telah tersimpan. Terms lokal yang berbeda dari draft tersimpan harus disimpan dahulu; jangan menampilkan diff seolah perubahan lokal sudah masuk review server.
- Dialog menampilkan loading/error, diff live → draft, benefit/syarat/waktu WIB, revision, konteks kapasitas/hold, validasi server, dan penjelasan berlaku untuk pemakaian baru tanpa mengubah snapshot/hold lama.
- **Publish** tersedia hanya jika server mengizinkan review dan fingerprint/expected versions masih valid; tidak cukup berdasarkan validasi browser.
- Dialog ditutup/batal → tidak publish, tidak membuang draft tersimpan, dan fokus kembali ke pemicu. Selama publish berjalan, cegah double submit serta penutupan yang menyesatkan seolah mutasi dibatalkan.
- Terms/capacity/code/state yang berubah setelah review menginvalidasi hasil review. Conflict `409` membatalkan kesiapan publish dan meminta muat versi terbaru/review ulang, tanpa force-overwrite atau retry otomatis dengan versi baru.
- Jika gagal, tampilkan failure aktual; jangan menaikkan revision atau menampilkan toast sukses. Pada sukses, refresh header/draft/usage/history sesuai data server.
- Idempotency/request receipt, endpoint writer, policy recheck, audit, serta publish atomik existing tidak didesain ulang.

### 5.5 Visual dan aksesibilitas

- Pakai theme/token, typography, spacing, border, button, table dan feedback admin existing; tidak menyalin `styles.css` prototype.
- Bahasa operasional: promo, kupon publik, kode promo, aturan, pemakaian, budget, live/draft. Identifier teknis tidak diubah pada API/database; concurrency versions tetap dapat dipakai internal tanpa mendominasi header.
- Pada 1440×1000 dan 390×844, header/tombol tetap dapat digunakan; overflow tabel/tab hanya di kontainer terkait, bukan membuat seluruh dokumen melebar. Dialog dapat di-scroll dan aksi tetap dapat dijangkau.
- Tab punya label/selected state dan keyboard navigation; dialog punya accessible title, focus trap/restore dan Escape sesuai busy state. Status/error tidak mengandalkan warna saja.

## 6. Desain teknis yang diusulkan

### Read-only list, additive dan backward-compatible

Perluas `GET /api/admin/discounts` dan `listDiscountOffers`:

- Filter opsional `activationKind=public|manual_only`; tanpa filter mempertahankan hasil gabungan legacy. Nilai filter baru yang invalid ditolak `400`, bukan diam-diam diarahkan ke satu jenis.
- `page`, `limit`, `state`, envelope `data` + `pagination`, `discounts:view`, dan no-store existing tetap berlaku.
- Tambahkan `countsByActivationKind` yang mengikuti filter status, tetapi tidak dibatasi tab atau pagination.
- Tambahkan `liveRevision.revisionNo`, discriminator benefit `kind`/`scope`, dan ringkasan availability global per Offer. Pertahankan field response existing agar consumer lama tidak patah.
- Gunakan pembacaan projection yang dibatasi ID pada halaman; hindari satu HTTP request usage/detail per baris dan hindari full-history scan. Helper arithmetic boleh digunakan bersama setelah memeriksa dependency cycle antara module admin dan ops-read.
- Tidak menambahkan literal code atau identitas customer/order ke list. Missing projection ditandai jelas, bukan dinormalisasi menjadi nol tanpa bukti.
- Log success/error melalui structured logger admin; context filter/page/count aman, tanpa kode literal atau token.

### Struktur UI

- Pisahkan tab/panel/dialog dari editor besar hanya sejauh mempermudah ownership state dan tests; tidak membuat generic framework promo baru.
- Controller state berada cukup tinggi agar perpindahan tab tidak menghapus form; publish memakai kontrak review existing, bukan kalkulasi diff sendiri sebagai authority.
- API writer dan schema tidak perlu diubah untuk pemindahan panel/dialog. Bila implementasi menemukan kebutuhan mengubah perilaku bisnis atau permission, hentikan bagian terkait dan minta keputusan baru.

### Area perubahan

- `apps/admin/src/app/admin/discounts/page.tsx`, `discounts-list-client.tsx`, serta editor/panel/dialog di subtree `[id]/`.
- `apps/admin/src/app/api/admin/discounts/route.ts` dan `apps/admin/src/lib/discounts-administration.ts`; ops-read/helper hanya bila diperlukan reuse proyeksi exact.
- Tests admin existing dan satu spec UI baru `e2e/admin/discounts-prototype-mock.spec.ts`.
- `playwright.mock.config.ts`: daftar spec baru harus ditambahkan pada **kedua** `testMatch` existing.
- `docs/features/discount-administration.md`, `docs/api-reference.md`, `docs/testing/README.md`.

## 7. Fitur dan urutan vertical slice

| # | Fitur | Status | verify: | Dependensi |
|---|---|---|---|---|
| 1 | Daftar promo bertab dengan projection kapasitas, revision/kode dan benefit lengkap | In Progress | Public domain/HTTP: filter+count+pagination+privacy+availability; browser: berpindah tab/status, kedua kapasitas tampil, label shipping benar dan create sesuai jalur | Tidak ada |
| 2 | Detail empat tab, ringkasan live/draft, simulasi dan state/permission yang terjaga | In Progress | Browser: tab keyboard/mouse, input bertahan lintas tab, public/manual, viewer/editor, aggregate-only/own-branch, penggunaan writer existing | Fitur 1 |
| 3 | Dialog review/publish, conflict/failure handling, responsive dan regresi akhir | In Progress | Browser: unsaved → simpan → review dialog → publish, batal, validasi gagal, stale, busy/double-click; desktop/mobile; unit dan mock regression gates | Fitur 2 |

Setiap fitur dikerjakan test-first dalam siklus kecil: satu failing test pada seam → perubahan minimum → green → review. Bukan menulis seluruh tests terlebih dahulu lalu seluruh implementasi. Ini urutan kerja di dalam plan, **bukan** publikasi implementation tickets baru.

## 8. Acceptance dan verification

### Public seams yang diajukan untuk approval bersama plan

1. **Domain/service publik + PostgreSQL disposable:** `listDiscountOffers`, read usage dan writer existing. Assertions melalui DTO/result publik; SQL fixture hanya untuk setup/cleanup kasus deterministik, bukan menggantikan assertion perilaku melalui inspeksi internal.
2. **HTTP aplikasi:** query list/filter yang valid/invalid, response compatibility, viewer/editor privacy, dan error/status kontrak existing.
3. **Browser Playwright:** user-visible tabs, rows, fields, dialogs, outcomes dan keyboard/mobile; jangan menguji nama state/private helper atau struktur komponen internal.

### Matrix minimum

| ID | Acceptance yang harus terbukti |
|---|---|
| UX01 | Tab publik tidak memuat manual dan sebaliknya; jumlah/count/pagination benar ketika ada lebih dari satu halaman dan filter status berubah. |
| UX02 | Semua benefit ditampilkan benar; revision live berasal dari `revisionNo`; draft belum publish tidak dipresentasikan sebagai live. |
| UX03 | Kuota100/consumed90/hold10 → tersedia0 dan budget2000000/1800000/200000 → Rp0; kedua dimensi terlihat bersamaan; unbounded/missing tidak berubah menjadi nol palsu. |
| UX04 | List/usage/history payload dan DOM tidak membawa literal kode, termasuk untuk editor. Literal detail tetap sesuai `codeLiteralVisible`; viewer/direct API tidak memperoleh mutasi atau akses lintas cabang. |
| UX05 | Create dari tab memilih jalur yang benar. Error/loading/empty berbeda dan respons filter lama tidak mengganti hasil tab terbaru. |
| UX06 | Empat tab detail bekerja; input belum disimpan bertahan lintas tab; simulasi memberi breakdown existing dan label no-hold/no-quote. |
| UX07 | Kapasitas tersimpan melalui policy existing dengan konteks live yang jelas; increase/reduction/current grants dan guard consumed+hold tidak berubah. |
| UX08 | Review menampilkan draft tersimpan/diff server; publish hanya melalui fingerprint/version sah. Cancel tidak melakukan publish; unsaved terms tidak tertukar dengan reviewed terms. |
| UX09 | Stale save/review/publish atau perubahan policy/code setelah review tidak dapat memakai hasil review lama; reload/review ulang, tanpa force-overwrite. Invalid review/failure tidak menampilkan sukses atau revision fiktif. |
| UX10 | Publish sukses memperbarui revision/live/draft/history; pause/archive tidak mengubah hold/usage/snapshot. Existing percentage/manual/shipping flows tetap green setelah locator/tab disesuaikan. |
| UX11 | Desktop1440/mobile390: tidak ada overflow dokumen, aksi dapat dijangkau, tab keyboard dan fokus dialog benar, busy state mencegah double submit. |

Gunakan fixture bernama dan angka literal independen dari wireframe/spec, bukan expected value yang dihitung ulang oleh helper produksi. Kasus shipping harus mempunyai live revision sungguhan di DB disposable; tidak cukup mengandalkan data dev lokal.

### Verification ladder saat implementasi

- **L0 setiap slice:** `npm run verify:types:admin`.
- **L1 setiap slice:** `npm run verify:unit:slice -- <explicit paths>`; pilih file yang benar-benar berubah dari kandidat `apps/admin/src/lib/discounts-administration.test.ts`, `discounts-administration.db.test.ts`, `discount-operations-read.test.ts`, `discount-operations-read.db.test.ts` dan test helper publik baru bila ada. Daftar path tidak boleh dibiarkan implisit saat eksekusi.
- DB tests memakai database disposable `marketplace_discounts_test_*`, bukan DB dev/operasional. Provider/email terkunci pada mock loopback seperti konfigurasi mock existing.
- **L2 batch:** `npm run verify:batch:unit`, kemudian `npm run verify:batch:e2e -- e2e/admin/discounts-prototype-mock.spec.ts e2e/admin/discounts-admin-mock.spec.ts e2e/admin/discounts-usage-mock.spec.ts`. Sertakan consumer store bila implementation diff ternyata menyentuh shared contract; jangan mengasumsikan scope store berubah.
- Lint terarah pada file yang berubah, `git diff --check`, review diff standards + acceptance, dan compare browser desktop/mobile terhadap prototype. Baca Markdown/error context jika Playwright gagal; jangan membuka screenshot failure.
- **L3 sebelum commit/PR/integrasi:** full unit dan suite E2E sesuai AGENTS.md. `npm run test:e2e` standard/live-provider tetap memerlukan izin terpisah. Bila belum diizinkan, catat gate outstanding dan jangan menyatakan seluruh acceptance/final integration selesai.
- Catat command, fixture/DB, hasil pass/fail/skip dan batasnya. Output besar ke log di luar repo. Suite yang sudah lulus pada diff yang sama tidak diulang tanpa alasan; hasil historis bukan bukti untuk perubahan baru.

## 9. Checkpoint library, dokumentasi dan deployment

- **Context7 checkpoint tahap planning:** tidak diperlukan untuk perubahan dokumen ini; tidak ada implementasi API library/framework dan tidak ada library lookup yang diklaim sudah dijalankan.
- Sebelum implementation slice pertama, resolve/query versi terpasang untuk API yang dipakai: Next.js/React, Radix Tabs/Dialog melalui shared UI, Drizzle untuk filter/count/projection, serta Playwright/Vitest untuk testing. Catat canonical library ID, versi dan signature/options yang dikonfirmasi pada catatan slice.
- Jika Context7 gagal, gunakan installed types/source atau official docs dan catat fallback secara eksplisit. Jangan menulis API dari ingatan. Ikuti juga panduan Next.js bundled yang disyaratkan `apps/admin/AGENTS.md`.
- Update docs fitur untuk tab, dialog, live capacity dan batas masked list; API reference untuk query/response additive; testing docs untuk spec/fixture/gates.
- Tidak ada perubahan env/domain/port/build/cron/volume/healthcheck, sehingga tidak direncanakan perubahan deployment. Bila kebutuhan itu muncul, hentikan scope terkait untuk review baru.

## 10. Risiko dan pengamanan integrasi

- Worktree sudah dirty dari pekerjaan Harga Produk dan stok storefront; sebagian docs/index/mock config juga sedang berubah. Gunakan edit additive yang sempit, pertahankan perubahan pemilik, dan jangan reset/format ulang/menggabungkan pekerjaan tak terkait.
- Existing E2E memakai semua field pada satu halaman; sesuaikan navigasi tab sebelum locator, bukan menghapus coverage untuk membuat suite green.
- Perpindahan panel berisiko me-reset form atau menyisakan stale review. State ownership, request race, dan invalidation diuji melalui browser.
- Availability list tidak boleh menjadi N+1 usage HTTP calls atau full reconciliation scan. Query bounded dan authority global harus tetap jelas.
- Perbedaan aman dari sandbox dipertahankan: masked list untuk semua persona, writer permissions server-side, tanpa demo controls, dan capacity tetap mutasi live.

## 11. Pertanyaan terbuka dan gate berikutnya

- Complete plan sudah disetujui dan implementasi diminta pemilik. Keputusan baru di luar scope tetap harus dikonfirmasi, bukan diputuskan agent.
- Standard/live-provider E2E tetap belum diizinkan; gate L3 terkait dicatat terpisah.

## Catatan eksekusi

- Context7: `/drizzle-team/drizzle-orm-docs` — parameterized `and`/`eq`, grouped count cast integer dan bounded ID projection; `/radix-ui/website` — controlled Tabs dan Dialog; `/microsoft/playwright` — BrowserContext request dan role-based locator/assertions. Versi lokal: Next.js16.3.1, React19.2.3, Drizzle0.45.2, Radix Tabs1.1.13/Dialog1.1.15, Playwright1.62.1, Vitest4.1.10.
- Next.js GET route juga diverifikasi melalui bundled docs `node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md`. API shared UI dan React/Vitest reuse diverifikasi terhadap installed types/source dan pola test existing; detail dicatat saat slice.
- Tidak mengubah `.env` atau menggunakan DB dev untuk test mutasi. Validation menggunakan DB disposable khusus UX `marketplace_discounts_test_admin_ux`, dibuat dan diseed dari schema existing. Tidak ada migration/schema/deployment change.
- Implementasi ketiga fitur sudah tersedia; status tetap In Progress karena standard/live-provider L3 belum diizinkan. Tidak menghapus plan atau menutup plan diskon existing hanya berdasarkan mock green.

### Evidence implementasi dan review

| Gate | Command / evidence | Hasil |
|---|---|---|
| TDD list | `verify:unit:slice -- apps/admin/src/lib/discounts-administration.db.test.ts -t "list memfilter"` sebelum implementasi | RED: field count belum tersedia; setelah perubahan **19 DB tests PASS** pada file tersebut |
| TDD tab/dialog/audit | Spec baru ditulis per slice; Markdown failure dibaca, bukan screenshot failure | RED tab0, tombol review belum tersedia, audit detail belum tersedia → GREEN setelah masing-masing perubahan |
| L0 | `npm run verify:types:admin` | PASS; satu percobaan bersamaan dengan Next dev sempat membaca generated validator saat sedang ditulis. File diperiksa, recheck serial PASS tanpa edit generated source |
| L1 | `verify:unit:slice -- apps/admin/src/lib/discounts-administration.test.ts apps/admin/src/lib/discount-operations-read.test.ts` | **32 PASS** |
| L2 full unit | `npm run verify:batch:unit`, DB disposable eksplisit | **148 files PASS; 1706 tests PASS / 12 existing skips**, `/tmp/discounts-ux-batch-unit.log` |
| L2 mock regresi | `verify:batch:e2e -- ...discounts-prototype... ...discounts-admin... ...discounts-usage... --grep-invert "daftar memisahkan\|detail empat\|dialog review menjaga"` | **8 PASS**, 2 locator/fixture-assumption failures; 3 serial downstream belum berjalan pada percobaan ini. Bukti: `/tmp/discounts-ux-regression.log` |
| Recheck ops | Hanya 4 kasus usage yang gagal/belum berjalan | **4 PASS**, `/tmp/discounts-ux-regression-recheck.log`; locator masked label disesuaikan ke cell usage, bukan panel kode yang kini terpisah |
| Recheck race | Hanya kasus filter/status/error/request-race | **1 PASS**, `/tmp/discounts-ux-race-recheck.log`; alert di-scope ke main (bukan route announcer), fixture Draft dipakai agar tidak mengasumsikan seed manual aktif kosong |
| Final UI terdampak | `verify:batch:e2e -- e2e/admin/discounts-prototype-mock.spec.ts e2e/admin/discounts-admin-mock.spec.ts --grep "HQ completes\|HQ menyimpan\|review invalid\|create dari\|dialog review menjaga\|detail empat\|daftar memisahkan"` | **8 PASS**, `/tmp/discounts-ux-ui-final.log`; termasuk copy Nama promo/nominal barang, audit before/after, input+usage filter, unbounded/draft, dan double-click publish |
| Lint/review | Scoped ESLint, `git diff --check`, review source terhadap acceptance dan privacy | Final typecheck PASS (`/tmp/discounts-ux-types-final.log`), scoped ESLint 0 errors/warnings (`/tmp/discounts-ux-lint-final.log`); diff check PASS |
| Browser manual | Chromium lokal; route live3001 read-only setelah login, viewport1440×1000 dan390×844 | 2 tab list, 4 tab detail, tidak ada overflow dokumen. Screenshot smoke di temp, bukan attachment test failure. Tidak menulis promo/kapasitas di DB operasional |
| L3/UAT | Standard `npm run test:e2e`, provider live, staging sign-off | **Belum dijalankan/diizinkan**, bukan PASS |

Total coverage mock relevan: **16 kasus unik memiliki evidence PASS** (6 prototype + 6 admin + 4 usage), digabung dari run awal dan focused recheck; tidak diklaim sebagai satu command final 16/16. Suite yang sudah pass tidak diulang tanpa perubahan relevan. Unit batch terakhir mendahului tambahan audit presentation/copy UI; perubahan UI sesudahnya diverifikasi melalui Playwright dan final typecheck/lint, tanpa perubahan backend logic.

Review main agent: API additive dan no-store/logging dipertahankan; filter/count sebelum pagination; projection bounded tanpa N+1 HTTP; list masked untuk editor/viewer; authority writer/stale/fingerprint tetap server; pause/hold/Orders scope dan schema tidak berubah. Shared Tabs/Dialog memakai controlled value/open, dan handler close/escape dicegah saat publish. API React refs/effects serta Dialog dismissal diverifikasi pada installed `.d.ts` selain checkpoint Context7 di atas.

## 12. Retirement checklist

- [ ] Seluruh fitur dan acceptance memiliki evidence verification yang relevan; gate yang belum diizinkan/terblokir dicatat, bukan dinyatakan pass.
- [x] Docs fitur, API, dan testing telah diperbarui dalam bahasa Indonesia.
- [x] Perubahan di luar scope tidak tertimpa/terikut.
- [ ] Hasil review pemilik dan batas UAT/rilis dicatat; status plan diskon existing tidak ditutup otomatis.
- [ ] Setelah semua syarat Done terpenuhi, simpan file plan ini, distil enduring content ke docs, dan perbarui baris Done beserta tanggal dan ringkasan evidence di `.scratch/discounts/index.md`.
