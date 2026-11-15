# 04 — Bulk harga dengan hasil dan resume akurat

Label: ready-for-agent
Type: task
Status: resolved
Assignee: main-agent
Blocked by: 03
Parent: [Map implementasi diskon](map.md)
Spec: [Complete spec](../plan/discounts-spec.md)
Acceptance IDs: M03, X01, X03, X04, X05, X06, A01, A04, D02

## Perilaku yang dibangun

Admin memilih SKU lintas halaman, mereview fixed target/restore dan menerapkan perubahan harga secara bertahap. Ia dapat membaca hasil yang akurat dan melanjutkan request terputus tanpa mengulang row final. Ini bulk UI end-to-end, bukan parser Excel yang baru diperkenalkan05.

## Acceptance criteria

- [x] Hanya SKU dicentang diproses; selection retained lintas halaman, tidak otomatis seluruh hasil filter. Limit1000 SKU dari current config ditegakkan server.
- [x] Shortcut persen dihitung dari source Base Price lalu dibekukan fixed target dengan nearest/half-up. Base300000/current150000/diskon20% → target240000, review menyebut kenaikan90000; target85% source100001 →85001.
- [x] Stage/review tidak mengubah live prices. Preview menunjukkan selected count/SKU/variant/base/current/target/dampak/error dan restore consequence.
- [x] Apply maksimum25 rows atau budget5detik/request, timeout transaksi/lock/statement tidak melewati remaining budget. Tiap row commit sendiri, tidak satu transaksi1000 SKU atau background worker. Row yang belum pasti dibaca durable result-nya, timeout HTTP bukan bukti rollback.
- [x] Source/Markdown terbaru dipakai saat row apply; target tetap valid diterapkan tanpa mandatory re-review, invalid gagal row, restore melepas latest. Actual before-after/audit dan status row committed bersama.
- [x] Concurrent apply/resume tidak menggandakan revision/audit/result; request key sama+payload berbeda409. Pending boleh dilanjutkan, final applied/unchanged/failed tidak diulang.
- [x] Counts applied/unchanged/failed/pending jujur; no-op bukan perubahan fiktif. Batch belum final selama pending; final state mengikuti spec. Contoh60 committed/37 pending/3 failed tidak disebut sukses100; resume hanya37.
- [x] Izin diperiksa per write row dengan serialized current policy. Revoke menghentikan write berikut dan mencatat halt reason; tidak rollback committed atau membocorkan hasil kepada viewer tanpa grant.
- [x] Data report/read/history cukup untuk05 membentuk workbook/failed subset tanpa arsip file asli. Config limit invalid fail closed; perubahan limit tidak menghapus hasil committed, pending batch oversized ditahan sesuai spec.
- [x] Price grants, ownership/retention, schema/seed, structured logs, admin visual existing dan feature/API docs tetap sesuai kontrak.

## Verifikasi

T real PG melalui apply/read/history untuk race resume, source edits, no-op, policy revoke dan row rollback. B real UI untuk selection lintas halaman, kenaikan target, partial/pending/resume dan truthful messages. L untuk half-up literals, H untuk bounds/denials/request replay. Parser Excel/fatal file acceptance belum diklaim selesai oleh04.

## Batas dan penyelesaian

