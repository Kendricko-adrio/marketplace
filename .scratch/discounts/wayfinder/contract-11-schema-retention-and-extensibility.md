# Logical schema diskon, retention, dan extension — tiket 11

Status: Disetujui pemilik sebagai kontrak planning tiket 11, dengan [koreksi scope pembayaran dan service fee](decision-zero-payment-and-no-service-fee.md) sesudah approval awal. Website tanpa service fee; kewajiban pembuktian pembayaran/provider Rp0 dicoret, bukan ditunda.

Dokumen ini melengkapi [tiket 11](11-schema-retention-and-extensibility.md). Pemilik menyetujui dokumen lengkap melalui `ask_user_question` dengan memilih **Setuju, tutup tiket (Recommended)** setelah menerima link dan ringkasan cakupan. Ini artefak planning, bukan SQL/migration, implementation spec seluruh fitur diskon, atau izin implementasi/launch.

## 1. Kontrak dan batas

- Base Price milik Jubelio; Markdown website berupa target harga akhir tetap per variant untuk semua cabang, dengan current pointer dan histori append-only. Fallback/restore mengikuti [01](01-markdown-base-drift-and-restore.md).
- Maksimal satu Coupon ATAU Manual Promo Code per order, di samping Markdown. Satu promo memiliki satu jalur aktivasi tetap: `public` melalui picker atau `manual_only` melalui kode; tidak ada kedua jalur sekaligus.
- Benefit awal: persentase barang dengan cap opsional, nominal per order, atau subsidi ongkir. Barang bersifat general setelah Markdown; minimum/waktu/rounding/alokasi mengikuti [02](02-offer-eligibility-and-money-basis.md).
- Kuota/budget minimal salah satu wajib; jatah akun default 1, configurable positif. Identitas adalah store client dengan verified email, bukan orang unik. Seluruh kode pada promo yang sama berbagi kapasitas; revision/rename/perubahan email tidak mereset usage. Mengikuti [03](03-redemption-limits-identity-and-reservations.md).
- Snapshot dan mapping uang mengikuti [04](04-tax-and-shipping-subsidy-accounting.md) dan [kontrak 09](contract-09-provider-representation-and-settlement.md). Refund/retur serta sync/restore akibat refund tidak dibangun; safety unpaid/late paid mengikuti [10](10-cancellation-refund-and-late-payment.md).
- Akun/order bertransaksi dilindungi dari hard-delete. Histori tidak dipurge otomatis; Excel asli tidak diarsipkan. Kode yang pernah diterbitkan tidak boleh dialihkan ke promo lain.
- Aplikasi belum running: compatibility fitur voucher existing, backfill usage, dan proyek migrasi histori legacy tidak diperlukan. Tidak ada izin reset/delete data dari keputusan ini.
- Tidak membuat tabel targeting, generic condition engine, reward/cashback ledger, code binding, identitas telepon, atau kuota periodik pada fase awal. Benefit baru tetap membutuhkan code/evaluator, tests, dan kadang migration/ledger tersendiri.

## 2. Logical schema

Nama berikut menjadi vocabulary desain; physical SQL/Drizzle dan mekanisme enforcement rinci diturunkan dalam complete implementation spec. Relasi, cardinality, ownership, dan invariant di sini tidak boleh berubah diam-diam.

```text
product_variant
 ├─ variant_price_current → variant_price_revision
 └─ price_change_batch_row → price_change_batch

discount_offer
 ├─ discount_offer_revision → discount_benefit (tepat satu saat publish)
 ├─ discount_code (hanya manual_only; banyak kode berbagi promo)
 ├─ discount_offer_usage
 └─ discount_client_usage → client

client → checkout_request → orders
orders → order_item
orders → discount_redemption (0..1)
          ├─ offer + revision + code opsional
          └─ discount_redemption_event
orders → order_discount_allocation → item / redemption / markdown revision
orders → jubelio_sales_operation (ledger existing, bukan ledger baru)
```

### 2.1 Markdown dan import — empat record

