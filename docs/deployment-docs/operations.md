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

## Backup database (Postgres bare-metal)

```bash
pg_dump -U marketplace -h localhost storefront > storefront-backup-$(date +%Y%m%d).sql
```
(jalankan via SSH di VPS, bukan dari dalam container)

Untuk production:
```bash
pg_dump -U marketplace_production -h localhost storefront_production > storefront_production-backup-$(date +%Y%m%d).sql
```
