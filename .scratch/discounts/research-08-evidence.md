# Research tiket 08 — bukti kontrak diskon nonzero Jubelio

## Ringkasan dan status

**Research telah menghasilkan bukti runtime baru, tetapi tiket 08 belum resolved.** Diskon barang qty 1/2, alokasi fixed/capped, header discount, mirror, dan settlement barang sudah memiliki evidence. Ongkir tanpa subsidi dapat disettle. Field subsidi tertentu writable pada INTERNAL, tetapi konversi invoice dengan subsidi gagal `23113 journal_unbalance`; funding seller/platform ditolak. Tidak ada klaim launch-ready.

Artefak:

- [Protokol write terbaru](research-08-write-protocol.md).
- [Evidence JSON write tranche terbaru](research-08-write-results.json).
- [Evidence JSON fase read-only](research-08-results.json).
- [Evidence awal A–H](sandbox-error-investigation.md), [JSON awal dan J–N](sandbox-results.json), [hasil J–N](sandbox-followup.md).

Pemilik mengizinkan **10 request create SO lagi** dan meminta research diteruskan. Tranche terbaru memakai **10/10 create attempts**, termasuk tiga definite HTTP400 rejections. Evidence existing sudah mencatat 10 create A/B/F/G/H/J/K/L/M/N; total rangkaian **20 create attempts**, bukan 20 SO berhasil. Tujuh SO baru mendapat ID, empat canceled, dua terkonfirmasi invoice/payment, satu menunggu reconciliation conversion.

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

1. **Launch blocker extended shipping/subsidy ledger:** F6 invoice conversion23113; writable funding seller/platform tidak tersedia pada endpoint ini. Klarifikasi supported INTERNAL accounting payload/journal treatment melalui support ditunda sesuai instruksi terbaru pemilik. Reconciliation API F6 sudah diperluas, tetapi safe settlement subsidi tetap belum terbukti.
2. **Outcome lama B/G:** manual UI/list tidak menemukan reference; audit rollback/non-application belum tersedia. Tidak retry B/G.
3. **Precedence universal:** disc0+nominalpositive dan disc-only/inconsistent metadata belum memiliki kontrak aman. Nominal exact + derived/nonzero percentage adalah observed supported envelope, bukan semua input.
4. **Belum diuji:** header discount, qty2, serta semua kombinasi lain sampai payment; negative/refund/post-invoice cancel/provider tax nonzero tidak termasuk scope ini.

Jika jalur support kelak dibuka kembali, request dapat menyertakan run refF6, timestamp event F6-invoice-create di JSON, SO68422, code23113, source1/NoTax1 dan money projection di atas, tanpa credentials/PII. Pada scope terbaru tidak ada request support yang dijalankan. Jangan mengubah SO68422 sebelum disposition/state aman ditentukan.

**Tiket08 tetap claimed, bukan resolved.** Budget20 kumulatif sudah habis dan business-write stop aktif. Bukti ini cukup untuk membahas kandidat goods-only mapping, tetapi memilih goods-only + merchant funding ledger lokal versus memperluas ledger shipping tetap keputusan pemilik di tiket09. Mengubah destination atau mengabaikan required proof supaya tiket08 ditutup memerlukan approval eksplisit; tidak dilakukan agent.
