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

Gunakan HTTPS valid dan Authorized redirect URI yang persis sesuai domain/path di atas. Pada checkpoint18November2026, GET auth health staging berhasilHTTP200 dengan verifikasi TLS normal; jangan mengabaikan error sertifikat untuk menyatakan OAuth siap.

## Penerapan credential staging

Google staging **bukan** default credential lokal. Gunakan pasangan staging yang dikonfirmasi pemilik; jangan menjalankan transfer env lama yang menyalin Google lokal atau mengganti seluruh env/provider lain.

Pada18November2026, pasangan pemilik diterapkan hanya ke dua key Google di `deployment/staging/.env` dan salinan `.env.staging`, kemudian store direcreate dari image ID yang sudah dipin. Input aktual disimpan privat di luar repo; jangan menaruh secret pada dokumentasi, command argv, build args atau log. Tidak memerlukan rebuild karena source existing membaca env runtime.

Pointer runtime override/image IDs: `/home/ops/log/marketplace-bootstrap/staging/active-release.json`. Gunakan prosedur recreate store dari [runbook staging](staging-phase-2-deployment.md), tanpa menyentuh admin/Caddy/volume atau status checkout. Admin tidak memakai Google social provider.

Pembuktian konfigurasi: runtime env cocok dengan input, store healthy dan GET `/api/auth/ok` menghasilkanHTTP200/oktrue. **Ini bukan bukti login Google end-to-end atau bukti dashboard sudah dikonfigurasi.** Pemilik tetap memeriksa Authorized redirect URIs di Google Cloud Console. Lihat [evidence setup](../../.scratch/production-deployment/ticket/setup-google-oauth-staging.md).

## Production

Untuk production, daftarkan **client ID terpisah** (atau tambahkan redirect
URI production ke client yang sama) dengan domain production:
```
https://store.adfsport.cloud/api/auth/callback/google
```
Lalu isi `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` di
`deployment/production/.env` dengan nilai production.
