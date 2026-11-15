# Spesifikasi perbaikan keandalan transaksi TX-01–TX-06

## 1. Tujuan, sumber, dan approval

Dokumen ini adalah kontrak implementasi lintas sesi untuk enam risiko prioritas tinggi pada checkout, pembayaran, webhook, settlement Jubelio, dan recovery. Status keseluruhan plan hanya dicatat pada [index fitur](../index.md). Dokumen ini tidak memberikan izin implementasi sampai complete spec disetujui pengguna.

### 1.1 Sumber kebenaran

- [Review keamanan dan keandalan transaksi](../research/review-keamanan-dan-keandalan-transaksi.md), khusus TX-01–TX-06. Review bukan bukti incident production maupun reproduction seluruh failure window.
- Snapshot sumber: `d75a44266af21e9a70329bced1f7a97640dd7e50`, branch `worktree/diskon`, 10 November 2026. Sesi implementasi wajib membandingkan HEAD/dirty diff terbaru, tidak menganggap line number lama tetap akurat.
- [Order flow](../../../docs/features/order-flow.md), [Sales Order Jubelio](../../../docs/features/jubelio-sales-orders.md), [stock reservation](../../../docs/features/stock-reservation.md), [pricing berversi](../../../docs/features/versioned-checkout-pricing.md), [delivery fulfillment](../../../docs/features/delivery-fulfillment.md), [komunikasi order](../../../docs/features/order-communications.md).
- Konvensi: [AGENTS.md](../../../AGENTS.md), [development-workflow](../../../.agents/skills/development-workflow/SKILL.md), [maintainable-code](../../../.agents/skills/maintainable-code/SKILL.md), [ux-design](../../../.agents/skills/ux-design/SKILL.md), [tdd](../../../.agents/skills/tdd/SKILL.md), [organisasi backend](../../../docs/architecture/code-organization.md).

### 1.2 Keputusan percakapan yang sudah dikonfirmasi

| Keputusan | Authority |
|---|---|
| Spec berfokus pada TX-01–TX-06, termasuk interaksi initial payment dengan repayment | Pengguna memilih **“Sesuai (Recommended)”** pada konfirmasi scope spec |
| Seam verifikasi: service/route publik, PostgreSQL untuk transaksi/concurrency, serta mock E2E customer→admin | Konfirmasi scope yang sama |
| Recovery/cron memperbaiki checkpoint lokal, tetapi **customer yang melanjutkan** pembuatan sesi Snap pertama setelah SO confirmed | Pengguna memilih **“Customer melanjutkan (Recommended)”** setelah penjelasan celah SO-confirmed/sebelum-Snap |
| Resume memakai attempt, request key, snapshot harga dan deadline yang sama | Bagian penjelasan pilihan yang dikonfirmasi; bukan checkout baru |
| Unknown tetap ditahan; tidak blind retry, refund otomatis, atau pelepasan stock/promo tanpa bukti | Batas scope yang dikonfirmasi |
| Bukan redesign admin dan bukan perbaikan TX-07–TX-17 | Konfirmasi scope |

### 1.3 Gate approval

- Kesepahaman scope dan test seams: **dikonfirmasi** melalui pilihan di atas.
- Complete spec, desain schema/kontrak API/UX, acceptance criteria, dan batas compatibility pada dokumen ini: **disetujui pengguna** (sesi implementasi; scope §15.1–§15.5, commit per langkah, DB disposable `marketplace_discounts_test_*`, final gate §16.5).
- Instruksi pengguna saat ini: membuat `to-spec` detail agar dapat dikerjakan pada sesi lain. **Bukan instruksi implementasi**.
- Tidak ada izin delegasi, commit, push, DB development sync/reset/seed, live provider write, SSH, atau deployment.
- Tidak membuat implementation tickets atau mempublikasikan breakdown multi-sesi. Urutan integrasi pada §15 adalah penjelasan dependensi dalam spec, bukan ticket breakdown yang disetujui.

## 2. Pernyataan masalah

Customer dapat berhasil membayar tetapi order dibatalkan karena expiry/payment initialization disimpulkan gagal tanpa bukti pasti. Order yang sebenarnya sudah mempunyai invoice/payment verified dapat terhenti akibat pointer lokal tidak tersimpan atomik. Recovery dapat terus memproses delivery sehat, kehilangan kewajiban cancel sesudah failure commit, atau mengunci account pada attempt pre-order yang seharusnya bisa dilanjutkan/dilepas secara aman.

Dampaknya meliputi ketidakcocokan Midtrans/Jubelio/website, tertahannya pickup atau packing, stock dan kapasitas promo yang tidak kembali, serta customer yang tidak bisa checkout lagi. Keberhasilan HTTP, proses cron yang tetap hidup, atau unit tests baseline tidak membuktikan invariant tersebut terpenuhi.

## 3. Solusi dari perspektif pengguna

1. Pembayaran sukses tidak diubah menjadi gagal hanya karena timeout atau expiry conflict.
2. Pesanan yang sudah dibayar dapat melanjutkan pencatatan dan fulfillment tanpa membuat invoice/payment ganda.
3. Pesanan yang benar-benar gagal mempunyai kewajiban pembatalan SO yang tersimpan dan dapat dilanjutkan setelah process berhenti.
4. Recovery memproses hanya pekerjaan yang diperlukan, memberi giliran pada kasus lain, dan mengisolasi kegagalan satu order.
5. Attempt dengan hasil pasti dipulihkan otomatis secara lokal. Setelah SO confirmed dan pembayaran terbukti belum pernah dikirim, customer memperoleh **Lanjutkan checkout** untuk membuat sesi pertama.
6. Customer tidak diminta membayar ulang saat outcome unknown atau sudah paid. Deadline tidak diperpanjang dan snapshot tidak dihitung ulang.
7. Aksi admin tetap mengikuti flow/permission existing; tidak ada tombol untuk memalsukan paid/verified, menghapus hold, atau mengulang write provider secara buta.

## 4. User stories

1. Sebagai customer, saya ingin pembayaran yang berhasil tetap tercatat walaupun berdekatan dengan expiry, agar pesanan saya tidak dibatalkan keliru.
2. Sebagai customer, saya ingin gangguan jaringan saat pembuatan pembayaran dibedakan dari penolakan pasti, agar saya tidak diarahkan membuat pesanan pengganti yang berisiko.
3. Sebagai customer, saya ingin initial checkout dan repayment mengacu pada satu sesi provider, agar request bersamaan tidak menimbulkan pembatalan.
4. Sebagai customer, saya ingin menggunakan kembali redirect yang sudah tersimpan, tanpa membuat sesi baru.
5. Sebagai customer, saya ingin dapat memeriksa hasil checkout tanpa menyebabkan provider write.
6. Sebagai customer, saya ingin dapat melanjutkan attempt yang SO-nya sudah confirmed tetapi belum mempunyai sesi pembayaran, tanpa memilih barang/harga baru.
7. Sebagai customer, saya ingin aksi Lanjutkan checkout tetap memakai deadline awal, bukan memperpanjang reservasi.
8. Sebagai customer, saya ingin attempt yang benar-benar rejected dilepas, agar saya dapat review ulang dan memulai checkout baru.
9. Sebagai customer, saya ingin attempt expired dibersihkan hanya jika aman, bukan dengan menganggap timeout sebagai penolakan.
10. Sebagai customer pickup, saya ingin menerima kode setelah settlement benar-benar lengkap, termasuk sesudah recovery.
11. Sebagai customer delivery, saya ingin order paid dapat masuk packing setelah linkage finansial benar, bukan tertahan karena pointer lokal hilang.
12. Sebagai admin, saya ingin paid-but-blocked tetap menunjukkan pembayaran diterima dan tidak meminta customer membayar lagi.
13. Sebagai admin, saya ingin pekerjaan recovery yang tertunda tidak kalah giliran oleh delivery yang sudah sehat.
14. Sebagai admin, saya ingin SO order gagal tetap dibatalkan setelah restart jika kewajibannya sudah disimpan.
15. Sebagai operator, saya ingin dapat membedakan repair lokal, confirmed provider outcome, unknown, dan manual review dari evidence yang durable.
16. Sebagai operator, saya ingin satu poison order tidak menggagalkan recovery seluruh batch.
17. Sebagai pengelola stok, saya ingin hold dilepas tepat sekali setelah bukti yang sesuai, agar stok tidak bocor atau terkunci keliru.
18. Sebagai pengelola promo, saya ingin reserved/consumed/released tetap konsisten dengan pembayaran dan compensation.
19. Sebagai maintainer, saya ingin failure window diuji melalui public seams dan PostgreSQL nyata, bukan hanya mock query chain.
20. Sebagai maintainer, saya ingin record lama tanpa dispatch evidence diperlakukan konservatif, bukan ditebak belum pernah dikirim.
21. Sebagai operator deployment, saya ingin perubahan schema/reader diterapkan secara berurutan tanpa reset data dan tanpa menghapus provider evidence.

## 5. Scope dan non-goals

### 5.1 Termasuk

- TX-01: klasifikasi authoritative payment/expiry, fresh re-verification setelah conflict/unknown, dan race dengan paid claim.
- TX-02: outcome payment initialization konservatif pada legacy, durable at-most-once claim bersama repayment, dan repair local persistence.
- TX-03: confirmation invoice/payment dan order projection atomik, ditambah repair record torn yang sudah ada.
- TX-04: eligibility recovery berdasarkan evidence, fairness durable, error isolation, bounded work.
- TX-05: failure transition + durable cancel obligation, recovery missing/never-sent obligation yang dapat dibuktikan aman, mutual exclusion cancel/invoice, idempotent stock/promo accounting.
- TX-06: recovery state matrix pre-order, local repair definitive checkpoints, safe expiry/compensation, owner-scoped explicit resume oleh customer.
- UI minimal untuk menjelaskan unknown legacy dan menyediakan explicit resume attempt; API/read projection yang diperlukan untuk itu.
- Seeder/retention cleanup, generated migration, dokumentasi fitur/API/deployment/testing, dan regression user path.
- Pickup dan delivery; gate 0 dan gate 1; provider contract legacy/2/3 yang saat ini didukung decoder. Gate rollout tidak diubah.

### 5.2 Tidak termasuk

- TX-07–TX-17 sebagai proyek perbaikan mandiri, termasuk email late-delivered, log pickup code, rate limit pickup, guard tracking, review-list pagination, dan financial decoder list.
- Refund, chargeback/reversal automation, cancellation oleh customer, pembuatan ulang SO/invoice/payment yang sudah possibly sent.
- Admin override paid/verified, tombol resolve manual-review baru, adopsi AWB, retry booking, atau redesign halaman admin.
- Menyatukan lifecycle gate 0/gate 1, request-wide idempotency baru untuk seluruh legacy checkout, atau mengganti pricing engine.
- Worker/queue/broker/outbox generik baru, fleet coordinator, atau dashboard observability baru. Gunakan cron existing dan ledger domain.
- Mass refactor seluruh `jubelio-sales-client`, channel mirror, logging, atau endpoint di luar call chain yang dibutuhkan.
- Perbaikan halaman `/checkout/result` yang saat ini mempresentasikan query parameter provider; acceptance transaksi menggunakan order authoritative, bukan query parameter tersebut.
- Live-provider validation, aktivasi gate, perubahan credential/domain/cron cadence, deployment, maupun manipulasi database pengguna.

## 6. Istilah dan invariant mengikat