Baca [kontrak bersama](map.md#kontrak-bersama-untuk-semua-ticket). Tidak ada background job, batch atomik penuh, provider writes baru atau implementasi tanpa izin. Tests/docs slice ini wajib sebelum resolved; main agent mencatat Answer dan tidak menganggap limits sebagai SLA terukur.

## Answer

Status: resolved. Implementasi di worktree utama `worktree/diskon`; main agent
menjalankan seluruh validation (lane implementer hanya menulis file, tanpa shell).
Tidak ada commit/push, provider request nyata, remote, Docker remote, atau
deployment. Gate operasional tetap `0`; hanya DB disposable yang memakai `1`.

### Yang diimplementasikan

- **Domain bulk + apply bertahap** (`apps/admin/src/lib/price-changes-administration.ts`):
  `stagePriceChangeBatch` menerima 1..N row (`source` manual/bulk, default
  diturunkan dari jumlah row), menolak SKU duplikat, menegakkan
  `discount.import.maxRows` dari config uncached (`400 ROW_LIMIT_EXCEEDED`),
  membekukan shortcut persen menjadi target fixed dari source saat stage
  (half-up; 85% × 100001 = 85001), dan tetap men-stage SKU/source invalid dengan
  warning untuk difinalkan `failed` saat apply. `applyPriceChangeBatch` memproses
  maksimum 25 row atau 5 detik per request, **satu transaksi bounded per row**
  (lock batch → row → variant → current pointer, policy re-read per row), lalu
  mengembalikan `202` selama pending dan `200` saat final. Helper pure
  `remainingBudgetMs`/`planRowBudget` membatasi lock/statement ke sisa budget
  (`null` bila <250 ms); error transient dibaca ulang secara durable sehingga
  timeout bukan bukti rollback. No-op → `unchanged` tanpa revision, satu audit;
  restore melepas target terbaru; source/Markdown terbaru dipakai saat apply.
- **Ledger apply/resume** (`packages/db/src/schema/prices.ts`,
  migrasi drizzle-kit `0045_young_shiva.sql`): tabel
  `price_change_apply_request` unik `(actor_identity, request_key)` + FK batch
  RESTRICT. Key sama + batch/digest sama melanjutkan; beda → `409
  REQUEST_KEY_CONFLICT`. Concurrent/parallel apply tidak menggandakan
  revision/audit/result karena row final dilewati.
- **Halt + revoke** (spec §6.4): `POLICY_REVOKED` dicatat saat grant dicabut di
  tengah chunk (respons `202` + `haltReason`, row committed tetap) dan saat
  request dimulai tanpa grant (respons `403 DENIED`, halt tetap tercatat, row
  pending tidak berubah). `ROW_LIMIT_EXCEEDED` menahan batch pending yang
  melebihi limit baris terbaru tanpa menghapus hasil committed. Read batch tetap
  butuh `prices:view` + products view-all, jadi viewer tanpa grant tidak bisa
  membaca hasil.
- **Config limit** (`packages/db/src/discount-import-limits.ts` + reader admin
  uncached): default 1000 / 5242880 / 26214400; nilai invalid fail closed `503
  IMPORT_LIMITS_INVALID`; key hilang memakai default; limit baru tidak menghapus
  batch committed.
- **API**: `POST /api/admin/price-changes` (1..N row, `source`), `GET
  /api/admin/price-changes/{id}` (`page`/`limit`/`state`, counts seluruh batch,
  rows paginasi + actual/resultCode), `POST .../apply` (202/200), dan `GET
  /api/admin/price-changes/candidates` (search/pagination, proyeksi Markdown,
  base/effective null untuk source invalid, no-store). Semua route memakai
  structured logger (info sukses, `partial` untuk 202, warn denial, error
  kontekstual; tanpa request key/fingerprint/daftar SKU).
- **UI** (`price-change-bulk-client.tsx` + wiring `page.tsx`): pencarian
  kandidat 25/halaman, checkbox per SKU + header hanya halaman aktif, seleksi
  bertahan lintas halaman/kata kunci, form satu aksi (fixed/percent/restore),
  review counts + tabel per row (SKU/variant/base/efektif kini/target/dampak/
  warning, catatan restore), apply satu chunk per klik dengan counts jujur dan
  tombol "Lanjutkan apply" manual selama pending, pesan final sesuai state dan
  halt reason sebagai error. UI memakai komponen/token admin existing.
- **Seed/cleanup/docs**: default `discount.import.*` di `seed-system-config.ts`,
  satu batch demo bulk `staged` 3 row pending di `seed.ts` (tanpa revision/
  pointer/perubahan source), `priceChangeApplyRequests` dihapus sebelum row/batch
  di `seed-cleanup.ts`, plus `docs/features/markdown-pricing.md` §3,
  `docs/api-reference.md`, dan `docs/testing/README.md`.
- **Perbaikan yang ditemukan saat review main**: (1) `isRetryableDatabaseError`/
  `isUniqueViolation` kini menelusuri `cause` karena Drizzle membungkus error
  driver (`DrizzleQueryError`) — tanpa ini lock/statement timeout tidak pernah
  masuk jalur durable re-read dan keluar sebagai error mentah; (2) fixture E2E
  menghapus apply-request sebelum batch (FK RESTRICT) dan mereset `state` saat
  melepas `applied_revision_id`; (3) UI menghitung `MARKDOWN_ABSENT` sebagai
  warning informasional, bukan row error; (4) cleanup test config hanya
  menghapus tiga key yang dimiliki suite dan mengembalikan nilai seeded/operator
  di `afterAll`.

### Evidence (main agent, bukan laporan child)

| Check | Hasil | Log |
| --- | --- | --- |
| `verify:types:admin` / `verify:types:store` | PASS | — |
| `npx tsc -p packages/db/tsconfig.json --noEmit` | PASS | — |
| `lint:admin` | 0 error (34 warning pre-existing) | `/tmp/t04-lint-admin-final.log` |
| Focused pure + seed + DB admin (4 files) | **51 passed** | `/tmp/t04-focused-final.log` |
| DB admin termasuk lock-timeout/rollback seam (1 file) | **33 passed** | `/tmp/t04-lock-timeout-test.log` |
| Batch unit serial | **135 files / 1518 passed / 8 skipped** | `/tmp/t04-batch-unit-final2.log` |
| Mock E2E bulk + ticket 03 | **8 passed** | `/tmp/t04-bulk-e2e-final3.log` |
| `db:generate` + `db:check` | `0045_young_shiva.sql` (hanya tabel baru) + PASS | — |
| Push + seed + re-seed/cleanup DB disposable `marketplace_discounts_test_20261026` | PASS | `/tmp/t04-seed-reseed.log`, `/tmp/t04-seed-final.log` |

Skip pada batch unit adalah placeholder readiness environment yang sudah
terdokumentasi (Sales versioned/operations/channel-mirror), bukan test bulk.
Setelah run terakhir: gate `0`, `discount.import.*` = 1000/5242880/26214400,
batch demo bulk `staged` 3 pending, 0 revision.

### Bukti per acceptance

- **X01 (selection/percent/kenaikan)**: E2E memilih 25 SKU halaman 1 + 5 SKU
  halaman 2, kembali ke halaman 1 dan pilihan tetap; review menampilkan target
  `Rp 240.000` dari base 300000 (bukan 80% dari Markdown 150000) dan
  `Naik Rp 90.000`; shortcut 15% dari 100001 → `85001`; DB test mengunci literal
  half-up dan memastikan harga live tidak berubah saat stage.
- **X03/X04 (apply, pending, resume)**: DB test 30 row → 202, `applied+pending=30`,
  revision = applied, resume sampai final 30/30 tanpa duplikasi; UI menampilkan
  "Belum final … pending" dan resume manual hanya sisa row; contoh 60/37/3
  dikunci lewat `deriveBatchState` + counts. HTTP: apply dengan key sama dan
  `previewDigest` berbeda → `409 REQUEST_KEY_CONFLICT` dan batch tetap 2 revision
  (bukan chunk/revision kedua).
- **X05 (source/permission berubah)**: DB test source naik/turun setelah stage
  (target valid diterapkan, invalid `failed` tanpa revision), revoke `prices:edit`
  → halt + row committed tetap + resume setelah re-grant, lock timeout →
  row durable tetap pending lalu resume 5/5.
- **X06 (bounds)**: limit config 2 menolak stage 3 row, batch oversized ditahan
  tanpa write, config invalid fail closed, key hilang → default 1000; pure test
  menolak 0/negatif/pecahan/teks/>2147483647.
- **M03/A01/A04**: history/revision immutable + audit `PRICE_CHANGE_*` per row,
  grants `prices:view/edit` + products view-all pada stage/apply/read/kandidat,
  dan penolakan 403 pada API + redirect `/admin/no-access` untuk admin tanpa
  grant (E2E).
- **D02**: schema shared package, `timestamptz`, generated SQL direview (hanya
  `price_change_apply_request` + FK/index), FK RESTRICT, seed-cleanup FK-ordered,
  dan re-seed pada DB disposable berhasil.

### Batas / gap yang tidak diklaim

- **Red-before-green tidak direkam terpisah** untuk test yang ditulis lane
  implementer (tanpa shell); suite DB baru berada dalam keadaan blocked/skip
  sebelum tabel di-push, lalu green setelah push. Perilaku baru diverifikasi
  lewat run green di atas, bukan klaim red yang tidak dijalankan.
- **Revoke sebelum request** mengembalikan `403 DENIED` (halt tercatat dan
  terbaca oleh viewer yang masih berwenang), sedangkan revoke di tengah chunk
  mengembalikan `202` + `haltReason`. Ini pembacaan kontrak yang dipilih agar
  semantics ticket 03 (`DENIED`) tetap berlaku.
- **Shortcut persen untuk SKU/source yang tidak resolvable** menolak seluruh
  batch `400 INPUT_INVALID` karena CHECK schema ticket 03 mewajibkan target fixed
  positif pada row `set_price`; row target fixed/restore untuk SKU tak dikenal
  tetap di-stage dan gagal per row. Perubahan schema untuk melonggarkan ini tidak
  dilakukan.
- **Parser/validator workbook, template, export/report `.xlsx`, fatal-file
  handling** adalah ticket 05 dan tidak diklaim selesai di sini. Endpoint detail
  batch (paginasi + filter `state`) sudah menyediakan data yang dibutuhkan 05.
- **Batas 25 row/5 detik adalah batas konfigurasi**, bukan SLA/benchmark; jumlah
  row per chunk bisa lebih kecil bila budget waktu habis.
- Batch demo bulk seeded tidak punya layar daftar batch (hanya dapat dibuka lewat
  id/SQL); nilai demo rendah sampai report/list ticket 05 ada.
- Standard `npm run test:e2e` live-provider **tidak dijalankan** (butuh izin
  provider terpisah); yang dijalankan adalah isolated mock config. UAT staging,
  aktivasi gate `1` di environment operasional, rehearsal migration/rollback,
  dan release tetap gate ticket 13/izin terpisah.
