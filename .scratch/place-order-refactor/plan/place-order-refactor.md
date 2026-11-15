# Refactor `place-order/route.ts` ke struktur modular

> Status dan approval plan dicatat hanya di [index fitur](../index.md).
> Struktur 9 modul dan spec lengkap beserta revisi double-check telah disetujui
> user. Hasil implementasi dan verifikasi akhir dicatat di
> [evidence](../ticket/implementation-evidence.md); status lifecycle tetap hanya di index fitur.
> **Jenis:** Refactor struktural murni. **Tidak ada perubahan logic, kontrak
> HTTP, query, error mapping, urutan operasi, atau side effect.**

## Catatan approval

User memberikan approval eksplisit atas spec lengkap beserta revisi double-check,
struktur 9 modul, pengaman no-logic-change, dan AC01–AC10 melalui pesan:
“oke saya sudah cukup oke dengan specnya tolong approve specnya”.
Status plan dicatat di [index fitur](../index.md). Approval spec tidak berarti
instruksi memulai implementasi, delegasi, commit/push, atau perubahan DB.

## Problem Statement

`apps/store/src/app/api/checkout/place-order/route.ts` saat ini ~1800 baris dan
berfungsi sebagai God Handler: ia memuat definisi schema input, kelas error,
pemetaan error→HTTP, query Drizzle (baca cart/item/branch/client, tulis
order/items/stock-hold/intent/checkoutRequest di dalam transaksi panjang),
evaluasi promo pickup & delivery, perakitan pricing snapshot, requote ongkir
delivery, perakitan payload Jubelio Sales Order, orkestrasi provider (dispatch +
compensation), serta dua jalur lifecycle (v2 attempt vs legacy inline). Handler
`placeOrder` sendiri ~1480 baris; seluruh file memuat 46 titik
`NextResponse.json(...)`.
Akibatnya file ini sulit dibaca, sulit diuji per-porsi, dan melanggar konvensi
`maintainable-code` (route.ts wajib tipis: parse/auth/validasi/map/log; tidak
menulis query; tidak memuat orkestrasi provider).

## Solution

Pecah handler menjadi modul-modul cohesive berdasarkan tanggung jawab (bukan
layer global), sesuai `docs/architecture/code-organization.md` dan skill
`maintainable-code`: satu route tipis sebagai HTTP adapter, satu service
orchestrator per operasi, satu repository untuk persistence terfokus, serta
helper domain murni untuk schema, error mapping, promo, pricing, delivery, dan
payload provider. **Setiap baris logika dipindahkan apa adanya** — urutan,
kondisi, kode error, status HTTP, header, level/pesan log, query, dan side effect
dipertahankan persis. Dua jalur lifecycle (v2 `placeCheckout` dan legacy inline)
dipertahankan sebagai dua jalur terpisah; tidak ada penyatuan lifecycle atau
perombakan error boundary. Perubahan struktur tidak boleh mengubah perilaku.

## User Stories

1. Sebagai developer, saya ingin route handler place-order tipis (parse/auth/
   validasi/map/log) sehingga kontrak HTTP-nya terbaca dalam satu layar.
2. Sebagai developer, saya ingin orkestrasi place-order berada di service
   bernama sehingga urutan langkah dan keputusan bisnis terlihat jelas terpisah
   dari HTTP.
3. Sebagai developer, saya ingin query Drizzle place-order terkumpul di
   repository terfokus sehingga tidak tersebar di handler dan dapat diuji
   terisolasi.
4. Sebagai developer, saya ingin pemetaan error place-order→HTTP eksplisit
   berdasarkan fase dan error sehingga boundary recovery dan respons existing
   tidak berubah meskipun kelas error yang sama muncul pada fase berbeda.
5. Sebagai developer, saya ingin schema input place-order berada di modul
   domain murni sehingga dapat dipakai ulang dan diuji tanpa DB/HTTP.
6. Sebagai developer, saya ingin evaluasi promo (pickup & delivery) dan
   perakitan pricing snapshot berada di modulnya sendiri sehingga
   tanggung-jawabnya cohesive dan bukan duplikasi inline.
7. Sebagai developer, saya ingin blok requote delivery berada di modulnya
   sendiri sehingga kompleksitas ongkir terisolasi dari alur utama.
8. Sebagai developer, saya ingin payload Jubelio Sales Order dirakit di modul
   murni sehingga pemetaan provider terpisah dari persistence dan orkestrasi.
9. Sebagai developer, saya ingin jalur lifecycle v2 (`placeCheckout`) tetap
   berada di `place-order-service.ts` yang sudah ada tanpa perubahan, sehingga
   regresi terhindari.
10. Sebagai developer, saya ingin `route.test.ts` yang ada tetap lulus tanpa
    perubahan sehingga kontrak stock-adjustment HTTP terkunci.
11. Sebagai reviewer, saya ingin setiap modul baru lulus deletion test
    (kompleksitasnya nyata, bukan pass-through) sehingga tidak ada
    over-abstraction.
12. Sebagai on-call, saya ingin pesan/level log dan `requestId` kanonik tetap
    identik pasca-refactor sehingga dashboards/alerts tidak drift.
13. Sebagai on-call, saya ingin kontrak HTTP (status, body, header
    `Cache-Control`/`Retry-After`, kode error) tetap identik sehingga klien
    store dan E2E tidak break.
