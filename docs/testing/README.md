# Testing

Unit and E2E test infrastructure for the marketplace monorepo.

| Tool | Covers | Config |
|---|---|---|
| **Vitest** | Unit tests (pure logic + stateful Jubelio mock contract) | `vitest.config.ts` (root workspace → per-package configs) |
| **Playwright Test** | Automated E2E (login flow, authenticated smoke) | `playwright.config.ts` + `e2e/` |

Run everything from the repo root.

## Lokasi output Playwright

Seluruh report dan dump browser sementara berada di `playwright/` pada root
repo. Folder ini di-ignore Git; config dan test specs tetap tracked.

| Output | Lokasi |
|---|---|
| HTML report standard / mock | `playwright/reports/default/` / `playwright/reports/mock/` |
| Error context Markdown, trace, screenshot, video standard / mock | `playwright/results/default/` / `playwright/results/mock/` |
| Dump manual agent / Playwright MCP | `playwright/mcp/` (boleh subfolder per run) |
| Blob atau custom report opsional | `playwright/blob/<run>/` atau `playwright/reports/<run>/` |
| Hasil lama yang asal standard/mock-nya tidak dapat dipastikan | `playwright/results/legacy/` |

Config standard dan mock menggunakan `outputDir` terpisah agar cleanup hasil
satu mode tidak menghapus hasil mode lainnya. Run bersamaan dalam mode yang
sama tetap membutuhkan `--output=playwright/results/<run>` dan reporter output
terpisah; pemisahan ini tidak mengizinkan berbagi fixture DB antar run.

```bash
npm run test:e2e:report       # HTML standard
npm run test:e2e:report:mock  # HTML mock
npm run test:playwright-artifacts  # regression config/path, tanpa browser/DB/server
```

Jika memakai blob/custom reporter, arahkan output-nya ke lokasi pada tabel;
izin menjalankan suite tetap mengikuti aturan testing/provider yang berlaku.
`--reporter=line` tidak menghasilkan HTML
report baru, jadi report HTML existing bukan bukti run terbaru.

Playwright MCP pada `.pi/mcp.json` menggunakan `--output-dir playwright/mcp`
untuk output dengan nama otomatis. **Filename eksplisit relatif terhadap root
workspace**, bukan output-dir: misalnya gunakan
`playwright/mcp/discounts-review/snapshot.md`, bukan `snapshot.md` di root.
Perubahan konfigurasi MCP berlaku setelah server dimulai ulang/reconnect pada
sesi berikutnya; untuk server yang masih aktif, selalu berikan path eksplisit
terpusat. Jangan force-add dump. Simpan ringkasan bukti yang perlu bertahan di
`docs/` atau `.scratch/<feature>/`, bukan mengandalkan artifact yang bisa tertimpa.

Storage state `e2e/.auth/` dan raw stdout logging fixture di temporary directory
sistem mempertahankan kontrak existing; keduanya bukan folder report baru di
root repo. Saat Playwright gagal, diagnosis dari Markdown/teks, bukan gambar.

