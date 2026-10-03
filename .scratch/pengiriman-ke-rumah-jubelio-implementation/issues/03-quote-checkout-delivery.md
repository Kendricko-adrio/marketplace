# 03 — Pilihan delivery dan quote di checkout

Type: task
Status: Done — main reviewed server-owned quote inputs, separate Shipment credentials/runtime gates, rates-only pricing and stale-selection protection. Unit red→green 4 quote + 7 gateway cases; full serial suite 101 files, 914 passed, 2 skipped. Mock-only E2E 10/10 including address/quantity invalidation, server price change in both summaries, failed/empty quotes and pickup regression. Store/admin typechecks, focused lint and diff check pass. Main corrected test arithmetic/fixtures, Bearer mock boundary, token expiry/APP_ENV/bare-origin gates, stale sidebar pricing and process-cached parcel configuration. No live writes. Delivery order placement remains deliberately gated until ticket 04.
Blocked by: 01, 02
Parent: [map implementasi](../map.md)
Spec: [Approved Ready spec](../approved-spec.md)

## Hasil yang harus bekerja

Customer dapat memilih delivery dari satu cabang, memilih alamat dan layanan yang tersedia berdasarkan quote backend ke Jubelio Shipment, serta melihat asal, subtotal, ongkir `rates` (bukan `final_rates`), PPN delivery atas barang + ongkir, dan total. ETA hanya bila valid. Perubahan alamat/cabang/isi keranjang/kuantitas/harga/layanan membatalkan opsi lama, memuat quote baru dan menahan lanjut/bayar. Quote gagal/tanpa layanan → coba lagi atau beralih ke pickup; tidak memakai tarif lama/nol. Checkout lintas cabang ditolak jelas. Tiket ini adalah preview quote; tiket 04 mengikatnya ke pembuatan order berbayar.

## Acceptance / verify

- Browser/HTTP dengan mock Shipment: layanan tersedia terlihat, quote berubah dan pilihan lama tidak bisa dipakai; layanan hilang harus dipilih ulang; gagal quote tidak memunculkan ongkir 0.
- Fixture barang Rp100.000 + ongkir Rp20.000 + PPN 11% menampilkan PPN Rp13.200 dan total Rp133.200; pickup tetap Rp111.000. Validasi payload dan pemilihan `rates` di tes adapter.
- Jalankan red → green unit/E2E relevan, review UI dan update feature/API docs serta env/deployment jika diperlukan.

## Batas

Belum membuat SO/Midtrans untuk delivery dalam tiket ini. Tidak ada quote ID/TTL atau janji tarif booking sama dengan quote. Ikuti [approved spec](../approved-spec.md).
