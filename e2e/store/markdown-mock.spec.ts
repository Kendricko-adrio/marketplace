/**
 * Ticket 03 — Markdown dari admin sampai surface storefront (mock-only E2E).
 *
 * Bukti M01/M02 pada seam B (browser + app HTTP + disposable PG):
 *   - harga efektif SKU sama di dua cabang berbeda;
 *   - kartu/produk detail/cart memakai proyeksi efektif yang sama;
 *   - coretan hanya muncul saat Markdown aktif dan berasal dari variant yang
 *     sama (bukan RRP grup);
 *   - fallback (source ≤ target) tanpa coretan tetapi target tetap tersimpan,
 *     dan aktif kembali saat source naik;
 *   - filter `hasDiscount` berarti Markdown aktif, bukan selisih RRP lama.
 *
 * Expected money adalah literal independen dari spec §4.4, bukan hasil module.
 * Fixture memakai ID pasti di database disposable `marketplace_discounts_test_*`;
 * gate domain dinyalakan hanya untuk run ini dan dipulihkan di afterAll.
 */
import { test, expect, type BrowserContext } from "@playwright/test";
import { Pool } from "pg";
import { randomUUID } from "node:crypto";
import dotenv from "dotenv";
import { TEST_USERS } from "../config";

dotenv.config({ path: ".env" });

const STORE_BASE_URL = process.env.E2E_MOCK_STORE_BASE_URL ?? "http://localhost:3110";
const ALLOWED_PORTS = new Set(["3110", "3111", "3112"]);

