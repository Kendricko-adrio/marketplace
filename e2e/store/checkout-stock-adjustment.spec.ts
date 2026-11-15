import { expect, test, type Page } from "@playwright/test";

// Uses the normal authenticated store fixture (PostgreSQL + seeded client are
// required by the server-side checkout layout). Browser stock/payment/quote
// APIs are stubbed: this spec never sends a Jubelio or payment request.
const message = "Product: jumlah diubah dari 10 menjadi 5 sesuai stok tersedia. Periksa kembali pesanan sebelum melanjutkan.";
const zeroMessage = "Product: stok habis, dikeluarkan dari checkout tetapi tetap di keranjang.";
const unavailableMessage = "Stok Jubelio belum dapat diverifikasi. Silakan coba beberapa saat lagi.";
const hours = Object.fromEntries(["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"].map(day => [day, { open: "09:00", close: "17:00" }]));

async function setup(page: Page, options: { zero?: boolean; other?: boolean; unavailable?: boolean; fromCart?: boolean } = {}) {
  const ids = options.other ? ["item", "other"] : ["item"];
  await page.addInitScript((selection) => {
    if (!sessionStorage.getItem("checkoutSelectedItemIds")) sessionStorage.setItem("checkoutSelectedItemIds", JSON.stringify(selection));
  }, ids);
  let quantity = options.fromCart ? 31 : 10;
  const submissions: Record<string, unknown>[] = [];
  let quotes = 0;
  await page.route("**/api/**", async route => {
    const path = new URL(route.request().url()).pathname;
    let body: unknown = { success: true, data: [] };
    let status = 200;
    if (path === "/api/auth/get-session") body = { user: { id: "client", name: "Customer", email: "test@example.invalid", phone: "081234567890", onboardingCompleted: true }, session: { id: "session", expiresAt: "2035-01-01T00:00:00Z" } };
    if (path === "/api/cart") body = { success: true, data: { id: "cart", ppnRatePercent: 11, itemCount: ids.length, subtotal: (quantity + (options.other ? 2 : 0)) * 1000, items: ids.map(id => ({ id, quantity: id === "item" ? quantity : 2, variantId: id, branchId: "branch", variant: { id, color: null, size: null, price: "1000" }, product: { id, name: id === "item" ? "Product" : "Other" }, image: null, branch: { id: "branch", name: "Branch", city: "Test" } })) } };
    if (path === "/api/branches/branch") body = { success: true, data: { id: "branch", name: "Branch", city: "Test", address: "Address", operatingHours: hours } };
    if (path === "/api/checkout/validate-step-2") body = { success: true };
    if (path === "/api/addresses") body = { success: true, data: [{ id: "address", recipientName: "Customer", phone: "081234567890", fullAddress: "Test Address", postalCode: "10110", provinceId: "1", cityId: "2", districtId: "3", areaId: "4", isDefault: true }] };
    if (path === "/api/checkout/delivery-quote") {
      quotes++;
      body = { success: true, data: { services: [{ courierId: 1, serviceId: 1, serviceCategoryId: 1, name: "Fixture Courier", shippingCost: 1000, originFingerprint: "a".repeat(64), pricing: {
        subtotal: quantity === 10 ? "10000.00" : "5000.00", discount: "0.00", shippingCost: "1000.00", serviceFee: "0.00", ppnRatePercent: "11", ppnAmount: quantity === 10 ? "1210.00" : "660.00", total: quantity === 10 ? "12210.00" : "6660.00",
      } }] } };
    }
    if (path === "/api/cart/validate-checkout") {
      if (options.unavailable) {
        status = 503; body = { success: false, error: unavailableMessage };
      } else if (quantity > 20 || options.zero) {
        const requestedQuantity = quantity;
        if (!options.zero) quantity = 20;
        status = 409;
        body = { success: false, code: "CHECKOUT_STOCK_ADJUSTED", adjustments: [{ cartItemId: "item", productName: "Product", requestedQuantity, availableQuantity: options.zero ? 0 : 20 }] };
      } else body = { success: true };
    }
    if (path === "/api/checkout/place-order") {
      submissions.push(route.request().postDataJSON());
      if (options.unavailable) {
        status = 503; body = { success: false, error: unavailableMessage };
      } else {
        status = 409;
        if (!options.zero) quantity = 5;
        body = { success: false, code: "CHECKOUT_STOCK_ADJUSTED", error: options.zero ? zeroMessage : message, adjustments: [{ cartItemId: "item", productName: "Product", requestedQuantity: 10, availableQuantity: options.zero ? 0 : 5 }] };
      }
    }
    await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
  });
  await page.goto(options.fromCart ? "/cart" : "/checkout");
  return { submissions, quotes: () => quotes };
}
async function reviewContact(page: Page) {
  await page.getByRole("button", { name: "Lanjut", exact: true }).click();
  await page.getByLabel("Nomor Telepon *").fill("081234567890");
  await page.getByLabel("Email *").fill("test@example.invalid");
  await page.getByRole("button", { name: "Lanjut", exact: true }).click();
  await page.getByRole("checkbox", { name: /Saya telah memeriksa/ }).check();
}
async function reviewPickup(page: Page) {
  await page.getByLabel("Tanggal Pickup *").fill("2030-01-01");
  await page.getByRole("combobox").click();
  await page.getByRole("option", { name: "10:00", exact: true }).click();
  await reviewContact(page);
}