| Record | Isi utama dan aturan |
| --- | --- |
| `variant_price_revision` | `id`, `variant_id`, nomor revision, `set_price`/`restore_base`, target nullable hanya untuk restore, base/target/effective aktual sebelum-sesudah saat apply, actor, waktu, batch terkait. Hubungan row ditelusuri melalui applied revision pada row, tanpa FK balik yang membentuk siklus. Unique nomor revision per variant; histori tidak ditimpa. |
| `variant_price_current` | Satu row per variant: pointer revision milik variant yang sama, version monotonic, waktu. Row/pointer restore dipertahankan agar version tidak reset. Tidak ada row atau current restore berarti mengikuti base terbaru. |
| `price_change_batch` | Sumber manual/bulk/xlsx, actor, request key/fingerprint, versi template, parent retry batch, status dan jumlah applied/unchanged/failed/pending. Unique `(actor_id, request_key)`; key sama dengan isi berbeda ditolak. |
| `price_change_batch_row` | Nomor baris, SKU input terbatas, variant resolved nullable, action/target, snapshot preview, hasil validasi/apply dan alasan error, kondisi aktual apply, applied revision nullable, origin retry row nullable. Unique `(batch_id, row_number)` dan satu hasil final per row. |

- Row SKU tidak dikenal tetap tersimpan sebagai error tanpa FK variant palsu. Semua row SKU duplikat dalam file gagal; bukan last-row-wins.
- Upload hanya staging. Apply memeriksa data terbaru sesuai 01/05, bukan mewajibkan preview ulang atau menolak semua perubahan version secara otomatis. Target persen UI sudah menjadi fixed target; base berubah tidak menghitung ulang target.
- Target baru positif dan di bawah base terbaru saat apply; current target boleh tetap tersimpan ketika base kemudian turun, tetapi evaluasi fallback mengikuti 01. Harga efektif tidak diduplikasi ke kolom base yang dikelola sync.
- Batas dari `system_config`: 1.000 row/SKU, file 5 MiB, dekompresi 25 MiB. Proses foreground, bounded, row sukses langsung live, bukan batch atomik/background job. Semua hasil dan no-op mengikuti [05](05-bulk-adjustment-and-partial-import.md).
- Transaksi apply satu row mengikat revision/pointer/audit/hasil row bersama. Crash sesudah commit tidak membuat row sukses diterapkan ulang. Retry koneksi melanjutkan row pending dalam batch sama; koreksi row final gagal membuat batch baru yang linked.
- File asli hanya diproses sementara, tidak ditulis sebagai arsip durable; resource sementara dibersihkan. Simpan input relevan yang dibatasi, bukan workbook/formula executable. Download laporan/subset gagal dibentuk dari row records dengan export aman, tanpa mengevaluasi formula.
- No-op tidak membuat revision harga fiktif, tetapi row result dan audit tindakan tetap dapat ditelusuri. Fatal file ditolak sebelum perubahan live.

### 2.2 Identitas dan aturan promo — empat record

| Record | Isi utama dan aturan |
| --- | --- |
| `discount_offer` | Stable `id`/internal key; activation kind tetap `public` atau `manual_only`; state draft/enabled/paused/archived; current revision pointer/version; kuota/budget/jatah akun dan policy version; actor/waktu. Penggunaan melekat pada ID ini, bukan nama/revision/kode. |
| `discount_offer_revision` | `id`, `offer_id`, nomor revision, nama/terms, currency IDR, minimum subtotal setelah Markdown, waktu mulai/akhir opsional, schema/engine version, actor/waktu publish. Unique nomor revision per offer; published terms immutable. |
| `discount_benefit` | FK revision, kind/scope, rate atau nominal atau cap, params version dan object parameter terkontrol. Unique revision: paling banyak satu; publication guard mewajibkan tepat satu. |
| `discount_code` | Stable `id`, owner offer, kode canonical unique, state aktif/nonaktif/arsip, actor/waktu. Hanya milik offer manual; tidak ada binding akun/subkuota/expiry kode terpisah fase awal. Waktu aktif mengikuti offer revision. |

