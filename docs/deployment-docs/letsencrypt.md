# Rate-limit Let's Encrypt (Penting!)

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
4. **Container restart berulang** saat Caddy sedang challenge.

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
