# Riset — `Status Jubelio: UNKNOWN` pada Sales Order Internal

**Status (2026-09-26):** investigasi kode dan dokumentasi selesai; **akar penyebab di runtime Jubelio belum terkonfirmasi**. Ini dokumen riset, **bukan** instruksi untuk mengubah SO pelanggan atau izin mengirim POST ke Jubelio. Belum ada perubahan aplikasi maupun panggilan API akun Jubelio dalam riset ini.

## Tujuan dan batas bukti

Target perilaku: saat **place order**, SO di Jubelio harus merepresentasikan pesanan yang **belum dibayar**; hanya setelah Midtrans mengonfirmasi settlement dan payment Jubelio terverifikasi boleh merepresentasikan **dibayar**. Kolom **Status Jubelio** pada UI Jubelio harus mengikuti status yang benar menurut mekanisme Jubelio, bukan string yang dikarang aplikasi. Status WMS (*proses gudang*) mungkin berbeda dari status pembayaran.

- Tangkapan layar pengguna, **Penjualan → Pesanan**: kolom **Status Channel** kosong dan kolom **Status Jubelio** berisi `UNKNOWN` pada SO toko `INTERNAL`, termasuk baris dengan `INV-000045941`. Ini bukti tampilan, **bukan** bukti nilai `wms_status` mentah. Nomor invoice pada baris tidak membuktikan `is_paid: true`. Jangan menyalahkan `channel_status` hanya karena kolom di sebelahnya kosong.
- Kasus sebelumnya yang tercatat dalam [dokumentasi implementasi](../../docs/features/jubelio-sales-orders.md): SO `68393` → invoice `45941` → payment `20` (setelah QRIS) dan order lokal `ready_for_pickup`. Catatan itu membuktikan asosiasi invoice/payment yang diverifikasi pada jalur tersebut, **bukan** transisi `wms_status` atau `is_paid` SO. Kasus ini **bukan** order uji untuk POST tambahan.
- Repo saat diperiksa memiliki banyak perubahan pekerjaan lain yang belum di-commit, termasuk gateway sales dan settlement yang masih untracked. Jangan menimpa atau mengganti alur settlement tersebut demi memperbaiki label UI.

## Rantai data yang benar-benar dapat diaudit di repo

| Tahap | Kode | Yang diketahui / yang belum |
|---|---|---|
| Checkout | [`buildSalesOrderPayload`](../../apps/store/src/lib/jubelio-sales-client.ts) → `POST /sales/orders/`, lalu GET verifikasi | Mengirim `source: 1` (Internal), **tidak mengirim** `is_paid`, `channel_status`, atau `wms_status`. Status pembayaran SO hasil create belum diukur. |
| Midtrans settlement | [`/api/webhooks/midtrans`](../../apps/store/src/app/api/webhooks/midtrans/route.ts) → [`settleJubelioSalesOrder`](../../apps/store/src/lib/jubelio-sales-settlement.ts) | Pembayaran lokal diklaim berdasarkan verifikasi status Midtrans, bukan berdasarkan label UI Jubelio. |
| Settlement Jubelio | [`createInvoice` dan `createInvoicePayment`](../../apps/store/src/lib/jubelio-sales-client.ts) | `POST /sales/packlists/create-invoice` → GET invoice + GET SO; `POST /sales/payments/` → GET payment. Tidak memanggil `POST /sales/orders/set-as-paid`. Belum diketahui apakah payment mengubah `is_paid` pada SO. |
| Pembacaan SO | [`JubelioSalesOrderSnapshot` dan `parseSnapshot`](../../apps/store/src/lib/jubelio-sales-client.ts) | Snapshot hanya memetakan identitas, item, nominal, cancel, dan invoice; **membuang** `wms_status`, `is_paid`, `channel_status`, `internal_status`, dan `status_details` dari GET. Karena itu log/snapshot aplikasi tidak bisa dipakai untuk menyimpulkan status mentah. |
| Fulfillment lokal | [`settleJubelioSalesOrder`](../../apps/store/src/lib/jubelio-sales-settlement.ts) dan [`orders`](../../packages/db/src/schema/orders.ts) | `ready_for_pickup` milik aplikasi, **bukan** `wms_status` dan bukan bukti Jubelio menandai SO paid. |

