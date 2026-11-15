# Kebijakan Pembatalan, Refund, dan Pembayaran Terlambat

Label: wayfinder:grilling
Type: grilling
Status: resolved
Assignee: main-agent
Blocked by: 03, 04, 09
Parent: [Wayfinder Desain Diskon](map.md)

## Question

Bagaimana pembatalan unpaid yang aman, pembatalan oleh customer/merchant, refund penuh/sebagian, retur yang memengaruhi threshold, dan pembayaran terlambat memengaruhi kapasitas, benefit customer, provider, dan komunikasi?

Putuskan release hanya setelah bukti terminal authoritative; pengembalian jatah/budget consumed dibandingkan voucher pengganti yang diaudit; refund net barang/ongkir tanpa mencairkan subsidi; partial return yang menggugurkan threshold; paid setelah release/cancel; paid tetapi provider masih memblokir dan penanggung jawab operasional; serta scope ketika tooling refund otomatis belum tersedia.

Contoh: customer membeli Rp200.000 untuk memenuhi minimum Rp150.000 lalu meminta partial cancellation Rp100.000; refund setelah penggunaan pertama yang sudah paid; merchant gagal menyediakan stok; pembayaran terlambat setelah safe release ketika slot kuota terakhir sudah diambil customer lain.

## Referensi dan batasan

