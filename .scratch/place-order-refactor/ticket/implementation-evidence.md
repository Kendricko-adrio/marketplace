# Evidence implementasi refactor place-order

Tanggal verifikasi akhir: **2026-11-10**. Spec: [place-order-refactor.md](../plan/place-order-refactor.md).

## Scope dan baseline

- Instruksi user: implementasikan spec, **hanya refactor tanpa perubahan logic existing**. Spec lengkap dan struktur sembilan modul tetap menjadi kontrak.
- Baseline: `d64c14f04a1e4a4a199a5223c4955a961e92320d`; `route.ts` baseline berisi 1.800 baris.
- Worktree sudah dirty sebelum pekerjaan dimulai. Perubahan discounts/admin, skills, `AGENTS.md`, `CONTEXT.md`, package manifests, schema/seeder terkait fitur lain tidak disentuh atau dimasukkan ke commit refactor.
- User memilih **review langsung**, bukan subagents. Tidak ada delegasi atau klaim review independen.
- User mengizinkan PostgreSQL lokal yang tersedia. Dibuat DB baru **`marketplace_discounts_test_place_order_refactor`** pada instance lokal yang sama. `db:push` dan seed demo hanya dijalankan pada DB baru ini; DB aplikasi `storefront` tidak di-reset, di-seed atau di-schema-sync untuk pekerjaan ini. Guard disposable existing tidak dilemahkan.
- Tidak ada provider write nyata, perubahan deployment, remote action atau push. E2E menggunakan provider loopback mock; integration tests menggunakan doubles provider.

## Hasil struktur

Route menjadi HTTP adapter: auth, bounded body reader, validasi, admission/payment adapter, serialization, dan recovery accepted-result. Query berada di repository; urutan transaksi dan provider berada di service. Sembilan modul baru:

1. `apps/store/src/features/checkout/place-checkout-service.ts`
2. `apps/store/src/features/checkout/place-order-legacy-service.ts`
3. `apps/store/src/features/checkout/place-order-repository.ts`
4. `apps/store/src/features/checkout/place-order-input.ts`
5. `apps/store/src/features/checkout/place-order-errors.ts`
6. `apps/store/src/features/checkout/place-order-promo.ts`
7. `apps/store/src/features/checkout/place-order-pricing.ts`
8. `apps/store/src/features/checkout/place-order-delivery.ts`
9. `apps/store/src/features/checkout/place-order-jubelio-request.ts`

`apps/store/src/features/checkout/place-order-service.ts`, `route.test.ts`, lima spec E2E existing dan `packages/db/src/schema/` tidak diubah. Dokumentasi struktur aktual diperbarui di `docs/architecture/code-organization.md`.

### Refinement signature, tanpa perubahan scope/perilaku

- Admission masuk orchestrator sebagai callback bisnis `admit(carriesManualCode)`; pembacaan header tetap dilakukan HTTP adapter pada titik admission existing, bukan meneruskan request atau logger.
- Payment adapter legacy dan v2 tetap terpisah. Callback legacy mempertahankan pembacaan `x-e2e-payment-mock`/environment pada saat payment dibuat, bukan saat import/request dimulai.
- Delivery menerima `branch: { id }` selain `branchId` agar snapshot tetap menggunakan ID row branch hasil lookup, sama dengan expression existing; hasil sukses membawa keenam field pricing/snapshot/address/candidate/promo.
- Repository mempertahankan perbedaan owner lock dengan/tanpa `limit(1)` dan query fresh-client. `saveCheckoutAddress` memiliki owner lock, stable scoped hash dan dedup dengan empat `step(...)` existing.
- Pricing memiliki helper tambahan `calculatePlaceOrderSubtotal` dan `buildLegacyPickupPricing` dalam modul yang sama agar kalkulasi legacy tidak tertinggal di orchestrator. Subtotal tetap dihitung **sebelum** requote, termasuk jalur legacy delivery; decimal formatting legacy tidak disamakan dengan v1.
- Outcome rejection berupa discriminated domain union; service tidak membuat `Response`/`NextResponse`, membaca `requestId`, atau menentukan HTTP headers. HTTP status/header dan canonical request ID diserialisasi route.

## Checkpoint dependency dan UX

- Context7 checkpoint: `/vitest-dev/vitest/v4.1.12` — dikonfirmasi `vi.hoisted` untuk state mock factory, `vi.useFakeTimers` dan cleanup global/env. Runner terpasang: Vitest 4.1.10. Sumber: dokumentasi API Vitest yang dikembalikan Context7.
- API Zod, Drizzle dan Next.js production hanya dipindahkan dari implementation existing; tidak menambah/mengganti library API/options. Lookup tambahan tidak diperlukan untuk ekstraksi murni API yang telah ada. Pola DB tests mengikuti `checkout-attempt-repository.db.test.ts` dan installed types, lalu diverifikasi typecheck dan PostgreSQL nyata.
- Panduan installed Next.js yang dibaca: `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route.md`.
- UX visual gates: **N/A — backend-only**; tidak ada perubahan UI, copy, navigasi, permission, atau flow. E2E mock existing tetap dijalankan untuk parity jalur pengguna, bukan klaim redesign atau audit visual baru.

