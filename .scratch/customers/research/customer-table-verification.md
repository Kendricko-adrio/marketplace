# Verifikasi tabel Customer — 2026-11-03

## Ringkasan

Implementasi scope yang disetujui sudah tersedia: pola card/search/table/footer Branches,
pagination server-side 10 row, search seluruh customer, summary global, dan detail link.
Tidak ada perubahan schema, env deployment, halaman Branches, atau aturan RBAC.
Gate batch seluruh repo belum hijau; status plan tetap **In Progress**, bukan Done.

## RED → GREEN dan pemeriksaan

| Gate | Hasil aktual | Evidence |
|---|---|---|
| Repository RED pertama | Modul belum ada, test gagal import | `%TEMP%/customers-red.log` |
| Repository paging GREEN | 1 test passed | `%TEMP%/customers-green1.log` |
| Repository search/summary RED | 2 failed, 2 passed: search belum diterapkan dan summary export belum tersedia | `%TEMP%/customers-red2.log` |
| Repository GREEN | 4 tests passed | `%TEMP%/customers-green2.log` |
| Route RED | Route belum tersedia, gagal import | `%TEMP%/customers-route-red.log` |
| Route GREEN | 5 tests passed | `%TEMP%/customers-route-green.log` |
| UI RED | Belum ada paged rows dengan aksi `Lihat detail` | `%TEMP%/customers-ui-red4.log` |
| L0 final | `npm run verify:types:admin` lulus | `%TEMP%/customers-types-final.log` |
| Lint terfokus | 0 error, 0 warning pada tujuh file TS/TSX implementasi/test Customer | `%TEMP%/customers-lint-final.log` |
| Mock E2E | Seluruh 7 test unik lulus melalui initial run dan focused recheck; tidak mengklaim satu run all-green | `%TEMP%/customers-ui-expanded.log`, `%TEMP%/customers-ui-recheck.log`, `%TEMP%/customers-ui-auth.log` |
| Recheck race setelah cleanup disempurnakan | 1 passed | `%TEMP%/customers-race-final.log` |
| Discovery canonical config | 7 tests in 1 file, kedua testMatch sudah mencakup spec | `%TEMP%/customers-discovery.log` |
| L2 batch unit | **Gagal**: 164 file passed, 10 failed, 3 skipped; 1918 tests passed, 1 failed, 48 skipped | `%TEMP%/customers-batch-unit.log` |
| Legacy full E2E / L3 | Tidak dijalankan; perlu izin terpisah, tidak ada commit/PR | — |

Unit test Customer juga tercakup pada batch unit; tidak ada kegagalan Customer.

## Penyebab kegagalan yang diperiksa

- Sembilan suite berhenti pada setup karena `DATABASE_URL` menunjuk database lokal
  `storefront`, bukan database disposable `marketplace_discounts_test_*` yang diwajibkan
  suite discount/checkout. Tidak mengubah guard keselamatan, env, atau membuat/reset DB.
- `packages/db/src/rbac/seed-roles-integration.test.ts:149` mengharapkan branch HQ lokal
  (`name/code HQ`, `jubelioLocationId null`), tetapi database lokal masih menempatkan
  HQ manager pada cabang operasional. Seeder/test terkait sudah mempunyai perubahan
  worktree di luar tugas Customer. Tidak memperbaiki atau mengklaim baseline suite hijau.
- Dua kegagalan awal pada E2E tambahan berasal dari assertion harness: `getByRole('alert')`
  juga memilih Next route announcer, dan tombol pagination mobile berada di bawah fold.
  Perbaikan terbatas pada locator alert berisi pesan dan scroll ke tombol sebelum assertion
  viewport. Tidak mengubah UI untuk memenuhi assertion yang keliru.
- Assertion summary awal memakai `innerText` tetapi matcher membaca textContent;
  sumber snapshot pembanding disamakan ke textContent. Nilai summary tidak berubah.

## Isolasi runner dan fixture

