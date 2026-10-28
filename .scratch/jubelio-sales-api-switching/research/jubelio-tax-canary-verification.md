# Verifikasi canary pajak Jubelio — SO, invoice, dan payment berhasil

Tanggal: 2026-10-26 UTC.
Status terbaru: **PASS untuk SO → invoice → payment berpajak**, setelah B0/B1 create/cancel sebelumnya juga PASS. Fixture baru SO68450 → invoice45978 → payment67, PPN11000/total111000/due0 terverifikasi. Fixture settlement dipertahankan paid dan mengurangi stok satu unit sesuai izin. Aplikasi/config belum diubah. Bagian awal mempertahankan histori tiap tahap; hasil settlement ada pada bagian terakhir.

## Tujuan dan otorisasi

Pemilik meminta pengujian apakah input pajak membuat API Jubelio error, dengan kebutuhan record PPN11% `tax_id: -2`. Pemilik juga mengusulkan penyimpanan tax ID di system configuration dan pelepasan syarat ID positif; perubahan aplikasi tersebut belum diimplementasikan dalam pengujian ini.

Setelah scope dijelaskan, pemilik memilih **Dua SO + cancel (Recommended)**:

- Mengonfirmasi akun terisolasi/sandbox; ini pernyataan pemilik, bukan pembuktian dari hostname API.
- Satu login dan GET preflight.
- Maksimal dua create SO memakai fixture historis item157190/lokasi2/customer dummy116918, unit Buah, qty1 dan harga transaksi100000. Harga transaksi berbeda dari master1000000 dan telah disebutkan dalam pilihan yang disetujui; tidak ada edit master.
- B0: NoTax1, `total_tax: 0`, grand100000.
- B1: tax-2/rate11%, `tax_amount: 11000`, `total_tax: 11000`, hipotesis line amount111000, grand111000.
- Maksimal satu cancel per SO yang sudah terverifikasi sesuai dan belum invoice, disertai GET cancel/stok.
- Tanpa invoice, payment, mirror, perubahan master/accounting/config/aplikasi. Berhenti pada error, data berbeda, atau outcome ambigu; tidak ada retry create.

Sesudah runner pertama berhenti, pemilik memilih **Lanjutkan (Recommended)** yang secara terpisah mengizinkan satu login tambahan dan verifikasi nama dummy menggunakan evidence historis yang tepat. Budget business-write tidak bertambah.

## Hasil aktual

Evidence teredaksi: [journal request dan hasil](jubelio-tax-canary-results.json).

| Tahap | Hasil | Catatan |
| --- | --- | --- |
| Login awal | HTTP200 | Satu attempt sesuai izin awal; token tidak dicetak. |
| GET taxes awal | HTTP200 | NoTax1/rate0 dan PPN tax-2/rate11 tersedia. |
| GET `/contacts/116918` awal | HTTP200 | Runner berhenti pada pemeriksaan nama yang keliru, bukan error provider. |
| Login tambahan | HTTP200 | Satu attempt setelah approval tambahan. |
| GET taxes lanjutan | HTTP200 | Record pajak tetap cocok. |
| GET `/contacts/116918` lanjutan | HTTP200 | ID dan nama dummy cocok persis dengan evidence historis. Nama/PII tidak dipublikasikan pada journal baru. |
| GET `/inventory/items/157190` | HTTP200 | Aktif, group55269, unit Buah, master price1000000; harga transaksi yang diizinkan100000. |
| GET `/locations/list` | **HTTP500** | Global stop; belum lanjut GET stok atau create. Tidak ada retry endpoint. |
| Create SO B0/B1 | **0 attempt** | Belum ada SO baru atau ID transaksi untuk direkonsiliasi. |
| Cancel SO | **0 attempt** | Tidak ada perubahan stok akibat SO dari run ini. |
| Invoice/payment/mirror/config change | **0** | Di luar scope dan tidak dijalankan. |

Jumlah login aktual: **2**, masing-masing memiliki izin. Tidak ada login ketiga. Token hanya berada di memory proses dan tidak tercetak atau tersimpan pada evidence; proses sudah berakhir. Runner sementara berada di `/tmp/`, bukan kode runtime aplikasi.

