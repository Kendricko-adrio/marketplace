# Verifikasi runner development Windows/Linux

Tanggal: 2026-10-30.

## Scope dan persetujuan

User memilih **Node.js runner (Recommended)** untuk menghilangkan ketergantungan
Bash dari command development, sambil mempertahankan capture log, output terminal,
exit code, dan penghentian process tree. Perubahan kecil satu sesi ini memakai
scope percakapan; tidak membuat plan/ticket implementasi baru.

## Blueprint dan perubahan

| Path | Peran/layer | Kontrak atau seam |
|---|---|---|
| `package.json` | Konfigurasi tooling | `dev:all`, `dev:store`, `dev:admin` memanggil runner; hooks `predev:*` berbasis `mkdir -p` dihapus |
| `scripts/dev-log-capture.mts` | CLI tooling | CLI `<app>`: `store`, `admin`, `jubelio-mock`; menyiapkan folder, menjalankan npm melalui Node, menyalin stdout/stderr, membersihkan ANSI pada file, meneruskan exit code |
| `scripts/dev-log-capture.mts` | Lifecycle proses | `stopProcessTree(pid: number, signal: NodeJS.Signals): Promise<void>`; process group POSIX, `taskkill /T /F` Windows |
| `scripts/dev-log-capture.test.mts` | Integration tests tooling | Command npm nyata dengan leaf scripts fixture, file log, stdout/stderr, exit code, dan process tree nyata dalam direktori sementara yang mengandung spasi |
| `README.md`, `docs/features/logging.md` | Dokumentasi | Prasyarat Node.js 24 LTS, commands lintas OS, mekanisme capture dan keterbatasan shutdown |

UX visual: N/A — tidak ada perubahan UI, routing, auth, atau perilaku bisnis.
Deployment: N/A — tidak mengubah build/runtime produksi, env, port, atau endpoint.
Tidak menambah dependency. `concurrently` tetap menjadi orchestrator existing.
Helper legacy `scripts/strip-ansi.sed` tidak lagi dipakai scripts dev; file existing
tersebut tidak dihapus agar scope perubahan tetap sempit.

## Checkpoint dokumentasi

- Context7 `/websites/nodejs_latest-v24_x_api`: memastikan `spawn`, process group
  POSIX dan batas signal Windows, `stripVTControlCharacters`, serta native type
  stripping untuk `.mts` pada Node.js 24.
  Sumber: [child_process](https://nodejs.org/docs/latest-v24.x/api/child_process.html),
  [process](https://nodejs.org/docs/latest-v24.x/api/process.html),
  [util](https://nodejs.org/docs/latest-v24.x/api/util.html),
  [TypeScript](https://nodejs.org/docs/latest-v24.x/api/typescript.html).
- Context7 `/vitest-dev/vitest`: memastikan `expect.poll` di-await serta timeout
  per test untuk integration test proses nyata.
- Implementasi Windows `taskkill /pid <pid> /T /F` juga dibandingkan dengan source
  package terpasang `node_modules/tree-kill/index.js`, yang dipakai `concurrently`.
  Runner tidak mengimpor transitive dependency tersebut.
- Diagnosis awal: Context7 `/npm/cli` mengonfirmasi default shell Windows adalah
  `cmd.exe`; `npm config get script-shell` pada sesi ini menghasilkan `null`.

## Bukti RED → GREEN

1. Test capture stdout/stderr gagal karena runner belum ada; setelah implementasi,
   1/1 lulus.
2. Test ANSI terpotong antar-chunk gagal (escape tersisa); buffer per baris
   memperbaikinya, 2/2 lulus.
3. Test penghentian tree gagal karena helper belum ada; setelah implementasi,
   6/6 lulus, termasuk overwrite dan exit code 7 untuk ketiga app.
4. Ketiga test command npm gagal karena konfigurasi masih memakai utilitas Unix;
   setelah perubahan scripts, ketiganya lulus. Timeout test `dev:all` dinaikkan
   dari default 5 detik menjadi 20 detik untuk overhead proses di Windows.
5. Ditambahkan observasi file log saat child masih berjalan dan cleanup proses.
   Hasil terarah terakhir: **10/10 lulus**.

## Hasil checks

Platform sesi: **Windows, Node.js v24.14.0**, npm scripts memakai default shell.

| Check | Hasil |
|---|---|
| `npm run verify:unit:slice -- scripts/dev-log-capture.test.mts` | PASS — 1 file, 10 tests; 5,37 detik |
| `npx tsc --noEmit --module nodenext --target es2022 --allowImportingTsExtensions --skipLibCheck --types node scripts/dev-log-capture.mts scripts/dev-log-capture.test.mts` | PASS |
| `npm run verify:types:store` | PASS |
| `npm run verify:types:admin` | PASS |
| `npm run verify:batch:unit` | **FAIL** — 19 file gagal, 149 lulus, 3 skipped; 169 tests gagal, 1657 lulus, 48 skipped; 98,63 detik |
| `git diff --check` | PASS; hanya warning normalisasi LF/CRLF dari Git |

Batch tidak hijau: semua file gagal merupakan DB specs yang tidak diubah oleh
pekerjaan ini. Error yang ditemukan meliputi kolom `checkout_attempt_id` yang
belum ada di DB terhubung, guard penolakan DB non-disposable, dan duplicate
`orders_pickup_code_unique`. Tidak mengubah schema/DB untuk menyelesaikan blocker
tersebut; perbaikannya di luar scope runner. Full batch tidak diulang.
Log sesi berada di `/tmp/dev-capture-*.log` (sementara, di luar repo).

## Batas bukti dan tindak lanjut

- Linux belum dijalankan langsung. Branch POSIX menggunakan API yang terdokumentasi,
  tetapi ini bukan bukti runtime Linux.
- Ketiga command npm diverifikasi dengan fixture, bukan server Next.js nyata.
  Tidak membuka port atau menjalankan E2E karena tidak ada perubahan UI.
- Helper penghentian Windows dibuktikan pada process tree nyata; penekanan Ctrl+C
  interaktif di terminal Windows belum disimulasikan. `taskkill /F` tidak menjamin
  flush output aplikasi yang masih tertahan ketika proses dihentikan.
- Pemeriksaan kode/diff sudah dilakukan terhadap scope yang disetujui; perubahan
  existing fitur `jubelio-sales-api-switching` dan script evidence user dibiarkan.
- Verifikasi repo keseluruhan masih terblokir DB. Tidak menandai gate batch sebagai
  lulus atau status plan lama sebagai bukti runtime Linux.
- Tindak lanjut: jalankan focused spec pada Linux dan siapkan DB disposable yang
  schema-nya sesuai sebelum mengulangi batch DB dalam pekerjaan terpisah.
