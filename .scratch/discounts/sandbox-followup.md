# Sandbox lanjutan — tambahan maksimal 5 create SO

## Otorisasi dan budget

Pemilik mengizinkan 5 create SO tambahan setelah H, kemudian meminta: **“iya tolong jalankan”**. Budget kumulatif maksimal **10 request create**, termasuk outcome ambigu. Counter authoritative tetap `createAttempts` pada [sandbox-results.json](sandbox-results.json), bukan counter baru. Saat protokol ditulis: 5/10 terpakai. Tidak ada delegasi, perubahan aplikasi/master/config, commit, atau production.

Eksperimen ini hanya membuat fixtures baru J–N. B/G tetap unknown/manual-review, tidak diulang atau dimutasi. Persetujuan eksekusi baru bukan bukti rollback B/G. Otorisasi eksekusi baru berlaku untuk kasus independen berikut; setiap ambiguity baru kembali menghentikan semua business writes.

[Tiket 04](issues/04-tax-and-shipping-subsidy-accounting.md) dan [07](issues/07-jubelio-verification-access-and-permissions.md) sekarang resolved; tiket 08 claimed. Catatan lama [research 08](research-08-evidence.md) berisi usulan 8 create, tetapi **tidak berlaku sebagai budget eksekusi**; protokol aktual ini memakai maksimal 5 tambahan sesuai instruksi terbaru pemilik.

## Pengaman dan sumber

