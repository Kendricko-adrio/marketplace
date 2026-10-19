# Research tiket 08 — bukti kontrak diskon nonzero Jubelio

## Ringkasan dan status

**Tiket08 resolved pada scope terpilih yang disetujui**, setelah review T1–T3 dan evidence existing. Mapping source INTERNAL/tax0: diskon barang per baris/total_disc, add_disc0, original ongkir padaSO dan net shipping, shipping_cost_discount omitted. T1qty1 danT2qty2 satu baris membuktikan full mirror sebelum invoice, invoice/payment exact dan association/due0; T3 membuktikan mirror lalu safe cancel pre-invoice/stock restore. Fixed/capped/precision didukung evidence terdahulu. Unit field excluded/funding/header nonzero dan legacy ambiguity tetap keterbatasan di luar gate approved; bukan proof universal atau klaim launch-ready. Kontrak lengkap09/implementasi tetap terpisah.

Artefak:

- [Protokol, hasil T1–T3 dan review acceptance final](research-08-selected-lifecycle.md), [journal](research-08-selected-lifecycle-results.json).
- [Scope bukti08 yang direvisi dan disetujui](research-08-approved-proof-scope.md), [arah mapping terpilih](research-08-selected-shipping-mapping.md).
- [Hasil matriks field terbaru](research-08-field-matrix-evidence.md), [protokol approved](research-08-field-matrix-protocol.md), [journal](research-08-field-matrix-results.json).
- [Protokol write tranche20](research-08-write-protocol.md).
- [Evidence JSON write tranche20](research-08-write-results.json).
- [Evidence JSON fase read-only](research-08-results.json).
- [Evidence awal A–H](sandbox-error-investigation.md), [JSON awal dan J–N](sandbox-results.json), [hasil J–N](sandbox-followup.md).

### Riwayat tranche20

Pada tranche20, pemilik mengizinkan **10 request create SO lagi** dan meminta research diteruskan. Tranche itu memakai **10/10 create attempts**, termasuk tiga definite HTTP400 rejections. Evidence existing sudah mencatat 10 create A/B/F/G/H/J/K/L/M/N; total rangkaian **20 create attempts**, bukan 20 SO berhasil. Tujuh SO baru mendapat ID, empat canceled, dua terkonfirmasi invoice/payment, satu menunggu reconciliation conversion.

Koreksi counter: saat protokol awal tranche ini dibuat, J–N baru tersedia di repo dan belum terbaca, sehingga baseline sempat 5. Setelah membaca `sandbox-followup.md`, baseline journal dikoreksi ke10 sebelum request ke3 tranche ini. Event historis dua kasus pertama tidak ditimpa; event `counter-correction-existing-evidence` mencatat correction. Budget tranche terbaru tetap10, tidak ditumpuk dengan izin5 sebelumnya.

## Scope, izin, dan manual review

- Pemilik menyatakan credentials `.env` merupakan sandbox. Host API bersama bukan bukti isolasi; sumber konfirmasi akun adalah pemilik.
- Credentials dibaca privat dari main checkout yang ditemukan lewat Git common directory; token/nama contact/account hanya in-memory. Tidak ada token, raw customer response, atau PII pada artefak baru.
- Prerequisite04/07 resolved. Finance04 mempertahankan provider tanpaPPN, PPN website atas net barang saja, funding subsidi merchant, serta pemisahan goods/shipping.
- Pemilik mengirim screenshot list dengan filter `Semua`, detail F/H, kemudian menyatakan tidak melihat reference berakhiran B/G. Ini manual-review evidence operator, **bukan bukti backend rollback**. B/G tidak diretry atau dimutasi; request baru memakai refs/fixtures independen.
- Screenshot berisi data customer lain; gambar asli tidak disalin ke repo dan data tersebut tidak ditranskripsikan.
- Maksimal10 create baru, qty1–2, maksimal2 baris, source1 INTERNAL, No Tax1, harga master tetap, account2 diperiksa viaGET. Stock recheck sebelum setiap create.
- Tidak ada perubahan aplikasi/schema/env/master/account mapping, order non-fixture, source marketplace, subagent, commit, deployment, atau unit/E2E/build/lint/typecheck aplikasi. Runner sementara di OS temp hanya untuk research.

## Sumber dan metode

