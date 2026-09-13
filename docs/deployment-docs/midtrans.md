# Konfigurasi Midtrans

## Staging (Sandbox)

1. Buka [Midtrans Sandbox Dashboard](https://dashboard.sandbox.midtrans.com/).
2. **Settings → Configuration**.
3. Di **Payment Notification URL**, isi:
   ```
   https://dev-store.adfsport.cloud/api/webhooks/midtrans
   ```
4. **Settings → Access Keys** → copy **Server Key** dan **Client Key** →
   masukkan ke `deployment/staging/.env`:
   ```
   MIDTRANS_SERVER_KEY=SB-Mid-server-xxxxxxxx
   MIDTRANS_CLIENT_KEY=SB-Mid-client-xxxxxxxx
   MIDTRANS_IS_PRODUCTION=false
   ```

## Production (Live)

1. Buka [Midtrans Dashboard](https://dashboard.midtrans.com/) (dashboard
   **production**, bukan sandbox).
2. **Settings → Configuration** → **Payment Notification URL**:
   ```
   https://store.adfsport.cloud/api/webhooks/midtrans
   ```
3. **Settings → Access Keys** → copy **Server Key** dan **Client Key** →
   masukkan ke `deployment/production/.env`:
   ```
   MIDTRANS_SERVER_KEY=Mid-server-xxxxxxxx
   MIDTRANS_CLIENT_KEY=Mid-client-xxxxxxxx
   MIDTRANS_IS_PRODUCTION=true
   ```

> **PENTING:** `MIDTRANS_IS_PRODUCTION` di compose default-nya `false` untuk
> staging dan `true` untuk production. Jangan campur key sandbox dengan flag
> production (atau sebaliknya) — checkout akan error. Lihat
> [troubleshooting.md](troubleshooting.md).

## Aktifkan metode pembayaran (Sandbox & Production)

Checkout mengirim `enabled_payments` berikut saat membuat token Snap
(`SNAP_ENABLED_PAYMENTS` di `apps/store/src/lib/midtrans.ts`):

| Kode Midtrans | Metode | Catatan aktivasi |
|---|---|---|
| `other_qris` | QRIS generik | Aktif bersama GoPay/ShopeePay QRIS |
| `gopay` | GoPay (deeplink/QRIS) | Butuh aktivasi GoPay di akun merchant |
| `credit_card` | Kartu kredit/debit | Wajib 3DS (`credit_card.secure: true`); pastikan acquirer mendukung 3DS |
| `permata_va` / `bca_va` / `bni_va` / `bri_va` / `cimb_va` | Virtual Account | Aktifkan sesuai bank yang disetujui dalam kontrak |
| `echannel` | Mandiri Bill Payment | | 
| `other_va` | VA bank lain | Dialihkan ke Permata/BNI/BRI/Danamon |

Langkah (lakukan di **sandbox** dulu, lalu ulangi di **production**):

1. **Dashboard → Settings → Snap Preference → Payment Channels**: pastikan
   semua metode di atas tercentang; urutan bebas (urutan API mengikuti
   dashboard).
2. **Dashboard → Settings → Configuration**: Payment Notification URL tetap
   `https://<store-host>/api/webhooks/midtrans` (tidak berubah).
3. Verifikasi metode yang belum aktif (mis. GoPay/kartu) pada kontrak merchant
   Midtrans — metode yang tidak aktif akan ditolak saat create token.
4. Tidak ada env var baru; compose sudah mengirim semua `MIDTRANS_*`.

Verifikasi sandbox manual (satu kali per metode):

- QRIS sandbox: scan QR di halaman Snap.
- GoPay sandbox: pilih GoPay → selesaikan di aplikasi sandbox.
- VA (mis. BCA): bayar `VA number` yang ditampilkan Snap.
- Kartu sukses: `4811 1111 1111 1114`, CVV `123`, expiry bebas, 3DS challenge →
  `payment_type = credit_card`.
- Kartu ditolak: gunakan test card declined → webhook `deny` **tidak**
  mem-fail order (non-terminal); order tetap `pending_payment` sampai TTL.
