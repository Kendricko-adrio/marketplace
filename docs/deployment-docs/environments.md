# Memisahkan Environment Staging & Production

Dengan struktur baru, staging & production sudah punya **file config terpisah**
(`deployment/staging/` vs `deployment/production/`). Setiap folder berisi
`docker-compose.yml` sendiri, `caddy/Caddyfile` sendiri, dan `.env` sendiri.
Kombinasi **file compose terpisah + project name (`-p`)** adalah strategi yang
dipakai. Tujuan akhirnya: saat jalankan `docker container ls`, environment
staging dan production tidak saling menimpa dan mudah difilter.

## A. Kenapa perlu pemisahan?

- **Kebocoran data** — staging dan production pakai data berbeda (DB berbeda,
  secret berbeda, upload berbeda). Bila bercampur, test di staging bisa
  menulis ke DB production.
- **Isolasi resource** — restart/rebuild staging tidak boleh ganggu production.
- **Kemudahan operasional** — `docker compose ps` / `docker container ls` harus
  jelas menunjukkan environment mana yang aktif.
- **Rollback aman** — kalau staging rusak, production tetap jalan.

## B. Cara pakai sekarang

**Staging:**
```bash
cd deployment/staging
docker compose -p staging --env-file .env up -d --build
docker compose -p staging --env-file .env ps
docker container ls --filter "name=staging-"
```

**Production:**
```bash
cd deployment/production
docker compose -p production --env-file .env up -d --build
docker compose -p production --env-file .env ps
docker container ls --filter "name=production-"
```

> `-p staging` / `-p production` membuat **project name** berbeda. Karena
> `container_name` tidak di-set di compose, nama container di-generate dari
> project name:
> - staging → `staging-store-1`, `staging-admin-1`, `staging-caddy-1`
> - production → `production-store-1`, `production-admin-1`, `production-caddy-1`
>
> Saat `docker container ls` tanpa filter, keduanya muncul — itu wajar di satu
> VPS dengan dua env. Filter dengan prefix nama untuk lihat hanya satu.

**Stop hanya staging (production tetap jalan):**
```bash
docker compose -p staging --env-file .env down
```

> **Volume juga ter-isolasi via project name.** Volume `uploads` di staging →
> `staging_uploads`, di production → `production_uploads`. File upload staging
> tidak bercampur dengan production. Begitu juga volume Caddy state
> (`caddy_data`, `caddy_config`) — sertifikat staging & production terpisah.

## C. Filter container (opsional — label)

Kalau mau filter via label (selain prefix nama), tambahkan di masing-masing
`docker-compose.yml`:
```yaml
services:
  store:
    labels:
      - "app=marketplace"
      - "env=staging"        # "production" di file production
  # ...admin, caddy sama
```

Lalu:
```bash
docker container ls --filter "label=env=staging"
docker container ls --filter "label=env=production"
```

## D. Isolasi penuh — VPS terpisah (Docker Context)

Untuk isolasi **sebenarnya** (satu `docker container ls` hanya tampil satu
env tanpa filter), pakai Docker Context = daemon/host berbeda:

```bash
# Di komputer lokal
docker context create staging --docker "host=ssh://ops@STAGING_VPS_IP"
docker context create production --docker "host=ssh://ops@PRODUCTION_VPS_IP"

# Switch ke staging
docker context use staging
docker container ls           # ← hanya tampil container di VPS staging
docker compose up -d --build  # deploy ke staging

# Switch ke production
docker context use production
docker container ls           # ← hanya tampil container di VPS production
```

> **Untuk sekarang** (deploy staging saja dulu di satu VPS): cukup pakai
> strategi B di atas. Nanti kalau mau production, bisa tetap di VPS yang sama
> (dengan `-p production`) atau pindah ke VPS terpisah (Docker Context).

## E. Hal yang perlu berbeda antar staging & production

Saat kedua env berjalan, pastikan **semua** ini berbeda (tidak share):

| Item | Staging | Production | Cara isolasi |
|------|---------|------------|--------------|
| Database | DB `qadfstore` (aktif) | DB `qadfstore_production` (**belum dibuat**) | Saat go-live: buat dua database di Postgres, set di `.env` masing-masing |
| DB user | `qmarketplace` (aktif) | `qmarketplace_production` (**belum dibuat**) | Saat go-live: buat dua user di Postgres |
| `DATABASE_URL` | beda DB name/user | beda DB name/user | `deployment/staging/.env` vs `deployment/production/.env` |
| `BETTER_AUTH_SECRET` | secret A | secret B (beda) | Generate terpisah: `openssl rand -base64 32` |
| Google OAuth redirect | `dev-store.adfsport.cloud` | `store.adfsport.cloud` | Daftar dua client ID di Google Console |
| Midtrans | Sandbox key (`MIDTRANS_IS_PRODUCTION=false`) | Production key (`true`) | `.env` masing-masing |
| Domain (Caddy) | `dev-store`, `dev-admin` | `store`, `admin` | Caddyfile terpisah per env |
| Upload volume | `staging_uploads` | `production_uploads` | Otomatis via `-p` |
| Caddy state | `staging_caddy_data` | `production_caddy_data` | Otomatis via `-p` (sertifikat terpisah) |
| SMTP | Bisa pakai Gmail App Password | Pertimbangkan provider khusus | `.env` masing-masing |

> **PENTING:** dua env di **satu VPS yang sama** membagi Postgres bare-metal.
> Wajib dua database terpisah + dua user di Postgres (lihat
> [postgresql.md](postgresql.md)). Jangan pakai satu DB yang sama — data
> staging akan menimpa data production. Saat ini di VPS hanya ada DB staging
> (`qadfstore`); DB production baru dibuat saat go-live.

## F. Workflow deploy staging dulu, production nanti

**1. Deploy staging (sekarang):**
```bash
cd ~/marketplace
cd deployment/staging
cp .env.example .env
nano .env                        # isi secret staging

docker compose -p staging --env-file .env up -d --build

# Migration + seed (staging)
docker compose -p staging --env-file .env --profile tools run --rm migrate

# Cek
docker container ls --filter "name=staging-"
```

**2. Verifikasi staging jalan:**
```bash
docker compose -p staging --env-file .env ps
# Semua Up → lanjut test di browser (lihat verification.md)
```

**3. Nanti, deploy production (terpisah, setelah staging verified):**
```bash
cd ~/marketplace
cd deployment/production
cp .env.example .env
nano .env                        # isi secret production

docker compose -p production --env-file .env up -d --build

# SELALU backup DB production sebelum migrate
pg_dump -U qmarketplace_production -h localhost qadfstore_production > backup-$(date +%Y%m%d).sql

# Migration production SAJA (JANGAN run seed di production!)
docker compose -p production --env-file .env --profile tools run --rm migrate npx drizzle-kit migrate

# Cek
docker container ls --filter "name=production-"
```

**4. Sehari-hari, kelola masing-masing env:**
```bash
# Staging
docker compose -p staging --env-file .env logs -f
docker compose -p staging --env-file .env down
docker compose -p staging --env-file .env up -d --build

# Production
docker compose -p production --env-file .env logs -f
docker compose -p production --env-file .env down
docker compose -p production --env-file .env up -d --build
```
