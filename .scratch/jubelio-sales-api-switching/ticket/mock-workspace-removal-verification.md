# Verifikasi penghapusan workspace mock Jubelio

## Scope dan approval

User memilih **Fixture test saja** dan **Hapus mock saja**, lalu menyetujui
rencana enam poin melalui **Setujui implementasi**. Hapus kedua app dan container
staging; pindahkan mock ke fixture automated test. Konfigurasi akun, URL provider,
mode production staging, dan izin write existing tidak diubah. Tanpa sandbox
request, DB sync, commit, remote, restart, atau deployment.

## Blueprint yang dijalankan

| Path | Perubahan / tanggung jawab | Seam |
|---|---|---|
| `apps/jubelio-mock/` → `e2e/fixtures/jubelio/` | Pindahkan server HTTP, unit test, tsconfig, Vitest; hapus manifest workspace | HTTP fixture, kontrak export existing tetap |
| `apps/jubelio-webhook-simulator/` | Hapus CLI simulator dan test khusus CLI | Tidak menghapus endpoint webhook aplikasi |
| `package.json`, `package-lock.json`, `scripts/dev-log-capture.mts` | Hapus command/workspace; dev hanya menjalankan store/admin | Command npm lewat subprocess |
| `playwright.config.ts`, `playwright.mock.config.ts`, `vitest.config.mts` | Entry point fixture baru | Discovery dan startup HTTP |
| `deployment/staging/docker-compose.yml` | Hapus service, URL mock, dependency | Compose config |
| `deployment/common/{store,admin,migrate}/Dockerfile`, `deployment/common/jubelio-mock/` | Hapus COPY manifest dan image mock | Konfigurasi image |
| `.env.example`, `README.md`, `docs/testing/README.md`, `docs/features/{jubelio-sync,stock-reservation,logging}.md`, `docs/deployment-docs/{README,jubelio-sync,logging}.md` | Bersihkan petunjuk aktif; hapus dokumen simulator | Review referensi |
| `scripts/dev-log-capture.test.mts`, `scripts/jubelio-test-isolation.test.mts` | Regression dev tanpa mock dan isolasi deployment | CLI dan artefak konfigurasi publik |

UX: N/A — tidak ada perubahan halaman, copy UI, route, atau state interaksi.
Context7: dilewati — pemindahan kode dan perubahan konfigurasi existing, tanpa API
library baru. Pengaman mock loopback-only pada client tidak dihapus.

## AC → evidence

| AC | Status | Evidence |
|---|---|---|
| Kedua workspace dan command simulator dihapus | Verified | `scripts/jubelio-test-isolation.test.mts`; lockfile hanya menghapus dua workspace/link |
| `dev:store`/`dev:all` tidak menjalankan mock | Verified | RED 3 gagal/7 pass sebelum perubahan, GREEN 10 pass pada `scripts/dev-log-capture.test.mts` |
| Staging tidak memuat service, URL, atau dependency mock | Verified | `docker compose -f deployment/staging/docker-compose.yml --profile tools config --services`: store/admin/caddy/migrate |
| Fixture test tetap tersedia dengan kontrak sama | Verified | 43 test HTTP fixture pass; `tsc --noEmit -p e2e/fixtures/jubelio/tsconfig.json` pass; server dan test dipindahkan byte-identik |
| Playwright mengenali regression specs | Verified | `npx playwright test --config=playwright.mock.config.ts --list`: 196 test/32 file |
| Typecheck app | Verified | `verify:types:store` dan `verify:types:admin` exit 0 setelah `next typegen` meregenerasi route types |
| Focused gate untuk perubahan ini | Verified | `verify:unit:slice` pada tiga file terkait: 56 test pass |
| Full unit suite | Verified (run terpisah) | 198 file/2307 pass/12 skipped pada DB disposable `marketplace_discounts_test_mock_cleanup_20261113` + fixture loopback |
| Browser regression terintegrasi | Pending | Run Playwright penuh tidak diselesaikan karena di luar scope permintaan; discovery bukan bukti browser pass |

## Review dan batasan

- `git diff --check` pass. Source server dan unit test fixture dipindahkan tanpa
  perubahan kontrak. Dokumentasi aktif menjelaskan pemisahan fixture/dev/staging.
- Lockfile diperbarui offline dengan `npm install --package-lock-only --ignore-scripts --offline`.
- DB disposable yang dipakai verifikasi sudah dihapus kembali; DB `storefront` milik
  developer tidak diubah.
- Build image tidak dijalankan; validasi Compose tidak menghubungi Docker daemon
  atau mengubah container. Container mock existing di server tetap ada sampai
  operator menerapkan konfigurasi dan menghapus orphan dalam deployment berizin.
- Perubahan `AGENTS.md` dan artefak lain yang muncul di worktree selama sesi adalah
  perubahan di luar task dan tidak ikut di-commit.
- Langkah lanjutan: jalankan browser regression (`verify:batch:e2e`) saat DB
  disposable disiapkan untuk itu. Tidak ada approval deployment atau transaksi
  sandbox yang tersirat dari perubahan ini.
