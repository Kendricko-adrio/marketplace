# Protokol verifikasi status mirror setelah invoice/payment — tiket 09

Status: **Lulus setelah review main agent — evidence status mirror post-invoice/payment pada scope M1/M2 tersedia.** Pembuktian pembayaran/provider Rp0 kemudian dicoret oleh pemilik dari scope dan launch gates; lihat [koreksi scope](decision-zero-payment-and-no-service-fee.md).

## 1. Tujuan dan batas izin

Pemilik menyatakan “oke kamu boleh melakukan testing langsung ke jubelio” setelah penjelasan pengujian SO disposable baru, diskon, invoice/payment, lalu edit Status Channel. Dokumen ini merinci batas request aktual untuk dikonfirmasi sebelum eksekusi sesuai aturan akses provider.

Tujuan: membuktikan edit Status Channel setelah invoice/payment mempertahankan diskon, identity, uang dan linkage SO–invoice–payment pada mapping diskon terpilih. Ini pengujian API sandbox langsung oleh main agent, bukan implementasi aplikasi, automated acceptance fitur, perubahan kebijakan atau penutupan launch gate otomatis.

- Gunakan credentials privat akun yang sebelumnya dikonfirmasi pemilik sebagai sandbox; host API bersama tidak membuktikan isolasi production secara mandiri.
- Hanya SO baru milik run ini; tidak mengedit fixtures historis, termasuk SO68440/68441 atau outcome ambigu lama.
- Tidak menguji payable provider0, mengubah source/account/tax/master/stock configuration, memanggil Midtrans, membuat shipment/pickup nyata, refund, cancel, atau cleanup.
- Tidak ada subagent, commit, deploy atau perubahan app/schema/config/seed.

## 2. Pemeriksaan awal yang sudah dilakukan

