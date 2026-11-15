# Spec: Checkout attempt sebelum pembentukan order

## 1. Tujuan dan approval

Customer yang menekan **Bayar Sekarang** tidak mendapatkan order `failed_payment` ketika SO Jubelio ditolak atau pembayaran belum berhasil disiapkan. Customer tetap di checkout, menerima error yang dapat ditindaklanjuti, dan tidak kehilangan input/cart.

Status plan hanya dicatat di [index fitur](../index.md).

### Kesepahaman yang dikonfirmasi user

Dalam percakapan penyusunan spec, user memilih:

1. **Tanpa row order**, bukan sekadar menyembunyikan order gagal dari customer.
2. Scope mencakup **SO + inisialisasi pembayaran**.
3. User mengonfirmasi ringkasan scope dengan jawaban **“Sesuai, tulis draft”**: attempt terpisah, order setelah SO dan pembayaran siap, retry aman, pickup dan delivery, tanpa penghapusan order historis.

### Gate approval

- Kesepahaman sebelum draft: **dikonfirmasi**, sesuai keputusan di atas.
- Approval complete spec, technical/UX blueprint, acceptance, dan verification: **disetujui user** melalui pesan “oke setuju. tolong jalankan perubahan”. Approval hanya untuk implementasi scope ini; bukan commit/deployment/delegasi.
- Dokumen ini belum mengizinkan implementasi, publikasi breakdown ticket, subagent, commit, provider write nyata, remote access, atau deployment.
- Keputusan teknis dan copy di bawah adalah rancangan untuk direview bersama complete spec, bukan klaim implementasi existing.

## 2. Fakta existing dan akar masalah

Referensi dari root repo; line number merujuk working tree saat evaluasi:

| Fakta terverifikasi melalui pembacaan kode | Referensi |
|---|---|
| Order `pending_payment` dibentuk sebelum provider dipanggil | `apps/store/src/app/api/checkout/place-order/route.ts:1170` |
| SO intent dan checkout request di-commit sebelum SO create | `apps/store/src/app/api/checkout/place-order/route.ts:1319–1342` |
| Definitive SO rejection melepas hold tetapi mengubah order ke `failed_payment` | `apps/store/src/lib/checkout-recovery.ts:46–86` |
| Wrapper mengganti response error dengan accepted result jika receipt sudah ada | `apps/store/src/app/api/checkout/place-order/route.ts:259–272` |
| Accepted result memakai `success: true`, termasuk state `failed` | `apps/store/src/lib/checkout-request.ts:91–115` |
| Frontend mengarahkan response dengan order ID ke detail jika payment belum tersedia | `apps/store/src/app/checkout/page.tsx:1001–1006`; recovery juga pada `:334–338` dan `:1053` |
| Existing test secara eksplisit mengharapkan rejected SO tetap menghasilkan accepted failed order | `e2e/store/checkout-review-mock.spec.ts:943–967` |
| Checkout request dan SO ledger saat ini mempunyai FK wajib ke order | `packages/db/src/schema/checkout.ts`; `packages/db/src/schema/jubelio-sales.ts` |
| Redemption mempunyai FK ownership ke order; allocation juga bergantung pada order/item | `packages/db/src/schema/discounts.ts:550–640`, `:750–805` |
| Webhook mencari order sebelum pemrosesan; belum mengenali attempt | `apps/store/src/app/api/webhooks/midtrans/route.ts:65–83` |
| Admin review melakukan inner join SO ledger ke order sehingga attempt tanpa order akan hilang dari antrean | `apps/admin/src/app/api/admin/reviews/sales-operations/route.ts:61–86` |

**Akar masalah:** batas “checkout diterima” ditempatkan sebelum keberhasilan SO dan persiapan pembayaran. Order juga menjadi pemilik seluruh evidence/recovery. Menahan redirect saja tidak memenuhi keputusan tanpa row order.

Batas evidence: belum ada reproduksi dinamis, pemeriksaan database/log order pada screenshot, atau test run baru. Alasan spesifik provider menolak transaksi screenshot belum diketahui. Spec ini memperbaiki lifecycle kegagalan, bukan mengklaim memperbaiki penyebab penolakan provider tersebut.

## 3. Scope dan non-scope

### Termasuk

- Checkout pickup dan delivery, dengan/tanpa promo; semua jalur new checkout existing harus berakhir pada lifecycle yang sama, bukan hanya cabang pricing versi tertentu.
- Attempt durable sebelum external write; idempotency, snapshot harga/item/fulfillment, stock hold dan promo reservation tanpa row `orders`.
- SO create, payment initialization, compensation SO, promotion menjadi order, replay, recovery, webhook race, dan sweep.
- Feedback di checkout, input/cart preservation, serta safe retry.
- Minimal adaptasi admin review agar attempt ambigu dapat ditemukan tanpa membuat order palsu.
- Schema, generated migration, seeder, tests, API/feature/deployment documentation yang terdampak.

### Tidak termasuk

- Menghapus/mengonversi failed order historis atau memperbaiki transaksi nyata screenshot secara otomatis.
- Mengubah rumus pricing, PPN, ongkir, eligibility/capacity promo, metode pembayaran, atau fulfillment delivery/pickup.
- Mengganti lifecycle pembayaran **setelah** SO dan payment session berhasil disiapkan serta order berhasil dipromosikan. Terminal failure/nonterminal payment attempt existing tetap dipertahankan; jangan mengubah semua `deny`/`cancel` menjadi terminal failure.
- Menambah auto-retry external POST yang mungkin sudah terkirim, menebak SO lewat pencarian note yang belum terbukti, atau menganggap GET payment `404` selalu berarti Snap session tidak pernah dibuat.
- Dashboard recovery baru, manual refund otomatis, atau tombol operator yang melakukan provider write. Antrean read-only existing hanya diperluas untuk visibility.
- Worker/queue, env var, endpoint cron, atau jadwal baru. Gunakan existing sweep dengan pekerjaan bounded.

## 4. Invariant utama

