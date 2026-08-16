# Verifikasi Deployment

## 1. Cek HTTPS

Buka di browser:
- `https://dev-store.adfsport.cloud` → homepage storefront
  - Sertifikat valid (Let's Encrypt production) — **tidak ada warning**.
- `https://dev-admin.adfsport.cloud` → redirect ke `/login`

> Kalau muncul warning sertifikat, berarti Caddy belum selesai minta
> sertifikat (lihat log: `docker compose -p staging --env-file .env logs caddy`,
> cari `certificate obtained successfully`) atau DNS/firewall bermasalah
> (lihat [troubleshooting.md](troubleshooting.md)).

## 2. Test alur aplikasi

- [ ] **Homepage store** load dengan produk sample (dari seed).
- [ ] **Login admin** di `https://dev-admin.adfsport.cloud/login`.
  - Pakai kredensial admin dari seed (lihat `packages/db/src/seed.ts` untuk
    email + password default). Cek file atau log seed.
- [ ] **Register customer** di store → email verifikasi sampai ke inbox.
  - Verifikasi SMTP berfungsi.
- [ ] **Upload gambar produk** dari admin → muncul di store.
  - Verifikasi volume `uploads` shared antara store dan admin.
- [ ] **Buat order dummy** lewat store + Midtrans Snap (sandbox).
  - Webhook Midtrans update status order → verifikasi notification URL benar.
- [ ] **Admin: verify-pickup** order → order jadi `completed` + email #2 terkirim.
  - Verifikasi `STORE_INTERNAL_URL=http://store:3000` + shared
    `BETTER_AUTH_SECRET` bekerja.
- [ ] **Google login** di store → redirect balik tanpa error.
  - Verifikasi redirect URI di Google Console benar.

## 3. Cek log kalau ada masalah

```bash
# Semua service
docker compose -p staging --env-file .env logs -f

# Service tertentu
docker compose -p staging --env-file .env logs -f store
docker compose -p staging --env-file .env logs -f admin
docker compose -p staging --env-file .env logs -f caddy

# Container migrate (sudah exit)
docker compose -p staging --env-file .env --profile tools logs migrate
```