## Diagnosis runner dan batas diagnosis provider

Runner awal memakai pola `/dummy|test/i` untuk nama customer. Pola ini menolak nama fixture historis berprefix `DISCOUNT-VERIFY-…`, sehingga tidak cukup tepat. Bukti nama berasal dari [`sandbox-results.json`](../../discounts/research/sandbox-results.json), bukan tebakan customer baru. Reproduksi offline menunjukkan pola lama menolak nama tersebut. Pemeriksaan kemudian diganti menjadi exact match dengan nama fixture historis; GET lanjutan membuktikan ID/nama cocok. Tidak ada customer dibuat/diubah atau guard identitas dihapus.

HTTP500 terjadi di **GET lokasi**, bukan POST SO. Body provider tidak dipublikasikan; journal tidak memperoleh error code spesifik. Akar penyebab internal HTTP500 belum diketahui. Jangan menyimpulkan bahwa tax-2 atau nominal PPN menyebabkan error tersebut: keduanya belum dikirim pada transaksi SO.

## Kesimpulan yang sah

- Master pajak tenant memiliki record PPN11% dengan ID negatif-2, dan record tersebut masih readable.
- Fixture customer dan item historis masih ditemukan.
- **Belum ada jawaban empiris apakah create SO berpajak berhasil atau gagal**, karena dependency preflight lokasi gagal lebih dulu.
- Penerusan pajak ke invoice/accounting/payment tetap belum diuji.
- Scope ini API research; visual UX review aplikasi tidak berlaku. Tidak ada verifikasi UI vendor yang dijalankan.
- Tidak menjalankan unit/E2E/build/typecheck aplikasi karena tidak ada perubahan runtime aplikasi; runner dicek syntax dan pemeriksaan nama dummy direproduksi offline.

## Langkah berikutnya yang memerlukan keputusan