- Current pointer memakai ownership FK/composite key agar tidak menunjuk revision promo lain. Hal serupa berlaku untuk code yang dipakai redemption.
- Kode dinormalisasi trim + uppercase pada trusted seam, validasi panjang/karakter dibatasi dalam complete spec; uniqueness canonical mencegah alias beda kapital/spasi. Published literal dan owner kode immutable; ganti teks melalui record kode baru pada promo sama. Kode lama tetap reserved, bukan dapat diberikan ke promo lain.
- Public offer tidak memiliki code. `activation_kind` bukan atribut revision yang dapat diganti untuk mengakali larangan kedua jalur; perubahan jalur memerlukan identitas promo baru yang eksplisit.
- Percentage goods: `0 < rate <= 100`, cap opsional positif, fixed amount null. Fixed goods: nominal positif, rate/cap tidak dipakai. Shipping subsidy: cap positif, rate/fixed null. Money nonnegative/finite, IDR utuh untuk input harga/benefit; minimum boleh nol.
- Conditions awal berada pada kolom revision dan eligibility bernama yang sudah disetujui: minimum, waktu, delivery untuk subsidi, identitas/capacity. Tidak ada `discount_condition` atau target tables kosong.
- Draft terms boleh diedit sebelum publish. Publication memvalidasi benefit, currency, tanggal, supported versions dan completeness dalam satu transaksi bersama pointer. Revisi sesudah publish membuat revision baru; tidak menimpa histori atau order aktif.
- Limit operational diedit dengan kapasitas terkunci dan audit. Penurunan di bawah reserved + consumed ditolak, termasuk batas per akun terhadap komitmen akun terkait. Jika perlu memeriksa banyak akun, lakukan pemeriksaan terindeks di bawah lock offer yang juga dipakai seluruh mutasi usage; jangan mengambil unbounded lock per akun.

### 2.3 Kapasitas dan pemakaian — lima record

| Record | Isi utama dan aturan |
| --- | --- |
| `discount_offer_usage` | Satu row per offer: reserved/consumed count dan amount. Dibuat bersama identitas promo; nonnegative. Projection kapasitas yang harus konsisten secara transaksional, bukan analytics eventual. |
| `discount_client_usage` | PK `(offer_id, client_id)`, FK store client; reserved/consumed count dan amount. Init conflict-safe; tidak memakai email/IP sebagai identity. |
| `discount_redemption` | `id`, unique `order_id`, owner client, offer/revision/code terkait, activation, status reserved/consumed/released, benefit amount positif immutable, deadline, policy version, bounded terms/result snapshot, terminal metadata. |
| `discount_redemption_event` | Append-only event reserved/consumed/released/late_paid_review dengan idempotency key, previous/next status bila berubah, nominal, sumber authoritative/correlation, alasan, actor/waktu. Tidak ada refund event fase awal. |
| `order_discount_allocation` | Order dan item opsional, component markdown/offer_goods/offer_shipping, sumber markdown revision atau redemption+benefit, amount positif whole-line, snapshot/version. Ownership semua sumber/destinasi wajib cocok. |

- Redemption membuktikan order menggunakan promo apa, revision apa, kode apa bila manual, berapa potongannya, dan state pemakaiannya. Public memakai code null; manual wajib code yang aktif dan milik promo terpilih saat reserve.
- `UNIQUE(order_id)` berlaku untuk semua status redemption, bukan hanya reserved. Released row tidak dihapus untuk mengganti promo pada order sama. Ganti pilihan hanya pada preview sebelum order dibuat; checkout baru membuat order baru.
- Jangan membuat unique `(offer_id, client_id)` pada redemption karena limit configurable dan safe release memungkinkan penggunaan berikutnya. Batas ditegakkan oleh locked usage counters.
- Markdown allocation wajib item+markdown revision, tanpa redemption. Goods offer wajib item+redemption+benefit, tanpa markdown revision. Shipping offer tanpa item, wajib redemption+benefit. Allocation amount nol tidak dibuat.
- Composite ownership FK atau transaction guard membuktikan item/redemption milik order, client sama dengan owner order, benefit milik revision terpilih, code milik offer, dan Markdown revision milik variant item.
- Allocation dan money snapshots immutable sesudah order diterima. Event/counter/status berubah bersama pada lifecycle; provider observation/review evidence tidak menimpa harga historis.

### 2.4 Idempotency checkout — satu record

`checkout_request`: client FK, idempotency key, canonical request fingerprint, status/result, order FK nullable unique, timestamps. Unique `(client_id, idempotency_key)`.

