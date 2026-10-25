# 13 — Integrasi dan kesiapan rilis

Label: ready-for-agent
Type: task
Status: claimed
Assignee: main-agent
Blocked by: 05, 10, 11, 12
Parent: [Map implementasi diskon](map.md)
Spec: [Complete spec](../plan/discounts-spec.md)
Acceptance IDs: M01, M02, M03, X01, X02, X03, X04, X05, X06, C01, C02, C03, C04, C05, C06, C07, F01, F02, F03, T01, T02, T03, T04, T05, T06, P01, P02, P03, S01, S02, S03, S04, A01, A02, A03, A04, D01, D02, D03, R01

## Perilaku yang dibangun

Mengintegrasikan slice yang sudah teruji menjadi satu fitur yang siap direview untuk rilis: seluruh benefit/activation channels, Markdown/Excel, customer selection/reservation/provider, admin privacy/ops dan versioned cutover konsisten. Pemilik/tester memperoleh evidence register, rehearsal dan checklist/sign-off staging yang jujur, bukan klaim mock-only green berarti production aktif.

Ini gate integrasi/operasional setelah slices menghasilkan perilaku nyata, **bukan tempat pertama** membangun seluruh tests, logging, schema/seed atau safety. Deploy/remote/provider writes/launch dan UAT yang memerlukan lingkungan berizin tetap keputusan terpisah.

## Acceptance criteria

- [x] Semua40 IDs spec §12.2 memiliki evidence traceable sesuai seam L/T/H/B/P/D dan coverage detail proposal. Distinguish pass/fail/blocked/skipped; infrastructure skips bukan pass dan report subagent bukan acceptance.
- [x] Cross-slice public/manual × fixed/percentage/shipping, Markdown+masing-masing Offer, qty>1/multi-line, optional caps, pickup/delivery, invalidation/confirmation/replay dan permissions berjalan konsisten. Manual+percentage terverifikasi sesudah09+10, bukan dianggap selesai karena evaluator sama.
- [x] Provider create→mirror→invoice→payment→post-invoice mirror dan reconciliation memakai expected snapshot/version/IDs/whole-line discounts/original/net shipping yang benar. External controlled tests membuktikan application integration; evidence08/T1–T3/M1M2 hanya pada envelope existing. Tidak menguji ulang real provider tanpa izin spesifik baru.
- [x] End-to-end failure/race regression mencakup last quota/budget/account slot, price/source edits, publish/pause/limit changes, same-key crash/response loss, duplicate/out-of-order callbacks/sweep, ambiguous provider and late paid; safety sudah ada di slice asal dan tidak diturunkan di integration.
- [x] Full serial unit, isolated mock Playwright, affected lint/typechecks/build/schema checks dan required regression evidence tercatat. Standard E2E yang dapat menulis provider tidak dijalankan tanpa otorisasi; jika belum aman/berizin, laporkan gate blocked dan jangan menyebut seluruh suites lulus.
- [x] Generated SQL, FK ownership/retention/indexes dan migration/seed rehearsal diuji pada disposable DB; shared schema/timestamptz dan FK-ordered cleanup benar. Demo fixtures lengkap, mode Jubelio tanpa dummy transactional data, production seed tetap forbidden. Tidak menghapus/edit generated SQL manual.
- [x] Preflight tidak menemukan usage legacy nyata yang diabaikan; jika ditemukan, hentikan cutover terkait dan minta keputusan. Tidak fabrikasi opening balances/backfill personal/dual-write atau reset data nyata.
- [x] Writer gate default0, explicit config import, paired store/admin/sweep/mirror/sync compatible readers/writers dan unknown-version fail-closed teruji. Legacy voucher route/consumers diputus sesuai approved cutover, bukan fallback ke subtotal browser authority.
- [ ] Rollout/rollback rehearsal membuktikan snapshot/evidence terjaga. Sesudah new-version orders ada, aplikasi incompatible tidak dijalankan untuk memprosesnya; pause new writes dan compatible recovery/forward fix. Restore lokal bukan rollback writes provider.
- [ ] Deployment common/staging/production dan enduring feature/API/DB/RBAC/PPN/delivery/testing/config/rollback docs sesuai perubahan aktual. Trusted IP dan request/parser limits diverifikasi terhadap runtime/proxy, bukan sekadar unit fixture.
- [ ] UAT staging pemilik/tester mencatat functional/visual admin-existing, no service fee, nominal/payment/provider/quote breakdown, privacy, partial Excel dan safe pause outcomes. Sign-off/blocked environment/izin direkam; tidak mengarang hasil UAT.
- [ ] Rilis publik hanya setelah acceptance/gates/sign-off dan izin operasi terpisah; tanpa internal-production cohort tambahan. Pause satu Offer menahan pemakaian baru saja; snapshots/holds lama tetap. Tidak ada mass cancel/reprice/forced usage release.
- [x] Tidak ada requirement pembayaran/provider Rp0, fee baru, cleanup sandbox lama sebagai launch blocker, refund tooling atau scope baru yang disisipkan.

