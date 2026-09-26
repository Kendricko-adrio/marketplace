import { test, expect } from "@playwright/test";
import { Pool } from "pg";
import dotenv from "dotenv";
import crypto from "node:crypto";

dotenv.config({ path: ".env" });
const createdOrderIds: string[] = [];
const temporarilyMappedVariantIds: string[] = [];
const temporarilyMappedBranchIds: string[] = [];

// The Sales-Order checkout talks to the REAL isolated Jubelio test account
// (.env is the owner-approved isolated test account; production credentials
// are never configured). The e2e suite maps its fixture product onto the
// canary sandbox item/location (plan research 2026-09-23) so SO creates,
// confirmations and cancels exercise the live contract.
const SANDBOX_ITEM_ID = 43_842;
const SANDBOX_LOCATION_ID = 7;
const LEGACY_PROBE_ITEM_ID = 1_999_999_999; // does not exist in the sandbox

const sandboxEnabled =
  process.env.JUBELIO_SALES_TEST_ACCOUNT_ENABLED === "true" &&
  !!process.env.JUBELIO_EMAIL &&
  !!process.env.JUBELIO_PASSWORD;

// Sales Orders created by this spec, canceled in afterAll through the live
// gateway so the sandbox stock series is restored for the next run.
const createdSalesOrderIds: number[] = [];
const originalVariantItemIds: Array<{ id: string; itemId: number | null }> = [];
const originalSnapshots: Array<{ branchId: string; variantId: string; available: number | null; syncedAt: Date | null; onOrder: number; reserved: number; stock: number }> = [];
const originalBranchLocations: Array<{
  id: string;
  locationId: number | null;
}> = [];
// Set by beforeAll: the variant selling through the REAL sandbox item and the
// one pointing at a nonexistent remote item (fail-closed probe).
let sellVariantId = "";
let probeVariantId = "";
let sellBranchId = "";

test.beforeAll(async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  // Map variants in the SAME order the product-detail API returns them
  // (is_default ASC, id ASC) so "the first variant with stock" is
  // deterministic: the first sells through the REAL sandbox item; the second
  // points at an item id that does not exist remotely (fail-closed probe).
  const variants = await pool.query(
    `SELECT pv.id, pv.jubelio_item_id
     FROM product_variant pv
     JOIN product p ON p.id = pv.product_id
     WHERE p.slug = 'wild-glide-38'
     ORDER BY pv.is_default ASC, pv.id ASC`
  );
  for (const [index, row] of variants.rows.entries()) {
    originalVariantItemIds.push({ id: row.id, itemId: row.jubelio_item_id });
    const itemId =
      index === 0 ? SANDBOX_ITEM_ID : LEGACY_PROBE_ITEM_ID + index;
    await pool.query(
      "UPDATE product_variant SET jubelio_item_id = $1 WHERE id = $2",
      [itemId, row.id]
    );
    temporarilyMappedVariantIds.push(row.id);
    if (index === 0) sellVariantId = row.id;
    if (index === 1) probeVariantId = row.id;
  }

  const branches = await pool.query(
    `SELECT DISTINCT b.id, b.jubelio_location_id
     FROM branch b
     JOIN branch_stock bs ON bs.branch_id = b.id
     JOIN product_variant pv ON pv.id = bs.product_variant_id
     JOIN product p ON p.id = pv.product_id
     WHERE p.slug = 'wild-glide-38'
     ORDER BY b.id`
  );
  for (const [index, row] of branches.rows.entries()) {
    originalBranchLocations.push({
      id: row.id,
      locationId: row.jubelio_location_id,
    });
    await pool.query(
      "UPDATE branch SET jubelio_location_id = $1 WHERE id = $2",
      [SANDBOX_LOCATION_ID + index, row.id]
    );
    temporarilyMappedBranchIds.push(row.id);
    if (index === 0) sellBranchId = row.id;
  }

  if (temporarilyMappedVariantIds.length > 0) {
    const snapshots = await pool.query(
      `SELECT branch_id, product_variant_id, available_stock, provider_stock_synced_at,
              on_order_stock, provider_reserved_stock, stock FROM branch_stock
       WHERE product_variant_id = ANY($1::text[])`,
      [temporarilyMappedVariantIds]
    );
    for (const row of snapshots.rows) originalSnapshots.push({
      branchId: row.branch_id, variantId: row.product_variant_id,
      available: row.available_stock, syncedAt: row.provider_stock_synced_at,
      onOrder: row.on_order_stock, reserved: row.provider_reserved_stock, stock: row.stock,
    });
  }

  // SO sellable rule needs a provider `available` snapshot; only the branch
  // mapped to the real sandbox location (7) stays sellable so checkout
  // deterministically uses the sandbox-backed branch (other locations do not
  // exist remotely).
  await pool.query(
    `UPDATE branch_stock bs SET available_stock = 0
     FROM branch b
     WHERE b.id = bs.branch_id
       AND bs.product_variant_id = ANY($1::text[])
       AND (b.jubelio_location_id IS NULL OR b.jubelio_location_id <> $2)`,
    [temporarilyMappedVariantIds, SANDBOX_LOCATION_ID]
  );
  await pool.query(
    `UPDATE branch_stock bs SET available_stock = GREATEST(bs.stock, 2), provider_stock_synced_at = NOW()
     FROM branch b
     WHERE b.id = bs.branch_id
       AND bs.product_variant_id = ANY($1::text[])
       AND b.jubelio_location_id = $2`,
    [temporarilyMappedVariantIds, SANDBOX_LOCATION_ID]
  );
  await pool.end();
});

