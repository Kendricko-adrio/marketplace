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
entries. Use this mode for normal local development and E2E tests.

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
accounts, permissions, addresses, vouchers, homepage section configuration,
static pages, footer configuration, and system configuration. It deliberately
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
