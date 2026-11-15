# Protokol write lanjutan tiket 08

## Otorisasi dan reconciliation gate

Pemilik menyatakan tidak melihat reference B/G di UI, setelah mengirim screenshot list dan detail F/H. Agent mencocokkan melalui GET serta delapan endpoint list. Ini dicatat sebagai manual review operator; outcome backend B/G tetap unknown, bukan rollback terverifikasi. B/G tidak diretry, diedit, atau dibayar. Pada pesan terbaru pemilik mengizinkan **10 create SO lagi** dan meminta research dilanjutkan sampai selesai.

Batas terbaru: **10 request create tambahan**, bukan tambahan 5 + 10 yang ditumpuk. Sepuluh create existing A/B/F/G/H/J/K/L/M/N tetap dihitung; batas rangkaian kumulatif sekarang **20 create attempts**. Koreksi setelah membaca evidence `sandbox-followup.md` yang baru tersedia: protokol awal sesi ini sempat memakai baseline 5, padahal J–N sudah memakai 5 tambahan sebelum tranche ini. Counter historis pada dua kasus pertama tidak ditimpa; correction event menjelaskan baseline yang benar. Setiap timeout/5xx/missing ID tetap mengonsumsi budget. Tidak ada retry otomatis atau penggantian reference untuk mengulang kasus ambigu.

## Envelope dan keamanan

- Fixtures baru research saja, contact dummy 116918, source INTERNAL 1, No Tax ID 1, account payment 2 setelah GET.
- Harga master tetap: 43842 Rp259.000, 43843 Rp250.000; unit Buah. Recheck master dan stock sebelum create; lokasi dipilih dari availability kedua item, prefer location 2 jika cukup.
- Qty 1–2 per baris, maksimum dua baris, gross barang maksimum Rp1.100.000 per SO; shipping eksperimen maksimum Rp30.000, additional discount maksimum Rp20.000; seluruh suite gross barang maksimum Rp11.000.000.
- Tidak ada perubahan aplikasi/master/config/env, production, source marketplace, order existing, subagent, commit, atau validation runs aplikasi.
- Journal tersanitasi menyimpan dispatch intent **sebelum** request dan response/GET money allowlist setelahnya. Token/nama customer/account hanya in-memory; tidak menyimpan raw provider/customer responses. Nomor referensi fixture baru unik.
- Stop seluruh business writes jika network/5xx/ID hilang atau outcome write ambigu. Rekonsiliasi GET/manual review, tanpa blind retry. Jika money mismatch, tidak invoice/payment; cleanup cancel pre-invoice hanya jika state/identity known dan eligible, lalu catat hasil, jangan menganggap sukses kontrak.
- Cancel pre-invoice once dengan GET sebelum/sesudah dan stock recheck; tidak cancel setelah invoice. Invoice/payment sandbox ditinggalkan sebagai artefak audit. Payment hanya exact verified invoice payable dan maksimal satu kali per invoice.

## Urutan eksperimen adaptif

Tiap kasus create terpisah; maksimum 10, tidak wajib menghabiskan seluruh budget. Expected math independen dicatat, bukan diturunkan dari response.

| Kasus | Input | Expected/pertanyaan | Lanjutan |
| --- | --- | --- | --- |
| Q | 43842 ×2, disc 10%, nominal whole-line 51800 | gross 518000, net 466200; alternatif per-unit net 414400 | GET; cancel + stock |
| L | 43842 ×1 + 43843 ×1, kupon capped/fixed 20000 dialokasikan 10177/9823; disc masing-masing nominal/gross×100 tanpa pembulatan | gross 509000, net 489000, total_disc 20000; jumlah allocation tepat 20000 | GET; marker full request-schema payload dari GET dengan detail IDs asli; GET; invoice GET + SO linkage; payment 489000 sekali; payment/invoice GET |
| A1 | 43842 ×1, line disc nol, total_disc 0, add_disc 20000 | Kandidat header additive: grand_total 239000; amati apakah total_disc tetap 0 atau dinormalisasi | GET; cancel + stock |
| A2 | 43842 ×1, disc 10%, line/total_disc 25900, add_disc 10000 | gross259000−line25900−header10000 = 223100; bukan double subtract header | GET; cancel + stock |
| S | 43842 ×1, zero goods discount, shipping_cost30000, grand_total289000 | Apakah shipping writable dan kontribusi payable? | GET; jika konsisten invoice GET; payment hanya exact verified payable; jika tidak konsisten cancel pre-invoice |
| F1 | shipping_cost10000, original_shipment_cost30000, shipping_cost_discount20000, shipping_fee_discount_seller20000, platform0; barang tanpa diskon; expected269000 | **Exploratory undocumented request fields**: uji apakah disimpan/diabaikan/ditolak untuk INTERNAL, bukan mapping approved | GET; tidak invoice/payment; cancel + stock |
| R | 43842 ×1, nominal20000, **disc dibulatkan7.72** sebelum input, net239000 | H memakai7.722007722…; uji apakah nominal tetap exact dengan input dua desimal | GET; cancel + stock |
| P | 43842 ×1, disc10, nominal20000, net239000 | Sengaja metadata mismatch tetapi money gross−nominal konsisten; observe authority/recalculation | GET; tidak invoice/payment; cancel jika state known |
| D | 43842 ×1, disc10, nominal0, amount233100, total_disc25900 | Disc-only candidate: observe nominal regeneration/field authority, risiko500 | GET; tidak invoice/payment; cancel jika state known |

