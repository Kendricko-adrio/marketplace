# Hardening VPS (Wajib Sebelum Deploy)

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

## A. Buat operational user

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
#    (lihat server-setup.md), lalu jalankan baris ini.
sudo usermod -aG docker ops

# 4. Verifikasi
id ops
# Output harus menampilkan grup: ops, sudo, docker
```

## B. (Opsional) Setup SSH key login untuk operational user

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

## C. Hardening SSH

> **Anda login pakai password** — jadi kita TIDAK mematikan
> `PasswordAuthentication`. Kompensasinya: fail2ban harus lebih agresif
> (lihat bagian D) + password harus KUAT (20+ karakter acak).
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
#    Jangan set "no" kalau belum setup SSH key (bagian B) — Anda terkunci.
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
# Input password yang Anda buat di bagian A.
```

> **PERINGATAN KRITIS:** Sebelum menutup sesi SSH saat ini, **buka sesi SSH
> baru di terminal lain** dan test login `ssh ops@IP_VPS` dengan password.
> Kalau gagal, kembalikan config dari sesi yang masih terbuka. Jangan tutup
> sesi SSH aktif sampai konfirmasi login baru berhasil — kalau tidak, Anda
> bisa terkunci keluar VPS dan harus pakai console vendor (DigitalOcean/
> Vultr/AWS web console) untuk recovery.

## D. Pasang fail2ban (mitigasi brute-force otomatis — WAJIB saat pakai password)

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

## E. Auto-update security (opsional tapi direkomendasikan)

Supaya patch security OS otomatis terpasang:
```bash
sudo apt install -y unattended-upgrades
sudo dpkg-reconfigure -plow unattended-upgrades
# Pilih "Yes" untuk auto-install security updates.
```

## F. Matikan service yang tidak perlu

Cek service yang listen di publik:
```bash
sudo ss -tlnp | grep -v 127.0.0.1
```

Hanya yang seharusnya publik: `22` (atau port SSH custom), `80`, `443`,
`5432` (hanya di Docker bridge, bukan 0.0.0.0). Kalau ada service lain
yang listen di `0.0.0.0:PORT` dan tidak dikenali → matikan atau pakai
firewall untuk block.

## G. Verifikasi hardening

```bash
# 1. Login root harus GAGAL (dari komputer lokal):
ssh root@IP_VPS
# Expected: "Permission denied (publickey)." atau koneksi ditolak.

# 2. Login password user ops harus SUKSES:
ssh ops@IP_VPS
# Input password yang Anda buat di bagian A.
# Expected: login sukses.

# 3. Cek status fail2ban:
sudo fail2ban-client status sshd
# Expected: "Status" + "Banned IP list" (awalnya kosong).

# 4. Cek port yang terbuka publik:
sudo ufw status numbered
# Hanya: 22 (atau custom), 80, 443.
```

## Ringkasan kebijakan setelah hardening

| Aspek | Sebelum | Sesudah |
|-------|---------|---------|
| Login SSH | root + password | user `ops` + password kuat |
| Root login | diizinkan | **dilarang** (`PermitRootLogin no`) |
| Password login | diizinkan | **diizinkan** (pilihan Anda, dengan fail2ban agresif) |
| Brute-force | tidak ada proteksi | fail2ban ban 1 jam setelah 3 gagal |
| Docker | jalan sebagai root | user `ops` di grup `docker` (tanpa sudo) |
| Security patch | manual | auto (unattended-upgrades) |

> **Setelah hardening**, semua perintah deploy dijalankan sebagai user `ops`
> (login via `ssh ops@IP_VPS`), bukan root/ubuntu.
>
> **Catatan keamanan:** login password + fail2ban cukup untuk staging.
> Untuk production nanti, pertimbangkan upgrade ke SSH key (bagian B)
> dan set `PasswordAuthentication no` — SSH key tidak bisa brute-force.