- Fingerprint mengikat input customer yang relevan: pilihan cart/quantity, branch/fulfillment, destination/service dan persetujuan quote, serta pilihan promo. Uang browser bukan authority; perubahan harga server sesudah sukses tidak menyebabkan order dihitung ulang saat replay.
- Key dan fingerprint sama mengembalikan hasil/order yang sama. Key sama tetapi request berbeda ditolak. Hasil sukses tersimpan bersama order; concurrent retry hanya satu pemenang.
- Kegagalan sebelum commit tidak menyisakan order/redemption/stock hold parsial; key tidak terikat ke order yang tidak pernah committed. Key baru tetap tunduk pada stock/usage limits.
- Alur frontend memakai kembali key selama retry request logis yang sama. Ini berbeda dari idempotency provider yang melindungi satu order setelah dibuat, dan berbeda dari `saveRequestId` penyimpanan alamat existing.

## 3. Snapshot uang dan relasi provider

Tambahkan struktur snapshot berversi pada `orders` dan `order_item`, bukan mengganti source price master. Semua angka di bawah merupakan snapshot historis, bukan cache yang bebas diperbarui.

| Lokasi | Data wajib |
| --- | --- |
| Order header | Pricing/engine/contract version, currency, source goods subtotal, Markdown total, subtotal setelah Markdown, goods coupon total, net goods, ongkir sebelum subsidi, subsidi/funding merchant, net ongkir customer, quote/biaya kurir yang diketahui, taxable base/rate/PPN, total customer tanpa service fee, expected payable provider. Biaya kurir final yang belum diketahui tidak diisi nol palsu; gunakan ledger shipment existing saat bukti muncul. |
| Item | Variant/SKU/product label snapshot, quantity, source unit price, effective unit price, Markdown revision/context, whole-line Markdown amount, whole-line goods coupon amount, net line amount. |
| Delivery snapshot | Komponen approved quote/destination/origin/service serta pricing version yang konsisten dengan header. Booking/re-payment membaca snapshot, bukan address book atau promo terbaru. |
| Existing provider ledger | Payload version, immutable request/expected money, linkage order–SO/detail IDs–invoice–payment dan verification/review evidence yang diperlukan 09. Reuse `jubelio_sales_operation`; jangan membuat ledger dispatch pesaing. |

Pertahankan semantik `orders.subtotal` = setelah Markdown sebelum kupon; `orders.discount` = kupon barang; `orders.shippingCost` = net ongkir customer; `order_item.price` = effective unit price sebelum kupon. Legacy `voucher_id` text bukan pengganti FK redemption dan tidak perlu dual-write demi compatibility.

```text
source_goods = Σ(source_unit_price × quantity)
subtotal = Σ(effective_unit_price × quantity)
markdown_total = source_goods − subtotal = Σ(markdown allocations)
goods_discount = Σ(offer_goods allocations)
net_goods = subtotal − goods_discount = Σ(net line amounts)
net_shipping = shipping_before_subsidy − Σ(offer_shipping allocations)
taxable_base = net_goods
PPN = ceil(taxable_base × stored_rate / 100), sekali per order
total_customer = net_goods + PPN + net_shipping
expected_provider_payable = net_goods + net_shipping
redemption.amount = Σ(offer allocations), tidak termasuk Markdown
```

Provider unit price adalah source snapshot; whole-line discount = Markdown + goods coupon allocation, tidak dikalikan quantity lagi. `add_disc=0`, original ongkir sebelum subsidi, shipping net customer, `shipping_cost_discount` omitted. Tax/fee provider nol; verifikasi ketat mengikuti 09, tanpa toleransi Rp1.

Money memakai exact arithmetic, bukan binary-float untuk keputusan nominal. Penyimpanan relational mengikuti numeric terbatas/finite; JSON money decimal strings; datetime `timestamptz`, insert `Date`. Unit Rupiah dan precision rate mengikuti complete spec tanpa mengubah rounding 02/04/05. Snapshot version tidak dikenal ditahan/fail closed, bukan ditebak.

## 4. Matriks constraint dan transaksi

