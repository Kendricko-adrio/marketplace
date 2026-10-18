# Perhitungan Pajak dan Subsidi Ongkir

Label: wayfinder:grilling
Type: grilling
Status: resolved
Assignee: main-agent
Blocked by: 02
Parent: [Wayfinder Desain Diskon](../map.md)

## Question

Kebijakan nominal dan pajak apa yang menghubungkan base barang, harga coret, kupon, biaya/subsidi ongkir, tagihan customer, dan funding merchant?

Putuskan apakah pemisahan pajak website/provider saat ini dipertahankan; taxable goods setelah potongan; dasar pajak ongkir dan funding subsidi; biaya provider dibandingkan ongkir bersih customer; tampilan tax-inclusive/exclusive; snapshot Midtrans/repayment; dan konfirmasi finance jika diperlukan.

Contoh: net goods sebelum ongkir Rp150.000, ongkir quote/customer Rp30.000, dan subsidi Rp20.000. Tetapkan tax base serta komponen provider/customer/merchant, bukan diam-diam menganggap subsidi mengurangi Rp20.000 dari ongkir yang dikenai pajak.

## Referensi dan batasan

- [Kontrak nominal delivery](../../../docs/features/delivery-orders.md).
- [Exact money dan taxable base saat ini](../../../apps/store/src/lib/order-pricing.ts#L72).
- [Research ongkir/provider](../../../plan/research/discounts-coupons-promo-codes.md#e-shipping-subsidies-and-ppn).
- [Proposal kompatibilitas nominal order](../../../plan/research/discount-database-design.md#8-order-money-compatibility-and-jubelio-mapping).

Memerlukan penyelesaian Eligibility Offer dan Dasar Perhitungan Diskon. Delivery saat ini mengenakan pajak pada ongkir; perubahan merupakan kebijakan finansial eksplisit, bukan default library. Jangan menganggap subsidi ongkir masuk ke `disc_amount` barang di provider. Perilaku field writable provider diteliti terpisah.

## Bukti penyelesaian

Kontrak komponen nominal, pajak, dan funding yang dikonfirmasi pemilik/finance, dengan contoh independen dan prerequisite persetujuan eksternal jika ada. Kontrak tersebut menentukan kasus verifikasi provider yang relevan.

## Batas pekerjaan

Claim setelah blockers selesai. Muat `grilling`, `domain-modeling`, dan `development-workflow`. Hanya planning dan bukti read-only; tidak ada perubahan pajak/env/config, request provider, atau subagent. Jangan menyatakan saran hukum/pajak sebagai kebijakan yurisdiksi yang sudah diverifikasi.

## Answer — keputusan final disetujui

Pemilik menyetujui kontrak lengkap dan contoh melalui `ask_user_question` dengan memilih **Setuju, catat final (Recommended)**. Approval hanya untuk keputusan planning tiket 04, bukan implementasi.

### Kontrak nominal, pajak, dan funding

- Dasar PPN adalah total barang setelah Markdown dan kupon/kode barang. **Ongkir dan service fee tidak masuk dasar PPN**, dengan maupun tanpa subsidi. Ini koreksi eksplisit terhadap helper delivery saat ini yang memasukkan ongkir; kode belum diubah.
- PPN dibulatkan ke atas ke Rupiah utuh sekali dari total dasar pajak, bukan per baris. Contoh dasar Rp100.005 × 11% = Rp11.000,55 → Rp11.001. Rate 11% dalam contoh mengikuti default kode, bukan penetapan rate baru atau verifikasi hukum pajak.
- Subsidi ongkir ditanggung merchant saja pada fase awal. Ongkir customer bersih = ongkir sebelum subsidi − subsidi. Biaya quote/provider tetap dicatat terpisah dan tidak dikurangi karena customer menerima subsidi.
- Diskon barang, Markdown, dan subsidi ongkir tidak boleh dicampur atau dikurangkan dua kali. Subsidi tidak masuk `disc_amount` barang. Eligibility/clipping subsidi tetap mengikuti keputusan tiket 02.
- Total customer = net barang + PPN barang + net ongkir customer + service fee. Kupon barang/subsidi ongkir tidak memotong service fee. Net barang nol menghasilkan PPN nol; total final tetap harus positif sesuai tiket 02.
- Product/cart menampilkan harga barang belum termasuk PPN. Checkout menampilkan komponen barang/ongkir/subsidi/PPN/fee secara terpisah, dengan total final sudah termasuk PPN; tidak ada tambahan pajak saat pembayaran.
- Pemisahan pencatatan PPN dipertahankan: website/Midtrans mencatat PPN, Jubelio tetap tanpa PPN. Kontrak provider delivery saat ini adalah goods-only; bukti dan keputusan mapping diskon/ongkir provider tetap milik tiket provider terpisah, bukan dianggap sudah terverifikasi.
- Snapshot order mempertahankan komponen harga, Markdown, kupon barang, quote/provider shipping cost, ongkir sebelum subsidi, subsidi/funding merchant, net ongkir customer, fee, dasar/rate/nominal PPN, serta total. Jumlah rincian Midtrans harus sama dengan total order.
- Melanjutkan pembayaran order yang masih valid memakai snapshot yang sama, tanpa menghitung ulang harga/promo/ongkir/PPN atau memperpanjang expiry. Contoh customer menutup tab Midtrans sebelum membayar lalu melanjutkan pembayaran sebelum order kedaluwarsa; bukan pembayaran kedua atas order yang sudah lunas. Order expired atau `failed_payment` tidak menjadi eligible melalui keputusan ini.
- Koreksi PPN tanpa ongkir berlaku **untuk order baru saja**. Order lama mempertahankan snapshot, termasuk saat melanjutkan pembayaran; tidak ada koreksi/refund retroaktif yang diizinkan.
- Pemilik menyatakan berwenang memberikan approval finansial final, tanpa approval finance terpisah. Ini bukan klaim bahwa kepatuhan hukum/pajak yurisdiksi telah diverifikasi.

### Contoh hasil independen

Contoh memakai PPN 11%, tanpa service fee. Setiap baris adalah order terpisah; satu slot kupon/kode tetap berlaku, sehingga kupon barang dan subsidi ongkir tidak digabung dalam satu order.

| Input | Dasar PPN / PPN | Tagihan customer / funding |
| --- | --- | --- |
| Pickup; base Rp300.000 → Markdown Rp150.000; kupon barang Rp20.000 | Net barang Rp130.000; PPN Rp14.300 | Customer Rp144.300 |
| Barang Rp150.000; delivery quote/ongkir sebelum subsidi Rp30.000; subsidi Rp20.000 | Dasar Rp150.000; PPN Rp16.500 | Net ongkir Rp10.000; customer Rp176.500; biaya kurir Rp30.000; merchant mendanai subsidi Rp20.000 |
| Barang Rp150.000; delivery ongkir Rp30.000; tanpa subsidi | Dasar Rp150.000; PPN Rp16.500 | Customer Rp196.500; PPN sama dengan kasus subsidi |
| Barang Rp150.000; delivery ongkir Rp12.000; plafon subsidi Rp20.000 | Dasar Rp150.000; PPN Rp16.500 | Subsidi Rp12.000; net ongkir Rp0; customer Rp166.500; funding merchant Rp12.000; sisa plafon hangus |

### Bukti dan batas verifikasi

- Prerequisite tiket 02 sudah `resolved` ketika sesi dimulai; aturan diskon/eligibility tidak dibuka kembali.
- Fakta kode diperiksa pada [helper pricing](../../../apps/store/src/lib/order-pricing.ts#L72), [kontrak delivery](../../../docs/features/delivery-orders.md#two-ledgers-and-payment), dan [repayment](../../../apps/store/src/app/api/payments/midtrans/create/route.ts#L54).
- Pemilik mengoreksi dasar PPN menjadi barang saja, lalu menyetujui ringkasan lengkap dan contoh melalui sesi grilling. Hasil aritmetika contoh berasal dari komponen nominal yang dinyatakan eksplisit, bukan output engine baru.
- Tidak ada implementasi, request provider, subagent, tests/build/lint, atau verifikasi runtime. Helper saat ini masih mengenakan PPN pada ongkir delivery; keputusan ini merupakan kontrak untuk spec berikutnya.
- Kasus verifikasi berikutnya perlu membuktikan net barang setelah diskon pada provider, PPN website tanpa ongkir/fee, jumlah rincian Midtrans, pemisahan biaya kurir/funding/customer, dan snapshot repayment. Writable fields dan settlement provider belum terbukti oleh approval tiket ini.

## Comments

Dipublikasikan setelah proposal map lengkap disetujui. Dependencies dipasang setelah seluruh child tersedia.