### 6.1 Istilah

- **Paid customer:** authoritative Midtrans `settlement` atau `capture` dengan fraud `accept` untuk identitas dan amount yang cocok.
- **Ready session:** sesi Snap dibuat dan redirect tersimpan; **bukan** bukti customer sudah membayar.
- **Never sent:** durable intent yang belum di-claim; tidak ada evidence dispatch oleh writer mana pun. Row hilang bukan bukti never sent untuk historical order.
- **Possibly sent:** claim committed sebelum HTTP; crash sebelum HTTP pun tetap masuk kategori ini jika tidak ada bukti tambahan. Tidak boleh ditebak aman untuk retry.
- **Definitive rejection:** bukti adapter allowlisted bahwa operasi tidak membuat sesi/resource. Timeout, generic 4xx, duplicate order ID, dan malformed success bukan definitive rejection.
- **Local repair:** menyelesaikan projection/accounting dari evidence persisted; tidak mengulang provider write.
- **Cancel obligation:** intent `cancel` pada ledger Jubelio existing, disimpan bersama transisi gagal/compensating yang memerlukannya.
- **Resume:** aksi authenticated customer untuk membuat sesi Snap **pertama** dari attempt retained yang terbukti belum pernah mengirim payment.

### 6.2 Invariant

| ID | Aturan |
|---|---|
| I01 | Paid authoritative tidak diturunkan menjadi pending/failed oleh timeout, expiry, recovery, atau compensation. |
| I02 | Unknown bukan failure; hold/promo tidak dilepas hanya karena TTL lokal atau HTTP error. |
| I03 | Satu durable claim per initialization; initial legacy dan repayment memakai claim yang sama. Possibly-sent tidak kembali ke intent. |
| I04 | SO/invoice/payment create tidak diulang untuk memperbaiki projection lokal. |
| I05 | Ledger confirmation dan order pointer related committed bersama; ID berbeda ditolak, bukan ditimpa. |
| I06 | Failure/compensating commit yang memerlukan cancel mempunyai obligation pada commit yang sama, atau explicit safe exclusion dengan evidence. |
| I07 | Tidak ada cancel dispatch jika invoice/payment aktif, atau bukti paid sudah menang sebelum cancel claim. Late paid setelah cancel dimulai tetap paid dan blocked, bukan membuat SO baru. |
| I08 | Stock/promo release dan accounting checkpoint committed atomik, tepat sekali, memakai lock order repo. |
| I09 | GET status/lookup tidak membuat sesi, SO, invoice, payment, atau compensation baru. |
| I10 | Cron tidak menginisialisasi Snap pertama untuk attempt. Customer resume adalah satu-satunya tambahan pemicu initialization pada checkpoint TX-06. |
| I11 | Resume memakai attempt/key/reference/snapshot/deadline semula; tidak membaca cart/master untuk reprice atau membuat hold kedua. Current auth/admission dan strict decoder tetap berlaku. |
| I12 | Healthy delivery tidak masuk settlement work karena sekadar `processing/paid`. |
| I13 | Unknown yang benar boleh tetap held/manual review; liveness dijanjikan untuk checkpoint dengan bukti pasti, bukan dengan mengorbankan safety. |
| I14 | Retry/concurrency tidak menggandakan order, provider write, failure email fact, stock release, atau redemption transition. |
| I15 | Full-row DB, payment token, signature, raw provider payload, credential, dan PII tidak masuk response/log. Redirect hanya kepada pemilik yang berhak dan masih eligible. |
| I16 | Provider HTTP di luar DB transaction. Tidak menahan lock selama network I/O atau retry sleep. |

## 7. Desain perilaku TX-01: expiry berdasarkan evidence

### 7.1 Normalisasi payment observation

Adapter menghasilkan discriminated outcome `paid | expired | pending | attempt_failed | not_found | unknown`. Observation valid memuat order reference, gross amount, transaction ID/payment type bila tersedia, dan waktu verifikasi. Missing/malformed/mismatched identity/amount tidak boleh menjadi `paid` atau `expired`.

`deny/cancel/failure` tetap mengikuti existing multi-attempt policy: bukan otomatis terminal untuk seluruh Snap order. `capture` tanpa fraud accept bukan paid. Status yang tidak dikenal menghasilkan unknown, bukan branch default gagal.

### 7.2 Decision matrix sweep

| Observation | Tindakan | Larangan |
|---|---|---|
| Paid, identity/amount cocok | Claim paid; lanjut settlement existing | Tidak expire/cancel |
| Expired authoritative, identity/amount cocok | Failure + obligation sesuai §10 | Tidak melepaskan hold sebelum bukti cancel/definitive create rejection |
| Pending, deadline belum lewat | Tidak expire; reschedule | Tidak memperpanjang deadline |
| Pending, deadline lewat | Satu expire request; baca outcome; setelah conflict/unknown lakukan GET fresh | Tidak fail dari GET pending lama |
| Expire success berstatus expire dengan evidence lengkap | Boleh finalize failure | HTTP 2xx saja tidak cukup |
| Expire 412 / transport error / malformed | GET ulang; paid→paid, expired→failure, selain itu defer | Tidak menelan error lalu fail |
| Not found, durable payment intent terbukti never sent dan deadline lewat | Safe never-sent failure/compensation | Tidak disamakan dengan possibly-sent |
| Not found tetapi pernah dispatched/ready atau historical evidence tidak cukup | Defer/manual review dengan reason aman | 404 saja tidak membuktikan sesi Snap tidak pernah ada |
| Unknown/provider unavailable | Reschedule, no mutation finansial | Tidak fail/cancel/release |

Late settlement tetap diproses untuk failed order. Jika cancel belum aktif dan bukti mengizinkan, lanjut existing paid path; jika cancel intent/dispatch/confirmed/manual review sudah ada, pertahankan paid + fulfillment block. Tidak menjanjikan automatic restoration SO yang sudah dibatalkan.

**Batas konservatif yang harus terlihat saat approval:** sesi yang pernah dikirim tetapi hanya memberi GET not-found dapat tetap held sampai ada bukti terminal yang cukup. Custom expiry Snap didokumentasikan, tetapi lewatnya jam lokal/expiry request yang gagal bukan bukti settlement negatif. Jangan menambahkan aturan “404 setelah N menit pasti aman” tanpa bukti vendor dan approval perubahan kontrak. Sasaran spec ini mencegah false cancellation, bukan menjanjikan semua unknown selalu dibersihkan otomatis.

### 7.3 Race gate

Sebelum failure/cancel intent maupun cancel dispatch, re-read di bawah owner/order lock. Jika paid sudah committed, return paid/no-op; tidak overwrite. Jika failure/cancel intent menang lalu paid datang, late handler membaca obligation yang committed dan memasang block. Invoice-intent creation harus memakai order lock yang sama sehingga cancel/invoice tidak sama-sama memperoleh dispatch authorization dari pre-read stale.

## 8. Desain perilaku TX-02: satu payment initialization untuk order legacy

### 8.1 Ledger payment session order-owned

Tambahkan ledger domain `order_payment_session`, bukan job queue generik. Dipakai initial legacy dan `POST /api/payments/midtrans/create` untuk order yang belum memiliki redirect. **Untuk legacy order baru, payment intent dan exact cart-selection snapshot dicatat dalam transaksi awal yang sama dengan order/items/SO intent, sebelum provider call apa pun.** Dengan demikian row intent yang benar-benar fresh dapat dibedakan dari historical row yang hilang; initialization service tidak menebak absence sebagai never-sent. Initial attempt gate 1 tetap memakai payment state pada `checkout_attempt`; tidak membuat ledger kedua selama belum promoted.

| State | Makna | Lanjutan sah |
|---|---|---|
| intent | Snapshot identity/money/deadline disimpan, belum di-claim | Conditional claim→dispatched_unknown sebelum POST |
| dispatched_unknown | Satu writer sudah memperoleh hak dispatch | Ready/rejected dari outcome writer yang sama; GET reconcile; never re-POST |
| ready | Redirect valid tersimpan | Reuse redirect; paid/expired dari verification; tidak create lagi |
| rejected | Definitive no-session evidence | Failure + durable cancel obligation, bukan retry sesi |
| manual_review | Evidence belum cukup/historical ambiguity | GET/local repair yang dapat dibuktikan; tidak reset intent |
| paid | Paid authoritative | Claim paid existing; tidak expose CTA bayar |
| expired | Expire authoritative | Failure + obligation existing |

At-most-once claim dan unique order/reference mencegah initial dan repayment saling berlomba membuat sesi. Loser membaca outcome durable atau mengembalikan processing; bukan menggagalkan order. Duplicate response provider tidak menjadi definitive rejection.

### 8.2 Outcome dan persistence

- `ready`: simpan token/redirect serta `orders.snapRedirectUrl` atomik. Cart deletion legacy dilakukan idempoten dari item order/catatan selection yang sudah disimpan; jangan menghapus perubahan cart baru karena persistence retry.
- `unknown`: jangan `claimAndFailOrder`, jangan cancel SO, jangan mengembalikan janji sesi tidak ada. Return processing/manual-review dengan order ID pemilik.
- `definitive_rejection`: simpan bukti claim-owned, lalu failure + obligation atomik. Error DB saat mencatat evidence bukan definitive provider rejection.
- Sesi sudah dibuat tetapi local persistence gagal: jangan compensation. Return/retain outcome secara jujur; repair bila handle sudah durable. Crash sebelum handle berhasil disimpan tetap unknown; tidak menjanjikan dapat mengambil token kembali lewat endpoint yang tidak terdokumentasi.
- Replay/historical `snapRedirectUrl` yang sah dipertahankan. Jangan membuang sesi aktif hanya karena row ledger belum ada.
- Initial payment/repayment mengecek ulang ownership, pending/unpaid, deadline, confirmed SO/no active cancel, dan strict pricing sebelum claim. Reuse redirect juga tidak boleh membypass state paid/cancelled/expired.

### 8.3 Historical order

| Kondisi lama | Perlakuan |
|---|---|
| Pending + redirect valid | Lazy-adopt sebagai ready dengan provenance `adopted_redirect`; token boleh null karena history tidak menyimpannya |
| Pending + no redirect + tidak ada durable dispatch evidence | GET reconcile, tandai `legacy_unknown`; **jangan** menyimpulkan never sent dan membuat token baru |
| Paid / completed | Jangan initialization baru; existing settled evidence tetap dipertahankan |
| Failed + confirmed SO, no cancel intent | Coba repair obligation hanya dengan evidence failure yang memenuhi §10.3 |
| Unknown/corrupt version/linkage | Hold dan visible safe reason; bukan silent legacy fallback |

Tidak ada blanket backfill yang mengubah history menjadi intent. Tidak ada reset table lama atau rekalkulasi nominal/deadline.

## 9. Desain perilaku TX-03: confirmation dan pointer atomik

### 9.1 Commit boundary

Setelah independent provider GET verified, satu repository transaction harus:

1. Lock owner order dengan urutan yang konsisten.
2. Re-read operation dan linkage persisted; expected IDs harus cocok dengan order/intent.
3. Tolak active cancel atau conflicting IDs.
4. Conditional-confirm operation yang eligible dan update order pointer pada commit yang sama.
5. Jika operation sudah confirmed dengan ID sama, lakukan idempotent pointer repair bila null.
6. Jika pointer berbeda/non-null, jangan overwrite; return conflict yang menahan fulfillment untuk review.