| Invariant | Database constraint | Tanggung jawab transaksi/module |
| --- | --- | --- |
| Current revision benar owner | PK/unique dan composite FK current → revision | Append revision dan pindah pointer atomik. |
| Satu benefit dan bentuk valid | Unique revision, NOT NULL/CHECK kind/rate/nominal/cap | Tepat satu saat publish, supported evaluator/version. |
| Kode canonical dan owner tetap | Unique canonical, FK owner; owner/type FK bila direpresentasikan secara composite | Normalisasi, public tidak punya code; larang penggantian published owner/literal. |
| Minimal kuota/budget dan angka valid | CHECK minimal satu limit global, limit positif, counters nonnegative | Reserve penuh saja, cek budget/count setelah lock; audit limit edits. |
| Satu slot promo/order | Unique redemption.order_id | Eligibility, client/activation/ownership dan amount > 0. |
| Snapshot/allocation konsisten | FK/composite ownership, CHECK shape/nonnegative, unique source–destination key | Cek seluruh persamaan header/item/allocation saat checkout; cegah edit financial fields sesudah accepted. |
| Usage tidak oversell | PK usage dan CHECK nonnegative | Lock, reserve/consume/release dan update projection+event bersama; FK/CHECK saja tidak menjamin kapasitas. |
| Lifecycle idempotent | Unique event key; satu consumed/released normal per redemption | Conditional transition hanya dari reserved; duplicate = no-op, bukan decrement ulang. |
| Checkout sekali | Unique `(client_id,key)` dan order link | Claim/fingerprint, order/items/allocations/redemption/stock intent/result satu transaksi. |
| Apply row sekali | Unique batch row, request key dan applied revision linkage | Row claim/hasil/revision/current/audit satu transaksi; laporan membedakan pending/no-op/error. |
| Tidak hilang melalui delete | RESTRICT pada relasi retention utama | Tidak menyediakan hard-delete transaksi atau mutasi histori; archive konfigurasi. |

Cross-row `sum(...)` dan harga target dibanding source mutable bukan ordinary CHECK. Tidak mengklaim FK/unique sudah menyelesaikan lifecycle, mandatory child, immutable rows, atau cross-table sums. Module menegakkan write paths; tidak menambahkan trigger/aturan generik tanpa desain SQL dan pembuktian pada tahap implementasi.

## 5. Transaksi, lock ordering, dan failure

### Reserve checkout

1. External read/quote/stock verification dilakukan di luar transaksi pendek; tidak ada provider write di sini.
2. Klaim request; kunci identity/capacity/source yang relevan sesuai urutan di bawah. Muat ulang authoritative state/version setelah lock; validasi owner, verified email, waktu, benefit, price, quote freshness dan kapasitas penuh.
3. Dalam satu commit: order, items, snapshot, allocations, redemption reserved, event, counters, stock hold, optional address save yang disetujui, durable SO intent, dan hasil request. Error sebelum commit menggulung semuanya.
4. Sesudah commit barulah dispatch provider melalui ledger existing. Hasil ambigu bukan alasan membuat order/intent baru atau mengirim ulang POST.

### Urutan lock global

Untuk seluruh path yang mengambil lebih dari satu kelompok, gunakan urutan yang sama; kelompok yang tidak diperlukan dilewati, bukan diambil belakangan secara terbalik:

1. Client owner (juga menyelaraskan save-address checkout existing).
2. Checkout request; atau batch lalu batch row pada apply administratif.
3. Offer identity dan code yang relevan; offer usage; client usage.
4. Variant/source lalu current Markdown, dalam urutan variant ID stabil.
5. Existing order lalu redemption, dalam urutan order ID stabil.
6. Branch stock, dalam urutan `(branch_id, variant_id)` stabil.
7. Existing provider operation yang dimutasi dalam transaksi terkait.

Tidak ada path yang mengambil offer/capacity setelah lebih dulu memegang order/stock/provider operation. Untuk callbacks/release, identitas boleh ditemukan via read tanpa lock lalu revalidated sesudah semua lock terkait diperoleh. Row usage diinisialisasi conflict-safe setelah parent offer terkunci. FK checks ikut diperhitungkan saat menurunkan physical implementation.

Ini kontrak target, bukan klaim urutan existing sudah sesuai. Integration harus mengaudit checkout, payment finalization, expiry/cancel, stock accounting, sync source dan admin edits terhadap urutan yang sama. Tidak menahan lock selama HTTP provider. Transaksi apply hanya satu row; tidak mengambil lock 1.000 variant sekaligus. Transaksi checkout bounded oleh cart yang diterima; tidak ada query/lock seluruh histori untuk reserve biasa.

DB deadlock/serialization boleh ditangani dengan retry terbatas hanya bila seluruh transaksi DB terbukti rolled back dan sebelum external dispatch. Tidak ada retry tanpa batas. Angka retry/timeout dan batas cart ditentukan serta diuji dalam complete implementation spec, bukan diasumsikan sebagai performa yang telah terbukti oleh dokumen ini. Provider outcome ambigu tidak pernah masuk mekanisme retry DB.