14. Sebagai QA, saya ingin E2E checkout (mock) tetap lulus tanpa perubahan spec
    sehingga perilaku user-visible tidak berubah.

## Implementation Decisions

### Prinsip pengaman (mengikat)

- **Tidak ada perubahan logic.** Setiap kondisi, branch, urutan, query, nilai,
  kode error, status HTTP, header, pesan log, level log, dan side effect
  dipindahkan apa adanya. Tidak ada penyatuan jalur v2 + legacy. Tidak ada
  perubahan kontrak HTTP.
- **Tidak ada query Drizzle di `route.ts` maupun service.** Semua query
  dipindahkan ke repository; service tetap mengatur urutan dan batas transaksi.
- **Tidak ada `NextRequest`/`NextResponse` di service/repository/helper.** Tipe
  HTTP hanya di `route.ts` dan wrapper entry.
- **Logger module-scope, tanpa parameter logger/requestId/request object.**
  Modul baru yang memerlukan logging membuat logger sekali di module scope.
  Untuk event hasil ekstraksi, identifier existing `checkout-place-order`
  dipertahankan; modul murni tanpa event tidak perlu logger.
  Konteks dinamis dibaca saat log ditulis. Dependency `db`/`tx`/provider client
  tetap sah sebagai parameter kerja.
- **Tidak ada `try/catch` tanpa tujuan.** Pemetaan error provider/DB yang
  spesifik dipertahankan persis; tidak boleh menambah `catch` yang hanya
  menulis log lalu melempar ulang.
- **Pemilik error logging tetap di boundary HTTP** (route), kecuali layer bawah
  memang melakukan recovery/compensation nyata (dipertahankan apa adanya).
- **Tidak ada refactor unrelated.** Hanya file dalam call chain place-order yang
  disentuh. Tidak memindahkan folder fitur lain, tidak mengganti endpoint dengan
  Server Action, tidak membersihkan logger di luar chain ini.

### Pengaman parity hasil double-check

- **Pertahankan setiap error boundary.** Catch recovery luar, catch workflow,
  catch transaksi/legacy, catch attempt, catch tax, dan catch delivery memiliki
  fungsi berbeda. Ekstraksi tidak boleh meratakan semuanya menjadi satu catch.
  Mapping ditentukan oleh fase + error + state recovery, bukan kelas error saja.
- Contoh dari `apps/store/src/app/api/checkout/place-order/route.ts`: pada catch
  transaksi, `PricingContractError` menghasilkan 409 / `CHECKOUT_REVIEW_REQUIRED`;
  pada catch workflow menghasilkan 400 / kode aslinya. Keduanya wajib tetap ada.
  `RedemptionReviewChangedError` juga mengalami translasi berbeda menurut fase.
- Catch delivery tetap menangani `DeliveryQuoteDataError` dengan status existing;
  **semua exception lainnya**, bukan hanya `QuoteDeliveryError`, tetap menghasilkan
  409 / `DELIVERY_REPRICE_REQUIRED` dengan `data.services: []`. Respons penolakan
  promo yang saat ini return langsung tidak boleh berubah menjadi exception yang
  tertangkap fallback delivery.
- **Replay mendahului live checks.** Accepted-result replay dan attempt replay
  tetap berjalan sebelum pause, contract/config terbaru, expiry review token,
  pricing, tax, dan stock checks. Request yang sama tidak melakukan provider write
  kedua. Recovery tetap memakai identity/committed dan bounded wait existing.
- **Transaksi tidak didesain ulang.** Pertahankan lock scope/order, sorting,
  conditional update, rollback, setiap batas `step(...)`, dan penggunaan tx yang
  sama. Jangan mengganti beberapa step menjadi satu atau sebaliknya. Pertahankan
  `runCheckoutTransaction` beserta timeout/budget dan retry hanya untuk kondisi
  existing; provider HTTP tetap di luar transaksi.
- **Timing dan input tetap.** Titik serta urutan pembuatan UUID/reference, pembacaan
  config/env, `paymentStartedAt`, dan `expiresAt` dipertahankan. Clock/generator
  hanya dikontrol pada boundary test; ekstraksi tidak memindah pembacaan ke waktu
  import atau menambah pembacaan. Pertahankan perbedaan payment adapter v2 dan
  legacy, termasuk header mock non-production.
- **Tidak melakukan cleanup semantik sambil ekstraksi.** Pertahankan perbedaan
  pickup/delivery, parameter omitted versus eksplisit, null versus undefined,
  sort comparator, dan urutan lookup. Dedup promo hanya boleh jika hasil dan
  parameter tiap jalur telah dikunci characterization tests.
- Angka 80 baris per handler / 300 baris per file hanyalah sinyal review cohesion,
  bukan hard requirement. Struktur 9 modul dipertahankan; perubahan jumlah atau
  tanggung jawab modul perlu diajukan lagi, bukan diputuskan saat implementasi.

### Modul yang dibangun/dimodifikasi (file-level technical blueprint)

Format: path · responsibility · layer · exported contract · test seam.

