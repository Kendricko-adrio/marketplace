# Pricing model — net price vs RRP

This document defines how prices are stored, displayed, filtered, and charged.
It is the source of truth for the net-vs-RRP model that replaced the old
flash-sale pricing.

## Two price columns

| Column | Meaning | Used for |
|---|---|---|
| `product_variant.price` | **Net price** — the harga the customer actually pays | cart, checkout, order line items, product cards, product detail "buy" price |
| `product.base_price` | **RRP** (harga normal / Recommended Retail Price) | strikethrough / original price, discount derivation |

A product has **one** `base_price` (RRP) and **many** variants, each with its own
`price` (net). There is no separate "sale price" column — a discount is simply a
variant whose net price is below the product's RRP.

## Discount derivation

Discount is **derived**, never stored as a separate field:

```
discount = (base_price − variant.price) / base_price
```

A product/variant "has a discount" when `base_price > variant.price`. The UI
shows a strikethrough RRP and a "Hemat X%" badge **only when `discount > 0`**.
When `base_price == variant.price` there is no strikethrough and no badge.

## What shows on a product card (multiple variants)

A product card shows the **cheapest variant** — the lowest net price across the
product's variants:

```ts
const minPriceSq = db
  .select({
    productId: productVariants.productId,
    minPrice: sql<string>`min(${productVariants.price})`.as("minPrice"),
  })
  .from(productVariants)
  .groupBy(productVariants.productId)
  .as("vp");
// join products.id = minPriceSq.productId
```

- `price` (card) = `min(variant.price)` — the net selling price.
- `basePrice` (card) = `product.base_price` — the RRP for strikethrough.
- `image` (card) = first image of the **default** variant (image is decoupled
  from price: price comes from the cheapest variant, image from the default).

The product **detail** page is different: it shows the **selected variant's**
net price (`variant.price`), not the cheapest — the customer picks a variant and
sees that variant's price. This is what fixes the original detail-vs-cart
mismatch (both now use `variant.price`).

## `hasDiscount` filter

The "ada diskon" / "has discount" filter (replaces the old "Flash Sale" filter)
selects products whose RRP is above their cheapest variant net price:

```
hasDiscount  ⇔  product.base_price > min(variant.price)
```

Exposed as the `hasDiscount=true` query param on `/api/products` and as the
`hasDiscount` flag in `ProductFilterConfig` (homepage carousel "filter" mode +
promo cards). Implemented as `sql\`${products.basePrice} > ${minPriceSq.minPrice}\``.

## Price filtering and sorting

Both price-range filtering and price sorting use the **net selling price**
(`min(variant.price)`), the same value shown on the card — so what the customer
sees is what they filter/sort by:

- `minPrice` / `maxPrice` → applied to `minPriceSq.minPrice`.
- `sortBy=price` + `sortOrder=asc|desc` → ordered by `minPriceSq.minPrice`.
- `sortBy=createdAt` (default) + `sortOrder` → ordered by `products.createdAt`.

The old `bestseller` (sort by `sold`) and `rating` (sort by `rating`) sort
options have been **removed** — those columns no longer exist.

## Cart, checkout, and orders

Cart, checkout, and order creation already charged `product_variants.price`
(net); that behavior is unchanged and is what makes the model consistent
end-to-end:

- **Cart** line items show `variant.price` (net), with `product.base_price`
  shown as a strikethrough RRP when `base_price > variant.price`.
- **Checkout / place-order** charges `variant.price` and snapshots it into
  `order_item.price` at order time, so the charged amount is frozen regardless
  of later price changes.
- **Stock reservation** and the rest of the order flow are unaffected by
  pricing — pricing only changes which number is shown/charged, and that number
  was already `variant.price`.

## What was removed

The following were removed because they are no longer needed under this model:

- `product.rating`, `product.sold`, `product.is_flash_sale`,
  `product.flash_sale_price`, `product.flash_sale_ends_at` — dropped columns.
- `reviews` table — dropped (was unused: no review UI, no submit route, no
  admin reviews; the product-detail API was the only reader and its review
  query was removed).
- `GET /api/products/flash-sale` and `GET /api/products/best-seller` routes —
  deleted (dead code referencing the dropped columns).
- "Terlaris" (sort by `sold`) and "Rating Tertinggi" (sort by `rating`) sort
  options in the homepage carousel builder.

## What is kept (not used for display)

- `product_variants.discount` — the **raw CSV `disc%`** written by the SOH
  master-data sync. It is preserved as-is (mixed int/decimal text) for future
  use but is **not** used for display, filtering, or discount derivation. The
  displayed discount comes solely from `base_price` vs `variant.price`. See
  [`soh-sync/README.md`](./soh-sync/README.md).

## Data note for existing homepage configs

Homepage section content stored in the DB (JSONB) may still contain legacy
`filter: { flashSale: true }` or `sortOrder: "bestseller"|"rating"`. The current
code **ignores** `flashSale` and falls back an unrecognized `sortOrder` to
`newest`, so legacy configs render without errors. Re-seeding (`db:reset &&
db:seed`) replaces them with valid values (`hasDiscount`, `newest|priceAsc|priceDesc`).