# Deployment Docs — Marketplace

Dokumentasi operasional untuk men-deploy aplikasi marketplace (store + admin)
ke VPS menggunakan Docker. PostgreSQL berjalan **bare-metal di VPS** (tanpa
Docker), Caddy sebagai reverse proxy dengan auto-HTTPS.

Dokumentasi ini dipecah menjadi banyak file kecil (satu topik per file) supaya
mudah dicari. Mulai dari sini, lalu ikuti urutan di bawah.

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

- **`common/`** — Dockerfile yang identik untuk kedua environment. Kalau ada
  perubahan cara build (bukan config), edit di sini.
- **`staging/`** & **`production/`** — config yang pasti berbeda: domain,
  `NEXT_PUBLIC_*`, Midtrans sandbox vs live, Caddyfile, dan `.env`.
- File `.env` asli (hasil `cp .env.example .env`) **JANGAN di-commit**.

## Daftar isi (urutan baca)

| # | File | Isi |
|---|------|-----|
| 1 | [architecture.md](architecture.md) | Arsitektur, komponen, alur request |
| 2 | [server-setup.md](server-setup.md) | Prasyarat VPS + firewall |
| 3 | [server-hardening.md](server-hardening.md) | Hardening VPS (user ops, SSH, fail2ban) |
| 4 | [postgresql.md](postgresql.md) | Setup PostgreSQL bare-metal + dua database |
| 5 | [dns.md](dns.md) | Konfigurasi DNS (A record) |
| 6 | [google-oauth.md](google-oauth.md) | Google OAuth client + redirect URI |
| 7 | [midtrans.md](midtrans.md) | Midtrans sandbox & production |
| 8 | [deploy.md](deploy.md) | Deploy aplikasi (clone, env, build, migrate; seed disposable opsional) |
| 9 | [verification.md](verification.md) | Verifikasi deployment |
| 10 | [operations.md](operations.md) | Operasional sehari-hari (redeploy, backup, stop) |
| 11 | [cron-sweep.md](cron-sweep.md) | Sweep reservasi stok (cron) |
| 12 | [jubelio-sync.md](jubelio-sync.md) | Sync Jubelio (import + webhook) |
| 13 | [letsencrypt.md](letsencrypt.md) | Rate-limit Let's Encrypt |
| 14 | [troubleshooting.md](troubleshooting.md) | Troubleshooting |
| 15 | [environments.md](environments.md) | Memisahkan staging & production |
| 16 | [reference.md](reference.md) | Cheat-sheet command, port, domain |
| 17 | [jubelio-webhook-simulator.md](jubelio-webhook-simulator.md) | Test signed Jubelio webhook calls with live read-only data |
| 18 | [stock-adjustment-rollout.md](stock-adjustment-rollout.md) | Production preflight, operator canary, monitoring, and kill-switch recovery |
| 19 | [logging.md](logging.md) | Log container di journald dengan retensi host 7 hari |

## Quick start (staging)

```bash
# 1. SSH ke VPS sebagai operational user
ssh ops@IP_VPS

# 2. Clone repo
cd ~ && git clone <url-repo-anda> marketplace && cd marketplace

# 3. Siapkan env staging
cd deployment/staging
cp .env.example .env
nano .env          # isi semua secret

# 4. Build + start
docker compose -p staging --env-file .env up -d --build

# 5. Migration + seed (staging boleh seed)
docker compose -p staging --env-file .env --profile tools run --rm migrate
```

> **Konvensi command:** semua perintah `docker compose` dijalankan **dari dalam
> folder env** (`deployment/staging` atau `deployment/production`) dengan flag
> `-p staging` / `-p production` dan `--env-file .env`. Lihat
> [reference.md](reference.md) untuk cheat-sheet lengkap.

## Staging vs Production

Saat ini project masih di **tahap staging**. Production belum di-deploy, tapi
struktur folder sudah disiapkan. Perbedaan utama:

| Aspek | Staging | Production |
|-------|---------|------------|
| Domain | `dev-store` / `dev-admin` | `store` / `admin` |
| Midtrans | Sandbox (`IS_PRODUCTION=false`) | Live (`true`) |
| Seed | Jalankan eksplisit hanya untuk data disposable | **Diblokir oleh seeder** |
| DB | `storefront_staging` | `storefront_production` |

Lihat [environments.md](environments.md) untuk detail pemisahan environment.