- Port canonical mock 3112 sedang digunakan proses lain. Tidak menghentikan atau reuse
  server tersebut dan tidak mengubah kebijakan isolation pada tracked config.
- Verifikasi memakai config sementara gitignored `playwright/customers-run.config.ts`,
  mengimpor canonical config, memakai admin loopback port 3311 dengan env mock yang sama,
  dan menjalankan admin dev server sendiri tanpa store/Jubelio server yang tidak diperlukan
  oleh direktori read-only. Provider bases tetap loopback; tidak ada provider write.
- Command verifikasi: `npx playwright test --config=playwright/customers-run.config.ts`,
  dilanjutkan `--grep 'distinguishes|matches Branches'`, `--grep 'denies branch|opens an existing'`,
  dan focused recheck `--grep 'shows loading'` setelah cleanup fetch diperbaiki.
- Spec tracked tetap dapat dijalankan lewat `npm run verify:batch:e2e -- e2e/admin/customers-pagination-mock.spec.ts`
  ketika port canonical tersedia. Spec menerima port 3111 atau alternatif 3311, dengan
  `E2E_PROVIDER_MOCKS=true` dan hostname loopback.
- UI pagination memakai 23 row sintetis di HTTP boundary. API nyata juga diuji terpisah
  dengan 23 row `client` fixture di PostgreSQL lokal, ID run-unique, email `.test`, tanpa order,
  tanpa modifikasi customer existing. Cleanup menghapus hanya ID milik run di `finally`.
- Coverage API nyata: 10/10/3, stable ID order untuk timestamp sama, tidak ada ID duplikat,
  search email case-insensitive/telepon/literal `%_`, out-of-range page, dan anonymous 401.
- Coverage akses tambahan: branch admin mendapatkan API 403 dan page no-access; cookie
  sesi sementara dibersihkan untuk memastikan 401 UI kembali melalui page guard/login.

## Review UX dan scope

Main agent membaca render Chromium sehat (bukan screenshot attachment failure):

- `playwright/mcp/customers-table/branches-desktop.png`
- `playwright/mcp/customers-table/customers-desktop.png`
- `playwright/mcp/customers-table/customers-mobile.png`

Pada desktop 1440×900, card header/search/border dan header typography/padding/height
selaras dengan Branches. Customer tetap memiliki header/summary existing dan avatar
sesuai kontrak. Pada mobile 390×844, tidak ada page-level horizontal overflow; tabel
memiliki horizontal scroll dan pagination dapat dijangkau dengan vertical scroll normal.
Layout sidebar/summary yang panjang merupakan pola existing dan tidak di-redesign.

Task yang diverifikasi: next/previous, batas page, search lintas page/reset ke page 1,
loading dan disabled navigation, stale response, keyboard focus ke detail, empty/no-match,
error/retry, summary tidak berubah, auth denial/session expiry, dan detail/order history.
Review tidak mengklaim kepatuhan WCAG penuh atau usability testing dengan pengguna.

## Context7 dan sumber

- `/vercel/next.js/v16.2.9`: GET handler, NextRequest query params, JSON dan default uncached.
- `/reactjs/react.dev`: effect cleanup untuk mengabaikan response fetch lama.
- `/drizzle-team/drizzle-orm-docs`: count/sql-mapWith, groupBy, limit/offset.
- `/vitest-dev/vitest`: hoisted async module mocks.
- `/microsoft/playwright`: route/fulfill dan HTTP boundary mocking.
- `/websites/node-postgres`: parameterized `pool.query(text, values)` dan `pool.end()`
  untuk fixture sementara; nilai fixture tidak diinterpolasi ke SQL.
- Installed source Next.js `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route.md`
  dan Drizzle node-postgres executor diperiksa untuk kontrak route/result decoder.

## Tindak lanjut

Gate yang masih terbuka: jalankan batch unit pada database disposable yang sudah disiapkan
sesuai kontrak seeding terbaru. Jangan reset database lokal atau menjalankan legacy full
E2E tanpa izin. Tidak ada commit, push, remote access, atau deployment pada tugas ini.