1. Baca tiket08, finance04, izin07, tujuan mapping09, serta research existing; tidak mengubah keputusan produk/accounting.
2. Context7 resolve Jubelio `/websites/jubelio`, query targeted SO INTERNAL/diskon/ongkir/invoice/payment. Hasil memberi field/endpoint, bukan formula precedence. Path singular dari indeks tidak digunakan untuk writes; endpoint aktual mengikuti spec resmi/client repo.
3. Fresh GET [spec resmi WMS](https://docs-wms.jubelio.com/dist.yaml), HTTP200. SHA256 `da60b57131f4476f12c029f9dc34f6ca5fd6cdc64e89d5e30eb09ef2d41e9935`.
4. Tujuh block normalized cocok dengan [vendor spec](../../docs/jubelio-api/dist.yaml): `saveSalesOrderRequest`, `getSalesOrderResponse`, `saveInvoiceRequest`, `getInvoiceResponse`, `saveSalesPaymentRequest`, `getSalesPaymentResponse`, `createInvoiceRequest`. Ini bukti field existence, bukan seluruh semantics runtime.
5. Authenticated GET terpisah dari create/write untuk konfirmasi identity, detail IDs, quantity, price, nominal/baris/header, linkage invoice/payment, serta stock. Expected Rupiah dihitung dari input independen, bukan dari output provider.
6. Dispatch intent/counter ditulis sebelum setiap business write. HTTP400 structured Bad Request diperlakukan definite rejection sesuai [client repo](../../apps/store/src/lib/jubelio-sales-client.ts#L1064); 5xx/network/success tanpaID atau write confirmation yang belum diketahui menghentikan business writes. Read-only reconciliation boleh berjalan, tidak ada blind retry.

Fase read-only awal sempat memakai endpoint salah `/contacts/customers/116918` dan mendapat404. Spec menunjukkan `/contacts/{id}`, lalu `/contacts/116918` berhasil. Tidak ada business writes sebelum koreksi path tersebut. Ini kesalahan runner contact lookup, bukan root cause error diskon.

## Hasil tranche terbaru

Label `L` pada tranche ini berbeda dari kasus L existing: bedakan run ref `RESEARCH08-2026-10-14T17-17-36-342Z-…` dari run lama `DISCOUNT-VERIFY-…`.

| Create ke | Kasus | SO / hasil | Evidence dan disposition |
| --- | --- | --- | --- |
| 1 | Q — qty2 | 68416 | Gross518000, disc10, nominal51800, net466200. Whole-line konsisten; cancel + stock restore terverifikasi. |
| 2 | L — dua baris + settlement | 68417 | Diskon10177+9823=20000, net489000 tetap pada create/mirror/invoice45952/payment42, association satu kali, due0. Ditahan sebagai audit sandbox terbayar. |
| 3 | S — shipping tanpa subsidi | 68418 | Goods259000 + shipping30000 = payable289000; invoice45953/payment44 tepat, association/due0. Ditahan sebagai audit sandbox terbayar. |
| 4 | F1 — semua field shipping/funding kandidat | HTTP400, tanpaID | Definite rejection. Exact validation field tidak direkam saat itu; jangan menyimpulkan semua field unsupported dari F1. Tidak retry. |
| 5 | R — input persen dua desimal | 68419 | Input disc7.72, nominal20000; GET mempertahankan net239000, bukan nominal19994.80. Cancel + stock restore. |
| 6 | F2 — shipping_cost_discount saja | 68420 | Shipping10000, discount20000 tersimpan, grand269000. Cancel + stock restore; tidak invoice. |
| 7 | F3 — original_shipment_cost saja | 68421 | Shipping10000 dan original30000 tersimpan, grand269000. Cancel + stock restore; tidak invoice. |
| 8 | F4 — seller funding | HTTP400, tanpaID | Response validation menyebut shipping_fee_discount_seller, kategori not-allowed. Tidak retry. |
| 9 | F5 — platform funding | HTTP400, tanpaID | Response validation menyebut shipping_fee_discount_platform, kategori not-allowed. Tidak retry. |
| 10 | F6 — goods discount + shipping subsidy | 68422 | Create/mirror tepat: goods net239000, shipping10000, original30000, discount shipping20000, payable249000. Invoice conversion HTTP500/code23113 tanpaID. Semua business writes dihentikan; tidak payment/cancel/retry. |

Jumlah gross barang seluruh10 attempts: **Rp3.099.000**, termasuk rejected payloads. Pajak dan provider fees nol pada semua kasus. Rejected field experiments tetap mengonsumsi budget.

## Fakta provider yang dapat digunakan

### 1. Nominal baris, quantity, dan precision

Q serta K existing mengamati `disc_amount=51800` sebagai potongan satu baris qty2/gross518000, net466200. Bukan net414400 akibat mengalikan nominal per-unit lagi. Ini membuktikan whole-line representation yang konsisten pada fixtures tersebut, bukan precedence universal untuk input metadata saling bertentangan.

H existing: input disc7.722007722007722, GET disc7.72, nominal20000/net239000. R baru: **input disc sudah7.72**, nominal20000/net239000 juga tetap. Maka setidaknya pada kasus ini provider tidak mengganti nominal dengan `259000×7.72%=19994.80`. Nominal website tidak boleh dihitung ulang dari field persen GET.

Unknown: disc-only, nominal-only dengan disc0 yang aman, dan precedence ketika metadata berbeda jauh. P/D yang sengaja inconsistent tidak dijalankan; slot terakhir digunakan untuk shipping lifecycle. B/G500 tanpaID bukan bukti kontrak penolakan nominal-only universal atau akar exception.

### 2. Fixed/capped allocation dan lifecycle dua baris

Input independen L:

- Gross259000+250000=509000.
- Order discount20000; proporsi ideal10176.817…/9823.182…; largest remainder menghasilkan10177+9823=20000.
- Net248823+240177=489000.
- Input disc derived masing-masing3.929343629343629 dan3.9292000000000002, tanpa pembulatan sebelum serialisasi.

GET kedua persen menjadi3.93, tetapi nominal tetap10177/9823. Full-payload marker edit dari GET membawa persen pendek3.93 dan detail IDs74701/74702; hanya marker ditargetkan menjadi Menunggu Verifikasi. GET setelah edit mempertahankan money dan identities. Invoice45952 membawa detail IDs asal, quantity/price/disc_amount/amount, total_disc20000/net489000. SO GET mengonfirmasi invoice_id45952; invoice salesorder_id null tidak dipakai sebagai satu-satunya linkage.

Payment42 hanya dikirim sekali sebesar489000. GET akhirnya membuktikan satu association invoice45952/SO68417/payment_amount489000/due0. Invoice payment_amount489000 dan list invoice due0 memperkuat settlement. Tidak membayar gross509000.

**Insiden GET payment:** GET pertama `/sales/payments/42` mendapat500/code `No data returned from the query.` setelah POST200. Business writes dihentikan; invoice/list payment menunjukkan aplikasi pembayaran. GET read-only berikutnya pada path yang sama mendapat200 dan association tepat; stop dapat dicabut tanpa retry payment. Penyebab internal transient read error belum diketahui; jangan mengklaim replica latency sebagai fakta.

### 3. total_disc dan add_disc

Evidence existing M/N pada [sandbox followup](sandbox-followup.md#temuan-kontrak-yang-teramati):

- M: gross259000, line disc0, total_disc0, add_disc10000, grand249000.
- N: line/total_disc20000, add_disc5000, grand234000, line amount239000.

Pada fixtures tax/fee/shipping0, total_disc menyimpan jumlah diskon baris dan **tidak mencakup add_disc**. Formula observasional konsisten dengan `gross−total_disc−add_disc`; bukan permission menggunakan add_disc untuk subsidi ongkir. Tranche terbaru tidak mengulang A1/A2 karena evidence M/N sudah tersedia. Preservation header-discount sampai invoice/payment belum diuji; initial mapping yang memakai add_disc0 tidak boleh menyiratkan support seluruh kombinasi header.

### 4. Shipping yang writable dan batasnya

| Field | Request schema inspected | Runtime INTERNAL pada tranche ini |
| --- | --- | --- |
| shipping_cost | Ada | S:30000 dipertahankan sampai invoice/payment; payable289000 |
| original_shipment_cost | Tidak ada di create schema inspected | F3/F6 accepted dan tersimpan di SO; F6 mirror mempertahankannya |
| shipping_cost_discount | Tidak ada di create schema inspected | F2/F6 accepted dan tersimpan di SO; F6 mirror mempertahankannya |
| shipping_fee_discount_seller | Tidak ada | F4 HTTP400/not-allowed; jangan pakai sebagai writable field pada endpoint ini |
| shipping_fee_discount_platform | Tidak ada | F5 HTTP400/not-allowed bahkan dengan nilai0 |

Ini memperbarui research lama: absence dari request schema bukan bukti field pasti ditolak; direct write+GET F2/F3 membuktikan dua extension benar-benar diterima. Namun acceptance SO tidak cukup untuk menyatakan mapping settlement aman.

S membuktikan goods259000+shipping30000=289000 sampai invoice45953/payment44/due0. F2 mengirim shipping **net10000** dan metadata discount20000 dengan grand269000; GET mempertahankan keduanya, tidak mengurangi nominal lagi pada observed SO. Tidak mengasumsikan provider secara otomatis menghitung net shipping dari gross; uang header dikirim eksplisit.

### 5. F6: journal_unbalance pada conversion

F6 merupakan gabungan yang secara aritmetika customer konsisten:

```text
Goods gross259000 − goods discount20000 = goods net239000
Original shipping30000 − shipping subsidy20000 = net shipping10000
Payable goods239000 + net shipping10000 = 249000
```

SO68422 dan full-payload mirror berhasil, termasuk original_shipment_cost30000/shipping_cost_discount20000. Konversi `POST /sales/packlists/create-invoice` dengan salesorder_id68422 mendapat **HTTP500/code23113**. [Error code list resmi/vendor](../../docs/jubelio-api/dist.yaml#L109) memetakan23113 ke `journal_unbalance` (debit/credit berbeda).

**Yang belum terbukti:** akar mismatch journal, account mapping mana yang diperlukan, apakah shipping_cost harus gross pada jalur ini, apakah subsidy subtract dua kali pada conversion, atau side effects parsial conversion. Jangan memperbaiki config/account mapping atau mengirim nominal payment yang dinaikkan untuk menutupi error. F6 menggabungkan beberapa faktor, sehingga failure tidak mengisolasi penyebab satu field.

Reconciliation terakhir:

- SO68422: invoice_idnull, aktif (`is_canceled`null), marker Menunggu Verifikasi, seluruh money tetap249000.
- List invoices dummy hanya45951/45952/45953 dengan due0; tidak terlihat invoice baru untuk68422.
- List payments dummy hanya40/42/44; tidak ada payment untukF6.
- Item43842/location2: on_hand1, on_order1, available0. Item43843/location2: on_hand0, on_order0, available0.

Ini bukan bukti rollback conversion. SO68422/stock reservation tetap membutuhkan operator/support disposition. **Tidak cancel otomatis** setelah invoice conversion ambigu, walaupun invoice_idnull pada GET; tidak retry conversion dan tidak kirim payment.

## Evidence quality dan cleanup

Journal baru menyimpan money/request projections allowlist, bukan raw bodies. Quantity/discount/header/IDs/ref yang relevan tersedia pada dispatch/input dan GET. Identity/date/unit/note digunakan in-memory, tetapi tidak semua muncul pada input projection; jangan menyebut projection sebagai full actual raw request. Protokol menjelaskan constant unit/source/fixture dan endpoint.

F1 awal tidak merekam exact error message, sehingga exact validation field tidak dapat direkonstruksi. F4/F5 merekam kategori notAllowed serta daftar nama field allowlist yang terdapat dalam message; daftar memakai substring matching, sehingga `disc` juga muncul akibat nama compound shipping field. Ini bukan bukti bahwa items[].disc ditolak. Nama compound seller/platform dan notAllowed adalah evidence relevan untuk kedua kasus isolated tersebut.

Empat fixture canceled baru:68416/68419/68420/68421, money preserved dan stock kembali ke baseline masing-masing. Dua artefak settlement baru:68417/invoice45952/payment42 dan68418/invoice45953/payment44. Tidak cancel setelah invoice. Stock consumed2 unit43842 dan1 unit43843 oleh kedua invoices baru; berbeda dari stock reserved1 oleh F6.

Dijalankan: Context7/spec GET, authenticated reads,10 create attempts,2 mirror writes,4 eligible pre-invoice cancellations,3 invoice-conversion attempts (2success/1ambiguous500),2 payment creates tanpa retry, independent GET/list/stock reconciliation. Tidak ada application validation runs karena tidak ada perubahan aplikasi.

## Reconciliation SO68422 setelah instruksi pemilik

Pemilik meminta reconciliation68422 dilanjutkan dan menyatakan klarifikasi accounting subsidi melalui operator/support dapat di-skip. Klarifikasi accounting tersebut **ditunda/tidak dikerjakan**, bukan dianggap terjawab atau menjadi approval mapping/waiver seluruh bukti wajib. Tidak ada kontak support, retry conversion, payment, atau cancellation pada fase ini.

Recheck read-only pada2026-10-14 sekitar17:31UTC, evidence event `F6-reconciliation-start` hingga `F6-reconciliation-summary`:

- GET SO sebelum dan sesudah reconciliation konsisten: SO68422/source1/location2, invoice_idnull, is_cancelednull, is_paidnull, marker Menunggu Verifikasi, grand249000. Goods discount20000/net239000, net shipping10000/original30000/subsidy20000 tetap.
- Daftar invoices dummy `totalCount=3`:45951/45952/45953. GET detail ketiganya membuktikan nomor SO68411/68417/68418, **tidak linked ke68422**.
- Daftar payments dummy `totalCount=3`:40/42/44. GET detail ketiganya membuktikan associations ke tiga invoices/SO lain tersebut; **tidak ada association ke68422**.
- `/sales/` juga hanya mengembalikan tiga invoices tersebut. Cancel list11, completed/failed/ready-to-process0;68422 tidak muncul pada projection status tersebut meskipun detail GET membuktikan SO masih ada.
- Pagination semua list selesai pada page1/pageSize100: returnedRows sama dengan totalCount, bukan hanya memeriksa halaman pertama dari hasil yang lebih besar. `coverageComplete` pada JSON berarti lengkap untuk endpoint/filter tersebut, **bukan semua state internal/audit backend**.
- Stock43842/location2 tetap on_hand1/on_order1/available0; satu unit masih reserved. Stock43843/location2 on_hand0/on_order0/available0.

**Kesimpulan reconciliation:** tidak ada invoice/payment terkait68422 yang terlihat pada seluruh hasil filtered endpoints dan detail candidates yang diperiksa; SO serta reservation masih ada. Status observed tetap pre-invoice, tetapi rollback/absence side effects internal conversion500 belum dapat dipastikan dari public API. Stop business writes tetap aktif; fixture68422 tidak ditandai canceled/paid/cleanup selesai.

Untuk menentukan disposition/cleanup berikutnya tanpa klarifikasi accounting support, pemilik dapat memeriksa detail SO68422 dan faktur/riwayat terkait di UI, lalu memutuskan apakah fixture dipertahankan sebagai artefak investigasi atau meminta cancellation terpisah setelah state aman dikonfirmasi. Instruksi reconciliation sendiri tidak diperlakukan sebagai izin otomatis cancellation setelah outcome conversion ambigu.

## Remaining unknowns dan next action

Bukti wajib scope08 telah dipenuhi T1–T3/evidence existing dan direview pada [acceptance final](research-08-selected-lifecycle.md#review-acceptance-tiket08). Daftar berikut adalah batas kontrak/handoff dan follow-up terpisah, bukan status gate08 yang belum selesai.

1. **Envelope mapping terpilih:** payment/full mirror sebelum invoice/qty>1/safe cancel pre-invoice terverifikasi dalam T1–T3. Jangan memperluasnya menjadi klaim semua stage/nominal/source/account. Invoice original metadata tetap tidak tersedia; acceptance SO original + nominal/linkage lifecycle sudah disetujui. SO is_paid masihnull pada fixtures paid, sehingga bukti settlement memakai payment association/due dan invoice paid amount.
2. **Outcome lama B/G dan fixtures conversion error:** audit rollback/disposition belum tersedia. Pemilik menyetujui follow-up terpisah, bukan penghalang bukti kontrak baru; unknown tidak berubah menjadi verified, tidak retry/cancel tanpa izin dan state aman.
3. **Precedence universal:** disc0+nominalpositive dan disc-only/inconsistent metadata belum memiliki kontrak aman. Nominal exact + derived/nonzero percentage adalah observed supported envelope, bukan semua input. Unknown tetap dicatat; jangan mengklaim support input yang tidak dibuktikan.
4. **Di luar scope awal:** header add_disc nonzero, unit/dukungan field shipping/funding yang tidak dipakai, negative/refund/post-invoice cancel/provider tax nonzero serta semua edits post-invoice belum dibuktikan oleh T1–T3. Mapping awal add_disc0/discount field omitted dan pemisahan funding website tetap; root journal/account treatment untuk field excluded tidak dianggap diketahui.

Jika jalur support kelak dibuka kembali, request dapat menyertakan run refF6, timestamp event F6-invoice-create di JSON, SO68422, code23113, source1/NoTax1 dan money projection di atas, tanpa credentials/PII. Pada scope terbaru tidak ada request support yang dijalankan. Jangan mengubah SO68422 sebelum disposition/state aman ditentukan.

**Tiket08 resolved sesudah review scope approved.** Riwayat tranche20, tiga tambahan tunggal, matriks10, ablation2, serta hipotesis persen2 membuat baseline37. Setelah pemilik menyetujui T1–T3, tambahan3 create/3 mirror/2 invoice/2 payment/1 eligible cancel memenuhi bukti aktif. Kumulatif sekarang **40 create attempts**, bukan40 successful SO; tidak ada izin write lanjutan otomatis. Pilihan **barang + net ongkir**, original sebelum subsidi/shipping net/discount field omitted dan [scope bukti yang direvisi pemilik](research-08-approved-proof-scope.md) menjadi dasar penutupan, bukan waiver baru dari agent. Legacy ambiguity tetap follow-up terpisah. Tiket09 kini unblocked tetapi open/unclaimed; complete contract09 dan implementasi tetap memerlukan proses serta approval tersendiri.

## Retest2026-10-18 dengan item pengganti

[Protokol, otorisasi, checkpoint, serta hasil](research-08-retest.md), [journal create](research-08-alternative-retest-results.json), dan [journal continuation](research-08-alternative-retest-continuation.json).

- Retest item43842/location2 terblokir sebelum create karena available0; tidak ada retry SO68422.
- Setelah pemilik meminta dan menyetujui item lain, item60344/location2 memiliki stock1 dan harga650000. Satu SO baru**68423** dibuat: qty1, disc3.08/nominal20000, net barang630000; original shipment30000, shipping discount20000, net shipping10000, grand640000.
- Create dan GET nominal berhasil. Script awal sempat salah menganggap lokasi baris tidak tersedia karena mengabaikan alias `loc_id`; merujuk parser existing dan GET ulang membuktikan loc_id2/detail74708. Tidak ada create ulang, guard aplikasi tidak diubah.
- Mirror sekali berhasil; GET mempertahankan semua nominal. **Conversion invoice sekali kembali HTTP500/code23113**, tanpaID. Tidak retry, payment, atau cancel.
- GET reconciliation: SO68423 invoice_idnull, is_canceled/is_paidnull, marker Menunggu Verifikasi, grand640000. Stock60344/location2 on_hand1/on_order1/available0. Dua filtered lists invoice/payment masing-masing3/totalCount3 hanya menampilkan artefak lama; ini bukan audit internal/proof rollback.

Kesimpulan: error yang sama teramati pada **varian** skenario subsidi dengan item/harga/persentase berbeda. Belum membuktikan akar accounting/field penyebab dan tidak membuktikan safe settlement subsidi. SO68423 kini juga memerlukan manual UI/audit disposition sebelum cleanup; SO68422/B/G tetap unknown terpisah. Tidak ada perubahan aplikasi/master/account mapping, application validation runs, subagent, atau commit. Required proof08 tidak ditutup otomatis.

## Test endpoint gabungan invoice/payment2026-10-18

Setelah menerima perbedaan endpoint dan risiko payment internal, pemilik menyetujui satu fixture baru item43825/location2, harga650000, diskon20000/net630000, original shipping30000/subsidy20000/net10000, grand640000. [Protokol/hasil](research-08-combined-retest.md), [journal tersanitasi](research-08-combined-retest-results.json).

Create**SO68424**/detail74709 dan full-payload mirror berhasil; GET seluruh nominal/identity cocok. Satu POST `/sales/packlists/create-invoice-payment` dengan ID68424 kembali **HTTP500/code23113**, tanpa invoiceID. Tidak ada invoice-only atau POST payment terpisah untuk fixture ini.

Reconciliation GET: SO68424 invoice_idnull, marker Menunggu Verifikasi, is_canceled/is_paidnull, grand640000. Stock43825/location2 on_hand1/on_order1/available0. Filtered invoice/payment lists lengkap menurut totalCount masing-masing3, hanya artefak lama. Payment internal tetap unknown karena request gabungan sudah dikirim dan absence pada API bukan proof rollback.

Error yang sama teramati pada endpoint gabungan, tetapi item berbeda dari test invoice-only; akar accounting/field penyebab serta atomicity belum terbukti. Stop business writes aktif; tanpa retry/cancel atau perubahan SO68422/68423. SO68424 kini juga memerlukan manual UI/audit disposition sebelum cleanup. Total kumulatif22 create attempts pada akhir test gabungan ini, bukan22 successful SO. Tidak ada perubahan aplikasi/schema/master/account mapping, application validation runs, subagent, atau commit. Tiket08 tetap claimed.

## Test diskon integer exact2026-10-18

Pemilik menduga fractional percentage/ketidaksesuaian disc dengan nominal terhadap price, lalu menyetujui satu test gabungan baru dengan integer exact. [Protokol/hasil](research-08-integer-discount.md), [journal](research-08-integer-discount-results.json).

Item43823/location2, price650000×qty1×disc10/100=65000 tepat tanpa rounding. Input disc10/disc_amount65000, net barang585000; original shipping30000/subsidy20000/net10000, grand595000; NoTax1. **SO68425**/detail74710 dibuat dan dimirror sekali, seluruh GET money/identity cocok. Satu conversion gabungan dengan ID68425 kembali **HTTP500/code23113**, tanpa invoiceID.

Reconciliation GET: invoice_idnull, is_canceled/is_paidnull, marker Menunggu Verifikasi, grand595000; stock43823/location2 on_hand1/on_order1/available0. Filtered invoice/payment lists masing-masing3/totalCount3 hanya artefak lama; bukan proof rollback, efek internal payment tetap unknown. Tidak retry/cancel/payment terpisah atau write pada SO68422/68423/68424.

Kesimpulan: error yang sama dapat muncul tanpa fractional percentage/mismatch nominal diskon; kondisi tersebut tidak diperlukan untuk menghasilkan error pada varian ini. Akar journal/account mapping dan field penyebab belum diisolasi. Item berbeda dan subsidi tetap dikirim; bukan control goods-only atau bukti universal semua error lama. GET10.00/65000.0000 adalah format decimal string dengan nilai integer exact.

Budget tambahan1/1 habis, kumulatif**23 create attempts** pada akhir test integer ini. Stop business writes aktif; manual UI/audit disposition SO68425 diperlukan sebelum cleanup/write lanjutan. Tidak ada perubahan aplikasi/schema/master/account mapping, application validation runs, subagent, atau commit. Tiket08 tetap claimed.

## Matriks field item157190 — kontrol sukses, nonzero shipping discount gagal

Pemilik meminta eksperimen pengurangan field, mengarahkan SKU157190 **Celana Okcir Bagus** (group55269), memilih invoice-only, lalu menyetujui maksimum10 kasus sesuai [protokol](research-08-field-matrix-protocol.md). [Laporan lengkap dan input/output pembanding](research-08-field-matrix-evidence.md), [journal runtime](research-08-field-matrix-results.json).

Konstanta: item157190/location2, qty1, price1000000, disc10/nominal100000 bila aktif, NoTax1, tanpa fee/insurance/add_disc, tanpa mirror/payment/cancel. Semua8 SO create HTTP200 dan GET nominal/identity cocok.

- **A–G berhasil invoice**: SO68426–68432 → invoice45958–45964. Kontrol diskon barang saja(B/F), ongkir biasa(C/D), shipping_cost_discount explicit0(E), shipping_cost omitted(F), dan original_shipment_cost30000 tanpa nonzero shipping discount(G) semuanya lolos GET invoice/SO linkage serta money. Ketujuh invoice unpaid: payment_amount0 dan due sebesar grand. G tidak mengekspos original_shipment_cost pada invoice GET; preservation metadata itu tidak diklaim.
- **H SO68433**: financial request sama denganD (barang1000000−diskon100000+net ongkir10000=grand910000), hanya menambahkan shipping_cost_discount20000; original_shipment_cost tetap omitted. Create/GET berhasil, lalu satu conversion invoice-only mendapat **HTTP500/code23113**, tanpa invoiceID. Global stop aktif; **I/J tidak dijalankan**, tanpa retry H.
- PembandingD omitted versusE0 versusH20000 mempersempit kandidat pemicu ke **nonzero shipping_cost_discount pada envelope ini**, bukan fractional goods discount, keharusan original_shipment_cost, atau mirror. Ini belum membuktikan mekanisme internal jurnal, gross/net shipping contract, atau universal causality.

Reconciliation H: invoice_idnull, is_canceled/is_paidnull, grand910000, marker Belum Bayar, field shippingdiscount20000 tetap. Filtered invoice list10/totalCount10 hanya tiga artefak lama dan tujuh invoice baru A–G; payment list3/totalCount3 tetap40/42/44. Absence invoiceH bukan proof rollback. Stock157190/location2 dari21/1/20 menjadi14/2/12 (on_hand/on_order/available):7 invoice mengurangi on_hand dan H menambah on_order menurut observasi; existing on_order1 tidak disentuh oleh agent.

Pada checkpointH, budget matriks8/10, kumulatif**31 create attempts**. Sisa dua slot bukan izin otomatis melanjutkan setelah stop. Manual UI/audit disposition SO68433 diperlukan sebelum cleanup/write lanjutan; unknown fixtures68422–68425 dan B/G lama tetap terpisah. Tidak ada perubahan aplikasi/schema/master/account mapping/env, application validation runs, subagent, atau commit. Tiket08 tetap claimed, bukan resolved.

## Kelanjutan I/J — tanpa dan dengan diskon barang sama-sama23113

Pemilik memerintahkan I/J dijalankan setelah laporan H. I dibuat **SO68434**, detail74719: qty1/price1000000, disc0/disc_amount0/net barang1000000; original30000/subsidy20000/net shipping10000, grand1010000. Create/GET cocok, satu invoice-only conversion **HTTP500/code23113**, tanpaID. Agent menjalankan global stop sebelumJ dan reconciliation read-only, lalu meminta keputusan lanjut baru.

Setelah mengetahui outcome ambigu I, pemilik memilih **Ya, jalankan J (Recommended)**. Satu fixture baru **SO68435**, detail74720: disc10/nominal100000/net barang900000, original30000/subsidy20000/net shipping10000, grand910000. Create/GET cocok, satu invoice-only conversion kembali **HTTP500/code23113**, tanpaID. Tidak retry, mirror, payment, cancel atau write pada I/H dan fixtures historis.

[Evidence I/J dan approval](research-08-field-matrix-ij-evidence.md), [journal I/checkpointJ](research-08-field-matrix-ij-results.json), [journal J](research-08-field-matrix-j-results.json). Filtered lists setelahI/J tetap invoice10/totalCount10 dan payment3/totalCount3, tanpa artefak baru terlihat; kedua SO invoice_idnull/is_canceled/is_paidnull. Bukan proof rollback internal. Stock157190/location2 akhir**on_hand14/on_order4/available10**, dari baseline21/1/20.

Semua A–J selesai dieksekusi: **7 invoice verified, 3 conversion errors23113**. I menunjukkan diskon barang tidak diperlukan agar error muncul pada skenario subsidi ini. G versus J (original30000, net shipping10000, barang berdiskon/grand910000 sama) berbeda pada shipping_cost_discount omitted versus20000, dengan hasil sukses versus23113; ini memperkuat kandidat kondisional nonzero shipping discount, bukan bukti akar journal/accounting atau semua nilai nonzero.

Budget matriks**10/10 create dan10/10 invoice attempts**, kumulatif**33 create attempts** pada akhir A–J. Budget habis dan stop business writes aktif. SO68433/68434/68435 serta unknown fixtures lama memerlukan disposition terpisah sebelum cleanup/write lanjutan. Tidak ada perubahan aplikasi/schema/master/account mapping/env, application validation runs, subagent, atau commit. Tiket08 tetap claimed, bukan resolved.

## Ablation I/J tanpa shipping_cost_discount — kedua invoice sukses

Pemilik meminta dua fixtures baru dengan I/J sama tetapi key shipping_cost_discount20000 **dihilangkan**. [Protokol dan hasil](research-08-without-shipping-discount.md), [journal](research-08-without-shipping-discount-results.json). Source/item157190/location2/price1000000/qty1/NoTax1, original_shipment_cost30000 dan shipping_cost10000 tetap. Tidak retry/edit SO68434/68435 lama.

- **I-minus SO68436 → invoice45968**: disc0/disc_amount0/net barang1000000/grand1010000, HTTP200 dan GET money/identity/linkage cocok.
- **J-minus SO68437 → invoice45969**: disc10/disc_amount100000/net barang900000/grand910000, HTTP200 dan GET money/identity/linkage cocok.
- Key shipping_cost_discount tidak ada pada actual create request. GET mengembalikan default0; bukan agent mengirim0. Invoice payment_amount0/due penuh, tidak ada payment. Original shipment metadata tetap ada di SO tetapi tidak tersedia pada invoice GET.

I/J asli dengan shipping_cost_discount20000 gagal23113, sedangkan pasangan ablation tanpa key sukses. Ini bukti pembanding kuat untuk conditional failing financial request pada envelope tersebut, bukan bukti universal field intrinsik salah atau akar gross/net/account mapping. Jangan mengubah accounting/aplikasi atau menganggap funding merchant otomatis tercatat.

Tambahan2/2 create/invoice-only attempts, kumulatif**35 create attempts** pada akhirablation. Stock157190/location2 saat itu12/4/8; filtered invoice list12/totalCount12 (dua invoice ablation teridentifikasi), payment list3/totalCount3 tetap40/42/44. Tidak ada mirror/payment/cancel/retry, cleanup fixtures lama, perubahan aplikasi/schema/master/account mapping/env, application validation runs, subagent, atau commit. Tidak ada izin write berikutnya otomatis; tiket08 tetap claimed.

## Hipotesis shipping_cost_discount persen10/20 — kedua conversion gagal

Pemilik mengusulkan unit persen dan memilih financial input yang konsisten dengan10%/20% dari original shipment30000. [Protokol, approval dan hasil](research-08-shipping-percentage.md), [journalP10](research-08-shipping-percentage-results.json), [journalP20](research-08-shipping-percentage-p20-results.json). Spec hanya menyebut type number/Shipping cost discount, tanpa unit eksplisit.

- **P10 SO68438**, field10, net shipping27000, grand927000; barang1000000−disc100000=900000. Create/GET cocok, invoice-only conversionHTTP500/code23113. Agent stop dan reconciliation sebelumP20.
- Setelah menerima outcomeP10, pemilik memberi izin khusus **Ya, jalankan P20**. **P20 SO68439**, field20, net shipping24000, grand924000; konstanta barang/source/location/NoTax sama. Create/GET cocok, invoice-only conversion kembaliHTTP500/code23113. Tidak retry, mirror, payment, cancel atau write pada fixtures historis.

GET mempertahankan raw field10.0000/20.0000; tidak ada computed benefit3000/6000 yang dibuktikan independen. Unit **persen atau amount tetap unknown**: mengganti input10/20 belum menghindari error, bukan proof universal persen salah/amount benar. Label subsidi20000 pada eksperimen lama adalah intended business benefit/candidate mapping, bukan bukti unit provider. Gross/net shipping dan journal/account mapping tetap unknown.

Reconciliation kedua SO invoice_idnull/is_canceled/is_paidnull dan seluruh money tetap; filtered invoice/payment lists12/3 artefak dikenal, tanpa artefak baru terlihat untukP10/P20 pada filter tersebut, bukan proof rollback internal. Stock157190/location2 akhir**on_hand12/on_order6/available6**. Kedua fixtures memerlukan manual UI/audit disposition sebelum cleanup.

Tranche2/2 create/invoice attempts terpakai, kumulatif**37 create attempts**. Tidak ada perubahan aplikasi/schema/master/account mapping/env, application validation runs, subagent, atau commit. Tidak ada budget/izin write lanjutan otomatis; tiket08 tetap claimed.

## Keputusan arah mapping terbaru — original dan net, tanpa discount field

Setelah hasil hipotesis persen, pemilik meminta mengecualikan shipping_cost_discount dan memakai shipping_cost/original_shipment_cost seperti caseG. Agent mengklarifikasi original=ongkir sebelum subsidi, shipping=net customer, serta implikasi revisi dari goods-only. Pemilik memilih **Ya, catat revisi mapping (Recommended)**.

[Catatan keputusan parsial lengkap](research-08-selected-shipping-mapping.md): arah planning **barang + net ongkir**, contoh original30000/shipping10000/grand barang net900000+10000=910000, shipping_cost_discount benar-benar omitted dari request. Subsidi/funding merchant dan quote/biaya kurir tetap terpisah di website; PPN/fee tetap menurut04. Default shipping_cost_discount0 pada GET tidak melanggar exclusion request.

Pada checkpoint pemilihan arah mapping ini, approval belum mencakup complete contract09, implementasi, izin provider write baru atau revisi required proof/penutupan08. Revisi scope bukti kemudian disetujui terpisah sebagaimana dicatat di bawah. Payment dan preservation lifecycle konfigurasi terpilih belum lengkap; original shipment metadata invoice tidak tersedia pada GET. Accounting/funding merchant provider tidak dianggap otomatis verified. Kode runtime existing belum berubah. Status08 claimed dan09 open/blocked by08 tetap; budget tetap37 create attempts, tanpa validation runs aplikasi, subagent, atau commit.

## Approval scope bukti08 terbaru

Pemilik menyetujui empat pilihan questionnaire: **Ya, fokus mapping terpilih (Recommended)**; **Per baris, add_disc0 (Recommended)**; **Pisahkan tindak lanjutnya (Recommended)**; **SO + nominal lifecycle (Recommended)**. [Scope/acceptance approved](research-08-approved-proof-scope.md) kini menjadi acuan Question/Bukti penyelesaian tiket08.

Bukti wajib fokus pada barang/per-line discount/add_disc0 dan mapping original sebelum subsidi + net shipping, shipping_cost_discount omitted. Field ongkir/funding yang tidak dipakai dan header discount nonzero tidak lagi required proof scope awal. Legacy investigasi/cleanup dipisahkan tanpa proof rollback atau izin cancel/tiket baru. Original cukup dibuktikan pada SO, invoice/payment melalui nominal/linkage yang tersedia; tidak mengklaim metadata internal invoice verified.

Pada checkpoint approval scope, gap payment/full-payload mirror/qty>1 masih perlu evidence dan safe cancel tetap tercakup08. Saat itu belum ada protokol/budget/write baru; baseline37. Hasil dan approval T1–T3 berikutnya menyelesaikan bukti aktif tanpa mengubah batas yang diterima.

## Lifecycle T1–T3 — review final scope08 terpenuhi

Pemilik memilih **Setuju, T1–T3 (Recommended)** setelah menerima rincian endpoint/nominal/budget/account2/type0 dan cancellation hanya fixture barueligible. [Protokol, hasil dan review acceptance](research-08-selected-lifecycle.md), [journal](research-08-selected-lifecycle-results.json).

- **T1 SO68440 → invoice45972 → payment55**, qty1, whole-line discount100000, net900000 + shipping10000 =910000, full mirror terpelihara, association tepat/due0.
- **T2 SO68441 → invoice45973 → payment57**, qty2 satu baris, gross2000000−whole-line discount200000=1800000 + shipping10000 =1810000, mirror/invoice/payment mempertahankan nominal/identity, association tepat/due0.
- **T3 SO68442**, qty1/grand910000, full mirror cocok lalu satu pre-invoice cancel. GET canceledtrue/invoice_idnull/money tetap dan stock restored9/6/3 ke baseline kasus.

Actual create/mirror request tanpa shipping_cost_discount; GET default0 diperbolehkan sesuai keputusan. Original30000 pada SO dan net shipping10000 terpelihara; invoice tidak mengekspos original metadata sesuai accepted limitation. SO is_paid masihnull meskipun paid amount dan payment associations sudah tepat; jangan menggunakannya sendirian sebagai settlement source of truth.

Main agent mereview tujuh kewajiban scope aktif terhadap T1–T3 dan existing evidence L/J/H/R untuk precision/fixed-capped allocation. **Semua terpenuhi pada envelope yang diuji;08 ditandai resolved**, bukan dari HTTP200 saja atau approval implementasi. Mirror yang dibuktikan sebelum invoice/cancel; tidak mengklaim semua edits post-invoice atau input/config universal. Kontrak lengkap09 tetap belum dikerjakan.

Dipakai3 create/3 mirror/2 invoice/2 payment/1 cancel, kumulatif40 create attempts. Stock akhir157190/location2**on_hand9/on_order6/available3**; on_order6 legacy tidak dibersihkan. Filtered invoice list14/totalCount14 dan payment5/totalCount5 mencakup artefak T1/T2; T3 canceled, tanpa retry atau perubahan order historis. Tidak ada perubahan aplikasi/schema/master/account mapping/env, unit/E2E/build/lint/typecheck aplikasi, subagent, atau commit. Tidak ada izin write/cleanup tambahan otomatis.