1. Selama SO belum confirmed dan payment session belum berhasil disiapkan, **jumlah row `orders` untuk attempt adalah nol**. Tidak membuat lalu menghapus row sementara.
2. Tidak ada `order_items`, allocation order, notification/email order gagal, atau entry riwayat order untuk attempt gagal sebelum promotion.
3. Attempt dan provider operation evidence boleh retained terpisah dari order; akses customer tetap owner-scoped.
4. `orderId` publik non-null hanya sesudah promotion commit. Sebelum itu gunakan `attemptId`/`requestKey`, bukan tautan detail order.
5. External HTTP tidak berada dalam transaksi database. Intent tersimpan sebelum POST; claim atomik memberi izin satu dispatch, bukan janji exactly-once lintas jaringan.
6. Response timeout, HTTP 5xx, crash, atau local persistence failure **bukan** bukti external write tidak terjadi.
7. Stock dan promo tidak dilepas saat hasil SO/payment/cancel masih ambigu. Retry baru tidak tersedia sampai semua side effect aman atau tertangani.
8. Harga, cart quantities, fulfillment, provider request, dan payment amount saat recovery berasal dari frozen approved snapshot; tidak dihitung ulang dari master terbaru.
9. Satu attempt paling banyak mempromosikan satu order. Replay tidak menambah hold, pemakaian promo, SO, payment session, atau order.
10. Cart hanya dikonsumsi pada promotion; jangan menghapus perubahan cart yang dibuat customer di tab lain setelah snapshot.
11. Kegagalan promotion setelah external success diselesaikan sebagai recovery commit lokal, bukan pembatalan/gagal bayar palsu.
12. Attempt yang belum selesai memblokir new placement milik client yang sama di server, termasuk request key baru, tab lain, atau checkout pickup/delivery lain. Ini konsisten dengan serialisasi client checkout; browser lock saja tidak cukup.

## 5. Model data dan batas pembentukan order

### 5.1 `checkout_attempt`

Tambahkan entity di `packages/db/src/schema/checkout.ts`; bukan tabel app-local.

Field konseptual wajib:

- `id`, `clientId`, `requestKey`, `fingerprint`, `lifecycleVersion`.
- `reservedOrderId`: identifier bisnis yang direservasi untuk provider reference dan order yang kelak dipromosikan; **bukan FK dan bukan row order**. Tetap stabil untuk seluruh attempt.
- `orderId` nullable: FK `orders.id`, hanya terisi bersama promotion.
- `state`, `failureCode`, safe failure message, reservation/payment deadline, timestamps `timestamptz`.
- Frozen versioned snapshot: pricing, item identity/quantity/name/prices, branch, fulfillment/address/service, contact, offer terms/result/allocation proposal, selected cart identity dan versi/quantity yang diperlukan untuk conditional consumption.
- Durable payment operation evidence: provider reference, dispatch state/claim, known transaction identifier bila tersedia, hasil session (token/redirect yang dibutuhkan), expected amount dan verification outcome. Data sensitif hanya server-side; jangan menaruh token/snapshot lengkap pada status DTO/log.
- Stock accounting marker/lines untuk memastikan reserve, confirmed SO mirror, dan release tepat satu kali. JSON snapshot bukan pengganti counter/constraint accounting.

Constraint: unique `(clientId, requestKey)`, unique `reservedOrderId`, unique nullable `orderId`; valid states/version; owner consistency saat promotion. Tambahkan index bounded sweep dan pencegah lebih dari satu unresolved attempt per client. Terminal attempt tidak menghalangi percobaan berikutnya.

### 5.2 Entity existing

- `checkout_request`: tetap accepted receipt untuk order yang benar-benar sudah dipromosikan. Insert **bersama promotion**, tidak sebelum SO create. Unique key attempt dan receipt harus menunjuk identity/fingerprint yang sama; lookup membaca keduanya dengan aturan legacy eksplisit.
- `jubelio_sales_operation`: izinkan create/cancel dimiliki attempt sebelum order ada. Tambahkan `checkoutAttemptId`, jadikan `orderId` nullable dengan constraint **setidaknya satu owner**. Legacy rows tetap order-owned. Setelah promotion attempt-owned row mendapat `orderId` tanpa kehilangan attempt provenance. Unique operation per owner/type, reference, serta consistency kedua owner wajib dijaga; jangan membolehkan operasi orphan atau order milik attempt berbeda. Invoice/payment settlement tetap hanya untuk promoted order.
- `discount_redemption`: tambahkan attempt ownership dengan composite owner constraint ke client; `orderId` nullable untuk pre-promotion. Satu Redemption retained per attempt dan satu per promoted order. Gunakan counter Offer/client existing dan lifecycle `reserved → consumed/released`; jangan membuat sistem kuota kedua. Promotion menautkan reservation yang sama, bukan reserve ulang. `order_discount_allocation` baru ditulis dari frozen proposal saat order/items ada.
- Stock hold memakai line snapshot attempt serta branch counters existing. Semua accounting create/reject/cancel memilih owner attempt/order dengan benar; promotion tidak menambah/mengurangi hold lagi.
- Address baru yang diminta disimpan: tahan sebagai draft snapshot dan baru insert atomik pada promotion; checkout gagal tidak menambah address-book row. Snapshot yang dipakai provider tetap stabil meskipun master address berubah kemudian.
- `packages/db/src/seed.ts`: FK-ordered cleanup dan contoh attempt rejected, unresolved, serta promoted yang realistis; tidak ada orphan atau token nyata.

**Keputusan struktur:** ubah ownership ledger/reservation existing, jangan duplikasi seluruh SO/promo ledger untuk attempt. Ditolak: order tersembunyi, membuat-lalu-delete order, external HTTP dalam transaksi, atau mematikan FK untuk melewati lifecycle.

## 6. State machine, compensation, dan recovery

| State attempt | Kondisi | Row order | New attempt |
|---|---|---:|---|
| `preparing` | Validasi final dan reserve committed; SO/payment diproses melalui durable claim | Tidak | Diblokir |
| `compensating` | Payment pasti gagal sebelum session ada; SO confirmed perlu dibatalkan | Tidak | Diblokir |
| `processing` | External success diketahui tetapi commit lokal belum selesai / recovery aman sedang berjalan | Tidak | Diblokir |
| `manual_review` | Hasil external write/cancel belum dapat dipastikan atau bukti bertentangan | Tidak | Diblokir |
| `rejected` | Gagal pasti dan semua side effect sudah aman; reservation dilepas sekali | Tidak | Diizinkan setelah review baru |
| `promoted` | SO confirmed + session payment siap + promotion commit | Tepat satu | Mengikuti aturan order/cart existing |

