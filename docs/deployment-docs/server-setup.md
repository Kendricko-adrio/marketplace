# Server Setup — Prasyarat VPS & Firewall

## Prasyarat VPS

Pastikan VPS Anda memiliki:

- [ ] **OS Linux** (Ubuntu 22.04/24.04 atau Debian 12 direkomendasikan)
- [ ] **Akses SSH** sebagai user dengan sudo
- [ ] **Docker Engine** 20.10+ — install: `curl -fsSL https://get.docker.com | sh`
- [ ] **Docker Compose v2** — sudah bundle dengan Docker Engine modern, cek: `docker compose version`
- [ ] **Git**: `sudo apt install -y git`
- [ ] **PostgreSQL 16** (lihat [postgresql.md](postgresql.md))
- [ ] **RAM minimal 2GB** (build Next.js butuh memori; 4GB lebih aman)
- [ ] **Disk minimal 10GB** (image + uploads + DB)

Cek versi setelah install:
```bash
docker --version          # Docker version 20.10+ ...
docker compose version    # Docker Compose version v2.x.x
git --version
```

> **Urutan rekomendasi:** install Docker dulu → buat operational user + masukkan
> ke grup `docker` (lihat [server-hardening.md](server-hardening.md)) → setup
> Postgres ([postgresql.md](postgresql.md)) → DNS ([dns.md](dns.md)) → firewall
> + hardening → deploy ([deploy.md](deploy.md)).

## Firewall VPS

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
> `localhost` dan interface Docker bridge (lihat `pg_hba.conf` di
> [postgresql.md](postgresql.md)).
