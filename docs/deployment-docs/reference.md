# Referensi Cepat

## Struktur folder `deployment/`

```
deployment/
├── common/                      # file yang SAMA untuk staging & production
│   ├── store/Dockerfile         # image storefront
│   ├── admin/Dockerfile         # image admin
│   └── migrate/Dockerfile       # image one-shot migration (seed eksplisit)
├── staging/                     # config KHUSUS staging
│   ├── docker-compose.yml
│   ├── caddy/Caddyfile          # domain dev-store / dev-admin
│   └── .env.example             # template env staging (di-commit)
├── production/                  # config KHUSUS production
│   ├── docker-compose.yml
│   ├── caddy/Caddyfile          # domain store / admin
│   └── .env.example             # template env production (di-commit)
└── .gitignore                   # ignore .env asli + caddy state
```

## File yang diedit untuk deployment (di repo)

| File | Perubahan |
|------|-----------|
| `apps/store/next.config.ts` | Tambah `output: "standalone"` + `images.unoptimized: true` |
| `apps/admin/next.config.ts` | Tambah `output: "standalone"` |
| `.dockerignore` (root) | Exclude node_modules, .next, .env, dll |
| `deployment/common/` | Dockerfile bersama (store/admin/migrate) |
| `deployment/staging/` | Compose + Caddyfile + `.env.example` staging |
| `deployment/production/` | Compose + Caddyfile + `.env.example` production |

## Command cheat-sheet

> Konvensi: semua perintah `docker compose` dijalankan **dari dalam folder
> env** (`deployment/staging` atau `deployment/production`) dengan flag
> `-p staging` / `-p production` dan `--env-file .env`.
>
> **INGAT:** `db:push` dan `seed` HANYA untuk lokal/staging. Production cukup
> `drizzle-kit migrate` saja (lihat [deploy.md](deploy.md)). Selalu backup DB
> production sebelum migrate.

```bash
# SSH ke VPS (sebagai operational user, bukan root)
ssh ops@IP_VPS
# atau kalau SSH pakai port custom:
ssh -p 22022 ops@IP_VPS

# === STAGING (dari folder deployment/staging) ===
cd ~/marketplace/deployment/staging
cp .env.example .env
nano .env                       # isi secret

docker compose -p staging --env-file .env up -d          # terapkan perubahan runtime .env tanpa rebuild
docker compose -p staging --env-file .env up -d --build  # code, Dockerfile, dependency, atau NEXT_PUBLIC_* berubah
docker compose -p staging --env-file .env --profile tools run --rm migrate            # migration saja
docker compose -p staging --env-file .env --profile tools run --rm migrate npx drizzle-kit migrate   # migration saja
docker compose -p staging --env-file .env --profile tools run --rm migrate npx tsx src/seed.ts       # seed saja (hapus data!)
docker compose -p staging --env-file .env logs -f
docker compose -p staging --env-file .env ps
docker compose -p staging --env-file .env down
docker compose -p staging --env-file .env down -v      # HATI-HATI: hapus uploads + sertifikat

# === PRODUCTION (dari folder deployment/production) ===
cd ~/marketplace/deployment/production
cp .env.example .env
nano .env                       # isi secret

# SELALU backup DB sebelum migrate production!
# (DB production belum dibuat di VPS — nama mengikuti pola staging:
#  user qmarketplace_production, db qadfstore_production. Saat ini backup
#  yang aktif adalah staging:)
pg_dump -U qmarketplace -h localhost qadfstore > backup-$(date +%Y%m%d).sql

docker compose -p production --env-file .env up -d          # terapkan perubahan runtime .env tanpa rebuild
docker compose -p production --env-file .env up -d --build  # code, Dockerfile, dependency, atau NEXT_PUBLIC_* berubah
docker compose -p production --env-file .env --profile tools run --rm migrate npx drizzle-kit migrate   # migration SAJA
docker compose -p production --env-file .env logs -f
docker compose -p production --env-file .env ps
docker compose -p production --env-file .env down

# === FILTER CONTAINER ===
docker container ls --filter "name=staging-"
docker container ls --filter "name=production-"
docker container ls            # staging + production, keduanya muncul (wajar)

# === LOKAL DEV (di mesin Anda, BUKAN VPS) ===
# Hanya di lokal boleh pakai db:push untuk prototyping cepat:
#   npm run db:push     # push skema langsung tanpa migration file
# Tapi best practice: tetap pakai generate+migrate supaya ada history:
#   npm run db:generate  # generate file migration SQL baru
#   npm run db:migrate   # apply ke lokal DB
# Setelah commit migration file, push ke git + pull di VPS + jalankan
# `drizzle-kit migrate` saja di VPS.
```