Dispatch state provider disimpan terpisah dari state ringkas attempt: `intent`, `dispatched_unknown`, `confirmed`, `rejected`, `manual_review`, `aborted` atau enum payment ekuivalen yang terdefinisi. Tidak memanggil POST lagi dari state possibly-sent.

### Alur sukses

1. Auth store/onboarding, admission, ownership, live stock, reviewed pricing/quote/promo dan slot pickup dicek seperti existing.
2. Transaksi bounded: lock client → attempt/request identity → Offer/usage/client usage → stock/cart/related rows dalam urutan konsisten; validasi final, reserve stock/promo, persist snapshot + SO intent. Belum insert order.
3. Dispatch SO sekali; simpan returned ID segera dan lakukan independent GET verification existing. Update stock mirror/accounting atomik, tanpa mengasumsikan `order_items` sudah ada.
4. Persist payment intent dengan reference stabil; claim lalu create session satu kali di luar transaksi.
5. Persist hasil session. Transaksi promotion: insert order/items dari snapshot dengan `reservedOrderId`, attach ledger dan Redemption, insert allocations + accepted receipt + optional saved address, consume cart secara conditional, tandai attempt `promoted`. Tidak reserve ulang dan tidak memperpanjang deadline.
6. Response baru boleh memuat order ID/redirect payment setelah commit. Provider session siap bukan berarti customer sudah membayar; order awal tetap `pending_payment` kecuali authoritative webhook sudah membuktikan paid.

### Failure matrix

| Titik gagal | Tindakan wajib |
|---|---|
| Sebelum reserve transaction commit | Rollback; tidak ada external POST/order/hold parsial; validasi error existing |
| SO pasti ditolak sebelum apply | Tanpa Midtrans call/cancel SO; release stock/promo sekali; attempt `rejected`; tampilkan error checkout |
| SO mungkin diterima, ID belum ada | `manual_review`, tahan hold/promo; tidak re-POST dan tidak init payment |
| SO ID ada, verifikasi GET belum selesai | GET-only reconcile berdasarkan ID tersimpan; belum boleh init payment |
| Payment pasti ditolak **tanpa session/transaksi tercipta** | Persist compensation intent; cancel SO sekali dan GET-verify hasilnya; rejected/retryable hanya setelah cancellation dan release confirmed |
| Payment timeout atau response hilang | Jangan langsung cancel SO atau release reservation; hasil pembayaran mungkin ada. Rekonsiliasi lewat kemampuan provider yang sudah diverifikasi; bila tak cukup bukti, `manual_review` |
| Payment berhasil, penyimpanan session/promotion gagal | Jangan membuat payment kedua atau menyatakan gagal; tetap unresolved, recover metadata dan promotion. Jika hasil session hilang total dan tidak bisa dipulihkan, manual review |
| Cancel ditolak/timeout | Tetap unresolved/manual review; tidak melepaskan hold atau mengizinkan new attempt hanya berdasarkan local failure |
| Process crash setelah intent belum diklaim | Sweep boleh claim intent yang benar-benar belum dikirim setelah eligibility/deadline diperiksa |
| Process crash sesudah dispatch claim | Tidak mengulang POST; reconcile by known ID/authoritative evidence atau manual review |
| Reservation deadline lewat | Abort intent yang belum pernah dikirim; jika mungkin/sudah dikirim, periksa external status dan compensation. Deadline lokal tidak otomatis membuktikan aman melepas hold |
| Payment paid sebelum promotion selesai | Verifikasi signature + amount + authoritative status; serialisasi dengan attempt, recover promotion dan jalankan paid settlement existing satu kali. Jangan mengabaikan pembayaran karena row order belum ada |

**Penting:** best-effort `expireMidtransTransaction()` existing menelan error, sehingga bukan bukti compensation berhasil. Satu GET status `404` juga tidak cukup untuk menyatakan Snap create tidak terjadi. Klasifikasi definitive failure wajib memakai bukti API yang diperiksa, bukan sekadar `catch`.

### Replay dan safe retry

- Key sama + fingerprint sama: kembalikan current attempt/order outcome tanpa reserve atau dispatch ulang.
- Key sama + fingerprint berbeda: `409 REQUEST_KEY_CONFLICT`.
- Unresolved attempt client + key baru: `409 CHECKOUT_ATTEMPT_IN_PROGRESS`; kembalikan owner-safe recovery DTO attempt lama, jangan buat attempt/SO/payment baru.
- Rejected terminal: tetap retained; key lama selalu mengembalikan rejection yang sama. Customer meminta review terbaru; submit berikutnya memakai key baru.
- Browser menyimpan pending identity sampai outcome diketahui. Definitive rejection membersihkan pending blocker tetapi mempertahankan form/pilihan/cart; invalidasi review/confirmation agar stok/harga/quote/promo diperiksa ulang.
- Reload/lost response: baca attempt lama dahulu; jika promoted gunakan hasil order yang sama. Jangan redirect ke detail hanya karena suatu payload mempunyai identifier.
- GET request lookup read-only: tidak melakukan reserve, SO POST, payment initialization, compensation, atau promotion.
- Sweep menangani progress/recovery bounded memakai existing endpoint; customer tidak wajib mempertahankan tab terbuka.

## 7. Kontrak HTTP dan webhook

Pertahankan endpoint existing. Tambahkan discriminated lifecycle contract untuk checkout baru; reader legacy tetap eksplisit.

### DTO publik baru

`CheckoutAttemptResult` berisi `version: 2`, `requestKey`, `attemptId`, `state`, `orderId: string | null`, `paymentAvailable`, `redirectUrl: string | null`, `retryAllowed`, `failureCode: string | null`, `message`, `expiresAt: string | null`.

- `paymentAvailable` dan redirect hanya ketika promoted, payment pending, session tersimpan, dan deadline belum lewat. Paid order mengarah ke detail, bukan payment lagi.
- Jangan expose `reservedOrderId`, snapshot kontak/alamat, ledger raw error, payment token, atau raw provider response.
- `retryAllowed: true` hanya rejected aman; bukan petunjuk untuk replay POST possibly-sent.

### `POST /api/checkout/place-order`