### Consume, release, dan rekonsiliasi

- Paid authoritative pada reserved redemption: conditional reserved → consumed, pindah count/amount reserved ke consumed dan append event dalam transaksi yang sama. Fulfillment provider masih blocked tidak membatalkan consumed.
- Unpaid terminal dan provider aman: reserved → released sekali, turunkan held count/amount, append event. Deadline lewat/payment attempt ditolak/timeout saja tidak membuktikan release aman.
- Paid setelah released: catat paid + review event idempotent, tahan fulfillment; tidak reacquire kuota atau mengubah released menjadi consumed otomatis. Tidak membuat ulang provider transaction/refund.
- Compare projection dengan ledger untuk mendeteksi drift. Mismatch ditahan untuk review; tidak reset/rebuild counters ketika checkout berjalan atau mengarang usage untuk menutupi selisih.

### Index minimum berdasarkan lookup

- Unique revision number per owner dan keys untuk composite ownership FKs; current pointer PK; canonical code unique.
- PK offer usage dan `(offer_id,client_id)` personal usage; redemption order unique; `(status,expires_at)` untuk hold lookup; `(offer_id,client_id,created_at)` untuk investigasi.
- Event unique key dan `(redemption_id,created_at)`; allocation source/destination uniqueness serta index order/item/redemption; FK lookup indexes yang dibutuhkan.
- Batch request key unique, `(batch_id,row_number)` unique, `(batch_id,status,row_number)` untuk resume/report, actor/created dan parent retry lookups.
- Checkout client/key unique dan order link unique; query discovery offer state/current revision serta stored validity timestamps. Tidak membuat time-dependent partial index dengan `now()` atau GIN seluruh JSON tanpa kebutuhan query yang terbukti.

## 6. Retention dan legacy

- Ubah target relasi client → orders menjadi RESTRICT, bukan cascade. Order → items/redemptions/allocations/provider operations dan evidence shipment terkait tidak boleh menjadi jalur hilangnya bukti transaksi. Gunakan RESTRICT pada FK retention terkait, bukan hanya menyembunyikan tombol delete.
- Revision published, offer/code yang sudah diterbitkan, batch/row final, redemption/events, allocations, snapshots, checkout result dan provider evidence dipertahankan tanpa purge otomatis. Offer/code dinonaktifkan/diarsipkan, bukan dipindah owner/dihapus agar dapat reuse.
- Store client yang terkait transaksi/usage/request dipertahankan. Tidak ada workflow anonimisasi, automatic account merge, atau identity lintas akun dalam scope ini. Perubahan email tetap memakai client ID dan wajib verifikasi untuk penggunaan berikutnya.
- Histori Markdown melindungi variant yang dirujuk dari cascade catalog delete; gunakan restrict pada revision/transaction references. Master katalog boleh berubah atribut/harga tanpa menimpa snapshot. Jangan menghapus histori agar sync/delete katalog lolos.
- Actor audit mengikuti pendekatan existing yang menyimpan identitas tindakan dan attribution aman ketika FK actor nullable; deletion actor tidak boleh menghapus batch/revision/event. Kebijakan admin identity existing tidak diperluas menjadi fitur deletion baru.
- Excel asli tidak disimpan durable; hasil row/audit cukup untuk laporan. Tidak menyimpan raw secrets, tokens, phone/IP/device fingerprint sebagai rule JSON.
- Retention tanpa purge adalah kebijakan aplikasi fase awal, bukan klaim kepatuhan atau keputusan masa simpan legal. Permintaan erasure/compliance kelak membutuhkan keputusan tersendiri, bukan mengaktifkan cascade diam-diam.
- Voucher existing dan `used` tidak menjadi sumber opening balance atau personal ledger. Tidak ada backfill/compatibility project, tidak ada fabrikasi customer pemakai, tidak ada reset penggunaan nyata. Jika fakta penggunaan nyata kelak ditemukan, hentikan cutover terkait dan minta keputusan; jangan mengasumsikannya data dummy. Dokumen ini tidak mengeksekusi delete/reset.

## 7. Contoh independen

Angka sintetis; PPN 11% hanya ilustrasi. Setiap baris adalah order berbeda, bukan stacking dua benefit.

