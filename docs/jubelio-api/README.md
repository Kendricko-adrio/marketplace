# Jubelio API references

These are **two separate APIs**:

| Reference | Host | Scope |
|---|---|---|
| [`dist.yaml`](dist.yaml) | `https://api2.jubelio.com` | Omnichannel OpenAPI specification, exported from Jubelio's API documentation. Used as a reference for master-data sync in `packages/db/src/jubelio-sync.ts`. |
| [`shipment-v1.8.md`](shipment-v1.8.md) | `https://api-shipment.jubelio.com` (sandbox: `https://api-shipment.sandbox.jubelio.com`) | Shipment API contract from the supplied [`API Contract Jubelio Shipment v1.8.pdf`](../../API%20Contract%20Jubelio%20Shipment%20v1.8.pdf): regions, rates, AWB create/cancel/detail, and webhook. This is a documented contract, **not** a live-verified integration. |

Do not treat Shipment paths, credentials, or tokens as interchangeable with
Omnichannel's. See `docs/features/jubelio-sync.md` for the existing sync design.

## How to use

- **Omnichannel:** Import `dist.yaml` into Postman, Insomnia, or Stoplight, or
  search the YAML for a path such as `/inventory/items/masters`.
- **Shipment:** Read [`shipment-v1.8.md`](shipment-v1.8.md) for the PDF-derived
  API reference with page citations and explicit contract ambiguities. The PDF
  is not an importable OpenAPI specification.

## Most relevant endpoints for sync

| Endpoint | Used for |
|---|---|
| `POST /login` | Auth — `{email, password}` → `{token}` (12h expiry) |
| `GET /inventory/items/masters` | Paginated product master list (item groups + items) |
| `GET /inventory/catalog/{id}` | Per-item-group detail: description, `images[]` gallery |
| `POST /inventory/items/all-stocks/` | Per-location stock for all items |
| `GET /locations/list` | All outlet locations (branches) — NOT `/locations/`, which returns only the webstore |

## Caveat: spec vs. live behavior

`dist.yaml` is an **external reference** and may drift from actual Omnichannel
API behavior. If it and the live sync API disagree, the code in
`packages/db/src/jubelio-sync.ts` is the reference for behavior already
verified against the live API. The Shipment PDF has **not** been verified
against live Shipment endpoints in this repository.

## Input pajak Sales Order

Schema `saveSalesOrderRequest` menyediakan `items[].tax_id`,
`items[].tax_amount`, `total_tax`, dan `is_tax_included`; deskripsi
`tax_amount` meminta pengirim menghitung pajak setiap item. Kontrak aplikasi
saat ini tetap memakai pajak provider nol: ini batas integrasi/keputusan
existing, bukan bukti bahwa API tidak mendukung pajak.

[Riset input pajak dan skenario sandbox](../../.scratch/jubelio-sales-api-switching/research/jubelio-sales-order-tax-input.md)
memuat perbandingan schema resmi pada 2026-10-26, ketidakpastian rumus
`amount`/pembulatan, dan usulan verifikasi SO → invoice → payment. [Canary SO berpajak](../../.scratch/jubelio-sales-api-switching/research/jubelio-tax-canary-verification.md#hasil-final--pemilihan-item-available-dan-dua-so-berhasil)
pada 2026-10-26 berhasil: SO68449 menerima `tax_id:-2`, `tax_amount:11000`,
`total_tax:11000`, line `amount:111000`, dan `grand_total:111000` untuk
qty1/harga100000/mode exclusive tanpa diskon/ongkir/fee. Create, GET, cancel,
dan pemulihan stok terverifikasi; SO kontrol68448 juga lulus. [Kelanjutan invoice/payment](../../.scratch/jubelio-sales-api-switching/research/jubelio-tax-canary-verification.md#kelanjutan-invoice-dan-payment--berhasil)
pada fixture baru SO68450 → invoice45978 → payment67 juga berhasil HTTP200:
pajak line/header11000 dan total111000 dipertahankan, paid111000/due0
terverifikasi. Fixture settlement dipertahankan paid dan stok berkurang satu
sesuai izin. Jurnal accounting UI, variasi pajak lain, dan status mirror
belum diuji. Bukti ini tidak mengubah kebijakan atau kode integrasi. Setiap login/POST tetap memerlukan
izin eksplisit sesuai scope.

## Related docs

- `docs/features/jubelio-sync.md` — Omnichannel sync architecture, invariants, env vars, webhook setup
- `docs/jubelio-api/shipment-v1.8.md` — Shipment-specific contract reference

### Master pajak (`GET /taxes/`)

- Endpoint dokumentasi: `GET /taxes/?page=N&pageSize=100` → `{ data: [...], totalCount }`
  dengan field `tax_id`, `tax_name`, `rate` (string), `tax_in`, `tax_out`.
- Tenant riset mengembalikan 6 record, termasuk **PPN 11% = `tax_id: -2`**
  (`tax_out: 2-2103 PPN Pengeluaran`) dan `1 = No Tax` (`rate 0.00`, tanpa akun).
  ID negatif adalah data master sah; rate PPh bisa negatif dan tidak dipakai
  untuk PPN.
- Lookup aplikasi (`getTaxRecord` di `apps/store/src/lib/jubelio-sales-client.ts`)
  memindai halaman sampai seluruh daftar selesai, menuntut **tepat satu** record
  dengan id tersebut, menolak record malformed, dan mengembalikan `null`
  (unavailable) untuk tidak ditemukan/duplikat. `null` bukan rate 0.
- Lookup ini read-only dan tidak melakukan POST. Penulisan master pajak bukan
  bagian aplikasi.
