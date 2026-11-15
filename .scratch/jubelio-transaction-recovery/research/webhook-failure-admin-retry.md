# Research: kegagalan webhook dan recovery Jubelio oleh admin

## Batas dan metode

- Snapshot: `df987af`, diperiksa pada 2026-10-25. Temuan adalah pembacaan source, bukan reproduksi runtime/production.
- Permintaan: menelusuri kegagalan request Jubelio saat webhook dan opsi recovery admin agar transaksi tidak menggantung.
- Tidak ada perubahan aplikasi, test execution, provider request (termasuk login), remote access, atau deployment. Context7 tidak diperlukan karena hanya dokumentasi/research, tanpa implementasi external API.
- Referensi primer: source aplikasi dan export kontrak vendor yang tersimpan di repo. Kebijakan provider terkini belum dikonfirmasi secara live.
- Research lama [recovery transaksi admin](../../../plan/research/jubelio-transaction-recovery-admin.md) dan [decision map](../map.md) adalah konteks historis, bukan bukti implementasi atau approval baru. Dokumen ini tidak menyelesaikan decision tickets maupun menetapkan implementasi.

## Kesimpulan

**Bukan tidak ada error handling; yang belum lengkap adalah jalur recovery operasional oleh admin.** Sistem sudah menyimpan intent, mencegah POST ganda, mempertahankan pembayaran pelanggan, memblokir fulfillment yang belum terverifikasi, dan memiliki sweep recovery. Namun kasus tertentu berhenti di `manual_review`, dan halaman review belum menyediakan recovery sales write. [S1–S6]

**Rekomendasi:** recovery berdasarkan tahap dan bukti, bukan tombol untuk mengulang seluruh webhook. Bedakan: (1) periksa transaksi yang mungkin sudah ada; (2) lanjutkan tahap berikutnya yang belum pernah dikirim; (3) kirim ulang tahap yang terbukti tidak diterapkan; (4) eskalasi jika hasil tidak dapat dipastikan.

## 1. Webhook mana yang relevan?

| Entry point | Perilaku terverifikasi dari source | Relevansi |
|---|---|---|
| `/api/webhooks/midtrans` | Verifikasi signature/payload dan status Midtrans, claim paid, jalankan invoice → payment Jubelio | Jalur utama kegagalan transaksi order setelah customer membayar. [S1] |
| `/api/webhooks/jubelio` | Refetch produk/harga/stok lalu upsert; gagal sinkronisasi menghasilkan HTTP 500 | Bukan jalur pembuatan invoice/payment. Export vendor menyatakan delivery webhook dicoba hingga 3 kali bila respons bukan HTTP 200. Jangan menerapkan angka ini ke Midtrans/Shipment. [S7, S8] |
| `/api/webhooks/jubelio-shipment` | Verifikasi dan ingest callback tracking; tidak memanggil provider GET | Jalur berbeda. Admin sudah memiliki reconcile tracking, bukan retry sales payment. [S9, S10] |

Webhook perlu dipisahkan dari pekerjaan bisnis yang dipicunya: callback diterima sukses belum berarti invoice/payment Jubelio selesai.

## 2. Apa yang terjadi jika request Jubelio gagal setelah pembayaran?

Alur utama dari source:

```text
Midtrans callback → verifikasi pembayaran authoritative
  → claim order: paid + processing
  → ensure invoice Jubelio → verify
  → ensure payment Jubelio → verify
  → buka fulfillment hanya setelah keduanya confirmed
```

- Jika invoice gagal/ambigu: invoice operation diarahkan ke `manual_review`, fulfillment diblokir, payment berikutnya tidak dikirim. Jika payment gagal/ambigu, order juga tetap paid tetapi diblokir. [S2, S3]
- Failure yang ditangani sebagai outcome bisnis `manual_review` tetap menghasilkan HTTP 200 dari webhook. Exception tak tertangani menghasilkan HTTP 500. [S1]
- **Replay webhook bukan recovery yang cukup:** order dengan `paymentStatus === "paid"` langsung direspons `Order already processed`, sebelum pipeline settlement dipanggil lagi. Bahkan jika respons sebelumnya 500 setelah paid claim, replay berikutnya dapat terhenti pada guard ini. Recovery harus memakai ledger/sweep, bukan mengandalkan redelivery webhook. [S1]
- Payment Jubelio adalah pencatatan pembayaran di Jubelio, berbeda dari charge customer di Midtrans. Recovery tidak boleh meminta customer membayar lagi atau mengubah paid menjadi unpaid. [S1–S3]

### Fondasi recovery yang sudah ada

