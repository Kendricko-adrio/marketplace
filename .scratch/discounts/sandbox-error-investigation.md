# Investigasi HTTP 500 pada diskon SO Jubelio

> Lanjutan terbaru: [lima kasus tambahan J–N](sandbox-followup.md) berhasil setelah pemilik menambah budget dan meminta eksekusi. Total kini 10/10 create attempts. Bukti mencakup qty 2, alokasi dua line, header discount, serta satu marker → invoice → payment. Bagian A–H di bawah mempertahankan kronologi investigasi awal.

## Scope dan otorisasi

Menelusuri error kasus B melalui evidence, kontrak API terbaru, Context7, web search, dan pemeriksaan authenticated read-only. Tidak mengubah aplikasi, safety guard, konfigurasi provider, master barang, atau order lama. Pemilik sebelumnya mengizinkan seluruh tindakan sandbox yang diperlukan, maksimal 5 request create SO, dan menyerahkan rincian eksperimen kepada agent. Tidak ada delegasi/commit.

Setelah pemilik memeriksa UI dan menyatakan hanya SO A terlihat, pemilik meminta investigasi lanjutan. Kasus B tetap manual-review/unknown, tidak diulang atau otomatis dinyatakan gagal. Percobaan baru F di bawah memakai referensi berbeda dan mengonsumsi request ke-3, bukan retry B. Manual review UI mengurangi risiko duplikasi tetapi tidak membuktikan rollback backend B. Batas total tetap 5, termasuk create ambigu.

## Fakta yang diverifikasi

### Kontrak resmi