| Kasus | Record dan hasil yang harus terbukti |
| --- | --- |
| `HEMAT17AGUSTUS` | Order O17 net barang sebelum kode Rp150.000, kode milik promo manual P17/revision R1, fixed benefit Rp17.000. Redemption menghubungkan O17 → P17/R1/code, amount Rp17.000. Net goods Rp133.000, PPN Rp14.630, pickup/fee0 → customer Rp147.630; payable provider Rp133.000. Paid membuat redemption consumed sekali. |
| Markdown + kupon | Source Rp300.000 → effective Rp150.000; public 10% memberi Rp15.000. Allocation Markdown Rp150.000 dan goods offer Rp15.000 terpisah; net Rp135.000, PPN Rp14.850; total Rp149.850. Provider price Rp300.000, whole-line discount Rp165.000, payable Rp135.000. Revision promo/restore sesudahnya tidak mengubah order ini. |
| Nominal dua baris | Effective Rp150.000/Rp100.000; fixed Rp25.000 sekali → allocation Rp15.000/Rp10.000, net Rp225.000; bukan Rp25.000 per baris. |
| Quantity2 | Source unit Rp100.000, effective unit Rp90.000, qty2, public 10%: Markdown whole-line Rp20.000, coupon Rp18.000, net Rp162.000. Provider gross Rp200.000, disc_amount Rp38.000, bukan dikalikan dua lagi. |
| Subsidi ongkir | Net goods Rp150.000; quote/original Rp30.000, cap Rp20.000 → net shipping Rp10.000. Redemption amount Rp20.000, allocation shipping tanpa item; goods discount0, PPN Rp16.500, customer Rp176.500; payable provider Rp160.000; biaya kurir tetap terpisah. |
| Kapasitas terakhir | Kuota100, consumed90, reserved9; dua order berebut satu slot. Hanya satu reserve sukses; yang lain ditolak tanpa order/stock hold parsial dan tanpa diskon dikecilkan. |
| Apply terputus | 100 row: 60 committed, 37 pending, 3 final error. Belum hasil final. Resume key sama menerapkan hanya 37 pending; akhir 97 applied/3 error, partial. Download tiga error dari row records tanpa Excel asli. |
| Rename/kode baru | P17 menambah kode lain atau revision R2; usage akun yang telah memakai `HEMAT17AGUSTUS` tetap milik P17. Teks kode lama tidak bisa diberikan ke promo P18. |
| Delete/replay/late paid | Hard-delete client/order bertransaksi ditolak. Replay checkout key sama mengembalikan order sama. Setelah safe release, late paid dicatat untuk review tanpa merebut slot customer lain. |

Contoh customer membayar fee Rp2.000 ketika barang habis terpotong ditarik: website tidak mengenakan service fee. [Koreksi eksplisit pemilik](decision-zero-payment-and-no-service-fee.md) mencoret outstanding 2 dan kewajiban pembuktian pembayaran/provider Rp0; bukan launch gate, bukan dukungan runtime yang diklaim, dan bukan izin mengubah guards/schema. Kasus pembayaran Rp0 di luar scope operasional dan dijaga prosedur admin/pemilik bisnis.

## 8. Compatibility, deployment, seeding, dan extension

- Schema hanya di `packages/db/src/schema/`; apps menjadi consumers. Tidak perlu compatibility API/fitur voucher lama atau dual-write legacy. Order historis tetap snapshot tersimpannya; perubahan master tidak menghitung ulang uang order.
- Order/payload memiliki versi eksplisit. Deploy schema dan readers/evaluator yang mendukung versi sebelum konfigurasi versi baru dapat dipublikasikan; proses lama tidak boleh mengeksekusi aturan yang tidak dipahaminya. Writer dipagari sampai seluruh proses relevan kompatibel. Jika rollback reader tidak mendukung data baru, hentikan writer dan gunakan rencana rollback teruji, bukan membuka versi tak dikenal atau blind down-migration.
- Generated SQL tetap audit record, tidak diedit manual. Dev menggunakan `db:push`; deployment menggunakan migration container existing. Saat implementasi, review file deployment common/staging/production dan readiness/rollout jika build/env/job/storage berubah. Kontrak ini tidak menambah provider endpoint, storage arsip Excel, atau cleanup cron baru.
- Seeder harus mengikuti FK deletion order untuk reset test/demo yang disengaja, membuat config limit import dan fixtures Markdown/revision/restore/partial import/public percentage/fixed/shipping/manual code serta lifecycle yang konsisten. FK RESTRICT bukan izin menonaktifkan constraint di aplikasi; test reset harus eksplisit dan dependency-ordered. Mode Jubelio tetap bebas dummy catalog/transaction dan seeder tetap dilarang production.
- Module pricing menerima authoritative inputs dan menghasilkan exact result+allocations+versions; module transaksi menyembunyikan locking/counter/events/idempotency dari callers. Tidak membuat generic plugin framework atau adapter hipotetis demi satu evaluator. Unknown kind/version ditolak saat publication/evaluation.
- JSON hanya untuk bounded typed/versioned params dan historical evidence, bukan menggantikan FK, nominal inti, limit atau evaluator. Identity, money, ownership dan query utama tetap relational.
- Tier discount kelak membutuhkan named evaluator/params/tests/admin controls. Targeting memerlukan typed catalog FKs/migration dan policy matching. BOGO/gift memerlukan reward SKU/quantity/stock rules. Cashback/points memerlukan account/posting ledger sendiri; bukan allocation potongan instan. First-order entitlement memerlukan shared atomic claim lintas offer. Semua di luar implementasi awal.

