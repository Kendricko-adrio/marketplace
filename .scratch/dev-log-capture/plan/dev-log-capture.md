# Plan: Capture log development ke `logs/`

## Tujuan / Motivasi

Saat ini seluruh log runtime hanya menuju **stdout**. Bukti terverifikasi:

- `packages/logging/src/logger.ts` — `options.destination ?? process.stdout`
  adalah satu-satunya sink; tidak ada opsi file maupun env untuk file.
- `package.json` root — `dev:all`/`dev:store`/`dev:admin` hanya menjalankan
  `concurrently` tanpa redirection.
- `.gitignore` — belum ada entri `logs/`.

Akibatnya, setelah terminal ditutup atau scrollback habis, jejak request
(`requestId`), error service, dan pesan `next dev` (compile error/HMR) hilang.
Dokumentasi kontrak logging: [`docs/features/logging.md`](../../../docs/features/logging.md).

Plan ini menambah **capture dev-only**: output proses `dev:all`/`dev:store`/
`dev:admin` disalin ke `logs/<app>.log` lewat `tee`, sehingga terminal tetap
menampilkan apa yang sekarang, dan `logs/` di-ignore git.

## Scope

Perubahan pada script dev + `.gitignore` + satu guard test + dokumentasi.
Tidak menyentuh kode aplikasi maupun `packages/logging`.

Acceptance criteria (dapat diamati):

1. `npm run dev:all` dari root repo membuat `logs/jubelio-mock.log`,
   `logs/store.log`, `logs/admin.log`; output yang sama tetap tampil di terminal
   dengan prefiks nama proses.
2. File **ditimpa** setiap run (bukan append), dan baris pertama file berasal dari
   run terbaru.
3. `npm run dev:store` menulis `logs/jubelio-mock.log` + `logs/store.log`;
   `npm run dev:admin` menulis `logs/admin.log`. `npm run dev` (alias
   `dev:store`) ikut menghasilkan file yang sama.
4. Isi file tidak memuat banner npm (`> dev:store:app`, `> next dev`) dan tidak
   memuat prefiks `concurrently`, sehingga baris JSON `@marketplace/logging`
   dapat di-`grep`/`jq` apa adanya.
5. Kegagalan proses anak tetap terpropagasi: bila salah satu proses exit
   non-zero, `concurrently` melaporkan exit code non-zero dan `npm run dev:all`
   keluar non-zero (tidak ditelan `tee`).
6. `logs/` tidak pernah muncul di `git status` (di-ignore).
7. `npm run verify:unit:slice -- scripts/dev-log-capture.test.mts` lulus dan
   menjaga butir 1–6 secara statis (lihat Rancangan teknis).
8. File log **tidak memuat ANSI escape code** (bisa dibaca sebagai teks biasa di
   editor), sementara aliran terminal tetap berwarna.

## Approval

- Kesepahaman bersama dikonfirmasi user: empat keputusan scope sudah diambil
  user (tee di npm script · nama file tetap + ditimpa per run · terminal tetap
  menampilkan log · cakupan `dev:all` + `dev:store` + `dev:admin`).
- Complete scope dan acceptance/verify criteria disetujui user: **2026-10-25**
  ("oke jalankan plan tersebut"). Approval mencakup dua keputusan yang
disebut di Open questions: `bash -o pipefail` dan pemulihan
  `scripts/vitest.config.mts`.

Approval plan tidak menyetujui subagent, commit, remote access, atau deployment.

## Non-scope

- **File sink di `@marketplace/logging`** (mis. `LOG_FILE_DIR`/`pino.destination`):
  ditolak untuk plan ini karena hanya mencakup JSON first-party dan menyentuh
  jalur log produksi. Bisa jadi plan follow-up bila ingin JSON murni per app.
- Log rotation, retensi, kompresi, atau file bertimestamp per run.
- `pino-pretty` / pretty-printing JSON di terminal.
- Perubahan tujuan log produksi: container tetap stdout → journald
  (`deployment/production/docker-compose.yml:44-49`), karena itu kontrak
  deployment yang sudah ada.
- Menambah `LOG_LEVEL` ke `.env.example` (isu terpisah, tidak dibutuhkan capture).
- Dukungan `cmd.exe`/PowerShell: script memakai `bash` (lihat keputusan struktur).
- Perubahan harness artifact E2E (`e2e/support/logging-server.mjs`,
  `E2E_LOGGING_DIR`).