| Outcome | HTTP | Body |
|---|---:|---|
| Order baru berhasil dipromosikan | 201 | `success: true`, `data: CheckoutAttemptResult` dengan `state: promoted` |
| Replay promoted | 200 | Hasil order yang sama |
| Proses belum selesai/ambigu | 202 | `success: false`, `code: CHECKOUT_PROCESSING` atau `CHECKOUT_MANUAL_REVIEW`, recovery DTO, `orderId: null` |
| SO definitive rejection | 409 | `success: false`, `code: SALES_ORDER_REJECTED`, rejected DTO, safe message |
| Payment init definitive failure, compensation tuntas | 502 | `success: false`, `code: PAYMENT_INITIALIZATION_REJECTED`, rejected DTO |
| New key saat unresolved attempt ada | 409 | `success: false`, `code: CHECKOUT_ATTEMPT_IN_PROGRESS`, DTO attempt yang sama |
| Request key conflict / validasi / reprice / promo | Existing status/code | Pertahankan semantik existing; tidak diam-diam membuat order tanpa promo |

Semua response `Cache-Control: no-store`, canonical `x-request-id`; error mempunyai `requestId`. **Hapus recovery override yang mengubah rejected attempt menjadi checkout success.** HTTP 202 bukan sukses membentuk order.

### `GET /api/checkout/requests/{requestKey}`

- `200 { success: true, data }` berarti lookup berhasil, **bukan checkout berhasil**. State menentukan UI.
- Lookup attempt terlebih dahulu dan receipt/order existing secara versioned; unknown/non-owner tetap 404 tanpa membocorkan keberadaan data.
- Legacy accepted receipt mempertahankan reader existing, tidak diinterpretasi ulang sebagai attempt baru.

### Webhook Midtrans

- Signature validation tetap wajib sebelum mutasi; authoritative re-verification dan expected amount dari frozen snapshot tetap wajib.
- Resolve reference ke order existing atau `checkout_attempt.reservedOrderId`. Reference unknown bukan alasan membuat order baru.
- Persist event yang sudah tervalidasi secara durable melalui attempt repository sebelum acknowledge; minimal transaction ID/status/version/verification evidence, tanpa menyimpan raw PII. Gunakan idempotency key/event identity dan guard transisi.
- Jika belum dapat diverifikasi/persist, kembalikan retryable error sesuai kontrak vendor; jangan acknowledge lalu membuang event.
- Event/promoter/sweep race harus mengambil lock/claim yang sama. Pembayaran valid tidak boleh diproses dua kali, dan counter/fulfillment tidak boleh berjalan sebelum promotion berhasil.
- Settlement setelah SO sudah cancelled adalah exceptional paid/manual-review case. Tidak boleh auto-fulfill atau dilabeli rejected retryable. Jika perlu membentuk paid-but-blocked order, hanya dari bukti SO pernah confirmed + payment nyata verified; ini pemulihan external success, bukan failed initialization order.

## 8. Technical blueprint

Semua path berikut relatif root repo. Nama modul baru adalah rancangan dalam scope spec ini; tidak membuat generic repository atau memindahkan seluruh route ke satu God Service.

### 8.1 File runtime dan schema

| Path | Aksi | Tanggung jawab / layer | Public test seam |
|---|---|---|---|
| `packages/db/src/schema/checkout.ts` | modify | Attempt schema, snapshot/result types, constraints, indexes / schema | DB ownership/uniqueness/state tests |
| `packages/db/src/schema/jubelio-sales.ts` | modify | Attempt/order ownership ledger + provenance / schema | Attempt/order FK dan operation claim |
| `packages/db/src/schema/discounts.ts` | modify | Redemption attempt owner, promotion ownership / schema | Counter/reservation/concurrency |
| `packages/db/src/schema/index.ts` | modify bila export belum tercakup | Export schema baru / shared schema | Import/typecheck |
| `packages/db/src/seed.ts` | modify | Fixtures lifecycle / script | Seed/reset smoke pada DB disposable |
| `packages/db/src/seed-cleanup.ts` | modify | Existing FK-ordered cleanup registry / persistence script support | `packages/db/src/seed-cleanup.test.ts` |
| `packages/db/drizzle/` | generated only | Migration audit; jangan hand-edit SQL / generated | Fresh migration + upgrade fixture |
| `apps/store/src/features/checkout/checkout-attempt.ts` | create | DTO/domain states, approved snapshot, typed inputs/outcomes / pure domain | Unit state/response policy |
| `apps/store/src/features/checkout/place-order-service.ts` | create | Admission → reserve → SO → payment → promote untuk new checkout / service | Public place outcome dengan controlled gateways |
| `apps/store/src/features/checkout/prepare-checkout-service.ts` | create | Orkestrasi final reviewed inputs/live-stock/quote; reuse pricing policy existing / service | Invalidasi/expiry/reprice tanpa side effect |
| `apps/store/src/features/checkout/checkout-attempt-repository.ts` | create | Scoped identity lookup, locks, reservations, snapshot dan atomic promotion/rejection; transaksi terfokus / repository | DB rollback/concurrent placement/cart preservation |
| `apps/store/src/features/checkout/initialize-checkout-payment-service.ts` | create | Durable payment intent/claim, classify result dan persistence / service | Lost response, rejected vs ambiguous |
| `apps/store/src/features/checkout/compensate-checkout-service.ts` | create | Definitive failure compensation; retry gate setelah verified cancellation / service | Repeated compensation/cancel unknown |
| `apps/store/src/features/checkout/recover-checkout-service.ts` | create | Resume intent aman, GET reconciliation, local promotion repair, deadline handling / service | Crash windows dan bounded sweep |
| `apps/store/src/features/checkout/process-checkout-webhook-service.ts` | create | Validated event ke attempt atau existing order, race-safe promotion/finalization / service | Early/duplicate/late webhook |
| `apps/store/src/app/api/checkout/place-order/route.ts` | modify | Parse/auth/HTTP mapping ke service; tidak menyimpan query/orkestrasi provider / route | Placement HTTP/E2E |
| `apps/store/src/app/api/checkout/requests/[requestKey]/route.ts` | modify | Owner-scoped status lookup + legacy reader; read-only / route | Lookup/replay E2E |
| `apps/store/src/app/api/webhooks/midtrans/route.ts` | modify | Signature boundary + delegation, map acknowledgement / route | Signed webhook integration |
| `apps/store/src/app/api/cron/sweep-reservations/route.ts` | modify | Existing auth/budget, call attempt recovery terpisah dari legacy order sweep / route | Cron/attempt recovery integration |
| `apps/store/src/lib/checkout-request.ts` | modify | Legacy reader, versioned attempt reader adapter; HTTP mapping pindah ke route / compatibility | Legacy/new result contract |
| `apps/store/src/lib/checkout-recovery.ts` | modify | Pertahankan recovery legacy order; new attempts ke service baru / compatibility | Old pending/rejected rows |
| `apps/store/src/lib/jubelio-sales-operations.ts` | modify | Owner-aware ledger lookup/claim tanpa duplicate POST / persistence | Ledger DB tests |
| `apps/store/src/lib/jubelio-sales-lifecycle.ts` | modify | Create/cancel accounting mendukung attempt snapshot; order settlement tetap guarded / existing lifecycle | SO holds/crash recovery tests |
| `apps/store/src/lib/jubelio-sales-settlement.ts` | modify | Bedakan ledger attempt dan promoted/legacy order saat sweep / existing lifecycle | Tidak settlement attempt belum promoted |
| `apps/store/src/lib/discount-reservation.ts` | modify | Reserve Redemption untuk attempt; allocation hanya saat promotion / persistence/domain | Reservation DB tests |
| `apps/store/src/lib/discount-lifecycle.ts` | modify | Lookup/release/promote owner-aware tanpa counter ganda / persistence/domain | Discount lifecycle DB tests |
| `apps/store/src/lib/midtrans.ts` | modify | Typed definite/ambiguous initialization outcome dan verified status evidence; existing vendor wrapper / client | Vendor adapter mock tests |
| `apps/store/src/lib/payment-initialization.ts` | modify | Batasi helper lama pada legacy call sites; jangan gunakan compensate-on-any-error untuk attempt / compatibility | Existing helper regression |
| `apps/store/src/lib/order-finalize.ts` | modify hanya integrasi terpengaruh | Pertahankan paid/failed existing, jangan kirim failed-order notification untuk attempt / existing lifecycle | Paid settlement dan expiry regression |
| `apps/store/src/lib/jubelio-channel-mirror.ts` | modify bila owner-aware typing membutuhkan | Jangan memproyeksikan attempt sebagai failed order; mirror order-only setelah promotion / existing integration | Channel mirror regression |
| `apps/store/src/app/checkout/page.tsx` | modify | Discriminated result handling, form preservation, recovery/retry; tanpa blanket redirect / UI | Checkout failure E2E |
| `apps/store/src/components/checkout/CheckoutAttemptFeedback.tsx` | create | Inline error/progress/recovery dari state DTO; tidak melakukan provider call / UI | Role/copy/keyboard E2E |
| `apps/admin/src/lib/discount-operations-read.ts` | modify | Proyeksi attempt Redemption tanpa mengasumsikan order ada / query module | Existing read DB tests |
| `apps/admin/src/lib/discount-usage-drift.ts` | modify | Hitung active attempt reservations; bukan orphan order / query module | Drift DB regression |
| `apps/admin/src/features/orders/checkout-attempt-review-repository.ts` | create | Branch-scoped unresolved attempt projection, tanpa raw snapshot / repository | Admin owner/branch DB tests |
| `apps/admin/src/app/api/admin/reviews/sales-operations/route.ts` | modify | Tambah attempt projection melalui repository; auth `orders:view` existing / route | Branch-scoped review integration |
| `apps/admin/src/app/admin/orders/reviews/page.tsx` | modify | Tampilkan attempt tanpa link detail order palsu / UI | Admin attempt review E2E |