function requireIsolatedRun(): void {
  if (process.env.E2E_PROVIDER_MOCKS !== "true") {
    throw new Error("markdown-mock.spec.ts must be selected by playwright.mock.config.ts");
  }
  const parsed = new URL(STORE_BASE_URL);
  if (
    (parsed.hostname !== "127.0.0.1" && parsed.hostname !== "localhost") ||
    !ALLOWED_PORTS.has(parsed.port)
  ) {
    throw new Error(`markdown-mock.spec.ts refuses non-loopback store base ${STORE_BASE_URL}`);
  }
  const raw = process.env.DATABASE_URL ?? "";
  const name = raw ? decodeURIComponent(new URL(raw).pathname.replace(/^\//, "")) : "";
  if (!/^marketplace_discounts_test_[A-Za-z0-9_]+$/.test(name)) {
    throw new Error(
      `markdown-mock.spec.ts requires a disposable marketplace_discounts_test_* DATABASE_URL, got "${name}"`
    );
  }
}

requireIsolatedRun();

const PREFIX = "e2e-md";
const PRODUCT_ACTIVE = `${PREFIX}-product-active`;
const PRODUCT_FALLBACK = `${PREFIX}-product-fallback`;
const PRODUCT_REACTIVATED = `${PREFIX}-product-reactivated`;
const VARIANT_ACTIVE = `${PREFIX}-variant-active`;
const VARIANT_FALLBACK = `${PREFIX}-variant-fallback`;
const VARIANT_REACTIVATED = `${PREFIX}-variant-reactivated`;
const SKU_ACTIVE = "E2E-MD-ACTIVE";
const SKU_FALLBACK = "E2E-MD-FALLBACK";
const SKU_REACTIVATED = "E2E-MD-REACTIVATED";
const BATCH_ID = `${PREFIX}-batch`;
const PRODUCTS = [PRODUCT_ACTIVE, PRODUCT_FALLBACK, PRODUCT_REACTIVATED];
const VARIANTS = [VARIANT_ACTIVE, VARIANT_FALLBACK, VARIANT_REACTIVATED];
// Approved spec §4.4 fallback/activation literals.
const TARGET = "150000";

let pool: Pool;
let storeContext: BrowserContext;
let branchA = "";
let branchB = "";
let gateBefore: { value: string; type: string; description: string | null } | undefined;

/** Local YYYY-MM-DD of the next non-Sunday day (branch hours: Mon–Sat 9–21). */
function nextOpenDate(): string {
  const d = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Jakarta" }));
  d.setDate(d.getDate() + 1);
  while (d.getDay() === 0) d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

async function httpSignIn(context: BrowserContext): Promise<void> {
  const response = await context.request.post(
    `${STORE_BASE_URL}/api/auth/sign-in/email`,
    { data: { email: TEST_USERS.store.email, password: TEST_USERS.store.password } }
  );
  expect(response.ok(), `store sign-in failed: ${await response.text()}`).toBe(true);
}

async function cleanup(): Promise<void> {
  const owner = await pool.query("SELECT id FROM client WHERE email=$1", [TEST_USERS.store.email]);
  if (owner.rows[0]?.id) {
    await pool.query(
      "DELETE FROM cart_item WHERE cart_id IN (SELECT id FROM cart WHERE user_id=$1)",
      [owner.rows[0].id]
    );
  }
  await pool.query("DELETE FROM variant_price_current WHERE variant_id = ANY($1::text[])", [VARIANTS]);
  await pool.query(
    "UPDATE price_change_batch_row SET state='pending', applied_revision_id=NULL WHERE batch_id=$1",
    [BATCH_ID]
  );
  await pool.query("DELETE FROM variant_price_revision WHERE variant_id = ANY($1::text[])", [VARIANTS]);
  await pool.query("DELETE FROM price_change_batch_row WHERE batch_id=$1", [BATCH_ID]);
  await pool.query("DELETE FROM price_change_batch WHERE id=$1", [BATCH_ID]);
  await pool.query("DELETE FROM branch_stock WHERE product_variant_id = ANY($1::text[])", [VARIANTS]);
  await pool.query("DELETE FROM product_variant WHERE id = ANY($1::text[])", [VARIANTS]);
  await pool.query("DELETE FROM product WHERE id = ANY($1::text[])", [PRODUCTS]);
}

async function setSource(variantId: string, price: string): Promise<void> {
  await pool.query("UPDATE product_variant SET price=$2 WHERE id=$1", [variantId, price]);
}

async function ensureAppliedRevision(input: {
  variantId: string;
  revisionNo: number;
  /** Source at APPLY time; must be greater than the target. */
  applySource: string;
  rowNumber: number;
  action: "set_price" | "restore_base";
  target: string | null;
}): Promise<void> {
  const revisionId = `${input.variantId}-rev-${input.revisionNo}`;
  const rowId = `${BATCH_ID}-row-${input.rowNumber}`;
  await pool.query(
    `INSERT INTO variant_price_revision
       (id, variant_id, revision_no, action, target_unit_price, source_unit_price,
        effective_unit_price, previous_target_unit_price, previous_effective_unit_price,
        markdown_active, previous_markdown_active, batch_id, batch_row_id, actor_identity)
     VALUES ($1,$2,$3,$4,$5,$6,$7,NULL,$6,$8,false,$9,$10,'seed')`,
    [
      revisionId,
      input.variantId,
      input.revisionNo,
      input.action,
      input.target,
      input.applySource,
      input.target ?? input.applySource,
      input.action === "set_price",
      BATCH_ID,
      rowId,
    ]
  );
  await pool.query(
    `INSERT INTO price_change_batch_row
       (id, batch_id, row_number, input_sku, variant_id, action, target_unit_price,
        preview_json, state, applied_revision_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'{}'::jsonb,'applied',$8)`,
    [
      rowId,
      BATCH_ID,
      input.rowNumber,
      input.variantId,
      input.variantId,
      input.action,
      input.target,
      revisionId,
    ]
  );
  await pool.query(
    `INSERT INTO variant_price_current (variant_id, revision_id, version)
     VALUES ($1,$2,$3)
     ON CONFLICT (variant_id) DO UPDATE SET revision_id=EXCLUDED.revision_id, version=EXCLUDED.version`,
    [input.variantId, revisionId, input.revisionNo]
  );
}

test.beforeAll(async ({ browser }) => {
  pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 4 });
  await cleanup();

  const branches = await pool.query<{ id: string }>(
    `SELECT id FROM branch
      WHERE status='aktif' AND jubelio_location_id IS NOT NULL
      ORDER BY name LIMIT 2`
  );
  expect(branches.rowCount, "the seeded DB needs two active Jubelio-linked branches").toBe(2);
  branchA = branches.rows[0].id;
  branchB = branches.rows[1].id;

  // Products: base_price deliberately differs from the variant source so a
  // group-RRP strikethrough would show the wrong original.
  await pool.query(
    `INSERT INTO product (id, name, slug, base_price, status) VALUES
       ($1, 'E2E Markdown Active', 'e2e-md-active', '500000', 'aktif'),
       ($2, 'E2E Markdown Fallback', 'e2e-md-fallback', '500000', 'aktif'),
       ($3, 'E2E Markdown Reactivated', 'e2e-md-reactivated', '500000', 'aktif')`,
    PRODUCTS
  );
  await pool.query(
    `INSERT INTO product_variant (id, product_id, sku, price, is_default, jubelio_item_id) VALUES
       ($1, $4, $7, '300000', true, 930001),
       ($2, $5, $8, '120000', true, 930002),
       ($3, $6, $9, '400000', true, 930003)`,
    [...VARIANTS, ...PRODUCTS, SKU_ACTIVE, SKU_FALLBACK, SKU_REACTIVATED]
  );
  for (const branchId of [branchA, branchB]) {
    for (const variantId of VARIANTS) {
      await pool.query(
        `INSERT INTO branch_stock (branch_id, product_variant_id, stock, available_stock, provider_stock_synced_at)
         VALUES ($1,$2,10,10,NOW())`,
        [branchId, variantId]
      );
    }
  }

  await pool.query(
    `INSERT INTO price_change_batch
       (id, actor_identity, request_key, fingerprint, source, state, row_count,
        applied_count, unchanged_count, failed_count, pending_count)
     VALUES ($1,'seed',$2,$3,'manual','applied',3,3,0,0,0)`,
    [BATCH_ID, randomUUID(), "f".repeat(64)]
  );
  // Every revision was applied while the source was 300000 (target < source);
  // the fallback/reactivation state comes from the LATER source updates only.
  await ensureAppliedRevision({ variantId: VARIANT_ACTIVE, revisionNo: 1, applySource: "300000", rowNumber: 1, action: "set_price", target: TARGET });
  await ensureAppliedRevision({ variantId: VARIANT_FALLBACK, revisionNo: 1, applySource: "300000", rowNumber: 2, action: "set_price", target: TARGET });
  await ensureAppliedRevision({ variantId: VARIANT_REACTIVATED, revisionNo: 1, applySource: "300000", rowNumber: 3, action: "set_price", target: TARGET });
  gateBefore = (
    await pool.query<{ value: string; type: string; description: string | null }>(
      "SELECT value, type, description FROM system_config WHERE key='discounts.contractVersion'"
    )
  ).rows[0];
  await pool.query(
    `INSERT INTO system_config (key, value, type) VALUES ('discounts.contractVersion','1','number')
     ON CONFLICT (key) DO UPDATE SET value='1', type='number'`
  );

  storeContext = await browser.newContext({ baseURL: STORE_BASE_URL });
  await httpSignIn(storeContext);
});

test.afterAll(async () => {
  await storeContext?.close().catch(() => {});
  await cleanup();
  if (gateBefore) {
    await pool.query(
      "UPDATE system_config SET value=$1, type=$2, description=$3 WHERE key='discounts.contractVersion'",
      [gateBefore.value, gateBefore.type, gateBefore.description]
    );
  } else {
    await pool.query("DELETE FROM system_config WHERE key='discounts.contractVersion'");
  }
  await pool.end();
});

test("katalog memakai effective projection yang sama di dua cabang (M01)", async () => {
  for (const branchId of [branchA, branchB]) {
    const response = await storeContext.request.get(
      `/api/products?search=E2E+Markdown&branch=${branchId}&limit=20`
    );
    expect(response.ok()).toBe(true);
    const payload = await response.json();
    const byName = new Map(
      (payload.data as Array<Record<string, unknown>>).map((row) => [row.name, row])
    );
    expect(byName.get("E2E Markdown Active")).toMatchObject({
      price: "150000",
      sourcePrice: "300000",
      markdownActive: true,
    });
    expect(byName.get("E2E Markdown Fallback")).toMatchObject({
      price: "120000",
      sourcePrice: "120000",
      markdownActive: false,
    });
    expect(byName.get("E2E Markdown Reactivated")).toMatchObject({
      price: "150000",
      sourcePrice: "400000",
      markdownActive: true,
    });
  }
});

test("filter diskon berarti Markdown aktif dan range/sort memakai harga efektif", async () => {
  const discounted = await storeContext.request.get(
    "/api/products?search=E2E+Markdown&hasDiscount=true&limit=20"
  );
  const discountedPayload = await discounted.json();
  expect(
    (discountedPayload.data as Array<{ name: string }>).map((row) => row.name).sort()
  ).toEqual(["E2E Markdown Active", "E2E Markdown Reactivated"]);

  const max = await storeContext.request.get(
    "/api/products?search=E2E+Markdown&maxPrice=130000&limit=20"
  );
  const maxPayload = await max.json();
  expect((maxPayload.data as Array<{ name: string }>).map((row) => row.name)).toEqual([
    "E2E Markdown Fallback",
  ]);

  const sorted = await storeContext.request.get(
    "/api/products?search=E2E+Markdown&sortBy=price&sortOrder=asc&limit=20"
  );
  const sortedPayload = await sorted.json();
  const prices = (sortedPayload.data as Array<{ price: string }>).map((row) => Number(row.price));
  expect(prices).toEqual([...prices].sort((a, b) => a - b));
});

test("kartu dan detail menampilkan coretan hanya dari variant yang sama (M01)", async ({ page }) => {
  await page.goto("/products?search=E2E+Markdown");

  const activeCard = page
    .locator("div.rounded-lg.border", { hasText: "E2E Markdown Active" })
    .first();
  await expect(activeCard.getByText("Rp 150.000", { exact: true })).toBeVisible();
  await expect(activeCard.locator("span.line-through")).toHaveText("Rp 300.000");
  await expect(activeCard.locator(".bg-destructive")).toHaveText("50%");

  // Fallback: effective = source 120000, target 150000 stays stored, no coretan.
  const fallbackCard = page
    .locator("div.rounded-lg.border", { hasText: "E2E Markdown Fallback" })
    .first();
  await expect(fallbackCard.getByText("Rp 120.000", { exact: true })).toBeVisible();
  await expect(fallbackCard.locator("span.line-through")).toHaveCount(0);
  await expect(fallbackCard.locator(".bg-destructive")).toHaveCount(0);

  await page.goto("/products/e2e-md-active");
  await expect(page.getByRole("heading", { name: "Rp 150.000" })).toBeVisible();
  await expect(page.getByText("Rp 300.000")).toBeVisible();
});

test("target tersimpan aktif kembali saat source naik (M02)", async ({ page }) => {
  await setSource(VARIANT_FALLBACK, "400000");
  const response = await storeContext.request.get("/api/products?search=E2E+Markdown&limit=20");
  const payload = await response.json();
  const fallback = (payload.data as Array<Record<string, unknown>>).find(
    (row) => row.name === "E2E Markdown Fallback"
  );
  expect(fallback).toMatchObject({
    price: "150000",
    sourcePrice: "400000",
    markdownActive: true,
  });

  await page.goto("/products/e2e-md-fallback");
  await expect(page.getByRole("heading", { name: "Rp 150.000" })).toBeVisible();
  await expect(page.getByText("Rp 400.000")).toBeVisible();
  // Restore the fallback scenario for other cases.
  await setSource(VARIANT_FALLBACK, "120000");
});

test("cart memakai harga efektif dan snapshot Markdown yang sama", async () => {
  await storeContext.request.delete("/api/cart");
  const added = await storeContext.request.post("/api/cart/items", {
    data: { variantId: VARIANT_ACTIVE, branchId: branchA, quantity: 1 },
  });
  expect(added.ok(), `add to cart failed: ${await added.text()}`).toBe(true);

  const cart = await storeContext.request.get("/api/cart");
  const payload = await cart.json();
  const item = (payload.data.items as Array<Record<string, unknown>>)[0];
  expect(item.variant).toMatchObject({
    price: "150000",
    sourcePrice: "300000",
    markdownActive: true,
  });
  expect(payload.data.subtotal).toBe(150000);

  // Pickup preview must price the same effective amount: 150000 goods,
  // PPN 11% ceil 16500, total 166500 (independent spec literal).
  const selectedItemIds = (payload.data.items as Array<{ id: string }>).map((row) => row.id);
  const preview = await storeContext.request.post("/api/checkout/preview", {
    data: {
      phone: "081234567892",
      email: "markdown-mock-e2e@example.com",
      pickupDate: nextOpenDate(),
      pickupTime: "10:00",
      selectedItemIds,
      promoSelection: { kind: "none" },
    },
  });
  expect(preview.ok(), `preview failed: ${await preview.text()}`).toBe(true);
  const previewPayload = await preview.json();
  expect(previewPayload.data.pricing).toMatchObject({
    subtotal: "150000",
    sourceGoodsSubtotal: "300000",
    markdownTotal: "150000",
    ppnAmount: "16500",
    total: "166500",
  });

  // T06: a Markdown change between review and commit must reject the stale
  // review BEFORE any order/hold is written (no silent reprice).
  const current = (
    await pool.query<{ revision_id: string }>(
      "SELECT revision_id FROM variant_price_current WHERE variant_id=$1",
      [VARIANT_ACTIVE]
    )
  ).rows[0];
  const newerRevision = `${VARIANT_ACTIVE}-rev-2`;
  await pool.query(
    `INSERT INTO variant_price_revision
       (id, variant_id, revision_no, action, target_unit_price, source_unit_price,
        effective_unit_price, previous_target_unit_price, previous_effective_unit_price,
        markdown_active, previous_markdown_active, batch_id, batch_row_id, actor_identity)
     VALUES ($1,$2,2,'set_price','140000','300000','140000','150000','150000',true,true,$3,'${BATCH_ID}-row-stale','seed')`,
    [newerRevision, VARIANT_ACTIVE, BATCH_ID]
  );
  await pool.query(
    `INSERT INTO price_change_batch_row
       (id, batch_id, row_number, input_sku, variant_id, action, target_unit_price,
        preview_json, state, applied_revision_id)
     VALUES ($1,$2,4,$3,$4,'set_price','140000','{}'::jsonb,'applied',$5)`,
    [`${BATCH_ID}-row-stale`, BATCH_ID, SKU_ACTIVE, VARIANT_ACTIVE, newerRevision]
  );
  await pool.query(
    "UPDATE variant_price_current SET revision_id=$2, version=2 WHERE variant_id=$1",
    [VARIANT_ACTIVE, newerRevision]
  );
  expect(current?.revision_id).toBeTruthy();

  const placeRequestKey = randomUUID();
  const stale = await storeContext.request.post("/api/checkout/place-order", {
    data: {
      requestKey: placeRequestKey,
      reviewToken: previewPayload.data.reviewToken,
      promoSelection: { kind: "none" },
      phone: "081234567892",
      email: "markdown-mock-e2e@example.com",
      pickupDate: nextOpenDate(),
      pickupTime: "10:00",
      selectedItemIds,
    },
  });
  expect(stale.status()).toBe(409);
  const staleBody = await stale.json();
  expect(staleBody.code).toBe("CHECKOUT_REVIEW_REQUIRED");
  const accepted = await pool.query(
    "SELECT count(*)::int AS count FROM checkout_request WHERE request_key=$1",
    [placeRequestKey]
  );
  expect(Number(accepted.rows[0].count)).toBe(0);
  // Restore the reviewed pointer for later cases.
  await pool.query(
    "UPDATE variant_price_current SET revision_id=$2, version=1 WHERE variant_id=$1",
    [VARIANT_ACTIVE, current.revision_id]
  );
});