## Baseline, RED dan focused GREEN

| Tahap | Command / observasi | Hasil |
|---|---|---|
| Sebelum ekstraksi | `verify:unit:slice` pada `route.parity.test.ts` dan existing `route.test.ts` | Existing 10 tests PASS. Tiga kekeliruan fixture baru diperbaiki berdasarkan constructor/literal existing, tanpa mengubah production code. |
| Baseline input/workflow | `npm run verify:unit:slice -- apps/store/src/app/api/checkout/place-order/route.parity.test.ts` | **22 PASS pada handler lama**, sebelum ekstraksi input/error. |
| RED modul input/error | Focused tests `place-order-input.test.ts`, `place-order-errors.test.ts` | FAIL karena modul belum ada; bukan behavior bug baru. |
| GREEN input/error | Focused input/error + POST parity + existing route tests | PASS; existing assertions tidak diubah. |
| RED repository/payload/pricing/promo | Masing-masing explicit test path sebelum helper terkait tersedia | FAIL karena export/modul belum ada, lalu focused GREEN sesudah ekstraksi. DB execution ditunda ke final gate. |
| Characterization lifecycle | `route.lifecycle-parity.test.ts` ditambahkan bertahap sebelum ekstraksi payload, pricing, promo, delivery dan legacy/orchestrator | Baseline awal 9 tests PASS, kemudian 21/24/25 tests PASS untuk delivery, replay/conflict dan save alamat. |
| Baseline asli yang dapat direproduksi | Salinan sementara `route.ts` dari commit baseline; `PLACE_ORDER_BASELINE_MODULE=./route.baseline npm run verify:unit:slice -- apps/store/src/app/api/checkout/place-order/route.lifecycle-parity.test.ts` | **25 PASS** dengan clock/UUID bisnis terkontrol. File baseline sementara sudah dihapus, tidak masuk commit. |
| Parity sesudah ekstraksi | Test yang sama, tanpa override baseline module | **25 PASS** pada refactor. Assertions mengunci status/body/header, provider payload, TTL/reference, cart/persistence/compensation dan forbidden calls. |
| Observability parity | Bandingkan urutan record JSON baseline vs refactor, field `module`, `level`, `message`, serta proyeksi `error.name/message/code` | **131 vs 131 event identik**, first difference `-1`. Canonical request ID berbeda antar-request; stack path/baris berubah karena pemindahan file dan tidak dianggap event drift. |
| RED/GREEN kalkulasi legacy saat review | `verify:unit:slice -- .../place-order-pricing.test.ts`, lalu ditambah `route.lifecycle-parity.test.ts` | RED export belum tersedia; GREEN **28 tests**. Final gate diulang setelah refinement ini. |
| L0 per slice | `npm run verify:types:store` | PASS pada setiap checkpoint terkait dan final integrated code. |

Expected nilai uang berasal dari literal independen: legacy pickup `2000.00 + 220.00 = 2220.00`; legacy delivery barang `2000` + ongkir `500` + PPN `275` = `2775`; v1 delivery PPN barang `220`, total `2720`. Test token setup memakai helper fingerprint/signing untuk membentuk input valid, bukan sebagai oracle total/payload expected.

## Final gate — integrated code

Seluruh command DB/E2E menggunakan `DATABASE_URL` **eksplisit** ke DB disposable di atas, tanpa menuliskan kredensial ke artefak.

| Command | Hasil akhir |
|---|---|
| `npm run verify:types:store` | **PASS**. |
| `npm run test:unit -- --no-file-parallelism` | **193 file PASS; 2266 tests PASS, 12 skipped**, tidak ada kegagalan. Skipped tetap dilaporkan, bukan dianggap PASS. |
| `npm run verify:unit:slice -- apps/store/src/features/checkout/place-order-repository.db.test.ts apps/store/src/features/checkout/checkout-attempt-repository.db.test.ts` | **2 file / 43 tests PASS** pada PostgreSQL disposable; juga tercakup final full suite. Repository baru mencakup ownership, source lock sorting, atomic/stale hold, dedup alamat, rollback dan dua checkout concurrent. |
| `npm run verify:batch:e2e -- e2e/store/versioned-checkout-mock.spec.ts e2e/store/checkout-review-mock.spec.ts e2e/store/delivery-order-mock.spec.ts e2e/store/checkout-stock-adjustment-mock.spec.ts e2e/store/logging-mock.spec.ts` | **47 PASS** pada final integrated code. Tidak ada perubahan terhadap spec E2E existing. |
| ESLint explicit route, sembilan modul dan seluruh test baru | **PASS tanpa error/warning**. Command lengkap di bawah. |
| Review diff scope dan `git diff --check` | PASS; tidak ada schema/API/UI/deployment/provider-write nyata atau file unrelated pada scope refactor. |

Command ESLint dijalankan dari `apps/store`:

