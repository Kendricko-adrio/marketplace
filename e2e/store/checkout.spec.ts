import { test, expect } from "@playwright/test";
import { Pool } from "pg";
import dotenv from "dotenv";

dotenv.config({ path: ".env" });
let createdOrderId: string | null = null;

test.afterAll(async () => {
  if (!createdOrderId) return;
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const order = await client.query(
      "SELECT branch_id FROM orders WHERE id = $1 FOR UPDATE",
      [createdOrderId]
    );
    if (order.rows[0]?.branch_id) {
      const items = await client.query(
        "SELECT variant_id, quantity FROM order_item WHERE order_id = $1",
        [createdOrderId]
      );
      for (const item of items.rows) {
        await client.query(
          `UPDATE branch_stock
           SET reserved_stock = GREATEST(0, reserved_stock - $1), updated_at = NOW()
           WHERE branch_id = $2 AND product_variant_id = $3`,
          [item.quantity, order.rows[0].branch_id, item.variant_id]
        );
      }
    }
    await client.query("DELETE FROM orders WHERE id = $1", [createdOrderId]);
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

test.describe("storefront cart & checkout", () => {
  // All tests share the same customer's cart (single storageState) — run
  // serially so the beforeEach cart-clear is deterministic.
  test.describe.configure({ mode: "serial" });

  test.beforeEach(async ({ page }) => {
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
    await addItemToCart(page);

    // Select the item on the cart page and proceed to checkout (the checkout
    // page redirects back to /cart when nothing is selected).
    await page.goto("/cart");
    await page.getByRole("checkbox").first().check();
    await page.getByRole("button", { name: "Checkout" }).click();
    await page.waitForURL("**/checkout");

    // Step 1 — Kontak.
    await page.getByLabel("Nomor Telepon *").fill("081234567890");
    await page.getByLabel("Email *").fill("john@example.com");
    await page.getByRole("button", { name: "Lanjut" }).click();

    // Step 2 — Ambil di Toko: date + time.
    await page.getByLabel("Tanggal Pickup *").fill(nextOpenDate());
    await page.getByRole("combobox").click();
    await page.getByRole("option", { name: "10:00" }).click();
    await page.getByRole("button", { name: "Lanjut" }).click();

    // Step 3 — Review & place order.
    await expect(
      page.getByRole("heading", { name: "Pembayaran QRIS" })
    ).toBeVisible();
    await page.getByText(/Saya telah memeriksa pesanan/).click();
    await page.getByRole("button", { name: "Bayar Sekarang" }).click();

    // The default E2E suite uses a local payment boundary. Sandbox contract
    // tests are intentionally separate from deterministic regression tests.
    await expect(page).toHaveURL(/\/checkout\/payment-test\?orderId=/, {
      timeout: 30_000,
    });
    createdOrderId = new URL(page.url()).searchParams.get("orderId");
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