1. `apps/store/src/app/api/checkout/place-order/route.ts` — **HTTP adapter
   (dimodifikasi; ukuran mengikuti cohesion, bukan target baris).** Tanggung jawab: export `POST =
   withRequestContext(postPlaceOrder, "checkout-place-order")`, fungsi
   `postPlaceOrder` (recovery wrapper + bounded wait untuk 503), resolve auth,
   baca JSON/body/header dan validasi input dalam urutan existing, memanggil
   `placeCheckoutOrder(...)`, lalu memetakan outcome/error ke `NextResponse`.
   Mapping attempt dan accepted-result tetap di HTTP boundary; service tidak
   boleh memanggil `checkoutResultResponse` yang menghasilkan `NextResponse`.
   Perpindahan auth/parse tetap mempertahankan cakupan catch dan log existing.
   `requestId` untuk response dibaca di boundary, bukan diteruskan ke service.
   Export: `POST`. Test seam: `route.test.ts` (tidak berubah) dan
   `apps/store/src/app/api/checkout/place-order/route.parity.test.ts` (baru).

2. `apps/store/src/features/checkout/place-checkout-service.ts` — **use case
   orchestrator (baru).** Tanggung jawab: urutan lengkap operasi place-order
   (kedua jalur): menerima actor dan hasil validasi dari HTTP adapter,
   replay/idempotency gate, pause gate, contract-version
   gate, review-token verify + admission, load cart/items/branch (repository),
   validasi single-branch & operating-hours & Jubelio-linkage, tax preflight,
   perakitan pricing snapshot (pricing module), evaluasi promo (promo module),
   verifikasi review fingerprint + acknowledgement, stock verify, perhitungan
   pricing final, perakitan payment item details, perakitan `createRequest`
   (jubelio-request module), lalu jalur v2 (`placeCheckout`) ATAU jalur legacy
   (`placeOrderLegacy`). Input bertipe (actor store, parsed input, admission
   metadata dan payment dependency, recovery handle); bukan request/session HTTP
   atau logger context. Gate yang membutuhkan header tetap menerima metadata
   bisnis yang dibutuhkan admission tanpa meneruskan request object. Service
   memiliki `isCheckoutPaused` dan `requirePromoAcknowledgements` (dipindahkan
   apa adanya, bukan ditaruh di modul errors).
   Outcome union (`PlaceCheckoutOutcome`) membedakan accepted-result + replay,
   attempt-result, legacy success, dan penolakan expected berfase. Recovery,
   rethrow, dan translasi error dilakukan pada boundary existing masing-masing;
   route hanya melakukan serialization HTTP, bukan menjalankan ulang workflow.
   Tidak memuat `NextRequest`/`NextResponse`. Export: `placeCheckoutOrder`,
   tipe outcome. Test seam: service-level unit test baru (public seam), plus
   `route.test.ts` di boundary.

3. `apps/store/src/features/checkout/place-order-legacy-service.ts` — **use
   case (baru).** Tanggung jawab: jalur legacy — `runCheckoutTransaction(...)`
   callback (owner lock, accepted-replay check, offer reservation lock +
   re-evaluation, variant lock, markdown lock, branch re-check, delivery
   address re-check, cart re-check, pricing-contract validation, address save,
   order insert, redemption reservation, order items insert, discount
   allocations, atomic stock hold, intent record, checkoutRequests insert),
   lalu `dispatchJubelioSalesCreate` di luar transaksi, penanganan
   rejected/manual_review + compensation, dan `initializeReservedOrderPayment`.
   Menerima dependency `db`/`tx`/provider gateway sebagai parameter kerja
   (bukan logger). Dipanggil `place-checkout-service` saat jalur legacy
   dipakai. Export: `placeOrderLegacy`, tipe input/outcome. Test seam:
   service-level unit test (mock db + gateway).

4. `apps/store/src/features/checkout/place-order-repository.ts` — **DAL
   (baru).** Tanggung jawab: query Drizzle terfokus yang saat ini inline:
   `loadCart(userId)`, `loadCartItems(cartId)`, `loadBranch(branchId)`,
   `loadClientEmailVerified(clientId)`, `loadFreshVariants(variantIds)` (+
   `for("update")`), `loadFreshMarkdown(variantIds)`, `loadFreshBranch(branchId)`
   (`for("share")`), `loadFreshCartItems(cartId, ids)`, `loadAddress(addressId,
   userId)`, `loadAcceptedCheckoutRequest(identity)`, `insertOrder(...)`,
   `insertOrderItem(...)`, `holdBranchStock(...)` (conditional update +
   returning), `recordSalesIntent(...)`, `insertCheckoutRequest(...)`,
   `saveCheckoutAddress(...)` (stable id + dedup), `releaseHoldsOnReject(...)`,
   `failOrderOnReject(...)`. Lock ordering dipertahankan persis (grup 3→4→5).
   Tidak memanggil HTTP provider. Menerima `db`/`tx` eksplisit. Export: fungsi
   DAL + tipe input/return. Test seam: `*.db.test.ts` (integration, DB
   disposable) — pattern sama dengan `checkout-attempt-repository.db.test.ts`.

5. `apps/store/src/features/checkout/place-order-input.ts` — **domain murni
   (baru).** Tanggung jawab: `selectedIdsSchema`, `reviewFields`,
   `placeOrderSchema`, `deliveryPlaceOrderBase`, `deliveryPlaceOrderSchema`,
   `REPRICE_REQUIRED_MESSAGE`, serta fungsi `parsePlaceOrderBody(body,
   fulfillmentMethod)` dan `extractPlaceOrderFields(parsed, isDelivery)` yang
   mengembalikan `{ phone, email, selectedItemIds, pickupDate, pickupTime,
   deliveryBody }`. Tidak ada DB/HTTP/import Pino. Export: schema + parser +
   tipe hasil parse. Test seam: unit test murni (input contract).