## 9. Acceptance dan status review

Verifikasi implementasi mendatang, bukan test yang sudah dijalankan:

- DB/integration: ownership FK, one-slot/one-benefit, canonical code uniqueness/reserved names, retention restrictions dan FK cleanup seed.
- Logic: contoh nominal independen di atas, rounding 02/04/05, shape benefit, unknown version fail closed, fallback/restore serta snapshot immutability.
- Real DB concurrency: kuota/budget/jatah akun, stock race, limit edit vs reserve, publish/pause vs reserve, idempotency, duplicate callbacks/releases, row resume serta lock-order/deadlock handling.
- Playwright: picker/code terpisah, kode tercatat pada order yang benar, selection/benefit/error, preview/import partial/retry dan user-visible totals. Detail UX/permission tetap harus konsisten dengan tiket 06, bukan dianggap selesai di sini.
- Provider contract: snapshot mapping/versions/reconciliation 09 tetap wajib. Evidence status mirror setelah invoice/payment tersedia pada M1/M2; pembuktian pembayaran/provider Rp0 dicoret oleh pemilik sesuai koreksi scope, bukan pekerjaan tertunda. Integration/tests aplikasi tetap terpisah. Tidak ada provider request dari sesi ini.
- Complete spec tetap perlu merinci endpoint seams, rate limiting angka/window yang ditunda 03, bounded execution limits dan test/rollout strategy sebelum Ready/implementasi. Ini tidak menambah grilling produk tiket 11 yang sudah selesai.

Bukti sesi: pembacaan research existing, schema orders/marketing/auth/products/provider ledger, checkout dan keputusan prerequisite; pemeriksaan konsistensi dokumen serta aritmetika contoh. Tidak ada SQL, edit shared schema/app/config, seed, migration generation/execution, tests/build/lint/typecheck, provider request, subagent, commit atau deployment.

Persetujuan: pemilik menyetujui keputusan grilling dan relasi order → redemption → offer/revision/code, lalu mengizinkan close bila tidak ada item grilling tersisa. Agent kemudian menyajikan dokumen lengkap ini beserta ringkasan cakupan dan batas izin. Pemilik memberikan approval akhir melalui `ask_user_question` dengan memilih **Setuju, tutup tiket (Recommended)**. Tiket 11 resolved sebagai keputusan planning; approval complete implementation spec, implementasi, tests/provider verification, commit dan launch tetap memiliki gates terpisah. Approval schema awal tidak menyelesaikan dua gates pada saat itu; status terkini mengikuti kontrak09 dan koreksi scope pemilik yang ditautkan di awal dokumen.

## Referensi

- [Research database (usulan awal, bukan kontrak final)](../research/discount-database-design.md).
- [Database ownership/timestamps/seed](../../../docs/architecture/database.md).
- [Orders dan cascade existing](../../../packages/db/src/schema/orders.ts).
- [Voucher existing](../../../packages/db/src/schema/marketing.ts).
- [Provider ledger existing](../../../packages/db/src/schema/jubelio-sales.ts).
- [Checkout existing](../../../apps/store/src/app/api/checkout/place-order/route.ts).
- [Local tracker](../../../docs/agents/issue-tracker.md).