1. Ledger `jubelio_sales_operation`: payload/reference, status, remote IDs, attempt count, timestamp, dan `lastError`. Claim atomic hanya dari `intent` ke `dispatched_unknown`; operasi yang sudah diklaim tidak dikembalikan ke intent untuk POST ulang. [S4, S5]
2. **ID invoice/payment sudah disimpan sebelum confirmation GET** melalui `onInvoiceId`/`onPaymentId`; error yang membawa ID juga dicoba dipersist. Ini memperbaiki peluang recovery saat POST berhasil tetapi GET gagal. Klaim historis bahwa ID selalu baru tersimpan setelah verifikasi tidak lagi tepat untuk source saat ini. DB failure tetap dapat membuat handle tidak tersimpan. [S3:950–1042, 1422–1495]
3. Sweep memulihkan accounting lokal, reconcile operasi in-flight melalui GET, dan melanjutkan settlement paid yang belum selesai. Unknown dispatch lama tanpa ID diarahkan ke manual review. Endpoint ini harus benar-benar dijadwalkan agar recovery berjalan; keberadaan source/wrapper bukan bukti cron production aktif. [S2, S6]
4. Recovery `manual_review` via GET sudah tersedia untuk invoice/payment ber-ID, tetapi forwarding settlement recovery dibatasi pada **paid-blocked delivery**, bukan recovery admin umum untuk pickup dan delivery. [S2:202–214, S3:791–843, 1248–1292]
5. Halaman **Review Jubelio** menampilkan operasi/manual-review dan blocked orders; tombol refresh hanya memuat daftar ulang. Endpoint review adalah read-only. [S11, S12]

## 3. Gap yang membuat kasus tetap menggantung

| Gap terverifikasi | Konsekuensi |
|---|---|
| Invoice/payment rejection maupun ambiguity sama-sama berakhir di manual review. Gateway memiliki `ambiguous`, `retryable`, dan code, tetapi ledger belum menyimpan klasifikasi recovery tersebut sebagai field terstruktur. | UI tidak dapat menentukan keamanan retry hanya dari status atau teks error. [S3–S5, S13] |
| `manual_review` pickup tidak memperoleh forwarding recovery seperti blocked delivery. | GET recovery belum menjadi fasilitas umum untuk semua paid order. [S2, S3] |
| `readOnlyRecovery` tidak membuat payment intent baru jika belum ada. | Invoice yang akhirnya berhasil diverifikasi belum tentu membuat order maju: payment pertama yang belum pernah dikirim perlu continuation terpisah. [S3:1349–1358] |
| Ledger hanya satu operasi per owner/type dan tidak memiliki lifecycle retry setelah claim. | Tombol retry tidak cukup; dibutuhkan model attempt/history dan transisi yang aman. `attemptCount` yang ada bukan bukti dukungan retry lengkap. [S4, S5] |
| Review memilih `processing + paid` selain block eksplisit, sedangkan delivery sukses tetap processing + paid. | Daftar berpotensi memuat delivery normal; predicate perlu diperjelas agar admin tidak melihat false alarm. Temuan statis, belum direproduksi. [S2, S11] |
| Sweep settlement memakai limit tanpa filter eksplisit verified-payment/next-retry dan tanpa ordering pada query tersebut. | Risiko batch berulang memproses delivery normal dan menunda kasus lain perlu diuji; belum merupakan bukti starvation runtime. [S2:reconcileSettlements] |

**Scope tambahan penting:** checkout terbaru memakai `checkout_attempt` sebelum membuat order. Kegagalan SO create bisa menjadi kasus attempt tanpa order; daftar Orders saja tidak mencakupnya. Review API sekarang juga memuat checkout attempts. Jangan otomatis membuat/menghidupkan order untuk menutup kasus ini. [S11, S14, S15]

## 4. Klasifikasi tindakan yang aman — proposal

