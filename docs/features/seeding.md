# Database Seeding Modes

The development/staging seeder supports two catalog-source modes through
`SEED_MODE`. It always refuses to run when `NODE_ENV=production` and always
clears existing data before inserting the selected fixtures.

## Demo mode

```env
SEED_MODE=demo
```

This is the default when `SEED_MODE` is unset. `npm run db:seed` creates the
complete deterministic demo dataset, including categories, brands, genders,
products, variants, legacy product images, branches, branch stock, sample
orders, notifications, cart items, homepage product links, and related audit
entries. Sample orders include an immutable 11% PPN snapshot and gross total.
The footer includes an enabled dummy WhatsApp URL. Use this mode for normal
local development and E2E tests.

## Jubelio mode

```env
SEED_MODE=jubelio
```

Run the commands in this order from the repository root:

```bash
npm run db:seed
npm run db:import-jubelio
```

The seed step creates only application-owned baseline data such as admin/client
accounts, permissions, addresses, homepage section configuration,
static pages, footer configuration (including the dummy WhatsApp destination),
and system configuration (including `tax.ppnRatePercent = 11`). It deliberately
leaves the following catalog-managed tables empty for the import:

- `category`, `brand`, and `gender`
- `product`, `product_variant`, `product_to_category`, and `product_image`
- `branch` and `branch_stock`

Catalog-dependent sample orders, notifications, carts, homepage product links,
and stock/order audit entries are also omitted. Admin users remain unassigned
to a branch until a branch assignment is configured after import.

## Destructive behavior

Both modes use the same full cleanup list. Therefore, running `db:seed` after a
Jubelio import deletes the imported catalog and branch data. In Jubelio mode,
always seed first and import second. The seeder is intended only for disposable
local/staging databases.

Unsupported `SEED_MODE` values fail immediately rather than falling back to a
mode that could populate the wrong data source.

## Initial RBAC Roles

The seeder creates the three Initial Roles from the code-owned defaults in
`packages/db/src/rbac/seed-defaults.ts` (tested by
`seed-defaults.test.ts`) **before** the admin users, so the user rows carry
their `roleId` assignment:

| Role key | Name | isSystem | Grants |
|---|---|---|---|
| `system_owner` | System Owner | yes | none — code-owned full/all bypass |
| `hq` | HQ | yes | full catalog, all-branch/global scope (editable) |
| `admin` | Admin | yes | Products view-own; Orders view/edit-own; Notifications view/edit/delete-own; no global product re-sync |

Seeded admin users (`admin@store.com`, `hq@store.com`) are assigned through
`roleId` while the legacy `role` column temporarily coexists (dropped in the
RBAC slice-9 cutover). The System Owner has **no** grant rows — its
full-access/all-branch bypass is owned by the policy code.

Cleanup order respects the FKs: grants are deleted before Roles, and Roles
after users (`users.role_id` is `ON DELETE RESTRICT`).

## Demo Coupon dan Redemption (ticket 07)

`SEED_MODE=demo` membuat satu Offer publik **enabled** (fixed goods Rp25.000,
kuota 50, budget Rp1.000.000, per-account 1) dengan revision published/benefit,
plus tiga snapshot Redemption yang konsisten dengan counter:

- order `completed`/paid → Redemption `consumed` (dihitung);
- order `pending_payment` → Redemption `reserved` (dihitung);
- order `failed_payment`/failed → Redemption `released` (tidak dihitung,
  retained sebagai evidence).

Global usage `reserved1/consumed1` (amount Rp25.000 masing-masing), client usage
untuk `john@example.com` sama, dan satu allocation `offer_goods` per order.
Seed juga membuat satu Offer `manual_only` "Kode Manual Demo Rp25.000" dengan
dua kode canonical (`HEMAT17AGUSTUS` aktif, `PROMO2026OFF` nonaktif) dan satu
Redemption `consumed` yang menyebut `code_id` kode aktif. Kode nonaktif tetap
reserved untuk menunjukkan literal/owner tidak pernah dipindah. Sejak ticket 10
seed juga membuat satu Offer publik enabled **percentage goods** "Diskon Demo
10% (maks Rp20.000)" (`rate 10.000000`, `cap_amount 20000`, kuota 50, budget
Rp1.000.000, per-account 1, usage nol) sebagai fixture picker/simulasi.
`discounts.contractVersion` tetap `0` pada seed, jadi data ini adalah demo,
bukan rollout aktif. Seeder `SEED_MODE=jubelio` tetap tidak membuat katalog/transaksi
dummy. Cleanup FK-ordered menghapus events → allocations → Redemptions →
client usage sebelum orders/Offer.

## Demo batch Markdown bulk dan workbook (ticket 04–05)

`SEED_MODE=demo` juga membuat dua batch harga yang **belum di-apply** agar layar
`/admin/products/harga` punya data review nyata tanpa mengubah harga:

- satu batch `bulk` `staged` berisi 3 row `pending` (`SS-WHT-41`, `SS-BLK-41`,
  `OX-BLK-41`) dengan preview non-otoritatif;
- satu batch `xlsx` `staged` berisi 2 row `pending` (`SS-WHT-41` target
  `820000`, `CS-NVY-40` `restore_base`) dengan `template_version =
  OKCIR_MARKDOWN_V1`.

Keduanya tidak menulis revision/current pointer dan tidak mengubah
`product_variant.price`. Cleanup FK-ordered melepas `origin_retry_row_id` lebih
dulu (self-FK), lalu menghapus ledger apply-request → batch rows → current
pointer → revisions → batch; reset tidak lagi memalsukan state `pending` pada
row yang gagal parse.


## Demo subsidi ongkir (ticket 11)

Seed demo menambahkan satu Offer publik `Subsidi Ongkir Demo Rp20.000` (cap
20000) dan satu Offer `manual_only` `Kode Subsidi Ongkir Demo Rp15.000` dengan
kode canonical aktif `ONGKIRHEMAT`. Keduanya memakai benefit `kind='shipping'`,
`scope='shipping'`, `cap_amount` positif, kuota/budget/per-account aktif, dan
usage nol pada seed fresh. Baris demo ini hanya untuk picker/simulasi lokal;
`discounts.contractVersion` tetap `0` sampai rollout berizin.