Transaksi mencakup **semua** confirmation call sites invoice/payment: initial success, dispatched_unknown GET reconciliation, dan existing allowed manual-review GET recovery. Jangan hanya memperbaiki happy path.

### 9.2 Torn record repair

Recovery juga memilih `confirmed invoice/payment + missing order pointer`. Ia tidak perlu POST baru. Repair memeriksa strict stored authority, expected linkage dan confirmed evidence. Jika data confirmed lama tidak cukup membuktikan linkage, gunakan GET-only verification sebelum local commit atau hold; jangan mengarang ID.

Setelah repair sukses, settlement bisa dilanjutkan:
- Pickup mencapai ready_for_pickup lewat gate existing dan komunikasi idempoten.
- Delivery tetap processing/paid tetapi verified/unblocked, sehingga packing existing menerima linkage.

Block reason yang tidak dimiliki recovery ini tidak boleh dibersihkan sembarang. Misalnya late payment setelah redemption release/cancel active tetap blocked walaupun pointer berhasil diperbaiki. Perubahan ini bukan izin menghapus semua `fulfillmentBlockedReason`.

## 10. Desain perilaku TX-05: durable failure dan cancel obligation

### 10.1 Transaksi failure

Untuk order dengan SO confirmed dan belum mempunyai invoice/payment aktif, commit yang sama memuat:

- Conditional pending→failed atau pre-order preparing→compensating sesuai owner.
- Failure reason/evidence yang normalized, bukan raw provider body.
- Cancel intent ledger existing dengan reference stabil, SO ID dari confirmed create, payload immutable.
- Failure communication fact bila applicable; replay tidak menulis fakta kedua.

Tidak ada provider HTTP dalam transaksi ini. Satu dispatcher kemudian memakai conditional intent→dispatched_unknown existing.

Jika create definitively rejected sebelum apply, tidak perlu cancel SO: rejection/accounting release memakai bukti yang sama secara atomik. Jika SO outcome masih unknown, jangan membuat cancel yang menebak remote ID; pertahankan held/manual-review evidence. Jika invoice/payment ada, cancel dilarang dan review dipertahankan.

### 10.2 Recovery cancel

| Checkpoint | Perilaku recovery |
|---|---|
| Failure committed + intent belum claimed | Recheck eligibility di bawah lock; claim sekali; dispatch di luar tx |
| Claimed, belum diketahui sudah dikirim atau tidak | GET-only bila known ID; tidak POST ulang |
| Cancel confirmed, accounting belum committed | Local accounting/release tepat sekali |
| Cancel rejected atau true manual_review | Hold/escalation existing; jangan reset ke intent |
| Paid menang sebelum cancel claim | Tidak cancel; gunakan paid/settlement atau blocked sesuai evidence yang tersisa |
| Paid datang sesudah cancel aktif | Persist paid, block fulfillment; tidak menagih/membuat SO baru |

Canceled SO baru mengizinkan release jika confirmed dan linkage benar. Accounting order-owned tetap mengikuti model stock mirror existing; jangan menambahkan increment stok yang berbeda dari kontrak existing. Attempt-owned cancel menggunakan accounting attempt existing. Promo release tidak boleh mengubah consumed kembali menjadi reserved/released secara buta.

### 10.3 Repair missing obligation historis

Bukan semua `failed_payment` boleh di-cancel otomatis. Repair hanya berjalan jika fresh provider verification menunjukkan expiry untuk order/amount yang cocok, atau durable definitive-initialization rejection/never-sent proof tersedia; SO create confirmed; tidak ada invoice/payment aktif; dan paid belum menang.

`midtransFailureStatus = initialization_error` lama sendirian **tidak** cukup, karena TX-02 justru membuat reason itu dari timeout. Unknown historical failure tetap ditahan dan dilaporkan. Setelah evidence cukup, repair membuat obligation idempoten tanpa mengulang email/status failure.

### 10.4 Expired attempt setelah SO confirmed

Jika payment benar-benar never sent dan deadline sudah lewat, jangan meminta customer resume. Local commit menetapkan compensating, **persist `compensationCause=checkout_expired`**, dan cancel obligation. Definitive payment rejection memakai `compensationCause=payment_rejected`. Cause disimpan bersama obligation, bukan hanya parameter di memory, sehingga restart tidak menebak alasan finalisasi. Setelah cancel confirmed, finalisasi `rejected`, `failureCode=CHECKOUT_EXPIRED`, stock/promo released. Jangan memakai `PAYMENT_INITIALIZATION_REJECTED` untuk expiry yang bukan penolakan provider.

## 11. Desain perilaku TX-04/TX-06: recovery yang bergerak dan berbasis state

### 11.1 Seleksi order recovery

Candidate harus mempunyai pekerjaan nyata, misalnya:
- Pending payment deadline lewat atau payment initialization unknown yang perlu observation.
- Paid dengan invoice/payment belum selesai, missing pointer, atau operation possibly sent yang memang eligible reconciliation.
- Failed dengan verified cancel obligation/repair need atau confirmed accounting yang belum selesai.

Exclude healthy delivery dengan verified matching create/invoice/payment, pointer lengkap, no blocker, dan no local obligation. Order processing/paid saja bukan eligibility. Attempt parent manual_review yang mempunyai child evidence definitive/confirmed untuk local repair tetap candidate; true unknown child tidak dinormalisasi hanya agar queue berkurang. Terminal completed tidak diproses sebagai settlement baru; jika historical pointer repair diperlukan, repair lokal tidak membuka kembali fulfillment/komunikasi.

### 11.2 Scheduling dan isolation

- Tambahkan `transactionRecoveryAfter` dan `lastTransactionRecoveryAt` pada order dan attempt, bukan queue baru.
- Claim singkat: pilih owner due berdasarkan `(transactionRecoveryAfter, id)` stabil, lock/skip-locked yang sesuai, lalu majukan due menjadi `now + 60 detik` **sebelum** kerja di luar tx. Ini scheduling fairness, bukan izin provider write; dispatch tetap memerlukan ledger claim.
- Default per run maksimal 50 order dan 50 attempt, hard cap 100 masing-masing. Claim owner bertahap, bukan mengambil seluruh dataset/snapshot ke memory.
- Ubah retry timestamp walaupun provider/error masih unknown agar satu poison owner tidak selalu di depan. Business `updatedAt` tidak dipakai sebagai pengganti retry cursor dan tidak perlu diubah semata untuk scheduling.
- Main recovery bergantian memberi kesempatan order dan attempt; tidak menghabiskan seluruh budget pada satu kategori sebelum mempertimbangkan kategori lain. Mirror informational tetap sesudah pekerjaan kritis.
- Budget mulai kerja baru 45 detik dari entry, di bawah wrapper cron existing 55 detik. Terapkan batas HTTP eksplisit; default Midtrans request 8 detik. Jangan mengklaim strict 45 detik selesai bila call sudah berlangsung; durasi maksimum call dan langkah bertingkat harus diuji. Bila diperlukan perubahan wrapper/env/cadence, kembali untuk approval, bukan diam-diam memperpanjang timeout.
- Error per owner diisolasi; DB/claim boundary yang unavailable dapat menghentikan pengambilan baru dengan response summary jujur. Jangan menghitung review/pending sebagai fulfilled.
- Fairness acceptance memakai dataset tetap dan controlled clock, bukan janji SLA pada arrival rate tidak terbatas.

### 11.3 Attempt decision matrix

Urutan penting: baca evidence create/payment/cancel terlebih dahulu; jangan menandai generic manual_review sebelum memeriksa definitive checkpoint.

| Create / payment / hold | Waktu / kondisi | Keputusan |
|---|---|---|
| Create intent never sent; payment none; hold held | Belum expired | Existing never-sent SO recovery boleh memakai satu claim; **tidak membuat Snap** |
| Create intent never sent; payment none; hold held | Expired | Abort create intent + release + rejected CHECKOUT_EXPIRED, atomik |
| Create rejected definitif, no remote SO; payment none | Kapan pun | Finalize rejection/release sekali, bukan expiry finalizer untuk intent |
| Create confirmed; hold held; payment none | Belum expired | Account confirmed hold lokal; tetap preparing; setelah lengkap expose resumeAvailable |
| Create confirmed; hold held | Expired | Selesaikan accounting yang diperlukan secara konsisten, catat safe cancel obligation; release hanya setelah cancel confirmed |
| Create confirmed; hold mirrored; payment none/intent never claimed | Belum expired | `resumeAvailable=true`; tunggu customer POST resume |
| Create confirmed; payment none/intent never claimed | Expired | Compensating + cancel obligation; bukan resume |
| Payment ready; state processing | Belum/sudah deadline | Local promotion dari evidence tersimpan, tanpa payment POST lagi; jika deadline lewat jangan expose paymentAvailable, order mengikuti safe expiry reconciliation |
| Payment rejected definitif; create confirmed | Belum ada cancel | Simpan compensation obligation; lanjut satu cancel jika eligible |
| Cancel confirmed; parent compensating atau parent salah diklasifikasi manual_review | Evidence cause sesuai expiry/rejection, no paid/session ambiguity | Final accounting dan rejected dengan failureCode yang benar |
| Create confirmed/rejected tetapi parent manual_review karena checkpoint lokal terputus | Evidence lengkap dan tidak ada true unknown child | Normalisasi parent hanya untuk local repair yang dibuktikan; jangan override operation manual_review |
| Payment dispatched_unknown/manual_review | Apa pun TTL | No resume, no re-POST; GET evidence/review; no false release |
| Create dispatched_unknown/manual_review | Apa pun TTL | Hold/reconcile sesuai contract existing; tidak reset create intent |
| Unknown version / conflicting ID / consumed redemption tidak sesuai | Apa pun | Fail closed/review; tidak reprice atau release |
| Promoted/rejected | Apa pun | Replay outcome; jangan duplicate order/release |

`accountConfirmedAttemptCancelHold` perlu menerima terminal cause yang tervalidasi agar dapat menyelesaikan expired never-sent payment maupun definitive rejection, termasuk parent local-misclassification yang dapat dibuktikan. Jangan menghapus state guard tanpa menggantinya dengan evidence gate.

## 12. Kontrak data, schema, dan transaksi

### 12.1 Schema delta

Seluruh definisi hanya di `packages/db/src/schema/`.

**Baru: `packages/db/src/schema/payment-sessions.ts`**, tabel `order_payment_session`, export `orderPaymentSessions`:

| Field | Kontrak |
|---|---|
| id, orderId | Text ID; order FK RESTRICT; unique orderId |
| providerReference | Unique, immutable; sama dengan order ID provider existing, bukan ID pengganti |
| provenance | `runtime` / `adopted_redirect` / `legacy_unknown`; missing historical row bukan runtime intent |
| state | Enum-domain pada §8.1, SQL CHECK allowlist |
| expectedAmount, currency | Amount dari persisted order decoder, numeric(15,2) menjaga legacy cents; currency IDR |
| paymentStartedAt, expiresAt | Immutable anchor/deadline dari order/request asli, bukan waktu replay; nullable hanya historical evidence benar-benar tidak tersedia, yang tidak claimable |
| dispatchClaimId, dispatchedAt | Claim identity lokal sekali; committed sebelum POST; compare-and-set outcome dari claim yang sama |
| token, redirectUrl | Server-only token; redirect valid. Runtime ready memerlukan hasil adapter lengkap; adopted ready boleh token null |
| transactionId, lastVerifiedStatus, lastVerifiedAt | Verified normalized observation, bukan raw provider response |
| lastErrorCode | Token aman dari allowlist, bukan error message bebas |
| cartSnapshot | JSONB nullable, exact server-side selection `{cartId,itemId,variantId,branchId,quantity,updatedAt}` dari initial placement; batas 256 KiB, tanpa PII. Dipakai conditional cart deletion setelah ready; absent historical snapshot berarti tidak menghapus cart secara tebakan |
| createdAt, updatedAt | `timestamptz` |