## Rancangan teknis

| Path | Aksi | Tanggung jawab (1–3 baris) | Layer | Seam test |
|---|---|---|---|---|
| `package.json` | modify | `dev:all`/`dev:store`/`dev:admin` mem-pipe tiap proses ke `logs/<app>.log`; `predev:*` menyiapkan folder `logs/`. Tanpa perubahan pada `dev:store:app`/`dev:admin:app`/`dev:jubelio-mock`. | konfigurasi repo (npm scripts) | `scripts/dev-log-capture.test.mts` |
| `.gitignore` | modify | Menambah blok `# dev log capture` + `/logs/`. | konfigurasi repo | `scripts/dev-log-capture.test.mts` |
| `scripts/vitest.config.mts` | create | Project vitest `tooling` (environment `node`, `include: ["*.test.mts"]`). Memulihkan referensi yang sudah ada di `vitest.config.mts` root. | test infra | — |
| `scripts/dev-log-capture.test.mts` | create | Guard statis: skrip dev harus mem-pipe ke `logs/<app>.log`, memakai `--silent`, memakai `bash -o pipefail`, punya `predev:*` pembuat folder, tidak memakai `>>`, dan `.gitignore` memuat `/logs/`. | test infra | dirinya sendiri |
| `docs/features/logging.md` | modify | Bagian "Capture log development": path file, isi file, overwrite per run, exit code, cara `tail`, batasan. | docs | — |
| `README.md` | modify | Langkah dev setup + tabel script menyebut `logs/`. | docs | — |

Kontrak export (tidak ada modul kode baru; konfigurasi yang berubah):

- `package.json` → `predev:all`, `predev:store`, `predev:admin`, `dev:all`,
  `dev:store`, `dev:admin` (bentuk akhir, satu baris per script):
  - `"predev:all": "mkdir -p logs"`
  - `"dev:all": "concurrently -n jubelio-mock,store,admin \"bash -o pipefail -c 'npm run --silent dev:jubelio-mock 2>&1 | tee logs/jubelio-mock.log'\" \"bash -o pipefail -c 'npm run --silent dev:store:app 2>&1 | tee logs/store.log'\" \"bash -o pipefail -c 'npm run --silent dev:admin:app 2>&1 | tee logs/admin.log'\""`
  - `"dev:store"`: bentuk sama dengan dua proses (`jubelio-mock`, `store`),
    file `logs/jubelio-mock.log` + `logs/store.log`.
  - `"dev:admin": "bash -o pipefail -c 'npm run --silent dev:admin:app 2>&1 | tee logs/admin.log'"`

Keputusan struktur yang non-obvious:

- **Keputusan:** `tee` diletakkan **di dalam** tiap perintah `concurrently`,
  bukan `concurrently ... | tee logs/all.log`.
  **Alasan:** hasil uji lokal menunjukkan file jadi bersih — prefiks
  `[store]`/`[0]` ditambahkan `concurrently` setelah `tee` menulis, jadi tidak
  masuk file; satu file per proses juga menghindari dua server bercampur.
  **Ditolak:** satu file gabungan (baris antar-app bercampur, sulit difilter).
- **Keputusan:** `bash -o pipefail -c '...'` membungkus setiap pipeline.
  **Alasan:** uji lokal `sh -c 'false | tee x.log'` → exit `0` (kegagalan
  tertelan), sedangkan `bash -o pipefail -c` → exit `1`, sehingga
  `concurrently` tetap melaporkan proses yang mati. `/bin/sh` di mesin dev ini
  adalah bash, tetapi `dash` (default Debian/Ubuntu) menolak
  `set -o pipefail`, jadi `bash` dipanggil eksplisit.
  **Ditolak:** `sh -c 'set -o pipefail; ...'` (tidak portabel), `tee -a`
  (menumpuk antar run, bertentangan dengan keputusan "ditimpa per run").
