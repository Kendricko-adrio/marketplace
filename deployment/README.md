# Panduan Deployment Staging — Marketplace

Panduan step-by-step untuk men-deploy aplikasi marketplace (store + admin)
ke VPS menggunakan Docker. PostgreSQL berjalan **bare-metal di VPS**
(tanpa Docker), Caddy sebagai reverse proxy dengan auto-HTTPS.

---

## Daftar Isi

1. [Arsitektur Singkat](#1-arsitektur-singkat)
2. [Prasyarat VPS](#2-prasyarat-vps)
3. [Setup PostgreSQL (bare-metal)](#3-setup-postgresql-bare-metal)
4. [Konfigurasi DNS](#4-konfigurasi-dns)
5. [Konfigurasi Google OAuth](#5-konfigurasi-google-oauth)
6. [Konfigurasi Midtrans Sandbox](#6-konfigurasi-midtrans-sandbox)
7. [Firewall VPS](#7-firewall-vps)
7.5. [Hardening VPS (Wajib Sebelum Deploy)](#75-hardening-vps-wajib-sebelum-deploy)
8. [Deploy Aplikasi](#8-deploy-aplikasi)
9. [Verifikasi Deployment](#9-verifikasi-deployment)
10. [Operasional Sehari-hari](#10-operasional-sehari-hari)
11. [Rate-limit Let's Encrypt (Penting!)](#11-rate-limit-lets-encrypt-penting)
12. [Troubleshooting](#12-troubleshooting)
12.5. [Memisahkan Environment Staging & Production](#125-memisahkan-environment-staging--production)
13. [Referensi Cepat](#13-referensi-cepat)

---

## 1. Arsitektur Singkat

```
         Internet (HTTPS)
              │
       ┌──────┴──────┐
       │   Caddy      │  auto-HTTPS (Let's Encrypt PRODUCTION)
       │  :80 / :443  │
       └──┬───────┬───┘
   dev-store   dev-admin
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

  [one-shot] migrate container → drizzle-kit migrate + seed
```

**Komponen:**

| Service | Fungsi | Port expose |
|---------|--------|-------------|
| `store` | Storefront Next.js (customer-facing) | internal 3000 (via Caddy) |
| `admin` | Admin dashboard Next.js | internal 3001 (via Caddy) |
| `caddy` | Reverse proxy + auto-HTTPS | 80, 443 (public) |
| `migrate` | One-shot: jalankan DB migration + seed | — (profile `tools`) |
| Postgres | Database (bare-metal) | 5432 (hanya dari Docker bridge) |

---

## 2. Prasyarat VPS

Pastikan VPS Anda memiliki:

- [ ] **OS Linux** (Ubuntu 22.04/24.04 atau Debian 12 direkomendasikan)
- [ ] **Akses SSH** sebagai user dengan sudo
- [ ] **Docker Engine** 20.10+ — install: `curl -fsSL https://get.docker.com | sh`
- [ ] **Docker Compose v2** — sudah bundle dengan Docker Engine modern, cek: `docker compose version`
- [ ] **Git**: `sudo apt install -y git`
- [ ] **PostgreSQL 16** (lihat bagian berikutnya)
- [ ] **RAM minimal 2GB** (build Next.js butuh memori; 4GB lebih aman)
- [ ] **Disk minimal 10GB** (image + uploads + DB)

Cek versi setelah install:
```bash
docker --version          # Docker version 20.10+ ...
docker compose version    # Docker Compose version v2.x.x
git --version
```

> **Urutan rekomendasi:** install Docker dulu (bab 2) → buat operational
> user + masukkan ke grup `docker` (bab 7.5.A) → setup Postgres (bab 3)
> → DNS (bab 4) → firewall + hardening (bab 7 & 7.5) → deploy (bab 8).

---

## 3. Setup PostgreSQL (bare-metal)

Postgres **tidak** dijalankan di Docker — diinstall langsung di VPS agar
mudah di-maintain, backup, dan tune.

> **Tiga "user" berbeda yang terlibat — jangan tertukar:**
>
> | Nama | Siapa | Peran di panduan ini |
> |------|-------|----------------------|
> | **`ops`** | User Linux Anda (login SSH) | Menjalankan semua perintah `sudo` di bawah. Dibuat di bab 7.5.A. |
> | **`postgres`** | Superuser bawaan Postgres (system account, BUKAN user login SSH) | Dipakai hanya untuk menjalankan `psql` saat setup awal: `sudo -u postgres psql`. Tidak untuk aplikasi. |
> | **`marketplace`** | User database untuk aplikasi (dibuat di 3.2) | Yang dipakai aplikasi di `DATABASE_URL`. Bukan superuser. |
>
> **Jawaban singkat:** Install Postgres **tidak butuh login root**, tapi
> butuh **hak root via sudo**. User `ops` yang sudah diberi sudo (bab
> 7.5.A) bisa melakukan semua langkah di bawah. Perintah `sudo` = eksekusi
> sebagai root sementara. Tidak perlu `su -` ke root.

> Perintah di bawah dijalankan sebagai `ops` (login via `ssh ops@IP_VPS`).

### 3.1 Install PostgreSQL 16

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

### 3.2 Buat database + user untuk aplikasi

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

### 3.3 Konfigurasi Postgres untuk menerima koneksi dari Docker

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

---

## 4. Konfigurasi DNS

Di DNS provider Anda (tempat `adfsport.cloud` dikelola), buat **A record**:

| Name | Type | Value |
|------|------|-------|
| `dev-store` | A | `<IP-PUBLIK-VPS>` |
| `dev-admin` | A | `<IP-PUBLIK-VPS>` |

Verifikasi propagasi DNS (bisa butuh beberapa menit–jam):
```bash
dig dev-store.adfsport.cloud +short
dig dev-admin.adfsport.cloud +short
# harus return IP VPS Anda
```

> **Wajib:** DNS sudah resolve sebelum Caddy minta sertifikat. Kalau DNS
> belum resolve saat Caddy start, Let's Encrypt akan gagal validasi.

---

## 5. Konfigurasi Google OAuth

1. Buka [Google Cloud Console](https://console.cloud.google.com/) → project Anda.
2. **API & Services → Credentials**.
3. Buat atau edit **OAuth 2.0 Client ID** (tipe: Web application).
4. Di **Authorized redirect URIs**, tambahkan:
   ```
   https://dev-store.adfsport.cloud/api/auth/callback/google
   ```
5. Copy **Client ID** dan **Client Secret** → masukkan ke `.env.staging`:
   ```
   GOOGLE_CLIENT_ID=xxxxxxxx.apps.googleusercontent.com
   GOOGLE_CLIENT_SECRET=xxxxxxxx
   ```

> Sertifikat HTTPS masih staging (browser warning) saat testing pertama,
> tapi redirect URI tetap pakai `https://` — Google tidak peduli CA-nya
> saat validasi redirect URI, hanya domain + path yang dicek.

---

## 6. Konfigurasi Midtrans Sandbox

1. Buka [Midtrans Sandbox Dashboard](https://dashboard.sandbox.midtrans.com/).
2. **Settings → Configuration**.
3. Di **Payment Notification URL**, isi:
   ```
   https://dev-store.adfsport.cloud/api/webhooks/midtrans
   ```
4. **Settings → Access Keys** → copy **Server Key** dan **Client Key** →
   masukkan ke `.env.staging`:
   ```
   MIDTRANS_SERVER_KEY=SB-Mid-server-xxxxxxxx
   MIDTRANS_CLIENT_KEY=SB-Mid-client-xxxxxxxx
   MIDTRANS_IS_PRODUCTION=false
   ```

---

## 7. Firewall VPS

Hanya buka port yang perlu. **JANGAN** buka 5432 ke publik.

**Menggunakan ufw (Ubuntu/Debian):**
```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow 22/tcp          # SSH (ganti kalau SSH pakai port lain)
sudo ufw allow 80/tcp          # HTTP (Caddy + Let's Encrypt challenge)
sudo ufw allow 443/tcp         # HTTPS
sudo ufw allow 443/udp         # HTTP/3 (QUIC)
sudo ufw enable
sudo ufw status verbose
```

> Port 5432 **tidak** di-allow di ufw — Postgres hanya bisa diakses dari
> `localhost` dan interface Docker bridge (lihat `pg_hba.conf`).

---

## 7.5 Hardening VPS (Wajib Sebelum Deploy)

Bagian ini menjelaskan pembuatan **operational user** terpisah (bukan root,
bukan `ubuntu`/`debian` default) + hardening SSH. Tujuannya:

- **Root adalah target utama brute-force** — login root via SSH harus
  dinonaktifkan.
- **Nama user default image cloud** (`ubuntu`, `debian`, `admin`, `root`)
  sudah dikenal bot → brute-force 24/7. Nama custom mengurangi noise log
  drastis dan menambah satu lapis kesulitan.
- **Principle of least privilege** — user biasa + sudo untuk hal admin.
- **Docker tanpa sudo** — user operational masuk grup `docker` supaya
  `docker compose` jalan langsung (menjalankan Docker sebagai root = risiko
  container escape lebih tinggi).

> Lakukan langkah ini **sebelum** clone repo / deploy aplikasi. Semua
> perintah dijalankan via SSH sebagai user awal (root atau `ubuntu`).

### A. Buat operational user

Ganti `ops` dengan nama pilihan Anda (contoh: `marketplace`, `deployer`,
`kelvin`, dsb. — hindari nama generic yang sudah dikenal bot).

```bash
# 1. Buat user dengan home dir + bash shell
sudo adduser ops
# Isi password KUAT (acak 20+ char, simpan di password manager).
# Karena Anda akan login pakai password (bukan SSH key), password WAJIB
# kuat — ini lapis utama pertahanan terhadap brute-force.
# Field lainnya (Full name, room, phone) bisa di-Enter kosongkan.

# 2. Beri akses sudo (supaya bisa jalankan perintah admin jika perlu)
sudo usermod -aG sudo ops

# 3. Masukkan ke grup docker (supaya docker compose jalan tanpa sudo)
#    Catatan: grup docker MUNGKIN belum ada sebelum Docker diinstall.
#    Kalau error "group docker does not exist", install Docker dulu
#    (lihat bab 2), lalu jalankan baris ini.
sudo usermod -aG docker ops

# 4. Verifikasi
id ops
# Output harus menampilkan grup: ops, sudo, docker
```

### B. (Opsional) Setup SSH key login untuk operational user

> Anda memilih **login pakai password** untuk user `ops`. Langkah SSH key
> ini **opsional** — skip kalau tidak mau pakai key.
>
> SSH key tetap lebih aman daripada password (tidak bisa brute-force), jadi
> kalau di masa depan mau upgrade, jalankan langkah ini.

Dari **komputer Anda lokal** (bukan di VPS), salin public key:

```bash
# Di komputer lokal — kalau belum punya key, generate dulu:
ssh-keygen -t ed25519 -C "ops@marketplace-staging"

# Salin key ke VPS (ganti IP_VPS):
ssh-copy-id -i ~/.ssh/id_ed25519.pub ops@IP_VPS
# Atau manual: copy isi ~/.ssh/id_ed25519.pub, paste ke
# /home/ops/.ssh/authorized_keys di VPS (pastikan permission 600).
```

Test login pakai key (dari komputer lokal):
```bash
ssh ops@IP_VPS
# Harus login tanpa prompt password (pakai key).
```

> **Simpan private key aman** — jangan commit ke repo, simpan di luar
> folder project. Kalau hilang, buat key baru + update authorized_keys.

### C. Hardening SSH

> **Anda login pakai password** — jadi kita TIDAK mematikan
> `PasswordAuthentication`. Kompensasinya: fail2ban harus lebih agresif
> (lihat bab D) + password harus KUAT (20+ karakter acak).
>
> Risiko login password: brute-force. Mitigasi: fail2ban ban cepat +
> MaxAuthTries rendah + password kuat. Untuk staging dengan VPS yang
> sudah hardened ini cukup; untuk production pertimbangkan SSH key.

Edit config SSH server:
```bash
sudo nano /etc/ssh/sshd_config
```

Ubah / tambah baris berikut:
```
# === Hardening ===
# 1. Larang login root via SSH (wajib pakai user biasa + sudo)
PermitRootLogin no

# 2. Login password DIIZINKAN (pilihan Anda)
#    PasswordAuthentication tetap "yes" (default).
#    Jangan set "no" kalau belum setup SSH key (bab B) — Anda terkunci.
PasswordAuthentication yes

# 3. Batasi percobaan login (mitigasi brute-force — penting saat pakai password)
MaxAuthTries 3

# 4. Timeout idle session (5 menit)
ClientAliveInterval 300
ClientAliveCountMax 0

# 5. (Opsional) Ganti port SSH dari 22 ke port custom (misal 22022)
#    Mengurangi noise scan bot drastis. Kalau diganti:
#    - update firewall: sudo ufw allow 22022/tcp (BUKAN 22)
#    - update ufw rule lama: sudo ufw delete allow 22/tcp
#    - saat SSH dari lokal: ssh -p 22022 ops@IP_VPS
# Port 22022
```

Restart SSH:
```bash
sudo systemctl restart ssh
```

Test login dari komputer lokal (buka terminal baru, jangan tutup sesi saat ini):
```bash
ssh ops@IP_VPS
# Input password yang Anda buat di bab 7.5.A.
```

> **PERINGATAN KRITIS:** Sebelum menutup sesi SSH saat ini, **buka sesi SSH
> baru di terminal lain** dan test login `ssh ops@IP_VPS` dengan password.
> Kalau gagal, kembalikan config dari sesi yang masih terbuka. Jangan tutup
> sesi SSH aktif sampai konfirmasi login baru berhasil — kalau tidak, Anda
> bisa terkunci keluar VPS dan harus pakai console vendor (DigitalOcean/
> Vultr/AWS web console) untuk recovery.

### D. Pasang fail2ban (mitigasi brute-force otomatis — WAJIB saat pakai password)

fail2ban mem-blok IP yang gagal login berulang kali (otomatis ban via
firewall setelah N percobaan gagal). **Karena Anda login pakai password
(bukan SSH key), fail2ban wajib dipasang dan dikonfigurasi agresif** —
ini lapis pertahan utama terhadap brute-force password.

```bash
sudo apt update
sudo apt install -y fail2ban

# Copy config default ke local override (jangan edit jail.conf langsung):
sudo cp /etc/fail2ban/jail.conf /etc/fail2ban/jail.local
sudo nano /etc/fail2ban/jail.local
```

Cari blok `[sshd]` dan set agresif (karena pakai password, kita ban cepat).
**PENTING:** fail2ban **tidak mendukung inline comment** (tanda `#` setelah
nilai). Komentar harus di baris sendiri yang diawali `#` — kalau ditulis
inline, `#` ikut jadi bagian nilai dan parsing gagal (warning
`Wrong value for 'maxretry'`, value jadi `None`).

```
# === SSH brute-force protection ===
# ban setelah 3 percobaan gagal dalam 10 menit, durasi ban 1 jam.
# Naikkan bantime ke 86400 (1 hari) kalau mau lebih agresif.
[sshd]
enabled  = true
maxretry = 3
bantime  = 3600
findtime = 600
```

> Kombinasi `MaxAuthTries 3` di sshd_config + `maxretry = 3` di fail2ban
> = IP yang gagal 3x dalam 10 menit di-ban 1 jam. Brute-force jadi tidak
> praktis (butuh ribuan jam untuk menebak password kuat).

Restart:
```bash
sudo systemctl restart fail2ban
sudo systemctl enable fail2ban
sudo fail2ban-client status sshd
```

Cek IP yang kena ban (nanti, setelah VPS live beberapa jam):
```bash
sudo fail2ban-client status sshd
# Lihat bagian "Banned IP list" — biasanya ada beberapa bot yang coba brute-force.
```

> **Kalau Anda sendiri kena ban** (lupa password, salah ketik berulang):
> ```bash
> # Dari sesi SSH lain yang masih login, atau via console vendor:
> sudo fail2ban-client set sshd unbanip IP-ANDA
> ```

### E. Auto-update security (opsional tapi direkomendasikan)

Supaya patch security OS otomatis terpasang:
```bash
sudo apt install -y unattended-upgrades
sudo dpkg-reconfigure -plow unattended-upgrades
# Pilih "Yes" untuk auto-install security updates.
```

### F. Matikan service yang tidak perlu

Cek service yang listen di publik:
```bash
sudo ss -tlnp | grep -v 127.0.0.1
```

Hanya yang seharusnya publik: `22` (atau port SSH custom), `80`, `443`,
`5432` (hanya di Docker bridge, bukan 0.0.0.0). Kalau ada service lain
yang listen di `0.0.0.0:PORT` dan tidak dikenali → matikan atau pakai
firewall untuk block.

### G. Verifikasi hardening

```bash
# 1. Login root harus GAGAL (dari komputer lokal):
ssh root@IP_VPS
# Expected: "Permission denied (publickey)." atau koneksi ditolak.

# 2. Login password user ops harus SUKSES:
ssh ops@IP_VPS
# Input password yang Anda buat di bab 7.5.A.
# Expected: login sukses.

# 3. Cek status fail2ban:
sudo fail2ban-client status sshd
# Expected: "Status" + "Banned IP list" (awalnya kosong).

# 4. Cek port yang terbuka publik:
sudo ufw status numbered
# Hanya: 22 (atau custom), 80, 443.
```

### Ringkasan kebijakan setelah hardening

| Aspek | Sebelum | Sesudah |
|-------|---------|---------|
| Login SSH | root + password | user `ops` + password kuat |
| Root login | diizinkan | **dilarang** (`PermitRootLogin no`) |
| Password login | diizinkan | **diizinkan** (pilihan Anda, dengan fail2ban agresif) |
| Brute-force | tidak ada proteksi | fail2ban ban 1 jam setelah 3 gagal |
| Docker | jalan sebagai root | user `ops` di grup `docker` (tanpa sudo) |
| Security patch | manual | auto (unattended-upgrades) |

> **Setelah hardening**, semua perintah deploy di bab 8 dst. dijalankan
> sebagai user `ops` (login via `ssh ops@IP_VPS`), bukan root/ubuntu.
>
> **Catatan keamanan:** login password + fail2ban cukup untuk staging.
> Untuk production nanti, pertimbangkan upgrade ke SSH key (bab 7.5.B)
> dan set `PasswordAuthentication no` — SSH key tidak bisa brute-force.

---

## 8. Deploy Aplikasi

> Login sebagai operational user (lihat bab 7.5): `ssh ops@IP_VPS`.
> Semua perintah di bawah dijalankan sebagai user `ops`, bukan root.

### 8.1 Clone repo + siapkan env

```bash
cd ~
git clone <url-repo-anda> marketplace
cd marketplace
```

Salin template env dan isi secret:
```bash
cp deployment/.env.staging.example .env.staging
nano .env.staging
```

Isi semua nilai kosong:
- `PGUSER` / `PGPASS` / `PGDB` → sesuai yang dibuat di bagian 3.2
- `BETTER_AUTH_SECRET` → generate dengan `openssl rand -base64 32`
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` → dari bagian 5
- `SMTP_USER` / `SMTP_PASS` / `SMTP_FROM` → Gmail + App Password
- `MIDTRANS_*` → dari bagian 6

Generate `BETTER_AUTH_SECRET`:
```bash
openssl rand -base64 32
```

> **Penting:** `BETTER_AUTH_SECRET` harus **identik** untuk store dan admin
> (sudah diatur otomatis di docker-compose.yml — keduanya pakai nilai dari
> `.env.staging`). Kalau beda, handshake verify-pickup antara admin dan
> store akan gagal dengan 403.

### 8.2 Build + start container

```bash
docker compose --env-file .env.staging up -d --build
```

Proses ini:
- Build image `store` dan `admin` dari source (butuh 3–8 menit pertama kali).
- Start Caddy, store, admin.
- Caddy akan minta sertifikat ke Let's Encrypt **PRODUCTION** (lihat log).
  Sertifikat valid dan dipercaya browser — tidak ada warning.

Pantau proses:
```bash
docker compose --env-file .env.staging logs -f
# tekan Ctrl+C untuk keluar dari log stream (container tetap jalan)
```

### 8.3 Jalankan database migration + seed

**Sekali saja** saat deploy pertama (atau ulang kalau ada migration baru):
```bash
docker compose --env-file .env.staging --profile tools run --rm migrate
```

Ini akan:
1. `npx drizzle-kit migrate` — apply migration SQL ke Postgres.
2. `npx tsx src/seed.ts` — isi data sample (admin users, products, dll).

Output yang diharapkan:
```
🌱 Seeding database...
🗑️  Clearing existing data...
👤 Creating admin users...
...
✅ Seeding complete!
```

> **Catatan:** Seed akan **menghapus data lama** dulu (lihat `packages/db/src/seed.ts`).
> Jangan run seed di production tanpa backup. Untuk staging aman.

### 8.4 Cek status container

```bash
docker compose --env-file .env.staging ps
```

Semua harus `Up`:
```
NAME                   STATUS         PORTS
marketplace-caddy      Up             0.0.0.0:80->80/tcp, 0.0.0.0:443->443/tcp
marketplace-store      Up (healthy)   3000/tcp
marketplace-admin      Up (healthy)   3001/tcp
```

---

## 9. Verifikasi Deployment

### 9.1 Cek HTTPS

Buka di browser:
- `https://dev-store.adfsport.cloud` → homepage storefront
  - Sertifikat valid (Let's Encrypt production) — **tidak ada warning**.
- `https://dev-admin.adfsport.cloud` → redirect ke `/login`

> Kalau muncul warning sertifikat, berarti Caddy belum selesai minta
> sertifikat (lihat log: `docker compose --env-file .env.staging logs caddy`,
> cari `certificate obtained successfully`) atau DNS/firewall bermasalah
> (lihat bab 12).

### 9.2 Test alur aplikasi

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

### 9.3 Cek log kalau ada masalah

```bash
# Semua service
docker compose --env-file .env.staging logs -f

# Service tertentu
docker compose --env-file .env.staging logs -f store
docker compose --env-file .env.staging logs -f admin
docker compose --env-file .env.staging logs -f caddy

# Container migrate (sudah exit)
docker compose --env-file .env.staging --profile tools logs migrate
```

---

## 10. Operasional Sehari-hari

### Re-deploy setelah ada update code

```bash
cd ~/marketplace
git pull
docker compose --env-file .env.staging up -d --build
```

Layer cache Docker membuat rebuild cepat (hanya yang berubah).

### Run migration baru saja (tanpa seed)

Kalau ada migration baru (file SQL baru di `packages/db/drizzle/`):
```bash
docker compose --env-file .env.staging --profile tools run --rm migrate npx drizzle-kit migrate
```

### Run seed ulang (hati-hati — hapus semua data!)

```bash
docker compose --env-file .env.staging --profile tools run --rm migrate npx tsx src/seed.ts
```

### Stop semua container

```bash
docker compose --env-file .env.staging down
```

### Stop + hapus volume (HATI-HATI — hapus uploads + sertifikat!)

```bash
docker compose --env-file .env.staging down -v
```

### Lihat status + resource usage

```bash
docker compose --env-file .env.staging ps
docker stats marketplace-store marketplace-admin marketplace-caddy
```

### Backup database (Postgres bare-metal)

```bash
pg_dump -U marketplace -h localhost storefront > storefront-backup-$(date +%Y%m%d).sql
```
(jalankan via SSH di VPS, bukan dari dalam container)

---

## 11. Rate-limit Let's Encrypt (Penting!)

Karena Anda langsung pakai Let's Encrypt **production**, ada batas yang
harus dipahami:

| Batas | Nilai |
|-------|-------|
| Failed validation per hostname | 5 per jam |
| Certificates per registered domain | 50 per minggu |
| Duplicate certificate (sertifikat sama untuk domain yang sama) | 5 per minggu |
| Pending authorization retries | 3 per jam |

**Penyebab gagal validasi yang paling sering:**
1. **DNS belum resolve** ke IP VPS saat Caddy minta sertifikat.
2. **Port 80 ke-block** firewall — Let's Encrypt butuh port 80 untuk
   HTTP-01 challenge.
3. **Typo domain** di Caddyfile.
4. **Container restart berulang** saat Caddy sedang_challenge.

**Mitigasi (sebelum start pertama):**
- [ ] DNS `dev-store.adfsport.cloud` dan `dev-admin.adfsport.cloud` sudah
      resolve ke IP VPS — cek: `dig <domain> +short`.
- [ ] Port 80 & 443 terbuka di firewall: `sudo ufw status`.
- [ ] Caddyfile tidak ada typo domain.
- [ ] VPS bisa keluar ke internet: `curl -I https://acme-v02.api.letsencrypt.org/directory`.

**Kalau kena rate-limit:**
- Tunggu 1 jam (untuk reset failed validation) atau 1 minggu (duplicate cert).
- Sementara itu, jangan restart Caddy berkali-kali (memperburuk).
- Alternatif: pakai DNS-01 challenge (lebih kompleks, butuh API DNS provider)
  yang tidak butuh port 80 — di luar scope panduan ini.

> **Tip kalau ingin experimen berulang tanpa takut rate-limit:**
> Tambahkan sementara `acme_ca https://acme-staging-v02.api.letsencrypt.org/directory`
> di blok global Caddyfile. Sertifikat staging tidak dipercaya browser
> (warning), tapi bebas gagal. Setelah verified, hapus baris itu dan
> restart Caddy untuk dapat sertifikat production.

---

## 12. Troubleshooting

### Browser: `ERR_CONNECTION_REFUSED`
- Caddy tidak jalan atau port 80/443 ke-block firewall.
- `docker compose ps` — caddy harus `Up`.
- `sudo ufw status` — 80/tcp dan 443/tcp harus `ALLOW`.

### Browser: sertifikat warning (`ERR_CERT_AUTHORITY_INVALID`)
- Caddy belum selesai minta sertifikat → tunggu + cek log:
  `docker compose --env-file .env.staging logs caddy`, cari
  `certificate obtained successfully`.
- Kalau log menunjukkan gagal validasi → lihat "Caddy gagal minta sertifikat"
  di bawah.
- Kalau kena rate-limit Let's Encrypt → lihat bab 11. Sementara itu, browser
  bisa klik "Proceed anyway" untuk test, atau pakai staging CA sementara.

### Store/admin: `500 Internal Server Error` atau blank page
- Cek log: `docker compose --env-file .env.staging logs store`
- Kemungkinan: `DATABASE_URL` salah, Postgres tidak reachable dari container.
- Test dari dalam container:
  ```bash
  docker compose --env-file .env.staging exec store sh -c "wget -qO- http://host.docker.internal:5432 || echo 'unreachable (expected for HTTP on PG port)'"
  ```
- Cek Postgres listen di gateway Docker: `sudo ss -tlnp | grep 5432`.
- Cek `pg_hba.conf` mengizinkan subnet Docker.

### Login admin gagal / verify-pickup error 403
- `BETTER_AUTH_SECRET` beda antara store dan admin.
  Cek: `docker compose --env-file .env.staging config | grep BETTER_AUTH_SECRET`
  → harus identik di store dan admin.
- `STORE_INTERNAL_URL` di admin salah → harus `http://store:3000`
  (nama service di compose).

### Email verifikasi tidak sampai
- Cek `SMTP_USER` / `SMTP_PASS` benar (Gmail App Password, bukan password biasa).
- Cek log store: `docker compose --env-file .env.staging logs store | grep -i smtp`.
- Cek folder Spam di email penerima.
- Kalau pakai Gmail, pastikan 2-Step Verification aktif + App Password valid.

### Google login: `redirect_uri_mismatch`
- Redirect URI di Google Console belum / salah.
  Harus persis: `https://dev-store.adfsport.cloud/api/auth/callback/google`.
- Setelah edit di Google Console, butuh beberapa menit propagasi.

### Upload gambar dari admin tidak muncul di store
- Volume `uploads` tidak termount di salah satu container.
  Cek: `docker compose --env-file .env.staging exec store ls /app/uploads`
  dan `... exec admin ls /app/uploads` → harus ada file yang sama.
- `UPLOADS_DIR` tidak set → cek env: `... exec store env | grep UPLOADS_DIR`
  → harus `/app/uploads`.

### Caddy gagal minta sertifikat
- Cek log: `docker compose --env-file .env.staging logs caddy`
- Penyebab umum:
  1. DNS belum resolve ke IP VPS → `dig dev-store.adfsport.cloud +short`
     harus return IP VPS.
  2. Port 80 ke-block firewall → Caddy butuh port 80 untuk HTTP-01 challenge.
     `sudo ufw status` → 80/tcp harus `ALLOW`.
  3. VPS tidak bisa keluar ke internet:
     `curl -I https://acme-v02.api.letsencrypt.org/directory` harus 200.
  4. Rate-limit → lihat bab 11. Tunggu 1 jam, lalu retry.
     Kalau mau experimen bebas rate-limit, tambahkan sementara
     `acme_ca https://acme-staging-v02.api.letsencrypt.org/directory`
     di blok global Caddyfile.

### Migration gagal: `relation already exists` atau `database is up to date`
- `relation already exists` → schema sudah ada (mungkin dari `db:push` sebelumnya).
  Jalankan hanya seed: `... run --rm migrate npx tsx src/seed.ts`.
- `database is up to date` → tidak ada migration baru, aman. Jalankan seed saja.

### `docker compose` error: `no such service: migrate`
- Anda lupa flag `--profile tools`. Migrate hanya muncul dengan profile itu.
- Benar: `docker compose --env-file .env.staging --profile tools run --rm migrate`.

### Rebuild tidak mengambil perubahan env `NEXT_PUBLIC_*`
- `NEXT_PUBLIC_*` di-inline saat **build time**. Restart container tidak cukup.
- Wajib: `docker compose --env-file .env.staging up -d --build`
  (flag `--build` rebuild image).

### Tidak bisa SSH ke VPS setelah hardening
- **Skenario 1: lupa password user `ops`** — recovery: pakai **web
  console** vendor VPS (DigitalOcean/Vultr/AWS/GCP punya console akses
  langsung ke VM tanpa SSH) → login sebagai root di console (console
  vendor tidak terkena `PermitRootLogin no` karena bukan via SSH) →
  `passwd ops` untuk reset password → SSH lagi.
- **Skenario 2: terkunci karena enable `PasswordAuthentication no`
  tanpa setup SSH key** (kalau di masa depan Anda enable itu):
  - Recovery via web console vendor → login root → kembalikan
    `PasswordAuthentication yes` di `/etc/ssh/sshd_config` →
    `systemctl restart ssh` → SSH lagi, setup key dengan benar (bab
    7.5.B), baru hardening ulang.
- **Skenario 3: kena ban fail2ban** (gagal login 3x):
  - Dari IP berbeda yang masih bisa SSH, atau via web console:
    `sudo fail2ban-client set sshd unbanip IP-ANDA`.
  - Atau tunggu 1 jam (ban expiry).
- **Skenario 4: `PermitRootLogin no` + root tidak punya password/key**:
  pakai single-user mode / recovery mode vendor untuk masuk.

### `docker: permission denied while trying to connect to the Docker daemon`
- User Anda tidak masuk grup `docker`.
- Fix: `sudo usermod -aG docker $USER`, lalu **logout + login lagi** (grup
  baru baru aktif setelah login baru). Atau `newgrp docker` di shell saat ini.

---

---

## 12.5 Memisahkan Environment Staging & Production

> Panduan ini menjelaskan beberapa strategi agar environment staging dan
> production **terpisah** — baik container, network, maupun tag/label. Tujuan
> akhirnya: saat jalankan `docker container ls`, hanya container staging yang
> aktif (atau mudah difilter) saat Anda hanya ingin deploy staging dulu.

### A. Mengapa perlu pemisahan?

- **Kebocoran data** — staging dan production sering pakai data berbeda (DB
  berbeda, secret berbeda, upload berbeda). Bila bercampur, test di staging
  bisa menulis ke DB production.
- **Isolasi resource** — restart/rebuild staging tidak boleh ganggu
  production.
- **Kemudahan operasional** — saat login ke VPS, `docker compose ps` /
  `docker container ls` harus jelas menunjukkan environment mana yang aktif.
- **Rollback aman** — kalau staging rusak, production tetap jalan.

### B. Strategi 1: Compose project name berbeda (REKOMENDASI, paling simpel)

Docker Compose otomatis men-generate nama container dari **project name**.
Default-nya = nama folder, tapi bisa di-override dengan flag `-p`.

**Struktur file:**
```
deployment/
├── docker-compose.yml            # file utama (dipakai staging & production)
├── .env.staging                  # env staging
├── .env.staging.example
├── .env.production               # env production
└── .env.production.example
```

**Deploy staging saja:**
```bash
# -p staging = nama project jadi "staging"
# Container otomatis: staging-caddy-1, staging-store-1, staging-admin-1
docker compose -p staging --env-file .env.staging up -d --build

# Cek container staging
docker compose -p staging --env-file .env.staging ps
docker container ls --filter "name=staging-"
```

**Deploy production (nanti, terpisah):**
```bash
docker compose -p production --env-file .env.production up -d --build

docker compose -p production --env-file .env.production ps
docker container ls --filter "name=production-"
```

> **Hasil:** container staging mendapat prefix `staging-`, container
> production mendapat prefix `production-`. Saat `docker container ls` tanpa
> filter, kedua-duanya muncul — tapi Anda bisa **filter berdasarkan prefix
> nama** untuk lihat hanya satu environment.

**Lihat hanya staging:**
```bash
docker container ls --filter "name=staging-"
# atau pakai compose ps
docker compose -p staging --env-file .env.staging ps
```

**Stop hanya staging (production tetap jalan):**
```bash
docker compose -p staging --env-file .env.staging down
```

> **Catatan penting tentang volume:** Nama volume juga dapat prefix project.
> Volume `uploads` di staging → `staging_uploads`, di production →
> `production_uploads`. **Ini otomatis mengisolasi file upload staging vs
> production** — file staging tidak bercampur dengan file production. Same
> untuk volume Caddy state (`caddy_data`, `caddy_config`) — sertifikat
> staging dan production terpisah.

### C. Strategi 2: Label + filter (untuk tampilan `docker container ls` bersih)

Kalau mau `docker container ls` bisa difilter berdasarkan environment dengan
**label eksplisit** (bukan hanya prefix nama):

Tambah label di `docker-compose.yml`:
```yaml
services:
  caddy:
    # ... config lainnya
    labels:
      - "app=marketplace"
      - "env=staging"        # ← ubah ke "production" untuk env prod

  store:
    labels:
      - "app=marketplace"
      - "env=staging"

  admin:
    labels:
      - "app=marketplace"
      - "env=staging"
```

> Kalau pakai satu file compose untuk dua env, pakai variable substitution:
> ```yaml
> labels:
>   - "env=${DEPLOY_ENV:-staging}"
> ```
> Lalu: `DEPLOY_ENV=staging docker compose ...` atau define di masing-masing
> `.env.staging` / `.env.production`.

**Filter berdasarkan label:**
```bash
# Lihat hanya container staging
docker container ls --filter "label=env=staging"

# Lihat hanya production
docker container ls --filter "label=env=production"

# Alias untuk mempermudah (tambahkan ke ~/.bashrc):
alias dstaging='docker container ls --filter "label=env=staging"'
alias dprod='docker container ls --filter "label=env=production"'
```

**Hapus semua container staging (production aman):**
```bash
docker container rm $(docker container ls -q --filter "label=env=staging")
# atau lebih aman via compose project name
```

> Strategi 1 (project name) + Strategi 2 (label) **bisa digabung** untuk
> hasil terbaik: prefix nama untuk isolasi volume + label untuk filter cepat.

### D. Strategi 3: File compose terpisah (paling eksplisit)

Kalau dua env punya perbedaan signifikan (domain, port, config Caddy, secret),
buat dua file compose:

```
deployment/
├── docker-compose.staging.yml
├── docker-compose.production.yml
├── .env.staging
└── .env.production
```

**Deploy staging:**
```bash
docker compose -f docker-compose.staging.yml --env-file .env.staging up -d --build
docker compose -f docker-compose.staging.yml --env-file .env.staging ps
```

**Deploy production:**
```bash
docker compose -f docker-compose.production.yml --env-file .env.production up -d --build
```

> Plus: gunakan flag `-p` juga untuk eksplisit (walau default sudah pakai
> nama file):
> ```bash
> docker compose -p staging -f docker-compose.staging.yml --env-file .env.staging up -d
> docker compose -p production -f docker-compose.production.yml --env-file .env.production up -d
> ```

Keuntungan file terpisah:
- Bisa beda domain, port mapping, volume, bahkan image tag tanpa konflik.
- Diff antar env jelas (git diff antar dua file).
- Tidak ada risiko salah baca `.env` karena file compose env-spesifik
  mereferensi `.env.staging` / `.env.production`.

### E. Strategi 4: Docker Context / host terpisah (isolasi penuh)

Untuk isolasi **sebenarnya** (satu `docker container ls` hanya tampil satu
env tanpa filter), pakai Docker Context = daemon/host berbeda:

**Skenario A — dua VPS terpisah (staging & production beda mesin):**
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

**Skenario B — satu VPS, dua Docker daemon (advanced, jarang dipakai):**
Jalankan dua `dockerd` instance di port socket berbeda, lalu buat context
per daemon. Overhead tinggi, jarang dibutuhkan — strategi 1–3 biasanya cukup.

### F. Rekomendasi untuk kasus "deploy staging dulu"

| Prioritas | Strategi | Alasan |
|-----------|----------|--------|
| **Paling simpel** | 1 (project name `-p staging`) | Tanpa edit file, langsung jalan. Volume + container otomatis terpisah via prefix. |
| **Filter bersih** | 1 + 2 (project name + label) | `docker container ls --filter "label=env=staging"` jelas dan eksplisit. |
| **Env sangat beda** | 3 (file compose terpisah) | Saat staging & production punya domain/port/config beda total. |
| **Isolasi penuh** | 4 (VPS terpisah) | Saat staging & production di mesin berbeda (best practice production). |

> **Untuk sekarang** (deploy staging saja dulu di satu VPS): strategi 1
> cukup. Jalankan:
> ```bash
> docker compose -p staging --env-file .env.staging up -d --build
> ```
> Container yang muncul: `staging-caddy-1`, `staging-store-1`,
> `staging-admin-1`. Production belum ada — aman dari `docker container ls`.

### G. Hal yang perlu berbeda antar staging & production

Saat kedua env berjalan, pastikan **semua** ini berbeda (tidak share):

| Item | Staging | Production | Cara isolasi |
|------|---------|------------|--------------|
| Database | DB `storefront_staging` | DB `storefront_production` | Buat dua database di Postgres, set di `.env.*` |
| DB user (opsional) | `marketplace_staging` | `marketplace_production` | Buat dua user di Postgres |
| `DATABASE_URL` | beda DB name/user | beda DB name/user | `.env.staging` vs `.env.production` |
| `BETTER_AUTH_SECRET` | secret A | secret B (beda) | Generate terpisah: `openssl rand -base64 32` |
| Google OAuth redirect | `dev-store.adfsport.cloud` | `store.adfsport.cloud` | Daftar dua client ID di Google Console |
| Midtrans | Sandbox key (`MIDTRANS_IS_PRODUCTION=false`) | Production key (`true`) | `.env.*` |
| Domain (Caddy) | `dev-store`, `dev-admin` | `store`, `admin` | Dua Caddyfile / dua blok |
| Upload volume | `staging_uploads` | `production_uploads` | Otomatis via `-p` |
| Caddy state | `staging_caddy_data` | `production_caddy_data` | Otomatis via `-p` (sertifikat terpisah) |
| SMTP | Bisa pakai Gmail App Password sama | Pertimbangkan provider khusus | `.env.*` |

> **PENTING:** dua env di **satu VPS yang sama** membagi Postgres bare-metal.
> Wajib buat dua database terpisah (`storefront_staging` +
> `storefront_production`) + dua user (atau satu user dengan akses ke dua
> DB) di Postgres. Jangan pakai satu DB yang sama — data staging akan
> menimpa data production.

### H. Setup Postgres untuk dua database

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

Lalu di `.env.staging`:
```
PGDB=storefront_staging
PGUSER=marketplace_staging
PGPASS=password-kuat-staging
DATABASE_URL=postgresql://marketplace_staging:password-kuat-staging@host.docker.internal:5432/storefront_staging
```

Di `.env.production`:
```
PGDB=storefront_production
PGUSER=marketplace_production
PGPASS=password-kuat-production
DATABASE_URL=postgresql://marketplace_production:password-kuat-production@host.docker.internal:5432/storefront_production
```

### I. Workflow deploy staging dulu, production nanti

**1. Deploy staging (sekarang):**
```bash
cd ~/marketplace
cp deployment/.env.staging.example .env.staging
nano .env.staging                  # isi secret staging

docker compose -p staging --env-file .env.staging up -d --build

# Migration + seed (staging)
docker compose -p staging --env-file .env.staging --profile tools run --rm migrate

# Cek
docker container ls --filter "name=staging-"
```

**2. Verifikasi staging jalan:**
```bash
docker compose -p staging --env-file .env.staging ps
# Semua Up → lanjut test di browser
```

**3. Nanti, deploy production (terpisah, setelah staging verified):**
```bash
cp deployment/.env.production.example .env.production
nano .env.production               # isi secret production

docker compose -p production --env-file .env.production up -d --build

# Migration production (HATI-HATI: jangan run seed di production!)
docker compose -p production --env-file .env.production --profile tools run --rm migrate npx drizzle-kit migrate

# Cek
docker container ls --filter "name=production-"
```

**4. Sehari-hari, kelola masing-masing env:**
```bash
# Staging
docker compose -p staging --env-file .env.staging logs -f
docker compose -p staging --env-file .env.staging down
docker compose -p staging --env-file .env.staging up -d --build

# Production
docker compose -p production --env-file .env.production logs -f
docker compose -p production --env-file .env.production down
docker compose -p production --env-file .env.production up -d --build
```

### J. Ringkasan command cheat-sheet (multi-env)

```bash
# === STAGING ===
docker compose -p staging --env-file .env.staging up -d --build
docker compose -p staging --env-file .env.staging ps
docker compose -p staging --env-file .env.staging logs -f
docker compose -p staging --env-file .env.staging --profile tools run --rm migrate
docker compose -p staging --env-file .env.staging down

# === PRODUCTION ===
docker compose -p production --env-file .env.production up -d --build
docker compose -p production --env-file .env.production ps
docker compose -p production --env-file .env.production logs -f
docker compose -p production --env-file .env.production --profile tools run --rm migrate npx drizzle-kit migrate
docker compose -p production --env-file .env.production down

# === FILTER CONTAINER ===
docker container ls --filter "name=staging-"
docker container ls --filter "name=production-"
docker container ls --filter "label=env=staging"
docker container ls --filter "label=env=production"

# === Lihat SEMUA container (staging + production, keduanya muncul) ===
docker container ls
# Ini wajar di satu VPS dengan dua env — pakai filter di atas untuk pisah.
```

> **Kesimpulan:** dengan `-p staging`, container staging otomatis terpisah
> dari production (prefix nama + volume + network terpisah). Untuk benar-benar
> hanya staging yang muncul di `docker container ls` tanpa filter, gunakan
> **Docker Context** dengan VPS terpisah (strategi 4). Di satu daemon/VPS,
> filter (`--filter "name=staging-"` atau `--filter "label=env=staging"`)
> adalah cara standar untuk melihat hanya satu environment.

---

## 13. Referensi Cepat

### File yang diedit untuk deployment (di repo)

| File | Perubahan |
|------|-----------|
| `apps/store/next.config.ts` | Tambah `output: "standalone"` + `images.unoptimized: true` |
| `apps/admin/next.config.ts` | Tambah `output: "standalone"` |
| `.dockerignore` (root) | Baru — exclude node_modules, .next, .env, dll |
| `deployment/` (folder baru) | Semua config deployment |

### Struktur folder `deployment/`

```
deployment/
├── docker-compose.yml            # orkestrasi semua service (dipakai staging & production)
├── .env.staging.example          # template env staging (di-commit)
├── .env.staging                  # env staging asli (anda isi, JANGAN commit)
├── .env.production.example       # template env production (di-commit)
├── .env.production               # env production asli (anda isi, JANGAN commit)
├── .gitignore                    # ignore .env.staging + .env.production + caddy state
├── README.md                     # file ini
├── store/Dockerfile              # image storefront
├── admin/Dockerfile              # image admin
├── migrate/Dockerfile            # image one-shot migration + seed
└── caddy/Caddyfile               # reverse proxy + auto-HTTPS
```

### Command cheat-sheet

> Panduan ini pakai konvensi `-p staging` (lihat bab 12.5 untuk strategi
> multi-env lengkap). Ganti `staging` → `production` untuk env production.

```bash
# SSH ke VPS (sebagai operational user, bukan root)
ssh ops@IP_VPS
# atau kalau SSH pakai port custom:
ssh -p 22022 ops@IP_VPS

# Deploy / re-deploy (staging)
docker compose -p staging --env-file .env.staging up -d --build

# Migration + seed (one-shot, staging)
docker compose -p staging --env-file .env.staging --profile tools run --rm migrate

# Migration saja (tanpa seed)
docker compose -p staging --env-file .env.staging --profile tools run --rm migrate npx drizzle-kit migrate

# Seed saja
docker compose -p staging --env-file .env.staging --profile tools run --rm migrate npx tsx src/seed.ts

# Lihat log
docker compose -p staging --env-file .env.staging logs -f
docker compose -p staging --env-file .env.staging logs -f caddy
docker compose -p staging --env-file .env.staging logs -f store
docker compose -p staging --env-file .env.staging logs -f admin

# Status container
docker compose -p staging --env-file .env.staging ps
# atau filter global
docker container ls --filter "name=staging-"

# Stop
docker compose -p staging --env-file .env.staging down

# Stop + hapus volume (HATI-HATI)
docker compose -p staging --env-file .env.staging down -v

# Restart satu service
docker compose -p staging --env-file .env.staging restart caddy

# === PRODUCTION (ganti prefix + env file) ===
docker compose -p production --env-file .env.production up -d --build
docker compose -p production --env-file .env.production --profile tools run --rm migrate npx drizzle-kit migrate
docker compose -p production --env-file .env.production logs -f
docker compose -p production --env-file .env.production ps
docker compose -p production --env-file .env.production down
```

> Lihat bab 12.5 untuk strategi multi-environment lengkap (project name,
> label, file compose terpisah, Docker Context).

### Port yang dipakai

| Port | Pemakaian | Akses |
|------|-----------|-------|
| 22 | SSH | publik (atau restricted IP) |
| 80 | HTTP (Caddy, redirect ke HTTPS + ACME challenge) | publik |
| 443 | HTTPS (Caddy) | publik |
| 5432 | PostgreSQL | **hanya localhost + Docker bridge** |
| 3000 | store (internal) | hanya via Caddy |
| 3001 | admin (internal) | hanya via Caddy |

### Domain

| Domain | Service |
|--------|---------|
| `dev-store.adfsport.cloud` | store (customer-facing) |
| `dev-admin.adfsport.cloud` | admin (dashboard) |