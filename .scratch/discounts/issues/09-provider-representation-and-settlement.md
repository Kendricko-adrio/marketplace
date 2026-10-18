# Kontrak Mapping Provider dan Settlement

Label: wayfinder:grilling
Type: grilling
Status: open
Assignee: none
Blocked by: 08
Parent: [Wayfinder Desain Diskon](../map.md)

## Question

Berdasarkan bukti provider dan kebijakan finance yang dipilih, field/nominal diskon apa tepatnya yang harus dibawa SO, invoice, pembayaran Jubelio, mirrors, dan snapshot lokal?

Putuskan alokasi nominal per baris dibandingkan header discount yang terverifikasi; base unit price dan komponen markdown/kupon/ongkir website yang terpisah; payable provider yang terverifikasi; ledger goods-only dibandingkan ledger ongkir yang diperluas dan terverifikasi; verifikasi ketat per baris/agregat, versi payload, serta penanganan hasil ambigu/mismatch.

## Referensi dan batasan

- Jawaban/artefak wajib dari [Bukti Kontrak Diskon Nonzero Jubelio](08-jubelio-nonzero-discount-evidence.md).
- Konteks finance wajib dari [Perhitungan Pajak dan Subsidi Ongkir](04-tax-and-shipping-subsidy-accounting.md).
- [Rekomendasi mapping provider](../../../plan/research/discounts-coupons-promo-codes.md#d-so--invoice--payment-and-existing-safety-gates).
- [Proposal komponen order immutable](../../../plan/research/discount-database-design.md#8-order-money-compatibility-and-jubelio-mapping).

Potongan barang website harus direpresentasikan sebagai diskon SO. Jangan memilih workaround penurunan unit price dengan diskon nol atau pembayaran provider sebesar gross yang bertentangan dengan keputusan awal. Jangan diam-diam menghapus safety guards atau mengubah semantik pajak/source provider existing.

## Bukti penyelesaian

Mapping field/nominal dan kontrak verifikasi independen yang disetujui pemilik, mencakup contoh scope awal serta state order/provider. Bedakan fakta provider terverifikasi dari pilihan accounting pemilik; dokumentasikan launch gates yang belum selesai secara eksplisit.

## Batas pekerjaan

Claim setelah blocker selesai. Muat `grilling`, `domain-modeling`, `development-workflow`, dan bukti existing. Hanya planning/pemeriksaan kode read-only; tidak ada perubahan kode, provider write, subagent, atau penyelesaian tiket HITL lain.

## Comments

Dipublikasikan setelah proposal map lengkap disetujui. Bukti provider belum melampaui bentuk schema yang terdokumentasi dan observasi zero-discount existing.