test.afterAll(async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const createdOrderId of createdOrderIds) {
      const order = await client.query(
        "SELECT branch_id FROM orders WHERE id = $1 FOR UPDATE",
        [createdOrderId]
      );
      if (order.rows[0]?.branch_id) {
        const items = await client.query(
          "SELECT variant_id, quantity FROM order_item WHERE order_id = $1",
          [createdOrderId]
        );
        // Release any leftover local SO holds (the sandbox stock series is
        // restored separately by canceling the created Sales Orders).
        for (const item of items.rows) {
          await client.query(
            `UPDATE branch_stock
             SET pending_remote_stock = GREATEST(0, pending_remote_stock - $1),
                 updated_at = NOW()
             WHERE branch_id = $2 AND product_variant_id = $3`,
            [item.quantity, order.rows[0].branch_id, item.variant_id]
          );
        }
      }
      await client.query("DELETE FROM orders WHERE id = $1", [createdOrderId]);
    }
    for (const snapshot of originalSnapshots) {
      await client.query(
        `UPDATE branch_stock SET available_stock = $1, provider_stock_synced_at = $2,
                on_order_stock = $3, provider_reserved_stock = $4, stock = $5
         WHERE branch_id = $6 AND product_variant_id = $7`,
        [snapshot.available, snapshot.syncedAt, snapshot.onOrder, snapshot.reserved,
         snapshot.stock, snapshot.branchId, snapshot.variantId]
      );
    }
    for (const row of originalVariantItemIds) {
      await client.query(
        "UPDATE product_variant SET jubelio_item_id = $1 WHERE id = $2",
        [row.itemId, row.id]
      );
    }
    for (const row of originalBranchLocations) {
      await client.query(
        "UPDATE branch SET jubelio_location_id = $1 WHERE id = $2",
        [row.locationId, row.id]
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  // Cancel the Sales Orders this spec created in the sandbox (a confirmed
  // cancel restores the provider stock series for the next run).
  if (createdSalesOrderIds.length > 0 && sandboxEnabled) {
    const { createJubelioSalesGateway } = await import(
      "../../apps/store/src/lib/jubelio-sales-client"
    );
    const gateway = createJubelioSalesGateway();
    for (const salesOrderId of createdSalesOrderIds) {
      try {
        await gateway.cancelSalesOrder({
          salesOrderId,
          operationId: `e2e-cleanup:${salesOrderId}`,
        });
      } catch {
        // Best-effort: the sandbox holds test data only.
      }
    }
  }
  await pool.end();
});

// Cart & checkout — order-flow, Sales-Order reservation, vouchers:
// cart → checkout → place-order → confirmed SO → Midtrans redirect.
// Uses the authenticated store session (storageState).

