# Eligibility Offer dan Dasar Perhitungan Diskon

Label: wayfinder:grilling
Type: grilling
Status: resolved
Assignee: main-agent
Blocked by: none
Parent: [Wayfinder Desain Diskon](../map.md)

## Question

Komponen barang/ongkir, threshold, dan aturan perhitungan apa yang berlaku untuk offer general pada scope awal?

Detail yang perlu diputuskan:

- Barang eligible setelah harga coret dan dasar minimum belanja.
- Seluruh barang dalam order termasuk dasar diskon barang; tidak ada targeting produk/kategori/brand atau include/exclude pada fase ini.
- Plafon persentase, batas potongan nominal per order, eligibility ongkir, dan sisa benefit yang tidak terpakai.
- Pembulatan ke Rupiah utuh dan alokasi deterministik ke baris/quantity eligible.
- Offer invalid atau benefit nol, serta kebijakan order dengan total pembayaran nol.
- Batas waktu aktif dan conditions tambahan yang masuk scope awal.

Contoh terkonfirmasi: sepatu Rp150.000 + baju Rp300.000 = Rp450.000; diskon 10% maksimal Rp20.000 menghasilkan potongan Rp20.000 dan total barang Rp430.000 sebelum pajak/ongkir/fee. Contoh yang masih perlu keputusan: alokasi potongan Rp25.000 ke baris Rp150.000/Rp100.000; ongkir Rp12.000 dengan plafon Rp20.000.

Satu slot bersama untuk kupon/kode dan pemilihan kupon publik langsung tanpa claim sudah disepakati; jangan dibuka kembali.

## Referensi dan batasan

