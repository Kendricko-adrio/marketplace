# Bukti Recovery dan Kasus Legacy

Label: wayfinder:grilling
Type: grilling
Status: open
Blocked by: none
Parent: [Recovery Transaksi Jubelio dan Tindak Lanjut Terpadu](../map.md)

## Pertanyaan

Bukti dan state domain apa yang membedakan recovery aman dari write yang hasilnya unresolved, dan bagaimana menangani record legacy/tidak lengkap tanpa mengarang kepastian?

Putuskan semantik bukti dan baseline konservatif, bukan kolom schema secara rinci:

- Bedakan intent yang belum pernah dikirim, operasi yang terbukti tidak diterapkan, kemungkinan diterapkan remote, identitas remote yang diketahui tetapi belum verified, hasil verified, bookkeeping lokal yang belum selesai, dan bukti bisnis yang bertentangan.
- Bedakan penyebab, fase dispatch, tingkat kepastian hasil, kelayakan bisnis, dan authorization; transport error yang retryable saja bukan izin retry.
- Tentukan apa yang dibuktikan dan tidak dibuktikan oleh remote ID; pertahankan verifikasi independen atas identity/linkage/items/money.
- Tentukan bukti minimum yang dapat dipercaya untuk local non-send, kepemilikan dispatch, pencatatan hasil, konfirmasi, repair lokal, dan attempt berikutnya yang diizinkan.
- Tentukan perlakuan aman untuk teks `lastError` lama, ID tidak diketahui, operasi yang tidak tercatat, intent existing, claim stale, konfigurasi belum tersedia, dan linkage order/ledger yang belum lengkap.
- Perjelas batas GET/reconciliation, repair lokal, melanjutkan operasi pertama kali, dan retry; jangan menyiratkan bahwa field kosong membuktikan operasi belum pernah dicoba.
- Putuskan kapan bukti tambahan diperlukan dan kapan kasus tetap ditahan/dieskalasi. Jaminan spesifik provider adalah tanggung jawab research ticket.

## Bukti dan batasan

- [Research: taxonomy dan gap recovery](../../../plan/research/jubelio-transaction-recovery-admin.md#7-current-recovery-gaps-to-account-for).
- [Schema sales ledger](../../../packages/db/src/schema/jubelio-sales.ts), [transisi operasi](../../../apps/store/src/lib/jubelio-sales-operations.ts), [lifecycle](../../../apps/store/src/lib/jubelio-sales-lifecycle.ts), dan [gateway](../../../apps/store/src/lib/jubelio-sales-client.ts).
- [Penerusan recovery settlement dan sweep](../../../apps/store/src/lib/jubelio-sales-settlement.ts).
- [Dokumentasi flow sales](../../../docs/features/jubelio-sales-orders.md).

Status/error text existing belum menyimpan seluruh perbedaan failure. Konfirmasi gateway SO/invoice/payment bisa gagal sebelum ID respons tersimpan secara durable di lifecycle. Ini temuan statis yang perlu direproduksi kemudian; jangan menjanjikan recovery universal dari sweep existing.

## Bukti penyelesaian

Catat tabel state/bukti/batas tindakan beserta edge cases konkret:

1. Queue timeout sebelum business POST dibandingkan network timeout setelah dispatch.
2. ID diterima tetapi confirmation GET gagal dibandingkan tidak ada usable ID yang tersimpan.
3. Ledger row confirmed dengan accounting lokal belum selesai dibandingkan sekadar HTTP 200 dari provider.
4. Legacy manual-review row berisi “timeout” tanpa bukti dispatch/identity.
5. Intent payment existing dengan konfigurasi account tidak valid; koreksi tidak boleh menghapus request lama.
6. Crash setelah claim tanpa remote ID: lamanya waktu tunggu tidak membuktikan transaksi tidak ada.

Catat istilah domain yang benar-benar sudah diputuskan pada glosarium menggunakan `domain-modeling`, tanpa memasukkan detail implementasi. Temuan sumber bukan keputusan pengguna.

## Batas pekerjaan

Baca code/docs lokal dan interview pengguna. Hanya edit planning; tidak ada perubahan schema/data, live queries, provider requests, validation suites, atau delegation. Load skills yang diwajibkan map dan claim sebelum bekerja. Jangan memutuskan permissions atau jaminan provider di sini.

## Komentar

Dipublikasikan pada 2026-10-13 setelah approval pengguna. Dimulai open/unclaimed dan independen dari ticket permission; agent harus memverifikasi fakta sendiri, bukan menanyakannya kepada pengguna.
