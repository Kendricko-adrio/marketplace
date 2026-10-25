# checkout-simplification

Navigasi artefak fitur ini; aturan layout dan lifecycle: [panduan](../README.md).
Status plan hanya dicatat di sini. Status ticket tetap di masing-masing ticket.

## Status plan

| Plan | Status | Features | Notes / Outcome |
|---|---|---|---|
| [Penyederhanaan Checkout: kontak di step pengiriman, hapus step Kontak & panel Ringkasan](plan/checkout-simplification.md) | In Progress | 5 | Complete plan disetujui user ("iya sudah saya setujui, tolong kerjakan"). Fitur 1–5 Done: modal alamat draft+footer melekat, kontak pindah ke step 1 (pickup Telepon+Email, delivery email akun read-only + telepon penerima), indikator 2 langkah, promo hanya di step terakhir, panel Ringkasan dihapus, docs diperbarui. Mock E2E: batch A 36 passed + batch B 38 passed (disposable DB); unit 1662 passed/14 skipped (+97 passed pada DB disposable); types/lint PASS; browser 1440/390 diperiksa. **Outstanding:** spec legacy  (checkout/provisional-stock) belum dijalankan — butuh izin terpisah. Tanpa perubahan API/schema, tanpa commit/push. |

Catatan status dan hasil test di atas dipindahkan dari index lama, bukan verifikasi baru.
Plan Done yang dahulu sudah dihapus tidak direkonstruksi; outcome dan docs tetap tersedia.

## Artefak

### plan

- [plan/checkout-simplification.md](plan/checkout-simplification.md)