- Credentials ditemukan secara privat melalui main checkout; nilainya tidak dicetak/disalin. Host cocok dengan konfigurasi sandbox pada research sebelumnya.
- GET publik `https://docs-wms.jubelio.com/dist.yaml` berhasil HTTP200. SHA256 `fef7b217ea527ffd23e9d35a62f1f359e788d507465df3e406d6e6fc30985379`.
- Enam block schema vendor masih sama dengan `docs/jubelio-api/dist.yaml`: `saveSalesOrderRequest`, `getSalesOrderResponse`, `createInvoiceRequest`, `getInvoiceResponse`, `saveSalesPaymentRequest`, `getSalesPaymentResponse`.
- Pada checkpoint penyusunan protokol awal belum login, membaca akun authenticated, atau melakukan business write. Stock terakhir research terdahulu bukan current stock; hasil aktual sesudah approval dicatat pada bagian Hasil.
- API Node.js `fetch`, `AbortSignal.timeout` dan penulisan journal diverifikasi melalui Context7 untuk Node24; [dokumentasi globals](https://nodejs.org/docs/latest-v24.x/api/globals.html) dan [fs](https://nodejs.org/docs/latest-v24.x/api/fs.html).

## 3. Fixture dan expected independen

Konstanta kandidat mengikuti research T1–T3: item157190/group55269, location2, unit Buah, source1 INTERNAL, harga unit1000000, dummy contact116918, tax1/rate0, account2/payment_type0. Semuanya wajib diperiksa ulang sebelum write; tidak mengganti item/lokasi/akun/nominal otomatis bila tidak cocok.

| Kasus | Qty | Gross barang | Diskon whole-line | Net barang | Original ongkir | Net ongkir | Grand/invoice/payment |
| --- | --- | --- | --- | --- | --- | --- | --- |
| M1 | 1 | 1000000 | 100000 (10%) | 900000 | 30000 | 10000 | **910000** |
| M2 | 2 | 2000000 | 200000 (10%) | 1800000 | 30000 | 10000 | **1810000** |

`add_disc`, tax, insurance dan fees provider0. `shipping_cost_discount` **omitted** pada actual create/edit request, bukan0/null. Original30000/net10000 mewakili subsidi merchant20000; bukan journal funding merchant di provider. Harga/diskon disimulasikan langsung pada API, bukan keluaran evaluator diskon aplikasi.

Untuk setiap kasus, urutan wajib:

1. Create SO baru dengan marker `Belum Bayar`; GET independen dan verifikasi seluruh expected.
2. Invoice-only conversion; GET SO+invoice membuktikan linkage dan nominal sebelum edit.
3. Full-payload edit hanya marker menjadi `Menunggu Verifikasi`, **setelah invoice tetapi sebelum payment**. GET SO+invoice wajib membuktikan preservation; paid amount tetap0/due penuh bila terekspos.
4. Payment sekali ke invoice kasus itu, nominal tepat910000/1810000. GET SO+invoice+payment dan filtered invoice list membuktikan satu association yang benar, paid amount tepat, due0.
5. Full-payload edit marker menjadi `Siap Proses`, **sesudah payment**; GET SO+invoice+payment membuktikan preservation dan due0.
6. Full-payload edit marker menjadi `Selesai`; ulangi verifikasi SO+invoice+payment/due0 dan stock. Ini hanya label Status Channel; tidak memanggil endpoint mark-as-complete/WMS atau mengklaim pickup aplikasi benar-benar terjadi.
7. Kasus berikutnya hanya dimulai setelah seluruh pemeriksaan kasus sebelumnya lulus.

Batas utama yang diajukan: **2 create +2 invoice +2 payment +6 mirror**, masing-masing stage satu dispatch tanpa retry. Maksimal3 unit stock sandbox terpakai; payment ledger sandbox total2720000, bukan pembayaran Midtrans/bank nyata. SO/invoice/payment sukses ditinggalkan sebagai artefak research, tanpa cancel post-invoice.

Alternatif batas lebih kecil bila dipilih pemilik: hanya M1, maksimal **1 create +1 invoice +1 payment +3 mirror**, stock1 unit dan payment sandbox910000; M2 tidak dijalankan dan evidence tidak mencakup qty2.

## 4. Endpoint dan preflight

- POST `/login` satu kali menggunakan credentials privat; token hanya in-memory. Tidak automatic relogin atau retry business POST.
- GET `/contacts/116918`, `/inventory/items/157190`, `/taxes/?page=1&pageSize=100`, `/accounts/lookup/all/`; contact harus cocok dummy research existing, item/unit/harga/state dan tax/account harus cocok.
- POST **read-only** `/inventory/items/all-stocks/`, body `{"ids":[157190]}`, sebelum write dan setelah tahap relevan. M1+M2 memerlukan available minimal3 pada preflight awal dan cukup untuk kasus terkait sebelum create.
- GET filtered `/sales/invoices/` dan `/sales/payments/` untuk baseline/reconciliation, pagination bounded dan coverage dicatat. Filter memakai dummy name hanya in-memory, tidak dicetak dalam URL/journal. Response customer tidak disimpan raw.
- POST `/sales/orders/` untuk create ID0/no auto dan mirror memakai SO/detail IDs asli run ini.
- POST `/sales/packlists/create-invoice`, `{"salesorder_id":<SO baru>}` sekali per kasus.
- POST `/sales/payments/`, payment_id0/no auto/account2/type0, amount sesuai tabel dan tepat satu item invoice_id/payment_amount. Identity/account/date mengikuti data sah preflight.
- GET `/sales/orders/<ID>`, `/sales/invoices/<ID>`, `/sales/payments/<ID>` untuk independent verification.

Setiap SO diberi note/ref unik run+case. Mirror mengambil payload documented dari GET terbaru, mempertahankan identity/unit/quantity/detail IDs/harga/persen/nominal/header/original/net shipping; hanya `channel_status` yang sengaja berubah. Alias lokasi `location_id`/`loc_id` diterima hanya bila tidak konflik. Tidak memasukkan shipping discount response default0 ke request. Linkage invoice diverifikasi melalui SO.invoice_id dan identity invoice, bukan mewajibkan invoice.salesorder_id jika API memberi null.

## 5. Acceptance, journal dan safety

- Expected nominal berasal dari tabel §3, bukan menghitung expected dari response yang diuji. Numeric decimal strings boleh dinormalisasi; tidak ada toleransi selisih Rp1 atau field wajib hilang.
- Catat intent dan budget counter **sebelum** tiap business POST; simpan ID segera setelah response tersedia. Journal baru tidak menimpa journal08 atau mereset counter historis40 create attempts; bila kedua kasus dijalankan, maksimum kumulatif42.
- GET sebelum/sesudah edit membandingkan SO/detail/item IDs, unit/tax/location/source/contact/ref, quantity, unit price, diskon whole-line, net barang, sub_total/total_disc/add_disc/tax/fees/original/net ongkir/grand, invoice ID/no dan payment association/account/type/amount/due.
- Invoice detail IDs dan payment association dipertahankan lintas mirror. Persentase GET boleh terformat desimal tetapi tidak digunakan untuk menghitung ulang nominal.
- Stock: create menambah reservation sesuai qty; invoice mengurangi on_hand sesuai qty dan melepas reservation kasus ini; mirror/payment tidak mengubah stock lagi. Baseline lama tetap terpisah, tidak di-adjust agar hasil tampak cocok.
- Marker bukan bukti customer paid atau izin fulfillment aplikasi. SO.is_paid null bukan alasan menganggap payment belum dibayar jika association/paid amount/due sudah terverifikasi.
- **Global stop** pada timeout/network/HTTP5xx/response non-JSON/missing ID/penolakan tak terduga, mismatch identity/uang/linkage/stock atau preflight gagal. Tidak retry write, melanjutkan kasus berikut, mengganti fixture, cleanup atau cancel otomatis.
- Setelah stop, reconciliation hanya GET IDs yang dikenal, filtered lists dan stock read-only. Tidak terlihat di list bukan bukti rollback. Setiap kelanjutan business write memerlukan keputusan baru.
- Evidence disimpan sebagai allowlist projections di `research-09-post-invoice-mirror-results.json`: case/stage, intent, HTTP/code kategori aman, request field presence, IDs, expected/observed uang/status/stock dan stop reason. Tidak menyimpan credentials/token/raw customer/PII/account name/URL query dummy name atau raw error yang berpotensi membocorkannya.
- Setelah eksekusi main agent mereview hasil, mencatat pass/fail/blocked dan batas envelope. Research yang lulus tidak sama dengan aplikasi diskon lulus tests, izin implementasi atau launch. Pada saat protokol disetujui, solusi provider0 masih gate terpisah; kewajiban tersebut kemudian dicoret oleh pemilik sesuai koreksi scope yang ditautkan di awal dokumen.

## Referensi

- [Kontrak provider09 §7](contract-09-provider-representation-and-settlement.md#7-bukti-tersedia-dan-syarat-sebelum-launch).
- [Acceptance G4/P03](acceptance-12-and-specification-outline.md).
- [Research lifecycle sebelumnya](research-08-selected-lifecycle.md) dan [journal](research-08-selected-lifecycle-results.json).
- [Mekanisme status existing](../../apps/store/src/lib/jubelio-channel-mirror.ts), [client edit existing](../../apps/store/src/lib/jubelio-sales-client.ts), [fitur SO](../../docs/features/jubelio-sales-orders.md).

## Approval dan hasil

Pemilik memilih **Dua kasus (Recommended)** melalui `ask_user_question` setelah menerima link protokol lengkap dan ringkasan budget, nominal, side effects serta global stop. Approval mencakup M1/M2, login/read-only lookup dan business writes terbatas sesuai dokumen ini; bukan provider0, order historis, cleanup, implementasi atau launch.

### Eksekusi pertama — berhenti sebelum business write

Run `DISCOUNT09-POSTINV-2026-10-19T15-48-31-472Z`; [journal tersanitasi](research-09-post-invoice-mirror-results.json).

- Login, GET dummy dan GET master berhasil HTTP200. Dummy cocok; group55269, harga1000000, active dan SKU157190 cocok.
- Pemeriksaan unit `(master.sell_unit || master.unit) === 'Buah'` tidak lolos. Belum dapat dipastikan apakah data unit berbeda atau parser probe tidak membaca representasi API yang tepat; ini bukan bukti kegagalan edit post-invoice.
- Global stop dijalankan. **Create0/invoice0/payment0/mirror0**; M1/M2 belum dimulai, kumulatif create tetap40.
- Reconciliation read-only: filtered invoice/payment lists HTTP200, masing-masing14 dan5 records; stock item157190/location2 tetap on_hand9/on_order6/available3, cocok baseline terakhir research08. Tidak ada cancel/cleanup/write lanjutan.
- Enam request aktual:1 login,2 GET fixture/master,2 GET lists dan1 POST stock read-only. Tidak ada app/schema/config/seed edits atau automated app tests.
- `node --check` probe sementara lulus sebelum eksekusi. Pemeriksaan journal membuktikan seluruh business counter0. Research API belum mencapai stage yang membuktikan launch gate.

### Kelanjutan yang memerlukan approval baru

Usulan: izinkan1 login tambahan untuk diagnostic read-only terhadap master/representasi unit dan lookup terdokumentasi yang relevan. Catat hanya projection unit/ID/boolean aman, bukan raw response. Jangan mengganti item/lokasi/unit/harga/account atau mengarang normalisasi agar lolos.

Jika investigasi membuktikan unit fixture memang Buah dengan representation yang sah dan seluruh preflight lain cocok, perbaiki hanya parser probe research lalu jalankan M1/M2 dengan **budget business yang sama dan belum terpakai** (2 create/2 invoice/2 payment/6 mirror; tidak menambah budget). Simpan journal run pertama apa adanya dan gunakan journal continuation yang terhubung. Bila unit benar-benar berbeda/tidak terbukti, atau outcome lain ambigu/mismatch, hentikan write dan laporkan; tidak mengganti fixture otomatis. Pemilik kemudian memilih **Diagnosis dan lanjut (Recommended)** melalui `ask_user_question`. Approval mencakup satu login tambahan, diagnosis read-only dan kelanjutan bersyarat dengan budget business semula yang belum terpakai; bukan perluasan fixture atau nominal.

### Diagnosis unit — root cause terkonfirmasi

[Journal continuation](research-09-post-invoice-mirror-continuation-results.json), run `DISCOUNT09-POSTINV-2026-10-19T15-51-46-336Z`: login tambahan dan GET master berhasil. Projection aktual: `uom_id:-1`, `sell_unit:null`, `buy_unit:null`, `uom_name:"Buah"`; SKU157190 tidak mempunyai override unit.

Ini kesalahan parser probe research, bukan perubahan unit atau kegagalan API mirror. [Research field matrix sebelumnya](research-08-field-matrix-protocol.md#fakta-item-dan-namespace-id) memang mencatat sell_unit null/uom_name Buah. Schema vendor yang tersimpan di repo, `getItemCatalogResponse.uom_name`, juga mendefinisikan Unit of Measure Name ([schema lokal](../../docs/jubelio-api/dist.yaml#L16215)). Enam block yang dibandingkan dengan vendor live pada sesi ini adalah block sales, bukan block katalog; diagnosis unit didukung GET master aktual dan evidence field matrix sebelumnya.

Reproduksi offline terhadap projection aktual membuktikan ekspresi lama tidak membaca unit. Parser probe sementara diperbaiki untuk menerima hanya kandidat unit yang terbukti tepat `Buah`; unknown/missing/conflict tetap ditolak. Replay lokal lulus untuk projection aktual dan menolak tiga kasus negatif (unit Dus, konflik Dus/Buah, unit kosong), tanpa request API. Tidak mengubah kode aplikasi atau master provider.

Selama diagnosis, token tetap hanya in-memory dalam proses probe yang dijeda; tidak ditulis ke file. Kelanjutan menggunakan journal baru yang terhubung ke run pertama, tanpa menghapus stop/counter/evidence sebelumnya. Business writes hanya dilanjutkan setelah pemeriksaan unit ini; seluruh preflight lain dan global stop tetap berlaku.

## Hasil kelanjutan dan review main agent

Dijalankan **2026-10-19 sekitar15:51–15:53UTC**, setelah approval kelanjutan. [Journal continuation tersanitasi](research-09-post-invoice-mirror-continuation-results.json). Run pertama tetap tersimpan sebagai evidence preflight stop; bukan dihapus atau disebut sukses.

### Dokumen dan nominal terverifikasi

| Kasus | SO / detail | Invoice / detail | Payment / detail | Qty | Diskon whole-line | Grand / payment | Hasil |
| --- | --- | --- | --- | --- | --- | --- | --- |
| M1 | **68443 / 74728** | **45974 / 50136** | **59 / 20** | 1 | 100000 | **910000** | Ketiga mirror terverifikasi |
| M2 | **68444 / 74729** | **45975 / 50137** | **61 / 21** | 2 | **200000** | **1810000** | Ketiga mirror terverifikasi; diskon whole-line tidak dikalikan qty lagi |

Per unit price tetap1000000, gross1000000/2000000, net barang900000/1800000. SO tetap menyimpan original ongkir30000, net ongkir10000; add_disc/tax/fees0. Actual create dan seluruh edit request **tidak mengirim** `shipping_cost_discount`; response default0 tidak dianggap input request.

| Tahap untuk kedua kasus | SO Status Channel setelah edit | Invoice paid amount | Payment association / due | Preservation |
| --- | --- | --- | --- | --- |
| Sesudah invoice, sebelum payment | `Menunggu Verifikasi` | 0 | Belum mengirim payment; listed due910000/1810000 | SO/detail IDs, invoice/detail IDs, quantity, harga/diskon/uang/ongkir tetap |
| Sesudah payment terverifikasi | `Siap Proses` | 910000 / 1810000 | Payment59/61 masing-masing tepat satu invoice/SO yang benar, account2/type0, due0 | Seluruh IDs/nominal/association tetap |
| Sesudah marker sebelumnya | `Selesai` | 910000 / 1810000 | Payment/detail IDs tetap, due0 | Seluruh IDs/nominal/association tetap; bukan aksi WMS atau pickup aplikasi |

Seluruh **12 business POST** mendapat HTTP200 dan hasilnya dikonfirmasi GET independen; bukan HTTP200 saja yang menjadi acceptance. SO.is_paid tetapnull sebagaimana evidence08, sehingga paid dibuktikan melalui payment association, invoice paid amount dan due0.

### Stock dan side effects

| Tahap | on_hand | on_order | available |
| --- | --- | --- | --- |
| Baseline continuation | 9 | 6 | 3 |
| Sesudah create M1 | 9 | 7 | 2 |
| Sesudah invoice M1 sampai tiga mirror selesai | 8 | 6 | 2 |
| Sesudah create M2 | 8 | 8 | 0 |
| Sesudah invoice M2 sampai tiga mirror selesai | **6** | **6** | **0** |

Stock turun tepat3 unit akibat invoice; mirror/payment tidak mengubahnya lagi. Reservation lama on_order6 tetap tidak disentuh. Available item157190/location2 sekarang0 menurut lookup terakhir; jangan menjalankan fixture berikut dengan asumsi stock tersedia. Tidak ada stock adjustment, cancel/refund/cleanup, edit order historis atau pembayaran Midtrans. Kedua SO/invoice/payment baru ditinggalkan sebagai artefak sandbox sesuai izin.

### Review terhadap acceptance, bukan hanya exit code

Main agent memeriksa journal terhadap protokol/kontrak09 dan acceptance P03:

- Expected literals M1/M2 diverifikasi secara terpisah terhadap actual request projections dan GET SO/invoice/payment sesudah setiap mirror, termasuk whole-line qty2, harga awal, nominal diskon dan payable.
- SO/detail, invoice/detail dan payment/detail IDs tetap; SO.invoice_id menunjuk invoice yang benar. Invoice.salesorder_id null tetap ditangani lewat SO linkage dan invoice.salesorder_no/identity lain.
- Setiap mirror mengubah target marker yang diharapkan tanpa mengubah core money, financial linkage, protected customer fields atau nonfinancial line attributes. Nilai PII tidak disimpan di journal.
- Paid amount dan due diperiksa melalui GET payment/invoice serta filtered invoice list. Final lists mempunyai coverage lengkap pada filter:16 invoice dan7 payment, termasuk artefak baru; ini bukan audit internal provider universal.
- Stock sebelum/sesudah masing-masing mirror sama; consumption terjadi sekali saat invoice. Tidak ada verifikasi gagal pada continuation.
- Continuation memakai tepat **2 create +2 invoice +2 payment +6 mirror**, **112 request authenticated total** (termasuk login/GET/stock read-only), dan90 pemeriksaan verification di journal. Run pertama6 request memakai0 business write. Total sesi118 request authenticated, dua login berizin; kumulatif research kini**42 create attempts**.
- Pemeriksaan independen main agent terhadap IDs, angka literal, ketiga stage per kasus, seluruh business HTTP200/field omission/budget,90 verification tanpa failure dan stock awal/akhir lulus. `node --check` probe sementara serta replay parser lokal lulus. Tidak menjalankan unit/E2E/build/lint/typecheck aplikasi.

**Kesimpulan:** kewajiban evidence provider untuk status mirror setelah invoice/payment **terpenuhi pada envelope M1/M2 yang disetujui**: source INTERNAL/tax0/account2/type0, satu baris qty1/qty2, unit Buah/price1000000/diskon10%, original30000/net shipping10000, marker Menunggu Verifikasi → Siap Proses → Selesai. Ini mengisi gap stage post-invoice yang belum dibuktikan research08.

Bukan klaim universal untuk semua input/provider config, multi-line/fractional percentage post-invoice, barang net0/provider0, pajak provider nonzero, field excluded, cancel/refund post-invoice atau perubahan stock/WMS. Coverage aplikasi pricing/concurrency/HTTP/browser dan integration terhadap current guards tetap pekerjaan implementasi berizin. Reader/edit guards existing belum diubah untuk mendukung diskon.

**Pembaruan scope sesudah research:** pemilik [mencoret outstanding 2](decision-zero-payment-and-no-service-fee.md), bukan menundanya. Website tanpa service fee; tidak ada kewajiban pembuktian pembayaran/provider Rp0 sebagai research/test requirement atau launch gate. Hasil research ini sendiri tidak membuktikan dukungan provider Rp0 dan tidak mengubah status Ready, approval complete spec, izin implementasi atau launch. Tidak ada commit, push, remote/deployment atau subagent. Izin testing sesi ini telah digunakan sesuai batas; tidak menjadi izin write lanjutan otomatis.