- [Research nominal dan eligibility](../../../plan/research/discounts-coupons-promo-codes.md#6-money-eligibility-and-stacking-recommendations).
- [Proposal benefit dan target bertipe](../../../plan/research/discount-database-design.md#6-offer-eligibility-and-activation-tables).
- [Helper exact-money yang ada](../../../apps/store/src/lib/order-pricing.ts).
- [Relasi katalog](../../../packages/db/src/schema/products.ts).

Threshold dalam research masih usulan, bukan default yang disetujui. Targeting produk/kategori/brand dikeluarkan dari fase awal sesuai klarifikasi pemilik; tidak perlu grilling matching target.

## Bukti penyelesaian

Aturan scope awal yang dikonfirmasi pengguna beserta contoh input, eligibility, dan hasil perhitungan dari sumber independen. Kebijakan pajak/funding dibahas di Perhitungan Pajak dan Subsidi Ongkir; semantik provider dibahas di tiket bukti kontrak dan mapping provider.

## Batas pekerjaan

Claim sebelum mulai. Muat `grilling`, `domain-modeling`, dan `development-workflow`. Hanya planning dan pemeriksaan read-only. Tidak ada implementasi, request provider, subagent, atau penyelesaian tiket HITL lain.

## Keputusan terkonfirmasi — scope fase awal

Pemilik mengklarifikasi dan meminta pencatatan: diskon kupon/kode barang bersifat general untuk seluruh barang dalam order, memakai harga setelah markdown. Tidak ada targeting produk/kategori/brand maupun include/exclude pada fase ini. Contoh independen: Rp150.000 + Rp300.000 = Rp450.000; 10% = Rp45.000; cap Rp20.000 → potongan Rp20.000; net barang Rp430.000 sebelum pajak/ongkir/fee. Catatan targeting sebelumnya dikoreksi, bukan dianggap kebutuhan yang disetujui.

### Ronde 1 — dikonfirmasi melalui ask_user_question

- Minimum belanja memakai subtotal seluruh barang setelah markdown, sebelum kupon/pajak/ongkir/fee. Misalnya harga Rp300.000 → markdown Rp150.000 tidak lolos minimum Rp200.000 walaupun ditambah pajak/ongkir.
- Potongan nominal dibatasi subtotal barang: kupon Rp25.000 pada subtotal Rp15.000 memberikan Rp15.000, net barang nol; sisa Rp10.000 hangus, bukan saldo atau subsidi ongkir.
- Subsidi ongkir hanya delivery dengan ongkir valid, tanpa pembatasan kurir khusus pada scope ini. Benefit = min(ongkir aktual, plafon); ongkir Rp12.000 dengan cap Rp20.000 → subsidi Rp12.000, tanpa sisa Rp8.000. Pickup/ongkir nol tidak eligible.
- Diskon dibulatkan turun ke Rupiah utuh: 10% × Rp100.005 = Rp10.000,5 → Rp10.000. Alokasi proporsional ke baris/quantity, sisa Rupiah ke pecahan terbesar, tie memakai ID stabil. Rp25.000 dialokasikan ke Rp150.000/Rp100.000 menjadi Rp15.000/Rp10.000, jumlah tepat Rp25.000.

### Ronde 2 — jawaban dan satu klarifikasi tersisa

- Checkout gratis ditunda: net barang boleh nol jika total pembayaran final tetap positif; total final Rp0 ditolak dengan alasan jelas, tanpa menaikkan tagihan.
- Batas tanggal opsional; waktu server authoritative, input admin WIB. Mulai inklusif, akhir eksklusif; jika keduanya diisi, mulai < akhir. Contoh mulai 08:00 aktif tepat 08:00, berakhir 10:00 tidak aktif tepat 10:00.
- Conditions awal cukup minimum belanja/waktu aktif dan delivery untuk subsidi ongkir, tanpa first order/minimum quantity/kurir khusus. Kuota dan identitas tetap milik tiket 03.
- Setelah klarifikasi terpisah melalui ask_user_question, pemilik menyetujui: persentase wajib >0 sampai 100%; nominal/plafon positif. Konfigurasi invalid tidak boleh dipublikasikan dan harus memberikan alasan perbaikan.
- Setelah pembulatan, benefit Rp0 tidak bisa diterapkan; kuota global dan jatah customer tidak berkurang. Contoh 1% × Rp50 = Rp0,50 → Rp0.

## Koreksi scope berikutnya — tanpa kewajiban pembuktian pembayaran Rp0

[Keputusan eksplisit pemilik setelah pembahasan outstanding 2](../decision-zero-payment-and-no-service-fee.md) menjadi acuan terkini: website tanpa service fee; pembayaran Rp0 tidak masuk scope operasional dan dijaga prosedur admin/pemilik bisnis. Tidak ada kewajiban membuktikan pembayaran/provider Rp0, merancang alur transaksi gratis, atau menjadikannya launch gate. Catatan net barang nol pada keputusan awal di bawah bukan izin membuka kembali outstanding tersebut.

## Answer — keputusan final disetujui

Pemilik mengonfirmasi ringkasan lengkap melalui ask_user_question dengan tambahan eksplisit: **plafon diskon persentase opsional**. Diskon 10% tanpa cap diperbolehkan. Jika cap diisi, harus positif; ketentuan positif nominal tetap berlaku. Tambahan ini menggantikan penyebutan plafon persentase wajib sebelumnya.

- Dasar `E`: subtotal seluruh barang order setelah markdown, sebelum kupon/pajak/ongkir/fee. Minimum belanja memakai `E`; targeting produk/kategori/brand bukan scope awal.
- Persentase: `D = min(floor(E × rate / 100), E, cap jika diisi)`, dengan `0 < rate <= 100`. Cap diterapkan sekali per order, bukan per baris/unit.
- Nominal: `D = min(nominal, E)` sekali per order; sisa hangus tanpa saldo atau perpindahan ke ongkir.
- Subsidi ongkir: delivery dengan ongkir valid, `min(ongkir aktual, plafon)`, tanpa pembatasan kurir khusus; pickup/ongkir nol tidak eligible. Sisa hangus. Plafon persentase opsional tidak mengubah aturan plafon subsidi ongkir.
- Diskon turun ke Rupiah utuh; alokasi proporsional ke baris/quantity dengan largest remainder dan tie ID stabil, jumlah alokasi tepat sama dengan diskon, tidak membuat nilai barang negatif.
- Konfigurasi invalid tidak boleh dipublikasikan. Benefit Rp0 tidak bisa diterapkan dan tidak mengurangi kuota/jatah customer.
- Total pembayaran final Rp0 ditolak dengan alasan jelas tanpa menaikkan tagihan; barang net nol boleh jika total final tetap positif. Flow checkout gratis ditunda.
- Tanggal opsional, input admin WIB/waktu server; mulai inklusif dan akhir eksklusif. Jika keduanya diisi, mulai < akhir. Conditions tambahan first order/minimum quantity/kurir khusus tidak masuk scope ini.
- Satu slot kupon/kode tetap berlaku. Pajak/funding, kuota/identitas, dan provider tetap milik tiket terpisah.

### Contoh hasil independen

| Input | Hasil sebelum pajak/ongkir/fee |
| --- | --- |
| Sepatu Rp150.000 + baju Rp300.000; 10% cap Rp20.000 | E Rp450.000; raw Rp45.000; diskon Rp20.000; net barang Rp430.000 |
| Barang yang sama; 10% tanpa cap | Diskon Rp45.000; net barang Rp405.000 |
| E Rp100.005; 10% tanpa cap | Raw Rp10.000,5; diskon Rp10.000; net Rp90.005 |
| Kupon Rp25.000; E Rp15.000 | Diskon Rp15.000; net barang Rp0; sisa Rp10.000 hangus; checkout hanya jika total final positif |
| Nominal Rp25.000; baris Rp150.000/Rp100.000 | Alokasi Rp15.000/Rp10.000; jumlah Rp25.000; net Rp225.000 |
| Nominal Rp1; baris Rp100/Rp200 | Alokasi Rp0/Rp1 melalui pecahan terbesar; jumlah Rp1 |
| Ongkir Rp12.000; plafon Rp20.000 | Subsidi Rp12.000; net ongkir Rp0; tidak ada saldo Rp8.000 |
| E Rp50; 1% | Raw Rp0,5 → Rp0; offer tidak diterapkan, jatah tetap utuh |

Bukti: jawaban pemilik di sesi grilling dan pemeriksaan aritmetika independen terhadap contoh. Tidak ada implementasi, request provider, tests/build/lint, atau verifikasi runtime. Approval hanya keputusan planning tiket ini.

## Comments

Dipublikasikan setelah pemilik secara eksplisit menyetujui proposal map lengkap dengan 12 tiket. Rekomendasi research belum menjadi keputusan sampai jawaban pemilik dicatat.
