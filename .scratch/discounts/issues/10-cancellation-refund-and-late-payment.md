# Kebijakan Pembatalan, Refund, dan Pembayaran Terlambat

Label: wayfinder:grilling
Type: grilling
Status: open
Assignee: none
Blocked by: 03, 04, 09
Parent: [Wayfinder Desain Diskon](../map.md)

## Question

Bagaimana pembatalan unpaid yang aman, pembatalan oleh customer/merchant, refund penuh/sebagian, retur yang memengaruhi threshold, dan pembayaran terlambat memengaruhi kapasitas, benefit customer, provider, dan komunikasi?

Putuskan release hanya setelah bukti terminal authoritative; pengembalian jatah/budget consumed dibandingkan voucher pengganti yang diaudit; refund net barang/ongkir tanpa mencairkan subsidi; partial return yang menggugurkan threshold; paid setelah release/cancel; paid tetapi provider masih memblokir dan penanggung jawab operasional; serta scope ketika tooling refund otomatis belum tersedia.

Contoh: customer membeli Rp200.000 untuk memenuhi minimum Rp150.000 lalu meminta partial cancellation Rp100.000; refund setelah penggunaan pertama yang sudah paid; merchant gagal menyediakan stok; pembayaran terlambat setelah safe release ketika slot kuota terakhir sudah diambil customer lain.

## Referensi dan batasan

- [Rekomendasi reservation/refund saat ini](../../../plan/research/discounts-coupons-promo-codes.md#8-redemption-lifecycle-and-cancellationrefund-policy).
- [Proposal state dan riwayat redemption](../../../plan/research/discount-database-design.md#7-reservationusage-and-financial-result-tables).
- [Lifecycle dan keamanan provider](../../../docs/features/jubelio-sales-orders.md).
- [Order flow saat ini](../../../docs/features/order-flow.md).

Memerlukan Limit Redemption, Identitas, dan Kebijakan Reservation; Perhitungan Pajak dan Subsidi Ongkir; serta Kontrak Mapping Provider dan Settlement. Tidak ada asumsi restore/rebilling/refund otomatis. Allocation yang tersimpan menyediakan bukti net value, tetapi tidak sendirian menyelesaikan eksploitasi threshold atau hak customer.

## Bukti penyelesaian

Tabel skenario/state/nominal yang dikonfirmasi pemilik/finance, beserta dampaknya bagi customer dan operasional. Pisahkan keamanan diskon yang diperlukan dari subsystem refund/retur baru; perluasan scope memerlukan persetujuan eksplisit, bukan planning implementasi diam-diam.

## Batas pekerjaan

Claim setelah blockers selesai. Muat `grilling`, `domain-modeling`, dan `development-workflow`. Hanya planning/pemeriksaan read-only; tidak ada refund/cancel/request provider aktual, perubahan app/config, subagent, atau penyelesaian tiket HITL lain.

## Comments

Dipublikasikan setelah proposal map lengkap disetujui. Rekomendasi research agar jatah tidak otomatis dikembalikan belum menjadi kebijakan yang disetujui.
