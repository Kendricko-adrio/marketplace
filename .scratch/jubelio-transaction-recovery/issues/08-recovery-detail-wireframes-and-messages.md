# Wireframe dan Pesan pada Detail Recovery

Label: wayfinder:prototype
Type: prototype
Status: open
Blocked by: 02, 05, 06, 07
Parent: [Recovery Transaksi Jubelio dan Tindak Lanjut Terpadu](../map.md)

## Pertanyaan

Bagaimana tampilan daftar tindak lanjut bersama dan panel recovery detail order agar operator berizin memahami kendala dan memilih satu tindakan berikutnya yang aman, tanpa mencampur retry, verifikasi, kelanjutan proses, atau fulfillment fisik?

Buat **hanya Markdown wireframes** yang dapat direview, berdasarkan kontrak yang sudah diputuskan:

- Baris daftar bersama: kendala utama, kendala unresolved lainnya, konteks payment/order, langkah berikutnya, dan navigasi detail/back sesuai konteks.
- State detail: proses aktif yang baru dimulai; verifikasi pending dengan ID diketahui; safe retry; kelanjutan operasi pertama kali; repair konfigurasi; hasil belum pasti tanpa identitas; mismatch remote; repair lokal; konflik late-payment/cancel; recovery berhasil.
- Penempatan primary action, wording, dan isi konfirmasi; transaction IDs/history teknis tetap collapsed kecuali dibutuhkan untuk investigasi.
- Staff tanpa capability recovery: guidance blocker/koordinasi yang dapat dipahami, tanpa recovery controls, dan tindakan operasional tetap tersedia hanya jika eligibility existing mengizinkan.
- HQ/custom Role dengan capability sesuai scope: batas read/action jelas berdasarkan Current Policy, bukan nama Role.
- Pesan hasil GET/tindakan dibandingkan guidance langkah berikutnya yang persisten; pekerjaan queued bukan verified success.
- Kegagalan provider/body/read/browser setelah write: tanpa false failure, false success, atau pengaktifan ulang tindakan yang tidak aman.
- Hierarki informasi mobile/desktop, judul dialog yang accessible serta perilaku focus/dismissal, dan UI copy bahasa Indonesia yang ringkas dengan technical terms yang familiar.

## Bukti dan batasan

- [Kasus dan Navigasi Tindak Lanjut Terpadu](02-unified-follow-up-cases-and-navigation.md).
- [Hasil Belum Pasti dan Eskalasi Operator](05-unknown-outcomes-and-operator-escalation.md).
- [Retry Aman dan Kelanjutan Operasi Pertama](06-safe-retry-and-first-time-continuation.md).
- [Koordinasi Recovery Manual dan Sistem](07-manual-and-system-recovery-coordination.md).
- [Proposal UI dan skenario research](../../../plan/research/jubelio-transaction-recovery-admin.md#8-proposed-simplified-admin-experience).
- [Detail existing](../../../apps/admin/src/app/admin/orders/[id]/page.tsx), [halaman follow-up](../../../apps/admin/src/app/admin/orders/follow-up/page.tsx), dan [guided delivery UX](../../../docs/features/admin-delivery-workflow.md).

Jangan diam-diam menambahkan recovery action agar mockup terlihat lengkap. Controls packing/booking/tracking existing tetap mengikuti kontraknya tanpa perubahan. Contoh label/layout research adalah bahan diskusi, bukan copy yang sudah disetujui.

## Bukti penyelesaian

Publikasikan satu asset Markdown wireframe/copy yang ditautkan di direktori `assets/` effort ini. Tampilkan seluruh state yang didukung dan dapatkan acceptance pengguna untuk keseluruhan artifact, bukan hanya default state.

Sertakan walkthrough singkat:

1. HQ memeriksa invoice pickup, lalu memberi approval terpisah untuk langkah payment berikutnya yang eligible.
2. Hasil payment belum pasti tanpa ID: tidak ada tombol retry generik, ada instruksi support/eskalasi yang jelas.
3. Staff cabang melihat settlement blocker tanpa hak recovery dan tetap memiliki workspace operasional yang sesuai.
4. Order failed masih membutuhkan cleanup pembatalan.
5. Recovery berhasil tetapi respons browser hilang: guidance untuk membaca ulang hasil, bukan mengklaim gagal.

Catat keputusan visual/copy yang disetujui pada child ticket dan tautkan artifact; jangan menduplikasi seluruh isinya pada map.

## Batas pekerjaan

Load `prototype`, `frontend-design`, `grilling`, `domain-modeling`, dan `development-workflow`. Claim sebelum bekerja. Hanya Markdown prototype/dokumen planning: tanpa executable UI, perubahan aplikasi/config, package installation, pembuatan branch, commit otomatis, Playwright, provider calls, atau delegation. Executable prototype berikutnya membutuhkan approval terpisah.

## Komentar

Dipublikasikan pada 2026-10-13 setelah approval struktur map. Belum ada wireframe atau copy final yang disetujui.