6. `apps/store/src/features/checkout/place-order-errors.ts` — **kontrak error
   dan hasil berfase (baru), tanpa HTTP runtime.** Tanggung jawab: kelas
   `RouteLogError`, `PromoReservationError`, `InsufficientStockError`, tipe
   `PlaceOrderFailurePhase` (`delivery`, `tax`, `attempt`, `legacy`, `workflow`,
   `recovery`) dan `PlaceOrderFailure` untuk membawa hasil expected yang sudah
   ditentukan oleh catch pemilik fase. Export `classifyPlaceOrderError(phase,
   error): PlaceOrderErrorDecision`; decision membedakan outcome expected,
   rethrow asli, atau translasi error existing. Tidak melakukan DB recovery,
   logging ulang, atau membuat `Response`/`NextResponse`.
   Keputusan yang membutuhkan state recovery tetap dilakukan di service/entry
   pemilik boundary, sebelum classifier. Mapping decision ke status/body/header
   dilakukan di `route.ts` dengan fungsi lokal `mapPlaceOrderError`; tidak ada
   satu global catch pengganti semua boundary. Test seam:
   `apps/store/src/features/checkout/place-order-errors.test.ts` (fase × error)
   dan `route.parity.test.ts` (kontrak HTTP + side effect aktual).

7. `apps/store/src/features/checkout/place-order-promo.ts` — **domain +
   service (baru).** Tanggung jawab: evaluasi promo untuk pickup dan delivery
   yang saat ini terduplikasi. Fungsi `evaluatePromoSelection({ selection,
   clientId, verifiedEmail, pricingSnapshot, fulfillmentMethod,
   shippingBeforeSubsidy })` mengembalikan `{ ok: true, candidate, promo,
   pricingSnapshot } | { ok: false, reason, mapped, message }`. Membungkus
   `evaluateSelectedManualCode`/`evaluateSelectedPublicOffer` +
   `applyOfferBenefitToPricing` + perakitan `CheckoutReviewPromo`. Perbedaan
   parameter pickup vs delivery (fulfillmentMethod, shippingBeforeSubsidy)
   dijadikan parameter; logic identik. Export: `evaluatePromoSelection` + tipe.
   Test seam: unit test (mock `evaluateSelected*`).

8. `apps/store/src/features/checkout/place-order-pricing.ts` — **domain murni
   (baru).** Tanggung jawab: `buildPickupPricingSnapshot(...)`,
   `buildDeliveryBaselineSnapshot(...)`, `finalizePricingFromSnapshot(...)`
   (snapshot→`OrderPricing`, termasuk penimpaan `deliverySnapshot.pricing`),
   dan `buildPlacePaymentItemDetails(...)`. Membungkus `buildPricingSnapshot`,
   `calculateLineItemSubtotal`, `calculateOrderPricing`,
   `buildPaymentItemDetails`. Tidak ada DB/HTTP. Export: fungsi + tipe. Test
   seam: unit test murni.

9. `apps/store/src/features/checkout/place-order-delivery.ts` — **service
   (baru).** Tanggung jawab: blok requote delivery yang utuh: `placeDeliveryQuote
   ({ contractVersion, branchId, deliveryBody, sessionUserId, selectedItems,
   ppnRatePercent, providerTax, effectiveOf, markdownRevisionOf })` mengembalikan
   union `PlaceDeliveryResult`: sukses membawa `{ pricing, deliverySnapshot,
   pricingSnapshot, verifiedNewAddress, offerCandidate, promo }`; penolakan
   membawa outcome expected berfase delivery. Tipe `offerCandidate` tetap
   `PublicOfferCandidate | null` dan `promo` tetap `CheckoutReviewPromo`.
   Kedua nilai wajib diteruskan ke orchestrator untuk fingerprint review dan
   reservation; tidak boleh hilang atau kembali ke nilai awal. Catch delivery
   dipertahankan dalam modul ini sesuai pengaman parity di atas, termasuk
   fallback semua exception non-`DeliveryQuoteDataError`. Membungkus `loadQuoteOriginBranch`,
   `loadRevalidatedDestination`/`loadRevalidatedNewDestination`,
   `loadShipmentParcelConfig`, `quoteDelivery`, `createJubelioShipmentGateway`,
   `buildShipmentParcel`, `createDeliverySnapshot`,
   `compareDeliveryApproval`, `normalizeCheckoutApproval`, dan delegasi evaluasi
   promo ke `place-order-promo`. Urutan dan guard repricing dipertahankan
   persis. Export: `placeDeliveryQuote` + tipe. Test seam: service test (mock
   gateway + delivery-quote-data).

10. `apps/store/src/features/checkout/place-order-jubelio-request.ts` — **domain
    murni (baru).** Tanggung jawab: `buildJubelioSalesCreateRequest({
    selectedItems, pricingSnapshot, branch, sessionUserName, orderId,
    legacyProviderTaxId })` merakit `createRequestBase` + versi
    `providerContractVersion` 2/3. Pemetaan `discAmount`, `taxAmount`, `taxId`
    dipertahankan persis. Tidak ada DB/HTTP. Export: `buildJubelioSalesCreateRequest`.
    Test seam: unit test murni (snapshot input→payload).

