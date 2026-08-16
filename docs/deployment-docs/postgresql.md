# Setup PostgreSQL (bare-metal)

Postgres **tidak** dijalankan di Docker — diinstall langsung di VPS agar
mudah di-maintain, backup, dan tune.

> **Tiga "user" berbeda yang terlibat — jangan tertukar:**
>
> | Nama | Siapa | Peran di panduan ini |
> |------|-------|----------------------|
> | **`ops`** | User Linux Anda (login SSH) | Menjalankan semua perintah `sudo` di bawah. Dibuat di [server-hardening.md](server-hardening.md). |
> | **`postgres`** | Superuser bawaan Postgres (system account, BUKAN user login SSH) | Dipakai hanya untuk menjalankan `psql` saat setup awal: `sudo -u postgres psql`. Tidak untuk aplikasi. |
> | **`marketplace`** | User database untuk aplikasi (dibuat di bawah) | Yang dipakai aplikasi di `DATABASE_URL`. Bukan superuser. |
>
> **Jawaban singkat:** Install Postgres **tidak butuh login root**, tapi
> butuh **hak root via sudo**. User `ops` yang sudah diberi sudo bisa
> melakukan semua langkah di bawah. Perintah `sudo` = eksekusi sebagai root
> sementara. Tidak perlu `su -` ke root.

> Perintah di bawah dijalankan sebagai `ops` (login via `ssh ops@IP_VPS`).

## 1. Install PostgreSQL 16

**Ubuntu 22.04/24.04:**
```bash
sudo sh -c 'echo "deb https://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" > /etc/apt/sources.list.d/pgdg.list'
curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc | sudo gpg --dearmor -o /etc/apt/trusted.gpg.d/postgresql.gpg
sudo apt update
sudo apt install -y postgresql-16
```

**Debian 12:**
```bash
sudo sh -c 'echo "deb https://apt.postgresql.org/pub/repos/apt bookworm-pgdg main" > /etc/apt/sources.list.d/pgdg.list'
curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc | sudo gpg --dearmor -o /etc/apt/trusted.gpg.d/postgresql.gpg
sudo apt update
sudo apt install -y postgresql-16
```

## 2. Buat database + user untuk aplikasi

```bash
sudo -u postgres psql
```

Di dalam psql prompt:
```sql
CREATE USER marketplace WITH PASSWORD 'ubah-password-kuat-di-sini';
CREATE DATABASE storefront OWNER marketplace;
\q
```

> **Penting:** Jangan pakai user `postgres` (superuser) untuk aplikasi.
> Buat user khusus `marketplace` seperti di atas. Ganti password dengan
> password kuat (acak 20+ karakter).

## 3. Konfigurasi Postgres untuk menerima koneksi dari Docker

Container Docker butuh akses ke Postgres di host. Cari subnet Docker:

```bash
# Lihat IP gateway Docker (biasanya 172.17.0.1 atau 172.18.0.1)
docker network inspect bridge | grep Gateway
# atau
ip addr show docker0
```

Catat subnetnya, misal `172.17.0.0/16`.

Edit `postgresql.conf`:
```bash
sudo nano /etc/postgresql/16/main/postgresql.conf
```
Cari `listen_addresses` dan ubah:
```
listen_addresses = 'localhost,172.17.0.1'
```
(atau `'localhost,172.18.0.1'` sesuai gateway Docker Anda). Ini membuat
Postgres mendengarkan koneksi dari interface Docker bridge.

Edit `pg_hba.conf`:
```bash
sudo nano /etc/postgresql/16/main/pg_hba.conf
```
Tambahkan baris di akhir file (ganti subnet sesuai output langkah di atas):
```
# Allow Docker containers to connect to storefront DB
host    storefront    marketplace    172.16.0.0/12    scram-sha-256
```
(`172.16.0.0/12` mencakup 172.16.x–172.31.x, aman untuk berbagai subnet Docker).

Restart Postgres:
```bash
sudo systemctl restart postgresql
sudo systemctl enable postgresql
```

Verifikasi Postgres listen di interface yang benar:
```bash
sudo ss -tlnp | grep 5432
# harus ada 127.0.0.1:5432 dan 172.17.0.1:5432 (atau gateway Docker Anda)
```

## 4. Setup dua database (staging + production)

> **PENTING:** dua env di **satu VPS yang sama** membagi Postgres bare-metal.
> Wajib buat dua database terpisah (`storefront_staging` +
> `storefront_production`) + dua user (atau satu user dengan akses ke dua
> DB) di Postgres. Jangan pakai satu DB yang sama — data staging akan
> menimpa data production.

Jalankan sekali di VPS:
```bash
sudo -u postgres psql
```

```sql
-- Staging
CREATE USER marketplace_staging WITH PASSWORD 'password-kuat-staging';
CREATE DATABASE storefront_staging OWNER marketplace_staging;

-- Production
CREATE USER marketplace_production WITH PASSWORD 'password-kuat-production';
CREATE DATABASE storefront_production OWNER marketplace_production;
\q
```

Update `pg_hba.conf` (sudah ada baris untuk subnet Docker — berlaku untuk
kedua DB):
```
host    storefront_staging     marketplace_staging     172.16.0.0/12    scram-sha-256
host    storefront_production  marketplace_production  172.16.0.0/12    scram-sha-256
```

Restart Postgres:
```bash
sudo systemctl restart postgresql
```

Lalu di `deployment/staging/.env`:
```
PGDB=storefront_staging
PGUSER=marketplace_staging
PGPASS=password-kuat-staging
DATABASE_URL=postgresql://marketplace_staging:password-kuat-staging@host.docker.internal:5432/storefront_staging
```

Di `deployment/production/.env`:
```
PGDB=storefront_production
PGUSER=marketplace_production
PGPASS=password-kuat-production
DATABASE_URL=postgresql://marketplace_production:password-kuat-production@host.docker.internal:5432/storefront_production
```

> `DATABASE_URL` adalah **satu-satunya** sumber koneksi yang dipakai compose
> (anchor `x-pg`) dan drizzle-kit. `PGUSER`/`PGPASS`/`PGDB` hanya referensi.
> Kalau ubah credential, cukup update `DATABASE_URL` (URL-encode karakter
> special pada password: `@` → `%40`, `:` → `%3A`, `/` → `%2F`, `#` → `%23`).
