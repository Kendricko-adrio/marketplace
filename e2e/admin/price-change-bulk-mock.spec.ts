/**
 * Ticket 04 — bulk Markdown dari admin: pilihan lintas halaman, shortcut
 * persen → fixed, apply bertahap dengan resume manual dan hasil yang jujur.
 *
 * Bukti X01/X03/X04/X05/X06 pada seam B dengan app HTTP asli:
 *   - checkbox header hanya memilih halaman aktif; pilihan bertahan saat
 *     berpindah halaman (Terpilih: 30 SKU), bukan seluruh hasil filter;
 *   - diskon 20% dihitung dari Base Price 300000 → target fixed 240000, dan
 *     SKU ber-Markdown aktif 150000 menampilkan kenaikan 90000;
 *   - apply pertama hanya satu chunk server sehingga pending > 0 dan batch
 *     belum disebut final; tombol "Lanjutkan apply" manual sampai final, lalu
 *     30 row applied dan 30 revision terverifikasi lewat pool;
 *   - restore SKU tanpa Markdown menjadi unchanged tanpa revision;
 *   - shortcut 15% dari source 100001 → target 85001 (half-up);
 *   - Admin tanpa grant `prices` ditolak 403 pada candidates/stage dan diarahkan
 *     ke /admin/no-access pada direct URL.
 *
 * Expected money adalah literal independen dari spec §4.4.
 */
import { test, expect, type BrowserContext } from "@playwright/test";
import { Pool } from "pg";
import { randomUUID } from "node:crypto";
import dotenv from "dotenv";

dotenv.config({ path: ".env" });

test.describe.configure({ mode: "serial" });

const ADMIN_BASE_URL = process.env.E2E_MOCK_ADMIN_BASE_URL ?? "http://localhost:3111";
const PORTS = new Set(["3110", "3111", "3112"]);