11. `apps/store/src/features/checkout/place-order-service.ts` — **use case v2
    (sudah ada, TIDAK diubah).** `placeCheckout`/`replayCheckoutAttempt` tetap
    sebagaimana adanya. `place-checkout-service` memanggilnya untuk jalur v2.

### Dependency & data flow (tidak berubah)

```
POST (route.ts)
  → withRequestContext → postPlaceOrder (recovery wrapper)
    → placeCheckoutOrder (place-checkout-service)   [orchestrator]
        ├─ place-order-input          (parse + fields)
        ├─ place-order-repository     (reads: cart/items/branch/client)
        ├─ prepare-checkout-tax-service (tax preflight, existing)
        ├─ place-order-pricing        (snapshot + finalization + payment details)
        ├─ place-order-promo          (pickup/delivery promo evaluation)
        ├─ place-order-delivery       (requote + approval + snapshot, delivery only)
        ├─ verify-checkout-stock-service (existing)
        ├─ place-order-jubelio-request (SO payload)
        ├─ place-order-service.placeCheckout   (v2 lifecycle path, existing)
        └─ place-order-legacy-service.placeOrderLegacy (legacy path)
             ├─ place-order-repository (writes + locks inside tx)
             ├─ jubelio-sales-lifecycle.dispatchJubelioSalesCreate (existing)
             ├─ checkout-recovery.finalizeRejectedCheckoutCreate (existing)
             └─ payment-initialization.initializeReservedOrderPayment (existing)
    → outcome / error decision berfase (place-order-errors, tanpa HTTP)
    → mapPlaceOrderError lokal di route.ts → NextResponse
```

### Logging (tidak berubah)

- `route.ts`: `createModuleLogger("checkout-place-order")` tetap; pesan
  completion entry/exit dipertahankan.
- Modul yang menerima event hasil ekstraksi membuat logger module-scope dengan
  identifier existing `"checkout-place-order"`. Jangan menggantinya dengan nama
  file baru: field `module` adalah bagian observability yang dipertahankan.
  Pesan, level, urutan event, dan sanitasi error existing tetap; tidak menambah
  entry/exit log atau duplikasi log karena pemindahan layer. Modul murni tanpa
  log tidak diberi logger.
- `requestId` kanonik tetap dari `withRequestContext`; tidak ada ID baru.
tolong lakukan double check lagi pada spec place-order-refactor.md apakah sudah oke atau ada hal yang bisa di improve?
### Schema/DB

- Tidak ada perubahan schema. Tidak ada `db:push`/migrasi. Tidak menyentuh
  `packages/db/src/schema/`.

### Kontrak HTTP (tidak berubah)

- URL `POST /api/checkout/place-order` tetap. Semua status code (`400`/`404`/
  `409`/`502`/`503`/`202`/`201`/`200`/`500`), body shape, header
  `Cache-Control: no-store`, dan `Retry-After` (admission 503) identik.
- Kode error identik: `CHECKOUT_STOCK_ADJUSTED`, `DELIVERY_REPRICE_REQUIRED`,
  `CHECKOUT_REVIEW_REQUIRED`, `PRICING_UNAVAILABLE`, `CHECKOUT_TAX_UNAVAILABLE`,
  `POLICY_UNAVAILABLE`, `UNSUPPORTED_VERSION`, `SALES_ORDER_REJECTED`,
  `CHECKOUT_MANUAL_REVIEW`/`CHECKOUT_PROCESSING`, `REQUEST_KEY_CONFLICT`, dst.

## Testing Decisions

- **Prinsip:** uji perilaku eksternal di public seam, bukan detail internal.
  Assertion existing tidak dihapus atau dilemahkan. **Characterization tests
  baru wajib ditambahkan sebelum ekstraksi** untuk mengunci coverage yang belum
  ada. Expected response dan angka acuan tidak dihitung dengan helper baru yang
  sedang diuji; gunakan literal independen dan observasi implementation lama.
- Tambahkan `apps/store/src/app/api/checkout/place-order/route.parity.test.ts`
  pada boundary `POST` existing **sebelum memindah logic**. Kontrol DB/provider,
  clock, dan UUID; jalankan pada implementation lama untuk baseline PASS, lalu
  jalankan test yang sama setelah tiap ekstraksi terkait. Tidak mengirim write
  ke provider asli. Baseline PASS bukan bukti RED fitur baru: ini refactor
  perilaku existing, bukan permintaan behavior baru.
- Matrix wajib: auth/input invalid; pickup/delivery; contract 0/1; accepted dan
  attempt replay saat live config/pause/token tidak lagi valid; conflict key;
  tax/stock unavailable; promo public/manual/none dan acknowledgement; requote
  changed service/pricing dan exception; legacy SO rejected/unknown/confirmed;
  payment ready/rejected/unknown/persistence failure sesuai lifecycle; recovery
  sebelum/sesudah commit. Assert status/body/header, panggilan yang tidak boleh
  terjadi, payload provider, serta perubahan cart/hold/order/address.