**Hipotesis yang layak diuji, bukan diagnosis:** SO Internal tercipta tanpa status WMS yang dikenali UI; pembayaran invoice saja mungkin tidak mengubah penanda paid/status WMS di SO. Atau `is_paid` sudah benar tetapi status WMS memang tetap `UNKNOWN` karena workflow gudang yang terpisah. Kedua kemungkinan memerlukan data mentah dari akun yang sama.

## Kontrak primer Jubelio: apa yang dijanjikan dan apa yang tidak

Rujukan resmi [Jubelio API](https://docs.jubelio.com/) (diperiksa melalui Context7 `/websites/jubelio`, 2026-09-26) dan salinan spesifikasi [Omnichannel `dist.yaml`](../../docs/jubelio-api/dist.yaml). Dokumen vendor adalah spesifikasi, **bukan** pengukuran efek runtime akun ini; lihat [caveat spesifikasi vs runtime](../../docs/jubelio-api/README.md).

| Fakta kontrak | Sumber | Implikasi aman |
|---|---|---|
| `POST /sales/orders/` (`saveSalesOrderRequest`) menerima `source` (1 = Internal) dan properti opsional `is_paid` serta `channel_status`. **Tidak ada** `wms_status` dalam skema input. | [`dist.yaml` L8716–8792, L24893–25179](../../docs/jubelio-api/dist.yaml) | Create saat belum bayar **jangan** diberi `is_paid: true`. Mengirim `wms_status: "PAID"` pada create/edit tidak punya dasar kontrak. `channel_status: "Paid"` juga bukan pengganti status Jubelio untuk source Internal. |
| `GET /sales/orders/{id}` mencantumkan `is_paid`, `channel_status`, `wms_status` (contoh `PAID`), `wms_statuses`, `internal_status`, dan `status_details`. | [`dist.yaml` L8793–8823, L25180–25800](../../docs/jubelio-api/dist.yaml) | Field output bukan jaminan field dapat ditulis. Contoh `PAID` **bukan enum atau jaminan** hasil pembayaran invoice. |
| `GET /sales/orders/` list memiliki `is_paid` dan `internal_status`; `wms_status` tampak pada model GET detail. | [`dist.yaml` L13253–13405](../../docs/jubelio-api/dist.yaml) | Bandingkan detail SO dengan list/UI; kemungkinan list memakai aturan presentasi lain. |
| `POST /sales/orders/set-as-paid` menerima `{ "ids": [<salesorder_id>] }`; nama operasinya *Set Sales Order as Paid*. Respons sukses hanya skema `ok`. | [`dist.yaml` L9104–9123, L30804–30816](../../docs/jubelio-api/dist.yaml); [API resmi](https://docs.jubelio.com/#operation/setAsPaid) | Kandidat aksi untuk **penanda paid SO**, **belum terbukti** mengubah `wms_status`, tidak diketahui efek finansial/stoknya atau keamanan setelah payment invoice. Jangan otomatis memanggilnya pada SO 68393. |
| `POST /wms/sales/ready-to-process` khusus memindahkan *empty-stock* / *failed pick* ke *ready to process*. | [`dist.yaml` L2837–2864](../../docs/jubelio-api/dist.yaml) | Bukan cara umum mengubah `UNKNOWN` menjadi paid; jangan panggil pada SO pelanggan. |
| Kontrak webhook salesorder mendokumentasikan `action`, `status`, `is_paid`, `channel_status` ketika order berubah. | [`dist.yaml` L10755–10776 dan skema `webhookSalesOrder`](../../docs/jubelio-api/dist.yaml) | `status` webhook tidak otomatis identik dengan `wms_status`. Webhook yang ada di store khusus sinkronisasi stok; belum ada rekonsiliasi status SO berbasis webhook. |

**Pisahkan empat dimensi:** `is_paid` (penanda pembayaran SO Jubelio), `wms_status` (tahap WMS Jubelio), `channel_status` (status channel/marketplace), dan `orders.payment_status`/`orders.status` (otoritas Midtrans & fulfillment lokal). Contoh: Midtrans `paid`, invoice payment GET cocok, dan order lokal `ready_for_pickup` bisa terjadi **bersamaan** dengan UI Jubelio `UNKNOWN`; tidak berarti invoice belum dibayar ataupun WMS sudah siap ambil.

## Pemeriksaan read-only yang menentukan penyebab

**Belum dijalankan dalam riset awal ini.** GET read-only ke Jubelio boleh dilakukan selama riset tanpa keputusan tambahan pemilik. Jika perlu `POST /login` untuk memperoleh token, minta izin eksplisit pemilik untuk POST autentikasi itu terlebih dahulu; izin ini tidak mencakup POST SO atau perubahan data. Jangan membaca/menyalin token atau respons berisi PII ke dokumen/log. Gunakan kredensial akun yang membuat SO tersebut, hanya lewat koneksi resmi. Jangan kirim kredensial ke chat.

1. GET detail `68393` **dan** satu SO `INTERNAL` yang UI-nya menampilkan status yang diinginkan pada tahap belum dibayar, dan satu yang sudah dibayar. Pilih pembanding dengan lokasi, tipe fulfillment, dan source sebanding. Simpan hanya allowlist berikut, dengan membedakan **field absen vs null**: `salesorder_id`, `source`, `source_name`, `channel_status`, `wms_status`, `wms_statuses`, `internal_status`, `is_paid`, `invoice_id`, `payment_method`, `status_details`, `is_canceled`. Cocokkan `invoice_id` SO dengan invoice `45941` dan payment `20` via GET terpisah jika token tersedia secara aman; jangan simpan body invoice/payment pelanggan.
2. Contoh **hanya GET**, setelah token tersedia secara aman di sesi operator (header Authorization Jubelio memakai token tanpa awalan `Bearer`):

   ```bash
   curl --fail-with-body -sS \
     -H "Authorization: $JUBELIO_TOKEN" \
     'https://api2.jubelio.com/sales/orders/68393' \
     | jq 'with_entries(select(.key | IN("salesorder_id", "source", "source_name", "channel_status", "wms_status", "wms_statuses", "internal_status", "is_paid", "invoice_id", "payment_method", "status_details", "is_canceled")))'
   ```

   Jangan jalankan dengan `set -x`, jangan simpan output mentah, dan lakukan redaksi jika `status_details` mengandung data pelanggan. Jika list/UI berbeda dari GET detail, periksa GET list/filter dan minta aturan mapping kolom **Status Jubelio** ke dukungan Jubelio; jangan langsung menyamakan label UI dengan `wms_status`.
3. Pada akun uji yang disetujui: ambil snapshot **sebelum create**, **setelah create sebelum Midtrans bayar**, **setelah invoice**, dan **setelah payment terverifikasi**. Lihat perubahan `is_paid`, `wms_status`, `internal_status`, invoice/payment, serta stok `on_hand`, `on_order`, `reserved`, `available` di item/lokasi yang sama. Jika status berubah sendiri sesudah payment, cari sebab khusus data lama/mapping UI, **tanpa** POST tambahan.
4. Tanyakan ke dokumentasi/dukungan Jubelio secara spesifik: (a) dari mana kolom UI **Status Jubelio** bersumber untuk SO Internal? (b) apakah payment invoice otomatis menandai SO sebagai paid? (c) apakah `set-as-paid` ketika invoice sudah dibayar aman, tidak membuat payment ganda, dan mengubah `is_paid` **serta** `wms_status`? (d) tahap yang benar untuk order **pickup tanpa kurir** vs delivery; apakah WMS harus diproses terpisah? Minta contoh respons **sebelum/sesudah** dan dampak stok/akuntansi.

## Matriks keputusan implementasi (setelah bukti)

| Temuan terukur | Tindakan yang benar |
|---|---|
| `is_paid: true`, tetapi `wms_status: UNKNOWN` setelah payment GET terverifikasi | **Jangan** mengirim `set-as-paid` dengan asumsi itu menyelesaikan WMS. Tentukan dulu workflow gudang/UI resmi untuk source Internal dan fulfillment pickup. |
| `is_paid: false/null` setelah payment GET terverifikasi, `wms_status` juga `UNKNOWN` | Investigasi apakah `set-as-paid` memang langkah yang hilang; konfirmasi efek endpoint dan urutannya dengan sandbox/dukungan. Jangan anggap mengubah flag paid akan otomatis mengubah WMS. |
| Field GET bukan `UNKNOWN` tetapi UI `UNKNOWN` | Telusuri GET list/filter, kemungkinan cache dan mapping UI/provider; jangan mengubah ledger pembayaran. |
| Payment GET tidak cocok atau settlement masih ambigu | Jangan tandai paid di Jubelio hanya dari callback; status lokal tetap paid menurut Midtrans tetapi fulfillment diblokir dan direkonsiliasi secara manual sesuai [pipeline](../../docs/features/jubelio-sales-orders.md). |

**Desain yang disarankan hanya jika kontrak dan sandbox membenarkan aksi SO tambahan:** tempatkan transisi **setelah** payment invoice GET berhasil diverifikasi, tidak saat create dan tidak dari callback mentah. Gunakan operasi persisten tersendiri per order (`intent` → `dispatched_unknown` → `confirmed`/`manual_review`), satu POST maksimum, lalu GET SO untuk memverifikasi nilai yang **benar-benar dibuktikan** oleh sandbox (`is_paid` dan/atau `wms_status`). Saat timeout/500, jangan POST ulang: GET dengan ID yang sudah diketahui dan eskalasi bila hasil ambigu. Tentukan apakah pickup boleh dibuka sebelum status Jubelio terverifikasi; jangan secara diam-diam mengubah invariant fulfillment yang sudah ada. Perlu migrasi/seed bila ledger bertambah, log terstruktur tanpa PII, tes unit/DB + E2E untuk jalur settlement, dokumentasi fitur, dan verifikasi deployment sebelum rollout. Tidak ada perubahan kode yang aman untuk dijanjikan sebelum hasil pemeriksaan di atas.

## Uji write yang diperlukan bila GET belum menyelesaikan masalah

Hanya dengan **persetujuan eksplisit**, pada SO **baru** di akun sandbox/test yang benar-benar terisolasi, bukan SO pelanggan/lunas dan bukan SO 68388 yang sedang ambigu. Skenario: (1) create unpaid → pastikan masih unpaid; (2) settlement invoice/payment normal → GET detail; (3) bila disetujui, panggil `set-as-paid` **sekali** pada satu SO uji setelah bukti precondition; (4) GET SO, invoice, payment, empat deret stok, dan UI sesudahnya; (5) bandingkan dengan kontrol tanpa `set-as-paid`. Jika POST timeout/500, hentikan; cek hasil GET dan minta operator menangani ambigu. **Jangan** memakai `is_paid: true` saat create sebagai eksperimen di checkout pelanggan yang belum membayar.

## Pertanyaan terbuka / syarat selesai

- Nilai asli `wms_status`, `is_paid`, dan `internal_status` untuk SO `68393` setelah payment `20` serta SO pembanding?
- Aturan pasti kolom UI **Status Jubelio** dan apakah `UNKNOWN` berasal dari WMS, status internal, atau mapping list?
- Efek dan keamanan `set-as-paid` pada SO Internal yang sudah punya invoice + payment, termasuk stok dan akuntansi?
- Status WMS yang tepat untuk pickup, apakah perlu transisi gudang terpisah, dan kapan dijalankan?

**Kesimpulan:** jalur aplikasi sudah memverifikasi invoice/payment, tetapi belum ada bukti bahwa SO/WMS di Jubelio mengadopsi status paid. `set-as-paid` adalah **kandidat**, bukan perbaikan terverifikasi. Langkah berikutnya adalah pemeriksaan GET read-only tanpa keputusan tambahan untuk GET; bila token memerlukan `POST /login`, minta izin untuk POST autentikasi tersebut. Uji write terisolasi jika masih perlu juga memerlukan izin eksplisit terpisah; baru sesudah itu perubahan aplikasi berbasis tes dapat dirancang dan dijalankan.