Referensi API yang dikonfirmasi melalui Context7: `/microsoft/playwright`
([outputDir](https://playwright.dev/docs/api/class-testconfig#test-config-output-dir),
[HTML outputFolder](https://playwright.dev/docs/test-reporters#html-reporter),
[show-report](https://playwright.dev/docs/test-cli#show-report)) dan
`/microsoft/playwright-mcp`
([output-dir dan filename eksplisit](https://github.com/microsoft/playwright-mcp#configuration)).

## Mock-only pickup lifecycle (delivery implementation ticket 01)

Run `npx playwright test --config=playwright.mock.config.ts` against a disposable,
seeded local database. This isolated config starts fresh store/admin/mock servers
on ports 3110/3111/3112, refuses server reuse, disables live Sales test-account
opt-in, uses fake provider credentials and suppresses real SMTP. Do not run it
concurrently with another checkout suite sharing the same customer cart.

`E2E_PROVIDER_MOCKS=true` plus `JUBELIO_SALES_MOCK_API_BASE_URL` enable an
explicit **bare HTTP loopback-only** Sales gateway seam. Invalid URLs fail closed
without a live fallback. The seam is forbidden when APP_ENV or NODE_ENV is
production; never set these E2E variables in staging/production deployments.
Normal production and isolated live-test write gates are unchanged. During this
E2E run, Next config preserves externally supplied app URLs instead of overriding
them from `.env.local`.

`e2e/store/pickup-mock.spec.ts` exercises real local HTTP + browser checkout,
verified Midtrans/SO settlement and single-use Home Branch pickup; invoice timeout
remains paid-but-blocked without a pickup code. Independent amounts are goods
Rp100,000, website/Midtrans Rp111,000 (11% PPN), SO/invoice/Jubelio payment
Rp100,000 (zero SO tax/discount). This verifies application behavior with mocks,
not live provider behavior or operational delivery activation. The legacy
`playwright.config.ts` checkout suite still uses the real isolated Jubelio account
and must not be run without separate write authorization.

**Fixture secret (mock-only).** Konfigurasi mock ini memberikan
`BETTER_AUTH_SECRET` **deterministik khusus test** yang sama ke webServer store
dan admin (konstanta `MOCK_SHARED_AUTH_SECRET`, ≥32 karakter). Alasannya:
`verify-pickup` di admin menandatangani panggilan HMAC ke endpoint internal store
`/api/internal/order-complete` memakai secret tersebut, sementara route store
gagal-tertutup (`403 Unauthorized`) bila variabel itu tidak ada. Login Better Auth
tetap berhasil di dev lewat fallback bawaan library, sehingga kegagalan pickup
sebelumnya adalah masalah **wiring env test**, bukan bug pricing/RBAC. Nilai ini
hanya fixture: tidak berasal dari secret developer, tidak pernah di-log, dan tidak
boleh disalin ke konfigurasi staging/production. Dua instance Better Auth tetap
terpisah (cookie, tabel, dan guard masing-masing); hanya nilai signing bersama ini
yang dipasok. Tidak ada perubahan env production/deployment.

## Mock-only delivery acceptance

The same isolated config includes address/default ownership, branch origin, server quote and reprice approval, immutable placement/repayment, packing/ambiguous booking, handoff/signed tracking/customer privacy and scoped follow-up/manual resolution. Final implementation verification: **22/22** browser/HTTP cases; full serial unit run **106 files / 953 passed / 2 skipped**. The two skips are `skipIf(schemaState.ready)` infrastructure-failure sentinels; PostgreSQL-dependent acceptance tests ran, not skipped.

Use `npm run test:unit -- --no-file-parallelism` to avoid shared RBAC-fixture races. Tracking has an independently computed fixed HMAC fixture, concurrent event regressions and real-PG lifecycle assertions. Follow-up covers current Home/ledger guards, zero create on release, one proof-approved attempt-2 create and system-only known-ID GET settlement recovery. Never treat mock success as courier/dashboard/deployment activation. See [delivery lifecycle](../features/home-delivery.md).

## Regression stok storefront (mock-only)

`e2e/store/stock-visibility-mock.spec.ts` menguji seam HTTP dan browser:
stok nol/null/pending, quantity kumulatif dan request konkuren, cabang
nonaktif/mapping hilang, harga dan pagination katalog, kombinasi warna/ukuran,
homepage manual/filter, serta item cart lama saat stok habis. Fixture SQL hanya
menyiapkan data di DB disposable `marketplace_discounts_test_*`; assertion
memakai API/UI, bukan query database.

```bash
DATABASE_URL=<db-disposable> npm run verify:batch:e2e -- e2e/store/stock-visibility-mock.spec.ts
npm run verify:unit:slice -- apps/store/src/lib/stock.test.ts
npm run verify:types:store
```

Mode `E2E_PROVIDER_MOCKS=true` memakai `distDir: ".next/mock"` pada kedua app
agar tidak berbenturan dengan lock/output dev server biasa. Typegen mock
disertakan dalam tsconfig. Build/deployment default tetap `.next`; tidak ada
env baru atau perubahan provider live.

## Baseline checkout berversi (disposable)

Bagian ini hanya untuk database **disposable**. Selalu set `DATABASE_URL`
eksplisit; jangan mengandalkan DB default dan jangan memakai DB staging/production.

```bash
# ganti <db_disposable> dengan database sekali pakai milik run ini
export DATABASE_URL="postgresql://postgres:postgres@localhost:5432/<db_disposable>"
npm run db:push            # skema development (JANGAN db:migrate di dev)
SEED_MODE=demo npm run db:seed
```

Gate `discounts.contractVersion` ditulis seeder sebagai baris **eksplisit** dengan
value `0` (system config, kedua `SEED_MODE`); baris yang absen tetap dibaca legacy
`0`. Test gate `1` wajib menyetel nilai sendiri lalu mengembalikannya ke `0` pada
cleanup, dan hanya boleh berjalan di DB disposable di atas.

Ladder yang dipakai untuk slice ini (path test disesuaikan dengan file yang
benar-benar ada di worktree):

```bash
npm run verify:types:store
npm run verify:types:admin
npm run verify:unit:slice -- apps/store/src/lib/versioned-pricing.test.ts \
  apps/store/src/lib/delivery-quote.test.ts
npm run verify:unit:slice -- apps/store/src/lib/jubelio-sales-client.test.ts \
  apps/store/src/lib/jubelio-sales-settlement.test.ts
npm run verify:batch:unit
npm run verify:batch:e2e -- e2e/store/versioned-checkout-mock.spec.ts
```

Spec mock baru **wajib** ditambahkan ke `testMatch`
[`playwright.mock.config.ts`](../../playwright.mock.config.ts) pada perubahan yang
sama; tanpa itu `verify:batch:e2e` menyaring spec tersebut keluar dan run hijau
bukan bukti apa pun. Periksa regex-nya memuat `versioned-checkout` sebelum
menganggap perintah di atas benar-benar menjalankan spec itu. Untuk regresi legacy,
jalankan hanya spec yang terdampak, mis. `e2e/store/pickup-mock.spec.ts` dan
`e2e/store/delivery-order-mock.spec.ts`.

Aturan bukti:

- Skip/infrastructure blocker **bukan** lulus; laporkan sebagai blocked dengan
  alasan, jangan dihapus atau diganti `skipIf` tanpa keputusan reviewer.
- Jangan rerun suite yang sudah lulus tanpa perubahan source/fixture terkait;
  catat baris ringkasannya sebagai evidence.
- `npm run test:e2e` (legacy) memuat live-provider writes dan **butuh izin
  terpisah**; mock pass tidak menggantikannya.
- Bila Playwright gagal, baca report Markdown/teks saja; jangan membuka `.png`.

## Checkout review, request key, dan admission (disposable)

Ticket 02 menguji review token/fingerprint, replay request-wide, recovery
sesudah response hilang, dan admission rate-limit berbasis PostgreSQL. Sama
seperti suite berversi: **hanya DB disposable** dengan `DATABASE_URL`
eksplisit dan nama database berawalan `marketplace_discounts_test_*`. Fixture
menaikkan `discounts.contractVersion` ke `1` dan mengembalikannya pada cleanup.

```bash
npm run verify:types:store
DATABASE_URL=<db-disposable> npm run verify:unit:slice -- \
  packages/db/src/checkout-request.db.test.ts \
  apps/store/src/lib/checkout-admission.db.test.ts \
  packages/db/src/seed-cleanup.test.ts
DATABASE_URL=<db-disposable> npm run verify:batch:e2e -- \
  e2e/store/checkout-review-mock.spec.ts
  e2e/store/markdown-mock.spec.ts
DATABASE_URL=<db-disposable> npm run verify:batch:e2e -- \
  e2e/store/versioned-checkout-mock.spec.ts \
  e2e/store/versioned-settlement-mock.spec.ts
```

`checkout-review-mock.spec.ts` mencakup token tamper/expired/context berubah,
parallel same-key (satu order, satu SO), status 201/200/202, rollback receipt,
failure injection pada batas transaksi dan claim eksternal, delivery reapproval
walau total turun, owner 404, UI recovery setelah response hilang, serta
admission 429/`Retry-After` termasuk forged `X-Real-IP`/`X-Forwarded-For`.
`E2E_CHECKOUT_ADMISSION_NOW` dan `CRON_SECRET` adalah fixture pada
`playwright.mock.config.ts` dan tidak dipakai produksi. Spec
`versioned-checkout`/`versioned-settlement` kini memakai preview+token karena
gate1 mewajibkan review. Bukti ini **bukan** redemption/capacity ticket 07/12.

## Pemulihan UX Diskon Admin sesuai prototype

Spec `e2e/admin/discounts-prototype-mock.spec.ts` mencakup tab/filter/pagination,
revision/benefit dan kapasitas tersedia, empat tab detail dan input lintas tab,
create sesuai jalur, viewer masked/read-only, audit before/after, dialog
review/publish/cancel/fokus, invalid/failure/pending publish, conflict policy,
request-race serta overflow mobile. Endpoint aplikasi + PostgreSQL nyata tetap
dipakai; hanya failure/pending/race HTTP dikontrol pada browser boundary.

Jalankan dengan `DATABASE_URL` disposable `marketplace_discounts_test_*` dan
konfigurasi mock-only; fixture/gate dipulihkan lewat cleanup FK-ordered. Jangan
memakai DB dev/operasional. Spec terdaftar pada kedua `testMatch` konfigurasi.

```bash
npm run verify:batch:e2e -- e2e/admin/discounts-prototype-mock.spec.ts \\
  e2e/admin/discounts-admin-mock.spec.ts e2e/admin/discounts-usage-mock.spec.ts
npm run verify:unit:slice -- apps/admin/src/lib/discounts-administration.db.test.ts
```

Regression existing tetap mencakup fixed/percentage/shipping/manual code,
aggregate-only, scope cabang, dan pause tanpa reset hold. Service list diuji
melalui `listDiscountOffers` untuk filter sebelum pagination, count kedua
jalur, shipping revision, quota/budget literal, projection hilang dan privacy.
Standard `test:e2e`/provider live masih memerlukan izin tersendiri; mock green
bukan bukti UAT staging atau aktivasi rilis.

## Discount Offer administration (disposable)

Slice ticket 06 menguji lifecycle Offer publik fixed-goods. Sama seperti suite
berversi di atas: **hanya DB disposable** dengan `DATABASE_URL` eksplisit dan
nama database berawalan `marketplace_discounts_test_*`. Gate
`discounts.contractVersion` dinaikkan ke `1` oleh fixture dan dikembalikan ke
`0` pada cleanup.

```bash
npm run verify:types:admin
npx vitest run apps/admin/src/lib/discounts-administration.test.ts
DATABASE_URL=<db-disposable> npx vitest run \
  apps/admin/src/lib/discounts-administration.db.test.ts \
  packages/db/src/discount-schema.db.test.ts \
  packages/db/src/seed-cleanup.test.ts
DATABASE_URL=<db-disposable> npm run verify:batch:e2e -- \
  e2e/admin/discounts-admin-mock.spec.ts
  e2e/admin/price-change-mock.spec.ts
```

Spec E2E itu mencakup create/replay/detail lewat HTTP, penolakan
`INPUT_INVALID`, dan alur UI lengkap (buat draft → simpan terms → kapasitas →
simulasi → review → publish → pause). `discounts-admin` sudah terdaftar pada
kedua `testMatch` di `playwright.mock.config.ts`; bila regex diubah, alur UI di
atas berhenti menjadi bukti. Bukti ini **bukan** redemption/reserve race
(ticket 07/12) dan bukan aktivasi gate produksi.

## Usage, privacy, dan kapasitas (ticket 12, disposable)

Suite ini memakai database disposable yang **sudah di-seed** untuk branch/client
nyata, lalu membuat ledger Redemption run-unique (order + redemption + event +
allocation) melalui SQL setup. Semua assertion kapasitas/privacy lewat interface
read/mutation publik; SQL hanya untuk fixture, drift yang disengaja, dan probe
constraint retensi.

```bash
npm run verify:types:admin
npx vitest run apps/admin/src/lib/discount-operations-read.test.ts
DATABASE_URL=<db-disposable> npx vitest run   apps/admin/src/lib/discount-operations-read.db.test.ts
DATABASE_URL=<db-disposable> npm run verify:batch:e2e --   e2e/admin/discounts-usage-mock.spec.ts
```

- `discount-operations-read.db.test.ts`: agregat global consumed/held/available
  (quota100/budget100000 + ledger nyata), aggregate-only tanpa `orders:view`,
  scope Jakarta vs Bandung/Surabaya (direct id 404, branchId asing 403, page/count
  tidak melebarkan), masking kode di detail/usage/history, atribusi aktor setelah
  FK user NULL, penurunan `perClientLimit` vs komitmen per akun, serialisasi
  policy di belakang commit reservasi, drift fail-closed + pause aman, rename/
  email/code change tidak mereset usage, dan constraint retensi/reuse literal.
- `discounts-usage-mock.spec.ts`: persona HQ (editor), viewer tanpa Orders, dan
  viewer Orders own-branch Jakarta; navigasi daftar → detail → tautan order →
  histori, plus pause aman yang tidak mengubah entry/availability.
- File DB admin memakai gate `discounts.contractVersion`; jalankan suite DB
  admin **serial** (satu file per proses) karena key config dipakai bersama.

## Coupon publik pickup dan lifecycle Redemption (disposable)

Slice ticket 07 menguji picker Coupon, reservasi atomik di place-order, dan
lifecycle paid/consume/release. Real PostgreSQL (disposable) untuk race dan
constraint; Playwright mock untuk UI/HTTP nyata. Gate
`discounts.contractVersion` dinaikkan fixture E2E ke `1` dan dikembalikan pada
cleanup.

```bash
npm run verify:types:store
npx vitest run packages/db/src/discount-eligibility.test.ts \
  packages/db/src/discount-pricing.test.ts \
  apps/store/src/lib/checkout-review.test.ts \
  apps/store/src/lib/promo-replacement.test.ts
DATABASE_URL=<db-disposable> npx vitest run \
  packages/db/src/discount-redemption-schema.db.test.ts \
  apps/store/src/lib/discount-availability.db.test.ts \
  apps/store/src/lib/discount-selection.db.test.ts \
  apps/store/src/lib/discount-reservation.db.test.ts \
  apps/store/src/lib/discount-lifecycle-flow.db.test.ts
DATABASE_URL=<db-disposable> npm run verify:batch:e2e -- \
  e2e/store/discounts-coupon-mock.spec.ts
```

`discount-reservation.db.test.ts` membuktikan dua akun berebut kuota/budget
terakhir, satu akun berebut jatah 1/2, reservasi serial terhadap pause,
consume/release tepat sekali, late-paid review tanpa reacquire kapasitas, dan
rollback penuh. `discount-lifecycle-flow.db.test.ts` membuktikan jalur public
`claimPaidOrder`/confirmed cancel/definitive rejection/late settlement.
`discounts-coupon-mock.spec.ts` mencakup picker + disabled reason, total review
(138750), place order (Redemption reserved + allocation + provider
`disc_amount` 25000/amount 125000), order detail, dan paid-but-blocked. Sejak
ticket 08 spec yang sama juga membuktikan:

- penggantian Coupon 25000→10000 membuka dialog total lama 138750 / baru 155400 /
  selisih 16650; Batal mempertahankan pilihan & total lama, konfirmasi
  mengirim `acknowledgements.promoIncrease.candidateFingerprint` yang sama dengan
  fingerprint token, dan order tersimpan dengan total 155400;
- penggantian ke benefit lebih besar (155400→138750) langsung diterapkan tanpa
  dialog;
- Offer yang dipause setelah review memunculkan invalidation notice, menolak
  preview berikutnya (tanpa order), dan "Lanjut tanpa promo" eksplisit
  menghasilkan token `cwo` + order tanpa diskon total 166500;
- kandidat yang gugur (paused setelah daftar dimuat) tidak mengganti pilihan
  lama, dan kuota yang habis saat commit menjawab 409
  `PROMO_CAPACITY_UNAVAILABLE` tanpa order, Redemption, atau stock hold parsial;
- perubahan selection (quantity 1→2) setelah review membatalkan approval lama:
  preview penggantian menjawab 409 `CHECKOUT_REVIEW_REQUIRED`, kembali ke langkah
  kontak tanpa total berdiskon palsu, lalu review baru memakai konteks terbaru
  (qty2 + Coupon 10000 → 321900) tanpa dialog;
- replay `requestKey` mengembalikan order yang sama, sedangkan acknowledgement
  berbeda pada key yang sama menjawab 409 `REQUEST_KEY_CONFLICT`; replay setelah
  Offer dipause tetap order/total tersimpan (bukan reprice).

Kedua `testMatch` di `playwright.mock.config.ts` wajib memuat `discounts-coupon`.
`discounts.contractVersion` tetap `0` pada seed; fixture E2E yang membukanya
untuk DB disposable. Bukti ini bukan UAT staging/rollout ticket 13.

## Percentage goods dengan cap opsional (ticket 10)

Benefit `percentage_goods` memakai seam yang sama dengan fixed goods:
`packages/db/src/discount-pricing.test.ts` membuktikan literal cap/uncapped/
floor/fraction/tie/qty2 (450000×10% cap20000 → 20000/430000/47300/477300; tanpa
cap → 45000/405000/44550/449550; 100005×10% → floor10000; 50×1% → 0) dan guard
rate/cap/precision. `discount-eligibility.test.ts` membuktikan nominal aktual
yang sama dipakai untuk budget/per-account. Real PG:
`discounts-administration.db.test.ts` (draft percentage rate10 cap20000 → review
→ simulasi → publish, rate 7 digit ditolak), `discount-selection.db.test.ts`
(kandidat membawa `{rate,capAmount}`), dan `discount-reservation.db.test.ts`
(benefit 20000 direservasi, `terms_snapshot`/`result_snapshot` menyimpan bentuk
benefit, allocation `offer_goods` 20000, consume memakai nominal itu). Mock
E2E: `discounts-admin-mock` (form persentase → simulasi 149850 → review) dan
`discounts-coupon-mock` (picker menampilkan `Diskon 10% (maks Rp 20.000)`,
place order menyimpan benefit15000/allocation15000, provider `disc_amount`
15000 whole-line). Ini bukan bukti pembayaran/provider Rp0; kombinasi manual+
percentage diuji pada ticket 13.

## Regresi cross-slice dan kesiapan rilis (ticket 13)

Setelah seluruh slice tergabung, kombinasi yang tidak dimiliki satu ticket pun
diuji pada seam publik yang sama:

```bash
npm run verify:types:store
DATABASE_URL=<db-disposable> npx vitest run \
  apps/store/src/lib/discounts-integration.db.test.ts
DATABASE_URL=<db-disposable> npm run verify:batch:e2e -- \
  e2e/store/discounts-coupon-mock.spec.ts
```

- `discounts-integration.db.test.ts` (seam L+T) menguji Markdown + qty>1/
  multi-line bersama **manual × percentage** (rate/cap tersimpan, allocation
  whole-line/largest remainder 12308/7692, snapshot L == snapshot order, consume
  sekali), public × fixed (alokasi 15385/9615, PPN 40150), manual × shipping
  delivery (original30000/subsidi20000/net10000/quote30000/payable400000, satu
  allocation tanpa item), serta publish revisi dan pause setelah preview yang
  menggugurkan konfirmasi tanpa order/usage parsial. Expected literal dihitung
  dari rumus §4.2, bukan dari engine yang diuji.
- `discounts-coupon-mock.spec.ts` menambah kasus manual × percentage di browser:
  kode canonical (trim/lowercase) → total149850 → place order menyimpan
  benefit15000/allocation15000/provider `disc_amount`15000 dan detail order.
- Rehearsal migration/seed hanya pada database disposable baru:
  `npx drizzle-kit migrate` (52 migrasi) → `npx tsx src/seed.ts` (dua kali, untuk
  membersihkan FK-ordered cleanup) → verifikasi gate `0`, tidak ada kolom
  `timestamp` tanpa timezone, lalu `SEED_MODE=jubelio` pada DB disposable kedua
  (tanpa produk/order/cart/Offer dummy). `db:reset`+`db:seed` hanya untuk DB
  disposable. Langkah cutover staging/production ada di
  [`docs/deployment-docs/discounts-cutover.md`](../deployment-docs/discounts-cutover.md).

UAT staging, standard `npm run test:e2e`, deployment, provider live write dan
launch tetap memerlukan izin/lingkungan terpisah; mock green bukan aktivasi
produksi.

## Bulk Markdown harga (disposable)

Ticket 04 menguji pemilihan SKU lintas halaman, stage 1..N row, apply bertahap
dengan resume manual, hasil yang jujur, batas config, dan request key apply. Sama
seperti suite di atas: **hanya DB disposable** dengan `DATABASE_URL` eksplisit dan
nama database berawalan `marketplace_discounts_test_*`. Fixture menaikkan
`discounts.contractVersion` ke `1` dan mengembalikannya pada cleanup; ledger
`price_change_apply_request` dibersihkan sebelum batch rows/batch.

```bash
npm run verify:types:admin
npm run verify:unit:slice -- packages/db/src/discount-import-limits.test.ts \
  packages/db/src/seed-system-config.test.ts \
  packages/db/src/seed-cleanup.test.ts
DATABASE_URL=<db-disposable> npm run verify:unit:slice -- \
  apps/admin/src/lib/price-changes-administration.db.test.ts
DATABASE_URL=<db-disposable> npm run verify:batch:e2e -- \
  e2e/admin/price-change-bulk-mock.spec.ts
```

- `packages/db/src/discount-import-limits.test.ts` (pure) mengunci parsing limit:
  missing → default `1000`/`5242880`/`26214400`, nilai valid `1..2147483647`,
  nilai invalid menggagalkan seluruh resolve (fail closed).
  `packages/db/src/seed-system-config.test.ts` memastikan tiga key default ikut
  ter-seed dengan tipe `number`, dan `packages/db/src/seed-cleanup.test.ts`
  memastikan ledger apply-request dihapus sebelum batch rows dan batch.
- `apps/admin/src/lib/price-changes-administration.db.test.ts` memuat skenario
  bulk: stage 3 row + audit per row, SKU tak ditemukan tetap di-stage,
  pembekuan shortcut persen, chunk 30 row (202 lalu resume sampai final), dua
  apply paralel tanpa duplikasi, revoke → halt `POLICY_REVOKED` → resume setelah
  re-grant, limit config (stage ditolak, batch oversized ditahan, config invalid
  fail closed), source terbaru saat apply, no-op tanpa revision, request key
  apply (409 vs replay), detail pagination/filter state untuk report, dan
  kandidat SKU.
- `e2e/admin/price-change-bulk-mock.spec.ts` berjalan di
  `playwright.mock.config.ts` (loopback + DB disposable + gate 1): seleksi 30 SKU
  lintas halaman, review target fixed 240000 dari base 300000 (kenaikan 90000
  pada SKU ber-Markdown 150000), apply pertama `pending > 0` lalu resume sampai
  final 30 applied/30 revision, restore tanpa Markdown → unchanged, shortcut 15%
  dari 100001 → 85001, apply key sama + `previewDigest` berbeda → `409
  REQUEST_KEY_CONFLICT` tanpa revision kedua, dan penolakan admin tanpa grant
  `prices`.
- Spec mock baru **wajib** ada di `testMatch`
  [`playwright.mock.config.ts`](../../playwright.mock.config.ts) pada perubahan
  yang sama; periksa regex-nya memuat `price-change-bulk` sebelum menganggap run
  di atas sebagai bukti. Green mock bukan bukti parser workbook (ticket 05),
  aktivasi gate produksi, atau UAT.

Seed demo bulk (`SEED_MODE=demo`) juga hanya untuk database disposable: seeder
menambahkan satu batch `staged` berisi 3 row `pending` (`SS-WHT-41`, `SS-BLK-41`,
`OX-BLK-41`) tanpa revision/pointer dan tanpa mengubah `product_variant.price`.

## Excel harga: template, parser bounded, dan linked retry (disposable)

Slice ticket 05 menambah parser/validator workbook yang bounded, template,
export, laporan, dan linked retry. Sama seperti suite lain: **hanya DB
disposable** dengan nama `marketplace_discounts_test_*`; fixture menaikkan
`discounts.contractVersion` ke `1` dan mengembalikannya pada cleanup.

```bash
npm run verify:types:admin
npx vitest run apps/admin/src/lib/xlsx-container.test.ts \
  apps/admin/src/lib/price-workbook.test.ts
npx vitest run apps/admin/src/lib/price-workbook-administration.db.test.ts
npm run verify:batch:e2e -- e2e/admin/price-change-excel-mock.spec.ts
```

- `apps/admin/src/lib/xlsx-container.test.ts` dan
  `apps/admin/src/lib/price-workbook.test.ts` memakai writer/fixture
  **independen** (`apps/admin/src/lib/xlsx-test-support.ts`) supaya bug di kode
  yang diuji tidak bisa membuat parser dan fixture sepakat. Cakupan: signature
  ZIP/OLE, entry limit, traversal/duplikat, enkripsi/kompresi tak didukung, CRC,
  header ukuran yang berbohong (bom), batas compressed/expanded/row/cell/text
  tepat di batas vs lebih, marker/header/sheet/macro/external link fatal,
  formula tidak dievaluasi (cached value diabaikan), SKU text exact/duplikat,
  blank price bukan restore, dan writer yang menulis text literal.
- `apps/admin/src/lib/price-workbook-administration.db.test.ts` (real PG):
  upload hanya staging (harga live belum berubah), row gagal final dengan nomor
  baris sheet, apply parsial + laporan/subset, koreksi tertaut hanya ke row
  final gagal (replay key sama, payload beda `409`, origin pending/applied/asing
  ditolak), fatal workbook tidak membuat batch, limit config tepat batas, contoh
  **100 input → 97 applied + 3 failed**, export literal tanpa formula, dan
  matriks izin download/upload.
- `e2e/admin/price-change-excel-mock.spec.ts` berjalan di
  `playwright.mock.config.ts` (loopback + DB disposable + gate 1): template via
  HTTP diverifikasi reader independen, upload→preview→apply parsial→laporan
  (status `applied`/`failed` + reason) → subset gagal dengan `origin_row`,
  koreksi sebagai batch baru tertaut tanpa mengulang row sukses, replay upload
  tanpa duplikasi + `409`, workbook macro ditolak sebelum write, dan Admin tanpa
  grant `prices` ditolak pada template/report/export/upload.
- `apps/admin/vitest.setup.ts` memuat `.env` root sebelum module test dievaluasi,
  sehingga suite DB admin memakai `DATABASE_URL` disposable yang sama tanpa
  harus mengekspor variabel di shell. Ini tidak mengubah gate operasional.
- Spec mock baru **wajib** terdaftar pada kedua `testMatch` di
  [`playwright.mock.config.ts`](../../playwright.mock.config.ts); periksa regex
  memuat `price-change-excel`. Green mock bukan benchmark 1000 row, bukan bukti
  parser aman untuk semua file adversarial, dan bukan UAT/aktivasi produksi.

## Korelasi logging pada server nyata (disposable)

Sejak migrasi logging, route handler HTTP first-party store/admin memakai
wrapper `withRequestContext` yang sama (pengecualian dicatat di
[`features/logging.md`](../features/logging.md#cakupan-pemakaian)). Bukti
korelasi pada server Next
yang benar-benar berjalan tetap dipusatkan pada dua route pilot: `GET
/api/categories` (store, module `categories-route`) dan `GET
/api/admin/session-check` (admin, module `admin-session-check`). Bukti utamanya
bukan route interception browser, melainkan artifact **stdout** proses app yang
dibaca dari file. Route lain memakai wrapper yang sama tetapi belum punya artifact
E2E-nya sendiri; jangan menganggap dua spec ini membuktikan korelasi semua
endpoint.

Persyaratan: **hanya DB disposable** dengan `DATABASE_URL` eksplisit dan nama
database berawalan `marketplace_discounts_test_*` (endpoint kategori membaca
data ter-seed). Jangan memakai DB default/dev/staging.

```bash
export DATABASE_URL="postgresql://postgres:postgres@localhost:5432/marketplace_discounts_test_<suffix>"
npm run db:push              # skema development (JANGAN db:migrate di dev)
SEED_MODE=demo npm run db:seed

npm run verify:types:store
npm run verify:types:admin
npm run verify:unit:slice -- packages/logging/src/logger.test.ts \
  packages/logging/src/http-context.test.ts \
  packages/logging/src/policy.test.ts \
  apps/store/src/lib/logger.test.ts apps/admin/src/lib/logger.test.ts \
  apps/store/src/app/api/categories/route.test.ts \
  apps/admin/src/app/api/admin/session-check/route.test.ts

DATABASE_URL=<db-disposable> npm run verify:batch:e2e -- \
  e2e/store/logging-mock.spec.ts e2e/admin/logging-mock.spec.ts
```

`packages/logging/src/policy.test.ts` adalah guard statis pasca-migrasi: ia
memindai `apps/store/src` dan `apps/admin/src` untuk nama helper engine legacy
dan `console.*` langsung di `apps/<app>/src/app/api`, sehingga engine yang sudah
dihapus tidak bisa masuk lagi tanpa membuat guard ini merah.

Kedua spec terdaftar pada **kedua** `testMatch` di
[`playwright.mock.config.ts`](../../playwright.mock.config.ts) (regex memuat
`logging`). Konfigurasi itu menjalankan app store/admin lewat dua file runner
test-only:

- [`e2e/support/logging-server.mjs`](../../e2e/support/logging-server.mjs) —
  pembungkus `next dev` yang menyimpan stdout mentah proses app ke file artifact
  (port/env/`reuseExistingServer` tidak berubah: store 3110, admin 3111).
- [`e2e/support/logging-artifacts.ts`](../../e2e/support/logging-artifacts.ts) —
  reader toleran: file belum ada, baris non-JSON (`next dev`), dan baris parsial
  dianggap "belum teramati", supaya spec bisa `expect.poll` sampai capture
  muncul.

Artifact ditulis ke direktori sementara sistem **di luar repo**
(`E2E_LOGGING_DIR`, dibuat dengan `mkdtemp` dan dipakai ulang bila sudah ada),
dengan file `store-stdout.log` dan `admin-stdout.log`. Assertion-nya: tepat dua
record per `requestId` kanonik (satu event bisnis + satu completion `GET 200`),
envelope enam field tanpa binding bisnis, header `x-request-id` berupa UUID buatan
server yang berbeda untuk dua request dengan incoming id sama, serta incoming id
maupun query mentah tidak muncul di record.

Bukti yang dicatat parent untuk run pilot ini: **2/2 PASS**
(`/tmp/logging-real-e2e-green.log`), types E2E PASS
(`/tmp/logging-e2e-types.log`), dan ESLint 0 error dengan satu warning `Pages
dir` root (`/tmp/logging-e2e-lint.log`). RED-nya adalah header/body/ID sudah
benar tetapi artifact capture belum ada sehingga `expect.poll` timeout
(`/tmp/logging-real-e2e-red.log`).

### Evidence gelombang migrasi logging (batch besar)

Migrasi logging dieksekusi sebagai gelombang batch besar atas permintaan
eksplisit user, jadi siklus RED→GREEN per file hanya tercatat untuk sebagian
seam: core package 18 test, facade app 2 test, dua route pilot 5 test,
`jubelio-sales-client.test.ts` 133 test, slice lifecycle 38 pass / 2 skipped, dan
`jubelio-sales-settlement` 35 pass / 1 skipped.

Gate akhir dijalankan **satu kali sebagai batch** (parent, 2026-10-23) pada DB
disposable `marketplace_discounts_test_logging_01a1646c` dengan kredensial
provider palsu, tanpa Docker, remote action, atau provider live:

| Gate | Hasil |
|---|---|
| `npm run verify:types:store` / `verify:types:admin` | PASS keduanya |
| `npm run verify:unit:slice -- packages/logging/src/policy.test.ts` | 3/3 PASS |
| ESLint scoped pada seluruh 186 file TS yang berubah | 0 error |
| `npm run lint:admin` | 0 error, 36 warning |
| `npm run lint:store` | **1 error pre-existing** (`apps/store/src/components/Header.tsx:39`) — **tidak** hijau |
| `npm run verify:batch:unit` | 163 file pass, 1776 test pass, 12 skipped (1788 total) |
| Sweep mock E2E penuh (`playwright.mock.config.ts`, semua spec) | 152 pass, 0 fail |
| `npm run build:store` + `npm run build:admin` | keduanya "Compiled successfully" |

Batas bukti (jangan dikutip tanpa bagian ini):

- **`lint:store` tidak hijau.** Satu-satunya error adalah
  `react-hooks/set-state-in-effect` di `apps/store/src/components/Header.tsx:39`,
  file tanpa diff pada pekerjaan logging — isu repo pre-existing di luar scope,
  bukan regresi migrasi. Jangan menulis "lint kedua app bersih".
- Skip **bukan** pass; jangan menyimpulkan distribusi penyebabnya tanpa membaca
  log run-nya.
- RED/GREEN per file hanya ada untuk subset seam di atas. End-state dibuktikan
  tabel gate, bukan klaim per file yang tidak punya log RED.
- Korelasi `requestId` pada server Next nyata tetap dipusatkan pada dua spec di
  atas; endpoint lain memakai wrapper yang sama tetapi belum punya artifact E2E
  sendiri. Cakupan wrapper-nya sendiri sudah penuh: store 33 dari 34 `route.ts`
  dan admin 71 dari 72, dengan satu-satunya pengecualian `auth/[...all]/route.ts`
  (catch-all Better Auth). Empat route store yang terakhir dibungkus —
  `/api/addresses*`, `/api/onboarding/sync` — kini juga ber-`requestId` kanonik
  (angka cakupan:
  [`features/logging.md`](../features/logging.md#pengecualian-yang-harus-dibaca-bersama-tabel)).
- Bukti diambil dari artifact stdout lokal (`E2E_LOGGING_DIR`) dan test sink;
  jangan menambah endpoint debug/log-capture di production untuk memperoleh
  bukti.
- Mock E2E ini memakai provider loopback dengan kredensial palsu. Pemblokiran
  jaringan non-loopback hanya berlaku pada run full unit, jadi jangan
  mengklaim seluruh jaringan E2E diblokir; jalankan dengan ladder di bawah
  (L0 → L1 → L2 → L3) untuk perubahan berikutnya.
- Bila Playwright gagal, diagnosis hanya dari report Markdown/teks; jangan
  membuka attachment `.png`.

## Prerequisites

- **Focused SO gateway and stock-sync unit tests**: no database needed (`npm exec --workspace=apps/store -- vitest run src/lib/jubelio-sales-client.test.ts` and `npm exec --workspace=packages/db -- vitest run src/jubelio-sync.test.ts`). The Sales gateway tests stub the external HTTP boundary; they never start a mock server or contact Jubelio. The separate **legacy/candidate mock** tests are `npm exec --workspace=apps/jubelio-mock -- vitest run src/server.test.ts`; they are not used by the new Sales gateway. **The full `npm run test:unit` suite is not entirely infrastructure-free**: `apps/admin/src/lib/rbac/users-service-db.test.ts`, `packages/db/src/migrations/migration-0018-rehearsal.test.ts`, and `apps/store/src/lib/jubelio-sales-operations.db.test.ts` need local PostgreSQL. Without port 5432, the first two fail with `ECONNREFUSED`; the new ledger suite skips five race tests and **fails its explicit environment-blocker test**. The ledger claim is not DB-verified until those tests run against a prepared schema. Do not mistake that infrastructure failure for an SO regression.
- **E2E tests**:
  - PostgreSQL up (`docker compose up -d`) with schema + seed applied:
    `npm run db:push && npm run db:seed`.
  - Playwright browsers installed (once): `npm run test:e2e:install`.
  - The Jubelio mock and dev servers are started automatically by Playwright's `webServer`
    (and **reused** if you already have `npm run dev:store` / `dev:admin`
    running).

## Scripts

| Script | What it does |
|---|---|
| `npm run test` | Unit tests, then E2E tests |
| `npm run test:unit` | Run all Vitest projects (headless) |
| `npm run test:unit:watch` | Watch mode |
| `npm run test:e2e` | Playwright headless |
| `npm run test:e2e:headed` | Open a visible browser window |
| `npm run test:e2e:ui` | Playwright UI mode (pick tests, inspect traces live) |
| `npm run test:e2e:debug` | Run with the Playwright inspector (step through) |
| `npm run test:e2e:install` | Install Chromium (and other browsers if configured) |
| `npm run test:e2e:report` | Open the last HTML report |
| `npm run verify:types:store` | L0 — store typecheck (`tsc --noEmit`, incremental) |
| `npm run verify:types:admin` | L0 — admin typecheck |
| `npm run verify:unit:slice -- <paths>` | L1 — focused Vitest on the files a slice touched |
| `npm run verify:batch:unit` | L2 — full unit suite, serial, compact reporter |
| `npm run verify:batch:e2e -- <specs>` | L2 — mock E2E, only the specs named |

Use `--headed`, `--ui`, or `--debug` to watch the browser do the work.

## Verification ladder

Policy lives in [`AGENTS.md`](../../AGENTS.md) §5; this section is the operational
how-to for multi-ticket work such as [discounts implementation](../../.scratch/discounts/ticket/map.md).
The ladder separates *cheap, frequent* signal from *expensive* suites so a batch of
tickets does not re-run the whole repository after every slice.

| Level | When | Command | Cost |
|---|---|---|---|
| L0 | every slice | `npm run verify:types:store` / `verify:types:admin` | seconds |
| L1 | every slice | `npm run verify:unit:slice -- apps/store/src/lib/<file>.test.ts` | seconds |
| L2 | every batch of tickets | `npm run verify:batch:unit` + `verify:batch:e2e -- <affected mocks>` | minutes |
| L3 | before commit/PR and at the integration ticket | full unit + required UI E2E | slowest |

Rules that keep this honest:

- L1 always receives **explicit file paths**. Passing no path runs every project.
- `verify:batch:e2e` intersects the CLI path filter with
  [`playwright.mock.config.ts`](../../playwright.mock.config.ts) `testMatch`, so a new
  mock spec that is not listed there never runs. Add it in the same change that
  creates it; a green run that silently skipped a spec is not evidence.
- Capture output instead of pasting it: redirect to a log outside the repo or grep the
  summary/failure lines only (`dot`/`line` reporters already cut most of the noise).
- Never re-run a suite that already passed to "confirm" it. Record its summary line
  (`Test Files … Tests …`) as the evidence entry for that batch instead.
- A ticket stays `claimed` until its batch gate passes; it never becomes `resolved`
  on a child's report alone.
- The legacy `npm run test:e2e` (36 specs, live-provider writes in the checkout suite)
  is **not** part of this ladder and still needs separate authorization.

## Test users

E2E tests sign in with the **seeder credentials** (see `packages/db/src/seed.ts`):

| App | User | Credentials | Used for |
|---|---|---|---|
| Store | `john@example.com` | `password123` | Authenticated session (auth setup completes onboarding) |
| Store | `jane@example.com` | `password123` | Fresh-login flow (never onboarded → lands on `/onboarding`) |
| Admin | `admintoko` (or `admin@store.com`) | `admin123` | Admin login + dashboard session |

Override via env vars when your local DB differs:

```sh
E2E_STORE_EMAIL=... E2E_STORE_PASSWORD=...
E2E_STORE_FRESH_EMAIL=... E2E_STORE_FRESH_PASSWORD=...
E2E_ADMIN_IDENTIFIER=... E2E_ADMIN_PASSWORD=...
```

## Layout

```
playwright.config.ts      # projects: setup, store, admin + webServer
apps/jubelio-mock/        # stateful Jubelio mock (legacy adjustments + candidate Sales API)
e2e/
  config.ts               # auth-state paths + TEST_USERS (env-overridable)
  auth.setup.ts           # logs in once per app, saves storageState
  store/                  # storefront specs (baseURL http://localhost:3000)
    login.spec.ts         # login flow (valid / invalid / redirect)
    account.spec.ts       # authenticated smoke (reuses saved session)
    products.spec.ts      # infinite scroll, sidebar filters, pricing, grey-out
    product-detail.spec.ts# metadata (brand/gender/category/price/discount/stock)
    checkout.spec.ts      # legacy adjustment checkout → PPN snapshot → local payment boundary
    sales-recovery.spec.ts# secret-protected cron queues stale SO dispatch for manual review (no provider write)
    onboarding.spec.ts   # fresh user → /onboarding → cookie (isolated user via pg)
    static-pages.spec.ts  # CMS pages + footer rendering
  admin/                  # admin specs (baseURL http://localhost:3001)
    login.spec.ts         # login flow (valid / invalid / redirect)
    dashboard.spec.ts     # authenticated smoke (reuses saved session)
    products.spec.ts      # list/search/detail, sync + upload APIs
    orders.spec.ts        # list/detail + PPN snapshot, verify-pickup, audit-log entry
    users.spec.ts         # generated reset password → forced-reset login
    rbac.spec.ts          # current-policy guards: HQ-only roles page (policy → No-Access), removed legacy /api/admin/permissions endpoints (404), /api/admin/policy/me resolution, branch-scoped orders
    roles-api.spec.ts     # Roles API: denials without Roles grants, create/unique-name/coverage validation, stale-version 409, reduction reason + audit, archive/restore review
    roles-ui.spec.ts      # Roles UI: list/search/archived filter, immutable System Owner, deny-all create, clone, editor, reduction impact dialog, stale-conflict retry, archive/restore, No-Access + Policy-Unavailable states
    users-rbac.spec.ts    # Users APIs under current policy: strict payloads (legacy `role` rejected), valid roleId + Home Branch, ceiling/Owner-only/self-protection, deactivation + session revoke, last-active-Owner invariant
    rbac-security.spec.ts # branch-aware security matrix: own-branch Admin vs cross-branch viewer vs all-branch HQ across Products/Orders/Notifications/Branches/Analytics/Audit Log, fail-closed pickup; plus a Homepage-only Marketing custom Role (Global Module access with a mandatory Home Branch, unrelated modules deny/hide, next-request grant-reduction enforcement without logout)
    analytics.spec.ts     # metrics endpoint invariants (revenue semantics vs independent SQL), 30-day WIB trend, RBAC deny/redirect/sidebar, dashboard UI (skeleton/retry/no-polling, chart + accessible table)
    notifications.spec.ts # long-poll, mark-all-read
    cms.spec.ts           # homepage/pages/footer + floating WhatsApp render
apps/*/vitest.config.ts   # per-app unit config (aliases, include)
packages/db/vitest.config.ts
```

### E2E pitfalls (learned the hard way)

- `npm run dev:store` starts both the storefront and Jubelio mock for the
  **still-active legacy adjustment flow**. Playwright starts them as separate
  managed processes. The Sales gateway outside
  production fails closed unless explicitly opted into a pinned real
  test-account host or the isolated loopback-only E2E seam above. Legacy non-production
  stock writes still use the local mock.
- Mock controls: `POST http://127.0.0.1:3002/__control/reset`, then
  `PUT /__control/scenario` with one of `success`, `insufficient-stock`,
  `server-error`, `rate-limit-once`, `unauthorized-once`,
  `timeout-before-apply`, `timeout-after-apply`, or `malformed-success` for
  legacy adjustments. The **candidate** Sales API mock supports
  `timeout-after-apply` and `malformed-success-after-apply` for SO create,
  cancel, invoice creation and payment. Reset state between cases; seed an
  item/location with `POST /__control/stocks/ensure`. `GET /__control/requests`
  exposes attempted HTTP writes for assertions. `GET /inventory/` reflects
  SO `on_order` and `available` changes observed in the single test-account
  canary. The mock invoice/payment effects and 409 duplicate behavior are
  **hypotheses**, not verified Jubelio behavior. No test may interpret a green
  mock as approval for real invoice/payment writes or checkout activation.
- The Sales Order gateway (`apps/store/src/lib/jubelio-sales-client.ts`) now
  backs the live checkout (Sales-Order cutover). Normal runtime never falls back
  to the local mock; the explicit loopback-only E2E seam above is separate.
  Its focused tests stub the external HTTP boundary and assert
  one POST per write, independent GET confirmations, pre-invoice
cancellation, fail-closed ambiguous outcomes, and the sandbox-observed
  invoice/payment response shapes (`{status,id}` responses, numeric
  `payment_type`, invoice linkage via the SO GET's `invoice_id`, payment
  association via `invoices[]`).
- **Sandbox integration**: `npm run sandbox:sales` (apps/store) runs the real
  Path 1 chain against the isolated `.env` test account (requires
  `JUBELIO_SALES_TEST_ACCOUNT_ENABLED=true`): SO create/confirm/stock series,
  confirmed cancel/stock restore, invoice conversion + linkage, payment +
  association, and gateway refusal to cancel after an invoice. It writes test
  records into the sandbox account only.
- Confirmed create/cancel accounting crash replay and a recovered invoice
  with mismatched items are covered by
  `apps/store/src/lib/jubelio-sales-recovery.db.test.ts` (PostgreSQL required).
  `packages/db/src/checkout-live-stock.db.test.ts` verifies live checkout
  stock reads with a stubbed provider, stale-local-zero recovery, fail-closed
  invalid/network observations and concurrent-hold protection. The provider
  clock is distinct from the local `branch_stock.updated_at` hold clock.
- **Sandbox re-verification (2026-09-25):** item 101187 had no stock; a
  previous invoice conversion for SO 68388 returned an ambiguous 500. The
  read-only investigation script `apps/store/src/scripts/inspect-sandbox-so-68388.ts`
  found no SO invoice ID and only a different SO in the customer-filtered
  invoice list. This does NOT settle the ambiguity: an operator must decide
  disposition; never re-POST the invoice. New stocked item 43822/location 2
  passed the full Path 1 chain (SO 68390 → invoice 45939 → payment 16).
  Re-run with `JUBELIO_SANDBOX_ITEM_ID=43822 JUBELIO_SANDBOX_LOCATION_ID=2
  npm run sandbox:sales` from `apps/store` after checking stock availability.
  Stock-only scan boundary and PostgreSQL race tests are in
  `packages/db/src/jubelio-stock-refresh*.test.ts`; cron auth tests in
  `apps/store/src/app/api/cron/refresh-jubelio-stock/route.test.ts`.
  `checkout.spec.ts` checks that an old local observation no longer removes
  cart items before the live place-order check. `provisional-stock.spec.ts`
  checks the provisional product/cart display and customer-visible checkout
  errors with a **stubbed HTTP checkout response**; this UI stub does not
  prove a live Jubelio SO create or stock read.
- The SO hold concurrency guarantees are DB-tested in
  `apps/store/src/lib/jubelio-sales-holds.db.test.ts` (requires PostgreSQL:
  parallel holds cannot oversell; a sync refresh never clears holds; the
  confirmed-create mirror decrements exactly once).
- `sales-recovery.spec.ts` uses a dedicated DB fixture and the real cron HTTP
  endpoint to prove unauthorized requests cannot triage an operation and
  authorized sweeps reconcile/mark aged unknown claims.
- `checkout.spec.ts` exercises the SO flow end-to-end when
  `JUBELIO_SALES_TEST_ACCOUNT_ENABLED=true`: confirmed SO before Midtrans,
  zero adjustment writes, fail-closed manual-review routing for unknown
  remote items, late settlement after a confirmed cancel → paid-but-blocked,
  and authoritative payment-attribute persistence. It cancels its sandbox
  Sales Orders in `afterAll`.
- `cms.spec.ts` saves/enables/disables WhatsApp and restores the complete footer
  JSON. `users.spec.ts` verifies generated-password reset through login.
- For late settlement, Playwright sets the non-production-only
  `MIDTRANS_MOCK_API_BASE_URL` to the local mock. Configure an authoritative
  status with `PUT /__control/midtrans-status` (supports `transactionStatus`,
  `grossAmount`, `fraudStatus`, plus `paymentType` and `transactionId` echoed
  by the mock's `GET /v2/{orderId}/status` exactly like the real Midtrans GET
  status); production ignores this URL.

- The store Playwright project sends `x-e2e-payment-mock: true`. The route
  accepts it only outside production and redirects to the local
  `/checkout/payment-test` page, so CI never creates a real Midtrans charge.
- Checkout uses deterministic seeded fixtures and cleans up orders plus stock
  reservations in `afterAll`, keeping repeated runs isolated.
- The **focused** SO gateway/stock-sync unit tests above need no database;
  the full unit suite includes PostgreSQL-dependent migration/RBAC tests.
  E2E requires the disposable seeded PostgreSQL database described above.

- **React hydration race**: filling a controlled input right after navigation
  gets reverted when hydration takes over. Wait for a client-side signal first
  (submit button `toBeEnabled()`, or `waitForResponse` on a useEffect fetch).
- **Windows/Turbopack**: local runs use four workers. Higher parallelism can
  produce transient `EPERM` manifest-renames; CI remains serialized.
- **Shared state**: specs that share a user's cart or mutate DB rows must use
  `test.describe.configure({ mode: "serial" })` — `fullyParallel: true` is on.
- **Heavy pages**: `waitForURL` with `{ waitUntil: "commit" }` when the target
  page loads slowly under parallel load.
- **DB fixtures**: specs that need deterministic data (fresh users, order
  status, notifications, footer brand) create/reset rows via `pg` in
  `beforeAll`/`afterAll` (see `onboarding.spec.ts`, `orders.spec.ts`,
  `notifications.spec.ts`, `cms.spec.ts`). The admin RBAC suite follows the
  same pattern with run-unique fixture names (a `RUN` suffix from
  `Date.now().toString(36)`, e.g. `E2E Roles UI <case> <RUN>`), so repeated
  runs stay isolated even though archived Role Names stay reserved by design.
- **Reserved identities live forever**: archived Role Names and deactivated
  users' emails/usernames are reserved by design — also *within one spec
  run*. Two tests in the same file that each archive/deactivate their own
  fixture must give the fixture a per-test unique suffix (`${RUN}-${attempt}`),
  or the second `beforeEach` hits `409 DUPLICATE_NAME` / a reserved email (see
  the Marketing Role fixtures in `rbac-security.spec.ts`).
- **FK-order cleanup**: rows inserted by direct `pg` access must be deleted in
  foreign-key order in `afterAll` — sessions → accounts → audit trail →
  users → grants → roles (the `user.role_id` FK is `RESTRICT`, so every user
  holding a fixture Role goes before the `admin_role` rows). See the
  `afterAll` blocks in `roles-ui.spec.ts`, `users-rbac.spec.ts`, and
  `rbac-security.spec.ts`.
- **Serial / one worker**: specs that share one fixture set or mutate shared
  Owner state run with `test.describe.configure({ mode: "serial" })`
  (`roles-ui.spec.ts`, `users-rbac.spec.ts`); `rbac-security.spec.ts` keeps
  the file-level `default` mode precisely because each test would otherwise
  re-run `beforeAll` in its own worker and collide on the fixed fixture keys
  (unique `pickup_code`, inflated analytics counts). Do not raise worker
  parallelism for these files.
- **Playwright failure diagnosis**: when a run fails, diagnose from the
  Markdown/text output only (error context, snapshot text, trace) — do not
  open the screenshot/image attachments; reading them wastes a turn and is
  forbidden in this repo (see `AGENTS.md`).

### Auth pattern (important)

Playwright's best practice is **"login once, reuse everywhere"**:

1. `e2e/auth.setup.ts` signs in the store customer (and completes onboarding
   so the `client.onboarding=1` cookie is saved) and the admin user, then saves
   `storageState` to `e2e/.auth/*.json` (gitignored).
2. The `store` and `admin` projects load those sessions by default, so **new
   spec files are automatically authenticated**.
3. **Login-flow specs opt out** so they test an unauthenticated user:

   ```ts
   test.use({ storageState: { cookies: [], origins: [] } });
   ```

## Adding tests

- **Unit tests** (public seams only — see the `tdd` skill): colocate
  `*.test.ts` next to the code under `apps/*/src` or `packages/db/src`. Example:
  `apps/admin/src/lib/login-utils.test.ts` tests the `isEmail` helper the login
  form uses. Keep tests to pure logic — no DB or browser. React component tests
  would need `jsdom` + Testing Library added on demand (see the Vitest configs).
  Policy-matrix tests stay hand-independent: derive the attempted
  module/action/scope set from `CATALOG` itself (see the
  "deny-by-default catalog matrix" block in `packages/db/src/rbac/policy.test.ts`
  — a deny-all Role must deny EVERY catalog attempt) so a catalog change
  automatically extends the matrix.
- **E2E specs**: drop a `*.spec.ts` into `e2e/store/` or `e2e/admin/`. Prefer
  role-based locators (`getByRole`, `getByLabel`) and web-first assertions
  (`expect(...).toBeVisible()`). For a flow that needs its own login, opt out
  of the saved session as shown above.

## CI

`playwright.config.ts` is CI-aware: `forbidOnly`, `retries: 2`, single worker,
and `reuseExistingServer: false` (servers are freshly started). The same
`webServer` entries run the apps; ensure the DB is seeded in the CI job first.

## Troubleshooting

- **`webServer` timeout / 500 on startup** — the store/admin dev server needs
  the DB; check Postgres is up and `npm run db:seed` succeeded.
- **Login lands somewhere unexpected** — the store middleware forces
  `/onboarding` until the `client.onboarding=1` cookie exists. The auth-setup
  completes onboarding for saved sessions; fresh logins in specs assert the
  `/onboarding` landing.
- **RBAC specs bounce off `/login`** — the saved admin project session is the
  branch-admin `admintoko` (Admin Role). Specs that need another identity
  (HQ role manager `hqmanager`, fixture users) must start from an isolated
  empty context — `test.use({ storageState: { cookies: [], origins: [] } })`
  or a fresh `browser.newContext()` — and prove the identity switch via
  `/api/admin/me` before asserting policy behavior; otherwise `/login`
  redirects straight back to `/admin`.
- **Playwright failures** — diagnose from the Markdown/text report only; never
  open the `.png`/image attachments (see the pitfalls above).
- **Stale auth state** — delete `e2e/.auth/` and re-run; Playwright regenerates
  it from the setup project.

## Manual Promo Code (ticket 09)

- Unit: `packages/db/src/discount-code.test.ts` (canonical/masking),
  `discount-eligibility.test.ts` (channel manual), pure admin code rules di
  `apps/admin/src/lib/discounts-administration.test.ts`
  (`normalizeCodeProposals`, fingerprint `proposedCodes`).
- Real PG: `packages/db/src/discount-code-schema.db.test.ts` (canonical unique,
  ownership manual-only, activation shape Redemption),
  `apps/admin/src/lib/discounts-administration.db.test.ts` (create/add/state,
  replay, masked viewer, publish proposals, CODE_CONFLICT/CODE_ARCHIVED),
  `apps/store/src/lib/discount-selection.db.test.ts` (resolve kode/read-only),
  `apps/store/src/lib/discount-reservation.db.test.ts` (Redemption manual,
  quota/per-account bersama, kode nonaktif menggugurkan),
  `apps/store/src/lib/checkout-admission.db.test.ts` (bucket kode lintas proses,
  shared IP, forged header, Retry-After 50 detik).
- Mock E2E: `e2e/admin/discounts-admin-mock.spec.ts` blok Manual Promo Code (create manual,
  add/state, masked viewer) dan `e2e/store/discounts-coupon-mock.spec.ts` (kasus Manual Promo Code)
  (Terapkan → ganti invalid/valid → place → detail). Keduanya sudah terdaftar di
  `testMatch` `playwright.mock.config.ts`.

## Subsidi ongkir (ticket 11)

- L: `packages/db/src/discount-pricing.test.ts` (clipping ongkir, PPN barang
  saja, pickup/ongkir0 ditolak, guard bentuk cap) dan
  `packages/db/src/discount-eligibility.test.ts` (delivery-only, nominal aktual
  untuk budget/kuota).
- T: `apps/store/src/lib/discount-shipping.db.test.ts` — PostgreSQL nyata:
  satu Redemption shipping, satu allocation `offer_shipping` tanpa item,
  `goods_discount_amount` tetap 0, counter/budget/per-account memakai subsidi
  aktual, pickup disabled.
- H: `apps/store/src/lib/jubelio-sales-shipping.test.ts` — snapshot subsidi vs
  intent provider (`original_shipment_cost`/`shipping_cost`/`grand_total`,
  `add_disc`/tax 0, tanpa `shipping_cost_discount`), plus drift 1 Rupiah ditolak.
- B: `e2e/store/discounts-coupon-mock.spec.ts` (delivery public/manual shipping,
  pickup invalidation, swap comparison) dan regresi checkout/delivery mock.
- Admin: `apps/admin/src/lib/discounts-administration.test.ts` (draft shipping
  hanya cap positif) dan `e2e/admin/discounts-admin-mock.spec.ts` (form/simulasi).

### Checkout attempt (pra-order)

- `e2e/store/checkout-review-mock.spec.ts` — lifecycle checkout baru: SO ditolak
  tanpa order, ambiguitas ditahan, promotion hanya setelah SO + pembayaran siap,
  replay key sama, pemulihan sweep, dan rollback lokal.
- `e2e/admin/checkout-attempt-review-mock.spec.ts` — antrean review operator
  menampilkan attempt pra-order tanpa link pesanan palsu dan mematuhi own-branch
  scope.
- `apps/store/src/features/checkout/checkout-attempt-repository.db.test.ts` —
  reservation/promotion/rejection/recovery pada PostgreSQL disposable.
