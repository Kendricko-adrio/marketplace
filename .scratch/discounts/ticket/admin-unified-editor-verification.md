# Checkpoint implementasi editor diskon terpadu

Referensi: [complete spec yang disetujui](../plan/admin-discounts-unified-editor-spec.md).
Ini catatan verifikasi, bukan implementation ticket breakdown. Status plan hanya
ada di [index fitur](../index.md).

## Approval dan batas pekerjaan

Pengguna meminta implementasi complete spec. Tidak ada izin subagent, commit,
push, remote, deployment, atau E2E live. Ketika migration generated ditemukan
menggabungkan perubahan Harga paralel dengan kolom draft diskon, pengguna menjawab
**“lanjutkan saja”**; SQL tetap utuh dan direview, bukan diedit manual.

Worktree memiliki banyak perubahan sesi lain. Perubahan store, Harga, provider,
dan dokumen lain tersebut tidak diambil alih. Pada `packages/db/src/seed.ts`,
perubahan sesi ini hanya menambah `draftConfiguration: null` pada draft demo
legacy; pekerjaan HQ seeder existing dipertahankan.

## Implementasi yang tersedia

1. `packages/db/src/discount-draft.ts`: kontrak snapshot v1, parser strict yang
   membangun object baru, normalisasi field kosong/canonical code/angka exact,
   serta kelengkapan publish terpisah dari validitas draft parsial.
2. `packages/db/src/schema/discounts.ts`: JSONB nullable pada revision, discriminator
   v1/object dan batas 256 KiB. Published projection existing tidak dilonggarkan.
3. `apps/admin/src/features/discounts/discount-editor-contracts.ts`: DTO detail,
   command save/publish, review, changes, dan versions.
4. `apps/admin/src/features/discounts/discount-configuration-repository.ts`:
   bounded transaction, actor/role Current Policy, request-key advisory lock,
   Offer lock, snapshot persistence, materialisasi publish, audit dan receipt.
   Konflik hash hanya menserialisasi request. Pengambilan detail viewer
   menghilangkan seluruh proposal/perubahan kode, bukan hanya literal live.
5. `apps/admin/src/features/discounts/discount-configuration-policy.ts`: reuse
   authorizer existing; archived terminal; mutasi session juga memeriksa izin.
6. Operation services `save-discount-configuration-service.ts`,
   `review-discount-configuration-service.ts`, dan
   `publish-discount-configuration-service.ts`: save atomik tanpa mengubah live,
   review lengkap server-side, publish atomik dengan pemeriksaan ulang izin
   kapasitas/usage/fingerprint/kode. Snapshot order/usage tidak direset.
7. `apps/admin/src/app/admin/discounts/[id]/discount-number-format.ts`: parsing
   uang/persen Indonesia dan formatting canonical tanpa floating point. Ini
   helper murni; **belum disambungkan ke kontrol input atau form**.
8. Dokumentasi fondasi pada `docs/features/discount-administration.md`,
   `docs/architecture/database.md`, dan entry `docs/README.md`.

### Pemakaian ulang / refinement teknis

- `apps/admin/src/lib/discounts-administration.ts` hanya mengekspor helper gate,
  authorizer, detail projection, dan mapper DB existing untuk reuse repository;
  tidak ada operasi baru ditumpuk ke God Service legacy. Error descriptor
  mendukung `fieldErrors` opsional. Mapper HTTP belum disambungkan ke field itu.
- Session repository menyediakan `inspectCommitments`, `save`, `publish`, dan
  `recordReceipt`. `buildDiscountConfigurationReview` diekspor dari review service
  untuk dipakai ulang oleh publish di dalam lock yang sama; tidak membuat
  hierarchy service/repository generik.
- Receipt menyimpan metadata tanpa snapshot/literal kode. Replay membaca detail
  canonical terkini, seperti create legacy; efek mutasi/audit tidak diulang.
  Audit menggunakan kode masked; application log tidak memuat snapshot,
  literal, request key, fingerprint, atau pesan SQL mentah.