1. Ajukan kelanjutan terbatas setelah blocker dilaporkan: login baru jika perlu, periksa GET lokasi, item/customer/tax/stok, baru lanjut B0/B1 jika sehat. Budget create dua dan cancel dua **belum terpakai**, tetapi global stop tetap memerlukan persetujuan kelanjutan; jangan melakukan retry otomatis.
2. Jika GET lokasi terus gagal, gunakan audit UI/operator atau konfirmasi vendor. Mengganti endpoint/prosedur preflight untuk melewati kegagalan perlu dijelaskan dan disetujui, bukan dilakukan diam-diam.
3. Penyimpanan `jubelio.salesTaxId = -2` di `system_config` adalah usulan nama key, bukan konfigurasi yang sudah diubah. `system_config` sudah berupa key/value ([schema](../../../packages/db/src/schema/system.ts#L59)); tax ID checkout saat ini berasal dari env ([route](../../../apps/store/src/app/api/checkout/place-order/route.ts)).
4. Jika implementasi dilanjutkan, accepting negative ID tetap mempertahankan safe-integer validation dan pengecekan referensi master. Menghapus syarat positif tidak berarti menerima pecahan/string/non-finite atau membuka guard pajak nonzero tanpa kontrak uang yang disetujui. ID0 historis gagal FK. Kode guard dan alasan ada pada [riset awal](jubelio-sales-order-tax-input.md#3-review-dokumen-yang-menyatakan-pajak-tidak-dikirim).

Tidak ada commit, deployment, akses remote, atau perubahan data transaksi existing.

## Kelanjutan berizin — pagination mengikuti importer

Setelah pemilik menyarankan membandingkan `db:import-jubelio`, diperiksa [`fetchLocationsList`](../../../packages/db/src/jubelio-sync.ts#L303): request importer adalah `GET /locations/list?page=1&pageSize=100`, berbeda dari runner awal tanpa pagination. Pemilik kemudian mengizinkan kelanjutan melalui **“iya coba lagi saja”**. Ini ditafsirkan sebagai satu login baru, GET preflight dengan pagination, dan kelanjutan budget dua SO + cancel yang belum terpakai; bukan izin menjalankan importer, mengganti fixture, atau mengubah master/config.

Hasil aktual kelanjutan, pada tanggal yang sama:

| Tahap | Hasil |
| --- | --- |
| Login ketiga, dengan izin kelanjutan | HTTP200 |
| GET taxes | HTTP200; NoTax1/rate0 dan PPN-2/rate11 cocok |
| GET customer dummy | HTTP200; identitas historis cocok |
| GET item157190 | HTTP200; aktif, unit Buah, master price1000000 |
| GET `/locations/list?page=1&pageSize=100` | **HTTP200**, lokasi2 ditemukan |
| GET `/inventory/?page=1&pageSize=100&q=Testasd` | HTTP200; item157190/lokasi2: **on_hand6, on_order6, reserved0, available0** |
| Create/cancel/invoice/payment | **Tetap0** |

**Global stop: `Insufficient stock`.** Tidak membuat SO ketika available0, tidak mengganti item/lokasi tanpa persetujuan, tidak mengubah stok, dan tidak membatalkan SO existing untuk membebaskan stok.

Kesimpulan yang diperbarui: request lokasi dengan pagination berhasil pada run ini. Ini mendukung mengikuti cara importer, tetapi bukan bukti akar penyebab internal HTTP500 request sebelumnya. Blocker aktif sekarang adalah stok fixture, bukan lokasi. Belum dapat menyimpulkan perilaku create SO berpajak karena POST create belum pernah dikirim.

Jumlah login kumulatif menjadi **3**, seluruhnya berizin pada tahap masing-masing. Angka2 dan hasil lokasi500 pada bagian hasil awal di atas dipertahankan sebagai histori, bukan hasil terakhir. Evidence tetap ditambahkan pada [journal yang sama](jubelio-tax-canary-results.json).

Langkah berikutnya memerlukan keputusan pemilik: memilih fixture item/lokasi sandbox lain yang memiliki available stock, atau menunggu stok fixture awal tersedia secara sah. Periksa GET terlebih dahulu; pilihan fixture baru dan budget nominal harus disetujui sebelum business-write. Tidak ada pengujian ulang otomatis.

## Hasil final — pemilihan item available dan dua SO berhasil

Pemilik kemudian mengizinkan **“kamu bisa pilih item yang available sendiri. lanjutkan hasil pengujianmu”**. Scope kelanjutan: satu login baru, discovery GET, memilih item tersedia sendiri dengan prioritas lokasi2, dan menjalankan dua create + dua cancel terverifikasi yang budget-nya belum terpakai. Nominal transaksi tetap100000/qty1, tanpa invoice/payment atau perubahan stok/master/config.

### Fixture yang dipilih dan preflight

- Waktu eksekusi kasus: **2026-10-26 16:13:28–16:13:51 UTC**.
- GET inventory halaman1 menemukan kandidat available; master kandidat pertama terverifikasi aktif, unit Buah, tanpa serial/batch yang memerlukan penanganan khusus.
- **item_id116334**, item_group_id37137, SKU `4067984175342`, location_id2, customer dummy historis116918.
- Harga master349000; **harga transaksi pengujian100000**, sesuai nominal eksperimen yang disetujui. Master tidak diubah.
- Stok sebelum kasus: `on_hand1 / on_order0 / reserved0 / available1`.
- Login, GET taxes/customer/master/locations berpagination, dan GET inventory semuanya HTTP200 pada kelanjutan final.
- Login kumulatif dalam journal ini menjadi **4**, sesuai otorisasi kelanjutan masing-masing. Tidak ada login kelima.

### Input dan hasil independen

Kedua kasus source1 INTERNAL, mode `is_tax_included:false`, qty1, harga100000, diskon/ongkir/fee0. Semua POST create/cancel dan GET konfirmasi kasus mengembalikan **HTTP200**.

| Field/hasil | B0 — kontrol | B1 — PPN11% |
| --- | --- | --- |
| SO ID | **68448** | **68449** |
| SO number | SO-000068448 | SO-000068449 |
| Detail ID | 74733 | 74734 |
| `tax_id` input dan GET | 1 | **-2** |
| `price` / `qty_in_base` | 100000 / 1 | 100000 / 1 |
| `tax_amount` input dan GET | 0 | **11000** |
| `items[].amount` input dan GET | 100000 | **111000** |
| `sub_total` input dan GET | 100000 | **100000** |
| `total_tax` input dan GET | 0 | **11000** |
| `grand_total` input dan GET | 100000 | **111000** |
| `invoice_id` GET | null | null |
| Status setelah cancel/GET | `is_canceled:true` | `is_canceled:true` |

GET independen juga memeriksa SO/contact/source/location/reference, unit, identity/detail, quantity, price, discount, tax identity/money, mode exclusive, serta fee/ongkir nol. Alias lokasi line aktual adalah `loc_id:2`; `location_id` tidak tersedia pada line. Ini diperiksa tanpa mengubah identity lokasi.

### Disposition dan stok

Masing-masing SO dibuat, diverifikasi dengan GET, dibaca ulang sebelum cancel untuk memastikan belum invoice dan uang/identity tetap cocok, lalu dikirim satu cancel. GET sesudah cancel membuktikan canceled dan nominal pajak tetap tersimpan. Stok per kasus:

```text
sebelum create : on_hand1 / on_order0 / available1
sesudah create: on_hand1 / on_order1 / available0
sesudah cancel: on_hand1 / on_order0 / available1
```

**Budget final: create2/2, cancel2/2; tidak ada retry POST.** Kedua fixture berakhir canceled; tidak ada hold stok tambahan dari suite ini. Tidak ada invoice/payment, Shipment/AWB, edit master, stock adjustment, atau perubahan SO existing lain.

### Kesimpulan dan batas bukti

**Pada fixture ini, input PPN11% memakai `tax_id:-2` tidak menyebabkan error create SO.** Jubelio menerima dan mempertahankan line/header tax11000 dan total111000 melalui GET independen. Hipotesis `amount = net barang + pajak` cocok pada qty1/exclusive/diskon0/ongkir0 tersebut. Cancel SO berpajak juga berhasil dan stok dipulihkan.

Bukti ini tidak menguji quantity>1, alokasi rounding multi-line, diskon/ongkir bertax, tax-inclusive, jurnal accounting, invoice, payment, atau full-payload status mirror. Tidak ada inspeksi UI vendor; hasil ini adalah API-level evidence, bukan visual acceptance atau kesiapan integrasi production. Record yang sudah canceled tidak boleh digunakan untuk conversion invoice berikutnya; perlu fixture baru dan approval scope/budget terpisah.

System configuration dan validator tax ID/nominal pajak aplikasi **belum diubah**. Kebutuhan pemilik `tax_id:-2` dan usulan `jubelio.salesTaxId` tetap perlu blueprint/plan implementasi yang disetujui, termasuk snapshot/versioned payable/verifier/settlement/mirror agar PPN tidak ditambahkan dua kali ke customer.

Journal memuat dispatch intent, input finansial teredaksi, returned IDs, proyeksi GET, stok, dan `case-pass`/`suite-pass`. Runner sementara dicek syntax sebelum dijalankan. Pemeriksaan offline journal mengonfirmasi `status:pass`, create2, cancel2, dan dua case-pass. File session sementara berpermission terbatas dihapus setelah eksekusi; token tidak tersimpan pada evidence.

Tidak menjalankan suite aplikasi karena tidak ada perubahan runtime; tidak mengulang suite vendor setelah lulus.

## Kelanjutan invoice dan payment — berhasil

### Otorisasi dan batas

Pemilik meminta pengujian invoice/payment. Karena SO68448/68449 sudah canceled, agent menjelaskan kebutuhan SO baru dan dampak stok/accounting yang tidak dibatalkan otomatis. Pemilik memilih **Jalankan lengkap (Recommended)**: satu login, GET preflight, pilih item available, maksimal satu create SO qty1/harga100000/tax-2/PPN11000, satu konversi invoice, lalu satu payment111000 menggunakan account2/type0 setelah lookup. Tidak ada retry/cancel/refund/reversal otomatis, perubahan aplikasi/config, Midtrans/customer charge, atau izin write lain.

Evidence teredaksi: [journal invoice/payment](jubelio-tax-invoice-payment-results.json), run `JUBELIO-TAX-SETTLEMENT-2026-10-26T16-19-04-864Z`.

### Fixture dan hasil

Eksekusi **2026-10-26 16:19:04–16:19:33 UTC**. GET preflight berhasil: tax-2/rate11, customer dummy historis116918, lokasi2 berpagination, item116334/SKU4067984175342 aktif/unit Buah/available1. Harga master349000 tidak diubah; harga transaksi eksperimen100000 sesuai scope. Payment account2 diverifikasi melalui lookup: **`1-1001 - Bank`**; payment_type0 mengikuti scope dan bukti sandbox sebelumnya, bukan asumsi konfigurasi production.

| Tahap | ID / nomor | Hasil POST dan GET |
| --- | --- | --- |
| Create SO baru | **68450**, SO-000068450, detail74735 | HTTP200; sub_total100000, total_tax11000, grand_total111000, mode exclusive |
| Convert invoice | **45978**, INV-000045978, detail50140 | HTTP200; tax_id-2/tax_amount11000/amount111000 tetap, header tax11000/grand111000; payment_amount0 sebelum payment |
| Payment | **67**, CP-000000058, payment detail24 | HTTP200; amount111000, account2/type0; tepat satu invoice association ke45978/SO68450, paid111000, **due0** |
| GET invoice sesudah payment | 45978 | HTTP200; payment_amount111000; pajak line/header11000 dan total111000 tidak berubah |
| GET SO sesudah payment | 68450 | HTTP200; invoice_id45978, identity/detail/source/uang/pajak tetap |

Seluruh request suite ini HTTP200. Verifikasi uang menggunakan literal expected100000/11000/111000, bukan expected yang diturunkan dari response. GET independen memeriksa contact/source/location, item/quantity/price/unit, tax identity/money, diskon/ongkir/fee nol, mode exclusive, detail IDs dan hubungan SO/invoice/payment. Tidak ada failed checks pada journal.

Invoice GET mengekspos `salesorder_id:null` tetapi `salesorder_no` cocok; SO GET memiliki invoice_id45978 dan payment association memiliki salesorder_id68450. Linkage diperiksa melalui gabungan bukti tersebut, tidak mengasumsikan ID null berarti tidak berhubungan. SO `is_paid` tetapnull; status lunas dibuktikan dengan invoice payment_amount111000 dan payment association due0, bukan flag SO itu sendiri.

### Dampak stok dan disposition final

```text
sebelum SO      : on_hand1 / on_order0 / available1
sesudah SO     : on_hand1 / on_order1 / available0
sesudah invoice: on_hand0 / on_order0 / available0
sesudah payment: on_hand0 / on_order0 / available0
```

**Fixture baru dipertahankan sebagai invoiced dan paid**, sesuai persetujuan. Ada pengurangan stok fisik satu unit di sandbox; tidak ada penambahan stok, cancel invoice/SO, refund, atau reversal payment. Fixture canceled sebelumnya tetap tidak disentuh.

Budget final suite settlement: **login1, create1, invoice1, payment1**, seluruhnya satu attempt dan tidak ada retry. Ini journal/scope terpisah dari suite create/cancel awal dengan empat login historis.

### Kesimpulan yang sudah dan belum terbukti

- **Terbukti pada fixture ini:** PPN11% `tax_id:-2` diterima saat create SO, diteruskan menjadi invoice dengan line/header tax11000 dan payable111000, lalu dilunasi sebesar111000 dengan due0. Tidak muncul error API pada rangkaian ini.
- **Belum diverifikasi:** jurnal debit/kredit pajak pada UI/accounting, kepatuhan rate pajak, full-payload status mirror, diskon/ongkir/multi-line/quantity>1/rounding/tax-inclusive, refund/reversal dan compatibility runtime aplikasi.
- Keberhasilan conversion API bukan bukti audit jurnal akuntansi. Tidak ada inspeksi UI vendor atau klaim visual acceptance.
- Kode aplikasi, system configuration, env, schema, seed, dan deployment **tidak diubah**. Pajak provider nol tetap kontrak runtime sampai perubahan terencana disetujui dan diverifikasi; hasil sandbox bukan izin aktivasi production.
- Runner sementara di `/tmp/` dicek syntax; token hanya di memory proses dan tidak dipersist ke evidence. Suite aplikasi tidak dijalankan karena tidak ada perubahan runtime. Hasil vendor yang sudah PASS tidak diulang.