function requireIsolatedRun(): void {
  if (process.env.E2E_PROVIDER_MOCKS !== "true") {
    throw new Error("price-change-bulk-mock.spec.ts must run under playwright.mock.config.ts");
  }
  const parsed = new URL(ADMIN_BASE_URL);
  if (
    (parsed.hostname !== "127.0.0.1" && parsed.hostname !== "localhost") ||
    !PORTS.has(parsed.port)
  ) {
    throw new Error(
      `price-change-bulk-mock.spec.ts refuses non-loopback admin origin ${ADMIN_BASE_URL}`
    );
  }
  const raw = process.env.DATABASE_URL ?? "";
  const name = raw ? decodeURIComponent(new URL(raw).pathname.replace(/^\//, "")) : "";
  if (!/^marketplace_discounts_test_[A-Za-z0-9_]+$/.test(name)) {
    throw new Error(
      `price-change-bulk-mock.spec.ts requires a disposable marketplace_discounts_test_* DATABASE_URL, got "${name}"`
    );
  }
}
requireIsolatedRun();

const HQ = { identifier: "hqmanager", password: "hq123" };
const ADMIN = { identifier: "admintoko", password: "admin123" };

const PREFIX = "e2e-bulk-price";

// Fixture bulk: 30 SKU di dua produk dengan Base Price yang sama.
const BULK_SOURCE_PRICE = "300000";
const BULK_DISCOUNT_PERCENT = "20";
const BULK_TARGET_PRICE = "240000";
const MARKDOWN_SKU = "E2E-BULK-01";
const MARKDOWN_TARGET = "150000";
const BULK_SKUS = Array.from(
  { length: 30 },
  (_, index) => `E2E-BULK-${String(index + 1).padStart(2, "0")}`
);

// Fixture tambahan agar tiap perilaku punya SKU sendiri.
const RESTORE_SKU = "E2E-RESTORE-01";
const RESTORE_SOURCE_PRICE = "120000";
const PERCENT_SKU = "E2E-PRS-01";
const PERCENT_SOURCE_PRICE = "100001";
const PERCENT_DISCOUNT = "15";

const PRODUCTS = [
  { id: `${PREFIX}-product-sepatu`, name: "E2E Bulk Sepatu", slug: "e2e-bulk-sepatu" },
  { id: `${PREFIX}-product-tas`, name: "E2E Bulk Tas", slug: "e2e-bulk-tas" },
  { id: `${PREFIX}-product-restore`, name: "E2E Restore Produk", slug: "e2e-restore-produk" },
  { id: `${PREFIX}-product-persen`, name: "E2E Persen Produk", slug: "e2e-persen-produk" },
];

function variantId(sku: string): string {
  return `${PREFIX}-${sku.toLowerCase()}`;
}

const BULK_VARIANTS = BULK_SKUS.map((sku, index) => ({
  id: variantId(sku),
  sku,
  productId: index < 15 ? PRODUCTS[0].id : PRODUCTS[1].id,
  color: index % 2 === 0 ? "Hitam" : "Putih",
  size: String(38 + (index % 5)),
}));

const BULK_VARIANT_IDS = BULK_VARIANTS.map((variant) => variant.id);
const VARIANT_IDS = [
  ...BULK_VARIANT_IDS,
  variantId(RESTORE_SKU),
  variantId(PERCENT_SKU),
];
const PRODUCT_IDS = PRODUCTS.map((product) => product.id);

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

function isApplyRequest(url: string, method: string): boolean {
  if (method !== "POST") return false;
  return /\/api\/admin\/price-changes\/[^/]+\/apply$/.test(new URL(url).pathname);
}

async function cleanup(): Promise<void> {
  // FK order: current pointer → revision → row result → batch → catalog, and the
  // apply-request receipts (batch RESTRICT) before their batches.
  await pool.query(
    "UPDATE price_change_batch_row SET state='pending', applied_revision_id=NULL WHERE variant_id = ANY($1::text[])",
    [VARIANT_IDS]
  );
  await pool.query("DELETE FROM variant_price_current WHERE variant_id = ANY($1::text[])", [
    VARIANT_IDS,
  ]);
  const batches = await pool.query<{ id: string }>(
    "SELECT id FROM price_change_batch WHERE actor_identity=$1",
    [hqId]
  );
  const batchIds = batches.rows.map((row) => row.id);
  if (batchIds.length > 0) {
    const rowIds = (
      await pool.query<{ id: string }>(
        "SELECT id FROM price_change_batch_row WHERE batch_id = ANY($1::text[])",
        [batchIds]
      )
    ).rows.map((row) => row.id);
    await pool.query("DELETE FROM audit_log WHERE entity_id = ANY($1::text[])", [
      [...VARIANT_IDS, ...batchIds, ...rowIds],
    ]);
    await pool.query("DELETE FROM price_change_apply_request WHERE batch_id = ANY($1::text[])", [
      batchIds,
    ]);
  }
  await pool.query("DELETE FROM variant_price_revision WHERE variant_id = ANY($1::text[])", [
    VARIANT_IDS,
  ]);
  await pool.query("DELETE FROM audit_log WHERE entity_id = ANY($1::text[])", [VARIANT_IDS]);
  if (batchIds.length > 0) {
    await pool.query("DELETE FROM price_change_batch_row WHERE batch_id = ANY($1::text[])", [
      batchIds,
    ]);
  }
  await pool.query("DELETE FROM price_change_batch WHERE actor_identity=$1", [hqId]);
  await pool.query("DELETE FROM product_variant WHERE id = ANY($1::text[])", [VARIANT_IDS]);
  await pool.query("DELETE FROM product WHERE id = ANY($1::text[])", [PRODUCT_IDS]);
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

  for (const product of PRODUCTS) {
    await pool.query(
      `INSERT INTO product (id, name, slug, base_price, status)
       VALUES ($1, $2, $3, '500000', 'aktif')`,
      [product.id, product.name, product.slug]
    );
  }
  for (const variant of BULK_VARIANTS) {
    await pool.query(
      `INSERT INTO product_variant (id, product_id, sku, color, size, price, is_default)
       VALUES ($1, $2, $3, $4, $5, $6, true)`,
      [variant.id, variant.productId, variant.sku, variant.color, variant.size, BULK_SOURCE_PRICE]
    );
  }
  await pool.query(
    `INSERT INTO product_variant (id, product_id, sku, price, is_default)
     VALUES ($1, $2, $3, $4, true)`,
    [variantId(RESTORE_SKU), PRODUCTS[2].id, RESTORE_SKU, RESTORE_SOURCE_PRICE]
  );
  await pool.query(
    `INSERT INTO product_variant (id, product_id, sku, price, is_default)
     VALUES ($1, $2, $3, $4, true)`,
    [variantId(PERCENT_SKU), PRODUCTS[3].id, PERCENT_SKU, PERCENT_SOURCE_PRICE]
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

  // Markdown aktif 150000 dibuat lewat jalur manual yang sudah ada (stage →
  // apply), sehingga revision/current pointer/audit dibuat oleh domain yang
  // sama dengan yang diuji — bukan SQL fixture yang menebak kolom.
  const staged = await hqContext.request.post("/api/admin/price-changes", {
    data: {
      requestKey: randomUUID(),
      rows: [{ sku: MARKDOWN_SKU, action: "set_price", targetUnitPrice: MARKDOWN_TARGET }],
    },
  });
  if (!staged.ok()) {
    throw new Error(
      `stage Markdown fixture failed (${staged.status()}): ${await staged.text()}`
    );
  }
  const stagedBody = await staged.json();
  const applied = await hqContext.request.post(
    `/api/admin/price-changes/${stagedBody.data.id}/apply`,
    { data: { requestKey: randomUUID(), previewDigest: "bulk-fixture-markdown" } }
  );
  if (!applied.ok()) {
    throw new Error(
      `apply Markdown fixture failed (${applied.status()}): ${await applied.text()}`
    );
  }
  const appliedBody = await applied.json();
  expect(appliedBody.data).toMatchObject({ state: "applied", appliedCount: 1 });
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

test("seleksi 30 SKU lintas halaman, review target fixed, apply pending lalu resume final", async () => {
  const page = await hqContext.newPage();
  await page.goto(`${ADMIN_BASE_URL}/admin/products/harga`);

  await page.getByTestId("bulk-search").fill("E2E Bulk");
  await page.getByTestId("bulk-search").press("Enter");

  const candidateTable = page.getByTestId("bulk-candidate-table");
  await expect(candidateTable.getByRole("row")).toHaveCount(26); // 25 SKU + header
  await page.getByTestId("bulk-select-page").click();
  await expect(page.getByTestId("bulk-selection-count")).toHaveText("Terpilih: 25 SKU");

  // Halaman 2: checkbox header hanya menambah 5 SKU halaman ini.
  await page.getByTestId("bulk-next-page").click();
  await expect(candidateTable.getByRole("row")).toHaveCount(6); // 5 SKU + header
  await page.getByTestId("bulk-select-page").click();
  await expect(page.getByTestId("bulk-selection-count")).toHaveText("Terpilih: 30 SKU");

  // Kembali ke halaman 1: pilihan halaman sebelumnya tetap dimiliki.
  await page.getByTestId("bulk-prev-page").click();
  await expect(candidateTable.getByRole("row")).toHaveCount(26);
  await expect(page.getByRole("checkbox", { name: `Pilih SKU ${MARKDOWN_SKU}` })).toBeChecked();
  await expect(page.getByTestId("bulk-selection-count")).toHaveText("Terpilih: 30 SKU");

  await page.getByRole("button", { name: "Ubah massal (% dari base)", exact: true }).click();
  await page.getByLabel("Diskon (%) dari base").fill(BULK_DISCOUNT_PERCENT);
  await page.getByTestId("bulk-stage").click();

  await expect(page.getByTestId("bulk-review-counts")).toContainText(
    "30 baris · 30 diterima · 0 error"
  );

  const reviewTable = page.getByTestId("bulk-review-table");
  const markdownRow = reviewTable.getByRole("row").filter({ hasText: MARKDOWN_SKU });
  // 20% dari Base Price 300000 (bukan 80% dari harga Markdown 150000).
  await expect(markdownRow).toContainText("Rp 240.000");
  // 150000 → 240000 adalah kenaikan 90000 di atas harga efektif kini.
  await expect(markdownRow).toContainText("Naik Rp 90.000");

  const [firstApply] = await Promise.all([
    page.waitForResponse((response) => isApplyRequest(response.url(), response.request().method())),
    page.getByTestId("bulk-apply").click(),
  ]);
  const firstApplyBody = await firstApply.json();
  // 30 row > chunk maksimum server: respons pertama belum boleh final, dan
  // counts selalu menjumlah seluruh row.
  expect(firstApplyBody.data.pendingCount, "chunk pertama masih menyisakan row").toBeGreaterThan(0);
  expect(
    firstApplyBody.data.appliedCount +
      firstApplyBody.data.unchangedCount +
      firstApplyBody.data.failedCount +
      firstApplyBody.data.pendingCount
  ).toBe(30);

  const status = page.getByTestId("bulk-status");
  await expect(status).toContainText("Belum final");
  await expect(status).toContainText("pending");
  await expect(page.getByTestId("bulk-resume")).toBeVisible();

  // Satu klik = satu chunk server; sisa baris dilanjutkan manual sampai final.
  let pending: number = firstApplyBody.data.pendingCount;
  for (let attempt = 0; attempt < 8 && pending > 0; attempt += 1) {
    const [response] = await Promise.all([
      page.waitForResponse((candidate) =>
        isApplyRequest(candidate.url(), candidate.request().method())
      ),
      page.getByTestId("bulk-resume").click(),
    ]);
    const body = await response.json();
    pending = body.data.pendingCount;
  }
  expect(pending, "resume berulang harus mencapai pending 0").toBe(0);
  await expect(page.getByTestId("bulk-resume")).toHaveCount(0);
  await expect(status).toContainText("30 baris diterapkan.");

  const batchId =
    (
      await pool.query<{ id: string }>(
        "SELECT id FROM price_change_batch WHERE actor_identity=$1 ORDER BY created_at DESC LIMIT 1",
        [hqId]
      )
    ).rows[0]?.id ?? "";
  expect(batchId, "the bulk batch must exist after apply").toBeTruthy();

  const rowStates = await pool.query<{ state: string; count: number }>(
    "SELECT state, count(*)::int AS count FROM price_change_batch_row WHERE batch_id=$1 GROUP BY state",
    [batchId]
  );
  expect(rowStates.rows).toEqual([{ state: "applied", count: 30 }]);

  const revisions = await pool.query<{ count: number }>(
    `SELECT count(*)::int AS count FROM variant_price_revision
     WHERE variant_id = ANY($1::text[]) AND target_unit_price = $2`,
    [BULK_VARIANT_IDS, BULK_TARGET_PRICE]
  );
  expect(revisions.rows[0].count, "one revision per applied row").toBe(30);

  const source = await pool.query<{ price: string }>(
    "SELECT price FROM product_variant WHERE id = ANY($1::text[])",
    [BULK_VARIANT_IDS]
  );
  expect(source.rows.every((row) => row.price === "300000.00")).toBe(true);

  const detail = await hqContext.request.get(
    `/api/admin/price-changes/${batchId}?page=1&limit=100`
  );
  expect(detail.ok()).toBe(true);
  const detailBody = await detail.json();
  expect(detailBody.data).toMatchObject({
    state: "applied",
    rowCount: 30,
    appliedCount: 30,
    unchangedCount: 0,
    failedCount: 0,
    pendingCount: 0,
  });

  await page.close();
});

test("restore tanpa target disabled di UI; API tetap no-op tanpa revision", async () => {
  const page = await hqContext.newPage();
  await page.goto(`${ADMIN_BASE_URL}/admin/products/harga`);
  await page.getByTestId("bulk-search").fill(RESTORE_SKU);
  await page.getByTestId("bulk-search").press("Enter");
  await page.getByRole("checkbox", { name: `Pilih SKU ${RESTORE_SKU}` }).check();
  await expect(page.getByRole("button", { name: "Restore terpilih", exact: true })).toBeDisabled();
  const staged = await hqContext.request.post("/api/admin/price-changes", { data: { requestKey: randomUUID(), rows: [{ sku: RESTORE_SKU, action: "restore_base" }] } });
  expect(staged.ok()).toBe(true);
  const batchId = (await staged.json()).data.id;
  const result = await hqContext.request.post(`/api/admin/price-changes/${batchId}/apply`, { data: { requestKey: randomUUID() } });
  expect((await result.json()).data).toMatchObject({ state: "applied", unchangedCount: 1, appliedCount: 0 });
  const history = await hqContext.request.get(`/api/admin/prices/${variantId(RESTORE_SKU)}/history`);
  expect((await history.json()).data.revisions).toEqual([]);
  await page.close();
});

test("shortcut persen dari source 100001 dibekukan ke target 85001", async () => {
  const page = await hqContext.newPage();
  await page.goto(`${ADMIN_BASE_URL}/admin/products/harga`);

  await page.getByTestId("bulk-search").fill(PERCENT_SKU);
  await page.getByTestId("bulk-search").press("Enter");
  await page.getByRole("checkbox", { name: `Pilih SKU ${PERCENT_SKU}` }).click();
  await expect(page.getByTestId("bulk-selection-count")).toHaveText("Terpilih: 1 SKU");

  await page.getByRole("button", { name: "Ubah massal (% dari base)", exact: true }).click();
  await page.getByLabel("Diskon (%) dari base").fill(PERCENT_DISCOUNT);
  await page.getByTestId("bulk-stage").click();

  await expect(page.getByTestId("bulk-review-counts")).toContainText(
    "1 baris · 1 diterima · 0 error"
  );
  const reviewRow = page
    .getByTestId("bulk-review-table")
    .getByRole("row")
    .filter({ hasText: PERCENT_SKU });
  // 85% dari 100001 = 85000.85 → half-up 85001.
  await expect(reviewRow).toContainText("Rp 85.001");

  await Promise.all([
    page.waitForResponse((response) => isApplyRequest(response.url(), response.request().method())),
    page.getByTestId("bulk-apply").click(),
  ]);
  await expect(page.getByTestId("bulk-status")).toContainText("1 baris diterapkan.");

  const revisions = await pool.query(
    `SELECT action, target_unit_price, effective_unit_price
     FROM variant_price_revision WHERE variant_id=$1`,
    [variantId(PERCENT_SKU)]
  );
  expect(revisions.rows).toEqual([
    {
      action: "set_price",
      target_unit_price: "85001.00",
      effective_unit_price: "85001.00",
    },
  ]);

  await page.close();
});

test("apply request key sama dengan digest berbeda ditolak 409 tanpa revision kedua", async () => {
  const staged = await hqContext.request.post("/api/admin/price-changes", {
    data: {
      requestKey: randomUUID(),
      source: "bulk",
      rows: [
        { sku: BULK_SKUS[2], action: "set_price", targetUnitPrice: "230000" },
        { sku: BULK_SKUS[3], action: "set_price", targetUnitPrice: "230000" },
      ],
    },
  });
  expect(staged.ok(), await staged.text()).toBe(true);
  const stagedBody = await staged.json();
  const batchId = stagedBody.data.id as string;
  const applyKey = randomUUID();

  const first = await hqContext.request.post(
    `/api/admin/price-changes/${batchId}/apply`,
    { data: { requestKey: applyKey, previewDigest: "digest-a" } }
  );
  expect(first.status()).toBe(200);
  const firstBody = await first.json();
  expect(firstBody.data.pendingCount).toBe(0);

  // Key yang sama dengan payload (digest) berbeda = konflik command, bukan
  // replay dan bukan chunk kedua.
  const conflict = await hqContext.request.post(
    `/api/admin/price-changes/${batchId}/apply`,
    { data: { requestKey: applyKey, previewDigest: "digest-b" } }
  );
  expect(conflict.status()).toBe(409);
  const conflictBody = (await conflict.json()) as { code?: string };
  expect(conflictBody.code).toBe("REQUEST_KEY_CONFLICT");

  const revisions = await pool.query<{ count: number }>(
    `SELECT count(*)::int AS count FROM variant_price_revision WHERE batch_id=$1`,
    [batchId]
  );
  expect(revisions.rows[0].count).toBe(2);
});

test("Admin tanpa grant prices ditolak di API dan direct URL", async () => {
  const candidates = await adminContext.request.get(
    "/api/admin/price-changes/candidates?search=E2E%20Bulk&page=1&limit=25"
  );
  expect(candidates.status()).toBe(403);

  const denied = await adminContext.request.post("/api/admin/price-changes", {
    data: {
      requestKey: randomUUID(),
      source: "bulk",
      rows: [{ sku: MARKDOWN_SKU, action: "set_price", targetUnitPrice: BULK_TARGET_PRICE }],
    },
  });
  expect(denied.status()).toBe(403);
  const deniedBody = (await denied.json()) as { success?: boolean; code?: string };
  expect(deniedBody.success).toBe(false);
  expect(deniedBody.code).toBe("DENIED");

  const page = await adminContext.newPage();
  await page.goto(`${ADMIN_BASE_URL}/admin/products/harga`);
  await expect(page).toHaveURL(/\/admin\/no-access$/);
  await page.close();
});
