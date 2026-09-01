# Log Deployment

Container `store`, `admin`, `caddy`, dan service pendukung mengirim stdout/stderr
ke logging driver Docker `journald`. Log mengikuti konfigurasi systemd journal
yang sudah ada di VPS: retensi maksimum 7 hari, kompresi aktif, dan batas disk
1 GB. Deployment **tidak** memasang drop-in atau mengubah konfigurasi journald
host.

Aplikasi store dan admin menulis log backend sebagai satu objek JSON per baris.
Detail format dan field tersedia di
[`../features/logging.md`](../features/logging.md).

## Verifikasi konfigurasi host

Periksa konfigurasi efektif tanpa mengubahnya:

```bash
systemd-analyze cat-config systemd/journald.conf \
  | grep -E '^[[:space:]]*(Storage|Compress|MaxRetentionSec|SystemMaxUse|SystemKeepFree)='
journalctl --disk-usage
```

Konfigurasi VPS saat dokumentasi ini ditulis menghasilkan:

```text
SystemMaxUse=1G
MaxRetentionSec=7day
Compress=yes
```

Retensi aktual dapat lebih pendek ketika batas disk tercapai. Perubahan
kebijakan journald merupakan operasi host terpisah dan bukan bagian dari deploy
aplikasi.

## Terapkan logging driver

Buat ulang container agar logging driver `journald` pada Compose diterapkan:

```bash
cd deployment/staging
docker compose -p staging --env-file .env up -d --build --force-recreate
```

Untuk production, jalankan command yang sama dari `deployment/production`
dengan project `-p production`.

Verifikasi driver pada container:

```bash
docker inspect -f '{{.HostConfig.LogConfig.Type}}' staging-store-1
docker inspect -f '{{.HostConfig.LogConfig.Type}}' staging-admin-1
```

Keduanya harus menghasilkan `journald`.

## Membaca log

Tag journal menggunakan nama container Compose, misalnya
`staging-store-1` dan `staging-admin-1`.

```bash
# Ikuti log store secara real-time
journalctl -f -t staging-store-1

# Log admin sejak hari ini
journalctl -t staging-admin-1 --since today

# Log seluruh container staging selama 24 jam terakhir
journalctl --since "24 hours ago" \
  -t staging-store-1 \
  -t staging-admin-1 \
  -t staging-caddy-1 \
  -t staging-jubelio-mock-1

# Export log store dalam jendela retensi host
journalctl -t staging-store-1 --since "7 days ago" -o json \
  > staging-store.jsonl
```

`docker compose logs` tetap dapat digunakan untuk pemeriksaan biasa:

```bash
docker compose -p staging --env-file .env logs -f store admin
```

Jangan membaca atau memodifikasi file internal di `/var/log/journal/` secara
langsung; gunakan `journalctl` untuk query dan export.

## Pemeriksaan retensi

```bash
journalctl --disk-usage
journalctl --since "7 days ago" -t staging-store-1 --no-pager
```

Dokumentasi ini sengaja tidak menyertakan command `systemctl restart
systemd-journald`, pemasangan file `/etc/systemd/journald.conf.d/*`, atau
`journalctl --vacuum-*` karena deploy aplikasi harus mempertahankan kebijakan
journald VPS yang sudah ada.