Constraints: finite nonnegative amount; state/provenance valid; ready memerlukan redirect; runtime possibly-sent memerlukan claim/dispatchedAt; paid/expired memerlukan verified evidence; historical-unknown tidak boleh claim intent tanpa bukti baru yang memenuhi kontrak. State yang tidak pernah dikirim tidak boleh mempunyai returned session handle. Definisikan timestamp nullable/check dengan `IS TRUE` agar SQL NULL tidak melewati invariant.

**Modify `packages/db/src/schema/orders.ts` dan `packages/db/src/schema/checkout.ts`:**
- `transactionRecoveryAfter`: timestamptz NOT NULL default now.
- `lastTransactionRecoveryAt`: timestamptz nullable.
- Index `(transactionRecoveryAfter, id)` untuk masing-masing owner; query eligibility tetap memfilter domain evidence.
- Pada attempt tambahkan `compensationCause`: nullable text dengan CHECK null atau `payment_rejected` / `checkout_expired`. Writer baru wajib menyimpannya atomik bersama compensating + cancel obligation. Legacy compensating row dengan cause null hanya boleh dinormalisasi bila child evidence membuktikan cause; bila tidak, tetap held. Tidak backfill cause dari TTL saja.
- Tidak menambah lifecycle status order atau enum state attempt hanya untuk UI resume. Resume adalah projection.
- CHECK rejection attempt yang mengizinkan `CHECKOUT_EXPIRED` setelah confirmed cancel harus konsisten dengan payment never-sent (`none/intent` yang dinormalisasi aman ke none) dan released hold. Jangan menandai payment rejected jika provider belum pernah dipanggil.

Export schema melalui `packages/db/src/schema/index.ts`. Generated SQL dan metadata di `packages/db/drizzle/` dibuat dengan `db:generate`, tidak hand-edit/hapus existing migrations. Perbarui seed dan retention cleanup sebelum parent order/client dihapus.

### 12.2 Lock ordering

Pertahankan hierarchy existing: client/checkout owner bila relevan → Offer identity/global usage/client usage → source variant bila diperlukan → order/attempt → redemption/cart/stock sesuai operasi → provider ledger/payment-session child. Untuk routine yang menyentuh Offer dan order/attempt, lakukan unlocked discovery terlebih dahulu, lalu ambil locks dalam urutan yang sama dan re-read state. Jangan memanggil helper yang mengambil Offer lock setelah operation sudah terkunci.

- Provider confirmation commit yang tidak menyentuh promo cukup order→operation.
- Payment session claim: order→session child, current ownership/financial guards di dalam tx.
- Cancel/invoice intent creation/dispatch authorization: order→operation, shared mutual exclusion check.
- Attempt accounting: client→Offer bila ada→attempt→stock terurut→operation; jangan membawa current attempt-lock-first pattern ke helper yang lalu mengunci Offer tanpa evaluasi deadlock.
- Counter/release claim loser me-rollback semua perubahan parsial. Jangan `GREATEST(0,...)` menjadi alasan melewatkan accounting mismatch.

### 12.3 Reader compatibility

`CheckoutAttemptResult.version` tetap 2; tambah `resumeAvailable: boolean` dan `resumeReason: "PAYMENT_NOT_STARTED" | null`. Absen pada payload lama diperlakukan false oleh UI. `retryAllowed` tetap berarti boleh checkout baru setelah definitive rejected, **bukan** boleh resume.

Projection `resumeAvailable` hanya true jika owned attempt, preparing, confirmed SO+accounted hold, payment never claimed, no cancel, supported snapshot, dan now < expiresAt. GET tidak memperbaiki DB/provider; read availability advisory dan POST recheck authoritative.

Detail order memperoleh `paymentRecovery` DTO allowlisted: `state`, `message`, `paymentAvailable`, `canInitialize`, `redirectUrl`, `expiresAt`. Tidak expose token, provenance internal, raw error, atau claim ID. Paid/blocked tidak menawarkan Bayar.

## 13. Kontrak HTTP dan UX

### 13.1 Endpoint

| Endpoint | Perubahan |
|---|---|
| `POST /api/checkout/place-order` | Pertahankan success existing. Legacy unknown mengembalikan 202, `success:false`, `code:PAYMENT_INITIALIZATION_UNKNOWN`, owned `orderId`, `redirectUrl:null`, safe message; jangan mengundang checkout baru. Definitive failure tetap failure sesudah durable compensation intent. |
| `POST /api/payments/midtrans/create` | Delegasi shared initialize-order-payment service. Ready→200 + existing redirect/token compatibility; claim loser/unknown→202 dengan same order dan safe recovery DTO; paid/nonpending/expired tidak membuat sesi. |
| `GET /api/checkout/requests/[requestKey]` | Tetap read-only/no-store/owner-scoped; version2 additive resume fields. Tidak memanggil dispatcher/payment initializer. |
| **Baru** `POST /api/checkout/requests/[requestKey]/resume` | Onboarded customer; UUID key; strict empty JSON `{}`. Client tidak mengirim amount/branch/orderId/snapshot/token/force flag. Server memuat retained snapshot milik actor. |
| `GET /api/orders/[id]` | Additive `paymentRecovery`; ownership dan pricing decoder tetap. Hanya read. |
| `POST /api/webhooks/midtrans` | Auth/reverify existing dipertahankan; verified outcomes memanggil use-case baru yang sama dengan sweep. Duplicate paid tidak downgrade. |
| `POST /api/cron/sweep-reservations` | Auth/header/path existing, delegasi orchestrator; existing keys dipertahankan, counters tambahan additive. No Snap create untuk attempt. |

Resume HTTP: promoted baru→201, already promoted→200; unresolved/nonresumable→202 dengan current version2 result; definitive rejected→409 dengan retryAllowed true; malformed key/body→400; wrong owner/unknown→404; missing auth→401, onboarding deny sesuai existing; infrastructure/decoder unavailable→503 tanpa provider write. Tidak disclose apakah key milik account lain. Aturan initial placement/replay retained tetap berjalan, tetapi resume endpoint tidak membuat SO baru.

Rate/admission resume menggunakan place-account/IP admission existing setelah actor resolved. Same key tidak menjadi bypass request-volume protection; jangan menghabiskan manual-code quota untuk resume yang tidak mengevaluasi kode baru. Perubahan policy kuota bukan scope.

### 13.2 Blueprint UX

**Reference:** checkout existing di `apps/store/src/app/checkout/page.tsx` dan `apps/store/src/components/checkout/CheckoutAttemptFeedback.tsx`; pending-order feedback di `apps/store/src/app/account/orders/[id]/page.tsx`. Audit source menemukan recovery saat ini GET-only dan checkout legacy belum menangani 202 unknown secara jujur. Bagian itu diperbaiki minimum; layout/visual lain tidak diubah.

**Tugas utama:** customer mengetahui apakah harus memeriksa, melanjutkan attempt yang sama, membayar sesi existing, atau review ulang setelah definitive rejection. Satu primary action per state. Tidak ada tombol “coba bayar lagi” untuk unknown.

Component reuse map:

| Elemen | Reuse/path | Ketentuan |
|---|---|---|
| Feedback attempt | `apps/store/src/components/checkout/CheckoutAttemptFeedback.tsx` | Tambah onResume, state resumable; jangan buat panel paralel dengan aturan berbeda |
| Button | `packages/ui/src/components/ui/button.tsx` | Alias `@/components/ui/button`; primary default, secondary outline |
| Card | `packages/ui/src/components/ui/card.tsx` | Alias actual dari tsconfig, bukan folder UI app baru |
| Checkout normal dan cart kosong dengan pending key | `apps/store/src/app/checkout/page.tsx` | Keduanya memakai feedback/action policy yang sama; cart kosong tidak menghilangkan resume |
| Detail order | `apps/store/src/app/account/orders/[id]/page.tsx` | Existing paid-but-blocked banner dipertahankan; recovery payment minimal pada card pembayaran |

State matrix final:

| Surface/state | Copy final | Primary / secondary | Perilaku |
|---|---|---|---|
| Attempt preparing, belum resumable | “Checkout masih diproses. Periksa status sebelum mencoba lagi.” | Periksa status checkout | GET saja; jangan otomatis POST saat read |
| Attempt resumable | “Pesanan sebelumnya sudah disiapkan. Lanjutkan checkout untuk membuka pembayaran. Batas waktu pembayaran tetap sama.” | **Lanjutkan checkout** / Periksa status checkout | POST resume `{}` pada key retained; tidak generate key baru |
| Resume loading | “Menyiapkan pembayaran…” | Lanjutkan checkout disabled | Cegah submit paralel; busy diumumkan |
| Processing/payment dispatched unknown | “Status pembayaran belum dapat dipastikan. Periksa status checkout dan jangan membuat pembayaran baru.” | Periksa status checkout | GET; no resume/retry baru |
| Compensating | “Checkout sebelumnya sedang diselesaikan. Tunggu konfirmasi sebelum membuat checkout baru.” | Periksa status checkout | No payment CTA |
| True manual review | “Status checkout belum dapat dipastikan. Jangan buat checkout baru. Tim kami perlu memeriksa proses ini.” | Periksa status checkout | Tidak ada override atau pengganti otomatis |
| Expired, release belum confirmed | “Waktu checkout sudah habis. Kami sedang menyelesaikan pesanan sebelumnya.” | Periksa status checkout | Jangan clear key/anggap stock sudah bebas |
| Rejected setelah safe expiry | “Checkout sebelumnya sudah kedaluwarsa. Pesanan belum dibuat. Periksa ulang pesanan untuk memulai lagi.” | Periksa ulang pesanan | Clear pending key hanya setelah retryAllowed; review/harga baru untuk placement baru |
| Rejected SO definitif | “Pesanan belum dibuat. Produk belum dapat dipesan. Periksa ulang pesanan lalu coba lagi.” | Periksa ulang pesanan | Hold sudah dilepas; tidak redirect nonexistent order |
| Promoted + payment available | “Mengarahkan ke pembayaran…” | Redirect | Persisted redirect; refresh cart sekali secara idempoten |
| Promoted tetapi paid/expired/no payment availability | Tidak menjanjikan link masih berlaku | Lihat pesanan | Ke owned order detail, bukan membuat sesi pengganti |
| Legacy initialization unknown | “Status pembayaran belum dapat dipastikan. Periksa pesanan ini sebelum mencoba pembayaran lagi.” | **Lihat pesanan** | Response 202 bernama order; jangan toast “pesanan gagal” lalu mengulang place-order |
| Detail legacy unknown | “Status pembayaran sedang diperiksa. Jangan membuat pembayaran baru.” | **Periksa status pembayaran** | Reload owned order GET; recovery sistem yang melakukan provider observation |
| Detail legacy never-sent terbukti dan unexpired | “Pembayaran belum disiapkan. Batas waktu pembayaran tetap sama.” | **Bayar Sekarang** | Existing payment-create POST, shared durable claim |
| Detail ready unexpired | Existing “Bayar Sekarang” dan expiry hint | **Bayar Sekarang** | Reuse redirect, no new session |
| Paid-but-blocked | Existing “Pembayaran diterima, pesanan menunggu verifikasi” dan “Tidak perlu membayar ulang.” | Lihat status pesanan existing | Jangan tampilkan payment CTA |
| Network/503 pada check/resume | “Koneksi belum tersedia. Request checkout tetap tersimpan.” | Periksa status checkout | Pertahankan key/selection; jangan fallback checkout baru |
| Session berakhir | “Masuk kembali untuk melanjutkan checkout yang sama.” | Masuk | Setelah login read key milik current account; jangan expose previous account key |