Route `place-order` existing besar: ekstraksi dibatasi placement call chain yang memang berubah. Reuse evaluator/admission/quote/input existing; jangan membuat evaluasi harga kedua. Service bebas SQL/HTTP request object; repository bebas external HTTP. Existing legacy modules boleh tetap untuk kompatibilitas, tetapi logika baru mengikuti feature-first.

### 8.2 Exported contracts (tanpa body)

Tipe input lengkap wajib memuat actor store dan domain fields, bukan `NextRequest`, logger, atau arbitrary DB rows.

- `checkout-attempt.ts`: `CheckoutAttemptState`, `CheckoutAttemptResult`, `CheckoutAttemptSnapshot`, `PlaceCheckoutInput`, `CheckoutActor`, `ProviderOperationOwner = { kind: 'attempt'; attemptId: string } | { kind: 'order'; orderId: string }`.
- `place-order-service.ts`: `placeCheckout(input: PlaceCheckoutInput): Promise<CheckoutPlacementOutcome>`.
- `prepare-checkout-service.ts`: `prepareCheckout(input: PlaceCheckoutInput): Promise<PreparedCheckout>`; memakai existing validators/evaluators.
- `checkout-attempt-repository.ts`: `reserveCheckoutAttempt(input: ReserveCheckoutAttemptInput): Promise<ReservedAttemptOutcome>`; `readOwnedCheckoutAttempt(input: { clientId: string; requestKey: string }): Promise<CheckoutAttemptResult | null>`; `claimCheckoutPayment(input: { attemptId: string }): Promise<PaymentClaimOutcome>`; `recordCheckoutPaymentEvidence(input: PaymentEvidenceInput): Promise<void>`; `promoteCheckoutAttempt(input: { attemptId: string }): Promise<PromotedCheckout>`; `finalizeRejectedCheckoutAttempt(input: { attemptId: string; reason: CheckoutFailureCode }): Promise<CheckoutAttemptResult>`; `listRecoverableCheckoutAttempts(input: { limit: number; cutoff: Date }): Promise<RecoverableAttempt[]>`; `recordVerifiedCheckoutPaymentEvent(input: VerifiedCheckoutPaymentEvent): Promise<void>`.
- `initialize-checkout-payment-service.ts`: `initializeCheckoutPayment(input: { attemptId: string }): Promise<CheckoutPaymentOutcome>`.
- `compensate-checkout-service.ts`: `compensateCheckoutAttempt(input: { attemptId: string; reason: CheckoutFailureCode }): Promise<CheckoutAttemptResult>`.
- `recover-checkout-service.ts`: `recoverCheckoutAttempts(input: { limit: number; cutoff: Date }): Promise<CheckoutRecoverySummary>`; `recoverCheckoutAttempt(input: { attemptId: string }): Promise<CheckoutAttemptResult>`.
- `process-checkout-webhook-service.ts`: `processCheckoutPaymentEvent(input: VerifiedMidtransWebhook): Promise<CheckoutWebhookOutcome>`; gunakan verified input type existing, verifikasi authoritative tetap di workflow.
- `jubelio-sales-operations.ts` / `jubelio-sales-lifecycle.ts`: existing create/cancel/lookup entry menerima `ProviderOperationOwner` pada call sites baru; legacy order input dipertahankan melalui adapter eksplisit. Payload provider tidak berubah karena ownership berubah.
- `discount-reservation.ts` / `discount-lifecycle.ts`: reserve/find/release menerima typed owner; order allocations dan consume tetap order-only. `promoteCheckoutAttempt` menautkan Redemption dalam transaksi yang sama.
- `midtrans.ts`: create wrapper mengembalikan `CheckoutPaymentOutcome` (`ready`, `definitive_rejection`, `unknown`), dengan durable reference yang sama; exact SDK classifier harus diverifikasi, bukan menyimpulkan semua exception definitive.
- `CheckoutAttemptFeedback.tsx`: `CheckoutAttemptFeedback(props: { result: CheckoutAttemptResult; busy: boolean; onCheckStatus: () => void; onReviewAgain: () => void }): ReactNode`.
- `checkout-attempt-review-repository.ts`: `listCheckoutAttemptReviews(input: { actor: AdminOrderReviewActor; limit: number }): Promise<CheckoutAttemptReviewRow[]>`; branch authorization dekat query.
- `checkout-request.ts`: reader baru `readOwnedCheckoutStatus(clientId: string, requestKey: string): Promise<CheckoutAttemptResult | LegacyCheckoutResult | null>`; `readCheckoutResult` existing tetap legacy-only sampai consumer dimigrasikan.