test("cart Checkout refuses 31 units, saves 20, recalculates the selected total, and waits for a second click", async ({ page }) => {
  await setup(page, { fromCart: true });
  await page.getByRole("checkbox").first().check();
  await page.getByRole("button", { name: "Checkout", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Stok barang tidak mencukupi" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("(sisa 20)", { exact: true })).toBeVisible();
  await expect(page).toHaveURL(/\/cart$/);
  await expect(page.getByText("Product ×20", { exact: true })).toBeVisible();
  await expect(page.getByText("Rp 22.200", { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "Mengerti", exact: true }).click();
  await page.getByRole("button", { name: "Checkout", exact: true }).click();
  await expect(page).toHaveURL(/\/checkout$/);
  await expect(page.getByText("Product ×20", { exact: true }).first()).toBeVisible();
});

test("cart Checkout leaves a zero-stock item in cart but deselects it while keeping other items selected", async ({ page }) => {
  await setup(page, { fromCart: true, zero: true, other: true });
  await page.getByRole("checkbox").first().check();
  await page.getByRole("button", { name: "Checkout", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Stok barang tidak mencukupi" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText(/tetap di keranjang Anda/)).toBeVisible();
  await dialog.getByRole("button", { name: "Mengerti", exact: true }).click();
  await expect(page).toHaveURL(/\/cart$/);
  await expect(page.getByRole("link", { name: "Product", exact: true })).toBeVisible();
  await expect(page.getByRole("checkbox").nth(1)).not.toBeChecked();
  await expect(page.getByRole("checkbox").nth(2)).toBeChecked();
  await expect(page.getByText("Other ×2", { exact: true })).toBeVisible();
});

test("cart Checkout fails closed on provider failure and leaves quantity 31 untouched", async ({ page }) => {
  await setup(page, { fromCart: true, unavailable: true });
  await page.getByRole("checkbox").first().check();
  await page.getByRole("button", { name: "Checkout", exact: true }).click();
  await expect(page.getByText(unavailableMessage, { exact: true })).toBeVisible();
  await expect(page).toHaveURL(/\/cart$/);
  await expect(page.getByText("Product ×31", { exact: true })).toBeVisible();
});

test("insufficient stock updates checkout from 10 to 5, recalculates total, and requires fresh approval", async ({ page }) => {
  const fixture = await setup(page);
  await reviewPickup(page);
  await page.getByRole("button", { name: /Bayar Sekarang/ }).click();
  await expect(page.getByRole("alert").filter({ hasText: message })).toBeVisible();
  const review = page.getByRole("heading", { name: "Pembayaran", exact: true }).locator("..");
  await expect(review.getByText(/Qty 5$/)).toBeVisible();
  await expect(review.getByText("Rp 5.550", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /Bayar Sekarang/ })).toBeDisabled();
  expect(fixture.submissions).toHaveLength(1);
  await page.getByRole("checkbox", { name: /Saya telah memeriksa/ }).check();
  await expect(page.getByRole("button", { name: /Bayar Sekarang/ })).toBeEnabled();
});

test("zero stock excludes only the unavailable item from the next checkout submission", async ({ page }) => {
  const fixture = await setup(page, { zero: true, other: true });
  await reviewPickup(page);
  await page.getByRole("button", { name: /Bayar Sekarang/ }).click();
  await expect(page.getByRole("alert").filter({ hasText: zeroMessage })).toBeVisible();
  await expect(page.getByText("Product ×10", { exact: true })).toHaveCount(0);
  const review = page.getByRole("heading", { name: "Pembayaran", exact: true }).locator("..");
  await expect(review.getByText("Other", { exact: true })).toBeVisible();
  await expect(review.getByText(/Qty 2$/)).toBeVisible();
  await expect(page.getByRole("button", { name: /Bayar Sekarang/ })).toBeDisabled();
  await page.getByRole("checkbox", { name: /Saya telah memeriksa/ }).check();
  await page.getByRole("button", { name: /Bayar Sekarang/ }).click();
  await expect.poll(() => fixture.submissions.length).toBe(2);
  expect(fixture.submissions[1].selectedItemIds).toEqual(["other"]);
});

test("when all selected stock is zero, returns to cart without deleting the item", async ({ page }) => {
  await setup(page, { zero: true });
  await reviewPickup(page);
  await page.getByRole("button", { name: /Bayar Sekarang/ }).click();
  await expect(page).toHaveURL(/\/cart$/);
  await expect(page.getByText("Product", { exact: true })).toBeVisible();
});

test("unverified stock shows an error without changing quantity or retrying automatically", async ({ page }) => {
  const fixture = await setup(page, { unavailable: true });
  await reviewPickup(page);
  await page.getByRole("button", { name: /Bayar Sekarang/ }).click();
  await expect(page.getByText(unavailableMessage, { exact: true })).toBeVisible();
  const review = page.getByRole("heading", { name: "Pembayaran", exact: true }).locator("..");
  await expect(review.getByText(/Qty 10$/)).toBeVisible();
  expect(fixture.submissions).toHaveLength(1);
});

test("delivery quantity adjustment discards the old approval and requotes before customer reselects", async ({ page }) => {
  const fixture = await setup(page);
  await page.getByText("Kirim ke alamat", { exact: true }).click();
  await page.getByText("Fixture Courier", { exact: true }).click();
  await reviewContact(page);
  await page.getByRole("button", { name: /Bayar Sekarang/ }).click();
  await expect(page.getByRole("alert").filter({ hasText: message })).toBeVisible();
  await expect(page.getByLabel("Alamat Pengiriman")).toBeVisible();
  await expect.poll(fixture.quotes).toBeGreaterThanOrEqual(2);
  await expect(page.getByRole("button", { name: "Lanjut", exact: true })).toBeDisabled();
  expect(fixture.submissions).toHaveLength(1);
  await page.getByText("Fixture Courier", { exact: true }).click();
  await reviewContact(page);
  const review = page.getByRole("heading", { name: "Pembayaran", exact: true }).locator("..");
  await expect(review.getByText(/Qty 5$/)).toBeVisible();
  await expect(review.getByText("Rp 6.660", { exact: true })).toBeVisible();
});
