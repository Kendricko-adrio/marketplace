# Hardening VPS

> **Status aktual VPS (per 1 Sep 2026)** — bagian ini mendokumentasikan
> konfigurasi yang **sudah berjalan** di server, bukan langkah yang masih
> harus dilakukan. Gunakan sebagai referensi kondisi server saat ini.

Bagian ini menjelaskan model akses VPS: **operational user** terpisah (bukan
root default cloud), hardening SSH, dan fail2ban.

## A. User di VPS

Ada **dua user operasional** di VPS — jangan tertukar perannya:

| User | Grup | Peran |
|------|------|-------|
| **`ops`** | `ops`, `sudo`, `docker` | Pemilik repo (`/home/ops/marketplace`), owner data deployment. Dipakai untuk perintah yang butuh `sudo` (maintenance Postgres, UFW, dll). |
| **`deploy`** | `deploy`, `users`, `ops`, `docker`, `systemd-journal` | User login SSH dari mesin lokal (SSH key), menjalankan build/redeploy Docker, dan pemilik **crontab sweep-reservations**. Home-nya kosong — kerja selalu di `/home/ops/marketplace`. |

Catatan:

- Keduanya masuk grup `docker` → `docker compose` jalan tanpa `sudo`.
- `deploy` masuk grup `ops` (bukan grup `sudo`) → bisa membaca/menulis file
  repo di `/home/ops` via permission grup, tapi **tidak punya sudo**.
  Perintah yang butuh root (mis. baca `pg_hba.conf`, `ufw status`) hanya bisa
  dari user `ops` dengan password sudo.
- Grup `systemd-journal` pada `deploy` → bisa membaca log container via
  `journalctl -t staging-store-1` tanpa `sudo`.
- Beberapa file di repo dimiliki `deploy` (mis. `deployment/common/cron/*`,
  `deployment/staging/docker-compose.yml`) — normal, karena `deploy` yang
  melakukan pull/build di server.

## B. SSH (konfigurasi aktual)

Login SSH memakai **SSH key** (bukan password). File efektif:

- `/etc/ssh/sshd_config.d/60-cloudimg-settings.conf` → `PasswordAuthentication no`
- `PermitRootLogin yes` (default cloud image, belum diubah)
- `MaxAuthTries`, `ClientAliveInterval` → default distro (6 / tidak di-set)
- Port: `22` (default)

Koneksi dari mesin lokal (lihat `~/.ssh/config`):

```
Host remote-server
    HostName 31.97.105.37
    User deploy
    Port 22
    IdentityFile ~/.ssh/remote_server_ed25519
    IdentitiesOnly yes
```

> **Catatan keamanan:** `PermitRootLogin yes` tetap terbuka di server.
> Karena `PasswordAuthentication no`, risiko brute-force root via SSH
> sangat kecil (root hanya bisa masuk bila punya key yang terdaftar), tapi
> best practice tetap `PermitRootLogin no`. Jika suatu saat diubah, jangan
> lupa sesuaikan dokumen ini.

## C. fail2ban (konfigurasi aktual)

fail2ban aktif (`systemctl is-active fail2ban` → `active`). Konfigurasi
efektif di `/etc/fail2ban/jail.local`, blok `[sshd]`:

```
[sshd]
enabled  = true
maxretry = 3
bantime  = 360
findtime = 600
port    = ssh
logpath = %(sshd_log)s
backend = systemd
```

Artinya: IP yang gagal login **3x dalam 10 menit** di-ban **6 menit**
(`bantime = 360`). `PasswordAuthentication no` (key-only) membuat
brute-force password tidak relevan, sehingga bantime pendek ini cukup
praktis untuk menekan noise log.

Cek status (butuh sudo, dari user `ops`):

```bash
sudo fail2ban-client status sshd
```

## D. Unattended upgrades (aktif)

`unattended-upgrades` terpasang dan enabled — patch security OS terpasang
otomatis:

```bash
systemctl is-enabled unattended-upgrades   # → enabled
```

## E. Firewall (UFW)

UFW aktif (`/etc/ufw/ufw.conf` → `ENABLED=yes`). Aturan detail butuh sudo
untuk dibaca (`sudo ufw status verbose` sebagai `ops`), tapi perilaku
terverifikasi dari luar:

- Port terbuka dari internet: **22** (SSH), **80** (HTTP/ACME), **443** (HTTPS).
- **5432 (PostgreSQL) tertutup** dari luar — Postgres hanya dijangkau dari
  host itu sendiri dan dari container Docker via `host.docker.internal`.
  Meskipun PostgreSQL `listen_addresses = '*'`, UFW memblok akses publik.
  Lihat [postgresql.md](postgresql.md).

## F. Verifikasi hardening (read-only)

```bash
# 1. Login SSH pakai key (dari komputer lokal):
ssh remote-server            # atau: ssh deploy@31.97.105.37

# 2. Cek user & grup:
id deploy                    # harus memuat: deploy, ops, docker, systemd-journal
id ops                       # harus memuat: ops, sudo, docker

# 3. Config SSH efektif (butuh sudo):
sudo sshd -T | grep -E "permitrootlogin|passwordauthentication|maxauthtries"

# 4. Status fail2ban (butuh sudo):
sudo fail2ban-client status sshd

# 5. Port yang listen publik:
ss -tlnp | grep -vE "127.0.0.1|::1"

# 6. UFW aktif:
cat /etc/ufw/ufw.conf | grep ENABLED
```

## Ringkasan kebijakan (kondisi saat ini)

| Aspek | Kondisi di VPS |
|-------|----------------|
| Login SSH | user `deploy` + **SSH key** (`PasswordAuthentication no`) |
| User admin/owner | `ops` (sudo + docker), pemilik repo `/home/ops/marketplace` |
| Root login via SSH | `PermitRootLogin yes` (default cloud image — direkomendasikan diubah ke `no`) |
| Brute-force | fail2ban: ban 6 menit setelah 3 gagal dalam 10 menit |
| Docker | `ops` dan `deploy` di grup `docker` (tanpa sudo) |
| Firewall | UFW aktif; hanya 22/80/443 publik; 5432 blok |
| Security patch | auto (unattended-upgrades) |
| Cron sweep | dijalankan oleh crontab user `deploy` |

> Semua perintah deploy sehari-hari (build, migrate, cek log) dijalankan via
> `ssh deploy@31.97.105.37` — perintah yang butuh sudo pakai
> `ssh ops@31.97.105.37`.