Untuk legacy unknown dengan order ID yang sudah diketahui, simpan hanya owned order ID/recovery reference pada session storage ter-scope current client agar page reload tidak mengundang duplicate placement. Ini bukan full request-wide idempotency legacy; response hilang total tanpa order reference tetap ditangani melalui order history/support, bukan klaim exactly-once seluruh placement legacy.

**Layout/copy:** panel recovery menggantikan primary “Bayar Sekarang” normal saat pending attempt aktif; jangan menampilkan dua primary CTAs. Waiting/resumable memakai semantic status netral dari tokens existing, bukan `destructive` seolah transaksi pasti gagal; rejected/error memakai treatment error existing. Kembali/input lain tidak boleh menyebabkan implicit key replacement. Resume tidak memerlukan checkbox persetujuan harga baru karena snapshot yang sudah disetujui sama; perubahan intent memerlukan rejected/terminal safe lalu review baru, bukan silent edit.

**Viewport/accessibility:** verifikasi 390×844 dan 1440×900, light/dark existing; tidak ada horizontal page overflow, CTA wraps sesuai Button/Card existing; keyboard Tab/Enter/Space, focus visible dan dipertahankan/dituju feedback setelah response, `aria-live=polite`, loading `aria-busy`, no color-only distinction. Kontras/tokens mengikuti peer/shared components. Tidak membuat prototype baru.

**List/table contract:** N/A — tidak menambah/mengubah search, pagination, sorting, filters, URL list, atau admin queue dalam scope ini. Halaman Orders/admin hanya dijadikan observation/reference acceptance; jangan menyelundupkan TX-13–TX-17.

## 14. Blueprint teknis dan exported contracts

Nama file baru di bawah adalah proposal yang masuk complete approval. Jangan membuat module alternatif di lokasi lain tanpa deviation yang ditinjau. Semua `database` memakai instance app-local; package DB runtime hanya untuk scripts. Tidak ada parameter logger/requestId/request object untuk logging.

### 14.1 File dan tanggung jawab

| Full path | Aksi | Layer/tanggung jawab | Public seam/evidence |
|---|---|---|---|
| `apps/store/src/features/payments/payment-evidence.ts` | create | Pure normalized outcomes, failure evidence, session projection dan money/identity gate | `payment-evidence.test.ts` |
| `apps/store/src/features/payments/midtrans-payment-client.ts` | create | Provider status/expire dan outcome adapter; normalisasi error; controlled mock transport; timeout | `midtrans-payment-client.test.ts` |
| `apps/store/src/features/payments/initialize-order-payment-service.ts` | create | Satu workflow legacy initial/repayment claim→HTTP→persist/reconcile; no SQL | `.test.ts`, `.db.test.ts` |
| `apps/store/src/features/payments/order-payment-repository.ts` | create | Order/session locks, owner/eligibility, CAS claim/outcome, lazy adoption, safe DTO; no provider | Service public DB tests |
| `apps/store/src/features/payments/reconcile-pending-payment-service.ts` | create | TX-01 observation/expiry/fresh verification; dispatch paid/failure use cases | `.test.ts` + mock E2E |
| `apps/store/src/features/orders/fail-order-service.ts` | create | TX-05 order failure workflow; invokes repository then dispatcher; typed outcomes | `.test.ts`, `.db.test.ts` |
| `apps/store/src/features/orders/failure-obligation-repository.ts` | create | Atomik failure + cancel intent + communication fact; historical proof gate | Fail-order DB public seam |
| `apps/store/src/features/orders/sales-settlement-repository.ts` | create | Invoice/payment confirmation + pointer commit/repair, consistent ID gate | `.db.test.ts` |
| `apps/store/src/features/orders/recover-order-transactions-service.ts` | create | Satu owner recovery: pointer repair, paid settlement, failure/cancel obligation, payment observation | Recovery service/DB tests |
| `apps/store/src/features/orders/transaction-recovery-repository.ts` | create | Candidate query/claim due scheduling untuk order; exclude healthy, stable ordering | `.db.test.ts` lewat public scheduler seam |
| `apps/store/src/features/orders/run-transaction-recovery-service.ts` | create | Bounded cron orchestration order/attempt, per-item isolation, honest counters | `.test.ts`, `.db.test.ts`, cron HTTP |
| `apps/store/src/features/checkout/checkout-recovery-policy.ts` | create | Pure attempt evidence→next local action/resume decision, bukan dispatcher | `.test.ts` |
| `apps/store/src/features/checkout/recover-checkout-service.ts` | modify | TX-06 per-attempt local repair/definitive compensation/no Snap create; scheduled selection | `.db.test.ts` baru; existing attempt tests |
| `apps/store/src/features/checkout/checkout-attempt-repository.ts` | modify | Accounting/expiry/cancel cause guards, schedule fields, resumed owned projection, lock order | Existing `.db.test.ts` |
| `apps/store/src/features/checkout/place-order-service.ts` | modify | Reuse shared continuation; persisted snapshot authoritative pada replay/resume; don't skip repair solely from parent label | Existing attempt service DB coverage |
| `apps/store/src/features/checkout/resume-checkout-service.ts` | create | Owner-scoped explicit resume first payment, no new SO, no repricing | `.test.ts`, `.db.test.ts`, resume route |
| `apps/store/src/features/checkout/checkout-attempt.ts` | modify | Additive resumeAvailable/resumeReason public DTO | Existing `.test.ts` |
| `apps/store/src/features/checkout/place-order-legacy-service.ts` | modify | Initial payment memakai shared workflow; no catch-all compensation; provider outside tx | Existing parity + new service tests |
| `apps/store/src/lib/payment-initialization.ts` | modify | Narrow legacy helper ke typed outcomes/delegate; hapus arbitrary-exception compensation setelah semua caller dimigrasikan | Existing `.test.ts` diperbarui semantiknya |
| `apps/store/src/lib/midtrans.ts` | modify | Existing Snap/pure helpers tetap; delegate status/expiry ke adapter; no swallowed error/raw log | Existing `midtrans.test.ts` |
| `apps/store/src/lib/order-finalize.ts` | modify | Existing paid/fulfill/public compatibility; failure delegate typed service/repository; no split obligation | Existing finalize + new DB coverage |
| `apps/store/src/lib/jubelio-sales-lifecycle.ts` | modify | Wire seluruh invoice/payment confirmations ke repository atomik; cancel/invoice mutual exclusion; no repeat POST | Existing lifecycle/recovery/holds DB tests |
| `apps/store/src/lib/jubelio-sales-operations.ts` | modify | Tx-capable record/claim helpers; preserve immutable refs; no dual confirmation path bypassing projection | Existing `.test.ts`/`.db.test.ts` |
| `apps/store/src/lib/jubelio-sales-settlement.ts` | modify | Reconcile through scheduler/use cases; pointer repair before gate; no healthy batch | Existing `.test.ts`/DB coverage |
| `apps/store/src/lib/checkout-recovery.ts` | modify | Integrate existing never-sent/rejected order create recovery without duplicate scheduler/provider dispatch | Recovery regression |
| `apps/store/src/app/api/cron/sweep-reservations/route.ts` | modify | Auth/parse/map/log only; no DB query/provider orchestration after migration | Existing `route.test.ts` |
| `apps/store/src/app/api/webhooks/midtrans/route.ts` | modify | Preserve signature/reverification HTTP boundary; use shared evidence/use cases; query moved to payment repository | `route.test.ts` baru |
| `apps/store/src/app/api/payments/midtrans/create/route.ts` | modify | Session/parse/map/log adapter shared initialize service, no SQL | `route.test.ts` baru |
| `apps/store/src/app/api/checkout/place-order/route.ts` | modify | Map additive legacy unknown response; preserve other mappings | Existing route tests/parity, updated expected behavior TX-02 only |
| `apps/store/src/app/api/checkout/requests/[requestKey]/route.ts` | modify | Additive read projection; explicitly no initialization | `route.test.ts` baru |
| `apps/store/src/app/api/checkout/requests/[requestKey]/resume/route.ts` | create | Strict empty-body/auth/admission/owner POST adapter | `route.test.ts` + checkout-resume E2E |
| `apps/store/src/app/api/orders/[id]/route.ts` | modify | Read additive paymentRecovery via scoped repository; preserve existing financial decoder and other DTO | Route/user-visible E2E |
| `apps/store/src/app/checkout/page.tsx` | modify | Explicit resume and legacy unknown recovery; keep same key/UX patterns | `checkout-resume-mock.spec.ts` |
| `apps/store/src/components/checkout/CheckoutAttemptFeedback.tsx` | modify | CTA/copy/accessibility matrix; onResume callback | Browser behavior/rendered review |
| `apps/store/src/app/account/orders/[id]/page.tsx` | modify | Minimal legacy payment recovery/verified ready CTA; paid no repay | `transaction-recovery-mock.spec.ts` |
| `packages/db/src/schema/payment-sessions.ts` | create | Sole definition order-owned payment ledger/constraints | Schema/retention DB tests |
| `packages/db/src/schema/orders.ts` | modify | Recovery scheduling fields/index | Recovery DB tests |
| `packages/db/src/schema/checkout.ts` | modify | Attempt scheduling/checks terminal cause | Existing schema + attempt DB tests |
| `packages/db/src/schema/index.ts` | modify | Export new schema | Affected app types |
| `packages/db/src/seed.ts` | modify | Realistic runtime-ready/known-rejected/unknown fixtures; unchanged writer gate defaults | Seed DB tests |
| `packages/db/src/seed-cleanup.ts` | modify | Delete sessions before orders; preserve FK ordering | `seed-cleanup.test.ts` |
| `packages/db/src/testing/retained-order-fixtures.ts` | modify | New child cleanup scoped to owned fixtures | Retention/related DB tests |
| `packages/db/drizzle/` | generate only | Audit migration+metadata, no manual edits | Schema/migration checks on disposable DB |
| `apps/jubelio-mock/src/server.ts` | modify | Controlled Snap duplicate/lost-response/status/expire conflict behavior and request capture | Existing `server.test.ts` |
| `e2e/store/transaction-recovery-mock.spec.ts` | create | TX-01–TX-05 customer→admin outcomes with real local HTTP/DB | Playwright final gate |
| `e2e/store/checkout-resume-mock.spec.ts` | create | TX-06 explicit resume and expiry/rejection unlock | Playwright final gate |
| `playwright.mock.config.ts` | modify | Register two spec stems in global and project testMatch | Specs actually selected/run |
| `docs/features/order-flow.md` | modify | New safe failure/session/recovery contract; distinguish paid/session/settlement | Documentation review |
| `docs/features/stock-reservation.md` | modify | Release evidence/obligation and ambiguity boundary | Documentation review |
| `docs/features/versioned-checkout-pricing.md` | modify | Resume immutable snapshot/deadline and additive result fields | Documentation review |
| `docs/features/jubelio-sales-orders.md` | modify | Atomic confirmations/local repair/cancel guards | Documentation review |
| `docs/api-reference.md` | modify | Resume endpoint + legacy202/DTO changes | HTTP contract review |
| `docs/deployment-docs/cron-sweep.md` | modify | Fairness, budgets, counters, schema preflight, conservative unknowns | Ops documentation review |
| `docs/testing/README.md` | modify | Explicit isolated new specs and fixture prerequisites | Verification command review |
| `docs/README.md` | modify | Link updated enduring contract entries | Navigation review |

