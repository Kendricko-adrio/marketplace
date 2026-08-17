# Deploy Aplikasi

> Login sebagai operational user (lihat [server-hardening.md](server-hardening.md)):
> `ssh ops@IP_VPS`. Semua perintah di bawah dijalankan sebagai user `ops`,
> bukan root.

## 1. Clone repo + siapkan env

```bash
cd ~
git clone <url-repo-anda> marketplace
cd marketplace
```

Salin template env dan isi secret (staging):
```bash
cd deployment/staging
cp .env.example .env
nano .env
```

Isi semua nilai kosong:
- `DATABASE_URL` → sesuai yang dibuat di [postgresql.md](postgresql.md)
- `BETTER_AUTH_SECRET` → generate dengan `openssl rand -base64 32`
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` → dari [google-oauth.md](google-oauth.md)
- `SMTP_USER` / `SMTP_PASS` / `SMTP_FROM` → Gmail + App Password
- `MIDTRANS_*` → dari [midtrans.md](midtrans.md)
- `CRON_SECRET` → generate dengan `openssl rand -hex 32` (lihat [cron-sweep.md](cron-sweep.md))

Generate `BETTER_AUTH_SECRET`:
```bash
openssl rand -base64 32
```

> **Penting:** `BETTER_AUTH_SECRET` harus **identik** untuk store dan admin
> (sudah diatur otomatis di docker-compose.yml — keduanya pakai nilai dari
> `.env`). Kalau beda, handshake verify-pickup antara admin dan store akan
> gagal dengan 403.

## 2. Build + start container

```bash
docker compose -p staging --env-file .env up -d --build
```

Proses ini:
- Build image `store` dan `admin` dari source (butuh 3–8 menit pertama kali).
- Start Caddy, store, admin.
- Caddy akan minta sertifikat ke Let's Encrypt **PRODUCTION** (lihat log).
  Sertifikat valid dan dipercaya browser — tidak ada warning.

Pantau proses:
```bash
docker compose -p staging --env-file .env logs -f
# tekan Ctrl+C untuk keluar dari log stream (container tetap jalan)
```

## 3. Jalankan database migration + seed

> **WORKFLOW YANG BENAR (best practice Drizzle):**
>
> | Command | Kapan dipakai | Lingkungan |
> |---------|--------------|------------|
> | `drizzle-kit generate` | Setiap habis ubah `packages/db/src/schema/*` — generate file SQL migration baru di `packages/db/drizzle/`. **Commit file ini ke git.** | Lokal dev |
> | `drizzle-kit migrate` | Apply migration SQL yang sudah di-commit ke DB target. **Inilah satu-satunya command yang boleh jalan di staging & production.** | Staging, Production |
> | `drizzle-kit push` | Prototyping cepat di lokal — langsung push skema tanpa file migration. **TIDAK ada rollback, TIDAK ada history.** Hanya lokal dev. | **LOKAL SAJA** |
> | `tsx src/seed.ts` | Isi data sample secara eksplisit dan **MENGHAPUS SEMUA DATA LAMA**. Seeder menolak `NODE_ENV=production`. | Database disposable saja |
>
> **Aturan keras:**
> - **JANGAN PERNAH** `drizzle-kit push` ke DB staging/production. Tidak ada migration file, tidak bisa rollback, tidak reproducible. Lihat: https://orm.drizzle.team/docs/migrations
> - Migration files di `packages/db/drizzle/*.sql` **wajib di-commit ke git** — supaya CI/CD dan VPS sinkron. Cek: `git ls-files packages/db/drizzle/` harus menampilkan file `.sql`.
> - **JANGAN edit migration file yang sudah di-generate**. Kalau skema salah, hapus file migration terakhir (kalau belum di-apply) atau buat migration baru yang memperbaiki.
> - **Sebelum migrate production**, SELALU backup DB: `pg_dump -U marketplace_production -h localhost storefront_production > backup-$(date +%Y%m%d).sql`.

**Sekali saja** saat deploy pertama (atau ulang kalau ada migration baru):

```bash
# Staging: migration saja
docker compose -p staging --env-file .env --profile tools run --rm migrate

# Seed staging hanya jika database memang disposable (command eksplisit)
docker compose -p staging --env-file .env --profile tools run --rm migrate npx tsx src/seed.ts
```

Default container hanya menjalankan `npx drizzle-kit migrate`. Seed tidak lagi
digabungkan ke migration; production juga memiliki guard di dalam seeder.

Output yang diharapkan (staging):
```
🌱 Seeding database...
🗑️  Clearing existing data...
👤 Creating admin users...
...
✅ Seeding complete!
```

> **Catatan:** Seed akan **menghapus data lama** dulu (lihat `packages/db/src/seed.ts`).
> Untuk staging aman (data dummy boleh hilang). **JANGAN run seed di production.**

### Troubleshooting migration

| Error | Sebab | Solusi |
|-------|-------|--------|
| `relation already exists` | Schema sudah ada (mungkin dari `db:push` sebelumnya, atau `migrate` sudah jalan sekali) | Jalankan seed saja: `... run --rm migrate npx tsx src/seed.ts` |
| `database is up to date` | Tidak ada migration baru | Aman. Jalankan seed saja (staging) atau tidak perlu apa-apa (production) |
| `No migrations found` | File `packages/db/drizzle/*.sql` tidak ter-copy ke image Docker | Pastikan migration files di-commit ke git (cek: `git ls-files packages/db/drizzle/`) |
| `password authentication failed` | `DATABASE_URL` salah / user-DB mismatch | Cek `.env`: `DATABASE_URL` harus match user+DB yang dibuat di `psql` (lihat [postgresql.md](postgresql.md)) |
| `relation already exists` di **semua** tabel + journal out-of-sync | DB kotor dari `db:push` sebelumnya — tabel ada tapi `__drizzle_migrations` kosong/beda | **Staging only:** reset DB lalu migrate ulang (lihat "Recovery DB staging" di bawah) |

### Recovery DB staging (reset + migrate ulang)

Kalau DB staging kotor (tabel sudah ada tapi journal Drizzle out-of-sync,
sehingga `migrate` gagal di migration pertama dengan `relation already exists`
di SEMUA tabel), jalankan:

```bash
# 1. Drop SEMUA tabel di schema public (termasuk __drizzle_migrations)
docker compose -p staging --env-file .env --profile tools run --rm migrate npx tsx src/reset.ts

# 2. Apply migration dari awal + seed
docker compose -p staging --env-file .env --profile tools run --rm migrate
```

`reset.ts` (`packages/db/src/reset.ts`) DROP semua tabel di schema `public`
via `DROP TABLE IF EXISTS ... CASCADE`. Setelah itu, journal bersih dan
`migrate` apply migration 0000, 0001, ... dengan benar.

> **JANGAN run `reset.ts` di production.** Untuk production, kalau ada
> masalah journal, pakai `pg_dump` backup dulu lalu fix manual via `psql`
> (insert record ke `__drizzle_migrations` untuk migration yang sudah
> ter-apply). Reset di production = kehilangan semua data customer.

## 4. Cek status container

```bash
docker compose -p staging --env-file .env ps
```

Semua harus `Up`:
```
NAME                   STATUS         PORTS
staging-caddy-1        Up             0.0.0.0:80->80/tcp, 0.0.0.0:443->443/tcp
staging-store-1        Up (healthy)   3000/tcp
staging-admin-1        Up (healthy)   3001/tcp
```