Tambahan isolasi field setelah F1 HTTP400: F2 hanya `shipping_cost_discount=20000`, F3 hanya `original_shipment_cost=30000`, F4 hanya `shipping_fee_discount_seller=20000`, F5 hanya `shipping_fee_discount_platform=0`, seluruhnya shipping_cost10000/goods259000/grand269000. Tiap kasus merupakan hipotesis satu field pada fixture/ref baru, bukan retry F1. Error response selanjutnya mencatat nama field allowlist yang disebut validation dan kategori not-allowed tanpa raw message. F1 tidak merekam exact field/message; kekurangan evidence ini tidak direkonstruksi atau dianggap bukti seluruh field ditolak.

Review error classification mengikuti `writeRejection` repo: structured HTTP400 Bad Request adalah definite rejection, berbeda dari 5xx/network/missing ID pada success yang ambigu. Runner awal terlalu konservatif menandai semua non-2xx sebagai ambigu; correction event mencatat hal ini sebelum lanjut, tanpa retry F1. Money mismatches tetap menghentikan settlement. Maksimal 10 create baru berarti F2–F5 dapat menggantikan A1/A2/D yang tidak perlu/lebih berisiko; urutan setelah S/F1 adalah R, F2–F5, lalu P. D tidak dijalankan jika budget habis atau P ambigu.

Setelah F2/F3 berhasil dan F4/F5 ditolak dengan kategori not-allowed, slot ke-10 diprioritaskan ke **F6**, menggantikan P/D: barang43842×1, disc7.72, nominal20000/net239000; shipping_cost10000, original_shipment_cost30000, shipping_cost_discount20000; grand249000. Funding seller/platform tidak dikirim. GET → full-payload mirror yang juga membawa kedua extension shipping yang sudah terbukti diterima → GET → invoice GET → exact payment249000 → payment/invoice GET. Ini membuktikan preservation gabungan dan mendeteksi double subtraction; bukan approval accounting atau claim dana merchant tercatat pada provider. Eksperimen metadata sengaja konflik P/D tetap not-run, bukan verified.

Kasus P/D yang lebih berisiko ditempatkan terakhir agar ambiguity tidak mendahului bukti prioritas. Jika satu mendapat outcome ambigu, kasus berikutnya tidak dikirim. Field response-only F1 sengaja diuji sebagai eksperimen dengan izin testing terbaru; keberadaannya pada response sebelumnya tidak dinyatakan bukti writable. Ledger shipping extended/accounting tetap keputusan tiket 09, bukan disetujui hanya karena eksperimen berhasil.

Marker L mempertahankan salesorder number, contact/source/location, date/note/ref, flags tax, seluruh field request-schema yang tersedia, original detail IDs, quantity/price/disc/disc_amount/tax/amount/header. Target hanya channel_status dari Belum Bayar ke Menunggu Verifikasi. Snapshot GET membawa persentase dua desimal; uji preservation ini penting dan hasil tidak boleh dihitung ulang memakai persentase tersebut. Snapshot money sebelum/sesudah dibandingkan.

Jika invoice belum cocok atau linkage belum terbukti, tidak payment. Jika invoice GET items tidak memuat diskon atau settlement evidence tidak lengkap, simpan unknown dan jangan membuat klaim preservation penuh.

## Penyesuaian setelah evidence existing dibaca

[Sandbox followup J–N](sandbox-followup.md) kini memberikan evidence qty 2, alokasi dua baris, header alone/combined, serta lifecycle satu baris. Q pada tranche ini adalah recheck independen qty 2; L menambah lifecycle dua baris sampai invoice/payment. A1/A2 tidak perlu diulang untuk fakta SO/header yang sudah ada; sisa request diprioritaskan shipping/funding dan authority. Tidak mengulang seluruh research existing.

L payment POST mendapat ID42, GET pertama HTTP500 `No data returned from the query.`. Semua business writes sempat dihentikan. GET invoice menunjukkan payment_amount489000, list invoice due0 dan list payment ID42 tersedia. GET read-only ulang `/sales/payments/42` kemudian HTTP200, tepat satu association ke invoice45952/SO68417, amount489000/due0. Payment tidak diulang; hasil kini terkonfirmasi sehingga eksperimen berikutnya dapat dilanjutkan. Penyebab internal kegagalan GET awal belum terbukti; jangan mengatribusikan definitif pada latency/replica.

## Artefak

Input actual yang disanitasi, intent, HTTP/error category, create IDs, GET money, stock, invoice/payment association, dan keputusan stop disimpan pada `research-08-write-results.json`. Analisis digabung ke `research-08-evidence.md`. Tiket 08 hanya resolved bila semua required proof terpenuhi; ambiguity/provider limitations tetap explicit blocker, bukan ditutup demi permintaan selesai.