Test files listed as `.test.ts`/`.db.test.ts` use full sibling basename, e.g. `apps/store/src/features/payments/initialize-order-payment-service.db.test.ts`; exact command paths are enumerated in §16. No runtime admin mutation changes are planned; existing admin guards/action paths are acceptance surfaces, not a license to refactor them.

### 14.2 Exported contracts (tanpa implementasi)

Type names below are internal domain contracts, not raw SDK shapes. Signatures may use explicit `dependencies?: { database, gateway, clock }` sesuai kebutuhan test seam; logger/correlation/request tidak termasuk dependency.

- `payment-evidence.ts`:
  - `PaymentObservation`: normalized union §7.1.
  - `PaymentInitializationOutcome`: `ready` dengan token/redirect; `definitive_rejection` dengan allowlisted code; `unknown` dengan safe code.
  - `FailureEvidence`: `provider_expired | payment_initialization_rejected | never_sent_expired`, dengan reference/amount/verifiedAt atau durable source claim/operation ID yang sesuai.
  - `validatePaymentObservation(input: { expectedReference: string; expectedAmount: string; observation: unknown }): PaymentObservation`.
- `midtrans-payment-client.ts`:
  - `observePayment(input: { reference: string; expectedAmount: string }): Promise<PaymentObservation>`.
  - `expirePayment(input: { reference: string; expectedAmount: string }): Promise<PaymentObservation>`; tidak menelan conflict menjadi success.
  - Existing Snap initialization helper dapat dipanggil adapter; jangan memindah seluruh SDK/pure builder tanpa kebutuhan.
- `initialize-order-payment-service.ts`:
  - `initializeOrderPayment(input: { orderId: string; clientId: string; source: "legacy_place" | "repayment" }, dependencies?): Promise<OrderPaymentResult>`.
  - `OrderPaymentResult`: ready/replayed, processing, manual_review, rejected, paid, expired, not_found/not_eligible. Ready memuat redirect dan token optional sesuai provenance; safe projected result tidak memuat DB row.
- `order-payment-repository.ts`:
  - `recordOrderPaymentIntent(tx, input: { orderId: string; providerReference: string; expectedAmount: string; paymentStartedAt: Date; expiresAt: Date; cartSnapshot: OrderCartSelection[]; now: Date }): Promise<{ sessionId: string }>`; dipanggil dalam initial legacy order transaction, sebelum provider calls.
  - `claimOrderPaymentInitialization(input: { orderId: string; clientId: string; now: Date }): Promise<OrderPaymentClaim>`.
  - `recordOrderPaymentOutcome(input: { sessionId: string; dispatchClaimId: string; outcome: PaymentInitializationOutcome; now: Date }): Promise<OrderPaymentResult>`.
  - `readOwnedOrderPaymentRecovery(input: { orderId: string; clientId: string; now: Date }): Promise<OrderPaymentRecoveryView | null>`.
  - `loadOrderPaymentEvidence(input: { orderId: string }): Promise<OrderPaymentEvidence | null>` untuk authenticated internal service, bukan browser endpoint bebas.
- `reconcile-pending-payment-service.ts`:
  - `reconcilePendingPayment(input: { orderId: string; now: Date }, dependencies?): Promise<PaymentReconciliationResult>`.
- `fail-order-service.ts`:
  - `failOrderWithEvidence(input: { orderId: string; evidence: FailureEvidence; reasonCode: string }, dependencies?): Promise<FailureOutcome>`.
- `failure-obligation-repository.ts`:
  - `commitOrderFailureObligation(input: { orderId: string; evidence: FailureEvidence; now: Date }): Promise<FailureCommitOutcome>`.
  - `repairMissingCancelObligation(input: { orderId: string; evidence: FailureEvidence; now: Date }): Promise<FailureCommitOutcome>`; caller harus memperoleh fresh evidence sebelum tx bila perlu.
- `sales-settlement-repository.ts`:
  - `confirmSettlementOperation(input: { orderId: string; operationId: string; type: "invoice" | "payment"; salesOrderId: number; invoiceId: number; paymentId?: number; verification: SettlementVerification; now: Date }): Promise<SettlementCommitOutcome>`.
  - `repairConfirmedSettlementProjection(input: { orderId: string; type: "invoice" | "payment"; now: Date }): Promise<SettlementRepairOutcome>`; returns repaired/already_consistent/verification_required/conflict/not_found.
- `transaction-recovery-repository.ts`:
  - `claimNextOrderRecovery(input: { now: Date; retryAt: Date }): Promise<OrderRecoveryWork | null>`; stable selection + scheduling commit.
- `recover-order-transactions-service.ts`:
  - `recoverOrderTransaction(input: { orderId: string; now: Date }, dependencies?): Promise<OwnerRecoveryResult>`.
- `run-transaction-recovery-service.ts`:
  - `runTransactionRecovery(input: { orderLimit?: number; attemptLimit?: number; deadline?: Date }, dependencies?): Promise<TransactionRecoverySummary>`.
  - Summary menghitung scanned/repaired/fulfilled/failed/held/errors tanpa PII; compatibility counters cron existing dipetakan eksplisit.
- `checkout-recovery-policy.ts`:
  - `decideCheckoutRecovery(input: { attempt: AttemptRecoveryEvidence; now: Date }): CheckoutRecoveryDecision` sesuai matrix §11.3.
- `recover-checkout-service.ts`:
  - Preserve `recoverCheckoutAttempts(input: { limit: number; cutoff: Date; now?: Date }, database?)` compatibility bila caller masih ada, tetapi scheduling authoritative memakai due fields.
  - `recoverCheckoutAttempt(input: { attemptId: string; now: Date }, dependencies?): Promise<OwnerRecoveryResult>` untuk satu owner.
- `checkout-attempt-repository.ts`:
  - Existing mutators tetap public seam; `accountConfirmedAttemptCancelHold` diperluas dengan input `terminalCause: "payment_rejected" | "checkout_expired"` dan evidence, bukan generic bypass-state bool.
  - `claimNextCheckoutRecovery(input: { now: Date; retryAt: Date }): Promise<AttemptRecoveryWork | null>`.
  - `readOwnedCheckoutAttempt` result mencakup resume fields; no mutation.
- `resume-checkout-service.ts`:
  - `resumeOwnedCheckout(input: { clientId: string; requestKey: string }, dependencies?): Promise<PlaceCheckoutResult | ResumeDeniedOutcome>`.
  - Memakai persisted fingerprint/snapshot dan one-time payment claim; client tidak menentukan expected money.
- `CheckoutAttemptFeedback.tsx`: existing props + `onResume: () => void`; availability dari server result, bukan local guess.
- Schema file baru: export `orderPaymentSessions`, `OrderPaymentSessionState`, `OrderPaymentSessionProvenance`; tidak export service dari package DB.
- New HTTP handlers: `POST(request, { params: Promise<{ requestKey: string }> })` pada resume; wrap structured request context mengikuti app version. Jangan mengandalkan signature framework dari ingatan; checkpoint Context7 saat implementasi.

### 14.3 Keputusan struktur

- **Order payment ledger terpisah dari attempt:** initial legacy sudah mempunyai order, attempt belum. Menjejalkan order legacy ke `checkout_attempt` melanggar promotion/owner checks. Ditolak: tabel generic provider_jobs atau schema pada app.
- **Satu initialize-order-payment service:** legacy dan repayment memiliki risiko bersama; dua claim terpisah akan mengulangi race TX-02.
- **Confirmation repository:** transaksi lokal meliputi operation+pointer; gateway tetap HTTP-only. Ditolak: hanya menambah catch/retry pada statement kedua.
- **Recovery scheduling pada owner existing:** cukup untuk fairness; tidak perlu broker/outbox kedua.
- **Pure attempt policy:** matrix dapat ditest deterministik tanpa coupling SQL; side effects tetap workflow service.
- **Tidak memindah seluruh lib legacy:** ubah hanya boundaries yang diperlukan, gunakan compatibility exports sementara tanpa dua implementasi aktif.

## 15. Urutan integrasi yang disarankan (bukan publication tickets)

1. **Jalur expired payment → order aman (TX-01):** RED pada public reconcile seam, normalized adapter + safe evidence gate, route/cron wiring, author E2E. Hasil terlihat: paid-race tidak membuat failed order. Schema foundation yang belum tersambung user path bukan deliverable.
2. **Jalur initial legacy/repayment → satu sesi (TX-02):** schema ledger/seed bersama shared service, HTTP mapping, customer unknown feedback, concurrency regression. Jangan mengaktifkan reader schema baru pada DB pengguna tanpa izin sync.
3. **Jalur failed order → remote reservation dibersihkan (TX-05):** durable obligation + cancel/invoice exclusion + release; crash recovery dan historical proof guard. Dependensi dipakai TX-06 expired compensation.
4. **Jalur paid → pickup/delivery dapat dipenuhi (TX-03/TX-04):** repository atomik, torn repair, scheduler/fairness/isolation, consumer regression hingga admin action.
5. **Jalur attempt interrupted → customer melanjutkan/terlepas (TX-06):** complete state matrix, explicit POST resume/UX, expiry compensation, same-key race, no Snap from cron. Integrasikan scheduler order/attempt dan final regression.

Sesi yang mengerjakan satu bagian harus mencatat AC Pending yang bergantung bagian lain. Perubahan keputusan/scope/UX kembali ke pengguna. Breakdown ticket resmi perlu approval terpisah; plan approval bukan izin delegasi.

## 16. Acceptance criteria dan keputusan testing

### 16.1 Test seams yang dikonfirmasi

- Tertinggi: HTTP route + browser customer→admin dengan mock provider stateful dan DB disposable nyata.
- Workflow: initialize/reconcile/fail/confirm/recover/resume public functions. Assertions outcome/invariant, bukan private helper call count atau source string matching.
- PostgreSQL diperlukan untuk commit/rollback, unique claim, lock/concurrency, accounting, query fairness, dan torn records. Mock Drizzle chain saja bukan evidence.
- Pure policy untuk payment observation dan attempt decision matrix. Expected values dari literal/independent fixture, tidak memakai helper implementation untuk menghitung expected yang sama.
- Fault injection memakai fake gateway/barrier/transaction dependency yang controlled. Tidak memakai sleep acak atau timer dunia nyata untuk menebak race. Provider request counters/captured external requests boleh dipakai sebagai bukti at-most-once; assertion bisnis tetap melalui public seam.

