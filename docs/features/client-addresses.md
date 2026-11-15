# Client address book (delivery foundation)

Store clients manage their own recipient addresses at `/account/addresses`. Checkout sekarang **selalu menyimpan** alamat lewat konfirmasi tombol (D1/D2): modal **Tambah alamat** menulis ke buku alamat sebelum ada order, jadi alamat tetap tersedia walaupun checkout ditinggalkan atau pembayaran tidak dilanjutkan. Tidak ada lagi checkbox **Simpan alamat** maupun mode tujuan sekali pakai; mengetik atau **Batal** sebelum submit tidak membuat row. Place-order, quote, review, promotion, dan recovery checkout **tidak pernah** menulis buku alamat — order hanya merujuk `address_id` dan menyimpan snapshot tujuan sendiri, sehingga edit/hapus buku alamat tidak mengubah tujuan order historis (`ON DELETE SET NULL`). **Jadikan alamat utama** opsional dan tidak dicentang saat tambah; alamat pertama/terbaru tidak otomatis menjadi utama, dan alamat utama yang ada dipilih otomatis pada checkout berikutnya. Semua endpoint memerlukan sesi store onboarded; sesi admin bukan sesi store. Domain: [glossary](../../CONTEXT.md#alamat-pengiriman-customer).

## API

- `GET /api/addresses`: list only the authenticated client's addresses.
- `POST /api/addresses`: create.
- `PATCH /api/addresses/{id}`: replace the address input.
- `DELETE /api/addresses/{id}`: delete.
- `POST /api/addresses/{id}/default`: atomically promote to default.

Create/update input: `recipientName`, `phone`, `fullAddress`, `provinceId`, `cityId`, `districtId`, `areaId`, `postalCode`, `isDefault`. Unknown properties are rejected. Region IDs and postal codes are strings, preserving leading zeros. Labels are resolved server-side from Shipment, not trusted from the browser. Invalid hierarchy/postcode rejects the write. Foreign/unknown address IDs return 404 without mutation. At most one default is enforced by a partial unique index; every mutation locks the client row inside a transaction. Removing the default does not automatically promote another address. Legacy addresses require verified region selection before they can be used for delivery.

### Retry key create (opsional, terbatas)

`POST /api/addresses` menerima header opsional **`Idempotency-Key`** berisi UUID; body tetap strict `ClientAddressInput` dan consumer Buku Alamat yang tidak mengirim header berperilaku sama seperti sebelumnya. Checkout selalu mengirim satu key per konfirmasi "Simpan dan gunakan" dan mempertahankannya saat retry setelah respons tidak pasti.

- Identitas row deterministik per client + key (`address-create:` + SHA-256 pasangan client/key), memakai primary key text yang sudah ada — tanpa tabel atau kolom baru. Tidak ada key global lintas customer.
- Replay di bawah lock owner mengembalikan row yang sama **tanpa** memanggil provider wilayah lagi dan **tanpa** menerapkan ulang pilihan default create pertama; status default yang berlaku adalah status terkini.
- Key yang sama dengan tujuan berbeda menghasilkan `409 REQUEST_KEY_CONFLICT`; key/body tidak pernah diganti diam-diam. Key tidak valid = `400 INPUT_INVALID` tanpa mutation.
- Jaminan berlaku selama row-nya masih ada. Ini **bukan** dedupe alamat serupa dari penambahan yang sengaja diulang, bukan receipt permanen setelah row dihapus, dan bukan idempotency universal untuk PATCH.
- PATCH dengan respons tidak pasti tidak di-fallback ke POST: UI memakai **Periksa alamat** (GET daftar) untuk membaca row yang sama.

`GET /api/shipment/regions?level=provinces` lists provinces. Use `level=cities|districts|areas&parentId={stringId}` for children. `JUBELIO_SHIPMENT_URL` configures the separate Shipment host, never the Omnichannel host. GET region lookups require no provider token. Failures never fabricate a postcode or silently reuse an old hierarchy.

Checkout memvalidasi lebih awal sebelum mengirim: nama/telepon/alamat wajib, panjang sesuai batas schema, seluruh rantai wilayah lengkap, kode pos tersedia, dan nomor penerima memenuhi aturan kontak checkout **8–15 digit**. Ini menjaga create tidak berhasil lalu langsung ditolak "Lanjut"; aturan global API/Buku Alamat tetap 5–25 karakter dan validasi kontak server place-order tidak dilemahkan. Saat edit, checkbox utama diisi dari status alamat yang diedit dan uncheck tidak mempromosikan alamat lain. Form clears all descendant selections and postcode when a parent changes. Save is disabled until required fields are supplied; server validation remains authoritative. Structured API logs exclude recipient names, phones, street addresses and raw provider responses.

## Branch origin and per-SKU parcels

The admin Branch form requires verified Shipment province/city/district/village selection on every create/edit, including pickup-only branches. Canonical Area ID/postcode and region names are stored locally, never copied from Omnichannel or overwritten by location sync. Branch name is the sender. Phone/address remain optional on save but required for delivery; PUT omission preserves their locked-row values. Legacy rows stay nullable/unconfigured without backfill and remain usable for pickup, but edits require completion and new delivery rejects incomplete origins. See [verified branch regions](branch-shipping-regions.md) for API, authorization, form and rollout details.

Each synced SKU obtains parcel fields from `GET /inventory/items/{item_id}` separately, not from an assumed group dimension. Normalized integer grams and positive centimetre dimensions are stored in `product_variant.parcel_dimensions`; invalid master blocks become null. The documented master accepts numeric/string `package_weight/length/width/height` (see `docs/jubelio-api/dist.yaml`, `getProductResponse`; grams specified by the product input schema). Catalog sync now makes one additional sequential read per SKU; provider failures propagate through existing sync error handling rather than claiming successful master refresh.

IT configures `system_config` keys `shipment.parcelFallback` (JSON `{ "weight": 100, "length": 15, "width": 10, "height": 5 }`, per-unit grams/cm) and `shipment.packagingWeightGrams` (nonnegative integer text, e.g. `40`). These values are examples, not real operational measurements. Parcel parameters are re-read for each quote; they do not use the general PPN config cache. Seeder sets `shipment.packagingWeightGrams` to `15` grams and `shipment.parcelFallback` to `{ "weight": 250, "length": 30, "width": 20, "height": 10 }` (per-unit grams/cm), matching the approved local fallback. Seeded branches remain origin-null and legacy SKU dimensions remain null. Verify fallback dimensions and seeded packaging weight against actual SKU measurements and operational packaging before activation. Do not activate delivery before valid data exists.

`buildShipmentInputs` rejects inactive/missing/invalid origins, unusable master/fallback dimensions, invalid quantities/values and missing packaging. It sums per-unit grams times quantity plus packaging, and emits per-item dimensions without guessing a physical carton. For example, two 250g master items plus three 100g fallback items and 40g packaging produce `weight: 840` with two distinct `items[]` entries. Quote/payment/booking integration belongs to subsequent tickets.

## Verification

`client-addresses.db.test.ts` uses real PostgreSQL for ownership, CRUD and concurrent default changes. `shipment-regions.test.ts` checks canonical string IDs/postcodes, parent mismatch and postal mismatch. `e2e/store/addresses-mock.spec.ts`, run through `playwright.mock.config.ts`, exercises creation, editing, default changes/deletion and cross-client API isolation using local region fixtures. No live Jubelio writes are necessary.

## Verification

`client-addresses.db.test.ts` (real PostgreSQL) membuktikan ownership, CRUD, default concurrent, serta kontrak retry create: key sama → satu row dan tanpa panggilan provider wilayah lagi, default tidak dipromosikan ulang, key sama dengan tujuan berbeda → `REQUEST_KEY_CONFLICT`, key invalid tanpa mutation, dan tiga create concurrent dengan satu key tetap satu row. `address-api.test.ts` mengunci batas HTTP (header diteruskan, 409 konflik, 400 invalid, 404/503). `e2e/store/addresses-mock.spec.ts` tetap membuktikan consumer Buku Alamat tanpa header baru.
