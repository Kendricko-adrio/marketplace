# 01 — Nominal pickup dan regresi lifecycle

Type: task
Status: Done — main-agent red/green pricing + fail-closed E2E seam, mock browser/HTTP pickup lifecycle 2/2, PostgreSQL ledger 9/9 (environment-blocker test skipped), full unit suite, store/admin typechecks and focused store lint verified. Independent read-only review found no P1; both P2 comments/error-shape findings fixed and focused tests rechecked. Delivery remains inactive; no live-provider writes.
Blocked by: none
Parent: [map implementasi](../map.md)
Spec: [Approved Ready spec](../approved-spec.md)

## Hasil yang harus bekerja

Customer tetap dapat membuat dan membayar pickup. Website/Midtrans menagih barang + PPN website (diskon dan ongkir 0); satu Sales Order Jubelio, invoice dan pembayaran Jubelio hanya bernilai barang dengan diskon/pajak SO 0. Pickup code dan informasi siap ambil baru ada sesudah pembayaran Midtrans **dan** settlement SO/invoice/payment terverifikasi. Admin Home Branch dapat memverifikasi kode sekali tanpa mengubah batas sesi store/admin. Jangan mengubah dasar PPN pickup; siapkan pricing agar tiket delivery dapat menerapkan PPN atas barang + ongkir tanpa meregresikan pickup. Tidak ada fitur diskon nonzero.

## Acceptance / verify

- Fixture independen barang Rp100.000, PPN 11%: Midtrans/order Rp111.000; SO/invoice/payment Jubelio Rp100.000, pajak SO 0. Ketidakcocokan nominal SO/invoice/payment menahan fulfillment, bukan menerbitkan kode.
- Browser/HTTP pickup sampai serah-terima dan kasus belum settlement; tes adapter nominal dan DB-backed ledger yang relevan. Jalankan unit dan E2E relevan; tes red sebelum implementasi dan review regresi.
- Dokumentasikan kontrak nominal pickup dan pembulatan PPN di feature/API docs yang terdampak. Jangan menyatakan delivery aktif dalam tiket ini.

## Batas

Mengikuti [approved spec](../approved-spec.md), termasuk pengamanan provider yang sudah ada; tidak membuat jalur inventory adjustment atau SO tambahan. Status Done hanya setelah verifikasi oleh main agent.
