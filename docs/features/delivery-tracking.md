# Delivery handoff and tracking

## Physical handoff

`POST /api/admin/orders/{id}/delivery/handoff` records physical handoff once, with actor/time and `SHIPMENT_HANDOFF` audit. It requires `orders:edit`, the current active admin's exact Home Branch, verified-paid/unblocked delivery and a known booked AWB. Global/owner visibility is not permission to act at another branch. Repeated handoff is idempotent while eligible. Completed orders cannot receive a new handoff. AWB and PICKED_UP do not complete an order.

## Read-only reconciliation

`POST /api/admin/orders/{id}/delivery/reconcile` takes `{}` and GETs only the stored known AWB. No network call holds a DB transaction; authorization/identity are rechecked under lock afterward. Returned AWB, Shipment ID and supplied order reference must match before changes. A missing billed cost after booking also gets one reactive known-AWB lookup; lookup failure leaves the booking successful and billed cost unknown, never repeats create. One attempt is within the spec's maximum three GET attempts; 4xx is never retried.

Reconciliation records applicable observations in the same timeline as callbacks. Approved rates and booking price stay frozen; actual billed price can be updated without charging the customer. After completion, safe links/billing are informational only—no late status or issue reopens the order. There is no tracking cron or browser polling.

## Dedicated signed callback

`POST /api/webhooks/jubelio-shipment` requires server-only `JUBELIO_SHIPMENT_WEBHOOK_SECRET`, distinct from API and Omnichannel credentials. Missing configuration returns 503. Header `x-jubelio-signature` is hex HMAC-SHA256: key = secret, message = exact UTF-8 raw body + secret. Verification is constant-time before JSON parsing/mutation; body size is capped before crypto. See [Shipment v1.8](../jubelio-api/shipment-v1.8.md), webhook example pp. 20–21.

Known unique AWB/Shipment ID/order reference is matched; callbacks never adopt an unknown AWB or create shipments. Extra fields are tolerated. `latest_status` is normalized status, not the carrier's `tracking.status` (e.g. D09/CNCL). Unknown/mismatched, duplicate, older and post-completion events cannot change lifecycle. Raw fingerprints dedupe receipts; ignored known-shipment receipts remain diagnostic, not customer timeline events. Order locking and fresh ledger reads prevent concurrent progress regression.

Normal progress is monotonic. ON_HOLD, RETURNED, CANCELED and SHIPMENT_ISSUE remain visible pre-completion; known older provider dates are rejected. GET or later timestamped evidence can resolve an exception. Dates without an explicit timezone are not invented as carrier timestamps. Received time remains available. Verified DELIVERED completes paid delivery even without POD or a manual handoff stamp. Late PICKED_UP/SHIPMENT_ISSUE never reopen completed orders.

Example: signed PICKED_UP keeps paid/processing; signed matching DELIVERED completes with no pickup code. An identical replay adds no receipt/effect. A later issue receipt is ignored after completion rather than creating a new case.

## Visibility and safe links

Customer `/api/orders/{id}` remains client-owned; other customers get 404. Tracking DTO exposes only AWB/link/status, applied timeline and safe POD—not booking costs, admin actors or stored provider requests. Links appear only when available, permit HTTP(S) without userinfo, and are anchors (no remote image fetch). Later safe POD can enrich completed delivery without changing status. Admin diagnostics require orders:view/Branch Scope. Logs never include raw callback bodies, signatures, tokens, addresses or signed POD URLs.

## Tampilan tracking di halaman detail pesanan customer

Halaman `/account/orders/{id}` menampilkan status order lebih dahulu, lalu (untuk delivery) panel `Lacak paket` dan `Alamat pengiriman` berdampingan di desktop; di bawah breakpoint `lg` panel tracking tampil sebelum alamat. Stepper generik sudah dihapus: bukti progres paket adalah timeline event, bukan langkah milestone yang tidak didukung data. Status order, status pembayaran, dan status paket tetap tiga hal berbeda; status paket memakai `delivered`/`latestStatus`, bukan `order.status`.

Aturan presentasi di `apps/store/src/lib/order-tracking-presentation.ts`:

- Timeline adalah salinan terbalik dari urutan API, sehingga event terbaru tampil dahulu. Urutannya tidak direkonstruksi dari timestamp provider (bisa kosong/tidak berurutan), dan waktu tiap event tetap waktu event dari DTO; waktu kosong/tidak valid menjadi `Waktu tidak tersedia`.
- Empat event ditampilkan awal. Jika ada lebih, tombol `Lihat semua riwayat` (dengan `aria-expanded`) membuka seluruh riwayat yang sudah dimuat lalu berubah menjadi `Tampilkan lebih sedikit`. Tidak ada request polling atau pagination jaringan.
- Kode status dinormalisasi menjadi label customer (`WAITING` → `Menunggu kurir`, `ON_THE_WAY_PICK_UP`/`ON_THE_WAY_PICKUP` → `Kurir menuju lokasi pengambilan`, `ON_DELIVERY` → `Dalam pengantaran`, `DELIVERED` → `Paket telah diterima`, dan seterusnya). Status kosong/asing menjadi heading netral `Pembaruan pengiriman`; kode internal tidak pernah menjadi judul.
- Detail event dari marker simulator repo (`Simulasi webhook Jubelio:`) disembunyikan; detail kurir informatif lain tetap ditampilkan sebagai teks biasa.
- Resi, tautan kurir, dan bukti pengiriman adalah kontrol yang terlihat sebagai tombol/link sebelum hover. Tombol salin memakai live region (`ID disalin`, `Resi disalin`, `Kode disalin`, atau `Gagal menyalin. Silakan salin secara manual.`), dan tautan luar membuka tab baru dengan keterangan aksesibel.

Sumber data tetap hanya GET `/api/orders/{id}` yang owner-scoped: tidak ada endpoint, provider call, mutasi status, atau nilai (ETA, lokasi, bukti) yang dikarang di UI.

## Verification

`shipment-tracking.test.ts` uses an independent OpenSSL-computed HMAC fixture and PostgreSQL for handoff, known-AWB identity, progress, pre-completion issues, replay/ignored history, concurrent callbacks, safe links and terminal protection. `shipment-tracking-mock.spec.ts` covers admin/customer HTTP/UI, foreign actors, owner privacy, signature rejection, completion, replay and late safe/unsafe POD. `order-tracking-presentation.test.ts` menguji label status, penyembunyian detail simulator, dan pembalikan timeline tanpa menyentuh UI; `order-detail-presentation-mock.spec.ts` menguji halaman detail customer (status, urutan mobile/desktop, disclosure, salin, tautan, pembayaran, pickup, error/retry, snapshot/resi kosong) lewat route interception deterministik tanpa mutasi DB atau provider. Migration 0031 adds global external identity uniqueness, timestamps and receipt history; seed cleanup clears events before shipments. Real tenant callback registration/testing is an optional owner-operated activation step, not claimed by these mock checks.