| Bukti kegagalan | Tindakan yang diusulkan | Contoh nyata |
|---|---|---|
| Business POST terbukti belum dikirim | **Coba kirim lagi**, setelah cek eligibility dan konfigurasi | Login Jubelio timeout sebelum invoice POST; setelah koneksi pulih, attempt baru boleh mengirim invoice sekali. |
| Remote ID ada tetapi confirmation gagal | **Periksa status Jubelio** melalui GET, lalu verifikasi identitas/linkage/items/amount | Payment ID 456 sudah tersimpan; GET timeout. GET ulang dan confirm payment 456, bukan POST payment baru. |
| Tahap sebelumnya confirmed; tahap berikut belum pernah dikirim | **Lanjutkan proses** dengan first dispatch yang diaudit | Invoice berhasil dipulihkan via GET, tetapi payment intent belum ada. Buat payment pertama setelah semua prerequisite valid. |
| Business POST timeout/5xx, ID tidak diketahui | **Perlu investigasi**, bukan blind retry | Payment bisa sudah tercatat meskipun respons hilang. Perlu lookup authoritative/dukungan provider sebelum mengizinkan write lain. |
| Mapping/account/config invalid | **Perbaiki konfigurasi**, lalu evaluasi ulang eligibility dan bukti non-application | Account payment tidak dikonfigurasi; retry payload yang sama tidak menyelesaikan akar masalah. |
| Data GET bertentangan dengan snapshot order | **Lihat perbedaan / eskalasi** | Invoice ID benar tetapi item berbeda; jangan buka fulfillment atau force verified. |
| Remote success verified, update lokal belum lengkap | **Pulihkan data lokal** secara idempotent | Ledger confirmed tetapi projection order belum tersimpan; jangan membuat transaksi provider kedua. |
| Paid berkonflik dengan cancel aktif/confirmed | **Resolusi bisnis khusus** | Pembayaran terlambat setelah cancel; jangan lanjut invoice/payment tanpa prosedur konflik. |

`retryable` pada gateway bukan izin untuk otomatis re-POST. Khusus 429, source saat ini mengklasifikasikannya sebagai non-ambiguous/retryable, tetapi jaminan bahwa write tidak diterapkan harus dikonfirmasi pada kontrak provider sebelum menjadikannya aturan retry generik. HTTP status saja tidak cukup. [S13]

**Batas kepastian:** reference unik lokal/note bukan bukti bahwa provider mendukung idempotency key. Research ini belum membuktikan lookup transaksi berdasarkan reference, deduplication write, atau bahwa hasil pencarian kosong/404 adalah bukti transaksi tidak pernah diterapkan. Jika bukti tetap ambigu, sistem harus tetap menahan kasus; tidak ada jaminan semua kasus dapat selesai otomatis.

## 5. Opsi solusi

### A. Manual recovery terarah — perubahan paling terbatas

Tambahkan action kontekstual di detail kasus: GET verification, first-time continuation, dan retry khusus proven-not-applied. Gunakan aturan eligibility server, permission recovery terpisah yang dapat diberikan lewat RBAC, branch scope, atomic claim, dan audit operator/alasan/hasil.

- Kelebihan: kontrol admin jelas, mudah dimulai dari fondasi existing.
- Kekurangan: membutuhkan monitoring dan tindakan manusia; tanpa durable classification, hanya GET recovery yang aman ditawarkan untuk sebagian kasus.

### B. Hybrid otomatis + admin — rekomendasi

Gunakan reconciliation otomatis untuk transient read failure dan safe retry yang buktinya terstruktur; arahkan ambiguity/data conflict ke admin. Admin dapat meminta recovery segera melalui mesin recovery yang sama.

Tambahkan bounded exponential backoff + jitter, penghormatan Retry-After bila tersedia, max attempts, nextRetryAt, terminal escalation, dan notifikasi kasus yang melewati batas waktu. Batas jumlah percobaan/waktu adalah keputusan produk/operasional, bukan angka yang diputuskan research ini.

- Kelebihan: error sementara bisa pulih tanpa admin, tanpa mengorbankan perlindungan duplicate write.
- Kekurangan: lebih kompleks; manual action dan cron harus berbagi claim/eligibility, agar tidak saling mendahului atau menghasilkan POST ganda.

### C. Durable inbox/outbox + worker — investasi jangka panjang

Webhook terverifikasi diterima dan direkam secara durable sebelum ACK; job memproses settlement per tahap di worker. Sertakan job scheduling, failed-case/dead-letter view, dan admin requeue.

- Kelebihan: proses bisnis tidak bergantung pada durasi satu HTTP callback; crash recovery dan observability lebih jelas.
- Kekurangan: biaya operasional serta perubahan arsitektur lebih besar. Queue tidak menghilangkan ambiguity provider; semantik at-least-once bukan exactly-once remote write. Ledger existing adalah fondasi, bukan alasan wajib menambah broker sekarang.

**Tidak direkomendasikan:** tombol rehit seluruh webhook, reset status ledger ke intent secara manual, force-paid/force-ready, atau retry semua 5xx. Ini dapat menggandakan invoice/payment atau melewati verifikasi.

## 6. Insight UX dan operasional

