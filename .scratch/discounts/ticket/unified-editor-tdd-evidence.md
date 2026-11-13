# Evidence implementasi editor diskon terpadu

Tanggal: 2026-11-09. AC mengikuti
[spec](../plan/admin-discounts-unified-editor-spec.md) baris 461–480. Audit awal
(0 Verified) ada di
[audit AC](../research/ac-coverage-audit-2026-11-09.md).

## Tabel AC → evidence

| AC | Status | Evidence |
|---|---|---|
| AC01 | Verified | `e2e/admin/discounts-prototype-mock.spec.ts` › "daftar memakai satu tabel dengan filter jenis…" (header kolom, tanpa tablist/Tentang promo, filter Semua jenis). |
| AC02 | Verified | Spec sama › "dialog Buat diskon meminta jenis secara eksplisit dan batal tidak membuat data" (`Pilih jenis promo`, jumlah Offer tidak bertambah, jenis dari dialog). |
| AC03 | Verified | Spec sama › "kupon publik tidak mempunyai tab Kode; kode promo mempunyai tab dengan tugas nyata". |
| AC04 | Verified | AC01 + AC03 (tanpa blok Tentang promo, tanpa tab Jalur, tanpa kolom Revision/ID di daftar) + dialog review tanpa JSON. |
| AC05 | Verified | `discount-editor-state.test.ts` (validasi lintas bagian, field kosong → null) + `issuesByTab` membuka tab Kode; E2E "satu snapshot…" menyimpan draft parsial. |
| AC06 | Verified | `discount-number-format.test.ts` 36 kasus + E2E "input uang dan persen memakai format Indonesia…" (`Rp 100.000,00`, `12,5`, tetap setelah pindah tab). |
| AC07 | Verified | E2E "satu snapshot menyimpan Pengaturan dan Kode bersama…" (simpan tunggal, reload mempertahankan nama+kuota+kode draft) + `discount-configuration.db.test.ts` (atomic save, 13 kasus). |
| AC08 | Verified | `discount-configuration.db.test.ts` › "menyimpan potongan 15% dan kuota 200 bersama tanpa mengubah live 10%/100". |
| AC09 | Verified | DB test "draft parsial manual tersimpan tanpa reservasi…" + `discounts-admin-mock.spec.ts` › manual code (EXTRAADMIN25 belum ada di tabel sampai publish; MANUALADMIN25 tetap `active` sebelum publish, `archived` sesudah). |
| AC10 | Verified | E2E "Lanjut ke publish menyimpan draft kotor lalu…" + mock admin › fixed flow (save otomatis → dialog review → publish). |
| AC11 | Verified | DB test "review dan publish menerapkan terms, kapasitas, dan kode dalam satu commit" + "kegagalan audit membatalkan snapshot, versi, dan receipt". |
| AC12 | Verified | DB test "izin kapasitas yang dicabut setelah review menolak seluruh publish", "kode direbut setelah review…", "menolak stale version…". |
| AC13 | Verified | DB test "retry dan dua submit bersamaan hanya menaikkan versi serta audit sekali". |
| AC14 | Verified | Mock admin tiga alur (fixed 147.630, persentase 149.850, shipping 176.500) memakai draft tersimpan; UI menandai hasil basi saat `draftVersion` berubah. |
| AC15 | Verified | `discounts-usage-mock.spec.ts` 4 kasus (Pemakaian saat ini, scoped/aggregate, riwayat manusiawi, tanpa literal kode). |
| AC16 | Verified | E2E "paused tetap dijeda setelah publish dan archived menjadi read-only" (warning review, state tetap `paused`, archived read-only tanpa tombol simpan). |
| AC17 | Verified | E2E "meninggalkan editor dengan perubahan belum disimpan meminta pilihan" (tiga pilihan, tetap di editor); double-submit dijaga `state.status` + `running` ref pada simpan/review/publish. |
| AC18 | Verified | E2E "writer konfigurasi lama ditutup dan viewer tetap read-only" (410 `CONFIGURATION_MOVED_TO_DRAFT` untuk `/policy`, `/codes`, `/codes/{id}`); grep menunjukkan tidak ada caller first-party yang tersisa. |
| AC19 | Verified | `npm run db:backfill-discount-drafts` (1 revision diisi, run kedua 0 — idempotent, tanpa menyentuh live/usage/kode); seed demo membuat draft parsial, published+draft, dan paused. |
| AC20 | Partial | Docs diperbarui (feature, database, seeding); E2E 390 px tanpa overflow horizontal untuk daftar+editor, keyboard tab diuji. **Pending:** perbandingan render terhadap peer page (BranchForm/harga) dan pengecekan viewport desktop 1440 secara visual belum dilakukan. |

## Perintah verifikasi yang dijalankan

- `apps/admin`: `npx vitest run src/app/admin/discounts` → **53 pass**
  (`discount-editor-state.test.ts` 17, `discount-number-format.test.ts` 36).
- DB disposable (`marketplace_discounts_test_unified_editor_20260218`):
  `npx vitest run --no-file-parallelism` untuk
  `discounts-administration.db.test.ts`, `discount-configuration.db.test.ts`,
  `discount-operations-read.db.test.ts` → **43 pass, 1 skip**.
- `npm run verify:batch:unit` dengan DB disposable →
  **183 file, 2143 pass, 12 skip, 6 gagal**. Enam kegagalan berasal dari
  `apps/store/src/lib/jubelio-channel-mirror.db.test.ts` (fitur Jubelio channel
  mirror yang sedang dikerjakan paralel di worktree ini, bukan diskon; status
  `skipped` vs `confirmed`). Tidak diperbaiki di sesi ini.
- Mock E2E (`--project=pickup-mock`): `discounts-prototype-mock.spec.ts`
  **11 pass**, `discounts-admin-mock.spec.ts` **6 pass**,
  `discounts-usage-mock.spec.ts` **4 pass** → **21 pass**.
- `npm run verify:types:admin` dan `verify:types:store` → pass.
- `npx eslint` (dari `apps/admin`) untuk `src/features/discounts`,
  `src/app/admin/discounts`, `src/app/api/admin/discounts`,
  `src/lib/discounts-http.ts` → 0 error, 0 warning.
- `npx tsc --noEmit -p packages/db/tsconfig.json` → pass.
- `SEED_MODE=demo npm run db:seed` pada DB disposable → pass; fixture state
  (draft 2 offer/2 draft, enabled 6/1 draft, paused 1/1 draft, 3 snapshot).

## Batasan yang belum diklaim

- Render review visual desktop 1440 dan perbandingan konsistensi dengan peer
  page belum diperiksa; AC20 tetap **Partial**.
- Legacy E2E live-provider (`npm run test:e2e`) tidak dijalankan (butuh izin
  terpisah).
- Tidak ada commit, push, deploy, atau perubahan gate rollout
  (`discounts.contractVersion` tetap 0 pada seed).