- **Seam utama (boundary, sudah ada, TIDAK diubah):**
  `apps/store/src/app/api/checkout/place-order/route.test.ts` — mengunci
  kontrak stock-adjustment HTTP (pickup + delivery) dengan mock `@/db` +
  `@/lib/route-access` + `fetch`. Mock `vi.mock("@/db")` di-hoist sehingga
  repository/helper baru yang mengimpor `@/db` tetap ter-mock; bentuk query
  tidak berubah maka deteksi tabel mock tetap valid. Spec ini wajib lulus
  tanpa perubahan.
- **Seam layar tambahan yang diusulkan (public, baru):**
  - `place-order-errors.test.ts` — fase × tipe error, termasuk
    `PricingContractError` dan `RedemptionReviewChangedError` pada boundary
    berbeda; status/body/header/log diverifikasi lewat `route.parity.test.ts`.
  - `place-order-input.test.ts` — kontrak parse: pickup vs delivery, validasi
    `selectedItemIds`, `acknowledgements` fingerprint, `promoSelection`
    discriminated union.
  - `place-order-pricing.test.ts` — snapshot pickup/delivery → `OrderPricing`
    + `paymentItemDetails`, dengan nilai acuan dari sumber independen
    (perhitungan manual; jangan memakai fungsi produksi yang diuji sebagai oracle).
  - `place-order-promo.test.ts` — eligibility pickup vs delivery (parameter
    `shippingBeforeSubsidy`), mapping `promo` shape (manual/public).
  - `place-order-jubelio-request.test.ts` — `createRequest` untuk
    `providerContractVersion` 2 dan 3 (discAmount/taxAmount/taxId).
  - `place-order-repository.db.test.ts` — integration (DB disposable), pola
    `checkout-attempt-repository.db.test.ts`: lock ordering, atomic stock hold
    (0-row → `InsufficientStockError`), stable address-id dedup.
  - `place-checkout-service.test.ts` — orchestration sequencing (mock
    repository + provider + pricing/promo/delivery stubs): kedua jalur (v2 vs
    legacy) terpilih dengan benar sesuai `lifecycleSnapshot && attemptIdentity`.
- **Prior art:** `checkout-attempt-repository.db.test.ts`,
  `prepare-checkout-tax-service.test.ts`, `route.test.ts`,
  `versioned-pricing.test.ts`, `order-pricing.test.ts`.
- **E2E (Playwright mock):** spec checkout existing di `e2e/store/` tetap lulus
  tanpa perubahan; eksekusi ditunda ke final gate per verification ladder.

### Final verification (kontrak)

Hasil aktual pada 2026-11-10: types, full unit, PostgreSQL integration dan lima
E2E mock suite PASS. Command, environment, skipped dan AC → evidence tersedia di
[evidence implementasi](../ticket/implementation-evidence.md).

Setelah seluruh scope refactor terintegrasi:

1. `npm run verify:types:store`.
2. `npm run test:unit` dengan environment yang memenuhi prasyarat repo. Catat
   skipped/blocked secara eksplisit; tidak dianggap bukti integration PASS.
3. Dengan `DATABASE_URL` **disposable** yang memenuhi guard test, jalankan:
   `npm run verify:unit:slice -- apps/store/src/features/checkout/place-order-repository.db.test.ts apps/store/src/features/checkout/checkout-attempt-repository.db.test.ts`.
   DB test baru menguji rollback/hold, ownership, dedup alamat, dan concurrency;
   unit mock saja tidak membuktikan semantik PostgreSQL. Jangan reset, seed,
   atau schema-sync DB development user. Setup disposable mengikuti
   `docs/testing/README.md`; bila belum tersedia, AC terkait tetap Pending.
4. Dengan environment mock/disposable sesuai config, jalankan:
   `npm run verify:batch:e2e -- e2e/store/versioned-checkout-mock.spec.ts e2e/store/checkout-review-mock.spec.ts e2e/store/delivery-order-mock.spec.ts e2e/store/checkout-stock-adjustment-mock.spec.ts e2e/store/logging-mock.spec.ts`.
   Path existing ini tercakup `playwright.mock.config.ts` `testMatch`.
   Jika perlu spec mock tambahan, daftarkan terlebih dahulu dalam config.
   Legacy `npm run test:e2e` tetap memerlukan izin terpisah; tidak otomatis
   dijalankan oleh approval refactor.
5. Review diff terintegrasi terhadap matrix parity dan AC berikut. Rekam command,
   hasil, kondisi environment, dan baseline yang dibandingkan; dokumentasi ini
   tidak mengklaim test telah dijalankan. Output disposable tetap di `playwright/`.

## Acceptance criteria dan evidence

Seluruh AC berikut **Verified** pada 2026-11-10. Kolom evidence mempertahankan
kebutuhan pembuktian dari spec; command/spec dan hasil aktual per AC dicatat di
[evidence implementasi](../ticket/implementation-evidence.md). Jumlah test PASS
bukan pengganti pembuktian per AC.

