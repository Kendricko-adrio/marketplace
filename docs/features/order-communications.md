# Komunikasi order — status, notifikasi, dan email

Kontrak enduring untuk penyelarasan status website, Status Channel Jubelio,
notifikasi admin, dan email order. Spec sumber:
`.scratch/pengiriman-ke-rumah-jubelio/plan/penyelarasan-status-notifikasi-email-spec.md`.

## Arti status

| Status website | Arti |
|---|---|
| `pending_payment` / `pending` | Order dibuat, pembayaran belum dikonfirmasi. |
| `processing` / `paid` | Pembayaran customer dikonfirmasi Midtrans; invoice/payment Jubelio mungkin belum terverifikasi. |
| `processing` / `paid` + ledger terverifikasi + unblocked | **Siap Diproses** (delivery: target channel `Siap Proses`). |
| `ready_for_pickup` | Pickup siap diambil (punya kode pickup). |
| Bukti pertama barang dibawa | **Mulai Diantar** (delivery): catatan serah-terima petugas yang sah atau kurir `PICKED_UP`/`ON_DELIVERY`. Resi/booking saja tidak cukup. |
| `completed` setelah DELIVERED valid | **Sudah Sampai**: bukti kurir cocok dengan shipment/order; tidak mensyaratkan foto. |
| `completed` (pickup) / `completed` (penutupan manual delivery) | **Selesai**: penanganan berakhir. Penutupan manual bukan bukti barang diterima. |

Status Channel Jubelio untuk delivery mengikuti `Belum Bayar → Siap Proses →
Selesai` tanpa pernah menjadi `ready_for_pickup`.

## Dua tabel durable (`packages/db/src/schema/order-communications.ts`)

| Tabel | Isi |
|---|---|
| `order_communication_event` | Fakta unik `(order_id, kind)`: `source`, `occurred_at`, `received_at`, plus checkpoint `email_job_created_at` / `notification_created_at`. Bagian fakta tidak pernah ditimpa checkpoint. |
| `order_email_job` | Tugas unik `(order_id, kind)`: `pending/sending/retry/sent/failed/superseded`, `attempt_count` 0..4, `next_attempt_at`, `claim_token`, `lease_until`, `sent_at`, `error_code` (token aman saja). |

Jenis fakta: `delivery_ready`, `delivery_in_transit`, `delivery_delivered`,
`delivery_closed_manually`, `pickup_ready`, `pickup_completed`,
`payment_failed`. Semua kecuali `delivery_closed_manually` punya pekerjaan email.

Penulisan fakta selalu berada pada transaksi bisnisnya:

| Pemicu | Penulis |
|---|---|
| Gate finansial delivery terverifikasi | `settleJubelioSalesOrder` (store) |
| Pickup siap diambil / pembayaran gagal | `fulfillPaidOrder` / `claimAndFailOrder` (store) |
| Serah-terima petugas, kurir `PICKED_UP`/`ON_DELIVERY`, `DELIVERED` (termasuk bukti terlambat) | `packages/db/src/shipment-tracking.ts` |
| Penutupan manual delivery | `apps/admin/src/lib/delivery-follow-up.ts` |
| Penyelesaian pickup | `apps/store/src/features/orders/pickup-completion-repository.ts` |

`orders.order_communication_version` membatasi efek: order yang dibuat runtime
sekarang mengisi `1`; baris lama tetap `0` dan **tidak** mendapat fakta, email,
notifikasi, atau proyeksi baru. Tidak ada backfill.

## Notifikasi admin

Satu notifikasi `order_paid` hanya untuk delivery yang siap diproses (judul
`Order dibayar — siap diproses`). Pickup mempertahankan notifikasi existing.
Lihat [`notifications.md`](notifications.md).

## Email order

| Jenis | Subject | CTA |
|---|---|---|
| `delivery_ready` | Pembayaran diterima — pesanan sedang disiapkan | Lihat pesanan |
| `delivery_in_transit` | Pesanan sedang diantar | Lacak pesanan |
| `delivery_delivered` | Pesanan sudah sampai | Lihat pesanan |
| `pickup_ready` | Existing (memuat kode pickup) | — |
| `pickup_completed` | Existing | — |
| `payment_failed` | Existing (pemicu kedaluwarsa/failure terminal) | — |

- Penerima: `orders.contact_email` tersimpan. Nominal/item/alamat dari data
  order/snapshot tersimpan — tidak pernah reprice.
- Link delivery: `BRAND_APP_URL` + `/account/orders/{orderId}` (origin
  storefront, bukan admin, bukan input `Host`). Autentikasi/ownership halaman
  order tetap berlaku.
- Template delivery tidak pernah memuat kode/jadwal pickup atau alasan internal
  penutupan manual.

### Antrean, retry, dan batas jaminan

- 1 percobaan awal + maksimal 3 retry (paling banyak empat dispatch).
- Jeda retry 5 menit dari kegagalan/hasil tidak pasti terakhir.
- Claim atomik dengan lease 5 menit; attempt dicatat **sebelum** dispatch.
  Timeout transport (`connectionTimeout` 20 dtk, `greetingTimeout` 10 dtk,
  `socketTimeout` 60 dtk) selalu lebih pendek dari lease.
- Klasifikasi hasil: `accepted` (server email menerima), `temporary`
  (gangguan koneksi), `uncertain` (timeout/error tak dikenal — tetap retry),
  `permanent` (auth/envelope/pesan ditolak — berhenti).
- **Tidak menjanjikan exactly-once delivery.** Hasil tidak pasti diulang dalam
  sisa batas, sehingga email ganda di luar kendali aplikasi mungkin terjadi.
  Informasi yang sudah diteruskan ke server email tidak dapat ditarik kembali.
- Kegagalan email tidak membatalkan pembayaran/pesanan, tidak mengulang
  notifikasi/channel yang sudah sukses, dan tidak mengganggu email autentikasi
  (jalur `sendEmail` tetap terpisah).
- Kondisi terbaru mengalahkan email lama: delivery `ready → in_transit →
  delivered`, pickup `ready → completed`, penutupan manual menghentikan
  ready/in_transit, dan email gagal tidak dikirim setelah order menjadi paid.

## Endpoint operasi

`POST /api/cron/process-order-communications` (header `X-Cron-Secret` =
`CRON_SECRET`). Tanpa secret terkonfigurasi → 503; secret salah/hilang → 401.
Query `?limit=` dibatasi 50 (default 20). Respons berisi counters
`projected/emailJobsCreated/notificationsCreated/claimed/sent/retry/failed/superseded`
tanpa PII. Endpoint tidak menerima recipient, HTML, override order, status
pembayaran, atau instruksi provider write.

Jadwal yang diajukan: setiap menit. Lihat
[`docs/deployment-docs/order-communications.md`](../deployment-docs/order-communications.md).

## Batas yang disengaja

- Tidak ada filter Pickup/Delivery baru, halaman riwayat email, tombol resend,
  tracking publik tanpa login, atau email khusus penutupan manual.
- Tidak ada backfill/koreksi data lama.
- Provider (Midtrans/Jubelio/SMTP) tidak pernah menerima write dari worker
  komunikasi; mirror Jubelio memakai mesin intent/claim existing dan tidak
  pernah mengulang edit POST secara buta.
