# Penyelarasan normalisasi stock refresh staging

## Pembaruan setelah task normalisasi

Pemilik kemudian meminta checkout staging dibuka meskipun readiness lain Pending. Flagfalse dan store recreation dari image yang sama diterapkan17November13:24 UTC, tanpa build/test/transaksi. Lihat [outstanding Anda/agent](checklist-outstanding-staging.md) dan [AC terkini](verifikasi-deployment-staging-fase-2.md). Status normalisasi di bawah adalah histori12:12 UTC; kalimat checkout tidak berubah berlaku pada scope normalisasi, bukan pada pembukaan berikutnya.

## Histori status — 17 November 2026 12:12 UTC

**Full unit gate S4 masih Pending; Google credential dan checkout tidak berubah.** Refresher staging sudah memakai normalisasi baru. Actual chain3 exit0 memperbarui seluruh165.021 mapped rows/59.730 eligible IDs, missing0/failed0, holds tetap0; daily cron3 terpasang02:00 UTC tetapi bukti scheduled execution belum ada.

## Approval dan scope

Pemilik menyetujui melalui **“iya oke tolong samakan”**, setelah dijelaskan kasus source on_hand0/on_order1/available−1: importer menyimpan0 sellable, refresher lama menolak. Perbaikan terbatas pada negative availability yang konsisten; bukan pelonggaran data malformed, perubahan schema, reset/import ulang, provider write, Google credential recovery atau pembukaan checkout. Tidak ada subagent/commit/push/production.

Setelah full suite gagal pada test cancel-race di luar perubahan dan cleanup rehearsal DB, pemilik memilih **Deploy terarah (Recommended)**. Izin ini khusus deploy/test staging tertutup dengan full verification tetap Pending, bukan izin mengubah test/modul lain agar suite hijau atau menyatakan seluruh deployment selesai.

## Blueprint mini

- `packages/db/src/jubelio-stock-refresh.ts`: helper domain existing `selectObservedStock(resp, requested, mapped)`; signature/DTO tetap, validasi raw dahulu lalu available dinormalisasi0. Query/concurrency guard tidak berubah.
- `packages/db/src/jubelio-stock-refresh.test.ts`: public helper seam, literal negative source valid→0, invalid/missing/duplicate tetap reject.
- `packages/db/src/jubelio-stock-refresh.db.test.ts`: public refresh seam pada PostgreSQL disposable, memastikan timestamp fresh dan local holds tidak berubah. Fixture menangkap cursor awal sekali agar test dapat menyiapkan ulang datanya secara independen.
- `docs/features/jubelio-sync.md` dan runbook/evidence deployment: kontrak normalisasi, hasil actual dan batas handover.
- UX visual N/A—tidak mengubah UI/copy/flow. API route/logging success/error existing tetap dipakai. Source release staging harus dipin; jangan menjalankan image `latest` kandidat yang dibatalkan.

## Context7 checkpoint

`/vitest-dev/vitest/v4.1.12` mengonfirmasi `it.each` array object, `$property` pada nama test, dan recursive `toEqual`; installed4.1.10 menerima API yang sama pada actual run. Tidak mengubah Drizzle/Next API: hanya pure validation/normalization dan assertion yang sudah ada.

## Evidence development

- RED: `npm run verify:unit:slice -- packages/db/src/jubelio-stock-refresh.test.ts` →2 regression cases gagal/3 existing pass, sesuai bug negative available ditolak.
- GREEN pertama:5/5 unit pass setelah perubahan minimal helper.
- Guard regression tambahan: negative on-hand/liability, negative fractional, mismatched raw totals dan duplicate negative observations tetap ditolak.
- Focused dua file di atas pada PostgreSQL disposable port55442 →**14/14 pass**, tanpa skip. Database development5432 tidak disentuh.
- `npm run verify:types:store` →exit0.
- Query, schema, timestamp policy, CAS cursor, local accounting dan logger route tidak diubah. Tidak menganggap passing local tests sebagai bukti staging.

## Gate integrasi dan deployment aktual

- Full serial unit gate pada disposable:208 files,207 pass/1 fail;2493 tests pass/1 fail/12 skipped, plus1 unhandled cleanup error57P01. Failure: `jubelio-channel-mirror.db.test.ts` R4 mengharapkan `cancel_started`, mendapat `not_dispatchable`; focused file juga gagal pada assertion yang sama. Migration0018 rehearsal lulus focused, tetapi full run mencatat connection termination saat cleanup. Tidak mengubah file-file tersebut, menyembunyikan failure, atau mengulang suite untuk mencari hasil hijau.
- Types store dan package DB exit0.14 focused stock tests pass tanpa skip. Disposable milik sesi port55442 dihapus; `storefront-postgres`5432 tetap berjalan.
- Context7 `/docker/compose`: multiple `-f` override, build context/image, selective `up --no-deps --no-build --pull never` dikonfirmasi. Build context dibuat dari Git archive base yang dipin + patch allowlist32 files, bukan dirty tree/candidate image.
- Release: `6c5733833af09635de4a4990e5b1ca4ca5a8f9b5+3256bdb32b3632fcd1a440294ccce09b1b3fbe767c3f2fbead0f841519785609`. Semua32 checksums cocok; `jubelio-sync.ts`/`import-jubelio-service.ts` identik base, tanpa optimisasi importer yang dibatalkan.
- Store/admin/migrate/bootstrap dibangun dari snapshot yang sama. Apps direcreate12:00:54–12:01:05 UTC, healthy; Caddy container dan mounts sama. Dua cron dipause sebentar lalu direstore. Default image aliases diselaraskan ke image bersih baru, unique pinned tags disimpan; tidak lagi bergantung pada image lama yang tidak tersedia.
- Source canonical immutable: `/home/ops/log/marketplace-bootstrap/staging/stock-normalization-release/source`; manifest/override/images ada pada `active-release.json`. `import-restart.json` adalah histori import, bukan override source untuk release baru.
- Hanya `APP_RELEASE` yang berubah di `.env`/`.env.staging`; semua env lain dibandingkan sebelum/sesudah, termasuk Google/provider/auth/cron secrets, tanpa dicetak. Tidak menjalankan migration/reset/seed/import/Owner bootstrap.