| AC | Kriteria | Evidence yang diperlukan | Status |
|---|---|---|---|
| AC01 | Struktur 9 modul cohesive; tidak ada SQL pada route/service, objek HTTP pada domain/service, atau God Service baru | Review file/import/query dan typecheck store | Verified |
| AC02 | HTTP auth/input, seluruh outcome dan error tetap identik per fase: status, body, header, field opsional | Baseline sebelum ekstraksi dan hasil sesudah dari `route.parity.test.ts`; `route.test.ts` existing tidak diubah | Verified |
| AC03 | Pickup/delivery, contract 0/1, promo public/manual/none, acknowledgement dan pricing tidak drift | Characterization POST dengan expected literal independen; unit pricing/promo/payload terkait | Verified |
| AC04 | Delivery membawa candidate/promo final; changed quote dan seluruh exception mempertahankan boundary repricing existing | Characterization POST sukses delivery, promo rejection, changed service/pricing, data error dan exception generik; payload/fingerprint/reservation sesuai | Verified |
| AC05 | Replay/conflict/recovery tidak membaca ulang live checks atau membuat provider write kedua; committed state dan bounded wait sama | Characterization POST accepted/attempt replay, key conflict dan recovery sebelum/sesudah commit; assert call count dan forbidden calls | Verified |
| AC06 | Lock, scope tx, setiap `step(...)`, retry/budget dan atomic rollback/hold/dedup sama | Review terhadap `checkout-transaction.ts` dan callback lama; focused sequencing tests; integration PostgreSQL disposable termasuk concurrency | Verified |
| AC07 | Urutan SO→payment, penolakan/unknown, compensation, metadata reconciliation dan cart mutation tidak drift pada kedua lifecycle | Characterization POST + unit legacy-service; integration attempt repository; E2E mock terkait | Verified |
| AC08 | UUID/reference/config read dan clock/expiry tetap di titik existing; payload provider dan total sama | Characterization dengan clock/UUID terkontrol dan payload expected independen; review timing pembacaan | Verified |
| AC09 | Identifier module, pesan/level/urutan log dan requestId kanonik tidak berubah; tidak ada duplicate logging | Characterization observability + `e2e/store/logging-mock.spec.ts`; review logger ownership | Verified |
| AC10 | Tidak ada schema/API/UI/provider-write nyata atau perubahan unrelated; existing tests tidak dilemahkan dan final gate lulus | Review diff scope dan evidence seluruh command final; dokumentasi struktur diperbarui di `docs/architecture/code-organization.md` saat implementasi | Verified |

### UX blueprint

N/A — refactor backend tanpa perubahan UI, navigasi, copy, permission, atau alur
checkout. Existing checkout tetap referensi perilaku; E2E mock memeriksa parity
jalur pengguna, bukan memperkenalkan UX baru.

### Checkpoint dependency dan discovery

- Revisi spec ini hanya dokumentasi; tidak menyentuh external API surface sehingga
  tidak memerlukan Context7 inquiry. Sebelum implementasi, pertahankan API calls
  existing; bila ada API library baru/uncertain, lakukan Context7 sesuai AGENTS.md
  dan catat hasilnya sebelum menulis kode terkait.
- `discovery:` sebelum slice 0, inventarisasi seluruh return/catch existing dan
  petakan ke phase matrix + test case di boundary POST. Nomor baris adalah petunjuk,
  bukan baseline permanen; catat working-tree baseline dan jangan menimpa perubahan
  user yang sudah ada. Bug existing dicatat terpisah, tidak dibetulkan di refactor.
- `discovery:` lengkapi signature tipe input/outcome dari tipe existing (actor,
  selected items, tx/step, recovery dan delivery result) sebelum ekstraksi terkait;
  jangan memakai `any`, context bag bebas, atau mengarang normalisasi data. Jika
  kontrak yang dibutuhkan berbeda dari blueprint ini, ajukan revisi terlebih dahulu.
- Pada implementasi, perbarui `docs/architecture/code-organization.md` untuk struktur
  place-order aktual. Ini dokumentasi teknis, bukan perubahan kontrak endpoint.

## Out of Scope

- **Perubahan logic apa pun:** penyatuan jalur v2 + legacy, perubahan urutan
  lock, perubahan pesan/level log, perubahan kode error/status HTTP, perubahan
  query, optimisasi, atau "perbaikan" bug apa pun (jika ditemukan, dicatat
  terpisah, tidak diobrak-abrik dalam refactor ini).
- **Perubahan schema/DB** atau `db:push`.
- **Perubahan kontrak HTTP** (URL, status, body, header).
- **Refactor folder fitur lain** atau pemindahan module `lib/` yang tidak
  termasuk call chain place-order.
- **Penggantian Route Handler dengan Server Action.**
- **Izin commit/push/deploy tidak diberikan oleh approval spec.** Instruksi
  implementasi terbaru user secara terpisah meminta commit melalui skill
  `implement`; tidak ada izin push/deploy.
- **Perubahan `route.test.ts`** atau spec E2E yang ada.

## Further Notes

### Hasil code-review (standar `maintainable-code` + smell baseline)

Review terhadap file existing (bukan diff), mengacu pada
`docs/architecture/code-organization.md` dan skill `maintainable-code`:

**Pelanggaran terdokumentasi (hard):**

- `route.ts` menulis query Drizzle secara langsung (baca cart/item/branch/client
  di top-level, dan 14+ `tx.select/update/insert` di dalam transaksi).
  Konvensi: "route.ts tidak pernah memuat query Drizzle".
- `route.ts` memuat orkestrasi provider (`dispatchJubelioSalesCreate`,
  `initializeReservedOrderPayment`, compensation reject/manual_review).
  Konvensi: orkestrasi provider adalah tugas service.
- Handler memuat workflow bisnis yang semestinya dimiliki service. Panjang
  ~1480 baris adalah sinyal cohesion, bukan pelanggaran batas baris.

