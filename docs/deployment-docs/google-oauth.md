# Konfigurasi Google OAuth

1. Buka [Google Cloud Console](https://console.cloud.google.com/) → project Anda.
2. **API & Services → Credentials**.
3. Buat atau edit **OAuth 2.0 Client ID** (tipe: Web application).
4. Di **Authorized redirect URIs**, tambahkan:
   ```
   https://dev-store.adfsport.cloud/api/auth/callback/google
   ```
5. Copy **Client ID** dan **Client Secret** → masukkan ke `deployment/staging/.env`:
   ```
   GOOGLE_CLIENT_ID=xxxxxxxx.apps.googleusercontent.com
   GOOGLE_CLIENT_SECRET=xxxxxxxx
   ```

> Sertifikat HTTPS masih staging (browser warning) saat testing pertama,
> tapi redirect URI tetap pakai `https://` — Google tidak peduli CA-nya
> saat validasi redirect URI, hanya domain + path yang dicek.

## Production

Untuk production, daftarkan **client ID terpisah** (atau tambahkan redirect
URI production ke client yang sama) dengan domain production:
```
https://store.adfsport.cloud/api/auth/callback/google
```
Lalu isi `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` di
`deployment/production/.env` dengan nilai production.
