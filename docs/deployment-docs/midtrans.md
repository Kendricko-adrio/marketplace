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
