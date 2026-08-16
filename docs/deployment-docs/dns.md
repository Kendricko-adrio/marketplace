# Konfigurasi DNS

Di DNS provider Anda (tempat `adfsport.cloud` dikelola), buat **A record**:

| Name | Type | Value |
|------|------|-------|
| `dev-store` | A | `<IP-PUBLIK-VPS>` |
| `dev-admin` | A | `<IP-PUBLIK-VPS>` |

Untuk production nanti, tambahkan juga:

| Name | Type | Value |
|------|------|-------|
| `store` | A | `<IP-PUBLIK-VPS>` |
| `admin` | A | `<IP-PUBLIK-VPS>` |

Verifikasi propagasi DNS (bisa butuh beberapa menit–jam):
```bash
dig dev-store.adfsport.cloud +short
dig dev-admin.adfsport.cloud +short
# harus return IP VPS Anda
```

> **Wajib:** DNS sudah resolve sebelum Caddy minta sertifikat. Kalau DNS
> belum resolve saat Caddy start, Let's Encrypt akan gagal validasi.
> Lihat [letsencrypt.md](letsencrypt.md).
