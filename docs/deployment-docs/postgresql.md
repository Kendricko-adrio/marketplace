# Setup PostgreSQL (bare-metal)

Postgres **tidak** dijalankan di Docker — diinstall langsung di VPS agar
mudah di-maintain, backup, dan tune.

> **Tiga "user" berbeda yang terlibat — jangan tertukar:**
>
> | Nama | Siapa | Peran di panduan ini |
> |------|-------|----------------------|
> | **`ops`** | User Linux dengan sudo (owner repo) | Menjalankan semua perintah `sudo` di bawah. Lihat [server-hardening.md](server-hardening.md). |
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

**Status di VPS saat ini** — database dan user sudah dibuat:

```bash
sudo -u postgres psql
```

```sql
-- Sudah dibuat di VPS (nama aktual):
--   user  : qmarketplace  (bukan superuser)
--   db    : qadfstore     (owner qmarketplace)
\q
```

> **Penting:** Jangan pakai user `postgres` (superuser) untuk aplikasi.
> Aplikasi memakai user `qmarketplace` (bukan superuser) — sesuai prinsip
> least privilege. Nama ini dipakai di `DATABASE_URL` (lihat bawah).

## 3. Konfigurasi Postgres untuk menerima koneksi dari Docker

Container Docker butuh akses ke Postgres di host. Cari subnet Docker:

```bash
# Lihat IP gateway Docker (biasanya 172.17.0.1 atau 172.18.0.1)
docker network inspect bridge | grep Gateway
# atau
ip addr show docker0
```

Catat subnetnya, misal `172.17.0.0/16`.

Konfigurasi **aktif di VPS** saat ini:

```
listen_addresses = '*'
```

Postgres mendengarkan di semua interface; container Docker menjangkau host
via `host.docker.internal` (di-map ke host-gateway oleh compose).

> **Tidak terekspos ke internet.** Meskipun listen di semua interface,
> UFW memblok port 5432 dari luar — hanya 22/80/443 yang di-allow
> (terverifikasi dari luar server). Lihat [server-hardening.md](server-hardening.md).

Edit `pg_hba.conf` (butuh sudo dari user `ops` untuk membaca/mengubah):

```bash
sudo nano /etc/postgresql/16/main/pg_hba.conf
```

Baris untuk subnet Docker (pola, `172.16.0.0/12` mencakup 172.16.x–172.31.x,
aman untuk berbagai subnet Docker):

```
host    qadfstore    qmarketplace    172.16.0.0/12    scram-sha-256
```

Restart Postgres (jika mengubah konfigurasi):
```bash
sudo systemctl restart postgresql
sudo systemctl enable postgresql
```

Verifikasi Postgres listen (read-only, tanpa sudo):
```bash
ss -tln | grep 5432
# listen di 0.0.0.0:5432 dan [::]:5432 — akses publik diblok UFW
```

## 4. Database staging & production

**Status di VPS saat ini:** hanya database staging yang ada —
`qadfstore` (user `qmarketplace`). Database production **belum dibuat**
(production belum go-live).

Saat production go-live, wajib buat database + user **terpisah** di Postgres
yang sama (jangan share DB dengan staging — data staging bisa menimpa data
production):

```sql
-- Production (saat go-live, nama mengikuti pola staging):
CREATE USER qmarketplace_production WITH PASSWORD 'password-kuat-production';
CREATE DATABASE qadfstore_production OWNER qmarketplace_production;
```

Plus baris `pg_hba.conf` untuk DB production (subnet Docker sama).

Lalu di `deployment/staging/.env` (aktif):
```
PGDB=qadfstore
PGUSER=qmarketplace
DATABASE_URL=postgresql://qmarketplace:<password>@host.docker.internal:5432/qadfstore
```

Di `deployment/production/.env` (saat go-live):
```
PGDB=qadfstore_production
PGUSER=qmarketplace_production
DATABASE_URL=postgresql://qmarketplace_production:<password>@host.docker.internal:5432/qadfstore_production
```

> `DATABASE_URL` adalah **satu-satunya** sumber koneksi yang dipakai compose
> (anchor `x-pg`) dan drizzle-kit. `PGUSER`/`PGPASS`/`PGDB` hanya referensi.
> Kalau ubah credential, cukup update `DATABASE_URL` (URL-encode karakter
> special pada password: `@` → `%40`, `:` → `%3A`, `/` → `%2F`, `#` → `%23`).
