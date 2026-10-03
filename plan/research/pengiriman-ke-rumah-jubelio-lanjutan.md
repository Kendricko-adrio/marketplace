# Catatan fitur lanjutan — status pengiriman setelah order selesai

Status: **ditunda; bukan scope MVP dan bukan tiket implementasi/Ready**. Keputusan pemilik pada tinjauan draf [implemented delivery contracts](../../docs/features/home-delivery.md): MVP hanya menangani alur status hingga selesai, tanpa alur baru untuk masalah yang pertama kali dilaporkan setelah order `completed`. Pengamanan sebelum selesai (quote gagal, settlement ambigu, booking timeout, webhook duplikat/out-of-order) tetap mengikuti spec MVP.

## Kasus yang perlu dirancang kelak

- Order mendapat `DELIVERED` terverifikasi lalu menjadi `completed`; keesokan hari provider mengirim `RETURNED` atau `SHIPMENT_ISSUE` untuk AWB yang sama. Apakah perlu kasus tindak lanjut baru tanpa mengubah status order yang sudah selesai?
- Staf memilih selesai manual dengan alasan dan Audit Event karena bukti elektronik macet; setelah itu webhook lama atau laporan masalah baru tiba. Bagaimana membedakan event terlambat dari masalah yang benar-benar baru?
- Tentukan sumber kebenaran, hak akses, audit, komunikasi pelanggan dan kebijakan refund/retur bila masalah pasca-selesai terjadi. Jangan otomatis melakukan refund atau membuka ulang order tanpa keputusan produk terpisah.

Dokumen ini hanya menyimpan pertanyaan untuk masa depan; tidak menambah kriteria kelulusan MVP maupun mengizinkan perubahan operasional sekarang.
