# Review keamanan dan keandalan flow transaksi

Kode aplikasi belum diubah. Reproduction baru dengan PostgreSQL, concurrency/fault injection, dan browser masih **Pending**; temuan di bawah berasal dari penelusuran kode dan kontrak, bukan klaim insiden atau eksploit production.

## Ringkasan

- Snapshot review: `d75a44266af21e9a70329bced1f7a97640dd7e50`, branch `worktree/diskon`, 10 November 2026. Worktree bersih sebelum review.
- Cakupan: checkout legacy dan checkout attempt berversi, Snap/repayment, webhook Midtrans, sweep, Sales Order/invoice/payment Jubelio, webhook stok/pengiriman, pickup admin, packing/booking/handoff/reconcile/manual finish, antrean review dan komunikasi order.
- Review ini mengaudit **implementasi saat ini**, bukan hanya diff terhadap suatu branch. Tidak mengatribusikan bug ke commit refactor terbaru.
- **17 temuan:** 6 P1 (correctness/liveness transaksi), 11 P2 (komunikasi, kontrol keamanan, operasi, integritas pembacaan, dan scalability). Tidak ada P0 atau bypass pembayaran tanpa autentikasi yang berhasil dibuktikan.
- Pengujian existing terfokus: **12 file / 152 test lulus**, dua run tanpa file overlap. Ini bukan bukti bahwa skenario bug baru sudah direproduksi.
- Tidak menjalankan full suite, DB integration, E2E, build, schema sync, deployment, atau provider write. Tidak menggunakan subagent.
- Gate `discounts.contractVersion` pada DB operasional **tidak diperiksa**. Temuan legacy berlaku pada gate 0; temuan attempt baru berlaku pada gate 1. Keduanya masih memiliki jalur runtime di kode.

### Arti severity dan evidence

- **P1:** berpotensi salah membatalkan transaksi, meninggalkan pembayaran/order tidak konsisten, atau menghentikan recovery; prioritaskan sebelum peningkatan volume/rollout.
- **P2:** berdampak nyata pada guard, email, visibilitas operator, atau scaling; beberapa memerlukan race atau ketidakkonsistenan tersimpan sebagai prasyarat.
- Semua temuan mempunyai evidence **static trace**. Bagian “regression” adalah usulan kasus yang perlu ditulis dan dijalankan, **bukan hasil test baru**. Gap guard tidak otomatis berarti customer dapat mengeksploitasinya.

## Metode dan peta alur

1. Inventarisasi entry point, schema, ownership, dan dokumen kontrak.
2. Telusuri entry point sampai transaksi DB dan HTTP provider; identifikasi siapa pemilik status dan siapa berhak bertindak.
3. Periksa invariant: uang authoritative; paid tidak hilang; stock/promo hold dilepas hanya dengan bukti; provider write tidak diulang buta; transisi status atomik; scope cabang ditegakkan; recovery tetap maju.
4. Periksa setiap crash window sebelum/sesudah intent, dispatch, verification, confirmation, dan local projection.
5. Bandingkan jalur webhook, cron, dan tindakan admin untuk mencari perbedaan policy.
6. Jalankan unit tests existing yang relevan; pisahkan hasilnya dari gap coverage.

```text
Customer → preview/review → place order
  ├─ gate 0: order + SO intent → SO confirmed → Snap → simpan redirect
  └─ gate 1: attempt + hold + SO intent → SO confirmed → Snap ready → promosi order

Midtrans webhook / sweep → paid claim → invoice verified → payment verified
  ├─ pickup: ready_for_pickup + kode → admin verify → internal complete
  └─ delivery: processing + unblocked → pack → book → handoff/tracking
                                            ├─ DELIVERED → completed
                                            └─ penutupan manual → completed, bukan bukti diterima
```

Kontrak pembanding: [order flow](../../../docs/features/order-flow.md), [delivery fulfillment](../../../docs/features/delivery-fulfillment.md), [delivery follow-up](../../../docs/features/delivery-follow-up.md), [komunikasi order](../../../docs/features/order-communications.md), [pricing berversi](../../../docs/features/versioned-checkout-pricing.md), serta [standar organisasi backend](../../../docs/architecture/code-organization.md).

## Temuan correctness dan keamanan

### TX-01 — P1: sweep menggagalkan order tanpa bukti expiry berhasil

