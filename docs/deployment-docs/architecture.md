# Arsitektur Deployment

## Diagram

```
         Internet (HTTPS)
              │
       ┌──────┴──────┐
       │   Caddy      │  auto-HTTPS (Let's Encrypt PRODUCTION)
       │  :80 / :443  │
       └──┬───────┬───┘
   dev-store   dev-admin        (staging)  /  store, admin (production)
          │       │
   ┌──────┴──┐ ┌──┴──────┐
   │ store   │ │ admin   │  Next.js standalone (node server.js)
   │ :3000   │ │ :3001   │
   └────┬────┘ └────┬────┘
        │           │
        └────┬──────┘
       named volume "uploads"  (/app/uploads, shared store+admin)
             │
             │  host.docker.internal:5432
             ▼
       ┌──────────────┐
       │ PostgreSQL   │  (bare-metal di VPS, di luar Docker)
       │ DB: storefront│
       └──────────────┘

  [one-shot] migrate container → drizzle-kit migrate
```

> **PENTING — Best practice Drizzle migration:** Container `migrate` menjalankan
> `drizzle-kit migrate` (apply file SQL yang sudah di-commit di
> `packages/db/drizzle/`). Container tidak menjalankan seed secara implisit.
> Seed hanya boleh dipanggil eksplisit pada database disposable dan akan
> menolak `NODE_ENV=production`. Lihat [deploy.md](deploy.md)
> untuk workflow lengkap (generate → commit → pull → migrate).

## Komponen

| Service | Fungsi | Port expose |
|---------|--------|-------------|
| `store` | Storefront Next.js (customer-facing) | internal 3000 (via Caddy) |
| `admin` | Admin dashboard Next.js | internal 3001 (via Caddy) |
| `caddy` | Reverse proxy + auto-HTTPS | 80, 443 (public) |
| `migrate` | One-shot: jalankan DB migration; seed harus eksplisit | — (profile `tools`) |
| Postgres | Database (bare-metal) | 5432 (hanya dari Docker bridge) |

## Struktur folder `deployment/`

```
deployment/
├── common/                      # file yang SAMA untuk staging & production
│   ├── store/Dockerfile
│   ├── admin/Dockerfile
│   └── migrate/Dockerfile
├── staging/                     # config KHUSUS staging
│   ├── docker-compose.yml
│   ├── caddy/Caddyfile
│   └── .env.example
├── production/                  # config KHUSUS production
│   ├── docker-compose.yml
│   ├── caddy/Caddyfile
│   └── .env.example
└── .gitignore
```

### Kenapa dipisah begini?

- **`common/`** — Dockerfile tidak berubah antara staging & production. Nilai
  yang berbeda (domain, `NEXT_PUBLIC_*`) di-inject lewat `build.args` di
  masing-masing `docker-compose.yml`, bukan di Dockerfile.
- **`staging/` & `production/`** — config yang pasti beda: domain Caddy,
  `NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_APP_NAME`, default `MIDTRANS_IS_PRODUCTION`,
  dan `.env` (DB, secret, key).

### `container_name` sengaja tidak di-set

Kedua `docker-compose.yml` **tidak** men-set `container_name`. Nama container
di-generate dari project name (`-p staging` / `-p production`), jadi:

- staging → `staging-store-1`, `staging-admin-1`, `staging-caddy-1`
- production → `production-store-1`, `production-admin-1`, `production-caddy-1`

Ini memungkinkan kedua environment jalan berdampingan di satu VPS tanpa bentrok
nama container. Lihat [environments.md](environments.md).

## Alur request

1. Browser → `https://dev-store.adfsport.cloud` (staging) → Caddy (port 443).
2. Caddy reverse-proxy ke `store:3000` (nama service di compose network).
3. `store`/`admin` akses Postgres bare-metal via `host.docker.internal:5432`
   (di-map ke host gateway lewat `extra_hosts`).
4. Upload gambar ditulis admin ke named volume `uploads`, dibaca store dari
   volume yang sama.