Prior art: `apps/store/src/lib/jubelio-sales-recovery.db.test.ts`, `apps/store/src/lib/jubelio-sales-operations.db.test.ts`, `apps/store/src/features/checkout/checkout-attempt-repository.db.test.ts`, `e2e/store/checkout-review-mock.spec.ts`, `e2e/store/pickup-mock.spec.ts`, `e2e/store/versioned-settlement-mock.spec.ts`. `e2e/store/sales-recovery.spec.ts` legacy bukan command default karena shared/live cleanup contract-nya berbeda.

### 16.2 Matriks acceptance

Semua baris **Pending** untuk implementasi; spec ini tidak menyatakan bug sudah diperbaiki.

| AC | Risiko | Hasil yang wajib terbukti / kondisi pemalsu awal | Evidence wajib |
|---|---|---|---|
| AC01 | TX-01 | GET pending→expire conflict→GET paid tidak menghasilkan failed/cancel; current code mengabaikan expiry outcome | Unit service + real-HTTP mock E2E |
| AC02 | TX-01 | Timeout/malformed/HTTP200 business412 tidak menjadi failure; unknown tetap held | Adapter/service tests |
| AC03 | TX-01 | Expire verified yang cocok menghasilkan failure+obligation; wrong ID/amount tidak mengubah order | Service + PG |
| AC04 | TX-01 | Paid webhook vs failure/cancel concurrent tidak downgrade; cancel sudah aktif→paid blocked tanpa SO baru | Barrier PG + HTTP |
| AC05 | TX-01 | 404 historical/possibly-sent bukan bukti never-sent; jangan false release | Service + PG |
| AC06 | TX-02 | Initial legacy dan repayment parallel menghasilkan satu Snap create; loser tidak compensation | PG + mock request capture |
| AC07 | TX-02 | Create applied lalu response lost mempertahankan unknown, no failed/SO cancel | Service + E2E |
| AC08 | TX-02 | Duplicate/generic4xx bukan definitive rejection; allowlisted true rejection membentuk obligation | Adapter/service + PG |
| AC09 | TX-02 | Ready session reused, no TTL extension/reprice, ownership enforced | HTTP + E2E |
| AC10 | TX-02 | Payment result persistence failure tidak compensation; durable known handle dapat direpair tanpa POST kedua | Fault PG/service |
| AC11 | TX-02 | Historical redirect diadopsi aman; historical missing evidence tidak dibuat sebagai fresh intent | PG + HTTP |
| AC12 | TX-02 | UI legacy202 menunjukkan pemeriksaan same order, bukan “gagal, coba order baru” | Browser/rendered review |
| AC13 | TX-03 | Invoice confirmation+pointer rollback/commit bersama pada fault di antaranya | PG transaction seam |
| AC14 | TX-03 | Payment confirmation+pointer rollback/commit bersama; seluruh initial/GET recovery call sites memakai seam sama | PG + relevant service regression |
| AC15 | TX-03 | Seed torn confirmed/null pointer; recovery memperbaiki tanpa provider POST | PG + mock capture |
| AC16 | TX-03 | Conflicting pointer/linkage tidak overwrite/fulfill; other blocker tidak dibersihkan | PG + HTTP |
| AC17 | TX-03 | Repaired paid pickup→kode→admin verify completed; repaired delivery→packing→booking→handoff→DELIVERED completed melalui provider mock | Mock browser customer+admin |
| AC18 | TX-04 | 50 healthy delivery + satu pending settlement: yang butuh recovery mendapat giliran, sehat tidak terus diproses | PG scheduler + mock HTTP |
| AC19 | TX-04 | >limit candidate dan controlled retry clock membuktikan stable progress; poison owner tidak menghalangi owner berikutnya | PG controlled-clock |
| AC20 | TX-04 | Dua cron concurrent tidak memberikan duplicate dispatch permission; budget/counters jujur | PG + cron HTTP |
| AC21 | TX-04 | Error satu owner tidak membatalkan seluruh batch; DB boundary error tidak dilaporkan fulfilled | Service/cron tests |
| AC22 | TX-05 | Failure status+cancel obligation atomik: crash setelah commit tetap meninggalkan pekerjaan durable | PG fault + sweep |
| AC23 | TX-05 | Crash setelah intent/sebelum claim: exactly one allowed cancel dispatch setelah recovery | PG + provider capture |
| AC24 | TX-05 | Possibly-sent cancel tidak di-POST ulang; confirmed cancel/accounting diperbaiki sekali | PG + existing hold regression |
| AC25 | TX-05 | Cancel intent/claim vs invoice intent concurrent tidak mendapat dua write authorizations yang bertentangan | Barrier PG |
| AC26 | TX-05 | Stock/promo release sekali dan hanya setelah bukti; consumed/late-paid tetap aman | PG independent counters/events |
| AC27 | TX-05 | Missing historical obligation direpair hanya setelah fresh proof; initialization_error lama sendiri tidak cukup | PG + gateway stub |
| AC28 | TX-05 | Duplicate failure tidak mengulang failure communication fact atau mencatat cancel intent kedua | PG + communication seam |
| AC29 | TX-06 | Create rejected + parent preparing/manual-local → final rejected/released sebelum/sesudah TTL | PG state fixture |
| AC30 | TX-06 | Create confirmed + hold unaccounted → local accounting/resumable tanpa SO/Payment POST dari cron | PG + capture |
| AC31 | TX-06 | Confirmed SO, payment never sent, sebelum TTL → GET resumeAvailable; GET repeated zero provider write | HTTP + browser |
| AC32 | TX-06 | Customer klik Lanjutkan checkout→satu sesi pertama→promoted; attempt/key/snapshot/deadline sama | Browser + mock capture |
| AC33 | TX-06 | Dua resume bersamaan/initial continuation race → satu payment dan satu order | Barrier PG + HTTP |
| AC34 | TX-06 | Saat expired tidak resume; cancel confirmed→rejected CHECKOUT_EXPIRED→account dapat review baru | PG + browser |
| AC35 | TX-06 | Payment ready tetapi promotion terputus→local promotion tanpa session create ulang, termasuk expired link tidak ditawarkan | PG + HTTP |
| AC36 | TX-06 | True create/payment unknown tetap held/no retryAllowed/no resume, walaupun TTL lewat | PG + browser |
| AC37 | TX-06 | Salah parent manual-review diperbaiki hanya jika child evidence pasti; true manual-review operation tidak dioverride | PG |
| AC38 | TX-06 | Wrong owner/nononboarded/invalid body/key/forged resume flags tidak menimbulkan effect atau disclosure | Route + E2E |
| AC39 | TX-06 | Resume tetap tersedia ketika cart kosong tapi pending key ada; tidak memerlukan harga/selection baru | Browser 2 viewport |
| AC40 | Lintas | Semua gate0/gate1, pickup/delivery, supported pricing/provider versions menjaga snapshot, tax, amount, deadline | Existing + new focused regression |
| AC41 | Lintas | Seed/reset/retention child cleanup sesuai FK; migration additive preserves existing evidence | Disposable schema/PG tests |
| AC42 | Lintas | Auth store/admin terpisah, physical Home Branch/action guards existing tidak dilemahkan | Existing admin/mock lifecycle specs |
| AC43 | Lintas | Logs success/failure aman, tanpa token/pickup credential baru/raw payload; new counters no PII | Focused log tests/review |
| AC44 | Lintas | New mock specs benar-benar terpilih di kedua testMatch; tidak memakai synthetic x-e2e-payment-mock untuk assertion HTTP payment | Runner listing/capture + actual passing run |
| AC45 | Lintas | UX state/copy/primary action dan keyboard/responsive sesuai §13.2; no false payment retry | Main-agent rendered review + Playwright |
| AC46 | Lintas | Full verification integrated dan enduring docs/API/cron updated; semua AC memiliki evidence, bukan hanya jumlah test | Final evidence register + review |

### 16.3 RED yang harus ada sebelum perbaikan

- Reconcile pending→expire throws saat ini tetap fail: satu test service harus membuktikan RED sebelum mengubah behavior.
- Arbitrary create exception saat ini memanggil compensation pada `payment-initialization.test.ts`. Test existing itu mengunci perilaku yang salah; ubah expected berdasarkan spec ini dan buktikan RED, bukan mempertahankannya atas nama parity.
- Torn confirmed invoice/payment null pointer harus gagal recover sebelum repository atomik/repair ditambahkan.
- 50 healthy delivery harus menunjukkan candidate selection keliru sebelum filter/scheduler diperbaiki.
- Crash setelah failure commit harus menunjukkan missing obligation sebelum fix.
- Confirmed/rejected pre-order checkpoint harus menunjukkan blocked account/resume unavailable sebelum policy fix.

Characterization parity yang terkait salah satu perubahan di atas boleh berubah sesuai AC, tetapi log/HTTP/side effect di luar enam risiko tetap dilindungi. Jangan mengubah unrelated assertion agar suite hijau.

### 16.4 Mock transport dan safety

- `apps/jubelio-mock/src/server.ts` perlu merekam Snap create dan mengembalikan duplicate response, controlled status, POST `/v2/{reference}/expire` success/conflict/timeout; tidak ada fallback ke vendor.
- Dua spec baru harus menonaktifkan synthetic header `x-e2e-payment-mock` pada request terkait sehingga **real app → loopback mock Snap** benar-benar dijalankan. Passing synthetic redirect bukan evidence TX-02/TX-06.
- Fake provider credentials, strict loopback/nonproduction guards, DB disposable `marketplace_discounts_test_*`, unique fixture prefix dan scoped cleanup. Jangan memakai DB default/local pengguna/staging/production.
- Fault injection baru tidak boleh berupa unauthenticated debug endpoint pada runtime production. Utamakan public service dependencies dan controlled provider barrier; fixture SQL hanya untuk menyiapkan state/fault boundary, assertions melalui public operation/UI.

### 16.5 Verification ladder dan command paths

Per slice: tulis satu RED→GREEN pada seam terkait, lalu L0 affected types. Tidak menjalankan full suite/E2E/integration suite per internal batch. Author integration/E2E tests bersama behavior; eksekusinya pada final gate scope yang diminta, kecuali pengguna mengizinkan focused PG run lebih awal untuk membuktikan transaksi/concurrency.

Focused unit path inventory (pilih hanya yang disentuh slice):

```text
apps/store/src/features/payments/payment-evidence.test.ts
apps/store/src/features/payments/midtrans-payment-client.test.ts
apps/store/src/features/payments/initialize-order-payment-service.test.ts
apps/store/src/features/payments/reconcile-pending-payment-service.test.ts
apps/store/src/features/orders/fail-order-service.test.ts
apps/store/src/features/orders/run-transaction-recovery-service.test.ts
apps/store/src/features/checkout/checkout-recovery-policy.test.ts
apps/store/src/features/checkout/resume-checkout-service.test.ts
apps/store/src/features/checkout/checkout-attempt.test.ts
apps/store/src/lib/midtrans.test.ts
apps/store/src/lib/payment-initialization.test.ts
apps/store/src/lib/order-finalize.test.ts
apps/store/src/lib/jubelio-sales-operations.test.ts
apps/store/src/lib/jubelio-sales-settlement.test.ts
apps/store/src/app/api/cron/sweep-reservations/route.test.ts
apps/store/src/app/api/webhooks/midtrans/route.test.ts
apps/store/src/app/api/payments/midtrans/create/route.test.ts
apps/store/src/app/api/checkout/requests/[requestKey]/route.test.ts
apps/store/src/app/api/checkout/requests/[requestKey]/resume/route.test.ts
apps/store/src/app/api/checkout/place-order/route.lifecycle-parity.test.ts
apps/store/src/app/api/checkout/place-order/route.parity.test.ts
```