### 8.3 Discovery/checkpoint teknis

Tidak ada library API code ditulis dalam pekerjaan spec ini. **Context7 dilewati untuk perubahan docs-only.** Sebelum implementasi, catat library IDs dan hasil inquiry Next.js/Drizzle/Vitest/Playwright serta package lain yang API-nya disentuh; fallback hanya installed types/source atau vendor docs jika Context7 tidak tersedia.

- `discovery:` pastikan dari official Midtrans docs + installed SDK klasifikasi error Snap create, kemampuan recovery session setelah response hilang, dan acknowledgement/retry webhook. Jangan mengandalkan status transaction `404` sebagai bukti ketiadaan Snap session. Jika tidak ada cara membuktikan aman, fallback yang sudah ditetapkan adalah manual review, bukan auto-retry.
- `discovery:` inventaris seluruh consumer `jubelio_sales_operation.orderId` dan `discount_redemption.orderId`, termasuk store/admin jobs, untuk nullable ownership. Jika ditemukan perubahan file di luar blueprint, tambahkan path dan seam sebelum implementasi bagian itu; product behavior baru perlu approval ulang.
- `discovery:` uji lock order dan conditional cart consumption dengan field existing `cart_item`; jika tidak ada version seam yang cukup, tambahkan schema version field melalui pembaruan blueprint, bukan menghapus cart yang sudah berubah.
- `discovery:` ukur bounded sweep budget existing untuk attempt recovery agar legacy paid settlement/expiry tidak starvation. Jangan menambah jadwal/env diam-diam.

## 9. UX blueprint

### Referensi, hierarki, reuse

- Referensi customer: `apps/store/src/app/checkout/page.tsx`, terutama review ulang/reprice/promo rejection existing; bukan halaman failed order sebagai reference state checkout.
- Referensi admin: `apps/admin/src/app/admin/orders/reviews/page.tsx`, existing read-only review table dan branch restrictions.
- Pertahankan header, stepper, form alamat/kurir/pickup, summary harga/promo, spacing dan token existing. Tidak redesign checkout atau shared theme.
- Feedback ditempatkan dekat action pembayaran dan tetap terlihat; jangan mengganti seluruh halaman dengan pending-request screen yang menghilangkan form/context. Toast boleh melengkapi tetapi bukan satu-satunya error.
- Satu primary action sesuai state: **Bayar Sekarang**, **Periksa ulang pesanan**, atau **Periksa status checkout**. Tidak menampilkan dua CTA submit/recovery yang bersaing.

| Elemen | Reuse / baru | Path | Treatment |
|---|---|---|---|
| CTA | Reuse | `packages/ui/src/components/ui/button.tsx` | Existing primary/outline; loading existing |
| Summary/surface | Reuse | `packages/ui/src/components/ui/card.tsx` | Existing checkout card, tanpa warna/radius baru |
| Inline feedback | Baru, feature-local | `apps/store/src/components/checkout/CheckoutAttemptFeedback.tsx` | Semantic destructive/muted tokens; icon + text, bukan color-only |
| Alamat/kurir | Reuse | `apps/store/src/components/checkout/DeliveryQuotePanel.tsx` | Pilihan dipertahankan; lock perubahan intent saat unresolved |
| Promo | Reuse | `apps/store/src/components/checkout/PromoSelector.tsx` | Pilihan tetap, effective benefit harus direview ulang setelah rejection |
| Operator review table | Reuse | `apps/admin/src/app/admin/orders/reviews/page.tsx` | Attempt row dengan badge, reference, branch, stage; tanpa link order jika belum ada |

### State matrix dan final copy