**Lokasi:** [sweep:249–259](../../../apps/store/src/app/api/cron/sweep-reservations/route.ts#L249), [expire adapter:469–485](../../../apps/store/src/lib/midtrans.ts#L469).

`expireMidtransTransaction()` mengabaikan hasil sukses dan menelan semua exception. Setelah memanggilnya, sweep tetap menjalankan `claimAndFailOrder()`.

**Skenario:** GET membaca `pending`; customer membayar; expire ditolak karena transaksi sudah settled, atau koneksi timeout. Sweep tetap menulis failed dan dapat membatalkan SO. Webhook berikutnya bisa menyelamatkan bukti paid melalui late settlement, tetapi SO mungkin sudah dibatalkan sehingga fulfillment tertahan. Jika webhook hilang, sweep pending-order tidak lagi membaca order itu.

**Arah perbaikan:** outcome expiry bertipe; hanya bukti terminal yang mengizinkan failure/cancel. Pada conflict/unknown, GET ulang status dan pertahankan reconciliation bila belum pasti. Jangan menyimpulkan gagal dari snapshot sebelum expiry.

**Regression:** barrier antara GET pending dan expire; expiry menghasilkan 412, timeout, dan settlement. Assert tidak ada false failure/SO cancel.

**Referensi provider:** Context7 `/websites/midtrans_reference`, [Expire Transaction](https://docs.midtrans.com/reference/expire-transaction) dan [Expire API](https://docs.midtrans.com/reference/expire-api): response perlu dibaca; error bisnis `status_code: "412"` bahkan didokumentasikan dalam HTTP 200.

### TX-02 — P1: checkout legacy menganggap timeout pembuatan Snap sebagai penolakan

**Lokasi:** [payment initialization:1–17](../../../apps/store/src/lib/payment-initialization.ts#L1), [pemakaian legacy:390–420](../../../apps/store/src/features/checkout/place-order-legacy-service.ts#L390).

Semua exception dari `createLegacyPayment()` memicu compensation `claimAndFailOrder()`. Tidak dibedakan apakah provider menolak sebelum membuat sesi atau sudah membuat sesi tetapi response hilang. Adapter baru `createCheckoutPayment()` sudah mempunyai klasifikasi `ready/definitive_rejection/unknown`; legacy belum menggunakannya.

**Skenario:** Snap menerima create, response terputus. Order lokal gagal dan SO dibatalkan meskipun sesi pembayaran mungkin ada. Race yang lebih konkret: order legacy sudah terlihat di history sebelum initial Snap selesai; customer memanggil repayment, memperoleh sesi untuk order ID yang sama, lalu initial create ditolak sebagai duplicate. Exception duplicate tersebut juga memicu cancellation, padahal customer sudah mempunyai sesi untuk membayar.

**Arah perbaikan:** gunakan klasifikasi outcome yang konservatif juga pada jalur legacy. Timeout adalah unknown, bukan izin cancel. Pertahankan evidence dan recovery; jangan blind retry create.

**Regression:** create di provider berhasil lalu transport melempar; assert SO tidak otomatis dibatalkan dan order tidak diklaim pasti gagal.

### TX-03 — P1: confirmation ledger dan pointer invoice/payment order tidak atomik

**Lokasi:** [invoice confirmation:999–1010](../../../apps/store/src/lib/jubelio-sales-lifecycle.ts#L999), [invoice early return:770](../../../apps/store/src/lib/jubelio-sales-lifecycle.ts#L770), [payment confirmation:1501–1512](../../../apps/store/src/lib/jubelio-sales-lifecycle.ts#L1501), [payment early return:1243](../../../apps/store/src/lib/jubelio-sales-lifecycle.ts#L1243).

Ledger ditandai `confirmed`, lalu pointer `orders.jubelioInvoiceId`/`jubelioPaymentId` ditulis melalui statement terpisah. Retry pada operasi confirmed langsung return tanpa memperbaiki pointer.

**Skenario:** process crash setelah confirmation invoice tetapi sebelum update order. Recovery melihat invoice confirmed, tetapi payment menolak karena order tidak mempunyai invoice ID. Pada payment, ledger bisa confirmed tetapi pointer payment tetap null; settlement tampak berhasil sementara packing menolak karena linkage tidak cocok.

**Arah perbaikan:** satu transaksi local confirmation + order projection, atau repair idempoten pada confirmed replay dengan consistency check. Provider GET/POST tetap di luar transaksi.

**Regression:** hentikan eksekusi pada dua celah tersebut, restart recovery, assert pointer pulih tanpa provider POST kedua.

### TX-04 — P1: delivery yang sehat dapat menghabiskan seluruh batch settlement recovery

**Lokasi:** [reconcileSettlements:384–418](../../../apps/store/src/lib/jubelio-sales-settlement.ts#L384), [delivery tetap processing:247–305](../../../apps/store/src/lib/jubelio-sales-settlement.ts#L247).

Pemilihan `processing + paid LIMIT 50` tidak mengecualikan delivery yang settlement-nya sudah lengkap. Komentar mengasumsikan order fulfilled keluar dari `processing`, padahal delivery memang tetap processing sampai diterima/ditutup.

**Skenario:** 50 delivery sehat menunggu kurir. Plan DB dapat mengembalikan 50 row yang sama setiap sweep; order ke-51 yang butuh recovery tidak mendapat giliran. Tidak ada cursor atau ordering yang menjamin fairness. Satu exception per order juga keluar dari seluruh loop, sehingga sisa batch dilewati.

**Arah perbaikan:** pilih hanya order yang membutuhkan kerja berdasarkan ledger/projection; gunakan retry scheduling/cursor yang bergerak dan isolasi error per order. Jangan sekadar menambah LIMIT.

**Regression:** 50 healthy delivery + 1 paid order belum settled; run berulang harus memproses order terakhir. Tambahkan satu poison row.

### TX-05 — P1: crash setelah commit failed dapat kehilangan kewajiban cancel SO

**Lokasi:** [failure commit dan cancel:477–522](../../../apps/store/src/lib/order-finalize.ts#L477), [pending-only sweep:175–186](../../../apps/store/src/app/api/cron/sweep-reservations/route.ts#L175), [operation sweep:448–455](../../../apps/store/src/lib/jubelio-sales-settlement.ts#L448).

Transaksi failure tidak mencatat cancel intent. Intent dibuat setelah commit ketika `dispatchJubelioSalesCancel()` dipanggil. Crash/DB error di antaranya menyisakan failed order dengan SO aktif tanpa pekerjaan durable untuk membatalkannya. Jika crash setelah cancel intent tetapi sebelum claim, operation sweep hanya memilih `dispatched_unknown`, bukan intent.

**Skenario:** order dinyatakan expired, process berhenti sebelum cancel. Sweep berikutnya melewati failed order; webhook expire ulang kalah claim lalu juga tidak menjalankan cancel. Stok remote dan kapasitas promo dapat tetap tertahan.

**Arah perbaikan:** commit kewajiban cancel bersama transisi gagal ketika eligible; existing recovery perlu menemukan never-sent intent dan missing obligation yang bisa dibuktikan aman. Tetap larang cancel post-invoice.

**Regression:** crash setelah failure commit dan setelah cancel intent; recovery harus menyelesaikan satu cancel yang sah tanpa melepaskan hold sebelum confirmation.

### TX-06 — P1: recovery checkout attempt tidak mencakup beberapa state yang sudah mempunyai bukti pasti

**Lokasi:** [recovery:32–78](../../../apps/store/src/features/checkout/recover-checkout-service.ts#L32), [early terminal replay:76–85](../../../apps/store/src/features/checkout/place-order-service.ts#L76), [expiry guard:419–438](../../../apps/store/src/features/checkout/checkout-attempt-repository.ts#L419), [active-attempt gate:192–194](../../../apps/store/src/features/checkout/checkout-attempt-repository.ts#L192).

Recovery menangani ready-payment promotion, confirmed-cancel accounting, dan create intent yang belum dikirim, tetapi tidak menangani semua checkpoint deterministik lainnya:

| Keadaan setelah crash | Yang dilakukan recovery saat ini | Akibat |
|---|---|---|
| Create `rejected`, attempt masih preparing/held | Sebelum expiry dapat ditandai manual_review; sesudah expiry dicoba lewat finalizer yang mensyaratkan create intent, lalu gagal | Definitive rejection tidak dilepas otomatis; replay berhenti pada manual_review sebelum memeriksa rejected create |
| Create `confirmed`, hold belum accounted | Tidak memanggil confirmed-attempt create accounting; jalur generic dapat menandai manual_review | Bukti sukses lokal yang dapat dilanjutkan menjadi dead end |
| Create confirmed + mirrored, payment belum dispatched | Setelah cutoff generic manual_review; saat sudah expired tidak ada safe cancel path untuk kasus ini | SO tetap aktif; customer tidak bisa membayar atau memulai checkout baru |

Order-level confirmed-hold sweep secara eksplisit mengecualikan operasi tanpa `orderId`, sehingga tidak menutup gap pre-order ini.

**Arah perbaikan:** keputusan recovery berdasarkan kombinasi attempt/payment/hold/ledger, bukan fallback manual_review untuk semua state. Selesaikan local accounting/rejection dari bukti pasti; pisahkan never-sent payment yang masih bisa dilanjutkan dari attempt expired yang memerlukan safe compensation. Unknown tetap ditahan, tidak di-POST ulang.

**Regression:** fault injection masing-masing checkpoint di tabel, termasuk setelah TTL; assert user tidak terkunci selamanya oleh active-attempt gate jika outcome sudah pasti.

### TX-07 — P2: bukti DELIVERED setelah penutupan manual tidak menghasilkan email yang dijanjikan

**Lokasi:** [late webhook:714–729](../../../packages/db/src/shipment-tracking.ts#L714), [late GET:568–577](../../../packages/db/src/shipment-tracking.ts#L568), [state delivered:267](../../../packages/db/src/order-communications/order-communication-repository.ts#L267), [email policy:44–45](../../../packages/db/src/order-communications/order-communication-policy.ts#L44).

Jalur completed mencatat `delivery_delivered`, tetapi tidak mengisi `deliveryShipments.deliveredAt`. Policy email hanya menganggap delivered jika kolom itu terisi, bukan dari late verified fact. Materializer tetap menulis checkpoint walaupun email tidak applicable.

**Skenario:** admin menyelesaikan manual karena evidence tertunda; kurir kemudian mengirim DELIVERED valid. Event tercatat, tetapi email “Pesanan sudah sampai” tidak dibuat. Ini bertentangan dengan kontrak late delivery di [komunikasi order](../../../docs/features/order-communications.md).

**Arah perbaikan:** representasikan verified late arrival sebagai evidence yang dibaca policy, tanpa membuka kembali order atau menghapus alasan selesai manual.

**Regression:** manual finish → DELIVERED valid lewat webhook dan GET → satu email delivered; status order tetap completed.

### TX-08 — P2: GET tracking bisa menghabiskan fakta in-transit terlalu dini

**Lokasi:** [reconcile:510–536](../../../packages/db/src/shipment-tracking.ts#L510), [webhook lebih ketat:794–810](../../../packages/db/src/shipment-tracking.ts#L794), [checkpoint email:375–394](../../../packages/db/src/order-communications/order-communication-repository.ts#L375).

Setiap status GET yang maju, selain DELIVERED, dicatat sebagai `delivery_in_transit`, termasuk WAITING, CONFIRMED_BY_COURIER, dan ON_THE_WAY_PICK_UP. Webhook hanya membuat fakta in-transit pada PICKED_UP/ON_DELIVERY.

**Skenario:** admin refresh ketika kurir masih WAITING dan belum ada handoff. Worker membaca fakta in-transit, tetapi state belum inTransit, sehingga tidak membuat email dan menulis checkpoint. Saat PICKED_UP benar-benar datang, uniqueness `(orderId, kind)` membuat event lama tidak dibuat ulang; email mulai diantar dapat hilang permanen.

**Arah perbaikan:** satu policy status→fakta untuk GET dan webhook. Booking/penjemputan belum sama dengan barang dibawa.

**Regression:** GET WAITING → worker → PICKED_UP → worker harus menghasilkan tepat satu email in-transit pada tahap kedua.

### TX-09 — P2, keamanan: batas percobaan kode pickup tidak aman terhadap request paralel

**Lokasi:** [verify-pickup:137–163](../../../apps/admin/src/app/api/admin/orders/[id]/verify-pickup/route.ts#L137).

Counter dan lock dibaca tanpa row lock, dihitung di memory, lalu ditulis sebagai nilai absolut. Request paralel dapat membaca counter sama dan saling menimpa increment; stale update juga dapat menimpa lock yang baru dibuat.

**Skenario:** counter 0, 20 request kode salah membaca row sebelum satu pun update. Semuanya dapat menulis counter 1, bukan 20. Guard lima percobaan tidak berlaku sesuai kontraknya.

**Prasyarat:** session admin dengan orders:edit dan Home Branch yang sesuai. Ini bukan brute force publik tanpa login.

**Arah perbaikan:** verification gate dan pembaruan attempt atomik di repository; gunakan lock/conditional update. Jangan menahan transaksi selama internal HTTP.

**Regression:** parallel bad-code requests; assert lock aktif dan tidak bisa dibuka oleh stale writer.

### TX-10 — P2, keamanan: kode pickup dicetak ke application log

**Lokasi:** [order-finalize:446–448](../../../apps/store/src/lib/order-finalize.ts#L446).

Log sukses memasukkan kode pickup lengkap. Kode itu adalah bukti pengambilan barang, bukan identifier observability biasa. Admin detail justru tidak mengembalikan kode ini.

**Skenario:** pembaca centralized logs memperoleh order ID dan kode, lalu kode bisa digunakan melalui staff/admin yang berwenang untuk mencatat pengambilan. Akses log memperluas trust boundary bukti pickup.

**Arah perbaikan:** log order ID + hasil transisi saja; jangan kode atau hash kode berentropi pendek.

**Regression:** capture output finalization; assert tidak ada pickup credential pada message/error/context.

### TX-11 — P2, otorisasi: tracking tidak mengecek ulang Home Branch actor dari DB

**Lokasi:** [tracking actor check:253–259](../../../packages/db/src/shipment-tracking.ts#L253), pembanding [packing actor check:189–204](../../../apps/admin/src/lib/shipment-fulfillment.ts#L189) dan [follow-up:330–341](../../../apps/admin/src/lib/delivery-follow-up.ts#L330).

Tracking mengecek user exists/active, tetapi tidak membaca `users.branchId` atau share-lock actor. Ia mempercayai `actor.homeBranchId` hasil guard yang sudah dibaca sebelumnya. Pada reconcile terdapat provider GET di antara dua transaksi, memperbesar race window.

**Skenario:** admin awalnya cabang A, guard lolos; selama GET admin dipindahkan ke B. Recheck tracking tetap menerima actor A dan menerapkan mutation/audit terhadap order A. Packing/follow-up sudah mempunyai pengecekan fresh branch yang tidak dimiliki tracking.

**Arah perbaikan:** current actor/Home Branch check yang sama di dekat data pada setiap transaksi mutation, termasuk setelah GET. Re-evaluation grant/policy perlu konsisten dengan batas transaksi yang disepakati.

**Regression:** ubah cabang actor selama GET yang ditahan barrier; final mutation harus ditolak.

### TX-12 — P2, gap guard: tracking menerima linkage settlement yang ditolak packing/follow-up

**Lokasi:** [tracking ledger check:313–335](../../../packages/db/src/shipment-tracking.ts#L313), pembanding [deliverySettlementBlocker](../../../apps/admin/src/lib/delivery-settlement.ts#L14).

Tracking hanya membandingkan invoice ID dan payment ID. Tidak memeriksa cancel aktif, SO ID pada kedua operation, atau invoice ID pada payment operation. Packing/follow-up mempunyai guard lebih lengkap.

**Skenario:** order paid/processing/unblocked memiliki invoice/payment ID cocok, tetapi payment association invoice berbeda atau cancel operation aktif. Tracking dapat menerima handoff/reconcile meskipun packing menolak state yang sama.

**Batas klaim:** memerlukan persisted inconsistency atau race upstream; tidak ditemukan endpoint customer yang dapat langsung mengedit ledger tersebut. Ini gap enforcement kontrak, bukan bukti customer mampu memalsukan pembayaran.

**Arah perbaikan:** satu pure settlement-evidence policy yang dipakai seluruh action; repository mengumpulkan data dan menegakkan policy di bawah lock.

**Regression:** tiap mismatch ID dan active cancel harus menolak semua physical mutations secara konsisten.

### TX-13 — P2: limit diterapkan sebelum branch scope pada antrean review

**Lokasi:** [sales review queries:88–128](../../../apps/admin/src/app/api/admin/reviews/sales-operations/route.ts#L88), [filter JS:130–139](../../../apps/admin/src/app/api/admin/reviews/sales-operations/route.ts#L130).

Dua query mengambil 100 row global, baru memfilter Home Branch di JavaScript. Tidak ada pagination untuk mengakses row yang terpotong.

**Skenario:** 100 review terbaru dari cabang B dan satu unresolved order cabang A. Admin A menerima daftar kosong walaupun mempunyai kasus aktif. Hasil response tetap scoped, jadi ini terutama visibility/availability bug, bukan klaim cross-branch data leak.

**Arah perbaikan:** branch predicate di SQL sebelum sort/limit, ditambah pagination/cursor dan count ter-scope.

**Regression:** seed lebih dari 100 kasus cabang lain; kasus Home Branch tetap muncul dan dapat dipaginasi.

### TX-14 — P2: delivery sehat ditampilkan sebagai paid-but-blocked

**Lokasi:** [blockedRows predicate:116–123](../../../apps/admin/src/app/api/admin/reviews/sales-operations/route.ts#L116).

Predicate memasukkan seluruh `processing + paid`, tanpa memastikan invoice/payment belum verified. Delivery sehat memang tetap memakai pasangan status itu.

**Skenario:** delivery sudah settled dan sedang diantar, tanpa blocked reason, tetapi masuk antrean financial review. Row sehat juga memakan jatah 100 sehingga kasus nyata dapat tersisih.

**Arah perbaikan:** bedakan financial settlement pending, blocked, dan fulfillment processing berdasarkan ledger/projection yang sama dengan action guards.

**Regression:** healthy delivery tidak masuk blockedOrders; paid order yang benar-benar belum verified tetap masuk.

### TX-15 — P2, scalability: pagination daftar delivery memuat seluruh matching history

**Lokasi:** [listDeliveryWork:29–49](../../../apps/admin/src/lib/delivery-work-list.ts#L29).

Query mengambil seluruh row lengkap order, snapshot, shipment, lalu seluruh operation. Stage, queue, tanggal, dan pagination diterapkan di memory. Pencarian operation per row juga menggunakan `ops.filter`, sehingga kerja tumbuh terhadap jumlah order × operation.

**Skenario:** puluhan ribu delivery historis; membuka halaman pertama “perlu diproses hari ini” tetap membaca history besar dan snapshot JSONB sebelum mengembalikan 20 row. Risiko timeout/memory pressure, meskipun UI tampak dipaginasi.

**Batas klaim:** belum ada benchmark pada volume production; growth pattern dibuktikan dari query dan loop, bukan pengukuran kapasitas server.

**Arah perbaikan:** SQL projection untuk stage/queue atau read model terukur, filter tanggal sebelum materialisasi, count dan LIMIT/OFFSET/keyset di DB; setidaknya kelompokkan operation dengan Map, bukan filter berulang.

**Regression:** dataset besar dan query budget; response tetap benar tanpa mengambil seluruh history/snapshot.

### TX-16 — P2: attempt baru tidak merevalidasi parcel dimensions saat reservation commit

**Lokasi:** [attempt variant recheck:237–250](../../../apps/store/src/features/checkout/checkout-attempt-repository.ts#L237), pembanding [legacy fresh variant check:183–191](../../../apps/store/src/features/checkout/place-order-legacy-service.ts#L183).

Jalur legacy mempunyai perbandingan `parcelDimensions` setelah quote; jalur attempt hanya memeriksa quantity, harga, mapping item, cart stamp, dan Markdown. Quote/parcel snapshot dapat menjadi stale jika master dimensions berubah selama provider request.

**Skenario:** quote dibuat dari berat 500 g; sync mengubah berat menjadi 5 kg sebelum reservation memperoleh lock. Attempt tetap menerima snapshot 500 g dan booking kemudian membaca snapshot itu. Ongkir, eligibility layanan, dan selisih billed cost berisiko salah.

**Arah perbaikan:** bawa evidence/revision source parcel yang dipakai quote dan cek ulang di bawah variant lock. Jangan mengganti snapshot sesudah order diterima customer; mismatch sebelum commit meminta review/quote baru.

**Regression:** update dimensions antara quote dan reservation; harus review/reprice required sebelum hold/provider create.

### TX-17 — P2: daftar order customer melewati decoder uang berversi

**Lokasi:** [GET orders:36–88](../../../apps/store/src/app/api/orders/route.ts#L36), pembanding [detail memakai decoder:64](../../../apps/store/src/app/api/orders/[id]/route.ts#L64) dan [repayment:77–79](../../../apps/store/src/app/api/payments/midtrans/create/route.ts#L77).

List menyebarkan row order/item langsung, tidak menjalankan `readOrderPricing()`. Detail, repayment, dan admin detail sudah memakai decoder strict.

**Skenario:** snapshot dengan versi tak dikenal atau kolom relational drift. Detail dan pembayaran fail closed, tetapi history list masih menampilkan nominal relational seolah valid. Kontrak satu sumber uang tidak konsisten antar-surface.

**Batas klaim:** tidak menunjukkan manipulasi harga oleh customer; ini integrity/compatibility bug pada reader ketika record berubah/corrupt/incompatible.

**Arah perbaikan:** reader/query DTO versi yang sama pada list dan detail, dengan policy error yang eksplisit. Hindari full-row spread agar kolom internal baru tidak otomatis menjadi public API.

**Regression:** unknown pricing version dan relational/snapshot mismatch pada list, detail, repayment; tidak boleh silent display/fallback.

## Standards dan saran refactoring

Bagian ini dipisahkan dari bug di atas: ukuran file dan code smell bukan otomatis celah keamanan.

1. **Satu definisi eligibility finansial.** `shipment-fulfillment`, `delivery-follow-up`, `shipment-tracking`, review queue, dan communication reader mempunyai interpretasi ledger berbeda. TX-04/TX-12/TX-14 menunjukkan konsekuensi konkretnya. Extract pure evidence policy, bukan generic God Service; gunakan dengan repository scope/lock masing-masing.
2. **Recovery sebagai state machine eksplisit.** Buat matriks attempt/order/payment/SO-operation → allowed next operation. Bedakan local repair, never-sent dispatch, GET reconciliation, definitive release, dan manual review. Jangan memakai default catch/manual-review untuk state yang sudah mempunyai bukti pasti. Tidak perlu outbox subsystem kedua; perkuat ledger existing.
3. **Local confirmation + projection di repository atomik.** Service tetap mengatur urutan; repository memiliki conditional transition dan consistency check. Ini langsung mengatasi TX-03/TX-05, bukan sekadar memindah file.
4. **Service per operasi dan route adapter tipis.** Webhook Midtrans, repayment, verify-pickup, dan beberapa admin order readers masih membawa query/orkestrasi langsung. Pisahkan operasi seperti proses notification, expire pending payment, verify pickup, dan read order detail; jangan membuat satu `OrderService` yang menampung semuanya.
5. **Pisahkan lifecycle yang terlalu padat berdasarkan operasi.** Saat review, `jubelio-sales-lifecycle.ts` 1.632 baris dan channel mirror 3.127 baris. Angka ini sinyal cohesion, bukan target pengurangan baris. Pisahkan create/cancel/invoice/payment/reconciliation dengan contract internal yang sempit, setelah regression invariant tersedia.
6. **Pure event policy untuk GET dan webhook.** Normalisasi status dan temporal evidence di satu tempat; persist perubahan shipment + fakta komunikasi dalam transaksi sama. Ini mencegah TX-07/TX-08 terulang.
7. **DTO allowlist dan reader versi yang konsisten.** Jangan `...order` dari tabel menjadi API publik. Pisahkan customer view, operator view, dan provider evidence; gunakan snapshot decoder untuk semua financial display.
8. **Logging tetap aman tetapi berguna.** Hilangkan pickup code dan `console.warn` raw error pada expiry. Banyak boundary membuat error statis baru yang menghilangkan klasifikasi sebab; pertahankan safe error code dan fase operasi tanpa mencetak payload, URL sensitif, atau credential. Hindari duplikasi boilerplate error class tanpa menghilangkan contextual ownership.
9. **Bounded background work.** Time budget, timeout provider eksplisit, fairness/cursor, dan per-item isolation. GET status Midtrans saat ini tidak memberi `AbortSignal` timeout eksplisit; sequential sweep dapat tertahan lama oleh satu upstream request. Ini risiko tambahan, belum diuji dengan slow provider.
10. **TDD di public seam untuk perubahan berikutnya.** Prioritaskan fault injection pada service/repository transaction seams dan browser user path, bukan assertion struktur file saja. Existing characterization test melindungi parity, bukan menjamin business invariant benar.

Ini rekomendasi review, **bukan plan/spec yang disetujui** dan bukan izin implementasi/refactor.

## Risiko/batas desain yang tidak dihitung sebagai bug tambahan

- **Booking crash setelah dispatch:** state booking_dispatched memang sengaja held. Tidak ada jalur aplikasi untuk mengadopsi AWB yang diketahui operator atau menutup request crashed tersebut; release hanya untuk booking_unknown. Perlukan keputusan recovery operasional, jangan otomatis memindahkan ke packed/re-POST.
- **Unknown attempt/cancel:** manual_review pre-order tidak mempunyai resolve action; confirmed cancel accounting mensyaratkan compensating, sedangkan sebagian error mengubah attempt menjadi manual_review. Kebijakan create/cancel manual recovery memang dibatasi dokumen. Butuh desain operator/reconciliation tersendiri, bukan menganggap timeout sebagai bukti no-booking/no-SO.
- **Refund/reversal setelah paid:** webhook Midtrans early-return pada paymentStatus paid; refund/partial_refund tidak mendapat jalur khusus. Tidak mengklaim automatic refund wajib. Tentukan apakah provider reversal setidaknya perlu durable financial-review event dan fulfillment hold sebelum barang diserahkan. [Midtrans GET status](https://docs.midtrans.com/reference/get-transaction-status) mendokumentasikan refund details.
- **Internal complete authorization:** HMAC order ID statis tidak memuat actor/expiry/nonce. Secret tetap harus aman; ini bukan bukti HMAC bisa dipalsukan. Pisahkan key internal dari auth secret dan pertimbangkan actor-bound short-lived command jika boundary diperketat. Final write juga sebaiknya mengecek paid/method/block, bukan status saja.
- **Batas body webhook:** Midtrans/Jubelio master membaca seluruh body sebelum validasi ukuran; Shipment mengecek ukuran sesudah `request.text()`. Streaming byte limit/proxy limit dan rate limiting perlu diaudit dengan konfigurasi deployment nyata; tidak dilakukan load test.

## Hal yang sudah baik pada kode yang dibaca

- Webhook Midtrans memverifikasi signature, mengambil authoritative GET status, mengecek amount/order identity, dan tidak menggunakan payload callback sebagai fallback saat provider gagal.
- Claim pembayaran dan operasi provider menggunakan conditional write untuk menghindari efek ganda. Tidak ditemukan alasan untuk menghapus mekanisme tersebut.
- SO/invoice/payment mempertahankan remote ID dan evidence; ambiguity tidak diatasi dengan blind POST ulang pada jalur baru.
- Booking Shipment mempunyai durable dispatch claim sebelum HTTP, unique AWB/shipment identity, serta biaya quote/booked/billed terpisah.
- Physical action umumnya mengharuskan orders:edit + Home Branch; all-branch visibility bukan bypass physical ownership. Kekurangan tracking dijelaskan khusus TX-11/TX-12.
- Delivery tidak mendapatkan kode pickup dan AWB tidak otomatis dianggap barang diterima.
- Komunikasi baru mempunyai durable event/job, bounded retry, claim token, dan supersession policy; TX-07/TX-08 ada pada integrasi evidence, bukan alasan mengganti seluruh sistem.

## Verifikasi yang benar-benar dijalankan

### Run A — 9 file, 116 test lulus

```bash
npm run verify:unit:slice -- \
  apps/store/src/lib/midtrans.test.ts \
  apps/store/src/lib/order-finalize.test.ts \
  apps/store/src/lib/jubelio-sales-operations.test.ts \
  apps/store/src/lib/jubelio-sales-settlement.test.ts \
  apps/store/src/features/checkout/checkout-attempt.test.ts \
  apps/store/src/features/checkout/place-checkout-service.test.ts \
  apps/store/src/app/api/cron/sweep-reservations/route.test.ts \
  'apps/admin/src/app/api/admin/orders/[id]/verify-pickup/route.test.ts' \
  apps/admin/src/lib/pickup-code.test.ts
```

Hasil: exit 0; 9 files passed, 116 tests passed; durasi runner 6,98 s. Log disposable: `/tmp/transaction-audit-focused-tests.log` pada shell sesi ini. Error logs di beberapa kasus adalah output negative-path test; runner tetap lulus. Test sweep yang ada belum membuktikan state recovery baru; beberapa dependency recovery juga belum dimock lengkap dan ditangkap boundary test.

### Run B — 3 file, 36 test lulus

```bash
npm run verify:unit:slice -- \
  packages/db/src/order-communications/order-communication-policy.test.ts \
  apps/admin/src/lib/delivery-workflow.test.ts \
  apps/store/src/lib/payment-initialization.test.ts
```

Hasil: exit 0; 3 files passed, 36 tests passed; durasi 425 ms. Log disposable: `/tmp/transaction-audit-policy-tests.log`. Tidak ada DB integration file dalam kedua daftar.

### Cakupan permintaan → evidence

| Kriteria review | Status | Evidence |
|---|---|---|
| Menelusuri checkout, pembayaran/webhook, dan penyelesaian pesanan admin | Verified | Peta call chain, schema/kontrak, TX-01–TX-17 dan source links |
| Mengidentifikasi risiko bug/keamanan secara terstruktur | Verified | Root cause, prasyarat, skenario, dan rekomendasi per temuan; batas eksploit dijelaskan |
| Memberi saran refactoring yang terkait masalah nyata | Verified | Bagian Standards; tidak ada perubahan app/backend |
| Memeriksa regression baseline terfokus | Verified | Dua command di atas: 12 file / 152 passed |
| Membuktikan seluruh skenario baru lewat fault injection/concurrency PostgreSQL dan browser | Pending | Tidak menulis/menjalankan test baru, tidak menyentuh DB pengguna atau provider |
| Membuktikan keamanan deployment/production dan kapasitas pada load nyata | Pending | Tidak ada audit remote/proxy runtime, penetration test, atau benchmark |

## Rekomendasi langkah berikutnya

Prioritaskan TX-01/TX-02 (false cancellation), TX-03/TX-05 (durable local transitions), dan TX-04/TX-06 (recovery tetap maju). Setelah itu TX-07–TX-14 untuk komunikasi dan operasional/guard. TX-15–TX-17 dapat diurutkan berdasarkan volume dan rollout kontrak baru.

Sebelum implementasi: sepakati paket perbaikan, test seams, policy untuk outcome unknown/reversal, dan complete plan. Jangan memulai refactor besar bersamaan dengan perubahan state machine tanpa tracer-bullet regression dan approval terpisah.
