# Keputusan parsial mapping ongkir Jubelio — original dan net, tanpa discount field

## Approval dan batas keputusan

Pemilik meminta mengecualikan shipping_cost_discount dan mengisi shipping_cost serta original_shipment_cost seperti caseG. Agent menjelaskan gross/original versus net, pemisahan subsidi merchant, gap payment dan implikasi terhadap pilihan goods-only sebelumnya. Pemilik kemudian memilih **Ya, catat revisi mapping (Recommended)** pada pertanyaan eksplisit revisi scope.

**Arah planning terbaru: barang + net ongkir**, bukan goods-only. Ini menggantikan pilihan goods-only sebelumnya dalam diskusi, tetapi **bukan approval implementasi, complete contract tiket09, penutupan tiket08, testing tambahan, subagent, atau commit**. Approval awal arah mapping tidak sekaligus merevisi required proof08; revisi scope bukti kemudian disetujui secara terpisah sebagaimana dicatat di bawah. Kode existing tetap belum diubah dan dapat tetap memakai goods-only; arah planning baru tidak dianggap sudah berjalan di runtime.

Keputusan ini dicatat sebagai hasil parsial dari pembahasan evidence08 untuk bahan mapping09. Setelah T1–T3 dan review scope approved, tiket08 kini resolved; tiket09 tetap open/unclaimed dan unblocked. Tidak ada claim atau jawaban lengkap09 yang diasumsikan.

## Mapping request yang dipilih

| Komponen | Arah mapping |
| --- | --- |
| Barang setelah diskon | Diskon SO dialokasikan per baris, total_disc menjumlahkan alokasi, add_disc0; jangan menyamarkan potongan dengan penurunan unit price atau gross payment |
| Ongkir sebelum subsidi customer | `original_shipment_cost` |
| Net ongkir yang dibayar customer | `shipping_cost` |
| `shipping_cost_discount` | **OMIT dari request**, termasuk tidak dikirim sebagai0/null/empty string |
| Subsidi/funding merchant | Dicatat terpisah di website/order snapshot, bukan otomatis dianggap dijurnal provider lewat dua field di atas |
| Quote/biaya kurir sebenarnya | Tetap dicatat terpisah dari customer shipping dan funding; tidak otomatis turun karena subsidi |
| PPN/fee website | Tetap mengikuti keputusan finance04; revisi mapping ini tidak memasukkannya ke provider atau mengubah tax basis |

Subsidi yang digunakan tetap mengikuti eligibility/clipping yang sudah diputuskan pada tiket02; keputusan ini tidak membuka kembali aturan promo. Net ongkir dihitung sekali di website, lalu dikirim sebagai nilai net. Jangan mengurangi subsidi lagi dari shipping_cost atau memasukkannya ke disc_amount barang.

`original_shipment_cost` berarti ongkir sebelum subsidi customer dalam arah mapping ini, bukan otomatis sama dengan quote/biaya kurir ketika keduanya berbeda. Menaruh net di original bukan arah yang disetujui.

GET provider boleh menampilkan shipping_cost_discount0 sebagai default walaupun request tidak memiliki key itu. Exclusion mengatur **actual request field presence**, bukan larangan membaca field response atau alasan menolak default0 yang sudah teramati.

## Contoh konkret yang disetujui sebagai arah

```text
Barang gross1000000 − diskon barang100000 = net900000
Ongkir sebelum subsidi30000 − subsidi merchant20000 = net customer10000
Payable Jubelio kandidat = 900000 + 10000 = 910000
```

Potongan financial payload:

```json
{
  "sub_total": 1000000,
  "total_disc": 100000,
  "original_shipment_cost": 30000,
  "shipping_cost": 10000,
  "grand_total": 910000
}
```

Key shipping_cost_discount tidak ada. Identity/line/tax/fee fields required tidak semuanya ditampilkan; ini bukan full payload siap implementasi. Contoh payable tidak mencakup PPN/fee website. Snapshot website tetap menyimpan ongkir awal30000/subsidi20000/net10000/funding merchant dan quote/biaya kurir secara terpisah.

Nominal website/Midtrans termasuk PPN barang/fee yang berlaku tetap mengikuti finance04; jangan menyamakan total customer website dengan payable provider ketika komponennya berbeda. Dengan net barang900000 dan net ongkir10000, provider kandidat910000, sedangkan website menambahkan PPN barang/fee sesuai kontrak04.

## Fakta provider yang mendukung dan batasnya