- Snapshot revision legacy NULL dibaca melalui baseline terms/benefit/capacity
  existing. **Ini fallback read, bukan backfill persisted**.
- `0057_watery_speed.sql` generated oleh pekerjaan paralel ketika schema diskon
  sudah berubah; mencakup kolom/check diskon serta constraint template Harga.
  `npm run db:generate` sesi ini melaporkan tidak ada delta tersisa. SQL generated
  tidak diubah atau dihapus.

## Bukti RED → GREEN dan regresi

Semua SQL/seed run memakai DB PostgreSQL lokal **baru dan disposable**:
`marketplace_discounts_test_unified_editor_20260218`. Nama DB adalah identifier
fixture, bukan tanggal hasil pengujian. Default DATABASE_URL tidak dipakai untuk
mutasi. DB operasional tidak diubah.

| Gate | Hasil / log di direktori temp Git Bash |
|---|---|
| Tracer parser RED | Missing module, `/tmp/discount-editor-domain-red.log` |
| Parser validation RED | 31 fail / 2 pass, `/tmp/discount-editor-domain-validation-red.log` |
| Parser GREEN | 33 pass, `/tmp/discount-editor-domain-validation-green.log` |
| Formatter RED → GREEN | Missing module → 36 pass, `/tmp/discount-editor-numbers-{red,green}.log` |
| Save tracer RED | Missing service, `/tmp/discount-editor-save-red.log` |
| Publish tracer RED | Missing review/publish services, `/tmp/discount-editor-publish-red.log` |
| Focused backend regression | 6 file / 144 pass, termasuk schema dan administrasi legacy; `/tmp/discount-editor-backend-regression.log` |
| L2 serial unit | **177 file / 2074 pass / 12 skip**, `/tmp/discount-editor-batch-unit.log` |
| L1 recheck setelah cleanup lint | 13 SQL cases pass, `/tmp/discount-editor-final-db.log`; batch sebelumnya tidak diulang |
| L0 admin | PASS, `/tmp/discount-editor-final-types-admin.log` |
| L0 store | PASS, `/tmp/discount-editor-types-store.log` |
| Scoped ESLint | PASS, `/tmp/discount-editor-eslint-final.log`; invocation awal dari root gagal karena config app-local, lalu dijalankan dari `apps/admin` |
| db:check | PASS, `/tmp/discount-editor-db-check.log` |
| Fresh db:push + demo seed | PASS di DB disposable khusus; `/tmp/discount-editor-db-push.log`, `/tmp/discount-editor-seed.log` |
| Rehearsal generated migrations | PASS dari DB kosong terpisah `marketplace_discounts_test_unified_editor_migration_20260218`; `/tmp/discount-editor-migration.log` |
| git diff --check | PASS; `/tmp/discount-editor-diffcheck.log`; warning normalisasi CRLF bukan error |

Batch unit memverifikasi worktree pada saat run, termasuk perubahan paralel yang
ada; bukan klaim kepemilikan atau acceptance atas fitur sesi lain. Dua cleanup
setelah batch: nama variabel fixture `module` menjadi `moduleKey` untuk rule
Next ESLint, dan pemakaian parameter operasi policy melalui validasi enum.
SQL suite 13 kasus dan scoped lint diperiksa ulang setelahnya. Dua typecheck
lulus pada source yang relevan sebelum cleanup tersebut.

SQL cases mengamati:

- save 15%/kuota200 tidak mengubah live10%/kuota100/batas akun1;
- draft parsial dan proposal kode tidak mereservasi kode secara global;
- duplicate submit serial/concurrent tidak menggandakan versi/audit;
- request-key conflict dan stale input tidak menimpa snapshot;
- proposal kapasitas tersimpan tanpa grant kapasitas;
- viewer tidak menerima proposal, edit yang dicabut menolak save;
- audit failure membatalkan snapshot/version/receipt;
- publish terms+capacity+kode bersama dan replay tidak menerbitkan dua kali;
- pencabutan grant kapasitas setelah review menolak publish total;
- race kode pada dua Offer menghasilkan satu pemenang, loser tetap draft;
- status kode tetap live saat save dan baru berubah saat publish;
- publish tanpa perubahan capacity tidak menaikkan policyVersion;
- snapshot versi asing/missing discriminator/array/oversized ditolak DB;
- missing benefit parameter menghasilkan issue field dan publish ditolak.

