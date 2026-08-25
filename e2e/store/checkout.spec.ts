import { test, expect } from "@playwright/test";
import { Pool } from "pg";
import dotenv from "dotenv";
import crypto from "node:crypto";

dotenv.config({ path: ".env" });
const createdOrderIds: string[] = [];
const temporarilyMappedVariantIds: string[] = [];
const temporarilyMappedBranchIds: string[] = [];

test.beforeAll(async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const variants = await pool.query(
    `SELECT pv.id
     FROM product_variant pv
     JOIN product p ON p.id = pv.product_id
     WHERE p.slug = 'wild-glide-38' AND pv.jubelio_item_id IS NULL
     ORDER BY pv.id`
  );
  for (const [index, row] of variants.rows.entries()) {
    await pool.query(
      "UPDATE product_variant SET jubelio_item_id = $1 WHERE id = $2",
      [1_910_000_000 + index, row.id]
    );
    temporarilyMappedVariantIds.push(row.id);
  }

  const branches = await pool.query(
    `SELECT DISTINCT b.id
     FROM branch b
     JOIN branch_stock bs ON bs.branch_id = b.id
     JOIN product_variant pv ON pv.id = bs.product_variant_id
     JOIN product p ON p.id = pv.product_id
     WHERE p.slug = 'wild-glide-38' AND b.jubelio_location_id IS NULL
     ORDER BY b.id`
  );
  for (const [index, row] of branches.rows.entries()) {
    await pool.query(
      "UPDATE branch SET jubelio_location_id = $1 WHERE id = $2",
      [1_920_000_000 + index, row.id]
    );
    temporarilyMappedBranchIds.push(row.id);
  }
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
        const operation = await client.query(
          `SELECT status FROM jubelio_stock_operation
           WHERE order_id = $1 AND type = 'reserve' LIMIT 1`,
          [createdOrderId]
        );
        const restorePhysicalStock = ["applied", "committed"].includes(
          operation.rows[0]?.status
        );
        for (const item of items.rows) {
          await client.query(
            `UPDATE branch_stock
             SET stock = stock + CASE WHEN $1 THEN $2 ELSE 0 END,
                 reserved_stock = GREATEST(0, reserved_stock - $2),
                 pending_remote_stock = GREATEST(0, pending_remote_stock - $2),
                 updated_at = NOW()
             WHERE branch_id = $3 AND product_variant_id = $4`,
            [
              restorePhysicalStock,
              item.quantity,
              order.rows[0].branch_id,
              item.variant_id,
            ]
          );
        }
      }
      await client.query("DELETE FROM orders WHERE id = $1", [createdOrderId]);
    }
    if (temporarilyMappedVariantIds.length > 0) {
      await client.query(
        "UPDATE product_variant SET jubelio_item_id = NULL WHERE id = ANY($1::text[])",
        [temporarilyMappedVariantIds]
      );
    }
    if (temporarilyMappedBranchIds.length > 0) {
      await client.query(
        "UPDATE branch SET jubelio_location_id = NULL WHERE id = ANY($1::text[])",
        [temporarilyMappedBranchIds]
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
});

// Cart & checkout — order-flow, stock-reservation, vouchers:
// cart → checkout → place-order → Midtrans redirect; voucher validation API.
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