| State | Copy final | Aksi/behavior |
|---|---|---|
| Idle + approved | Existing review copy | **Bayar Sekarang**; enabled hanya setelah existing confirmation valid |
| Submitting | **Menyiapkan pesanan...** | Disable double submit dan perubahan intent; tetap di checkout |
| SO rejected | **Pesanan belum dibuat. Produk belum dapat dipesan. Periksa ulang pesanan lalu coba lagi.** | **Periksa ulang pesanan**; input/cart tetap, tidak otomatis submit |
| Payment rejected + compensation tuntas | **Pembayaran belum dapat disiapkan. Pesanan belum dibuat. Periksa ulang pesanan lalu coba lagi.** | **Periksa ulang pesanan** |
| Compensation berjalan | **Pembayaran belum dapat disiapkan. Kami sedang menyelesaikan proses checkout sebelumnya.** | **Periksa status checkout**; new submit disabled |
| Processing/local commit recovery | **Checkout masih diproses. Periksa status sebelum mencoba lagi.** | **Periksa status checkout**; tidak redirect ke detail yang belum ada |
| Manual review | **Status checkout belum dapat dipastikan. Jangan buat checkout baru. Tim kami perlu memeriksa proses ini.** | **Periksa status checkout**; tidak menjanjikan hasil/ETA otomatis |
| Network/lookup error | **Koneksi terputus. Periksa status checkout sebelum mencoba lagi.** | Pending identity tetap disimpan; **Periksa status checkout** |
| Re-review loading | **Memeriksa ulang pesanan...** | Gunakan preview/requote existing; disable submit |
| Re-review berubah/tidak eligible | Existing reprice/promo/stock reason yang aman | Tampilkan perubahan; confirmation ulang wajib, jangan apply otomatis |
| Promoted payment ready | **Mengarahkan ke pembayaran...** | Redirect session tersimpan hanya setelah promotion commit |
| Promoted paid atau payment tidak tersedia lagi | Status order existing | Ke detail **order yang sudah ada**; tidak membuat session/order baru |
| Empty cart tanpa pending attempt | Existing empty-cart copy + **Mulai Belanja** | Existing behavior |
| Empty/berubah cart dengan pending attempt | Copy processing/manual-review yang sesuai | Jangan menghilangkan recovery karena cart kosong/berubah |
| Permission/session expired | **Sesi Anda berakhir. Masuk kembali untuk memeriksa checkout.** | **Masuk** memakai existing auth flow; jangan buang identity lokal atau tampilkan data setelah logout |
| Unsaved form | Existing input tetap pada definitive rejection | Pending unresolved menggunakan frozen snapshot; jangan menimpa dengan cart/master terbaru |
| Admin unresolved attempt | Badge **Checkout belum selesai**; stage **Sales Order**, **Pembayaran**, atau **Pembatalan Sales Order** | Tampilkan attempt reference dan safe reason, tanpa detail-order link; read-only |

Setelah rejected, selected promo/address/courier tetap merupakan pilihan draft, bukan janji masih valid. Review baru boleh meminta user memilih ulang jika eligibility/layanan benar-benar berubah.

### Responsive/accessibility

- Verifikasi customer pada mobile 390×844 dan desktop 1440×900; admin pada desktop serta layout responsif existing. Feedback/action tidak overflow atau tertutup sticky summary.
- Error `role="alert"`, progress `role="status"`; hindari pengumuman duplikat setiap polling.
- Setelah definitive rejection, focus ke feedback yang dapat difokuskan programmatically; CTA review dapat dijangkau keyboard. Setelah review selesai kembalikan focus ke confirmation/primary action existing.
- Keyboard focus terlihat, teks tidak color-only, contrast mengikuti token existing: 4.5:1 teks biasa, 3:1 large text/cue non-text yang berlaku. Tidak mengklaim full WCAG compliance hanya dari automated check.
- Prototype tidak diminta; tidak ada binding prototype baru. Referensi existing dan state/copy dalam spec menjadi review target.

## 10. Acceptance criteria dan test matrix

Semua assertion jumlah order bersumber dari DB berdasarkan reserved business identity/attempt owner, bukan hanya tidak melihat order di UI. Provider call counts diperiksa dari mock capture independen.

1. **SO reject, pickup dan delivery:** tidak ada order/items/order allocation; tidak ada Midtrans initialization; cart/input tetap; stock/promo released sekali; tetap URL checkout, inline error terlihat, tidak ada failed-order email/notification.
2. **Payment definite failure:** SO dibuat sekali, cancellation intent/POST sekali; sebelum cancellation confirmed new attempt ditolak; sesudah confirmed tidak ada order dan reservation dilepas sekali.
3. **Cancel timeout/rejected:** nol order; retry tidak diizinkan; reservation tidak dilepas; operator melihat attempt tanpa memerlukan order.
4. **SO/payment timeout:** nol order sampai external readiness terbukti; POST tidak diulang melalui submit/reload/recovery/sweep; copy tidak menyatakan pembayaran gagal pasti.
5. **Sukses:** tepat satu order/items/receipt/allocation, reference provider tetap sama; redirect hanya sesudah promotion commit; cart dikonsumsi sesuai snapshot; deadline tidak diperpanjang.
6. **Response hilang sesudah promotion:** lookup/replay mengembalikan order/session sama; satu SO/payment/order; tidak meminta customer checkout ulang.
7. **Crash injection:** sebelum/sesudah SO claim/returned ID/verification, payment claim/returned session/persistence, sebelum/sesudah promotion commit. Tiap window berakhir aman atau held review tanpa double dispatch/hold.
8. **Webhook awal/duplikat/out-of-order:** valid reference resolve ke attempt; signature/amount mismatch tidak mempromosikan; verified paid tidak hilang; race webhook/promoter/sweep hanya satu promotion/paid claim/settlement.
9. **Cross-tab/key:** unresolved attempt + key baru diblokir server; key sama beda fingerprint conflict; key sama identical replay tidak reserve ulang. Terminal rejected dapat review dan membuat attempt baru tanpa menghidupkan attempt lama.
10. **Promo concurrency:** kapasitas terakhir tidak oversold antara attempt baru dan legacy order; released reservation retained; promotion tidak mengubah total reserved usage; paid consume sekali.
11. **Cart concurrency:** tab lain mengubah quantity, varian, menghapus item atau menambah item selama attempt; promotion tidak menghapus cart baru/yang berubah. Order tetap memakai approved snapshot, bukan cart terbaru.
12. **Security:** lookup client lain 404; admin review mematuhi branch scope dan permissions; snapshot/token/raw error tidak muncul di API, HTML, atau logs.
13. **Legacy regression:** order/receipt/SO operations existing tetap terbaca dan dapat diselesaikan/expired melalui lifecycle lama; current deny/cancel/expiry rules tidak berubah; order gagal historis tetap ada.
14. **New checkout compatibility:** semua supported checkout entry paths memakai attempt lifecycle; tidak ada legacy bypass untuk new order. Existing repay endpoint hanya menerima promoted/legacy order owned yang eligible; attempt reference ditolak, tidak menciptakan payment baru.
15. **UX:** pickup/delivery error/recovery/review bisa dilakukan dengan keyboard/mobile; form tidak hilang ketika server menolak atau koneksi putus; tidak ada blanket redirect oleh status lookup/reload.
16. **Migration/seed:** fresh schema dan upgrade dengan legacy fixtures sama-sama valid; constraints menolak ownerless/mismatched/duplicate entities; seed/reset menghasilkan attempt lifecycle yang dapat diperiksa.

### File tests