- **Keputusan:** `npm run --silent` pada perintah yang dipipe, dan `-n <nama>`
  pada `concurrently`. **Alasan:** banner npm (`> dev:store:app`, `> next dev`)
  ikut masuk file dan mengotori baris JSON; `--silent` terbukti menekan banner
  sampai ke `npm run` bersarang, sedangkan `-n` mengganti prefiks `[0]/[1]`
  dengan nama proses agar 3 proses tetap terbaca di terminal. Perubahan `-n`
  hanya kosmetik terminal (terverifikasi: `--names` mengubah prefiks, tidak
  mengubah output file).
  **Ditolak:** membiarkan prefiks indeks (ambigu saat 3 proses).
- **Keputusan:** pembersihan folder lewat `predev:*` (`mkdir -p logs`), bukan
  membuat file placeholder yang di-track.
  **Alasan:** `tee` gagal bila direktori belum ada, dan placeholder akan
  bertabrakan dengan ignore `logs/`. Terverifikasi `predev:all` dijalankan npm
  sebelum `dev:all`.
- **Keputusan:** memperbaiki referensi test infra dengan membuat
  `scripts/vitest.config.mts`. **Alasan:** `vitest.config.mts` root sudah
  mereferensikan `./scripts/vitest.config.mts` yang **tidak ada**, sehingga
  `npx vitest list` gagal `Collect Error: Projects definition references a
  non-existing file or a directory` — artinya `npm run test:unit`/
  `verify:batch:unit` saat ini tidak bisa jalan. Guard test butuh project
  vitest, dan folder `scripts/` adalah rumah yang sudah ditunjuk komentar
  konfigurasi root ("Tooling repo (resolver conductor tiket)").
  **Ditolak:** menaruh guard di `packages/logging`/`apps/*` (salah pemilik),
  `node --test` ala `test:playwright-artifacts` (tidak ikut `test:unit`).

Bukti eksperimen lokal (dijalankan sebelum plan ditulis, di `/tmp`, bukan di repo):

- `predev:all` dijalankan npm lebih dulu, `logs/` terbuat, `tee` menulis file
  dari run pertama.
- File hasil `tee` **tanpa** prefiks `concurrently` dan tanpa banner npm saat
  perintah dalam memakai `--silent`; run kedua menimpa isi file (2 baris, bukan
  6). Ini mengoreksi asumsi awal bahwa file akan berisi prefiks `[store]`.
- `sh -c 'false | tee x.log'` → `0`; `bash -o pipefail -c 'false | tee x.log'`
  → `1`; `concurrently` melaporkan `... exited with code 1`.

Context7 checkpoint: `/open-cli-tools/concurrently` — dikonfirmasi `--names`/`-n`
mengganti prefiks perintah dan exit code tetap berasal dari command string,
sehingga `--kill-others` tidak diperlukan di sini (Ctrl+C sudah mengirim SIGINT
ke seluruh grup proses).

Discovery: tidak ada. Semua path, script, dan perilaku shell sudah diverifikasi
di repo ini dan di uji lokal.

## Rancangan UX

N/A — tidak ada perubahan UI, halaman, komponen, atau state; task-flow,
clickability, copy, dan gate konsistensi antar-page tidak berlaku. Dampak
satu-satunya ke developer adalah isi terminal (prefiks `[store]` dsb.), yang
dibahas di Rancangan teknis.

## Fitur

| # | Fitur | Status | verify: | Catatan |
|---|---|---|---|---|
| 1 | Guard test + project vitest `tooling` | Done | `npm run verify:unit:slice -- scripts/dev-log-capture.test.mts` (RED dulu, lalu GREEN) | RED: 3 failed/3 passed; GREEN: 6/6 passed |
| 2 | Capture log di `dev:all`/`dev:store`/`dev:admin` + `.gitignore` | Done | `timeout 40 npm run dev:all` lalu `ls -l logs/` + `git status --porcelain` bersih | Smoke 2026-10-25: tiga file terbuat, `git check-ignore` cocok, tidak ada prefiks/banner di file |
| 3 | Dokumentasi (`docs/features/logging.md`, `README.md`) | Done | review isi: path, overwrite per run, exit code, `tail -f logs/store.log` | Bagian baru + dua note README |
| 4 | Buang ANSI escape code dari file log (temuan user setelah smoke) | Done | file `logs/*.log` tanpa `\x1b` sementara terminal tetap berwarna | Smoke akhir: `type=Unicode text, UTF-8 text`, `ESC=0` di ketiga file; aliran terminal 48 baris ber-ESC |

Status per fitur (lifecycle sama dengan plan): **Draft** → **Ready** →
**In Progress** → **Done**.