- Credentials dari `.env` main checkout secara privat; token hanya dalam memory. Customer dummy 116918, label fixture existing; jangan memakai customer asli.
- Source INTERNAL 1; item 43842 (SKU 4062449831429, harga Rp259.000) dan 43843 (SKU 4067896894195, Rp250.000), unit Buah, lokasi 2 jika master dan stock recheck mendukung.
- Qty 1–2 per line, maksimal dua line, gross maksimal Rp600.000/SO dan Rp2.000.000 seluruh tranche tambahan. Provider tax/ongkir/fee nol, tax ID 1. Tidak mengubah keputusan website tentang PPN/funding.
- Preservasi harga master; diskon tetap eksplisit. `disc = nominal_line / gross_line × 100`, tanpa pembulatan sebelum pengiriman. Quantity >1 adalah hipotesis whole-line yang harus diuji, bukan asumsi final.
- H membuktikan qty 1: persentase panjang dapat dikirim dan GET mengembalikan dua desimal sambil mempertahankan nominal tepat. Pengaruh edit memakai persentase GET yang sudah pendek belum terbukti; kasus J sengaja mengujinya.
- Referensi unik run/case; semua input bisnis disimpan lengkap tanpa auth; output hanya allowlist IDs/money/state/due/association, bukan raw customer/provider body.
- Sebelum setiap create: GET master dan stock recheck. `POST /inventory/items/all-stocks/` adalah pembacaan stock sesuai client repo, bukan create SO.
- Tidak retry write otomatis. Intent/counter dicatat sebelum request; hasil HTTP/network/missing ID ambigu menghentikan suite. Money mismatch menghentikan settlement dan kasus berikutnya. Cleanup hanya jika identitas/state SO diketahui, aktif dan pre-invoice. Tidak cancel setelah invoice.
- Maksimal satu invoice dan satu payment (hanya kasus J). Payment sama persis dengan payable invoice yang sudah diverifikasi; tidak mengirim payment sengaja mismatch. Invoice/payment dibiarkan sebagai artefak audit sandbox.
- Kontrak: [schema resmi](https://docs-wms.jubelio.com/dist.yaml), [SO client/create/edit](../../apps/store/src/lib/jubelio-sales-client.ts), [payment builder](../../apps/store/src/lib/jubelio-sales-client.ts#L1993), [runtime contract existing](../../docs/features/jubelio-sales-orders.md#sandbox-observed-runtime-contract-2026-09-24-env-test-account). Tidak menghapus guard aplikasi yang masih zero-discount; eksperimen API langsung terpisah dari aplikasi.

## Urutan dan expected money independen

| Kasus | Request inti | Expected yang akan diverifikasi | Lifecycle |
|---|---|---|---|
| J — nominal pecahan dan settlement | 43842 ×1, gross 259000, nominal 20000, disc 7.722007722007722 | Header/line net 239000, discount 20000 | Create → GET → full payload marker `Belum Bayar` → `Menunggu Verifikasi` dengan detail IDs dan field GET → GET → invoice → GET invoice + linkage SO → payment 239000 → GET payment + invoice |
| K — qty 2 | 43842 ×2, gross 518000, nominal seluruh line 51800, disc 10 | Net line/header 466200. Alternatif per-unit akan memberi net 414400; jangan mengklaim whole-line dari input saja | GET → cancel pre-invoice → GET + stock |
| L — dua line kupon cap/fixed | 43842 ×1 + 43843 ×1, gross 509000, nominal order 20000; alokasi 10177 dan 9823 | Line net 248823 dan 240177, total net 489000, total discount 20000 | GET → cancel pre-invoice → GET + stock |
| M — header discount terisolasi | 43842 ×1, line discount 0, `total_disc=0`, `add_disc=10000`, line amount 259000 | Hipotesis header discount terpisah: grand total 249000. Observasi apakah provider mempertahankan/mengubah header agregat | GET → cancel jika state diketahui; mismatch menghentikan suite |
| N — line + header discount | 43842 ×1, line discount 20000 dan derived disc, `total_disc=20000`, `add_disc=5000`, line amount 239000 | Hipotesis terpisah yang hanya diuji jika M terverifikasi: grand total 234000, bukan double count | GET → cancel pre-invoice → GET + stock |

Alokasi L independen memakai proporsi gross 259000:250000. Nilai ideal: 10176.817… dan 9823.182…; largest remainder memberi **10177 + 9823 = 20000**. Persentase per line diturunkan dari alokasi tersebut, bukan mengirim 10% lalu berharap provider mengetahui cap Rp20.000.

M/N adalah eksperimen hipotesis `total_disc = jumlah diskon line`, `grand_total = gross − total_disc − add_disc`. Ini bukan formula dokumentasi resmi yang sudah terbukti atau pemilihan mapping production. Jika M berbeda, jangan mencoba pasangan header lain pada N secara otomatis.

Scope ini tidak menguji writable subsidi/funding ongkir, pajak provider nonzero, refunds, atau free-order. Penyelesaian kelima kasus tidak otomatis menutup tiket 08/09.

## Hasil

Eksekusi pada 2026-10-14 UTC memakai **5/5 tambahan**, total kumulatif **10/10 create attempts**. Seluruh kasus J–N lulus pemeriksaan money independen. Evidence lengkap: [sandbox-results.json](sandbox-results.json), event `followup-authorized` sampai `followup-complete`. Field `requestBody` pada intent memuat input bisnis aktual termasuk timestamp; `snapshot`/`responseProjection` adalah allowlist output aktual, bukan raw body lengkap.

| Kasus | SO | Hasil GET dan cleanup |
|---|---:|---|
| J | 68411 | Diskon 20000/net 239000 tetap tepat pada create, marker edit, invoice 45951, dan payment 40. Payment GET memiliki tepat satu association ke invoice 45951/SO 68411, `payment_amount: 239000`, `due: 0`. Tidak dibatalkan karena sudah invoice/payment. |
| K | 68412 | Qty 2, gross 518000, `disc: 10.00`, `disc_amount: 51800.0000`, line/header net 466200. Bukan net 414400 akibat potongan per-unit ganda. Cancel terverifikasi, available kembali 3 setelah J mengonsumsi satu unit. |
| L | 68413 | Gross 509000, nominal line 10177 dan 9823, net 248823 dan 240177, total net 489000. Kedua `disc` GET menjadi 3.93 tetapi nominal tetap tepat. Cancel dan stock restore kedua SKU terverifikasi. |
| M | 68414 | `total_disc: 0`, `add_disc: 10000`, line amount 259000, grand total 249000. Cancel dan stock restore terverifikasi. |
| N | 68415 | `total_disc: 20000`, `add_disc: 5000`, line amount 239000, grand total 234000. Cancel dan stock restore terverifikasi. |

### Temuan kontrak yang teramati

1. **Representasi diskon:** hitung persentase dari nominal baris dan gross baris, tetapi nominal website tetap authoritative. Pada J, `disc` awal 7.722007722007722 disimpan GET menjadi 7.72; full-payload edit dengan 7.72 mempertahankan nominal 20000/net 239000, dan invoice juga mempertahankannya.
2. **Quantity >1:** pada kasus K, nominal 51800 diterima/disimpan sebagai potongan satu line qty 2 dan net tetap 466200, bukan dikalikan quantity lagi. Ini bukti kasus whole-line yang konsisten, bukan bukti precedence universal jika field saling bertentangan.
3. **Alokasi:** L membuktikan dua nominal Rupiah hasil largest remainder dipertahankan meskipun kedua persentase GET sama-sama 3.93. Jangan menghitung ulang nominal dari persentase GET yang sudah dibatasi presisinya.
4. **Header discount:** pada kasus M/N dengan tax/fee/ongkir nol, `total_disc` menyimpan jumlah diskon line dan **tidak mencakup `add_disc`**. Observasi konsisten dengan `grand_total = sub_total − total_disc − add_disc`. Ini tidak mengubah keputusan bahwa subsidi ongkir tidak boleh disamarkan sebagai diskon barang.
5. **Lifecycle:** hanya J yang membuktikan marker → invoice → payment. Invoice GET tetap `salesorder_id: null`; linkage dibuktikan oleh SO GET `invoice_id: 45951`, nomor SO yang sesuai, identity/lokasi, serta nominal/detail baris. Payment GET membuktikan association satu kali dan due nol; invoice GET setelah payment membuktikan nominal tetap, tetapi tidak memuat field due pada projection yang teramati. Tidak ada klaim tentang flag `is_paid` SO atau Midtrans.

### Artefak dan stock

- SO 68411/invoice 45951/payment 40 sengaja dibiarkan sebagai artefak sandbox terbayar. SKU 43842/location 2 `on_hand`/available berubah dari 4 menjadi 3 setelah invoice; bukan stock leak dari SO canceled.
- SO 68412–68415 canceled; stok SKU 43842 kembali 3, SKU 43843 kembali 1. SO lama tidak dimutasi. B/G tetap unknown, tanpa retry.
- Tidak ada create ke-11. Gross tranche tambahan Rp1.804.000, di bawah batas internal Rp2.000.000. Counter lama tidak direset.

### Contoh request/response kasus J

Create `POST /sales/orders/` menggunakan input lengkap berikut; nama customer merupakan fixture dummy tanpa PII:

```json
{
  "salesorder_id": 0,
  "salesorder_no": "[auto]",
  "contact_id": 116918,
  "customer_name": "DISCOUNT-VERIFY-2026-10-14T15-58-21-705Z",
  "transaction_date": "2026-10-14T17:08:38.001Z",
  "is_tax_included": false,
  "note": "DISCOUNT-VERIFY-2026-10-14T15-58-21-705Z-J",
  "ref_no": "DISCOUNT-VERIFY-2026-10-14T15-58-21-705Z-J",
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

Create HTTP 200 — proyeksi response:

```json
{"id":68411}
```

Marker request memakai full payload tersimpan pada event `J-marker` dengan `salesorder_id: 68411`, nomor `SO-000068411`, detail ID 74694, `disc: 7.72` dari GET, dan marker `Menunggu Verifikasi`. Field money tetap sama; response HTTP 200/proyeksi `{"id":68411}` lalu GET membuktikan marker/nominal tepat.

Invoice request `POST /sales/packlists/create-invoice`:

```json
{"salesorder_id":68411}
```

HTTP 200 — proyeksi response:

```json
{"id":45951,"status":"ok"}
```

Payment request `POST /sales/payments/`:

```json
{
  "account_id": 2,
  "amount": 239000,
  "contact_id": 116918,
  "contact_name": "DISCOUNT-VERIFY-2026-10-14T15-58-21-705Z",
  "payment_id": 0,
  "payment_no": "[auto]",
  "payment_type": 0,
  "transaction_date": "2026-10-14T17:08:40.035Z",
  "note": "DISCOUNT-VERIFY-2026-10-14T15-58-21-705Z-J",
  "items": [{"payment_detail_id":0,"invoice_id":45951,"payment_amount":239000}]
}
```

HTTP 200 — proyeksi response:

```json
{"id":40,"status":"ok"}
```

GET `/sales/payments/40` — proyeksi response:

```json
{
  "amount": "239000.0000",
  "invoices": [
    {"invoice_id":45951,"salesorder_id":68411,"payment_amount":239000,"due":0}
  ]
}
```

ID payment 40 berasal dari response create dan URL GET; field amount/invoices di atas berasal dari body GET yang teramati. Semua input K–N, full marker J, dan GET money/invoice lengkap yang diizinkan tersimpan pada event terkait di JSON; tidak ada token/header auth di evidence.

## Batas penutupan dan verifikasi

- Tidak semua gap tiket 08 selesai: writable field subsidi/funding ongkir INTERNAL belum diuji/dikonfirmasi; B/G tetap unknown; lifecycle multi-line/qty 2/header discount belum diuji hingga invoice/payment. Tidak menggeneralisasi lima kasus ini ke semua kombinasi atau langsung menutup tiket 08/09.
- Fresh public spec GET membuktikan enam block schema cocok dengan vendor spec sebelum write. Seluruh write diikuti GET independen dan assertion nominal/identity yang relevan.
- Runner inline pertama terpotong sebelum parsing selesai (SyntaxError/heredoc); tidak ada kode yang dieksekusi, counter tetap 5 dan belum ada tranche intent. Eksekusi dipindah ke runner research sementara di OS temp, dicek syntax, lalu dijalankan sekali; bukan file aplikasi/reusable integration dan tidak berisi credentials literal.
- Tidak menjalankan unit/E2E/build/lint/typecheck aplikasi karena scope research provider tanpa perubahan kode aplikasi. Tidak ada commit/delegasi/deployment.

