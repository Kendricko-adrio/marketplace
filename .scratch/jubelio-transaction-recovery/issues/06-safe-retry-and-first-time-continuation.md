# Retry Aman dan Kelanjutan Operasi Pertama

Label: wayfinder:grilling
Type: grilling
Status: open
Blocked by: 01, 03, 05
Parent: [Recovery Transaksi Jubelio dan Tindak Lanjut Terpadu](../map.md)

## Pertanyaan

Pada operasi dan state bukti apa admin berizin boleh mengirim attempt baru atau melanjutkan operasi yang belum pernah dikirim, dan bagaimana approval mencegah transaksi ganda atau pengaktifan ulang order yang tidak semestinya?

Putuskan kontrak tindakan write:

- Operasi SO create, invoice, payment, dan cancel mana yang mengizinkan retry; bedakan local never-sent failure, penolakan definitive yang authoritative, repair konfigurasi, dan hasil belum pasti.
- Prasyarat setiap tindakan: status pembayaran pelanggan, SO aktif/canceled, prerequisite invoice, cancel aktif, snapshot goods/request yang immutable, lifecycle order, dan kepemilikan/bukti operasi sebelumnya.
- Perbedaan retry request yang sudah dicatat dengan pengiriman operasi berikutnya yang terbukti belum pernah dicoba.
- Cara menggunakan input konfigurasi/request yang diperbaiki tanpa menghapus bukti intent/dispatch awal atau diam-diam mengubah data komersial.
- Konfirmasi terpisah untuk provider writes, termasuk penjelasan jelas bahwa pencatatan payment Jubelio berbeda dari charge pelanggan di Midtrans.
- Perlakuan checkout failed/expired/rejected: jangan mengaktifkan kembali hold yang sudah dilepas atau menggunakan pricing/stock stale melalui tombol retry; identifikasi tindakan cleanup yang mungkin tetap eligible.
- Konsekuensi langsung ketika retry baru juga ambigu: cabut kelayakan replay dan kembali ke pemeriksaan/eskalasi.
- Pertahankan attempt history yang monotonic dan dispatch dengan satu pemenang tanpa menentukan detail implementasi/schema.

## Bukti dan batasan

- [Research: taxonomy, gap, dan contoh safe retry](../../../plan/research/jubelio-transaction-recovery-admin.md#5-proposed-error-taxonomy).
- [Permission Recovery dan Kewenangan Cabang](01-recovery-permissions-and-branch-authority.md).
- [Bukti Recovery dan Kasus Legacy](03-recovery-evidence-and-legacy-cases.md).
- [Bukti Keamanan Retry dari Provider](04-provider-retry-safety-evidence.md), melalui prasyarat eskalasi.
- [Hasil Belum Pasti dan Eskalasi Operator](05-unknown-outcomes-and-operator-escalation.md).
- [Penolakan create existing](../../../apps/store/src/app/api/checkout/place-order/route.ts), [claim gate](../../../apps/store/src/lib/jubelio-sales-operations.ts), dan [lifecycle invoice/payment](../../../apps/store/src/lib/jubelio-sales-lifecycle.ts).

Sales ledger existing belum memiliki authorization replay umum. `readOnlyRecovery` tidak melakukan POST untuk operasi yang tidak tercatat. Metadata kosong bukan bukti belum pernah dikirim. Jangan mereset operasi lama yang sudah dispatched menjadi `intent` untuk menyembunyikan history.

## Bukti penyelesaian

Catat tabel eligibility/konfirmasi/hasil per operasi yang disetujui pengguna, beserta walkthrough:

1. `QUEUE_FULL` sebelum POST invoice, lalu satu attempt baru yang diizinkan.
2. Invoice berhasil direcovery; payment terbukti belum pernah dispatched: perlu approval kelanjutan terpisah.
3. Payment account tidak valid diperbaiki: syarat bukti dan snapshot koreksi.
4. Provider rejection tanpa jaminan non-application yang jelas: tidak mengklaim safe retry.
5. Retry baru timeout: tidak langsung melakukan POST lagi.
6. Checkout lokal gagal setelah SO definitively rejected: batas re-checkout/cleanup, bukan revival order oleh admin.

Jaminan yang dijanjikan tidak boleh melampaui bukti research provider. Catat pengecualian konservatif bila diperlukan.

## Batas pekerjaan

Baca sumber lokal dan lakukan keputusan HITL; hanya edit planning. Claim terlebih dahulu dan load skills yang diwajibkan map. Tidak ada reset operasi/state, migrations, provider writes, tests, perubahan aplikasi, atau delegation. Koordinasi/backoff dan UX final berada pada child tickets masing-masing.

## Komentar

Dipublikasikan pada 2026-10-13 setelah approval map lengkap; tetap open/unclaimed dan belum ada kebijakan retry yang dipilih.