```bash
npx eslint src/app/api/checkout/place-order/route.ts \
  src/app/api/checkout/place-order/route{.parity,.lifecycle-parity}.test.ts \
  src/features/checkout/place-checkout-service{,.test}.ts \
  src/features/checkout/place-order-{input,errors,repository,pricing,promo,delivery,jubelio-request,legacy-service}.ts \
  src/features/checkout/place-order-{input,errors,repository.db,pricing,promo,jubelio-request}.test.ts
```

### Kegagalan lingkungan yang didiagnosis, bukan diakali

Final full suite pertama tanpa explicit `DATABASE_URL` memuat `.env` development melalui setup existing: 9 suite ditolak guard non-disposable, sementara 2080 tests PASS. Guard tidak diubah. Dengan explicit disposable URL, sembilan file tersebut **118 PASS / 1 skipped** pada focused run, lalu full suite PASS. Sesudah review mengekstrak sisa kalkulasi legacy, final types/full unit/E2E diulang untuk integrated code terbaru dengan hasil pada tabel di atas.

Playwright mengeluarkan warning aspect ratio logo existing; tidak diperbaiki karena unrelated dengan refactor. Tidak ada test E2E gagal dan tidak membuka screenshot kegagalan.

## AC → evidence

| AC | Evidence aktual | Status |
|---|---|---|
| AC01 | Sembilan modul tersedia; review route/service bebas query dan objek HTTP domain; types + lint PASS. Orchestrator hanya mengatur workflow, repository mengatur persistence, domain helper mengatur kalkulasi/payload. | Verified |
| AC02 | Baseline 22 POST tests + 25 lifecycle tests pada handler asli dan refactor; status/body/header/canonical request ID dipertahankan. Existing `route.test.ts` tidak diubah; final full suite dan E2E PASS. | Verified |
| AC03 | Unit input/pricing/promo/payload, lifecycle pickup/delivery contract0/1; E2E checkout-review termasuk public/manual shipping dan acknowledgement replacement; nilai literal independen. | Verified |
| AC04 | Lifecycle POST mencakup sukses delivery legacy/v1, promo rejection langsung, changed service/origin/pricing, data error, pricing exception dan exception generik. Final delivery-order dan checkout-review E2E PASS termasuk snapshot original/net dan fingerprint. | Verified |
| AC05 | POST accepted/attempt replay sebelum pause, changed contract dan token expired; conflict tanpa live check/provider write. E2E checkout-review membuktikan lost response, same-key concurrency, replay unknown dan recovery sebelum/sesudah commit. | Verified |
| AC06 | Review jumlah `step(...)`: baseline **19**, legacy service **15** + address repository **4**. Urutan lock, sorted variants/Markdown/cart/stock, tx scope, retry/budget dan callback unchanged. PostgreSQL tests membuktikan source sorting, stale hold refusal, rollback dan satu winner dari dua checkout concurrent; E2E budget/serialization/receipt rollback PASS. | Verified |
| AC07 | POST lifecycle legacy confirmed/rejected/unknown/payment failure/persistence failure dan urutan intent→SO→payment→cart; service legacy benar-benar dijalankan pada PostgreSQL rollback/concurrency tests; 34 integration attempt tests + final E2E membuktikan lifecycle v2/payment/reconciliation. | Verified |
| AC08 | POST baseline asli/refactor menggunakan Date dan UUID bisnis terkontrol; order/reference/payload/expiry (`00:00` → `00:15`) diassert literal. Payload unit provider2/provider3 dan pricing decimals PASS; review config/env dan generator tetap di titik existing. | Verified |
| AC09 | **131 event identik** menurut module/level/message/error projection; structured log scope tidak diteruskan via parameter. Wrapper unchanged dan logging E2E canonical request ID PASS. Tidak ada duplicate logging baru. | Verified |
| AC10 | Final types, full unit, required mock E2E, focused lint dan scope review PASS. Schema, v2 service, existing route/E2E tests unchanged; dokumentasi struktur diperbarui. Review langsung Standards/Spec tersedia di artefak terpisah. | Verified |

## Review dan batas klaim

[Review langsung dua sumbu](code-review.md): tidak ada blocker Standards atau Spec. Tidak mengklaim review independen karena user memilih tanpa subagent.

Tests membuktikan parity pada matrix yang dicatat; bukan pembuktian matematis semua kemungkinan input atau izin provider/staging rollout. Dua belas skipped pada full suite tidak disamarkan sebagai PASS; required DB suite dan lima E2E suite untuk refactor ini semuanya berjalan dan PASS. Legacy `npm run test:e2e` tidak dijalankan karena memerlukan izin terpisah dan bukan final gate mock pada spec ini.

Log temporary berada di luar repo (`/tmp/place-order-*.log` pada shell). Artefak Playwright berada di `playwright/reports/mock/` dan `playwright/results/mock/`, tetap gitignored. DB disposable baru dibiarkan tersedia untuk reproduksi; tidak di-drop tanpa instruksi berikutnya.
