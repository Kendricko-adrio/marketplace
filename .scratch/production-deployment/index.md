# Deployment production pertama

## Tujuan

Menyiapkan bootstrap production dari database baru: migration seluruh schema, seed sistem non-destruktif, satu System Owner, dan full import master Jubelio, dengan verifikasi sebelum launch.

## Plan dan approval

| Plan | Status | Approval | Blocker / evidence |
|---|---|---|---|
| [Deployment production pertama](plan/first-production-deployment.md) | Implemented (lokal), final gate Pending | Pemilik meminta implementasi penuh plan pada sesi ini. Implementasi dan perubahan schema-sync dilarang di luar repo lokal; Docker, SSH, database production, dan request Jubelio live tetap butuh izin terpisah. | Scripting, wiring Compose, docs runbook, dan test sudah dibuat. Verifikasi DB-disposable/container/E2E belum dijalankan: lihat [verification.md](ticket/verification.md). |

Konfirmasi drafting bukan izin implementasi atau eksekusi production. Permintaan pemilik untuk memasukkan dokumentasi langkah production sudah dicatat pada §9.3 dan AC13; approval implementasi diberikan melalui permintaan “implementasikan first-production-deployment.md”. Eksekusi target/live tetap butuh izin terpisah.

## Keputusan pemilik

- Mengikuti fondasi repo: Docker Compose + Caddy + PostgreSQL di VPS.
- Database production baru, tanpa menyalin development/staging.
- Seed sistem dahulu: Initial Roles/grants, HQ lokal dan system config. Konten storefront disiapkan operator lewat admin sebelum launch.
- Bootstrap satu System Owner; akun operasional dibuat lewat admin sesudahnya.
- Verifikasi pada public CLI dengan PostgreSQL disposable/provider fixture, unit guard/policy dan smoke admin/katalog; termasuk keamanan rerun.
- Setelah scripting dibuat dan diverifikasi, wajib finalisasi dokumentasi bahasa Indonesia di `docs/deployment-docs/first-production-deployment.md`: command final, urutan langkah, expected results, verifikasi, recovery dan checklist go-live. Persyaratan dirinci pada plan §9.3 dan AC13.

## Artefak

- [Audit alur existing dan gap deployment](research/first-deployment-audit.md).
- [Draft plan lengkap, blueprint dan AC](plan/first-production-deployment.md).
- [Verifikasi implementasi dan batas evidence](ticket/verification.md).

## Batas dan risiko

- Implementasi dan verifikasi dijalankan di repository lokal + PostgreSQL
  disposable lokal (`marketplace_bootstrap_test`, dibuat lalu dihapus). Tidak
  ada Docker, SSH, database production, request Jubelio live, commit, atau
  deployment.
- Replay seluruh migration sudah diverifikasi pada PostgreSQL disposable lokal
  (bukan target production).
- Jalur password file Owner sudah tersambung (`readFile`) dan diverifikasi lewat
  CLI pada DB disposable (file secret, duplicate, hash tidak berubah).
- Port Caddy staging/production sama-sama 80/443; cohosting harus diperiksa
  sebelum eksekusi, bukan diasumsikan aman karena nama project berbeda.
- Lulus bootstrap disposable tidak berarti target production atau transaksi live
  siap.

## Verifikasi sesi implementasi (2026-11-13)

| Cakupan | Evidence | Status |
|---|---|---|
| Slice policy: manifest/target guard, opsi full import, rekonsiliasi report | RED (3 file gagal) lalu GREEN: 58 test pass di file policy + owner input. | Verified |
| Typecheck package DB | `npx tsc --noEmit -p packages/db/tsconfig.json` lulus. | Verified |
| Full unit suite L2 | 183 file / 2175 test pass, 12 skipped; 9 file gagal **pre-existing** karena guard DB disposable menolak `DATABASE_URL=storefront` (bukan dari perubahan ini). | Verified (dengan catatan pre-existing) |
| Suite DB baru (rehearsal migration, CLI bootstrap, full import fixture) | 3 file / 13 test pass pada `TEST_DATABASE_URL` disposable; base DB + scratch DB/role dihapus dan diverifikasi kosong. | Verified |
| Perilaku bootstrap pada DB disposable | Concurrent seed serially (1 applied/1 already), rerun mempertahankan config/grant/jam cabang/password/local hold, Owner file secret, full import 201/202/404 + drift/missing-stock/partial/rerun, verifier menolak laporan tidak lengkap. | Verified |
| Container rehearsal tools image + dua smoke spec E2E | Belum dijalankan (butuh Docker/E2E auth + database bootstrap). | Pending |
| Runbook `docs/deployment-docs/first-production-deployment.md` | Ditulis sesuai §9.3 dan dinavigasikan; walkthrough command final belum dieksekusi. | Pending |
| Gate target production §15 | Tidak dijalankan; item dibawa verbatim sebagai batasan. | Pending |

Detail AC → evidence: [ticket/verification.md](ticket/verification.md). Tidak ada Docker operation, SSH, koneksi database pengguna, request provider, commit, atau deployment pada sesi ini.