// Branches are closed on Sunday (no operating hours) — pick the next open day.
function nextOpenDate(): string {
  const d = new Date(
    new Date().toLocaleString("en-US", { timeZone: "Asia/Jakarta" })
  );
  d.setDate(d.getDate() + 1);
  while (d.getDay() === 0) d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Adds one unit of the first in-stock product to the cart via the API and
// returns the cart item (fetched from /api/cart after the insert).
async function addItemToCart(page: import("@playwright/test").Page) {
  const res = await page.request.get("/api/products?search=wild%20glide&limit=1");
  const data = await res.json();
  const product = data.data[0];
  const detail = await (
    await page.request.get(`/api/products/${product.slug}`)
  ).json();
  const variant = detail.data.variants.find(
    (v: { branchStock: unknown[] }) => v.branchStock.length > 0
  );
  const branch = variant.branchStock[0];
  const add = await page.request.post("/api/cart/items", {
    data: { variantId: variant.id, branchId: branch.branchId, quantity: 1 },
  });
  expect(add.status()).toBe(200);
  const cart = await (await page.request.get("/api/cart")).json();
  return cart.data.items.find(
    (i: { variantId: string }) => i.variantId === variant.id
  );
}

// Adds one unit of a SPECIFIC variant to the cart via the API.
async function addVariantToCart(
  page: import("@playwright/test").Page,
  variantId: string,
  branchId: string
) {
  const add = await page.request.post("/api/cart/items", {
    data: { variantId, branchId, quantity: 1 },
  });
  expect(add.status()).toBe(200);
}

async function reachCheckoutReview(
  page: import("@playwright/test").Page,
  email: string,
  variantId?: string,
  branchId?: string
) {
  if (variantId && branchId) {
    await addVariantToCart(page, variantId, branchId);
  } else {
    await addItemToCart(page);
  }
  await page.goto("/cart");
  await page.getByRole("checkbox").first().check();
  await page.getByRole("button", { name: "Checkout" }).click();
  await page.waitForURL("**/checkout");
  await page.getByLabel("Nomor Telepon *").fill("081234567890");
  await page.getByLabel("Email *").fill(email);
  await page.getByRole("button", { name: "Lanjut" }).click();
  await page.getByLabel("Tanggal Pickup *").fill(nextOpenDate());
  await page.getByRole("combobox").click();
  await page.getByRole("option", { name: "10:00" }).click();
  await page.getByRole("button", { name: "Lanjut" }).click();
  await expect(
    page.getByRole("heading", { name: "Pembayaran" })
  ).toBeVisible();
  await page.getByText(/Saya telah memeriksa pesanan/).click();
}

async function postSignedWebhook(
  page: import("@playwright/test").Page,
  orderId: string,
  transactionStatus: string,
  grossAmount: string,
  extra: Record<string, unknown> = {}
): Promise<import("@playwright/test").APIResponse> {
  const statusCode = "200";
  const signature = crypto
    .createHash("sha512")
    .update(
      `${orderId}${statusCode}${grossAmount}${process.env.MIDTRANS_SERVER_KEY}`
    )
    .digest("hex");
  return page.request.post("/api/webhooks/midtrans", {
    data: {
      order_id: orderId,
      transaction_status: transactionStatus,
      status_code: statusCode,
      gross_amount: grossAmount,
      signature_key: signature,
      ...extra,
    },
  });
}

test.describe("storefront cart & checkout", () => {
  // All tests share the same customer's cart (single storageState) — run
  // serially so the beforeEach cart-clear is deterministic.
  test.describe.configure({ mode: "serial" });

  test.beforeEach(async ({ page }) => {
    const mockReset = await page.request.post(
      "http://127.0.0.1:3002/__control/reset"
    );
    expect(mockReset.ok()).toBe(true);
    // Deterministic start: empty the cart (leftover items from other runs
    // would break single-branch checkout).
    const res = await page.request.get("/api/cart");
    const data = await res.json();
    const items = data.data?.items ?? [];
    for (const item of items) {
      await page.request.delete(`/api/cart/items/${item.id}`);
    }
  });

  test("unobserved legacy product cannot be added from product detail", async ({ page }) => {
    await page.goto("/products/classic-leather-oxford-formal");
    // These legacy rows have no provider snapshot. A positive on-hand mirror
    // must not become an available branch without a real provider observation.
    await expect(page.locator("button", { hasText: /Stok: [1-9]\d*/ })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Masukkan Keranjang" })).toBeDisabled();
  });

  test("cart page lists items with net price and RRP strikethrough", async ({
    page,
  }) => {
    const item = await addItemToCart(page);
    await page.goto("/cart");

    await expect(page.getByText("Wild Glide 38")).toBeVisible();
    // Net price of the selected variant (not the cheapest card price) with
    // the RRP strikethrough.
    const net = parseFloat(item.variant.price).toLocaleString("id-ID");
    await expect(page.getByText(`Rp ${net}`)).toBeVisible();
    await expect(page.locator(".line-through").first()).toBeVisible();
  });

  test("checkout summary distinguishes the selected pickup branch", async ({
    page,
  }) => {
    const item = await addItemToCart(page);
    await page.goto("/cart");
    await page.getByRole("checkbox").first().check();
    await page.getByRole("button", { name: "Checkout" }).click();
    await page.waitForURL("**/checkout");

    const pickupBranch = page.getByRole("group", {
      name: "Cabang pengambilan",
    });
    await expect(pickupBranch).toBeVisible();
    await expect(pickupBranch).toContainText(item.branch.name);
    await expect(pickupBranch).toContainText(item.branch.city);
  });

  test("an old local snapshot does not remove cart items before live checkout verification", async ({ page }) => {
    const item = await addItemToCart(page);
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    try {
      await pool.query(
        "UPDATE branch_stock SET provider_stock_synced_at = NOW() - INTERVAL '1 day' WHERE branch_id = $1 AND product_variant_id = $2",
        [item.branch.id, item.variantId]
      );
      const validated = await page.request.post("/api/cart/validate-checkout", {
        data: { selectedItemIds: [item.id] },
      });
      expect(validated.status()).toBe(200);
      expect((await validated.json()).success).toBe(true);
      const cart = await (await page.request.get("/api/cart")).json();
      expect(cart.data.items.some((row: { id: string }) => row.id === item.id)).toBe(true);
    } finally {
      await pool.end();
    }
  });

  test("full checkout: cart → place-order → confirmed Sales Order → Midtrans redirect", async ({
    page,
  }) => {
    test.skip(!sandboxEnabled, "SO checkout requires the isolated Jubelio test account (.env)");
    await reachCheckoutReview(page, "john@example.com", sellVariantId, sellBranchId);
    await expect(page.getByText("PPN (11%)").first()).toBeVisible();
    await page.getByRole("button", { name: "Bayar Sekarang" }).click();

    // Midtrans starts ONLY after the SO create is confirmed via GET.
    await expect(page).toHaveURL(/\/checkout\/payment-test\?orderId=/, {
      timeout: 30_000,
    });
    const createdOrderId = new URL(page.url()).searchParams.get("orderId");
    expect(createdOrderId).toBeTruthy();
    createdOrderIds.push(createdOrderId!);

    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    // The durable ledger holds the intent BEFORE the POST and confirms it
    // after an independent GET; the SO id is persisted on the order.
    const operation = await pool.query(
      `SELECT status, sales_order_id FROM jubelio_sales_operation
       WHERE order_id = $1 AND type = 'create'`,
      [createdOrderId]
    );
    const order = await pool.query(
      "SELECT jubelio_sales_order_id, status, payment_status FROM orders WHERE id = $1",
      [createdOrderId]
    );
    const pricing = await pool.query(
      `SELECT subtotal, discount, ppn_rate, ppn_amount, total
       FROM orders WHERE id = $1`,
      [createdOrderId]
    );
    // Zero /inventory/adjustments/ writes in the SO lifecycle: the legacy
    // adjustment ledger must have no row for this order.
    const legacy = await pool.query(
      "SELECT id FROM jubelio_stock_operation WHERE order_id = $1",
      [createdOrderId]
    );
    await pool.end();
    expect(operation.rows[0]?.status).toBe("confirmed");
    const salesOrderId = operation.rows[0]?.sales_order_id as number;
    expect(salesOrderId).toBeGreaterThan(0);
    createdSalesOrderIds.push(salesOrderId);
    expect(order.rows[0]).toMatchObject({
      jubelio_sales_order_id: salesOrderId,
      status: "pending_payment",
      payment_status: "pending",
    });
    expect(legacy.rows).toHaveLength(0);
    expect(Number(pricing.rows[0].ppn_rate)).toBe(11);
    expect(Number(pricing.rows[0].ppn_amount)).toBeGreaterThan(0);
    expect(Number(pricing.rows[0].total)).toBe(
      Number(pricing.rows[0].subtotal) - Number(pricing.rows[0].discount) +
        Number(pricing.rows[0].ppn_amount)
    );
  });

  test("late settlement after a confirmed Sales-Order cancel stays paid but blocked (manual review)", async ({
    page,
  }) => {
    test.skip(!sandboxEnabled, "SO checkout requires the isolated Jubelio test account (.env)");
    // Reuse the first created order: force it into the failed+confirmed-cancel
    // state, then deliver a settlement webhook.
    const orderId = createdOrderIds[0];
    expect(orderId).toBeTruthy();
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    const client = await pool.connect();
    let grossAmount = "";
    let salesOrderId = 0;
    try {
      await client.query("BEGIN");
      const order = await client.query(
        "SELECT total FROM orders WHERE id = $1 FOR UPDATE",
        [orderId]
      );
      grossAmount = order.rows[0].total;
      const operation = await client.query(
        `SELECT sales_order_id FROM jubelio_sales_operation
         WHERE order_id = $1 AND type = 'create' AND status = 'confirmed'`,
        [orderId]
      );
      salesOrderId = operation.rows[0].sales_order_id;
      // Simulate the TTL failure path having canceled the SO (confirmed).
      await client.query(
        `INSERT INTO jubelio_sales_operation
           (id, order_id, type, status, reference, payload, sales_order_id, attempt_count, dispatched_at, confirmed_at)
         VALUES ($1, $2, 'cancel', 'confirmed', $3, $4::jsonb, $5, 1, NOW(), NOW())
         ON CONFLICT (order_id, type) DO NOTHING`,
        [
          crypto.randomUUID(),
          orderId,
          `OKCIR_SO_CANCEL:${orderId}:e2e`,
          JSON.stringify({ type: "cancel", cancel: { salesOrderId } }),
          salesOrderId,
        ]
      );
      await client.query(
        `UPDATE orders
         SET status = 'failed_payment', payment_status = 'failed',
             payment_failure_reason = 'Payment expired',
             midtrans_failure_status = 'expire', updated_at = NOW()
         WHERE id = $1`,
        [orderId]
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    // Cancel the real SO now (pre-invoice; the sandbox stock series is
    // restored) while the local order replays the late-settlement webhook.
    // Best-effort: the sandbox may already have pruned the unpaid probe SO.
    const { createJubelioSalesGateway } = await import(
      "../../apps/store/src/lib/jubelio-sales-client"
    );
    const gateway = createJubelioSalesGateway();
    try {
      await gateway.cancelSalesOrder({ salesOrderId, operationId: `e2e-late:${salesOrderId}` });
    } catch {
      // Ignore: the local assertions below are driven by the durable ledger.
    }

    // Configure the authoritative Midtrans GET status on the local mock
    // before delivering the webhook.
    const configured = await page.request.put(
      "http://127.0.0.1:3002/__control/midtrans-status",
      {
        data: {
          orderId,
          transactionStatus: "settlement",
          grossAmount,
          paymentType: "gopay",
          transactionId: "late-settlement-txn-id",
        },
      }
    );
    expect(configured.ok()).toBe(true);

    const webhook = await postSignedWebhook(page, orderId!, "settlement", grossAmount);
    expect(webhook.status()).toBe(200);

    const state = await pool.query(
      `SELECT status, payment_status, fulfillment_blocked_reason, pickup_code
       FROM orders WHERE id = $1`,
      [orderId]
    );
    await pool.end();
    // Midtrans paid status is authoritative and kept; fulfillment stays
    // blocked and NO pickup code may exist for a paid-but-blocked order.
    expect(state.rows[0]).toMatchObject({
      status: "processing",
      payment_status: "paid",
      pickup_code: null,
    });
    expect(String(state.rows[0].fulfillment_blocked_reason)).toContain("cancel");
  });

  test("an unknown remote item keeps the hold and routes to manual review (fail closed)", async ({
    page,
  }) => {
    test.skip(!sandboxEnabled, "SO checkout requires the isolated Jubelio test account (.env)");
    // The probe variant points at an item id that does not exist in the
    // sandbox: the create POST is ambiguous (provider 500 after send) → the
    // order keeps its hold, stays pending, and NO second SO is attempted.
    const email = "so-unknown-item-e2e@example.com";
    await reachCheckoutReview(page, email, probeVariantId, sellBranchId);
    await page.getByRole("button", { name: "Bayar Sekarang" }).click();

    await expect(page.getByText(/Pesanan sedang diproses/)).toBeVisible({
      timeout: 30_000,
    });
    await expect(page).toHaveURL(/\/checkout$/);

    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    const failed = await pool.query(
      `SELECT o.id FROM orders o
       WHERE o.contact_email = $1
       ORDER BY o.created_at DESC LIMIT 1`,
      [email]
    );
    const orderId = failed.rows[0]?.id;
    expect(orderId).toBeTruthy();
    createdOrderIds.push(orderId);
    const operation = await pool.query(
      `SELECT status FROM jubelio_sales_operation
       WHERE order_id = $1 AND type = 'create'`,
      [orderId]
    );
    const order = await pool.query(
      "SELECT status, payment_status FROM orders WHERE id = $1",
      [orderId]
    );
    const stock = await pool.query(
      `SELECT bs.pending_remote_stock FROM branch_stock bs
       JOIN order_item oi ON oi.variant_id = bs.product_variant_id
       JOIN orders o ON o.id = oi.order_id AND o.branch_id = bs.branch_id
       WHERE oi.order_id = $1 LIMIT 1`,
      [orderId]
    );
    await pool.end();
    // Ambiguous is never treated as success or definitive failure: the op is
    // in manual review, the hold stays, the order stays pending.
    expect(operation.rows[0]?.status).toBe("manual_review");
    expect(order.rows[0]).toMatchObject({
      status: "pending_payment",
      payment_status: "pending",
    });
    expect(Number(stock.rows[0]?.pending_remote_stock)).toBeGreaterThan(0);
  });

  test("settlement persists authoritative payment attributes; replay stays idempotent", async ({
    page,
  }) => {
    test.skip(!sandboxEnabled, "SO checkout requires the isolated Jubelio test account (.env)");
    await reachCheckoutReview(page, "gopay-e2e@example.com", sellVariantId, sellBranchId);
    await page.getByRole("button", { name: "Bayar Sekarang" }).click();
    await expect(page).toHaveURL(/\/checkout\/payment-test\?orderId=/, {
      timeout: 30_000,
    });
    const orderId = new URL(page.url()).searchParams.get("orderId");
    expect(orderId).toBeTruthy();
    createdOrderIds.push(orderId!);

    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    const salesOrderRow = await pool.query(
      "SELECT sales_order_id FROM jubelio_sales_operation WHERE order_id = $1 AND type = 'create'",
      [orderId]
    );
    createdSalesOrderIds.push(salesOrderRow.rows[0].sales_order_id);
    const order = await pool.query("SELECT total FROM orders WHERE id = $1", [
      orderId,
    ]);
    const grossAmount = order.rows[0].total as string;

    // Mock the authoritative GET status: paid via GoPay.
    const configured = await page.request.put(
      "http://127.0.0.1:3002/__control/midtrans-status",
      {
        data: {
          orderId,
          transactionStatus: "settlement",
          grossAmount,
          paymentType: "gopay",
          transactionId: "513f1f01-c9da-474c-9fc9-d5c64364b709",
        },
      }
    );
    expect(configured.ok()).toBe(true);

    // The raw webhook body deliberately claims a different method/id —
    // the persistence must come from the GET status, not the webhook body.
    const webhook = await postSignedWebhook(page, orderId!, "settlement", grossAmount, {
      payment_type: "credit_card",
      transaction_id: "spoofed-from-body",
    });
    expect(webhook.status()).toBe(200);

    const state = await pool.query(
      `SELECT status, payment_status, payment_method, midtrans_transaction_id
       FROM orders WHERE id = $1`,
      [orderId]
    );
    expect(state.rows[0]).toMatchObject({
      payment_status: "paid",
      payment_method: "gopay",
      midtrans_transaction_id: "513f1f01-c9da-474c-9fc9-d5c64364b709",
    });
    // Fulfillment is gated on the Sales-Order settlement (invoice + payment
    // verified against the live sandbox). Depending on sandbox state the
    // pipeline verifies (ready_for_pickup) or blocks (paid-but-blocked); a
    // pickup code can only exist in the verified case.
    if (state.rows[0].status === "ready_for_pickup") {
      expect(state.rows[0].midtrans_transaction_id).toBe(
        "513f1f01-c9da-474c-9fc9-d5c64364b709"
      );
      expect(state.rows[0].payment_status).toBe("paid");
    } else {
      expect(state.rows[0].status).toBe("processing");
    }

    // Replay the identical settlement → idempotent 200, payment stays paid.
    const replay = await postSignedWebhook(page, orderId!, "settlement", grossAmount);
    expect(replay.status()).toBe(200);
    const after = await pool.query(
      "SELECT status, payment_status FROM orders WHERE id = $1",
      [orderId]
    );
    await pool.end();
    expect(after.rows[0]).toMatchObject({ payment_status: "paid" });
  });

  test("deny is a non-terminal attempt — a later settlement still finalizes", async ({
    page,
  }) => {
    test.skip(!sandboxEnabled, "SO checkout requires the isolated Jubelio test account (.env)");
    await reachCheckoutReview(page, "deny-retry-e2e@example.com", sellVariantId, sellBranchId);
    await page.getByRole("button", { name: "Bayar Sekarang" }).click();
    await expect(page).toHaveURL(/\/checkout\/payment-test\?orderId=/, {
      timeout: 30_000,
    });
    const orderId = new URL(page.url()).searchParams.get("orderId");
    expect(orderId).toBeTruthy();
    createdOrderIds.push(orderId!);

    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    const salesOrderRow = await pool.query(
      "SELECT sales_order_id FROM jubelio_sales_operation WHERE order_id = $1 AND type = 'create'",
      [orderId]
    );
    if (salesOrderRow.rows[0]?.sales_order_id) {
      createdSalesOrderIds.push(salesOrderRow.rows[0].sales_order_id);
    }
    const order = await pool.query("SELECT total FROM orders WHERE id = $1", [
      orderId,
    ]);
    const grossAmount = order.rows[0].total as string;

    // Card denied via credit card attempt.
    await page.request.put("http://127.0.0.1:3002/__control/midtrans-status", {
      data: {
        orderId,
        transactionStatus: "deny",
        grossAmount,
        paymentType: "credit_card",
      },
    });
    const deny = await postSignedWebhook(page, orderId!, "deny", grossAmount, {
      payment_type: "credit_card",
    });
    expect(deny.status()).toBe(200);

    const afterDeny = await pool.query(
      `SELECT status, payment_status, payment_failure_reason
       FROM orders WHERE id = $1`,
      [orderId]
    );
    expect(afterDeny.rows[0]).toMatchObject({
      status: "pending_payment",
      payment_status: "pending",
      payment_failure_reason: null,
    });

    // The customer retries with GoPay and succeeds.
    await page.request.put("http://127.0.0.1:3002/__control/midtrans-status", {
      data: {
        orderId,
        transactionStatus: "settlement",
        grossAmount,
        paymentType: "gopay",
        transactionId: "attempt-2-txn-id",
      },
    });
    const settle = await postSignedWebhook(page, orderId!, "settlement", grossAmount);
    expect(settle.status()).toBe(200);

    const afterSettle = await pool.query(
      `SELECT status, payment_status, payment_method, midtrans_transaction_id
       FROM orders WHERE id = $1`,
      [orderId]
    );
    await pool.end();
    expect(afterSettle.rows[0]).toMatchObject({
      payment_status: "paid",
      payment_method: "gopay",
      midtrans_transaction_id: "attempt-2-txn-id",
    });
  });

  test("voucher validation API: valid, minimum-purchase, and unknown codes", async ({
    page,
  }) => {
    // Valid code (case-insensitive) with subtotal → discount preview.
    const ok = await page.request.post("/api/vouchers/validate", {
      data: { code: "diskon10", subtotal: 100000 },
    });
    expect(ok.status()).toBe(200);
    const okBody = await ok.json();
    expect(okBody.data.discount).toBe(10000); // 10% of 100.000
    expect(okBody.data.remainingQuota).toBe(50);

    // Below minimum purchase → 400.
    const below = await page.request.post("/api/vouchers/validate", {
      data: { code: "DISKON10", subtotal: 40000 },
    });
    expect(below.status()).toBe(400);

    // Unknown code → 404.
    const unknown = await page.request.post("/api/vouchers/validate", {
      data: { code: "TIDAKADA" },
    });
    expect(unknown.status()).toBe(404);
  });
});