**Koreksi hasil review awal:** nested catch bukan pelanggaran dengan sendirinya.
Boundary existing melakukan recovery/translasi yang berbeda dan harus
mempertahankan semantiknya. Angka 46 menghitung titik `NextResponse.json` di
seluruh file, bukan hanya dalam dua catch atau fungsi `placeOrder`.

**Code smells (judgement calls, baseline Fowler):**

- **Long Method / God Method:** `placeOrder` memuat seluruh workflow.
- **Duplicated Code:** blok evaluasi promo pickup vs delivery nyaris identik
  (beda parameter `fulfillmentMethod`/`shippingBeforeSubsidy`); blok
  fingerprint review pickup vs delivery nyaris identik; blok
  `clientRow` read terduplikasi.
- **Data Clumps:** `{ phone, email, selectedItemIds, pickupDate, pickupTime,
  deliveryBody }` berjalan bersama; `{ pricingSnapshot, pricing,
  deliverySnapshot, verifiedNewAddress }` berjalan bersama → kandidat tipe
  `PlaceOrderContext`.
- **Shotgun Surgery / Divergent Change:** satu file diubah untuk alasan
  HTTP mapping, query, promo, pricing, delivery, dan provider sekaligus.
- **Primitive Obsession:** union `parsed.data` di-cast berulang via
  `as { phone: string }` dll. → seharusnya hasil parse bertipe discriminated.
- **Feature Envy (mild):** perakitan `createRequest` dan `deliverySnapshot`
  mengakses banyak field `selectedItems`/`pricingSnapshot` yang sebenarnya
  milik modul pricing/provider-payload.

**Yang sudah benar (dipertahankan):**

- Logger sudah memakai facade `createModuleLogger` + `withRequestContext`;
  `requestId` kanonik; tidak ada parameter logger/requestId diteruskan.
- Error kelas sudah memisahkan expected outcome (`PromoReservationError`,
  `InsufficientStockError`) dari unexpected (`RouteLogError` untuk log).
- Sebagian besar domain sudah terekstrak ke `lib/` dan `features/checkout/`
  (`versioned-pricing`, `order-pricing`, `discount-selection`,
  `discount-reservation`, `delivery-quote`, `checkout-request`,
  `checkout-transaction`, `checkout-review`, `place-order-service` v2). Yang
  tersisa adalah orkestrasi + query inline + error mapping.

### Catatan risiko & mitigasi

- **Risiko terbesar: "no logic change" tergelincir saat ekstraksi.** Mitigasi:
  (a) `route.test.ts` wajib lulus tanpa modifikasi sebagai gerbang pertama;
  (b) characterization tests dibangun sebelum ekstraksi, dengan matrix
  fase × error dan assertion status/body/header/side effect;
  (c) review diff slice-per-slice hanya memindahkan blok, bukan menulis ulang.
- **Risiko mock `@/db` di `route.test.ts` pecah.** Mitigasi: bentuk query
  (tabel, join, where-param, limit) tidak berubah; repository memakai `@/db`
  yang sama; mock di-hoist. Pada slice 2, jalankan `route.test.ts` dan
  characterization terkait setelah pemindahan query baca.
- **Risiko urutan lock transaksi berubah.** Mitigasi: `place-order-legacy-service`
  mempertahankan urutan langkah `step(...)` persis; repository tidak
  menentukan urutan, service yang menentukan.
- **Risiko over-abstraction.** Mitigasi: setiap modul baru lulus deletion test;
  jika sebuah modul hanya pass-through atau menjadi God Service baru, catat
  temuan dan ajukan revisi struktur. Pilihan 9 modul tidak boleh diubah diam-diam
  saat implementasi; jumlah baris bukan alasan menambah wrapper.

### Urutan implementasi yang disarankan (slice, tetap butuh approval terpisah)

0. Tambahkan characterization coverage di `route.parity.test.ts` dan rekam
   baseline implementation lama (termasuk kondisi awal dirty worktree). Tidak
   memulai ekstraksi cabang sebelum coverage parity cabang itu tersedia.
1. Ekstrak `place-order-input.ts` + `place-order-errors.ts` (schema + kontrak
   error berfase; tanpa meratakan catch). Gerbang: focused unit + parity.
2. Ekstrak `place-order-repository.ts` (reads dulu, lalu writes). Gerbang:
   focused unit + parity; tulis coverage DB, eksekusinya di final gate.
3. Ekstrak `place-order-pricing.ts` + `place-order-promo.ts` +
   `place-order-jubelio-request.ts`. Gerbang: unit test baru + `route.test.ts`.
4. Ekstrak `place-order-delivery.ts`. Gerbang: `route.test.ts`.
5. Ekstrak `place-order-legacy-service.ts` (transaksi + provider dispatch).
   Gerbang: focused unit + parity; coverage DB dieksekusi di final gate.
6. Rangkai `place-checkout-service.ts` + rampingkan `route.ts`. Gerbang final:
   `npm run test:unit` + E2E checkout mock + `verify:types:store`.

Setiap slice: `npm run verify:types:store` dan
`npm run verify:unit:slice -- <explicit unit test paths>` untuk file terdampak,
termasuk `route.test.ts`/`route.parity.test.ts` bila relevan. Jangan menjalankan
full suite atau DB/integration/E2E per slice secara default; final gate mengikuti
bagian verifikasi di atas. Tidak menjalankan ulang evidence yang tidak terdampak.
