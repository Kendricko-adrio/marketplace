# Riset input pajak Sales Order Jubelio dan skenario pengujian

Tanggal riset: 2026-10-26 (UTC).
Status terbaru: riset dan **canary B0/B1 create/GET/cancel/stok PASS**. SO68448 NoTax total100000; SO68449 memakai tax_id-2, tax11000, amount/grand111000, seluruh request kasus HTTP200. Keduanya canceled dan stok pulih. Kelanjutan **invoice/payment juga PASS** pada fixture baru SO68450 → invoice45978 → payment67, pajak11000/total111000/paid111000/due0. Fixture settlement dipertahankan paid, stok berkurang satu sesuai izin; jurnal accounting UI dan perubahan aplikasi belum dilakukan. Lihat [hasil create/cancel](jubelio-tax-canary-verification.md#hasil-final--pemilihan-item-available-dan-dua-so-berhasil) dan [hasil settlement](jubelio-tax-canary-verification.md#kelanjutan-invoice-dan-payment--berhasil). §1–10 mempertahankan riset/proposal awal dan §11 discovery sebelum canary.

## 1. Kesimpulan

**Jubelio menyediakan field untuk mengirim pajak pada Sales Order (SO).** Pernyataan di repo bahwa PPN tidak dikirim ke Jubelio menjelaskan keputusan dan batas integrasi aplikasi saat ini, bukan keterbatasan universal API Jubelio.

Schema resmi `saveSalesOrderRequest` memiliki `items[].tax_id`, `items[].tax_amount`, header `total_tax`, dan `is_tax_included`. Keterangan `tax_amount` secara eksplisit meminta pengirim menghitung pajak tiap item. Namun, schema tidak cukup menjelaskan rumus `amount` saat pajak nonzero, mekanisme recalculation, pembulatan, atau keberhasilan konversi invoice/accounting. Bagian tersebut harus dibuktikan dengan fixture baru di sandbox, bukan diasumsikan dari keberadaan field.

Rekomendasi: mulai dengan **kontrol No Tax dan satu SO tax-exclusive sederhana**, tanpa diskon/ongkir/fee. Setelah keduanya terverifikasi, baru ajukan konversi invoice dan payment terpisah. Jangan membuka guard pajak aplikasi hanya untuk eksperimen.

## 2. Sumber dan metode

### Sumber primer yang diperiksa

1. [OpenAPI resmi Jubelio WMS](https://docs-wms.jubelio.com/dist.yaml), diambil melalui GET publik pada tanggal riset; schema `saveSalesOrderRequest` baris 25822–26106, `GET /taxes/` mulai baris 11278, dan `systemsettingTaxesResponse` mulai baris 30473 pada hasil unduhan.
2. [Dokumentasi resmi — Save Sales Order](https://docs-wms.jubelio.com/#operation/postSalesOrders) dan [Taxes](https://docs-wms.jubelio.com/#operation/taxes), sebagai navigasi kontrak. Acuan isi yang benar-benar diperiksa adalah YAML pada sumber 1.
3. Salinan repo: [`docs/jubelio-api/dist.yaml`](../../../docs/jubelio-api/dist.yaml), khususnya `saveSalesOrderRequest` mulai baris 24893 dan `systemsettingTaxesResponse` mulai baris 29544.
4. Implementasi dan histori keputusan repo pada §3, bukan sebagai pengganti kontrak vendor.

SHA-256 seluruh YAML resmi yang diunduh: `974fb2701f52f20ab9cf0613df0d7ae70869afc893046d0f345f255097766dc2`.
SHA-256 salinan repo: `99fff90711c7d638dfe903b0c458ade6e1f721f0ba6617ada02d2c6ef25e8832`.
Seluruh file berbeda, tetapi perbandingan blok **`saveSalesOrderRequest` dan `systemsettingTaxesResponse` identik**. Salinan vendor di repo tidak ditimpa.

Catatan akses: `https://docs.jubelio.com/dist.yaml` mengembalikan HTML ReDoc, bukan YAML, saat riset ini. Karena itu dipakai host dokumentasi WMS di atas. Referensi Shipment tidak dipakai; API Shipment dan Omnichannel berbeda.

Pada tahap awal riset dokumentasi, belum ada POST Jubelio, login, pembuatan SO, invoice, payment, cancel, atau perubahan aplikasi/config. Kelanjutan login dan GET master pajak setelah approval terpisah dicatat pada §11. Tidak tersedia key token/session Jubelio pada `.env` yang diperiksa berdasarkan **nama key saja**; karena login memerlukan `POST /login`, discovery tenant terbaru belum dijalankan. Nilai credentials tidak dicetak. Tidak memakai subagent karena delegasi tidak diotorisasi.

Context7 tidak diperlukan: pekerjaan hanya riset dan Markdown, tanpa implementasi API library/framework. Kontrak Jubelio diperiksa langsung pada sumber primer vendor.

## 3. Review dokumen yang menyatakan pajak tidak dikirim

| Acuan | Isi yang diperiksa | Interpretasi yang tepat |
| --- | --- | --- |
| [`docs/features/jubelio-sales-orders.md:3–18`](../../../docs/features/jubelio-sales-orders.md#L3) | Legacy: barang Rp100.000 → SO/invoice/payment Rp100.000, website/Midtrans Rp111.000 | Histori kontrak legacy; bukan bukti API tidak memiliki pajak. Paragraf juga sudah diberi penanda LEGACY. |
| [`docs/features/jubelio-sales-orders.md:61–67`](../../../docs/features/jubelio-sales-orders.md#L61) | Provider v2 = net barang + net ongkir; PPN website tidak dijurnal provider; `taxAmount: 0` | Kontrak aplikasi sekarang sengaja memisahkan PPN website dan provider. |
| [Keputusan finance tiket 04](../../discounts/wayfinder/04-tax-and-shipping-subsidy-accounting.md#answer--keputusan-final-disetujui) | PPN atas net barang, ceil sekali atas total dasar; pemisahan PPN website/Jubelio dipertahankan | Keputusan pemilik sebelumnya. Riset baru tidak otomatis mencabut keputusan ini atau mengubah kebijakan finansial. |
| [Kontrak provider tiket 09 §3](../../discounts/wayfinder/contract-09-provider-representation-and-settlement.md#3-mapping-so) | Tax record valid rate nol, `tax_amount`/`total_tax` nol, `amount = gross − discount` | Mapping terpilih yang dibuktikan dalam envelope tax0, bukan seluruh kemampuan Jubelio. |
| [Riset migrasi Sales API](jubelio-sales-api-migration.md) §4 dan catatan sampel | Sampel invoice tidak memiliki pajak; dokumen sendiri mengingatkan keterbatasan sampel | Tidak boleh diubah menjadi klaim “semua invoice Jubelio tanpa pajak”. |
| [Bukti lifecycle diskon](../../discounts/research/research-08-selected-lifecycle.md) | Fixture source INTERNAL, NoTax1/rate0, invoice/payment diverifikasi dalam envelope tersebut | Bukti tax0 tidak membuktikan keberhasilan maupun kegagalan tax nonzero. |

### Batas kode saat ini

- [`jubelio-sales-client.ts:731–742`](../../../apps/store/src/lib/jubelio-sales-client.ts#L731) menolak `taxAmount !== 0` sebelum HTTP.
- [`jubelio-sales-client.ts:849–903`](../../../apps/store/src/lib/jubelio-sales-client.ts#L849) sudah membentuk `tax_amount`, `tax_id`, `total_tax`, serta `is_tax_included: false`. Rumus builder menuliskan `amount = gross − discount + tax`, tetapi guard sebelumnya membuat cabang nonzero tax **belum menjadi bukti perilaku provider**.
- [`jubelio-sales-expected.ts:260–296`](../../../apps/store/src/lib/jubelio-sales-expected.ts#L260) juga mengunci tax nol dan payable net barang + net ongkir.
- [`jubelio-sales-client.test.ts:1755`](../../../apps/store/src/lib/jubelio-sales-client.test.ts#L1755) mencakup penolakan pajak nonzero pada aplikasi; bukan test keberhasilan API nyata.

Implikasi: mengganti `JUBELIO_ITEM_TAX_ID` saja tidak cukup. Mengirim nominal berisi pajak tanpa membarui snapshot, verifier, settlement, dan mirror justru berpotensi menahan checkout/fulfillment. Pengujian vendor harus terisolasi dari checkout customer.

## 4. Field pajak: fakta kontrak dan ketidakpastian

| Field | Fakta schema resmi | Hal yang masih harus dibuktikan |
| --- | --- | --- |
| `items[].tax_id` | Required; `number`; referensi Tax ID | ID/rate/account mapping yang benar pada tenant pengujian. Jangan memakai ID1 karena historisnya No Tax. Jangan mengasumsikan ID selalu positif: contoh schema taxes adalah `-1`, sementara aplikasi sekarang membatasi ID positif. |
| `items[].tax_amount` | Required; `number`; deskripsi: “Item Tax Amount NB: You Need to Calculate the tax for every item if you are using tax like PPN” | Apakah nominal seluruh baris atau per unit; apakah diterima persis atau dihitung ulang; apakah wajib cocok dengan rate master. Kasus quantity2 mengisolasi ini. |
| `total_tax` | Required pada header; `number` | Apakah disimpan persis, direkalkulasi dari line, atau ditolak saat berbeda. Usulan awal selalu konsisten dengan jumlah pajak line. |
| `is_tax_included` | Optional pada header; boolean, deskripsi “Whether Tax Included”, contoh false | Semantik harga/subtotal/amount ketika true. Bukan sakelar “aktifkan pajak”; false tidak berarti tax harus nol. |
| `items[].amount` | Required; deskripsi hanya “Item Total Amount” | Apakah total line termasuk atau sebelum pajak untuk masing-masing mode. Belum ada rumus nonzero-tax eksplisit pada schema yang diperiksa. |
| `sub_total`, `grand_total` | Required; angka subtotal dan total | Urutan diskon, pajak, ongkir, serta kemungkinan normalisasi provider. |
| `add_disc` | Deskripsi juga mengingatkan kalkulasi pajak per item | Alokasi pajak atas header discount tidak dijelaskan; sengaja nol pada seluruh usulan awal. |

### Discovery pajak tenant

`GET /taxes/?page=1&pageSize=100` adalah endpoint terdokumentasi. Response menyediakan `tax_id`, `tax_name`, `rate`, `tax_in`, dan `tax_out`.

- Baca semua halaman yang diperlukan; pilih record existing dengan rate yang dimaksud dan akun pajak keluaran yang sesuai. Nilai `rate` pada schema berupa string, contoh `"10.00"`; contoh ini bukan rate tenant atau penetapan tarif pajak.
- Verifikasi record No Tax existing sebagai kontrol. ID1/rate0 hanya bukti historis: [sandbox verification](../../discounts/research/sandbox-verification.md#temuan-read-only).
- Catatan historis tersebut melaporkan GET taxes tanpa pagination HTTP500, tetapi dengan pagination berhasil. Ini alasan memakai parameter dokumentasi, bukan bukti endpoint selalu gagal tanpa parameter.
- Jika record/rate yang diperlukan tidak tersedia atau mapping tidak jelas, berhenti. Jangan membuat tax record, mengubah mapping/account master, atau memilih rate pengganti diam-diam.
- Rate 11% di contoh berikut **asumsi eksperimen** agar mudah dibandingkan dengan website, bukan rekomendasi kepatuhan hukum. Jika tenant berbeda, revisi fixture dan minta approval nominal baru sebelum POST.

## 5. Model input yang diusulkan untuk diuji

Untuk mode tax-exclusive, hipotesis awal yang konsisten dengan builder lokal:

```text
gross_line = price × qty_in_base
net_line   = gross_line − disc_amount
tax_line   = alokasi PPN untuk seluruh baris
amount     = net_line + tax_line               # HIPOTESIS, belum live-verified
sub_total  = Σ gross_line
total_disc = Σ disc_amount
total_tax  = Σ tax_line
grand_total = sub_total − total_disc + total_tax + shipping_cost
```

`add_disc`, `add_fee`, `service_fee`, dan insurance nol; tidak mengirim `shipping_cost_discount`. PPN hanya barang mengikuti keputusan website yang ada. Jangan menambahkan tax sebagai item barang atau fee karena itu tidak membuktikan penggunaan field pajak asli.

### Contoh payload awal B1

Ini **template**, bukan JSON siap kirim. Semua placeholder harus diganti dengan fixture terverifikasi; transaksi harga Rp100.000 memerlukan persetujuan eksplisit bila bukan harga master. Jangan mengedit harga master untuk menyesuaikan contoh.

```json
{
  "salesorder_id": 0,
  "salesorder_no": "[auto]",
  "contact_id": "<ID_NUMERIK_CUSTOMER_DUMMY_TERVERIFIKASI>",
  "customer_name": "<NAMA_DUMMY_TERVERIFIKASI>",
  "transaction_date": "<TIMESTAMP_UTC_SAAT_EKSEKUSI>",
  "is_tax_included": false,
  "note": "<RUN_ID_UNIK>-B1",
  "ref_no": "<RUN_ID_UNIK>-B1",
  "location_id": "<ID_NUMERIK_LOKASI_TERVERIFIKASI>",
  "source": 1,
  "sub_total": 100000,
  "total_disc": 0,
  "total_tax": 11000,
  "grand_total": 111000,
  "shipping_cost": 0,
  "add_fee": 0,
  "add_disc": 0,
  "service_fee": 0,
  "items": [{
    "salesorder_detail_id": 0,
    "item_id": "<ID_NUMERIK_ITEM_TERVERIFIKASI>",
    "qty_in_base": 1,
    "price": 100000,
    "disc": 0,
    "disc_amount": 0,
    "tax_id": "<ID_NUMERIK_TAX_RATE_11_TERVERIFIKASI>",
    "tax_amount": 11000,
    "amount": 111000,
    "unit": "<UNIT_TERVERIFIKASI>",
    "location_id": "<ID_NUMERIK_LOKASI_TERVERIFIKASI>"
  }]
}
```

Tidak mengirim `is_paid: true`: SO bukan bukti pembayaran. Jika B1 ditolak atau `amount` dinormalisasi menjadi net100000, catat sebagai temuan, hentikan tranche, lalu telusuri semantiknya. Jangan langsung mencoba payload alternatif pada SO lama atau melakukan retry create.

## 6. Matriks skenario

Semua angka expected di bawah dihitung independen dari response provider, memakai asumsi rate11%. Ini target yang diuji, bukan hasil aktual. Ongkir nol kecuali D1, header discount/fee nol pada semua kasus. Mode exclusive kecuali I1.

| Kasus | Input | Expected utama | Pertanyaan yang dijawab |
| --- | --- | --- | --- |
| B0 — kontrol | Qty1 ×100000; record No Tax valid; tax0 | Line100000, subtotal100000, total_tax0, grand100000 | Apakah fixture dasar/source/account/location sehat? |
| B1 — pajak dasar | Qty1 ×100000; record pajak11%; tax11000 | Hipotesis line111000, subtotal100000, total_tax11000, grand111000 | Apakah field pajak bisa dipersist dengan nominal benar? |
| Q2 — quantity | Qty2 ×100000; tax seluruh line22000 | Hipotesis line222000, subtotal200000, total_tax22000, grand222000 | Apakah tax_amount seluruh baris, bukan per unit? |
| D0 — diskon barang | Qty2 ×100000; disc10; disc_amount20000; net180000; tax19800 | Hipotesis line199800, subtotal200000, total_disc20000, total_tax19800, grand199800 | Apakah pajak atas net setelah diskon tanpa double discount? |
| D1 — ongkir | Qty1 ×100000; tax11000; shipping30000 | Hipotesis line111000, total_tax11000, grand141000 | Apakah pajak barang tetap11000 dan ongkir tidak otomatis ikut dikenai pajak? |
| R2 — rounding dua baris | Dua line masing-masing qty1 ×100001; dasar200002; PPN order `ceil(22000.22)=22001`; alokasi line11001 dan11000 | Hipotesis amount111002/111001; total_tax22001, grand222003 | Apakah alokasi ceil tingkat order dipertahankan, atau provider menghitung ceil per line menjadi22002? |
| I1 — tax-inclusive, eksplorasi opsional | Qty1; harga termasuk pajak111000; PPN11000; `is_tax_included:true` | Target ekonomi net100000/pajak11000/payable111000; semantik subtotal/amount belum ditetapkan | Apakah provider mengekstrak PPN tanpa menambahkannya dua kali? Perlu konfirmasi payload dari vendor/UI sebelum POST. |

Untuk R2, dua line wajib punya identity berbeda yang bisa diverifikasi, misalnya dua SKU sandbox. Urutan alokasi11001/11000 dibekukan sebelum request, bukan disesuaikan mengikuti response. Jika input price/tax record atau alokasi ditolak, hasilnya incompatibility yang perlu diteliti, bukan alasan mengubah pajak order website secara sepihak.

I1 tidak diperlukan untuk integrasi website saat ini karena harga barang ditampilkan belum termasuk PPN. Jangan mencampurnya ke tranche awal atau menyatakan payloadnya sudah siap.

## 7. Protokol eksekusi yang diusulkan

### A. Preflight — perlu izin login jika token belum tersedia

1. Pemilik mengonfirmasi akun terisolasi/sandbox dan wewenang pengujian; host `api2.jubelio.com` sendiri **bukan bukti sandbox**. Izin eksperimen lama tidak diwariskan ke task ini.
2. Dengan izin khusus, maksimal satu `POST /login`, tanpa mencetak credentials/token. Jika gagal, stop; login ulang membutuhkan keputusan lanjutan.
3. GET taxes berpagination, lokasi, item/unit, customer dummy, stok, dan account mapping relevan. Gunakan endpoint GET yang terdokumentasi; `POST /inventory/items/all-stocks/` tidak termasuk izin GET-only dan harus disebutkan terpisah bila benar-benar diperlukan.
4. Bekukan manifest fixture: tenant teredaksi, item/contact/location/unit, harga transaksi yang disetujui, tax ID/rate/tax_out, qty, semua expected uang, run ID unik, budget dan rencana disposition. Simpan hanya proyeksi non-PII. Jika harga100000 atau record11% tidak cocok, ajukan revisi manifest sebelum write.
5. Cek risiko webhook/sync/worker terhadap fixture. Jangan mematikan config atau service tanpa izin; jika isolasi tidak dapat dijamin, jangan membuat order.

### B. Tranche awal yang direkomendasikan — B0 dan B1 saja

**Usulan budget: maksimal 2 create attempts**, qty1 per SO, harga100000, gabungan grand total211000; tanpa invoice, payment, mirror, Shipment/AWB, stock adjustment, atau edit master/accounting. Budget ini belum menjadi izin eksekusi.

1. Jalankan serial, mulai B0. Catat dispatch intent sebelum setiap POST; timeout tetap menghabiskan satu attempt.
2. Satu `POST /sales/orders/` per kasus. Simpan returned SO ID segera, lalu GET `/sales/orders/{id}` secara independen.
3. Cocokkan source INTERNAL, customer dummy, ref/note, lokasi, item/detail ID, qty, unit, tax ID, mode pajak, harga, diskon, tax line, amount, subtotal, total_tax, grand_total, fee/ongkir serta tidak adanya invoice/payment tak diharapkan. Jangan hanya memeriksa HTTP200 atau header total.
4. Periksa UI SO: label/nominal pajak dan total harus cocok; tidak boleh hanya nominal disamarkan pada harga. Redaksi customer/PII pada bukti. Saat memakai Playwright, artefak di `playwright/mcp/jubelio-tax/`; diagnosis kegagalan dari Markdown, bukan membuka screenshot kegagalan.
5. B1 hanya boleh jalan jika B0 terverifikasi. Periksa stok sebelum/sesudah; SO dapat menahan ketersediaan meskipun belum invoice.
6. Disposition dipilih sebelum eksekusi: **(a)** biarkan dua fixture untuk review, dengan konsekuensi hold stok; atau **(b)** izinkan maksimal satu `POST /sales/orders/cancel/` per SO yang sudah terbukti belum invoice, lalu GET cancel dan stok. Tidak ada cancel otomatis atas outcome ambigu. Cancel tidak termasuk budget default create dan perlu izin eksplisit.

### C. Bukti invoice dan payment — approval terpisah setelah B1

SO yang berhasil belum membuktikan accounting. Untuk B1 yang masih aktif dan terverifikasi, usulkan secara terpisah:

1. Maksimal satu `POST /sales/packlists/create-invoice` dengan SO ID tersebut, hanya setelah GET ulang memastikan belum punya invoice. Jangan membuat invoice langsung lewat payload baru karena itu tidak menguji propagasi pajak SO.
2. Simpan invoice ID sebelum pemeriksaan berikutnya. GET invoice dan SO: pajak line/header11000, net100000, payable111000, mode/tax identity/linkage sesuai. Jika response tidak mengekspos field tertentu, catat batas observasi dan verifikasi melalui UI; jangan menganggap field hilang = nol.
3. Periksa jurnal invoice melalui UI/accounting yang diotorisasi: target ekonomi debit piutang111000, kredit penjualan100000, kredit pajak keluaran11000. Jurnal HPP/persediaan terpisah; pastikan tidak ada `journal_unbalance`. Nama akun aktual mengikuti mapping terverifikasi, bukan contoh ini.
4. Payment memerlukan izin lagi: maksimal satu `POST /sales/payments/` memakai account/type yang disetujui, amount111000, asosiasi tepat satu invoice tersebut. GET payment/invoice membuktikan paid111000 dan due0 serta tax tidak hilang. Tidak memakai Midtrans/customer nyata.
5. Jangan melakukan cancel invoice, refund, reversal payment, atau cleanup accounting otomatis. Disposition fixture post-invoice harus disetujui operator.

Q2, D0, D1, R2, dan I1 merupakan daftar follow-up, **bukan budget write yang sudah diminta sekaligus**. Usulkan manifest/budget masing-masing setelah hasil tranche awal. Full-payload mirror ber-tax nonzero juga perlu bukti tersendiri sebelum aktivasi aplikasi.

### Global stop dan rekonsiliasi

Berhenti pada timeout, 5xx, respons sukses tanpa ID, GET verifikasi gagal, identity/uang berbeda, stock tidak cukup, perubahan fixture/config, atau outcome accounting ambigu. Simpan status `unknown`/mismatch dan ID yang sudah diketahui. Hanya lakukan rekonsiliasi GET yang sah; jangan blind retry, auto-cancel, mengganti tax record, atau melanjutkan kasus berikutnya untuk mencari yang kebetulan berhasil.

Bila ID tidak didapat, pencarian daftar/ref bukan jaminan idempotency atau bukti tidak tercipta. Eskalasi ke operator untuk audit; ref unik hanya membantu penelusuran.

## 8. Kriteria hasil dan evidence

| Tingkat bukti | Boleh disimpulkan | Tidak boleh disimpulkan |
| --- | --- | --- |
| Schema saat ini | Ada input pajak terdokumentasi | Tenant menerima semua variasi pajak |
| B0/B1 + GET/UI cocok | SO menyimpan tax nonzero pada fixture tersebut | Invoice, jurnal, payment, dan pembulatan sudah benar |
| Konversi invoice + jurnal cocok | Pajak fixture diteruskan dan dipetakan ke accounting sesuai observasi | Semua diskon/ongkir/multi-line/mirror aman |
| Payment + GET cocok | Settlement fixture termasuk pajak cocok | Integrasi aplikasi sudah siap production |

Catatan hasil per kasus minimal berisi: run ID, waktu UTC, manifest input teredaksi, expected independen, actual request finansial, jumlah dispatch tiap endpoint, HTTP/error code, SO/detail/invoice/payment IDs bila ada, proyeksi GET finansial, temuan UI/jurnal, stock sebelum/sesudah, disposition, dan status pass/fail/unknown. Jangan menyimpan token, credentials, response customer mentah, atau PII.

## 9. Dampak bila kelak pajak diaktifkan pada aplikasi

Butuh keputusan baru pemilik yang menggantikan pemisahan PPN sebelumnya, lalu spec/plan lengkap yang disetujui. Area yang perlu ditelusuri meliputi snapshot/versioning provider, tax identity/rate dan alokasi per baris, create/GET verifier, expected payable, invoice/payment authority, channel-status mirror full-payload, recovery, kompatibilitas order lama, tests dan deployment config. Ini daftar dampak riset, **bukan izin implementasi**.

Contoh target: barang100000 + PPN11000 → customer/Midtrans tetap111000; Jubelio berubah dari100000 menjadi111000, bukan customer dikenai122000. Jika delivery ongkir30000, kedua payable menjadi141000 tanpa pajak ongkir. Tidak membuat jurnal PPN kedua apabila pajak yang sama sudah dicatat di sistem/accounting lain; disposition pencatatan lama perlu keputusan bisnis.

## 10. Verifikasi riset ini

- GET publik YAML resmi berhasil; dua blok schema dibandingkan dengan salinan repo dan identik.
- Klaim pemisahan PPN ditelusuri ke dokumen keputusan dan guard kode.
- Pada tahap awal belum ada autentikasi/discovery tenant baru. Kelanjutan login dan GET master pajak dicatat pada §11; tetap belum ada POST transaksi pengujian, pengujian UI, atau bukti invoice/payment tax nonzero.
- Tidak menjalankan unit/E2E/build/typecheck: hanya dokumentasi, tidak ada perubahan behavior.

## 11. Hasil discovery master pajak — API tenant aktual

Pemilik mengizinkan **maksimal satu POST /login**, lalu GET master pajak seluruh halaman melalui pilihan `Izinkan (Recommended)`. Izin tidak mencakup SO, invoice, payment, cancel, atau perubahan master/config.

Eksekusi 2026-10-26 sekitar **15:50:50 UTC**, host `https://api2.jubelio.com`:

- `POST /login`: HTTP200, satu attempt; token hanya di memory proses.
- `GET /taxes/?page=1&pageSize=100`: HTTP200; `totalCount: 6`, enam record diterima, seluruh halaman selesai dalam satu GET.
- Output hanya memuat proyeksi field master pajak di bawah; tidak menyimpan credentials/token atau customer PII.

| `tax_id` | `tax_name` | `rate` | `tax_in` | `tax_out` |
| --- | --- | --- | --- | --- |
| -2 | PPN 11% | 11.00 | 1-1303 PPN Masukan | 2-2103 PPN Pengeluaran |
| -1 | PPN 10% | 10.00 | 1-1303 PPN Masukan | 2-2103 PPN Pengeluaran |
| -4 | `PPN_12% ` | 12.00 | 1-1303 PPN Masukan | 2-2103 PPN Pengeluaran |
| -3 | PPH 23 | -2.00 | 1-1390 PPH Pasal 23 Dibayar di Muka | 2-2197 Hutang PPH 23 |
| -5 | PPH 22 | 0.00 | 1-1393 PPH Pasal 22 Dibayar Dimuka | 2-2189 Hutang PPH 22 |
| 1 | No Tax | 0.00 | null | null |

Nama `PPN_12% ` memang memiliki trailing space pada response; rate PPH23 memang negatif dan PPH22 nol. Ini data konfigurasi tenant, bukan validasi ketepatan perpajakan.

**Implikasi terverifikasi:** record PPN11% pada tenant ini adalah `tax_id: -2`, bukan11 atau1. ID negatif merupakan data master aktual, bukan error. Guard positif tax ID pada aplikasi saat ini perlu ditinjau dalam rencana terpisah apabila hendak memakai record tersebut; tidak ada guard/config yang diubah dalam discovery ini.

**Yang belum terbukti:** keberhasilan create SO dengan tax ID-2, nominal pajak nonzero, propagasi invoice, jurnal, payment, dan kesesuaian rate11% dengan kebijakan hukum/bisnis yang berlaku. Belum ada business-write fixture; hasil GET sendiri tidak mengotorisasi eksekusinya. Pemilik kemudian memberi izin bounded dua SO + cancel, tetapi preflight berhenti sebelum create; lihat [hasil canary](jubelio-tax-canary-verification.md).