| Image | Digest |
|---|---|
| store | `sha256:974780f0cf52960be7e5916f9a14069ef2fb0262129716b4c65c513736104081` |
| admin | `sha256:c96c70c3307b1e0a16050913c452b0293e9c1efba1b74e8e7393455099e2efca` |
| migrate | `sha256:a1c7ebc25f1f2215f1c3ea164aa1f522f9f555b15293f09d61e74c3aaf598b11` |
| bootstrap | `sha256:9c111eb23b32c5ceb1a6b2ddf758886a436da4869e92054e1f32d6ad3d7d6c1c` |

## Actual stock refresh dan scheduler

| Invocation | IDs | Observations updated | Missing / failed |
|---|---:|---:|---|
|1/3 |20.000 |46.819 |0 /0 |
|2/3 |19.730 |42.277 |0 /0 |
|3/3 |20.000 |75.925 |0 /0 |
| Total |59.730 |165.021 |0 /0 |

Rangkaian12:02:53–12:05:20 UTC, exit0. Query terpisah memastikan seluruh mapped timestamp lebih baru dari start chain, oldest12:02:53.704/newest12:05:19.958 UTC, timestamp kosong0, negative holds0, reserved/pending sums tetap0, normalized formula mismatch0. Cursor tidak direset; rangkaian mencakup seluruh keyset.

Cron stock aktif `0 2 * * * ... --runs 3`, host `Etc/UTC`, tanpa `TZ`/`CRON_TZ` override. Next planned run18November02:00 UTC /09:00 WIB. **Belum menjadi bukti scheduled execution**, jadi global AC11 masih Pending. Sweep/email masing-masing11 scheduled runs sehat sesudah rollout, dua contoh12:11/12:12 UTC. Tidak membuat order/email/transaksi dummy.

## Browser dan batas handover

Opt-in smoke terhadap release baru: **3/3 pass** (store desktop/mobile, Owner login/forced-reset/realm isolation). Tidak mengubah password atau melakukan Google OAuth/provider canary. Manual rendered review katalog dan login pada1440/390: HTTP200, no overflow, no pageerror/5xx/blocked requests, images/focus terlihat. Screenshot sukses di `playwright/mcp/staging-stock-normalization/`; pola mobile filter panjang/floating WhatsApp overlap sebagian Reset Filter masih existing, tidak diredesign.

Post-rollout DB:39.045 model/108.503 SKU, order/client/sales-operation/email-job0, contract diskon1, checkoutpaused, Owner mandatory reset1. File credential Google staging terkonfirmasi masih belum disuplai. Full suite, operator input dan seluruh UAT/provider constraints tidak otomatis lulus karena stock refresh berhasil.

Bukti server di `stock-normalization-release/`: `preflight.json`, `activation.json`, `verification.json`, `final-state.json`, build logs, `refresh-before.json`, `refresh-full.exit`; pointer aman di `active-release.json`. Tidak ada secret pada metadata tersebut. Dokumentasi operasional live boleh diperbarui setelah build; snapshot immutable dan app code tidak berubah.

## AC → evidence

| AC | Evidence | Status |
|---|---|---|
| S1 | Raw negative availability yang konsisten menjadi0; unit literal regressions | Verified |
| S2 | Missing/malformed/liability negatif/duplikat dan raw mismatch tetap reject; unit guards | Verified |
| S3 | Freshness diperbarui, available0 tetap tidak sellable, reserved/local pending tidak dilepas; DB public-seam test | Verified |
| S4 | Types store/DB lulus; full gate1 cancel-race failure dan cleanup error masih ada; user menyetujui deploy terarah tanpa menyebut full suite pass | Pending |
| S5 | Paired release32 files terpin/healthy, actual chain3 exit0,165.021 timestamps baru, missing0/failed0/holds unchanged; smoke3/3 | Verified |

Global deployment tetap mengikuti [AC pasca-import](verifikasi-pasca-import-staging.md); credential Google/input operator/checkout dan scheduled daily stock evidence tidak otomatis lulus karena helper diperbaiki.
