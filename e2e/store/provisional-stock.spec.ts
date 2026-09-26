import { expect, test } from "@playwright/test";

test.describe.configure({ mode: "serial" });

function nextOpenDate(): string {
  const d = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Jakarta" }));
  d.setDate(d.getDate() + 1);
  while (d.getDay() === 0) d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// This spec never calls Jubelio or creates a Sales Order: it checks the
// user-visible meaning of the last-known stock on the seeded product page.
test("product stock is presented as provisional until checkout", async ({ page }) => {
  const catalog = await (await page.request.get("/api/products?limit=1")).json();
  expect(catalog.data.length).toBeGreaterThan(0);
  await page.goto(`/products/${catalog.data[0].slug}`);
  await expect(page.getByText("Stok dikonfirmasi dari Jubelio saat bayar")).toBeVisible();
});

test("a provisional zero does not prevent adding a mapped item to the cart", async ({ page }) => {
  const catalog = await (await page.request.get("/api/products?limit=1")).json();
  const detail = await (await page.request.get(`/api/products/${catalog.data[0].slug}`)).json();
  const variant = detail.data.variants.find((v: { branchStock: unknown[] }) => v.branchStock.length);
  expect(variant).toBeTruthy();
  const branch = variant.branchStock[0];
  const added = await page.request.post("/api/cart/items", { data: {
    variantId: variant.id, branchId: branch.branchId, quantity: 1,
  } });
  expect(added.status()).toBe(200);
  const cart = await (await page.request.get("/api/cart")).json();
  const item = cart.data.items.find((i: { variantId: string; branchId: string }) => i.variantId === variant.id && i.branchId === branch.branchId);
  try {
    await page.goto("/cart");
    await expect(page.getByText("Ketersediaan stok dikonfirmasi dari Jubelio saat bayar.")).toBeVisible();
  } finally {
    if (item) await page.request.delete(`/api/cart/items/${item.id}`);
  }
});

test("Bayar Sekarang shows a clear provider-stock error and keeps the cart", async ({ page }) => {
  const catalog = await (await page.request.get("/api/products?limit=1")).json();
  const detail = await (await page.request.get(`/api/products/${catalog.data[0].slug}`)).json();
  const variant = detail.data.variants.find((v: { branchStock: unknown[] }) => v.branchStock.length);
  const branchId = variant.branchStock[0].branchId;
  const add = await page.request.post("/api/cart/items", { data: { variantId: variant.id, branchId, quantity: 1 } });
  expect(add.ok()).toBe(true);
  const cart = await (await page.request.get("/api/cart")).json();
  const item = cart.data.items.find((i: { variantId: string; branchId: string }) => i.variantId === variant.id && i.branchId === branchId);
  try {
    let providerUnavailable = false;
    await page.route("**/api/checkout/place-order", async (route) => {
      await route.fulfill({
        status: providerUnavailable ? 503 : 409,
        contentType: "application/json",
        body: JSON.stringify({ success: false, error: providerUnavailable
          ? "Stok Jubelio belum dapat diverifikasi. Silakan coba beberapa saat lagi."
          : "Stok produk di cabang ini tidak mencukupi. Silakan kurangi jumlah atau pilih barang lain." }),
      });
    });
    await page.goto("/cart");
    await page.getByRole("checkbox").first().check();
    await page.getByRole("button", { name: "Checkout" }).click();
    await page.waitForURL("**/checkout");
    await page.getByLabel("Nomor Telepon *").fill("081234567890");
    await page.getByLabel("Email *").fill("john@example.com");
    await page.getByRole("button", { name: "Lanjut" }).click();
    await page.getByLabel("Tanggal Pickup *").fill(nextOpenDate());
    await page.getByRole("combobox").click();
    await page.getByRole("option", { name: "10:00" }).click();
    await page.getByRole("button", { name: "Lanjut" }).click();
    await page.getByText(/Saya telah memeriksa pesanan/).click();
    await page.getByRole("button", { name: /Bayar Sekarang/ }).click();
    await expect(page.getByText(/Stok produk di cabang ini tidak mencukupi/)).toBeVisible();
    providerUnavailable = true;
    await page.getByRole("button", { name: /Bayar Sekarang/ }).click();
    await expect(page.getByText(/Stok Jubelio belum dapat diverifikasi/)).toBeVisible();
    const after = await (await page.request.get("/api/cart")).json();
    expect(after.data.items.some((i: { id: string }) => i.id === item.id)).toBe(true);
  } finally {
    if (item) await page.request.delete(`/api/cart/items/${item.id}`);
  }
});