## Context7 checkpoint

- `/vitest-dev/vitest/v4.1.12` — `test.each` object cases,
  `expect.objectContaining`, dan assertions. Installed Vitest 4.1.10; API yang
  dipakai juga diverifikasi dengan execution tests. Sumber:
  `https://github.com/vitest-dev/vitest/blob/v4.1.12/docs/api/test.md` dan
  `https://github.com/vitest-dev/vitest/blob/v4.1.12/docs/api/expect.md`.
- `/drizzle-team/drizzle-orm/0.45.1` — `jsonb().$type<T>()`, row-lock `.for()`,
  infer select/insert dan conflict API. PostgreSQL signatures/returning/update
  diverifikasi tambahan melalui installed types dan SQL integration tests.
  Sumber: `https://github.com/drizzle-team/drizzle-orm/blob/0.45.1/changelogs/drizzle-orm/0.28.3.md`.
- Parser/formatter murni tidak menambah external API surface. BigInt memakai
  constructor, bukan literal `n`, karena target admin ES2017.

## Discovery yang sudah diperiksa

- Caller writer policy/kode ditemukan pada editor existing, tiga routes writer,
  fixtures `e2e/admin/discounts-prototype-mock.spec.ts`, dan DB tests administrasi/
  operations. Pencarian pada `apps`, `packages`, `e2e`, `scripts` tidak menemukan
  script/integrasi production lain; ini tidak membuktikan tidak ada consumer
  eksternal di luar repo.
- History existing punya limit bounded, bukan pagination lengkap:
  `apps/admin/src/lib/discount-operations-read.ts:524–579`. Tidak menambah
  kontrak pagination history pada slice ini.
- Topologi cutover mengikuti `docs/deployment-docs/discounts-cutover.md`:
  paired images + maintenance + migration. Tidak ada env/port/domain/cron baru
  pada fondasi ini. Rehearsal DB kosong bukan rehearsal rollback aplikasi lama.

## Yang belum selesai — jangan tandai Done

1. Backfill snapshot draft existing secara persisted dan rehearsal kompatibilitas
   rollback aplikasi dengan data representatif. Fixtures seed untuk seluruh
   state editor baru juga belum dibuat.
2. Adaptasi create/list/detail/simulation dan DTO publik; gate/permissions
   existing tetap dipertahankan. HTTP error `fieldErrors` perlu wiring.
3. Cutover save/review/publish routes bersama caller first-party; writer policy/
   kode lama **belum 410**. Jangan memakai service baru operasional selama writer
   legacy masih aktif karena projection draft keduanya berbeda.
4. List terpadu dan dialog create; editor state/reducer, section Pengaturan/Kode,
   global actions, review UI, simulasi, monitoring/history, number input, dan
   unsaved/navigation guard. Formatter belum membuktikan caret/paste kontrol.
5. Seluruh mock E2E dan render/keyboard/viewport/cross-page UX review. Tidak ada
   perubahan rendered UI pada checkpoint ini, maka tidak ada klaim frontend
   completion. Tidak menjalankan legacy `npm run test:e2e` tanpa izin terpisah.
6. Tambahan DB coverage untuk commitment update saat publish, per-client
   commitment, revoke serialization, paused/archived/scheduled matrix, serta
   failure injection publish sesudah seluruh materialisasi. Existing full
   regression pass tidak menggantikan acceptance kasus baru tersebut.

Urutan kelanjutan tetap spec §14: lengkapi discovery/backfill dan hardening
backend; sambungkan kontrak HTTP + UI secara terkoordinasi, baru hentikan writer
lama. Scope produk tidak diubah; tidak ada implementation tickets diterbitkan.