## Kontrak uang checkout berversi — kompatibilitas dan migration

Catatan ini bukan instruksi aktivasi. Tidak ada env var, port, service,
credential, volume, atau manifest deployment yang berubah untuk kontrak ini.

- **Gate domain.** `system_config.discounts.contractVersion` dibaca tanpa cache
  oleh store (berlaku pada request berikutnya); seeder menulis baris eksplisit
  `0` pada kedua `SEED_MODE`, dan baris yang absen tetap berarti legacy `0`.
  Mengubahnya ke `1` adalah keputusan operasi terpisah (butuh semua reader
  kompatibel + izin), bukan bagian dari deployment ini. `tax.ppnRatePercent`
  tetap dibaca saat boot, jadi perubahan rate butuh restart store seperti
  sebelumnya.
- **Skema additive.** Kolom/index/CHECK snapshot uang dan FK retention
  `RESTRICT` dihasilkan drizzle-kit sebagai migration audit di
  `packages/db/drizzle/` (`0034_*` untuk snapshot uang, `0035_*` untuk
  penggantian FK menjadi `RESTRICT`). File tersebut tidak diedit tangan dan
  tidak dihapus.
- **Dev vs deployment.** Development tetap memakai `npm run db:push`. Deployment
  memakai container migrate existing (`npx drizzle-kit migrate`) pada jendela
  maintenance dengan backup lebih dulu. Migration deployment **tidak dijalankan**
  dalam scope pekerjaan ini; jangan menyimpulkan sudah diterapkan.
- **Admission rate-limit (ticket 02).** `POST /api/checkout/preview` dan
  `POST /api/checkout/place-order` (gate1) memakai counter PostgreSQL
  `discount_request_window` (preview 60/account + 300/IP, place 10/60 per 60
  detik) dan menjawab `429 RATE_LIMITED` + `Retry-After` atau `503
  POLICY_UNAVAILABLE` fail-closed. `deployment/{staging,production}/docker-compose.yml`
  meng-set `CHECKOUT_TRUST_PROXY="true"` hanya karena port store tidak
  dipublish langsung dan Caddy menimpa `X-Real-IP`/`X-Forwarded-For`. Jangan
  aktifkan flag itu pada app yang dapat diakses langsung; development/mock
  selalu memakai bucket loopback. Baris window bersifat ephemeral (dibersihkan
  opportunistic, tanpa cron baru) dan terpisah dari `checkout_request` yang
  retained bersama order.
- **Urutan kompatibilitas.** Deploy skema + reader compatible lebih dulu, writer
  tetap gate `0`. Nyalakan gate `1` hanya setelah store, admin, sweep, mirror dan
  stock-sync readers menerima kontrak versi baru. Setelah ada order versi baru,
  rollback ke image lama yang tidak mengenal versi itu **tidak aman**; gunakan
  forward-fix atau image sebelumnya yang kompatibel, dan pause order baru saat
  cutover.

Kontrak uang dan daftar persyaratan rollout:
[docs/features/versioned-checkout-pricing.md](../features/versioned-checkout-pricing.md).

## Port yang dipakai

| Port | Pemakaian | Akses |
|------|-----------|-------|
| 22 | SSH | publik (atau restricted IP) |
| 80 | HTTP (Caddy, redirect ke HTTPS + ACME challenge) | publik |
| 443 | HTTPS (Caddy) | publik |
| 5432 | PostgreSQL | **hanya localhost + Docker bridge** |
| 3000 | store (internal) | hanya via Caddy |
| 3001 | admin (internal) | hanya via Caddy |

## Domain

| Domain | Environment | Service |
|--------|-------------|---------|
| `dev-store.adfsport.cloud` | staging | store (customer-facing) |
| `dev-admin.adfsport.cloud` | staging | admin (dashboard) |
| `store.adfsport.cloud` | production | store (customer-facing) |
| `admin.adfsport.cloud` | production | admin (dashboard) |