- **CaseG:** SO68432 → invoice45964, goods discount100000, original30000/net shipping10000/grand910000, tanpa shipping_cost_discount pada request; invoice money/linkage verified.
- **I-minus:** SO68436 → invoice45968, tanpa goods discount, original30000/net10000/grand1010000; verified.
- **J-minus:** SO68437 → invoice45969, goods discount100000, original30000/net10000/grand910000; verified.
- CaseG/I-minus/J-minus tetap artefak invoice unpaid. **Payment konfigurasi terpilih kemudian diverifikasi melalui fixtures baru T1/T2**: SO68440/invoice45972/payment55 sebesar910000 dan SO68441/invoice45973/payment57 sebesar1810000; association benar/due0. [Hasil dan review lifecycle](research-08-selected-lifecycle.md).
- SO GET mempertahankan original_shipment_cost, tetapi field itu tidak tersedia pada invoice GET; preservation metadata internal invoice tidak dianggap verified, sesuai acceptance pemilik.
- Full-payload mirror sebelum invoice/cancel pada T1/T2/T3 mempertahankan IDs/uang; T2 mencakupqty2 satu baris, T3 safe cancel/stock restore. Ini bukan verifikasi semua edits post-invoice. Guard aplikasi tidak diubah atau dihapus.
- Field20000/10/20 gagal pada request masing-masing yang diuji; **unit shipping_cost_discount tetap unknown**, bukan fakta pasti amount atau persen dan bukan klaim field intrinsik salah di semua sources/nominal.

## Approval tambahan atas scope bukti08

Setelah questionnaire remaining issues, pemilik memilih **Ya, fokus mapping terpilih (Recommended)**, **Per baris, add_disc0 (Recommended)**, **Pisahkan tindak lanjutnya (Recommended)**, dan **SO + nominal lifecycle (Recommended)**. [Scope dan acceptance approved](research-08-approved-proof-scope.md).

Required proof08 kini fokus pada mapping terpilih/per-line discount/add_disc0. Field ongkir/funding yang tidak dipakai dan header discount nonzero tidak wajib dibuktikan untuk scope awal. Original ongkir cukup diverifikasi pada SO; invoice/payment dinilai melalui nominal dan linkage yang tersedia, tanpa klaim metadata internal invoice verified. Outcome/cleanup legacy dipisahkan dari gate bukti kontrak baru, tetap unknown dan tanpa izin cleanup atau tiket baru otomatis.

## Pekerjaan dan unknowns yang tetap terbuka

1. Kontrak mapping09 lengkap: field/nominal per stage, source of truth, verifikasi invoice/payment/mirror, payload versioning, mismatch/ambiguity handling dan snapshot lokal masih perlu dibahas serta disetujui sebagai keseluruhan.
2. Bukti payment, full-payload mirror sebelum invoice/cancel, qty>1 dan safe cancel konfigurasi terpilih telah dipenuhi T1–T3 sesuai protokol yang diizinkan. Jangan menyimpulkan semua stages/configurations lain didukung atau menjalankan writes baru tanpa izin.
3. Required proof08 yang direvisi telah direview terhadap T1–T3 dan evidence existing;08 resolved pada scope terpilih. Ini bukan approval complete contract09 atau implementasi.
4. Unknown outcome/disposition fixtures B/G lama dan conversion errors lain tetap dicatat sebagai follow-up terpisah, bukan gate kontrak baru atau proof rollback. Cleanup/retry/cancel tetap memerlukan state aman dan izin terpisah.
5. Accounting/funding subsidi merchant tidak dianggap otomatis tercatat pada Jubelio; website menyimpan komponennya sesuai04. Tidak mewajibkan writable funding field yang tidak dipakai, dan jangan memperbaiki account mapping/config tanpa scope serta izin baru.

Pada checkpoint keputusan mapping/scope budget37 tanpa business write baru. Setelah protokol T1–T3 yang disetujui, kumulatif sekarang40 create attempts. Tidak ada perubahan aplikasi/schema/master/account mapping/env, unit/E2E/build/lint/typecheck aplikasi, subagent atau commit; tidak ada izin write tambahan otomatis.

## Referensi

- [Finance04 yang tetap berlaku](issues/04-tax-and-shipping-subsidy-accounting.md#answer--keputusan-final-disetujui).
- [Eligibility/clipping02](issues/02-offer-eligibility-and-money-basis.md).
- [Evidence matriks G](research-08-field-matrix-evidence.md).
- [Ablation I/J tanpa field](research-08-without-shipping-discount.md), [journal](research-08-without-shipping-discount-results.json).
- [Hipotesis unit persen](research-08-shipping-percentage.md).
- [Tiket08](issues/08-jubelio-nonzero-discount-evidence.md) dan [tiket09](issues/09-provider-representation-and-settlement.md).
