# Implementasi pengiriman ke rumah via Jubelio Shipment

Status: breakdown disetujui; tiket 01–02 Done (mock-only browser/HTTP + DB/unit verified); 03 Done (quote/checkout verified); 04 Done (snapshot/payment verified); 05 Done (packing/booking verified); 06 Done (handoff/tracking verified); 07 Done (scoped follow-up and audited actions verified). Final regression: 106 unit files, 953 passed/2 infrastructure-failure sentinels skipped; mock E2E 22/22, types/lint/schema/diff checked. No operational activation claimed.

## Sumber kebenaran

- [Approved Ready spec preserved at completion](approved-spec.md); [enduring lifecycle contracts](../../docs/features/home-delivery.md); [status plan](../../plan/index.md).
- [Kontrak Shipment v1.8](../../docs/jubelio-api/shipment-v1.8.md) dan [alur Sales Order saat ini](../../docs/features/jubelio-sales-orders.md).
- [Catatan fitur pasca-selesai yang ditunda](../../plan/research/pengiriman-ke-rumah-jubelio-lanjutan.md).
- [Tiket keputusan 01–08](../pengiriman-ke-rumah-jubelio/map.md) mencatat asal keputusan, bukan tiket implementasi ini. Bila ada perbedaan, ikuti spec Ready terbaru.

## Tiket dan dependensi

| # | Tiket | Blocked by | Hasil utama |
|---|---|---|---|
| 01 | [Nominal pickup dan regresi](issues/01-nominal-pickup-regresi.md) | none | Baseline pickup dan dua ledger nominal teruji |
| 02 | [Alamat dan data asal/paket](issues/02-alamat-asal-paket.md) | none | Alamat client, asal cabang, parcel valid |
| 03 | [Quote checkout delivery](issues/03-quote-checkout-delivery.md) | 01, 02 | Layanan, ongkir, PPN, dan total terlihat sebelum order |
| 04 | [Order delivery dan pembayaran](issues/04-order-delivery-pembayaran.md) | 01, 02, 03 | Snapshot → satu SO → Midtrans → settlement terverifikasi |
| 05 | [Packing dan booking](issues/05-packing-booking-shipment.md) | 04 | Booking tahan-race hanya setelah layak, AWB dan ledger biaya |
| 06 | [Serah-terima dan tracking](issues/06-serah-terima-tracking.md) | 05 | Handoff fisik, status terverifikasi, DELIVERED menyelesaikan order |
| 07 | [Tindak lanjut kendala](issues/07-tindak-lanjut-kendala.md) | 04, 05, 06 | Satu daftar tindak lanjut sebelum order selesai |

## Aturan pengerjaan

Setiap tiket adalah slice perilaku yang harus diverifikasi dan didokumentasikan, bukan izin mengubah kontrak produk. Main agent menulis/membuktikan red lalu menjalankan green, tes unit/E2E/DB-backed yang relevan, review integrasi, dan update status. Subagents hanya bila diizinkan untuk sesi/tugas tersebut; implementer boleh membaca/mengedit code, tes, docs tetapi **tidak boleh menjalankan validasi**. Tidak ada izin tersirat untuk request write ke Jubelio, Docker/remote, deployment, commit, atau push. Aktivasi kurir nyata terpisah dari kelulusan aplikasi mock. Keputusan produk baru memerlukan pemilik; jangan menandai blocker sebagai Done. Status plan tetap di `plan/index.md`, bukan di map ini.
