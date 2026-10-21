/**
 * Ticket 03 — Markdown manual dari admin: stage → review → apply + history.
 *
 * Bukti A01/A04/M03 pada seam B/H dengan app HTTP asli:
 *   - HQ (prices:view/edit global + products view-all) dapat stage lalu apply;
 *   - review menampilkan source/target/dampak, hasil apply tercatat di histori
 *     immutable dan source variant TIDAK berubah;
 *   - replay apply tidak membuat revision kedua (row final);
 *   - Admin tanpa grant `prices` ditolak 403 pada API dan diarahkan ke
 *     /admin/no-access pada direct URL — re-sync/URL tidak membuka bypass.
 *
 * Expected money adalah literal independen (source300000 → target150000).
 */
import { test, expect, type APIResponse, type BrowserContext } from "@playwright/test";
import { Pool } from "pg";
import { randomUUID } from "node:crypto";
import dotenv from "dotenv";

dotenv.config({ path: ".env" });

const ADMIN_BASE_URL = process.env.E2E_MOCK_ADMIN_BASE_URL ?? "http://localhost:3111";
const PORTS = new Set(["3110", "3111", "3112"]);

function requireIsolatedRun(): void {
  if (process.env.E2E_PROVIDER_MOCKS !== "true") {
    throw new Error("price-change-mock.spec.ts must run under playwright.mock.config.ts");
  }
  const parsed = new URL(ADMIN_BASE_URL);
  if (
    (parsed.hostname !== "127.0.0.1" && parsed.hostname !== "localhost") ||
    !PORTS.has(parsed.port)
  ) {
    throw new Error(`price-change-mock.spec.ts refuses non-loopback admin origin ${ADMIN_BASE_URL}`);
  }
  const raw = process.env.DATABASE_URL ?? "";
  const name = raw ? decodeURIComponent(new URL(raw).pathname.replace(/^\//, "")) : "";
  if (!/^marketplace_discounts_test_[A-Za-z0-9_]+$/.test(name)) {
    throw new Error(
      `price-change-mock.spec.ts requires a disposable marketplace_discounts_test_* DATABASE_URL, got "${name}"`
    );
  }
}
requireIsolatedRun();

const HQ = { identifier: "hqmanager", password: "hq123" };
const ADMIN = { identifier: "admintoko", password: "admin123" };

const PREFIX = "e2e-price-change";
const PRODUCT_ID = `${PREFIX}-product`;
const VARIANT_ID = `${PREFIX}-variant`;
const SKU = "E2E-PRICE-01";
const SOURCE_PRICE = "300000";
const TARGET_PRICE = "150000";

let pool: Pool;
let hqContext: BrowserContext;
let adminContext: BrowserContext;
let hqId = "";
let gateBefore: { value: string; type: string; description: string | null } | undefined;

async function signIn(context: BrowserContext, identifier: string, password: string) {
  const response = await context.request.post(`${ADMIN_BASE_URL}/api/auth/sign-in/username`, {
    data: { username: identifier, password },
  });
  expect(response.ok(), `admin sign-in failed: ${await response.text()}`).toBe(true);
}

async function body(response: APIResponse) {
  return (await response.json()) as {
    success?: boolean;
    data?: Record<string, unknown>;
    code?: string;
  };
}

async function cleanup(): Promise<void> {
  await pool.query("DELETE FROM variant_price_current WHERE variant_id=$1", [VARIANT_ID]);
  await pool.query(
    "UPDATE price_change_batch_row SET state='pending', applied_revision_id=NULL WHERE variant_id=$1",
    [VARIANT_ID]
  );
  await pool.query(
    `DELETE FROM audit_log WHERE entity_id=$1`,
    [VARIANT_ID]
  );
  await pool.query("DELETE FROM variant_price_revision WHERE variant_id=$1", [VARIANT_ID]);
  await pool.query("DELETE FROM price_change_batch_row WHERE variant_id=$1", [VARIANT_ID]);
  if (hqId) {
    // Ticket 04 added the apply-request ledger; its batch FK is RESTRICT, so the
    // receipts must go before the batch they belong to.
    await pool.query(
      `DELETE FROM price_change_apply_request
        WHERE batch_id IN (SELECT id FROM price_change_batch WHERE actor_identity=$1)`,
      [hqId]
    );
    await pool.query("DELETE FROM price_change_batch WHERE actor_identity=$1", [hqId]);
  }
  await pool.query("DELETE FROM product_variant WHERE id=$1", [VARIANT_ID]);
  await pool.query("DELETE FROM product WHERE id=$1", [PRODUCT_ID]);
}

test.beforeAll(async ({ browser }) => {
  pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 4 });
  const hq = await pool.query<{ id: string }>(
    `SELECT id FROM "user" WHERE username=$1`,
    [HQ.identifier]
  );
  hqId = hq.rows[0]?.id ?? "";
  expect(hqId, "the seeded HQ identity must exist (npm run db:seed)").toBeTruthy();
  await cleanup();

  await pool.query(
    `INSERT INTO product (id, name, slug, base_price, status)
     VALUES ($1, 'E2E Price Change Product', 'e2e-price-change-product', '500000', 'aktif')`,
    [PRODUCT_ID]
  );
  await pool.query(
    `INSERT INTO product_variant (id, product_id, sku, price, is_default)
     VALUES ($1, $2, $3, $4, true)`,
    [VARIANT_ID, PRODUCT_ID, SKU, SOURCE_PRICE]
  );

  gateBefore = (
    await pool.query<{ value: string; type: string; description: string | null }>(
      "SELECT value, type, description FROM system_config WHERE key='discounts.contractVersion'"
    )
  ).rows[0];
  await pool.query(
    `INSERT INTO system_config (key, value, type) VALUES ('discounts.contractVersion','1','number')
     ON CONFLICT (key) DO UPDATE SET value='1', type='number'`
  );

  hqContext = await browser.newContext({ baseURL: ADMIN_BASE_URL });
  await signIn(hqContext, HQ.identifier, HQ.password);
  adminContext = await browser.newContext({ baseURL: ADMIN_BASE_URL });
  await signIn(adminContext, ADMIN.identifier, ADMIN.password);
});

