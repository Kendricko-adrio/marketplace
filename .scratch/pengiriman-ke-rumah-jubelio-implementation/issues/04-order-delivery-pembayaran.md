# 04 — Order delivery, pembayaran dan gerbang settlement

Type: task
Status: Done — main verified immutable snapshot vs address deletion/master/config drift, order-time reprice approval before SO/Snap, goods-only SO/invoice/payment versus full Snap money, and delivery paid/processing with no pickup code. Full serial unit 102 files, 923 passed, 2 skipped; mock E2E 13/13; store/admin typechecks, focused lint, db:check and diff check pass. Migration 0029 generated/reviewed/applied via db:push. Main restored the three-step review flow, fixed fixtures/async response probes, added destination display and removed pickup instructions from delivery detail. No booking or live provider writes.
Blocked by: 01, 02, 03
Parent: [map implementasi](../map.md)
Spec: [Approved Ready spec](../approved-spec.md)

## Hasil yang harus bekerja

Pada Buat pesanan backend memvalidasi ulang alamat, stok, barang, harga, layanan dan `rates`. Jika total berubah tampilkan angka baru dan minta klik kedua; layanan hilang dipilih ulang. Hanya setelah disetujui, persist order dan snapshot immutable alamat/asal/layanan/barang/PPN/ongkir/total, tahan stok lokal, persist satu SO intent, POST SO sekali dan konfirmasi GET, lalu buat Snap. SO/invoice/payment Jubelio bernilai barang saja, pajak/diskon SO nol; Midtrans termasuk ongkir dan PPN, line ongkir terpisah. Re-payment memakai snapshot yang sama tanpa quote ulang. Pembayaran Midtrans yang sah masih membutuhkan invoice/payment Jubelio terverifikasi sebelum delivery masuk antrean pemenuhan; tanpa kode pickup atau email siap ambil. Paid-but-blocked tetap paid dan tidak layak dibooking; order belum dibayar/expired tidak membuat booking.

## Acceptance / verify

- Browser + HTTP checkout/payment dengan mock SO/Midtrans/Shipment: harga berubah meminta persetujuan kedua sebelum SO/Snap; snapshot tetap walau buku alamat/harga kemudian berubah; re-payment tidak mengubah total.
- Fixture barang Rp100.000, ongkir Rp20.000, PPN 11%: SO/invoice/payment Rp100.000 versus Midtrans/order Rp133.200; mismatch SO Rp90.000 atau settlement ambigu menahan fulfillment. Pickup dari tiket 01 tetap lulus.
- DB-backed snapshot vs edit alamat/harga, settlement vs kesiapan booking, durable SO intent; unit/E2E serta docs/schema/seed/deployment relevan. Main agent membuktikan red lalu green dan mereview regresi.

## Batas

Tidak melakukan booking Shipment di tiket ini. Jangan mengulang create SO secara buta, membuat SO delivery kedua, atau kembali ke inventory adjustment. Ikuti [approved spec](../approved-spec.md).