## Implementation notes

### Evidence verifikasi (2026-10-25)

| Gate | Perintah | Hasil |
|---|---|---|
| RED (TDD) | `npm run verify:unit:slice -- scripts/dev-log-capture.test.mts` sebelum implementasi | `3 failed \| 3 passed (6)` — target file, `predev:*`, dan `.gitignore` belum ada |
| L1 GREEN | perintah yang sama setelah implementasi | `6 passed (6)` |
| L2 | `npm run verify:batch:unit` | `164 file: 155 passed, 7 failed, 2 skipped`; `1676 tests passed`. Ketujuh failure **bukan** dari slice ini: spec DB fail-closed menolak `DATABASE_URL` DB dev (`Refusing to mutate database "storefront" … must point at a "marketplace_discounts_test_*" database`). Tidak ada test yang gagal karena script/log. |
| Smoke nyata | `setsid nohup npm run dev:all` (setelah `dev:all` lama dihentikan dengan SIGINT) | `logs/jubelio-mock.log` (48 B, "jubelio-mock listening on http://127.0.0.1:3002"), `logs/store.log` (2,3 KB), `logs/admin.log` (21 KB), ketiganya berisi output `next dev` + baris JSON `@marketplace/logging` (contoh: `{"level":"info","timestamp":"2026-10-25T10:56:48.589Z","app":"admin",…}`). Tidak ada baris berprefiks `[store]`/`[admin]` maupun banner npm (`^> ` hanya muncul sebagai code-frame Next: `> 188 \| const res = await fetch(`). Port 3000/3001/3002 listening. |
| Git ignore | `git check-ignore -v logs/{store,admin,jubelio-mock}.log` | tiga baris `.gitignore:14:/logs/ …`; `git status --porcelain \| grep -i logs` kosong |

### Evidence tambahan — fitur 4 (ANSI strip, 2026-10-25)

| Gate | Perintah | Hasil |
|---|---|---|
| Akar masalah | `grep FORCE_COLOR node_modules/concurrently/dist/src/get-spawn-opts.js` | `concurrently` menyuntik `FORCE_COLOR=<level>` ke env anak saat stdout-nya sendiri TTY → Next/Turbopack tetap berwarna walau stdout dipipe ke `tee`; `NO_COLOR=1` diabaikan Node bila `FORCE_COLOR` diset |
| RED | `npm run verify:unit:slice -- scripts/dev-log-capture.test.mts` | 2 failed (helper strip belum ada, target file belum terdeteksi) |
| GREEN | perintah yang sama | 7/7 passed |
| Uji terisolasi strip | `FORCE_COLOR=3 npx next dev -p 3905 2>&1 \| tee >(sed -E -f scripts/strip-ansi.sed > /tmp/strip-test.log)` | file `baris ber-ESC: 0`, 18 baris utuh (termasuk kode cursor `ESC[?25h` yang dikirim saat Next berhenti) |
| Uji buffering `sed` | producer 3 baris berjeda 1 dtk, dicek pada 2,5 dtk | `sed -E` → **0 baris** (buffer ~4 KB), `sed -u -E` → 3 baris. Karena itu pipeline memakai `sed -u` agar `tail -f` realtime dan tidak kehilangan baris saat Ctrl+C. |
| Smoke akhir | `FORCE_COLOR=3 npm run dev:all` (meniru TTY) + `curl /api/products` & `/api/admin/notifications/poll` | `logs/store.log` 14 baris, `logs/admin.log` 13 baris, `logs/jubelio-mock.log` 1 baris; ketiganya `UTF-8 text`, `ESC=0`; contoh baris file: `GET /api/products 200 in 2.6s (next.js: 1715ms, application-code: 912ms)` + `{"level":"info",…,"module":"products-list",…,"message":"GET 200"}`; aliran terminal 48 baris ber-ESC (warna terjaga) |

Insiden operasional: dua smoke awal bentrok dengan `npm run dev:all` milik user yang masih memakai script lama, sehingga file log punya dua penulis (gejala: NUL byte/sparse hole, `file` melaporkan `data`, `grep` menganggap binary). Semua instance liar dibersihkan sebelum smoke akhir; sisa proses diverifikasi nol dan port 3000–3004 bebas.

Batas bukti:

- Acceptance criterion 5 (exit code tidak ditelan `tee`) dibuktikan pada mekanisme, bukan
  dengan mematikan proses di sesi dev yang aktif: uji terpisah `sh -c 'false | tee x.log'`
  → `0` vs `bash -o pipefail -c 'false | tee x.log'` → `1` + `concurrently` melaporkan
  `exited with code 1`, dan guard test memastikan script asli memakai pembungkus itu.
  Mematikan child di sesi aktif sengaja tidak dilakukan karena akan menghentikan dev
  server user dan mencampur penulis file yang sama.
- Smoke tidak menguji `dev:store`/`dev:admin` terpisah untuk menghindari dua sesi yang
  menulis file yang sama (caveat yang sudah didokumentasikan). Keduanya memakai bentuk
  script yang sama dan dijaga guard test dengan target file masing-masing.
- `verify:types:*` dan `lint:*` tidak dijalankan: tidak ada file TS app/package yang
  berubah (hanya konfigurasi npm, `.gitignore`, docs, dan satu test tooling).

Urutan kerja:


1. **Fitur 1 (RED):** tulis `scripts/dev-log-capture.test.mts` lebih dulu,
   jalankan `verify:unit:slice` → gagal karena script dev belum mem-pipe dan
   `.gitignore` belum memuat `/logs/`; tambahkan `scripts/vitest.config.mts`
   agar project bisa dimuat.
2. **Fitur 2 (GREEN):** ubah `package.json` (enam script) dan `.gitignore`,
   jalankan ulang test sampai hijau.
3. **Smoke manual (bukti perilaku nyata):** `timeout 40 npm run dev:all`; cek
   ketiga file ada; cek `head -3 logs/store.log` berisi baris `next dev` atau
   JSON tanpa prefiks/banner; cek `git status --porcelain | grep '^?? logs/'`
   kosong. Catat ringkasan bukti di `index.md`.
4. **Fitur 3:** dokumentasi.
5. **Gate batch:** `npm run verify:batch:unit` (setelah fitur 1, seharusnya
   kembali berjalan normal). Tidak ada perubahan UI → tidak perlu spec
   Playwright baru; `test:e2e` tidak relevan untuk plan ini.

Caveat yang harus masuk dokumentasi: (a) dua sesi dev yang berjalan bersamaan
akan menulis file yang sama (hindari `dev:store` dan `dev:all` sekaligus);
(b) `logs/` hanya berisi run terakhir; (c) `bash` wajib tersedia (Linux/macOS/
WSL/Git Bash), `cmd.exe` tidak didukung.

## Deviation log

| Ticket / slice | Rencana (path/kontrak) | Aktual | Alasan | Dampak |
|---|---|---|---|---|
| Fitur 4 (baru) | File log ditulis langsung oleh `tee` | `tee >(sed -E -f scripts/strip-ansi.sed > logs/<app>.log)` | Laporan user: file tampak "biner" di editor karena `concurrently` menyuntik `FORCE_COLOR` ke anak saat stdout-nya TTY, sehingga Next/Turbopack mengeluarkan ANSI SGR walau stdout dipipe. Keputusan user: strip ANSI hanya untuk file (opsi A). | Terminal tetap berwarna, isi file bersih; target file tetap `logs/<app>.log`; guard test diperluas |

## Open questions

Tidak ada pertanyaan yang memblokir Ready. Dua hal sudah diputuskan di plan ini
dan dapat dibalik saat approval bila owner tidak setuju: (a) pemakaian `bash
-o pipefail` (exit code fidelity vs ketergantungan pada `bash`), (b) pemulihan
`scripts/vitest.config.mts` (prasyarat guard test sekaligus memperbaiki
`npm run test:unit` yang saat ini gagal).

## Retirement checklist (saat plan mencapai Done)

- [x] Semua fitur lulus `verify:` (test sesuai `AGENTS.md` §5).
- [x] Konten enduring diekstrak ke `docs/`: bagian baru di
      `docs/features/logging.md` + `README.md` (tidak ada endpoint berubah,
      jadi `docs/api-reference.md` tidak disentuh).
- [x] File plan tetap disimpan di `plan/` bersama research, keputusan, dan evidence.
- [x] Entri `../index.md` fitur diperbarui ke **Done** dengan tanggal +
      ringkasan hasil satu baris + bukti smoke run.
