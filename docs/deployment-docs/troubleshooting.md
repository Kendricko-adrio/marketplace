# Troubleshooting

Semua contoh command pakai staging. Ganti `-p staging --env-file .env` dengan
`-p production --env-file .env` (di folder `deployment/production`) untuk
production.

## Browser: `ERR_CONNECTION_REFUSED`
- Caddy tidak jalan atau port 80/443 ke-block firewall.
- `docker compose -p staging --env-file .env ps` — caddy harus `Up`.
- `sudo ufw status` — 80/tcp dan 443/tcp harus `ALLOW`.

## Browser: sertifikat warning (`ERR_CERT_AUTHORITY_INVALID`)
- Caddy belum selesai minta sertifikat → tunggu + cek log:
  `docker compose -p staging --env-file .env logs caddy`, cari
  `certificate obtained successfully`.
- Kalau log menunjukkan gagal validasi → lihat "Caddy gagal minta sertifikat"
  di bawah.
- Kalau kena rate-limit Let's Encrypt → lihat [letsencrypt.md](letsencrypt.md).
  Sementara itu, browser bisa klik "Proceed anyway" untuk test, atau pakai
  staging CA sementara.

## Store/admin: `500 Internal Server Error` atau blank page
- Cek log: `docker compose -p staging --env-file .env logs store`
- Kemungkinan: `DATABASE_URL` salah, Postgres tidak reachable dari container.
- Test dari dalam container:
  ```bash
  docker compose -p staging --env-file .env exec store sh -c "wget -qO- http://host.docker.internal:5432 || echo 'unreachable (expected for HTTP on PG port)'"
  ```
- Cek Postgres listen di gateway Docker: `sudo ss -tlnp | grep 5432`.
- Cek `pg_hba.conf` mengizinkan subnet Docker.

## Checkout gagal / error Midtrans
- `MIDTRANS_IS_PRODUCTION` tidak match dengan tipe key yang dipakai
  (sandbox key + flag `true`, atau live key + flag `false`).
  Cek: `docker compose -p staging --env-file .env exec store env | grep MIDTRANS`
- Key harus dari dashboard yang benar: sandbox key (`SB-Mid-server-...`) untuk
  staging, live key (`Mid-server-...`) untuk production. Lihat [midtrans.md](midtrans.md).

## Login admin gagal / verify-pickup error 403
- `BETTER_AUTH_SECRET` beda antara store dan admin.
  Cek: `docker compose -p staging --env-file .env config | grep BETTER_AUTH_SECRET`
  → harus identik di store dan admin.
- `STORE_INTERNAL_URL` di admin salah → harus `http://store:3000`
  (nama service di compose).

## Email verifikasi tidak sampai
- Cek `SMTP_USER` / `SMTP_PASS` benar (Gmail App Password, bukan password biasa).
- Cek log store: `docker compose -p staging --env-file .env logs store | grep -i smtp`.
- Cek folder Spam di email penerima.
- Kalau pakai Gmail, pastikan 2-Step Verification aktif + App Password valid.

## Google login: `redirect_uri_mismatch`
- Redirect URI di Google Console belum / salah.
  Harus persis: `https://dev-store.adfsport.cloud/api/auth/callback/google`.
- Setelah edit di Google Console, butuh beberapa menit propagasi.

## Upload gambar dari admin tidak muncul di store
- Volume `uploads` tidak termount di salah satu container.
  Cek: `docker compose -p staging --env-file .env exec store ls /app/uploads`
  dan `... exec admin ls /app/uploads` → harus ada file yang sama.
- `UPLOADS_DIR` tidak set → cek env: `... exec store env | grep UPLOADS_DIR`
  → harus `/app/uploads`.

## Caddy gagal minta sertifikat
- Cek log: `docker compose -p staging --env-file .env logs caddy`
- Penyebab umum:
  1. DNS belum resolve ke IP VPS → `dig dev-store.adfsport.cloud +short`
     harus return IP VPS.
  2. Port 80 ke-block firewall → Caddy butuh port 80 untuk HTTP-01 challenge.
     `sudo ufw status` → 80/tcp harus `ALLOW`.
  3. VPS tidak bisa keluar ke internet:
     `curl -I https://acme-v02.api.letsencrypt.org/directory` harus 200.
  4. Rate-limit → lihat [letsencrypt.md](letsencrypt.md). Tunggu 1 jam, lalu
     retry. Kalau mau experimen bebas rate-limit, tambahkan sementara
     `acme_ca https://acme-staging-v02.api.letsencrypt.org/directory`
     di blok global Caddyfile.

## Migration gagal: `relation already exists` atau `database is up to date`
- `relation already exists` → schema sudah ada (mungkin dari `db:push` sebelumnya,
  atau `migrate` sudah jalan sekali). Jalankan hanya seed (staging):
  `... run --rm migrate npx tsx src/seed.ts`. Lihat tabel lengkap di [deploy.md](deploy.md).
- `database is up to date` → tidak ada migration baru, aman. Jalankan seed saja
  (staging) atau tidak perlu apa-apa (production).
- `No migrations found` → migration files tidak ter-copy ke image. Pastikan
  file `packages/db/drizzle/*.sql` sudah di-commit: `git ls-files packages/db/drizzle/`.

## `docker compose` error: `no such service: migrate`
- Anda lupa flag `--profile tools`. Migrate hanya muncul dengan profile itu.
- Benar: `docker compose -p staging --env-file .env --profile tools run --rm migrate`.

## Rebuild tidak mengambil perubahan env `NEXT_PUBLIC_*`
- `NEXT_PUBLIC_*` di-inline saat **build time**. Restart container tidak cukup.
- Wajib: `docker compose -p staging --env-file .env up -d --build`
  (flag `--build` rebuild image).

## Tidak bisa SSH ke VPS setelah hardening
- **Skenario 1: lupa password user `ops`** — recovery: pakai **web
  console** vendor VPS (DigitalOcean/Vultr/AWS/GCP punya console akses
  langsung ke VM tanpa SSH) → login sebagai root di console (console
  vendor tidak melalui SSH, jadi tidak terpengaruh konfigurasi sshd) →
  `passwd ops` untuk reset password → SSH lagi.
- **Skenario 2: kehilangan SSH key** — server memakai
  `PasswordAuthentication no` (login key-only), jadi tanpa key tidak bisa
  masuk:
  - Recovery via web console vendor → login root → tambahkan key baru ke
    `/home/deploy/.ssh/authorized_keys` (atau sementara set
    `PasswordAuthentication yes` di `/etc/ssh/sshd_config.d/`) →
    `systemctl restart ssh` → SSH lagi, lalu matikan password auth
    setelah key baru berfungsi (lihat
    [server-hardening.md](server-hardening.md)).
- **Skenario 3: kena ban fail2ban** (gagal login 3x):
  - Dari IP berbeda yang masih bisa SSH, atau via web console:
    `sudo fail2ban-client set sshd unbanip IP-ANDA`.
  - Atau tunggu 1 jam (ban expiry).
- **Skenario 4: jika suatu saat `PermitRootLogin no` diterapkan** dan root
  tidak punya password/key:
  pakai single-user mode / recovery mode vendor untuk masuk.
  (Saat ini `PermitRootLogin` masih `yes` — default cloud image.)

## `docker: permission denied while trying to connect to the Docker daemon`
- User Anda tidak masuk grup `docker`.
- Fix: `sudo usermod -aG docker $USER`, lalu **logout + login lagi** (grup
  baru baru aktif setelah login baru). Atau `newgrp docker` di shell saat ini.
