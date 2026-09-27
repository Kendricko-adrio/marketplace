# Booking, timeout, dan pembatalan Shipment

Type: research
Label: wayfinder:research
Status: open
Blocked by: 01
Parent: [Menuju spec pengiriman ke rumah via Jubelio Shipment yang siap ditinjau](../map.md)

## Question

Pada kontrak/tenant yang telah dikonfirmasi, apa semantik `ref_no`, duplikasi atau idempotensi `POST /shipments/create`, kemungkinan menemukan hasil ketika respons hilang tanpa AWB, waktu/nominal tagihan `price`, serta batas cancel dan konsekuensi kegagalannya? Bedakan fakta vendor dan hasil sandbox dari rancangan aman lokal; tentukan fakta mana yang belum tersedia untuk keputusan penanganan pesanan berbayar.

Jangan mengirim request API tanpa rancangan dan izin pemilik untuk **setiap request**, dan jangan mengulang POST ambigu tanpa keputusan keamanan khusus. Subagen hanya dengan izin delegasi tersendiri.