## Verifikasi dan external gates

Main agent mengintegrasikan perubahan, mereview terhadap complete spec dan repo standards, lalu menjalankan command plan spec §12.3 pada environment yang sesuai. Seluruh tests fitur seharusnya sudah datang bersama slices; tambah tests hanya untuk gap/cross-slice regression konkret, satu TDD cycle per perilaku.

Register evidence mencatat commands/environment/ref/IDs/result/artifacts/scope serta sign-off owner. Saat Playwright gagal baca Markdown/trace context, bukan PNG. Rehearsal lokal disposable tidak memberi izin SSH/Docker remote, reset data nyata, credential/login provider atau staging mutation.

Jika UAT staging, required standard suite, deployment rehearsal target atau approval operasi belum tersedia, jangan resolve seolah R01/D02/full gates selesai. Catat blocker eksternal secara eksplisit dan minta langkah/izin spesifik. Ticket ini tidak memaksa deployment/launch hanya agar bisa ditutup.

## Completion

Baca [kontrak bersama](map.md#kontrak-bersama-untuk-semua-ticket). Setelah seluruh acceptance wajib dan gates dipenuhi, main agent menyelaraskan status task/features/plan, mengekstrak enduring docs dan melakukan retirement plan sesuai approved checklist. Tidak menghapus Wayfinder/evidence scratch, commit/push atau menjalankan deploy otomatis. Answer harus memisahkan implemented/tested/UAT/launchable/actually activated.

## Comments

### Blocked external gates (keputusan/izin diperlukan, bukan pekerjaan yang bisa diselesaikan lokal)

1. **UAT staging pemilik/tester** — belum ada environment staging berizin dan
   sign-off. Opsi: (a) sediakan staging disposable + jadwal UAT owner/tester
   (Recommended), (b) tunda rilis dan tetap gate `0`, (c) batalkan rilis.
   Checklist ada di `docs/deployment-docs/discounts-cutover.md` §6. Tanpa ini R01
   dan acceptance UAT tidak boleh ditutup.
2. **Standard `npm run test:e2e`** — suite legacy berisi write provider nyata;
   butuh otorisasi provider/lingkungan terpisah. Opsi: (a) otorisasi suite penuh
   pada sandbox terkontrol (Recommended bila sandbox tersedia), (b) tetap
   kanonik mock+unit sebagai gate rilis dengan pengecualian tertulis, (c) tidak
   merilis. Jangan mengganti diam-diam dengan mock pass.
3. **Deployment/rollout/rollback rehearsal target** — butuh SSH/Docker/jendela
   maintenance/backup berizin. Rehearsal lokal (migrasi 52, seed ×2, reset,
   gate0, Jubelio mode, production seed ditolak) sudah PASS, tetapi rehearsal
   target + pembuktian snapshot/evidence setelah order versi baru belum.
4. ~~**Legacy voucher cutover**~~ — **RESOLVED oleh keputusan pemilik
   (2026-10-22): hapus implementasi voucher lama.** Route
   `apps/store/src/app/api/vouchers/validate`, helper `lib/vouchers`+test,
   docs `features/vouchers.md`, entri API reference, fixture seed voucher,
   entri test E2E legacy, dan field `voucherId` di DTO admin sudah dihapus;
   endpoint kini 404 dan tidak ada fallback subtotal browser. Tabel `voucher`
   dan kolom `orders.voucher_id` dibiarkan inert (tanpa writer/reader/seed)
   sampai keputusan migrasi destruktif terpisah.
5. **Rilis publik/aktivasi gate `1`** — menunggu acceptance, sign-off, dan izin
   operasi terpisah. Gate DB disposable tetap `0`.

### Temuan preflight yang sudah diperbaiki

`deployment/{staging,production}/docker-compose.yml` belum meng-set
`CHECKOUT_TRUST_PROXY`, padahal docs menyatakan store hanya diakses lewat Caddy
dan admission production fail-closed `503 POLICY_UNAVAILABLE` tanpa flag itu.
Ticket ini menambahkan `CHECKOUT_TRUST_PROXY: "true"` pada service store kedua
environment. Verifikasi runtime terhadap proxy ter-deploy tetap belum
(memerlukan staging).

## Answer

### Acceptance IDs
M01–M03, X01–X06, C01–C07, F01–F03, T01–T06, P01–P03, S01–S04, A01–A04, D01,
D03, dan komponen pause R01: **implemented + tested** (bukti per ID di
[`../evidence-register.md`](evidence-register.md) §2). D02: rehearsal lokal
PASS, rehearsal deployment **blocked**. R01 UAT/release: **blocked**. Tidak ada
klaim seluruh suites/UAT/launch selesai.

### File yang berubah
- Baru: `apps/store/src/lib/discounts-integration.db.test.ts` — cross-slice L+T:
  Markdown qty2/multi-line × manual percentage (rate/cap, alokasi 12308/7692,
  snapshot L == order, consume), public fixed (15385/9615), manual shipping
  delivery (original30000/subsidi20000/net10000/payable400000), publish revisi
  dan pause setelah preview tanpa order/usage parsial.
- `e2e/store/discounts-coupon-mock.spec.ts` — fixture + test browser manual ×
  percentage (kode canonical, total149850, Redemption benefit15000/allocation
  15000/provider disc15000, detail order).
- `deployment/{staging,production}/docker-compose.yml` — `CHECKOUT_TRUST_PROXY:
  "true"` untuk store (memperbaiki fail-closed production).
- Baru: `docs/deployment-docs/discounts-cutover.md`; index
  `docs/deployment-docs/README.md`; bagian regresi/rehearsal di
  `docs/testing/README.md`; register `.scratch/discounts/ticket/evidence-register.md`.
- Tidak ada perubahan schema/generated SQL, seed, logging runtime, atau route.

### Command + environment + hasil
- `npm run verify:types:store` PASS; `npm run verify:types:admin` PASS.
- `npx vitest run apps/store/src/lib/discounts-integration.db.test.ts`
  (DB disposable `marketplace_discounts_test_20261026`): **5 passed, 1 guard-skip**.
- `npm run verify:batch:unit` (serial): **147 file passed / 2 skipped; 1706 test
  passed / 15 skipped** (skip = guard environment/opt-in, bukan pass).
- Mock Playwright isolated (`playwright.mock.config.ts`):
  `discounts-coupon-mock` **12 passed**; `discounts-admin-mock` +
  `discounts-usage-mock` **10 passed**; `checkout-review-mock` + `markdown-mock`
  **25 passed**. Tidak ada run yang gagal; PNG tidak dibuka.
- `npm run db:check` PASS; `npm run build:store` PASS; `npm run build:admin` PASS;
  focused eslint file baru 0 error.
- Rehearsal DB disposable: `drizzle-kit migrate` 52 migrasi PASS; `seed.ts` dua
  kali PASS; inspeksi gate `0`, 0 kolom timestamp tanpa timezone, 81 FK, demo
  fixed/percentage/shipping + kode manual + usage/Redemption; `SEED_MODE=jubelio`
  PASS tanpa product/order/cart/Offer dummy; `NODE_ENV=production seed.ts`
  exit1 menolak; `reset.ts` 55→0 tabel. DB rehearsal di-drop.
- Preflight gate/version: `verify:batch:unit` memuat `PRICING_UNSUPPORTED_VERSION`,
  gate `0` menolak mutasi admin/checkout, dan seed menulis gate eksplisit `0`.
- Context7 checkpoint: tidak ada API library eksternal baru yang dipakai pada
  ticket ini (hanya test/doc/config); tidak ada permintaan provider nyata.

### Update — cutover legacy voucher (keputusan pemilik, dihapus)

Dihapus: `apps/store/src/app/api/vouchers/validate/route.ts`,
`apps/store/src/lib/vouchers.ts` + test, `docs/features/vouchers.md`, entri
`docs/api-reference.md`, blok seed voucher di `packages/db/src/seed.ts`,
test voucher di `e2e/store/checkout.spec.ts`, dan `voucherId` pada DTO admin
order. Verifikasi ulang dengan `DATABASE_URL=<db-disposable>` eksplisit:
types store/admin PASS; batch unit **148 file pass, 1703 test pass/12 skip**;
build store+admin PASS; `SEED_MODE=demo seed.ts` pada DB disposable PASS
(`voucher` rows **0**, gate `0`). Grep memastikan tidak ada consumer
`vouchers/validate`/`computeVoucherDiscount` tersisa. Tabel `voucher` dan
kolom `orders.voucher_id` tetap inert sampai migrasi destruktif diputuskan.

### Gap yang tidak diklaim selesai
- UAT staging + sign-off, standard `test:e2e` live-provider (butuh otorisasi),
  deployment/rollback rehearsal target, aktivasi gate `1`, rilis publik. Gate
  environment tetap `0`; tidak ada deployment/provider write/commit/push.
- Insiden environment (dicatat jujur): `.env` root berubah eksternal pada
  2026-10-22 22:31 WIB menjadi `storefront` + `SEED_MODE=jubelio`; satu command
  `db:seed` (sebelum diketahui) berjalan pada DB dev `storefront`, bukan DB
  disposable. DB itu sekarang berisi 2 client/2 user tanpa katalog (mode
  Jubelio), **tidak** di-reset oleh agent. Recovery (`db:reset`+`db:seed` demo
  atau restore backup) menunggu keputusan pemilik. Semua validasi ulang memakai
  `DATABASE_URL` disposable eksplisit.
- Bukti provider P01–P03 tetap pada envelope existing (evidence08/T1–T3/M1–M2 +
  controlled adapter tests), bukan pengujian ulang provider nyata.
