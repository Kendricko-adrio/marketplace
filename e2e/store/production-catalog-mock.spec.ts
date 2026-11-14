/**
 * Production-bootstrap smoke (store catalog, mock/isolated run).
 *
 * Runs ONLY when `E2E_BOOTSTRAP_SMOKE=true` against a database bootstrapped by
 * the production flow (full Jubelio import, no demo fixtures). It asserts the
 * imported catalog is reachable through the existing public pages:
 *   1. a product from the SECOND listing page is visible (full pagination, not
 *      only the first page),
 *   2. a product detail page exposes its variant/SKU.
 *
 * Expected values come from the database, not from the importer report. The
 * spec writes nothing and never enables checkout/provider writes.
 */
import { expect, test } from "@playwright/test";
import { Client } from "pg";

const ENABLED = process.env.E2E_BOOTSTRAP_SMOKE === "true";
const STORE_BASE_URL =
  process.env.E2E_MOCK_STORE_BASE_URL ?? "http://localhost:3110";
const DATABASE_URL = process.env.DATABASE_URL ?? "";

test.skip(
  !ENABLED || DATABASE_URL.length === 0,
  "production catalog smoke requires E2E_BOOTSTRAP_SMOKE=true with a bootstrapped disposable DATABASE_URL"
);

async function query<T extends Record<string, unknown>>(
  text: string,
  values: readonly unknown[] = []
): Promise<T[]> {
  const client = new Client({ connectionString: DATABASE_URL });
  await client.connect();
  try {
    return (await client.query(text, [...values])).rows as T[];
  } finally {
    await client.end();
  }
}

test("imported catalog page 2 and variant detail are visible", async ({
  page,
}) => {
  const [catalog] = await query<{ total: number }>(
    "select count(*)::int as total from product where jubelio_item_group_id is not null and status = 'aktif'"
  );
  test.skip(
    (catalog?.total ?? 0) < 2,
    "the bootstrapped catalog has fewer than two products"
  );

  // Assumption to confirm at the final gate: the existing listing page size is
  // 12, so offset 12 is the first row of page 2. If the page size changes, the
  // spec must read the rendered pagination size instead of hardcoding it.
  const pageSize = 12;
  const offset = pageSize;
  const [secondPageProduct] = await query<{ name: string }>(
    `select name from product
     where jubelio_item_group_id is not null and is_active = true
     order by name asc
     offset $1 limit 1`,
    [offset]
  );
  test.skip(
    secondPageProduct === undefined,
    "not enough imported products to reach the second listing page"
  );

  await page.goto(`${STORE_BASE_URL}/products?page=2`, {
    waitUntil: "domcontentloaded",
  });
  await expect(
    page.getByText(secondPageProduct.name, { exact: false }).first()
  ).toBeVisible();

  const [detail] = await query<{
    name: string;
    slug: string;
    item_code: string;
  }>(
    `select p.name, p.slug, v.sku as item_code
     from product p
     join product_variant v on v.product_id = p.id
     where p.jubelio_item_group_id is not null
       and p.status = 'aktif'
       and p.slug is not null
     order by p.name asc
     limit 1`
  );
  test.skip(detail === undefined, "no imported product with a slug and variant");

  await page.goto(`${STORE_BASE_URL}/products/${detail.slug}`, {
    waitUntil: "domcontentloaded",
  });
  await expect(page.getByText(detail.name, { exact: false }).first()).toBeVisible();
  await expect(page.getByText(detail.item_code, { exact: false }).first()).toBeVisible();
});