test.afterAll(async () => {
  await hqContext?.close().catch(() => {});
  await adminContext?.close().catch(() => {});
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

test("HQ stage → review → apply, source tidak berubah dan histori tercatat", async () => {
  // Reuse the signed-in HQ context: the test's default page has no admin cookies.
  const page = await hqContext.newPage();
  await page.goto(`${ADMIN_BASE_URL}/admin/products/harga`);
  await page.getByRole("textbox", { name: "Cari produk" }).fill("E2E Price Change");
  await page.getByRole("button", { name: "Cari produk" }).click();
  await page.getByRole("button", { name: /E2E Price Change Product/ }).click();
  await expect(page.getByText(SKU)).toBeVisible();
  await page.getByRole("button", { name: "Pilih", exact: true }).click();

  await page.locator("#target").fill(TARGET_PRICE);
  await page.getByRole("button", { name: /Stage untuk review/ }).click();

  // Review shows the independent literals, including the impact.
  await expect(page.getByText("Review", { exact: true })).toBeVisible();
  await expect(page.getByText("Rp 300.000").first()).toBeVisible();
  await expect(page.getByText("Rp 150.000").first()).toBeVisible();
  await expect(page.getByText(/Turun Rp 150\.000/)).toBeVisible();

  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(page.getByText(/Hasil: applied/)).toBeVisible();
  await expect(page.getByText("Histori harga")).toBeVisible();
  await expect(page.getByRole("cell", { name: "Set", exact: true })).toBeVisible();

  const variant = await pool.query<{ price: string }>(
    "SELECT price FROM product_variant WHERE id=$1",
    [VARIANT_ID]
  );
  expect(variant.rows[0].price).toBe("300000.00");
  const revisions = await pool.query(
    "SELECT action, target_unit_price, source_unit_price, effective_unit_price FROM variant_price_revision WHERE variant_id=$1",
    [VARIANT_ID]
  );
  expect(revisions.rows).toEqual([
    {
      action: "set_price",
      target_unit_price: "150000.00",
      source_unit_price: "300000.00",
      effective_unit_price: "150000.00",
    },
  ]);
  await page.close();
});

test("apply replay tidak membuat revision kedua", async () => {
  const historyBefore = await hqContext.request.get(
    `/api/admin/prices/${VARIANT_ID}/history?limit=10`
  );
  const before = await body(historyBefore);
  expect(before.success).toBe(true);
  const batchId = (
    await pool.query<{ id: string }>(
      "SELECT id FROM price_change_batch WHERE actor_identity=$1 ORDER BY created_at DESC LIMIT 1",
      [hqId]
    )
  ).rows[0]?.id;
  expect(batchId).toBeTruthy();

  const replay = await hqContext.request.post(
    `/api/admin/price-changes/${batchId}/apply`,
    { data: { requestKey: randomUUID(), previewDigest: "replay" } }
  );
  expect(replay.ok()).toBe(true);
  const replayed = await body(replay);
  expect(replayed.data).toMatchObject({
    state: "applied",
    appliedCount: 1,
    failedCount: 0,
  });
  const revisions = await pool.query(
    "SELECT count(*)::int AS count FROM variant_price_revision WHERE variant_id=$1",
    [VARIANT_ID]
  );
  expect(Number(revisions.rows[0].count)).toBe(1);
});

test("Admin tanpa grant prices ditolak di API dan direct URL", async () => {
  const page = await adminContext.newPage();
  const denied = await adminContext.request.post("/api/admin/price-changes", {
    data: {
      requestKey: randomUUID(),
      rows: [{ sku: SKU, action: "set_price", targetUnitPrice: "100000" }],
    },
  });
  expect(denied.status()).toBe(403);
  const deniedBody = await body(denied);
  expect(deniedBody.success).toBe(false);
  expect(deniedBody.code).toBe("DENIED");

  const history = await adminContext.request.get(
    `/api/admin/prices/${VARIANT_ID}/history?limit=10`
  );
  expect(history.status()).toBe(403);

  await page.goto(`${ADMIN_BASE_URL}/admin/products/harga`);
  await expect(page).toHaveURL(/\/admin\/no-access$/);
});