- Context7 resolve `/websites/jubelio`, dua targeted docs queries tentang create SO, diskon dan error codes.
- `https://docs.jubelio.com/dist.yaml` memberikan HTTP 200 tetapi bukan YAML OpenAPI yang memuat schema. Tidak digunakan untuk klaim schema fresh.
- `https://docs-wms.jubelio.com/dist.yaml` memberikan HTTP 200 `text/yaml`; block `saveSalesOrderRequest` dan `internalServerError` dibandingkan setelah normalisasi line ending/indent dan cocok dengan [vendor spec lokal](../../docs/jubelio-api/dist.yaml).
- `items[].disc` dan `items[].disc_amount` keduanya required, bertipe number, dengan deskripsi hanya Item Discount/Item Discount Amount. Tidak ada formula precedence, invariant persentase-nominal, atau definisi per-unit/per-line. Contoh request menggunakan diskon nol; bukan bukti nominal-only valid pada runtime.
- Artikel resmi [Langkah Membuat Sales Order yang Sesuai](https://jubelio.com/sales-order/) menyebut persentase dan nilai diskon, tetapi tidak menetapkan kontrak API atau akar error ini.
- Web search targeted tentang Jubelio + `disc_amount`/HTTP 500 tidak menghasilkan laporan error spesifik yang layak dijadikan penjelasan. Hasil unrelated POS/marketplace tidak dipakai sebagai bukti.

### Perbandingan A dan B

Pada field money yang direkam, hanya empat field berubah:

| Field | A berhasil | B HTTP 500 |
|---|---:|---:|
| `total_disc` | 0 | 20000 |
| `grand_total` | 259000 | 239000 |
| `items[0].disc_amount` | 0 | 20000 |
| `items[0].amount` | 259000 | 239000 |

Keduanya memakai SKU 43842, qty 1, harga 259000, location 2, tax ID 1, `disc: 0`, pajak/fee nol, source INTERNAL, customer dummy yang sama. Timestamp dan note/ref per kasus berbeda. Ini bukan eksperimen yang membuktikan sebab tunggal; gangguan provider sesaat belum tersingkir.

Perhitungan independen konsisten: `259000 × 1 − 20000 = 239000`; header `259000 − 20000 + 0 = 239000`. Tidak ada bukti salah penjumlahan dasar atau salah interpretasi quantity >1 karena B memakai qty 1.

### Pemeriksaan akun/master via GET

Evidence: [sandbox-error-diagnostics.json](sandbox-error-diagnostics.json).

- Mapping `sales_disc_acct_id: 29` dan `sales_add_disc_account_id: 76` tersedia dan kedua ID ditemukan dalam account lookup; dugaan sederhana mapping diskon kosong tidak didukung. Ini tidak membuktikan seluruh konfigurasi journal valid.
- Payment account ID 2 tersedia, tetapi belum ada payment dibuat.
- SKU aktif dan sellable; `sell_unit`/`uom_name` = `Buah`; serial/batch false.
- Field account sales/inventory/COGS dan sell tax pada item master null. Mapping account global tersedia; belum terbukti apakah null pada item master memengaruhi jalur diskon. Baseline SO berhasil dengan master yang sama. Tidak mengubah account mapping sebagai tebakan perbaikan.
- Tax ID 1 rate 0 tersedia.
- SO 68408 tetap canceled, invoice null, diskon nol, total 259000.
- List status ready-to-process untuk customer dummy kosong; canceled list hanya SO 68408. Coverage tetap terbatas.

### Kekurangan evidence error awal

Runner awal membaca body JSON tetapi hanya menyimpan HTTP status dan ID. Field `code`, `message`, `error`, dan correlation/request ID **tidak direkam**. Body error lama tidak dapat direkonstruksi dari status 500. Ini kekurangan observability eksperimen, bukan bukti provider tidak memberikan detail.

[Error code list resmi](https://docs-wms.jubelio.com/) dan [lokal baris 74–131](../../docs/jubelio-api/dist.yaml#L74) membedakan misalnya `23502` required/null, `23503` foreign key, `23505` duplicate, dan `23113` journal unbalance. Jangan mengatribusikan salah satu kode pada B tanpa response aktual. `42601` pada contoh dokumentasi juga bukan kode yang teramati pada B.

## Hipotesis dan uji pembeda

Hipotesis yang layak diuji: jalur runtime tidak menerima representasi `disc=0` bersama nominal positif, atau mengharapkan persentase dan nominal yang konsisten. **Belum terbukti**, dan tidak menjamin nominal-only tidak didukung. Alternatif: error internal/config/journal atau gangguan sementara provider.

### F — diagnostik persentase dan nominal konsisten

- Satu request create baru, budget request ke-3, ref unik suffix `F`; tidak menggunakan ulang ref B.
- SKU/price/location/customer/source/tax/unit sama jika recheck stok dan master masih valid.
- Qty 1, price Rp259.000, `disc: 10`, `disc_amount: 25900`, amount Rp233.100; header subtotal Rp259.000, total discount Rp25.900, tax/fee/additional discount nol, grand total Rp233.100.
- Angka 10% dipilih agar nominal tepat integer; tidak mengandalkan persentase pecahan 20000/259000 yang dapat terkena pembulatan.
- Capture HTTP, content type, error `code`, kategori message yang disanitasi, dan correlation header allowlist jika ada; jangan log raw body/customer/credentials.
- Jika sukses: GET independen memastikan field nominal dan tidak double-discount, lalu cancel pre-invoice dan GET untuk cleanup. Tidak melakukan marker/invoice/payment dalam uji diagnostik ini.
- Jika 5xx/network/missing ID: hentikan business writes; GET-only reconciliation/manual review, tanpa retry dan tanpa request ke-4 otomatis.
- Sukses F hanya membuktikan kasus persentase+nominal konsisten yang diuji, bukan root cause B, fixed/capped arbitrary-Rupiah, atau readiness launch.

## Hasil diagnostik F

F berhasil: create HTTP 200 dengan SO **68409**. Independent GET membuktikan `disc: 10.00`, `disc_amount: 25900.0000`, header `total_disc: 25900.0000`, line/header net `233100.0000`, tanpa diskon ganda. Cancel pre-invoice HTTP 200 dan GET `is_canceled: true`; available stock location 2 kembali 4. Tidak ada invoice/payment/marker. Total create attempts kini **3/5**.

F membuktikan jalur diskon nonzero dapat bekerja pada sandbox ini, tetapi belum membuktikan root cause B.

## Uji pembeda G — satu variabel dari F

Dengan otorisasi bounded yang sama, request ke-4 memakai fixture/ref baru suffix `G`. Seluruh money F dipertahankan (qty 1, price 259000, nominal 25900, total 233100), tetapi `disc` diubah dari 10 menjadi **0**. Ini bukan pengulangan request B (B nominal 20000), melainkan kontrol satu variabel terhadap F yang sudah terverifikasi. Timestamp/ref berubah sesuai fixture baru. Tidak mengubah master, aplikasi, atau order lama. B tetap unknown dan tidak diretry.

Jika G gagal, catat error code/message category dan hentikan write; jika berhasil, GET memastikan money lalu cancel pre-invoice. Tidak ada request ke-5 otomatis. Tujuan: menguji apakah representasi nominal-only yang sama menyebabkan perbedaan hasil terhadap F, bukan membuat workaround production.

### Hasil aktual G

Create G mengembalikan **HTTP 500**, `error: "Internal Server Error"`, `message: "An internal server error occurred"`; tidak ada error code spesifik yang dapat diidentifikasi dari field `code`, dan tidak ada ID SO. Detail tersanitasi direkam di [sandbox-results.json](sandbox-results.json), event `G-create`. Tidak ada raw body/credentials/PII yang disimpan.

Rekonsiliasi sesudah error: available stock tetap 4 (`on_hand: 4`, `on_order: 0`) pada SKU 43842/location 2; list ready-to-process terfilter customer fixture kosong. Tidak dianggap bukti rollback. Semua business writes dihentikan; tidak ada retry dan **tidak memakai request ke-5**.

## H — persentase dihitung dari nominal, request terakhir

Setelah hasil F/G dijelaskan, pemilik mengarahkan agar `disc` dihitung dari nominal diskon, bukan dibiarkan nol. Pengujian bounded dilanjutkan dengan satu fixture baru H, bukan retry B/G; keduanya tetap unknown dan tidak dimutasi. Ini memakai request create **ke-5 dari maksimal 5**, bukan penambahan budget atau persetujuan implementasi aplikasi.

Protokol sebelum request:

- Harga master Rp259.000, quantity 1, diskon nominal Rp20.000, net Rp239.000, fixture customer/lokasi/source/tax sama setelah recheck.
- Kandidat formula whole-line: `disc = disc_amount / (price × qty_in_base) × 100`. Quantity H hanya 1; formula untuk quantity >1 belum dibuktikan.
- Kirim `disc = 20000 / 259000 × 100` sebagai JSON number tanpa pembulatan ke dua desimal; pertahankan `disc_amount: 20000`, `amount: 239000`, header discount/net sama.
- Nilai persentase teoritis `7.722007722…%`. Jika dibulatkan menjadi `7.72%`, perhitungan ulang nominal menjadi Rp19.994,80; karena itu penerimaan HTTP 200 saja tidak cukup. GET harus membuktikan nominal Rp20.000 dan net Rp239.000 tetap tepat, meskipun field persentase pada GET mungkin dibatasi presisinya.
- Catat seluruh request body aktual (customer dummy tanpa PII, tanpa auth header), response create allowlist, dan GET money asli yang relevan agar timestamp input tidak lagi hilang.
- Jika state SO dikenal, identity/source/location sesuai, aktif dan belum invoice: cleanup cancel pre-invoice sekali, lalu GET dan recheck stock. Mismatch money tetap dicatat sebagai kegagalan verifikasi meskipun cleanup berhasil.
- Jika write ambigu: hentikan business writes, rekonsiliasi read-only/manual review, tanpa retry. Tidak ada create SO ke-6. Marker/invoice/payment tidak dijalankan oleh eksperimen ini.

**Hasil H:** create HTTP 200, SO **68410**. Request mengirim `disc: 7.722007722007722`; GET mengembalikan `disc: "7.72"`, tetapi **`disc_amount: "20000.0000"` dan net `"239000.0000"` tetap tepat**. GET header, line, quantity, price, source, dan lokasi sesuai; tidak ada mismatch. Ini membuktikan persentase hasil perhitungan dapat dikirim untuk nominal Rp20.000 pada fixture quantity 1 ini. Tidak membuktikan bahwa mengirim persentase yang sudah dibulatkan akan sama aman.

SO dibatalkan pre-invoice, GET canceled terverifikasi dengan money tetap sama, dan available stock kembali 4. Budget sekarang **5/5**, tidak ada create tambahan. B/G tetap unknown, tidak diretry. Marker/invoice/payment serta quantity >1 belum diuji.

## Contoh JSON request dan response aktual

### Cara membaca evidence

Semua create menggunakan `POST https://api2.jubelio.com/sales/orders/`, header `Content-Type: application/json`, dan header `Authorization` yang **tidak ditampilkan**.

Request B/F/G berikut direkonstruksi dari perintah eksperimen yang dijalankan dan [evidence tersanitasi](sandbox-results.json), bukan raw HTTP capture. Semua field body yang dikirim ditampilkan; `transaction_date` B/F/G diganti placeholder karena nilai persis dari `new Date().toISOString()` tidak disimpan. Timestamp event dispatch di evidence menunjukkan waktu pencatatan request, bukan salinan pasti field tersebut. Request H direkam lengkap sebelum dispatch, termasuk timestamp aktual, sehingga tidak memakai placeholder. Nama customer adalah label dummy buatan pengujian, bukan PII customer asli.

Response diberi label **proyeksi field teramati**: hanya field yang benar-benar direkam, menggunakan nama field API aslinya. Jangan menganggapnya seluruh raw response. Khusus B, body error tidak tersimpan; response G tidak digunakan untuk mengarang response B. Penambahan awal contoh B/F/G tidak mengirim request baru. Kasus H adalah eksperimen lanjutan terotorisasi yang dijelaskan terpisah di atas.

### B — nominal Rp20.000, persentase nol: HTTP 500

**Request body** — dispatch tercatat `2026-10-14T15:59:29.699Z`:

```json
{
  "salesorder_id": 0,
  "salesorder_no": "[auto]",
  "contact_id": 116918,
  "customer_name": "DISCOUNT-VERIFY-2026-10-14T15-58-21-705Z",
  "transaction_date": "<ISO timestamp aktual tidak direkam>",
  "is_tax_included": false,
  "note": "DISCOUNT-VERIFY-2026-10-14T15-58-21-705Z-B",
  "ref_no": "DISCOUNT-VERIFY-2026-10-14T15-58-21-705Z-B",
  "location_id": 2,
  "source": 1,
  "channel_status": "Belum Bayar",
  "sub_total": 259000,
  "total_disc": 20000,
  "total_tax": 0,
  "grand_total": 239000,
  "add_fee": 0,
  "add_disc": 0,
  "service_fee": 0,
  "items": [
    {
      "salesorder_detail_id": 0,
      "item_id": 43842,
      "qty_in_base": 1,
      "price": 259000,
      "disc": 0,
      "disc_amount": 20000,
      "tax_amount": 0,
      "amount": 239000,
      "unit": "Buah",
      "tax_id": 1,
      "location_id": 2
    }
  ]
}
```

**Output yang tersedia:** HTTP 500; body JSON provider tidak tersimpan. Berikut adalah **event logger**, bukan response body Jubelio:

```json
{
  "at": "2026-10-14T15:59:29.733Z",
  "label": "B-create",
  "path": "/sales/orders/",
  "http": 500,
  "id": null
}
```

`id: null` di atas adalah hasil normalisasi logger ketika tidak memperoleh ID, bukan bukti provider mengirim field `id` bernilai null.

### F — 10% dan nominal Rp25.900 konsisten: HTTP 200

**Request body** — dispatch tercatat `2026-10-14T16:10:44.683Z`:

```json
{
  "salesorder_id": 0,
  "salesorder_no": "[auto]",
  "contact_id": 116918,
  "customer_name": "DISCOUNT-VERIFY-2026-10-14T15-58-21-705Z",
  "transaction_date": "<ISO timestamp aktual tidak direkam>",
  "is_tax_included": false,
  "note": "DISCOUNT-VERIFY-2026-10-14T15-58-21-705Z-F",
  "ref_no": "DISCOUNT-VERIFY-2026-10-14T15-58-21-705Z-F",
  "location_id": 2,
  "source": 1,
  "channel_status": "Belum Bayar",
  "sub_total": 259000,
  "total_disc": 25900,
  "total_tax": 0,
  "grand_total": 233100,
  "add_fee": 0,
  "add_disc": 0,
  "service_fee": 0,
  "items": [
    {
      "salesorder_detail_id": 0,
      "item_id": 43842,
      "qty_in_base": 1,
      "price": 259000,
      "disc": 10,
      "disc_amount": 25900,
      "tax_amount": 0,
      "amount": 233100,
      "unit": "Buah",
      "tax_id": 1,
      "location_id": 2
    }
  ]
}
```

**Create response — HTTP 200, proyeksi field teramati:**

```json
{
  "id": 68409
}
```

**Konfirmasi `GET /sales/orders/68409` — HTTP 200, proyeksi field teramati sebelum cancellation:**

```json
{
  "salesorder_id": 68409,
  "is_canceled": null,
  "invoice_id": null,
  "sub_total": "259000.0000",
  "total_disc": "25900.0000",
  "grand_total": "233100.0000",
  "items": [
    {
      "item_id": 43842,
      "qty_in_base": "1.0000",
      "price": "259000.0000",
      "disc": "10.00",
      "disc_amount": "25900.0000",
      "amount": "233100.0000"
    }
  ]
}
```

Provider mengembalikan nominal pada GET sebagai decimal strings. Nilai di atas mempertahankan bentuk yang teramati, bukan diubah menjadi number.

**Cleanup request — `POST /sales/orders/cancel/`:**

```json
{
  "ids": [68409]
}
```

Cancel mendapat HTTP 200, tetapi raw body-nya tidak disimpan. GET sesudahnya membuktikan cancellation; berikut proyeksi field teramati:

```json
{
  "salesorder_id": 68409,
  "is_canceled": true,
  "invoice_id": null,
  "total_disc": "25900.0000",
  "grand_total": "233100.0000"
}
```

### G — nominal sama dengan F, hanya persentase menjadi nol: HTTP 500

**Request body** — dispatch tercatat `2026-10-14T16:12:02.385Z`:

```json
{
  "salesorder_id": 0,
  "salesorder_no": "[auto]",
  "contact_id": 116918,
  "customer_name": "DISCOUNT-VERIFY-2026-10-14T15-58-21-705Z",
  "transaction_date": "<ISO timestamp aktual tidak direkam>",
  "is_tax_included": false,
  "note": "DISCOUNT-VERIFY-2026-10-14T15-58-21-705Z-G",
  "ref_no": "DISCOUNT-VERIFY-2026-10-14T15-58-21-705Z-G",
  "location_id": 2,
  "source": 1,
  "channel_status": "Belum Bayar",
  "sub_total": 259000,
  "total_disc": 25900,
  "total_tax": 0,
  "grand_total": 233100,
  "add_fee": 0,
  "add_disc": 0,
  "service_fee": 0,
  "items": [
    {
      "salesorder_detail_id": 0,
      "item_id": 43842,
      "qty_in_base": 1,
      "price": 259000,
      "disc": 0,
      "disc_amount": 25900,
      "tax_amount": 0,
      "amount": 233100,
      "unit": "Buah",
      "tax_id": 1,
      "location_id": 2
    }
  ]
}
```

**Create response — HTTP 500, proyeksi field teramati:**

```json
{
  "error": "Internal Server Error",
  "message": "An internal server error occurred"
}
```

Logger menyimpan `providerError.code: null` setelah normalisasi; evidence tidak membedakan apakah field `code` asli tidak ada, null, atau tidak lolos filter. Karena itu, field tersebut tidak dimasukkan sebagai seolah-olah bagian raw response. Field `statusCode` juga tidak direkam; HTTP 500 berasal dari status response HTTP, bukan nilai body yang diasumsikan.

**Perbedaan inti F/G:** `items[0].disc` berubah `10 → 0`; `disc_amount`, line amount, dan seluruh header money tetap sama. `transaction_date`, `note`, dan `ref_no` berbeda karena setiap kasus merupakan request baru dengan referensi terpisah.

### H — nominal Rp20.000 dengan persentase hasil perhitungan: HTTP 200

**Request body aktual** — direkam sebelum dikirim melalui `POST /sales/orders/`:

```json
{
  "salesorder_id": 0,
  "salesorder_no": "[auto]",
  "contact_id": 116918,
  "customer_name": "DISCOUNT-VERIFY-2026-10-14T15-58-21-705Z",
  "transaction_date": "2026-10-14T16:36:55.278Z",
  "is_tax_included": false,
  "note": "DISCOUNT-VERIFY-2026-10-14T15-58-21-705Z-H",
  "ref_no": "DISCOUNT-VERIFY-2026-10-14T15-58-21-705Z-H",
  "location_id": 2,
  "source": 1,
  "channel_status": "Belum Bayar",
  "sub_total": 259000,
  "total_disc": 20000,
  "total_tax": 0,
  "grand_total": 239000,
  "add_fee": 0,
  "add_disc": 0,
  "service_fee": 0,
  "items": [
    {
      "salesorder_detail_id": 0,
      "item_id": 43842,
      "qty_in_base": 1,
      "price": 259000,
      "disc": 7.722007722007722,
      "disc_amount": 20000,
      "tax_amount": 0,
      "amount": 239000,
      "unit": "Buah",
      "tax_id": 1,
      "location_id": 2
    }
  ]
}
```

**Create response — HTTP 200, proyeksi field teramati:**

```json
{
  "id": 68410
}
```

**Konfirmasi `GET /sales/orders/68410` — HTTP 200, proyeksi field teramati sebelum cancellation:**

```json
{
  "salesorder_id": 68410,
  "salesorder_no": "SO-000068410",
  "is_canceled": null,
  "invoice_id": null,
  "source": 1,
  "location_id": 2,
  "sub_total": "259000.0000",
  "total_disc": "20000.0000",
  "total_tax": "0.0000",
  "grand_total": "239000.0000",
  "add_disc": "0.0000",
  "add_fee": "0.0000",
  "service_fee": "0.0000",
  "items": [
    {
      "salesorder_detail_id": 74693,
      "item_id": 43842,
      "qty_in_base": "1.0000",
      "price": "259000.0000",
      "disc": "7.72",
      "disc_amount": "20000.0000",
      "amount": "239000.0000",
      "tax_amount": "0.0000",
      "tax_id": 1
    }
  ]
}
```

Persentase GET berpresisi dua desimal **tidak mengubah nominal** pada pengamatan ini. Jangan menghitung ulang nominal order dari `disc` GET yang sudah dibatasi presisinya. Edit/full-payload dan konversi invoice tetap memerlukan bukti tersendiri.

Cleanup: `POST /sales/orders/cancel/` dengan body `{"ids":[68410]}` mendapat HTTP 200 dan proyeksi response `{"status":"ok"}`. GET berikutnya mengonfirmasi `is_canceled: true`, diskon Rp20.000 dan total Rp239.000 tetap; stock location 2 kembali available 4.

## Kesimpulan investigasi

| Representasi | Hasil sandbox |
|---|---|
| `disc=0`, nominal 0 | A berhasil, SO 68408 |
| `disc=0`, nominal 20000 | B HTTP 500, tanpa ID |
| `disc=10`, nominal 25900 pada gross 259000 | F berhasil, SO 68409; GET mengonfirmasi diskon sekali, total 233100 |
| `disc=0`, nominal 25900 pada gross 259000 | G HTTP 500, message generik, tanpa ID |
| `disc=7.722007722007722`, nominal 20000 pada gross 259000 | H berhasil, SO 68410; GET persentase 7.72 tetapi nominal tetap 20000 dan net 239000 |

**Pemicu perilaku yang berhasil direproduksi:** representasi nominal-only (`disc=0`, nominal positif) pada fixture yang diuji gagal, sedangkan representasi persentase+nominal konsisten berhasil. Perbandingan F/G mempertahankan seluruh money dan mengubah hanya `disc` (selain timestamp/ref unik). Ini bukti diferensial kuat untuk keterkaitan jalur representasi diskon dengan error, bukan sekadar dugaan diskon nonzero tidak didukung.

**Root cause internal belum terbukti:** API tidak mengungkap exception/SQLSTATE spesifik; belum bisa menyatakan pembagian nol, constraint tertentu, kewajiban universal persentase-nominal, atau bug journal. Dokumentasi tidak menyebut constraint tersebut. Kondisi sesaat/order sequence belum sepenuhnya tersingkir oleh satu pair; jangan mengklaim kausalitas universal atau dukungan nominal-only di akun lain.

Arah pemilik: hitung `disc` dari nominal diskon. H membuktikan kandidat tersebut mempertahankan nominal/net tepat pada satu line quantity 1 dengan persentase pecahan. Nominal website tetap menjadi sumber kebenaran; persentase adalah field representasi yang diturunkan, bukan alasan menghitung ulang kupon menggunakan persentase GET yang sudah dua desimal. Tidak menggeneralisasi ke seluruh nominal/capped, quantity >1, edit, atau settlement sebelum ada bukti.

Klarifikasi provider tetap berguna untuk kontrak presisi dan error nominal-only. Tidak menurunkan unit price, menaikkan payment, mengubah account mapping, atau menghapus guard aplikasi.

Pada akhir fase H, budget awal **5/5 request create** terpakai; tiga SO terkonfirmasi (68408/68409/68410) canceled terverifikasi dan B/G tetap unknown. Marker/invoice/payment serta qty 2/dua line belum diuji pada fase itu.

Pemilik kemudian mengizinkan tambahan 5 create dan meminta eksekusi: [J–N](sandbox-followup.md) semuanya berhasil, sehingga total **10/10**. Marker → invoice 45951 → payment 40 pada SO 68411 mempertahankan diskon Rp20.000/net Rp239.000; qty 2, alokasi dua line, dan header discount juga teramati tepat pada kasus terpisah. B/G tidak diretry dan tetap unknown. Tidak ada perubahan aplikasi atau unit/E2E/build/lint; bukti ini tetap tidak otomatis menutup tiket 08/09 atau readiness launch.
