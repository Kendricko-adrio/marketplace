# Deployment — cron komunikasi order

Endpoint `POST /api/cron/process-order-communications` memproyeksikan fakta
komunikasi order yang sudah committed lalu mengirim email yang due (antrean
durable, retry maksimal tiga kali setelah percobaan awal). Lihat
[`docs/features/order-communications.md`](../features/order-communications.md)
untuk kontrak perilaku.

## Prasyarat

1. Migration baru sudah diterapkan (`order_communication_event`,
   `order_email_job`, kolom `orders.order_communication_version`). Container
   deployment menjalankan `drizzle-kit migrate`; dev memakai `db:push`.
2. `CRON_SECRET` tersedia di env aplikasi dan di file env wrapper cron.
3. SMTP order terkonfigurasi (`SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`) dan
   `NEXT_PUBLIC_APP_URL` menunjuk origin storefront yang benar — link email
   memakai nilai itu, bukan origin admin.

## Wrapper dan jadwal

| Berkas | Isi |
|---|---|
| `deployment/common/cron/process-order-communications.sh` | Wrapper curl + log harian + housekeeping retensi |
| `deployment/common/cron/process-order-communications.test.sh` | Test wrapper (URL endpoint, secret dari file env) |
| `deployment/staging/order-communications.cron` | Contoh entri crontab setiap menit (staging) |
| `deployment/production/order-communications.cron` | Contoh entri crontab setiap menit (production) |

Berkas `.cron` adalah **contoh konfigurasi**. Memasang cron, mengubah crontab
server, atau menjalankan deployment memerlukan persetujuan operator.

## Verifikasi

```bash
# Wrapper (tanpa jaringan): membaca --url/--env-file, menulis satu baris log.
bash deployment/common/cron/process-order-communications.test.sh

# Manual sekali jalan terhadap staging (butuh secret asli).
curl -sS -X POST -H "X-Cron-Secret: $CRON_SECRET" \
  https://dev-store.adfsport.cloud/api/cron/process-order-communications
```

Respons 200: `{ success, limit, projected, emailJobsCreated,
notificationsCreated, claimed, sent, retry, failed, superseded }`.
503 `Cron not configured` berarti `CRON_SECRET` tidak terpasang; 401 berarti
header tidak cocok; 503 `Sweep unavailable` berarti kegagalan dependency global
(detail di log aplikasi, bukan di respons).

## Diagnosa antrean (read-only)

```sql
SELECT kind, status, attempt_count, next_attempt_at, lease_until, error_code
FROM order_email_job
WHERE status IN ('pending', 'retry', 'sending', 'failed')
ORDER BY next_attempt_at
LIMIT 50;
```

- `sending` dengan `lease_until` di masa lalu akan di-claim ulang dalam sisa
  batas attempt (crash setelah dispatch = hasil tidak pasti).
- `failed` adalah terminal; tidak ada tombol resend admin. Perbaiki penyebab
  (kredensial SMTP/kontak) lalu buat order baru — tidak ada backfill email.
- `superseded` berarti tahap yang lebih baru sudah committed sebelum email
  dikirim; ini perilaku yang diinginkan.

## Monitoring

- Baris log `order communications sweep completed: ...` per run (harian per
  file log wrapper).
- `retry`/`failed` yang terus bertambah menandakan SMTP bermasalah; periksa
  `error_code` (`SMTP_EAUTH`, `SMTP_ECONNECTION`, `SMTP_ETIMEDOUT`,
  `RECIPIENT_REJECTED`, `DISPATCH_EXCEPTION`).
- Email ganda mungkin terjadi untuk hasil tidak pasti (`SMTP_ETIMEDOUT`);
  aplikasi tidak menjanjikan exactly-once delivery.
