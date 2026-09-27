# Riset: ongkir untuk beberapa barang dalam satu pesanan

## Pertanyaan dan jawaban singkat

Apakah ongkir lima barang sama dengan satu barang? **Tidak otomatis.** Kurir menagih menurut layanan, rute, serta berat kiriman yang dikenakan (aktual atau volumetrik), bukan semata jumlah SKU. Lima barang yang digabung dalam satu paket dihitung dari berat dan ukuran **paket setelah dikemas**, bukan ukuran satu item dikali tarif satu paket. Tarif minimum suatu layanan bisa membuat dua berat berbeda tetap menghasilkan harga sama. Sumber primer: [J&T tentang berat aktual/volumetrik](https://help.jet.co.id/web-show/NXRTVktVTE4xOHRoWHJMdDRFRldsdz09), [ketentuan domestik Pos Indonesia bagian C/F](https://www.posindonesia.co.id/id/pages/syarat-dan-ketentuan-kiriman-domestik), [JNE JTR](https://www.jne.co.id/jtr-indonesia).

## Contoh harga publik JNE, rute dan layanan sama

Website JNE: **Bogor → Jakarta Utara**, input berat **1 kg** vs **5 kg**. Angka di bawah adalah hasil kalkulator publik pada saat riset, bukan penawaran Jubelio Shipment ataupun jaminan harga transaksi yang akan datang.

| Layanan | 1 kg | 5 kg | Penjelasan |
|---|---:|---:|---|
| REG | Rp10.000 | Rp50.000 | Pada contoh ini 5 kg = 5× tarif 1 kg; tidak berarti rumus universal. |
| YES | Rp18.000 | Rp90.000 | Juga 5× pada contoh ini. |
| JTR | Rp40.000 | Rp40.000 | Layanan kargo berminimum 10 kg; 1 dan 5 kg sama-sama jatuh pada minimum layanan, bukan bukti lima barang gratis ongkir. |

Sumber: [kalkulator JNE 1 kg](https://jne.co.id/shipping-fee?destination=CGK10400&origin=BOO10000&weight=1), [kalkulator JNE 5 kg](https://jne.co.id/shipping-fee?destination=CGK10400&origin=BOO10000&weight=5), [syarat JTR: minimum 10 kg dan volume /5000](https://www.jne.co.id/jtr-indonesia).

Situs [cek ongkir J&T](https://jet.co.id/rates) menyediakan pencarian rute dan berat tetapi halaman publik yang bisa diekstrak tidak menghasilkan **harga angka spesifik** untuk rute contoh. Karena itu **tidak ada nominal J&T yang terverifikasi** di sini; jangan mengarangnya. [Panduan J&T](https://help.jet.co.id/web-show/NXRTVktVTE4xOHRoWHJMdDRFRldsdz09) menyatakan berat aktual/volumetrik dibandingkan dan pembulatan aktual (misalnya >1,3 kg dihitung 2 kg); volume = P×L×T/6000 dalam kg. [Pos Indonesia](https://www.posindonesia.co.id/id/pages/syarat-dan-ketentuan-kiriman-domestik) juga membandingkan aktual/volumetrik (/6000) dan memakai yang lebih tinggi, dengan toleransi berat tertentu. Kebijakan pembulatan/ambang berbeda per layanan; jangan mengimpor rumus ini ke Shipment tanpa konfirmasi.

### Ilustrasi lima pasang sepatu (asumsi, bukan ukuran katalog)

Misalkan setiap sepatu **dengan kotaknya** 1 kg, 35×22×13 cm. Satu kotak: volume 10.010 cm³ → contoh formula J&T/Pos `/6000` ≈ **1,67 kg volumetrik** vs 1 kg aktual. Lima kotak bersama: berat aktual ≈ **5 kg + kardus/pelindung**. Jika bisa disusun 35×22×65 cm (tanpa ruang/kemasan tambahan, hanya ilustrasi matematis), volume 50.050 cm³ → **8,34 kg volumetrik**; ukuran akhir yang berbeda akan mengubah ongkir. Misalnya kardus luar 55×40×35 cm → 77.000 cm³ → **12,83 kg volumetrik**, meski isinya tetap lima pasang. **Tidak boleh menyamakan contoh harga JNE input 5 kg dengan tarif lima sepatu sebelum mengetahui berat/dimensi kardus akhir.** Contoh ini hanya menjelaskan sensitivitas terhadap kemasan, bukan harga kurir sesungguhnya.

## Implikasi bagi spec Jubelio Shipment

[Kontrak Shipment v1.8 lokal](../../docs/jubelio-api/shipment-v1.8.md) meminta `weight` total pada `POST /rates[/all]`, menyediakan `items[]` dengan `quantity`/berat/dimensi item dan `package_detail` untuk paket; `POST /shipments/create` mewajibkan `items[]`. PDF belum menetapkan cara menggabungkan ukuran item, berat volumetrik, pembulatan, tarif untuk lebih dari satu kardus, atau jaminan harga booking sama dengan quote. **Rumus J&T/Pos/JNE adalah ilustrasi industri, bukan kontrak Shipment.** Rekomendasi untuk ditinjau: jumlahkan berat barang per kuantitas plus kemasan; taksir dimensi kardus dari konfigurasi kemasan yang divalidasi operasional, bukan mengalikan setiap dimensi dengan kuantitas; minta tarif langsung dari Shipment berdasarkan asal/tujuan dan taksiran paket; rekonsiliasi berat/dimensi serta biaya nyata setelah packing. Aturan selisih dan batas layanan tetap memerlukan keputusan pemilik serta bukti vendor/sandbox yang diizinkan.

[Skema Omnichannel item detail](../../docs/jubelio-api/dist.yaml) memuat `package_weight`/`package_height`/`package_width`/`package_length`, dan satu SKU sampel terkonfirmasi ada, terisi, positif lewat GET yang disetujui dalam percakapan ini; kelengkapan seluruh katalog dan dimensi kardus luar belum terverifikasi. Tidak ada request Shipment dilakukan untuk riset ini.
