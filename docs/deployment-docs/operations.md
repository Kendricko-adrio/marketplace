# Operasional Sehari-hari

Semua perintah di bawah dijalankan dari folder env (`deployment/staging` atau
`deployment/production`). Contoh pakai staging; ganti `staging` → `production`
dan `--env-file .env` (di folder production) untuk production.

## Re-deploy setelah ada update code

```bash
cd ~/marketplace
git pull
cd deployment/staging
docker compose -p staging --env-file .env up -d --build
```

Layer cache Docker membuat rebuild cepat (hanya yang berubah).

## Terapkan perubahan `.env`

Setelah mengubah nilai runtime di `.env` seperti `DATABASE_URL`, secret,
kredensial SMTP, Midtrans, atau Jubelio, jalankan:

```bash
docker compose -p staging --env-file .env up -d
```

Compose akan membuat ulang container yang konfigurasi environment-nya berubah.
Jangan hanya menjalankan `docker compose restart`, karena perintah tersebut tidak
memasukkan nilai `.env` baru ke container.

Jika yang berubah adalah `NEXT_PUBLIC_*` (misalnya `NEXT_PUBLIC_APP_NAME`),
domain/build args, source code, Dockerfile, atau dependency, image harus dibangun
ulang:

```bash
docker compose -p staging --env-file .env up -d --build
```

Untuk production, jalankan command yang sama dari `deployment/production` dengan
mengganti project menjadi `-p production`.

## Run migration baru saja (tanpa seed)

Kalau ada migration baru (file SQL baru di `packages/db/drizzle/` yang sudah
di-commit + di-pull di VPS):

```bash
# Staging
docker compose -p staging --env-file .env --profile tools run --rm migrate npx drizzle-kit migrate

# Production (SELALU backup dulu — lihat deploy.md)
pg_dump -U marketplace_production -h localhost storefront_production > backup-$(date +%Y%m%d).sql
docker compose -p production --env-file .env --profile tools run --rm migrate npx drizzle-kit migrate
```

> **Workflow perubahan skema (di mesin dev lokal):**
> 1. Edit `packages/db/src/schema/*.ts` (hanya di sini — apps read-only).
> 2. `npm run db:generate` — generate file SQL baru di `packages/db/drizzle/`.
> 3. Cek file migration baru, lalu `git add packages/db/drizzle/ && git commit`.
> 4. `git push` + di VPS `git pull`.
> 5. Jalankan `migrate` saja (command di atas) — **JANGAN** `db:push`.
> 6. Update `packages/db/src/seed.ts` kalau ada tabel/kolom baru (lihat
>    AGENTS.md bagian "Seeder stays in sync with schema").

## Run seed ulang (hati-hati — hapus semua data!)

```bash
docker compose -p staging --env-file .env --profile tools run --rm migrate npx tsx src/seed.ts
```

## Stop semua container

```bash
docker compose -p staging --env-file .env down
```

## Stop + hapus volume (HATI-HATI — hapus uploads + sertifikat!)

```bash
docker compose -p staging --env-file .env down -v
```

## Lihat status + resource usage

```bash
docker compose -p staging --env-file .env ps
docker stats staging-store-1 staging-admin-1 staging-caddy-1
```

## Lihat log container

Container menggunakan logging driver `journald`. Log mengikuti konfigurasi
journald VPS yang sudah ada (saat ini retensi maksimum 7 hari); deployment tidak
mengubah konfigurasi host.

```bash
# Tetap tersedia melalui Docker Compose
docker compose -p staging --env-file .env logs -f store admin

# Query langsung dari systemd journal
journalctl -f -t staging-store-1
journalctl -t staging-admin-1 --since today

# Cek pemakaian disk log
journalctl --disk-usage
```

Verifikasi logging driver, query, dan export log dijelaskan di
[logging.md](logging.md).

## Backup database (Postgres bare-metal)

```bash
pg_dump -U marketplace -h localhost storefront > storefront-backup-$(date +%Y%m%d).sql
```
(jalankan via SSH di VPS, bukan dari dalam container)

Untuk production:
```bash
pg_dump -U marketplace_production -h localhost storefront_production > storefront_production-backup-$(date +%Y%m%d).sql
```
