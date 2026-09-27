# Riset baca-saja: ongkir Sales Order dan Jubelio Shipment

Status: temuan awal, **bukan** bukti integrasi otomatis atau izin mengubah Sales Order. Riset terhadap kontrak lokal dan GET API Omnichannel terautentikasi; tidak ada POST bisnis, booking, atau perubahan data. Hasil API ditulis teredaksi tanpa ID order, token, alamat, atau identitas pelanggan. Sampel kecil tidak mewakili semua transaksi/channel.

## Kontrak dan kode

- Omnichannel `POST /sales/orders/` menerima request `saveSalesOrderRequest` dengan properti opsional `shipping_cost` (nominal), `insurance_cost`, alamat tujuan, `add_fee`, `service_fee`, dan `grand_total` ([`docs/jubelio-api/dist.yaml` sekitar baris 24893–25146](../../docs/jubelio-api/dist.yaml)). Pada GET detail SO, `shipping_cost`, `buyer_shipping_cost` (*Buyer Shipping Cost (For Cashless)*) dan `grand_total` adalah field terpisah ([`dist.yaml` sekitar baris 25240–25310](../../docs/jubelio-api/dist.yaml)). Respons GET juga mendokumentasikan `is_jubelio_shipment` dan `service_category_id` ([`dist.yaml` sekitar baris 25774](../../docs/jubelio-api/dist.yaml)); **flag ini tidak muncul dalam schema request create/edit SO tersebut**. Keberadaan flag di respons/UI bukan bukti bahwa mengirimnya pada POST akan mengaktifkan booking Shipment.
- Klien checkout yang sudah ada membuat SO internal (`source: 1`) dengan total dari item, pajak/diskon nol pada envelope yang telah diuji, tanpa `shipping_cost`, lalu mengonfirmasi SO via GET sebelum Midtrans ([`apps/store/src/lib/jubelio-sales-client.ts` sekitar baris 9–28, 421–485](../../apps/store/src/lib/jubelio-sales-client.ts)). Kontrak Shipment v1.8 tidak mendefinisikan kaitan SO ↔ Shipment ([`docs/jubelio-api/shipment-v1.8.md` sekitar baris 121](../../docs/jubelio-api/shipment-v1.8.md)).
- Salinan `dist.yaml` lokal diketahui bisa tertinggal dari spec resmi (contoh: GET `/sales/v2/orders/` tidak ada di salinan lokal tetapi tercatat di [`docs/features/jubelio-sales-api-migration.md` §4–5](../../docs/features/jubelio-sales-api-migration.md)). Field yang terdokumentasi tetap perlu pembuktian semantik pada tenant.

## Observasi GET tenant (sesi riset ini)

Metode: `GET /sales/v2/orders/?page=…&page_size=100` dan `GET /sales/orders/{id}` dengan token sementara. Pengamatan tersebar di halaman 1–18 (1.800 entri daftar); pada halaman 9–18 ditemukan tiga SO kanal `SHOPEE` (`source=64`), dan detail ketiganya dibaca. Dua SO kanal lain (Tokopedia/Blibli) juga dibaca. Tidak ada SO sampel dengan `is_jubelio_shipment=true`.

| Sampel Shopee | `sub_total` | `total_disc` | `grand_total` | `shipping_cost` | `buyer_shipping_cost` | Jumlah `items[].amount` | `is_jubelio_shipment` |
|---|---:|---:|---:|---:|---:|---:|---|
| A | 3.500.000 | 2.450.000 | 896.500 | 0 | 3.500 | 1.050.000 | false |
| B | 258.000 | 23.800 | 234.200 | 0 | 0 | 234.200 | false |
| C | 899.000 | 179.800 | 719.200 | 0 | 0 | 719.200 | false |

A memiliki `service_fee=152.250`; B dan C `service_fee=0`; ketiganya `total_tax=0`, `insurance_cost=0`, `add_fee=0`. Pada A, `grand_total` = `sub_total − total_disc − service_fee` (896.500), **bukan** + `buyer_shipping_cost` (3.500). Pada B/C, `grand_total` sama dengan jumlah `items[].amount` dan `sub_total − total_disc`. Dua sampel non-Shopee memiliki `shipping_cost=buyer_shipping_cost=0`, tidak membuktikan apa pun tentang ongkir berbayar di SO internal. Perbedaan `grand_total` A dengan jumlah item menunjukkan metrik item saja tidak boleh dipakai sebagai definisi keseluruhan nilai marketplace.

**Kesimpulan terbatas:** setidaknya satu SO Shopee menyimpan ongkir pembeli **terpisah** di `buyer_shipping_cost`, bukan sebagai item produk atau dalam `grand_total` pada sampel itu. Ini tidak membuktikan semantik `shipping_cost` yang dapat ditulis untuk SO internal maupun kesamaan dengan jumlah dibayar melalui Midtrans. Shopee adalah order marketplace dengan subsidi/fee sendiri, bukan benchmark numerik langsung untuk website internal. `is_jubelio_shipment=false` pada ketiga sampel tidak menguji centang UI Jubelio Shipping.

## Pertanyaan yang tersisa untuk issue 08

1. Saat SO **internal** dibuat dengan `shipping_cost` positif, apakah GET mempertahankannya? Apakah `grand_total`/invoice memasukkan ongkir secara otomatis atau harus dikirim sebagai angka terpisah? Apa relasi `shipping_cost` vs `buyer_shipping_cost` untuk source internal? Jangan menguji POST SO tanpa rancangan dan izin terpisah.
2. Apakah pilihan **Jubelio Shipping** di UI memicu booking otomatis, sekadar memberi tanda pada SO yang sudah ditautkan ke AWB, atau memakai jalur internal dashboard yang tidak diekspos di API publik? Apakah ada endpoint terdokumentasi untuk menautkan SO ID ke Shipment AWB? Jangan mengasumsikan `is_jubelio_shipment` bisa dikirim pada POST SO.
3. Jika total SO marketplace memang hanya mencerminkan produk/fee dan bukan uang ongkir pembeli, apakah spec webstore mengharuskan **grand_total SO sama dengan total Midtrans** atau cukup rekonsiliasi terpisah (`SO product/PPN` + `shipping charge` = total Midtrans)? Perlu keputusan pemilik dan bukti formula invoice/stock sebelum mengubah invarian issue 06/08.
