# Webhook dan bukti status pengiriman

Type: research
Label: wayfinder:research
Status: open
Blocked by: 01
Parent: [Menuju spec pengiriman ke rumah via Jubelio Shipment yang siap ditinjau](../map.md)

## Question

Untuk Shipment pada tenant ini, bagaimana verifikasi `x-jubelio-signature` sebenarnya (termasuk raw body/encoding dan fixture signed), jaminan retry/ordering, bentuk event, semantik status delivered/returned/issue, dan batas rekonsiliasi `GET /shipments/awb/{awb}`? Nyatakan bukti yang diperoleh dan bagian yang tetap tak terkonfirmasi; jangan menyamakan callback Shipment dengan webhook Omnichannel.

Setiap request API butuh draf dan izin pemilik **sebelum request**; meminta fixture/vendor tidak mengizinkan pengujian endpoint lain. Subagen hanya setelah izin delegasi terpisah.
