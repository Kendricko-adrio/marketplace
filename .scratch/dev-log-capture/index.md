# dev-log-capture

Navigasi artefak fitur ini; aturan layout dan lifecycle: [panduan](../README.md).
Status plan hanya dicatat di sini. Status ticket tetap di masing-masing ticket.

Fitur: capture output `npm run dev:*` (store, admin, jubelio-mock) ke file
`logs/<app>.log` saat development, tanpa mengubah tujuan log produksi (stdout →
journald).

## Status plan

| Plan | Status | Features | Notes / Outcome |
|---|---|---|---|
| [Capture log development ke `logs/`](plan/dev-log-capture.md) | Done | 4 | 2026-10-25: `dev:all`/`dev:store`/`dev:admin` menyalin output tiap proses ke `logs/<app>.log` (ditimpa per run, `bash -o pipefail`, `npm run --silent`, `sed -u` + `scripts/strip-ansi.sed` untuk membuang ANSI, tanpa prefiks `concurrently`), folder dibuat `predev:*` dan di-ignore `/logs/`. Smoke akhir dengan `FORCE_COLOR=3`: tiga file `UTF-8 text`, `ESC=0`, JSON utuh, aliran terminal tetap berwarna; `git check-ignore` cocok, `git status` bersih. Guard `scripts/dev-log-capture.test.mts` 7/7 (RED 2 failed → GREEN), `verify:batch:unit` 164 file/1676 pass dengan 7 spec DB fail-closed karena `DATABASE_URL` menunjuk DB dev. Sekaligus memulihkan `scripts/vitest.config.mts` yang hilang (sebelumnya `npm run test:unit` gagal `Collect Error`). |

## Artefak

### Perbaikan runner Windows/Linux

- User menyetujui opsi Node.js runner untuk command development lintas OS.
- Implementasi dan verifikasi Windows 2026-10-30:
  [catatan verifikasi](ticket/windows-linux-runner-verification.md).
- Focused tests 10/10 dan typechecks tooling/store/admin lulus. Batch repo belum
  hijau karena DB specs (schema tidak sinkron, guard non-disposable, duplicate
  fixture); Linux dan Ctrl+C interaktif belum diverifikasi langsung. Bukti lama
  pada tabel plan di atas tetap merupakan riwayat implementasi Bash sebelumnya.

### plan

- [plan/dev-log-capture.md](plan/dev-log-capture.md)