- Satu kasus utama per order/attempt, dengan tahap gagal dan action yang layak; bukan daftar error teknis tanpa langkah berikutnya.
- Bedakan **Pembayaran pelanggan diterima** dari **Pencatatan Jubelio belum selesai**. Jangan menampilkan failed payment untuk pembayaran yang sudah authoritative paid.
- Tampilkan tahap, kategori error aman, remote IDs, last attempt, retry berikutnya, dan history. Jangan tampilkan raw provider body, token, atau PII yang tidak diperlukan.
- Bedakan **Periksa status**, **Lanjutkan proses**, dan **Coba kirim lagi**; action yang tidak aman tidak diaktifkan. Reload daftar bukan retry.
- Ukur umur kasus unresolved dan jumlah paid-blocked; retry tanpa batas/escalation hanya memindahkan masalah menjadi antrean yang tidak terlihat.

Contoh end-to-end: customer membayar Rp111.000; payment Jubelio berhasil mengembalikan ID tetapi GET verifikasi timeout. Order tetap paid, fulfillment diblokir. Admin memilih **Periksa status Jubelio**; sistem GET ID tersimpan dan memverifikasi nilai sesuai frozen settlement envelope (tidak otomatis memakai Rp111.000), linkage dan identitas. Jika cocok, lanjutkan local fulfillment sesuai pickup/delivery. Tidak ada charge Midtrans atau POST payment Jubelio kedua.

## 7. Bukti dan validasi berikutnya

Test yang sudah ditemukan, **tidak dijalankan pada research ini**:

- `apps/store/src/lib/jubelio-sales-client.test.ts`: 500 ambiguity, 429 tanpa POST ulang, auth pre-send failure, missing payment ID.
- `apps/store/src/lib/jubelio-sales-settlement.test.ts`: block pada invoice/payment unverified dan fulfillment hanya setelah kedua tahap confirmed.
- `apps/store/src/lib/jubelio-sales-recovery.db.test.ts`: known-ID delivery GET-only recovery, missing-ID hold, invoice item mismatch, accounting crash recovery.

Sebelum implementasi: putuskan permission/action scope dan klasifikasi retry; konfirmasi kontrak provider untuk duplicate prevention dan lookup unknown outcome. Acceptance perlu mencakup admin double-click bersamaan cron, crash setelah POST sebelum persistence, berhasil verify invoice tetapi payment belum pernah dikirim, pickup/delivery, config repair, serta transaksi ambigu tanpa ID. Tidak ada klaim test pass atau verifikasi production dalam dokumen ini.

## Referensi primer

Path berikut relatif terhadap root repo; rentang baris mengacu snapshot di atas.

- **S1:** `apps/store/src/app/api/webhooks/midtrans/route.ts:93–101, 175–250` — paid guard, settlement, response/error.
- **S2:** `apps/store/src/lib/jubelio-sales-settlement.ts` — settlement, delivery recovery forwarding, fulfillment gate, `reconcileSettlements`, `reconcileJubelioSalesOperations`.
- **S3:** `apps/store/src/lib/jubelio-sales-lifecycle.ts:735–1044, 1164–1495` — invoice/payment lifecycle, IDs, GET recovery, held continuation.
- **S4:** `apps/store/src/lib/jubelio-sales-operations.ts:233–259, 435–459, 482–580` — atomic claim, review transition, ID persistence.
- **S5:** `packages/db/src/schema/jubelio-sales.ts` — durable ledger fields dan unique constraints.
- **S6:** `apps/store/src/app/api/cron/sweep-reservations/route.ts:143–173`; `deployment/common/cron/sweep-reservations.sh` — recovery entry dan wrapper, bukan bukti runtime scheduling.
- **S7:** `apps/store/src/app/api/webhooks/jubelio/route.ts` — master-data webhook.
- **S8:** `docs/jubelio-api/dist.yaml:222–231` — export dokumentasi vendor: non-200 webhook delivery hingga 3 kali.
- **S9:** `apps/store/src/app/api/webhooks/jubelio-shipment/route.ts:98–136` — callback ingest tanpa provider GET.
- **S10:** `apps/admin/src/app/api/admin/orders/[id]/delivery/reconcile/route.ts` — tracking reconcile, bukan settlement retry.
- **S11:** `apps/admin/src/app/api/admin/reviews/sales-operations/route.ts:35–40, 119–170` — read-only review, blocked predicate, checkout attempts.
- **S12:** `apps/admin/src/app/admin/orders/reviews/page.tsx:109–143` — reload daftar.
- **S13:** `apps/store/src/lib/jubelio-sales-client.ts:1462–1606` — pre-send vs possibly-sent classification dan HTTP status handling.
- **S14:** `apps/store/src/features/checkout/place-order-service.ts:28–29, 77–122` — attempt sebelum order dan dispatch boundary.
- **S15:** `apps/store/src/features/checkout/recover-checkout-service.ts` — recovery checkout attempt yang terpisah.