async function reachCheckoutReview(
  page: import("@playwright/test").Page,
  email: string
) {
  await addItemToCart(page);
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
    page.getByRole("heading", { name: "Pembayaran QRIS" })
  ).toBeVisible();
  await page.getByText(/Saya telah memeriksa pesanan/).click();
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

  test("adds to cart from the product detail page", async ({ page }) => {
    await page.goto("/products/classic-leather-oxford-formal");

    // Pick the first branch with stock, then add to cart.
    await page.locator("button", { hasText: /Stok: \d+/ }).first().click();
    await page.getByRole("button", { name: "Masukkan Keranjang" }).click();

    await expect(
      page.getByText("Produk berhasil ditambahkan ke keranjang!")
    ).toBeVisible();
    // Cart badge shows 1.
    await expect(
      page.locator('a[aria-label="Keranjang"]').getByText("1")
    ).toBeVisible();
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

  test("full checkout: cart → place-order → Midtrans redirect", async ({
    page,
  }) => {
    await reachCheckoutReview(page, "john@example.com");
    await page.getByRole("button", { name: "Bayar Sekarang" }).click();

    // The default E2E suite uses a local payment boundary. Sandbox contract
    // tests are intentionally separate from deterministic regression tests.
    await expect(page).toHaveURL(/\/checkout\/payment-test\?orderId=/, {
      timeout: 30_000,
    });
    const createdOrderId = new URL(page.url()).searchParams.get("orderId");
    expect(createdOrderId).toBeTruthy();
    createdOrderIds.push(createdOrderId!);

    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    const snapshot = await pool.query(
      `SELECT payload->'items'->0->'snapshot' AS snapshot
       FROM jubelio_stock_operation
       WHERE order_id = $1 AND type = 'reserve'`,
      [createdOrderId]
    );
    await pool.end();
    expect(snapshot.rows[0]?.snapshot).toMatchObject({
      unit: "Buah",
      reserveAccountId: 75,
      releaseAccountId: 72,
    });
    expect(snapshot.rows[0]?.snapshot.cost).toEqual(expect.any(Number));
    expect(snapshot.rows[0]?.snapshot.binId).toEqual(expect.any(Number));
  });

  test("re-acquires stock when settlement arrives after confirmed compensation", async ({
    page,
  }) => {
    const orderId = createdOrderIds[0];
    expect(orderId).toBeTruthy();
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    const client = await pool.connect();
    let grossAmount = "";
    try {
      await client.query("BEGIN");
      const order = await client.query(
        "SELECT branch_id, total FROM orders WHERE id = $1 FOR UPDATE",
        [orderId]
      );
      const reserve = await client.query(
        `SELECT payload FROM jubelio_stock_operation
         WHERE order_id = $1 AND type = 'reserve'`,
        [orderId]
      );
      const payload = reserve.rows[0].payload;
      const releaseId = crypto.randomUUID();
      for (const item of payload.items) {
        await client.query(
          `UPDATE branch_stock
           SET stock = stock + $1,
               reserved_stock = GREATEST(0, reserved_stock - $1),
               updated_at = NOW()
           WHERE branch_id = $2 AND product_variant_id = $3`,
          [item.quantity, order.rows[0].branch_id, item.variantId]
        );
      }
      await client.query(
        `INSERT INTO jubelio_stock_operation
          (id, order_id, type, status, note, payload, remote_adjustment_id,
           attempt_count, next_attempt_at, created_at, updated_at)
         VALUES ($1, $2, 'release', 'applied', $3, $4, 8001, 1, NOW(), NOW(), NOW())`,
        [releaseId, orderId, `OKCIR_RELEASE:${orderId}:${releaseId}`, payload]
      );
      await client.query(
        `UPDATE orders
         SET status = 'failed_payment', payment_status = 'failed',
             payment_failure_reason = 'Payment expired',
             midtrans_failure_status = 'expire', updated_at = NOW()
         WHERE id = $1`,
        [orderId]
      );
      grossAmount = order.rows[0].total;
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }

    const configured = await page.request.put(
      "http://127.0.0.1:3002/__control/midtrans-status",
      {
        data: {
          orderId,
          transactionStatus: "settlement",
          grossAmount,
        },
      }
    );
    expect(configured.ok()).toBe(true);
    const statusCode = "200";
    const signature = crypto
      .createHash("sha512")
      .update(
        `${orderId}${statusCode}${grossAmount}${process.env.MIDTRANS_SERVER_KEY}`
      )
      .digest("hex");
    const webhook = await page.request.post("/api/webhooks/midtrans", {
      data: {
        order_id: orderId,
        transaction_status: "settlement",
        status_code: statusCode,
        gross_amount: grossAmount,
        signature_key: signature,
      },
    });
    expect(webhook.status()).toBe(200);

    const state = await pool.query(
      `SELECT o.status, o.payment_status,
              j.status AS operation_status, j.remote_adjustment_id,
              bs.pending_remote_stock
       FROM orders o
       JOIN jubelio_stock_operation j
         ON j.order_id = o.id AND j.type = 'reacquire'
       JOIN order_item oi ON oi.order_id = o.id
       JOIN branch_stock bs
         ON bs.branch_id = o.branch_id AND bs.product_variant_id = oi.variant_id
       WHERE o.id = $1`,
      [orderId]
    );
    await pool.end();
    expect(state.rows[0]).toMatchObject({
      status: "ready_for_pickup",
      payment_status: "paid",
      operation_status: "applied",
      pending_remote_stock: 0,
    });
    expect(state.rows[0].remote_adjustment_id).toEqual(expect.any(Number));
  });

  test("does not continue to Midtrans when Jubelio rejects the reservation", async ({
    page,
  }) => {
    const email = "stock-failure-e2e@example.com";
    await reachCheckoutReview(page, email);
    const scenario = await page.request.put(
      "http://127.0.0.1:3002/__control/scenario",
      { data: { scenario: "insufficient-stock" } }
    );
    expect(scenario.ok()).toBe(true);

    await page.getByRole("button", { name: "Bayar Sekarang" }).click();
    await expect(
      page.getByText(
        "Stock produk berubah atau tidak mencukupi. Silakan periksa keranjang Anda."
      )
    ).toBeVisible({ timeout: 15_000 });
    await expect(page).toHaveURL(/\/checkout$/);

    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    const failed = await pool.query(
      `SELECT id FROM orders
       WHERE contact_email = $1 AND midtrans_failure_status = 'stock_reservation_failed'
       ORDER BY created_at DESC LIMIT 1`,
      [email]
    );
    await pool.end();
    expect(failed.rows[0]?.id).toBeTruthy();
    createdOrderIds.push(failed.rows[0].id);
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