- [Rekomendasi reservation/refund saat ini](../research/discounts-coupons-promo-codes.md#8-redemption-lifecycle-and-cancellationrefund-policy).
- [Proposal state dan riwayat redemption](../research/discount-database-design.md#7-reservationusage-and-financial-result-tables).
- [Lifecycle dan keamanan provider](../../../docs/features/jubelio-sales-orders.md).
- [Order flow saat ini](../../../docs/features/order-flow.md).

Memerlukan Limit Redemption, Identitas, dan Kebijakan Reservation; Perhitungan Pajak dan Subsidi Ongkir; serta Kontrak Mapping Provider dan Settlement. Tidak ada asumsi restore/rebilling/refund otomatis. Allocation yang tersimpan menyediakan bukti net value, tetapi tidak sendirian menyelesaikan eksploitasi threshold atau hak customer.

## Bukti penyelesaian

Tabel skenario/state/nominal yang dikonfirmasi pemilik/finance, beserta dampaknya bagi customer dan operasional. Pisahkan keamanan diskon yang diperlukan dari subsystem refund/retur baru; perluasan scope memerlukan persetujuan eksplisit, bukan planning implementasi diam-diam.

## Batas pekerjaan

Claim setelah blockers selesai. Muat `grilling`, `domain-modeling`, dan `development-workflow`. Hanya planning/pemeriksaan read-only; tidak ada refund/cancel/request provider aktual, perubahan app/config, subagent, atau penyelesaian tiket HITL lain.

## Keputusan sesi — Ronde 1

- Pemilik menegaskan refund belum tersedia dan tidak akan ditangani aplikasi; jika terjadi, penyelesaian dilakukan manual di luar aplikasi. Tidak ada perluasan scope subsystem refund/retur otomatis.
- Pemilik meminta fokus transaksi berhasil. Jawaban tentang dampak refund pada kuota/budget/jatah akun merujuk ke batas scope tersebut; belum merupakan pilihan eksplisit untuk restore atau tidak restore.
- Kebijakan nominal refund, partial return/threshold, serta tooling voucher pengganti tidak dilanjutkan sebagai fitur aplikasi pada sesi ini. Batas integrasi refund eksternal dan penanganan kegagalan/late payment masih perlu dikonfirmasi tanpa membuka kembali keputusan reservation yang telah disetujui.

## Answer — batas scope dan safety disetujui

Pemilik mengonfirmasi melalui `ask_user_question`: **“iya safety tetap ada. refund tidak ada, seperti aplikasi ini existingnya tidak ada refund”**, setelah menerima ringkasan konsekuensi riwayat promo dan safety unpaid/late payment. Tiket resolved sebagai keputusan planning dengan scope refund dikeluarkan, bukan persetujuan subsystem refund atau kesiapan launch.

### Scope aplikasi

- Tidak ada fitur refund/retur, event/sinkronisasi refund eksternal, restore jatah akibat refund, atau tooling voucher pengganti dalam scope awal diskon.
- Jika refund terjadi, penyelesaian dilakukan manual di luar aplikasi. Aplikasi tidak mengubah snapshot order, bukti paid, riwayat pemakaian, kuota, budget, atau jatah akun hanya karena refund eksternal tersebut.
- Hal ini bukan persetujuan nominal refund, hak retur customer, penyesuaian PPN/ongkir/fee, atau perlakuan accounting refund. Kebijakan tersebut tidak ditetapkan oleh sesi ini.
- Pembatalan setelah paid akibat permintaan customer maupun kesalahan merchant, partial cancellation/return yang menggugurkan threshold, dan voucher kompensasi tidak dibangun sebagai workflow aplikasi. Jika kelak dibutuhkan, perlu keputusan scope dan approval terpisah.
- Fokus happy path tidak berarti semua pembayaran dianggap berhasil atau safety kegagalan dihapus. Payment/provider outcome tetap diverifikasi.

### Safety yang dipertahankan

- Preview tanpa hold; order dibuat menahan kuota/budget/jatah akun; paid authoritative mengubah hold menjadi pemakaian final, termasuk ketika settlement provider belum terverifikasi dan fulfillment tertahan. Mengikuti keputusan tiket 03, bukan kebijakan baru.
- Release order unpaid hanya setelah bukti terminal authoritative dan kondisi provider aman. Deadline lewat, payment attempt ditolak, atau timeout tidak sendirian mengizinkan release. Status ambigu tetap hold dan direkonsiliasi/review ops.
- Paid setelah safe release/cancel tetap diakui. Fulfillment normal ditahan untuk penyelesaian manual, tanpa otomatis mengambil kembali kuota/budget yang sudah dilepas, membuat transaksi provider pengganti, atau melampaui limit. Tidak ada auto-refund.
- Paid dengan settlement provider belum terverifikasi tetap paid dan tidak memperoleh izin fulfillment normal. Penanganan tetap melalui review ops existing; sesi ini tidak menambah role, SLA, tooling penyelesaian, atau komunikasi otomatis. Komunikasi/penyelesaian kasus khusus dilakukan manual di luar aplikasi.
- Jalur late settlement existing ketika cancel belum dimulai dan SO masih aktif tidak dihapus; paid tetap harus mengikuti kontrak kapasitas dan verifikasi settlement, bukan melewati safety diskon.

### Tabel skenario dan dampak

| Skenario | Dampak promo dan order | Penyelesaian customer/ops |
| --- | --- | --- |
| Order unpaid menahan benefit Rp20.000, lalu batal terminal dan aman | Hold kuota/budget Rp20.000/jatah akun dilepas sekali | Mengikuti failure flow existing; bukan refund |
| Order paid memakai benefit Rp20.000, lalu ada refund manual eksternal | Riwayat paid dan pemakaian Rp20.000 tetap; aplikasi tidak melakukan restore | Uang dan komunikasi refund diurus manual di luar aplikasi; nominal refund tidak diputuskan di sini |
| Paid, tetapi invoice/payment Jubelio belum terverifikasi | Pemakaian promo tetap final; fulfillment tertahan | Review ops existing dan koordinasi manual; tanpa auto-refund atau blind retry |
| Pembayaran masuk setelah safe release/cancel dan slot terakhir telah dipakai customer lain | Paid diakui; tidak merebut slot customer lain, tidak otomatis reacquire kapasitas; fulfillment ditahan | Penyelesaian manual di luar aplikasi; tidak ada transaksi pengganti/refund otomatis |
| Merchant gagal memenuhi order atau customer meminta partial return yang menggugurkan minimum | Tidak ada workflow refund/retur/repricing/restore dalam scope diskon | Ditangani di luar aplikasi; aturan nominal/hak customer tidak diasumsikan dari alokasi diskon |

### Bukti dan batas verifikasi

- Prerequisite 03, 04, dan 09 sudah resolved saat tiket diklaim. Keputusan sebelumnya tidak dibuka kembali.
- Fakta kode diperiksa pada `apps/store/src/lib/order-finalize.ts:464–578`: cancel yang sudah dimulai menahan late paid untuk manual review; tanpa cancel aktif ada jalur menuju settlement normal. Dokumen `docs/features/jubelio-sales-orders.md` menjelaskan paid-but-blocked dan review queue read-only existing.
- Tidak ada request provider, transaksi refund/cancel, perubahan aplikasi/schema/config, subagent, tests/build/lint/typecheck, atau commit. Pemeriksaan lokal read-only selain bookkeeping dokumen tiket/map.
- Launch gates provider pada tiket 09 tetap berlaku. Penyelesaian tiket 10 tidak membuktikan semua edge case runtime atau memberi izin implementasi.

## Comments

Dipublikasikan setelah proposal map lengkap disetujui. Research awal menawarkan kebijakan refund yang lebih luas; pemilik kemudian secara eksplisit mengeluarkan refund dari aplikasi dan mempertahankan safety existing sebagaimana Answer di atas.