- Baru: `apps/store/src/features/checkout/checkout-attempt.test.ts`, `place-order-service.test.ts`, `checkout-attempt-repository.db.test.ts`, `initialize-checkout-payment-service.test.ts`, `compensate-checkout-service.test.ts`, `recover-checkout-service.db.test.ts`, `process-checkout-webhook-service.db.test.ts` pada direktori fitur yang sama.
- Baru: `packages/db/src/schema/checkout.test.ts`, `apps/admin/src/features/orders/checkout-attempt-review-repository.db.test.ts`.
- Update existing SO ledger/holds/recovery, discount reservation/lifecycle, order finalizer, Midtrans initialization, cron tests serta `apps/admin/src/lib/discount-operations-read.db.test.ts`; assertions rejected-SO lama diganti sesuai kontrak baru, tidak sekadar dihapus.
- Baru: `e2e/store/checkout-attempt-mock.spec.ts`, `e2e/admin/checkout-attempt-review-mock.spec.ts`; daftarkan keduanya di `playwright.mock.config.ts` `testMatch`.
- Update `e2e/store/checkout-review-mock.spec.ts`, `e2e/store/delivery-order-mock.spec.ts`, `e2e/store/versioned-checkout-mock.spec.ts` dan regression promo yang kontraknya berubah.
- `discovery:` lokasi mock provider/payment harness ditentukan dengan membaca `playwright.mock.config.ts` dan dependencies-nya sebelum menambahkan failure/timeout/early-webhook scenarios; jangan memakai write Jubelio nyata sebagai pengganti mock.

## 11. Verification, migrasi, dan dokumentasi

### Verification ladder

- TDD: satu vertical behavior slice, failing test dulu di public seam; jalankan red → green oleh main agent. Subagent tidak diizinkan dalam pekerjaan saat ini.
- L0 per slice: `npm run verify:types:store`; `npm run verify:types:admin` untuk shared schema/admin integration.
- L1 explicit paths: `npm run verify:unit:slice -- <daftar file test slice di atas>`; daftar riil wajib dicatat sebelum run, tidak implicit.
- L2 batch: `npm run verify:batch:unit`; `npm run verify:batch:e2e -- e2e/store/checkout-attempt-mock.spec.ts e2e/admin/checkout-attempt-review-mock.spec.ts e2e/store/checkout-review-mock.spec.ts e2e/store/delivery-order-mock.spec.ts e2e/store/versioned-checkout-mock.spec.ts` dan spec promo yang benar-benar disentuh.
- L3 sebelum commit/PR/integration: `npm run test:unit`; full UI/routing suite yang diwajibkan repo. Legacy `npm run test:e2e` memerlukan izin terpisah; jika belum diizinkan, catat gate belum dijalankan, bukan klaim full verification.
- DB tests harus benar-benar berjalan pada DB disposable, bukan diterima sebagai lulus jika semua skipped. Migration/seed smoke hanya DB disposable yang dipastikan bukan data user.
- Manual browser: render state SO rejected, payment failure, compensation, unknown, review ulang, success; bandingkan checkout existing dan admin review reference pada viewport di atas. Playwright failure dianalisis dari Markdown, bukan membuka screenshot failure.
- Simpan disposable artifacts di `playwright/`; ringkasan bukti di `.scratch/jubelio-sales-api-switching/ticket/` bila sudah ada pekerjaan implementasi yang disetujui. Tidak membuat implementation ticket breakdown saat drafting ini.

### Migrasi dan release

- Schema owner tetap `packages/db/src/schema/`; migration hanya generate, tidak hand-edit/delete audit SQL. Dev memakai root `npm run db:push`, bukan `db:migrate`.
- Upgrade additive lebih dahulu: tambah attempt ownership nullable yang terkontrol; legacy rows tetap valid dan tidak di-backfill menjadi failed attempts. Tidak menghapus history.
- Saat cutover, hentikan sementara NEW checkout dengan existing `checkout.paused`, drain in-flight request, terapkan schema/app sebagai satu release terkoordinasi. Callback/recovery untuk existing orders tetap hidup. Jangan menjalankan old/new placement writer bersamaan tanpa compatibility proof.
- Rollback aplikasi lama tidak otomatis aman setelah attempt tanpa order ada. Hentikan new checkout dan pertahankan recovery-aware app sampai attempt resolved; jangan drop tabel/evidence untuk rollback.
- Tidak ada env/domain/port/cron endpoint baru. Update `docs/deployment-docs/cron-sweep.md` dan deployment runbook di bawah `deployment/` bila build/schema rollout atau budget cron membutuhkan perubahan. Jangan menjalankan Docker/remote migration/restart/deploy tanpa izin terpisah.
- Existing working tree memiliki perubahan checkout/promo/UI yang unrelated; integrasikan perubahan secara targeted tanpa overwrite atau ikut mengklaim perubahan tersebut.

### Destinasi enduring docs

Saat implementasi selesai, update:

- `docs/features/jubelio-sales-orders.md`: attempt-owned SO lifecycle, compensation dan manual review.
- `docs/features/versioned-checkout-pricing.md`: snapshot/reservation/promotion boundary.
- `docs/features/discount-redemption.md`: reservation sebelum order, owner dan counter semantics.
- `docs/features/delivery-quotes.md`: input/quote preservation serta re-review setelah rejection.
- `docs/api-reference.md`: versioned outcome DTO, status/error codes, lookup dan webhook behavior.
- `docs/testing/README.md`: mock scenarios/verification commands bila ada perubahan harness.
- `docs/README.md`: navigasi fitur yang berubah; tidak memindahkan draft spec ini ke enduring docs.

## 12. Open items dan retirement

- Exact Midtrans/SDK evidence, complete nullable-owner call-site inventory, cart version seam, dan sweep budget perlu checkpoint teknis sesuai §8.3. Tidak boleh diselesaikan dengan asumsi API saat coding.
- Final user approval complete spec sudah diperoleh. Jika checkpoint mengubah observable behavior, schema strategy, atau scope, revisi spec dan minta approval ulang; jangan silent re-plan.
- Evidence drafting awal: belum ada test/check/build/browser pada saat spec dibuat. Evidence implementasi berikutnya dicatat terpisah; jangan menganggap pemeriksaan drafting sebagai runtime verification.
- Saat Done: retain spec, catat evidence dan tanggal di index fitur, distill enduring docs, pastikan semua acceptance/test/UX gate terbukti. Plan lain di fitur yang sama tidak otomatis Done karena spec ini selesai.