PG public-seam path inventory (new bila belum ada):

```text
apps/store/src/features/payments/initialize-order-payment-service.db.test.ts
apps/store/src/features/orders/fail-order-service.db.test.ts
apps/store/src/features/orders/sales-settlement-repository.db.test.ts
apps/store/src/features/orders/transaction-recovery-repository.db.test.ts
apps/store/src/features/orders/run-transaction-recovery-service.db.test.ts
apps/store/src/features/checkout/recover-checkout-service.db.test.ts
apps/store/src/features/checkout/resume-checkout-service.db.test.ts
apps/store/src/features/checkout/checkout-attempt-repository.db.test.ts
apps/store/src/lib/jubelio-sales-recovery.db.test.ts
apps/store/src/lib/jubelio-sales-operations.db.test.ts
apps/store/src/lib/jubelio-sales-holds.db.test.ts
packages/db/src/order-retention.db.test.ts
packages/db/src/schema/checkout.test.ts
packages/db/src/seed-cleanup.test.ts
```

Final commands (dijalankan setelah code terintegrasi dan infrastructure disposable tersedia):

```bash
npm run verify:types:store
npm run verify:types:admin
npm run lint:store
npm run lint:admin
npm run test:unit -- --no-file-parallelism
npm run verify:batch:e2e -- e2e/store/transaction-recovery-mock.spec.ts e2e/store/checkout-resume-mock.spec.ts e2e/store/checkout-review-mock.spec.ts e2e/store/pickup-mock.spec.ts e2e/store/versioned-settlement-mock.spec.ts e2e/store/delivery-order-mock.spec.ts e2e/store/shipment-booking-mock.spec.ts e2e/store/shipment-tracking-mock.spec.ts e2e/store/delivery-follow-up-mock.spec.ts e2e/store/order-communications-mock.spec.ts e2e/admin/checkout-attempt-review-mock.spec.ts
```

Set `DATABASE_URL` eksplisit ke disposable sebelum command yang dapat mengakses PG; full unit suite repo mencakup file PG. Jangan menganggap skip DB sebagai AC Verified. Legacy `npm run test:e2e` perlu izin terpisah dan tidak otomatis dijalankan. Main agent menginspeksi rendered UI; jika browser terblokir, AC45 Pending. Saat Playwright gagal baca Markdown, jangan membuka PNG.

Baseline dari sesi review sebelumnya: 12 focused files / 152 tests passed. Itu **bukan evidence perbaikan spec ini**. Sesi penulisan spec hanya melakukan inspeksi/docs lookup, tidak menjalankan ulang app tests.

## 17. Deployment, data compatibility, dan dokumentasi

1. Tidak menambah provider credential, domain, port, cron endpoint/cadence, atau deployment env baru. Internal retry/budget constants harus didokumentasikan; perubahan env/timeout host memerlukan scope approval.
2. Schema additive terlebih dahulu, compatible code kedua, writer behavior terakhir dalam rollout yang diotorisasi. Perhatikan `.select()` schema-wide: code yang membaca kolom baru sebelum schema sync dapat membuat halaman existing 500.
3. **Sebelum DB development pengguna disentuh:** minta izin eksplisit, jelaskan kolom/table baru dan risiko 500 sampai diterapkan. Jangan menyisipkan `db:push`, reset atau seed ke sesi spec/implementation tanpa izin itu.
4. Generated migration menjadi audit record. Dev menggunakan `db:push`, bukan `db:migrate` pada database schema-sync pengguna. Deployment migrasi mengikuti tooling existing dan memerlukan izin remote/deploy tersendiri.
5. Tidak menghapus payment token, remote IDs, attempt fingerprint/snapshot, redemption events, atau ledger history. Tidak membackfill state unknown menjadi intent. Existing redirect dapat diadopsi lazy tanpa mengubah history lifecycle.
6. Seeder mengisi fixtures realistis untuk ready legacy, safe never-sent, unknown, confirmed/torn recovery, serta terminal sample yang tidak memicu auto provider write; cleanup FK ordered mencakup tabel baru. Default gate tetap 0 sesuai kontrak existing.
7. Rollback bukan membatalkan provider write. Setelah sessions/obligations baru ada, gunakan compatible rollback image atau pause writer dan forward fix; jangan menjalankan image yang mengulang initialization tanpa shared claim.
8. Update enduring docs di blueprint. Cron doc harus menerangkan deferred/manual cases, counters, next-due scheduling, dan cara memeriksa bukti tanpa meminta operator mengulang POST manual.
9. Tidak menjanjikan semua historical corrupt/unknown cases terselesaikan otomatis. Laporkan kelompok yang aman diperbaiki dan kelompok yang masih perlu investigasi; jangan menutupnya sebagai resolved hanya karena job tidak error.

## 18. Context7 checkpoint dan discovery terikat

### 18.1 Yang sudah diperiksa untuk draft

- Context7 canonical `/websites/midtrans_reference`: [Expire Transaction](https://docs.midtrans.com/reference/expire-transaction), [Expire API](https://docs.midtrans.com/reference/expire-api) — business error 412 dapat dikembalikan pada HTTP200; success expire perlu body/evidence, bukan status HTTP saja.
- Library yang sama: [Get Transaction Status](https://docs.midtrans.com/reference/get-transaction-status), [Create Checkout Token](https://docs.midtrans.com/reference/create-checkout-token-api) — GET status terpisah dari token creation; duplicate order ID error bukan bukti sesi tidak ada; authentication rejection berbeda dari network unknown.
- Library yang sama: [Expire a Snap Session](https://docs.midtrans.com/reference/expire-a-snap-session) — `expiry.start_time` mengikat anchor; tanpa start_time countdown dapat dimulai ketika customer memilih payment method. Sumber memiliki perbedaan catatan minimum expiry; **jangan** mengubah TTL/minimum dari ringkasan Context7 tanpa memastikan vendor contract installed path.
- Installed SDK 1.4.3: `node_modules/midtrans-client/lib/snap.js`, `lib/transaction.js`, `lib/httpClient.js` — create memakai Snap base; transaction.expire memakai Core `/v2/{id}/expire`; SDK menolak business status>=400 kecuali407. Source ini juga menunjukkan alasan adapter mock status/expire tidak boleh diam-diam memakai real SDK base.
- Path UI alias diperiksa pada `apps/store/tsconfig.json`: Button/Card sebenarnya dari `packages/ui/src/components/ui/`, bukan folder UI store.

### 18.2 Discovery wajib sesi implementasi

- `discovery:provider-proof` — konfirmasi exact supported status/expire/auth error shapes dan timeout transport untuk installed `midtrans-client` melalui Context7/official source. Tidak menganggap 404 sebagai safe release dan tidak menciptakan endpoint retrieve-token-by-order yang belum terdokumentasi. Jika bukti tidak tersedia, default adalah defer/held sesuai spec, bukan menebak.
- `discovery:api-checkpoint` — sebelum library code pertama, resolve/query installed Drizzle 0.45.x, Next16/React19, Vitest/Playwright APIs yang akan dipakai; catat canonical IDs dan signatures. Draft ini tidak menjalankan library code/migration.
- `discovery:schema-generated-name` — lihat migration journal saat implementasi; nama nomor SQL berikutnya mengikuti generator, jangan menebak atau hand-edit file existing.
- `discovery:runtime-drift` — HEAD/gate DB/route exports yang aktual bisa berubah sebelum sesi lain. Verifikasi diff terhadap snapshot, jangan mengubah scope otomatis. Nilai gate operational dicari read-only jika ada izin akses; bukan pertanyaan yang harus ditebak pengguna.
- `discovery:query-plan` — EXPLAIN pada fixture disposable memastikan healthy exclusion dan index due benar-benar dipakai pada volume relevan; jangan klaim benchmark production.

Tidak ada keputusan produk tambahan yang diperlukan untuk draft ini setelah pilihan customer resume. Discovery di atas adalah pekerjaan verifikasi fakta dengan safe fallback yang sudah ditetapkan. Kebutuhan memperluas lifecycle, provider retry, atau operational override menjadi keputusan baru dan menghentikan slice terkait.

## 19. Paket cold-start untuk sesi berikutnya

1. Baca `AGENTS.md`, app AGENTS, skills yang cocok, index fitur, **complete spec ini**, dan research TX-01–TX-06. Jangan melakukan ulang broad audit 17 temuan sebagai pengganti pekerjaan yang dipilih.
2. Periksa apakah index sudah Ready dan complete approval tercatat. Jika masih Draft, minta approval spec lengkap; jangan menganggap konfirmasi scope/resume sebelumnya sebagai approval semua desain/schema/AC di sini.
3. Periksa `git status`, HEAD, diff/staged diff; jangan overwrite research/spec atau perubahan pengguna.
4. Nyatakan bagian yang akan dikerjakan, AC terkait, first RED seam, dan kondisi infrastructure. Tidak ada subagent tanpa izin saat sesi itu.
5. Persiapkan disposable DB/mock saja setelah otorisasi yang sesuai. DB pengguna/live provider bukan test environment.
6. Jalankan satu vertical change dengan RED→GREEN; author browser coverage bersamaan dan defer final execution sesuai ladder. Jangan mengklaim user path selesai dari schema/services saja.
7. Catat evidence command/ref/fixture/result/AC, safe provider counts, deviation dan blocker pada `.scratch/order-flow/ticket/verification.md` ketika implementasi dimulai. File tersebut evidence, bukan ticket breakdown otomatis.
8. Update status plan hanya pada index fitur; jangan menandai Done selama ada AC Pending atau closing checklist belum terpenuhi.

## 20. Penutupan dan batas klaim

Checklist berikut menjadi closing contract implementasi. Salin unfinished items apa adanya ke limitations laporan progres/akhir.

- [ ] AC01–AC46 mempunyai evidence aktual untuk integrated code; tidak ada AC yang dianggap lulus dari test count saja.
- [ ] TX-01/TX-02 tidak menghasilkan false failure/cancellation pada conflict, timeout, duplicate, atau malformed response.
- [ ] TX-03/TX-05 menutup local commit crash windows dan mempertahankan provider evidence tanpa duplicate write/release.
- [ ] TX-04/TX-06 membuktikan progress kasus dengan bukti pasti, bukan sekadar cron returns200 atau parent manual-review.
- [ ] Customer resume memakai attempt/key/snapshot/deadline semula; GET dan cron tidak menginisialisasi Snap attempt.
- [ ] Unknown/historical evidence yang belum cukup tetap held dan dilaporkan sebagai keterbatasan, bukan dipaksa rejected atau resolved.
- [ ] Pickup dan delivery berjalan sampai tindakan admin terkait melalui mock E2E, dengan guard existing tetap berlaku.
- [ ] Main agent meninjau rendered UX dan interaction states pada dua viewport sesuai blueprint.
- [ ] Migration/seed/retention compatibility terverifikasi pada database disposable; tidak ada perubahan DB pengguna/provider/deployment tanpa izin terpisah.
- [ ] Final types, lint, full unit dan mock E2E yang relevan lulus; seluruh skip/blocker dijelaskan.
- [ ] Dokumentasi enduring/API/cron/testing diperbarui; plan tetap disimpan dan index diberi status/date/evidence yang benar.
- [ ] Tidak ada TX-07–TX-17, redesign admin, refund/reversal automation, atau mass refactor unrelated yang masuk diam-diam.
