import { expect, test, type Page } from "@playwright/test";
import { TEST_USERS } from "../config";

const message = "Product: jumlah diubah dari 10 menjadi 5 sesuai stok tersedia. Periksa kembali pesanan sebelum melanjutkan.";
const hours = Object.fromEntries(
  ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]
    .map((day) => [day, { open: "09:00", close: "17:00" }])
);

type StockOutcome = "adjusted" | "offline" | "unavailable" | "malformed";

// Fixture API saja; assertion uang memakai literal worked case, bukan helper ini.
function fixturePricing(subtotal: number, delivery = false) {
  const shippingCost = delivery ? 1000 : 0;
  const taxableBase = subtotal + shippingCost;
  const ppnAmount = Math.ceil(taxableBase * 0.11);
  return { subtotal: String(subtotal), discount: "0", shippingCost: String(shippingCost), serviceFee: "0",
    taxableBase: String(taxableBase), ppnRatePercent: "11", ppnAmount: String(ppnAmount), total: String(taxableBase + ppnAmount) };
}

async function setup(page: Page, contractVersion: 0 | 1 = 0, options: { zero?: boolean; other?: boolean } = {}) {
  if (process.env.E2E_PROVIDER_MOCKS !== "true" ||
      !/^marketplace_discounts_test_/.test(new URL(process.env.DATABASE_URL ?? "http://invalid").pathname.slice(1))) {
    throw new Error("Stock adjustment requires isolated mock config and disposable DB");
  }
  const signIn = await page.request.post("/api/auth/sign-in/email", { data: TEST_USERS.store });
  expect(signIn.ok()).toBe(true);
  const ids = options.other ? ["item", "other"] : ["item"];
  await page.addInitScript((selection) => {
    if (!sessionStorage.getItem("checkoutSelectedItemIds")) {
      sessionStorage.setItem("checkoutSelectedItemIds", JSON.stringify(selection));
    }
  }, ids);
  let quantity = 10;
  let submissions = 0;
  const submittedBodies: Record<string, unknown>[] = [];
  const previews: Record<string, unknown>[] = [];
  const lookups: string[] = [];
  const quotes: Record<string, unknown>[] = [];
  let outcome: StockOutcome = "adjusted";
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    let body: unknown = { success: true, data: [] };
    let status = 200;
    if (path === "/api/auth/get-session") body = {
      user: { id: "client", name: "Customer", email: "test@example.invalid", phone: "081234567890", onboardingCompleted: true },
      session: { id: "session", expiresAt: "2045-01-01T00:00:00Z" },
    };
    if (path === "/api/cart") body = { success: true, data: {
      id: "cart", pricingContractVersion: contractVersion, ppnRatePercent: 11, itemCount: ids.length,
      subtotal: quantity * 1000 + (options.other ? 2000 : 0),
      items: ids.map((id) => ({ id, quantity: id === "item" ? quantity : 2,
        variantId: id, branchId: "branch", available: 20,
        variant: { id, color: null, size: null, price: "1000" },
        product: { id, name: id === "item" ? "Product" : "Other", slug: id }, image: null,
        branch: { id: "branch", name: "Branch", city: "Test" } })),
    } };
    if (path === "/api/branches/branch") body = { success: true, data: {
      id: "branch", name: "Branch", city: "Test", address: "Address", operatingHours: hours,
    } };
    if (path === "/api/checkout/validate-step-2") body = { success: true };
    if (path === "/api/discounts/available") body = { success: true, data: {
      items: [], selectedOffer: null, selectedOfferUnavailable: false, page: 1, totalPages: 1, total: 0,
    } };
    if (path === "/api/addresses") body = { success: true, data: [{ id: "address", recipientName: "Customer",
      phone: "081234567890", fullAddress: "Test Address", postalCode: "10110",
      provinceId: "1", cityId: "2", districtId: "3", areaId: "4", isDefault: true }] };
    if (path === "/api/checkout/delivery-quote") {
      quotes.push(route.request().postDataJSON());
      body = { success: true, data: { services: [{ courierId: 1, serviceId: 1, serviceCategoryId: 1,
        name: "Fixture Courier", shippingCost: 1000, originFingerprint: "a".repeat(64),
        pricing: fixturePricing(quantity * 1000, true) }] } };
    }
    if (path === "/api/checkout/preview") {
      const input = route.request().postDataJSON();
      previews.push(input);
      const selected: string[] = input.selectedItemIds ?? input.itemIds;
      const subtotal = (selected.includes("item") ? quantity * 1000 : 0) + (selected.includes("other") ? 2000 : 0);
      const pricing = fixturePricing(subtotal, input.fulfillmentMethod === "delivery");
      body = { success: true, data: {
        reviewToken: `stock-review-${previews.length}`, expiresAt: "2045-01-01T00:00:00Z",
        contextFingerprint: "a".repeat(64), promo: { kind: "none" }, pricing,
        ...(input.fulfillmentMethod === "delivery" ? { deliveryService: {
          courierId: 1, serviceId: 1, name: "Fixture Courier", shippingCost: 1000,
          originFingerprint: "a".repeat(64), pricing,
        } } : {}),
      } };
    }
    if (path.startsWith("/api/checkout/requests/")) {
      lookups.push(path);
      status = 404;
      body = { success: false, code: "NOT_FOUND" };
    }
    if (path === "/api/checkout/place-order") {
      submissions++;
      submittedBodies.push(route.request().postDataJSON());
      if (outcome === "offline") { await route.abort("connectionreset"); return; }
      if (outcome === "unavailable") {
        status = 503;
        body = { success: false, error: "Stok Jubelio belum dapat diverifikasi. Silakan coba beberapa saat lagi." };
      } else if (outcome === "malformed") {
        status = 409;
        body = { success: false, code: "CHECKOUT_STOCK_ADJUSTED", error: "Respons penyesuaian stok tidak lengkap." };
      } else {
        if (!options.zero) quantity = 5;
        status = 409;
        body = { success: false, code: "CHECKOUT_STOCK_ADJUSTED",
          error: options.zero ? "Product: stok habis, dikeluarkan dari checkout tetapi tetap di keranjang." : message,
          adjustments: [{ cartItemId: "item", productName: "Product", requestedQuantity: 10, availableQuantity: options.zero ? 0 : 5 }] };
      }
    }
    await route.fulfill({ status, json: body });
  });
  return { submissions: () => submissions, submittedBodies, previews, lookups, quotes,
    setOutcome: (value: StockOutcome) => { outcome = value; } };
}

async function reviewPickup(page: Page) {
  await page.getByLabel("Tanggal Pickup *").fill("2040-01-03");
  await page.getByRole("combobox").click();
  await page.getByRole("option", { name: "10:00", exact: true }).click();
  await page.getByLabel("Nomor Telepon *").fill("081234567890");
  await page.getByLabel("Email *", { exact: true }).fill("test@example.invalid");
  await page.getByRole("button", { name: "Lanjut", exact: true }).click();
}

for (const scenario of ["offline", "unavailable", "malformed"] as const) {
  test(`v1 preserves the same request key for recovery after ${scenario}`, async ({ page }) => {
    const fixture = await setup(page, 1);
    fixture.setOutcome(scenario);
    await page.goto("/checkout");
    await reviewPickup(page);
    await page.getByRole("checkbox", { name: /Saya telah memeriksa/ }).check();
    await page.getByRole("button", { name: /Bayar Sekarang/ }).click();
    const error = scenario === "offline" ? "Koneksi terputus. Periksa status pesanan sebelum mencoba lagi."
      : scenario === "unavailable" ? "Stok Jubelio belum dapat diverifikasi. Silakan coba beberapa saat lagi."
        : "Respons penyesuaian stok tidak lengkap.";
    await expect(page.getByText(error, { exact: true })).toBeVisible();
    await expect(page.getByText("Rp 11.100", { exact: true })).toBeVisible();
    await expect(page.getByText(/Qty 10$/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Periksa ulang pesanan", exact: true })).toHaveCount(0);
    const first = fixture.submittedBodies[0];
    expect(first).toMatchObject({ reviewToken: "stock-review-1" });
    const stored = await page.evaluate(() => JSON.parse(sessionStorage.getItem("checkoutRequest:client") ?? "null"));
    expect(stored).toMatchObject({ requestKey: first.requestKey, body: first });

    fixture.setOutcome("adjusted");
    await page.getByRole("button", { name: /Bayar Sekarang/ }).click();
    await expect(page.getByRole("alert").filter({ hasText: message })).toBeVisible();
    expect(fixture.lookups).toEqual([`/api/checkout/requests/${first.requestKey}`]);
    expect(fixture.submittedBodies).toEqual([first, first]);
    expect(fixture.previews).toHaveLength(1);
    await expect.poll(() => page.evaluate(() => sessionStorage.getItem("checkoutRequest:client"))).toBeNull();
    await expect(page.getByRole("button", { name: "Periksa ulang pesanan", exact: true })).toBeVisible();
  });
}

test("v1 excludes zero stock from the new review without deleting the cart item", async ({ page }) => {
  const fixture = await setup(page, 1, { zero: true, other: true });
  await page.goto("/checkout");
  await reviewPickup(page);
  await expect(page.getByText("Rp 13.320", { exact: true })).toBeVisible();
  await page.getByRole("checkbox", { name: /Saya telah memeriksa/ }).check();
  await page.getByRole("button", { name: /Bayar Sekarang/ }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Product: stok habis" })).toBeVisible();
  await expect(page.getByText("Rp 2.220", { exact: true })).toBeVisible();
  await expect(page.getByText(/Qty 10$/)).toHaveCount(0);
  await expect(page.getByText(/Qty 2$/)).toBeVisible();
  await page.getByRole("button", { name: "Periksa ulang pesanan", exact: true }).click();
  await page.getByRole("checkbox", { name: /Saya telah memeriksa/ }).check();
  await page.getByRole("button", { name: /Bayar Sekarang/ }).click();
  await expect.poll(() => fixture.submittedBodies.length).toBe(2);
  expect(fixture.previews[1]).toMatchObject({ selectedItemIds: ["other"] });
  expect(fixture.submittedBodies[1]).toMatchObject({ selectedItemIds: ["other"], reviewToken: "stock-review-2" });
  expect(fixture.submittedBodies[1].requestKey).not.toBe(fixture.submittedBodies[0].requestKey);
  await page.goto("/cart");
  await expect(page.getByRole("link", { name: "Product", exact: true })).toBeVisible();
});

test("v1 returns to cart when all selected stock is zero and retires the pending key", async ({ page }) => {
  const fixture = await setup(page, 1, { zero: true });
  await page.goto("/checkout");
  await reviewPickup(page);
  await page.getByRole("checkbox", { name: /Saya telah memeriksa/ }).check();
  await page.getByRole("button", { name: /Bayar Sekarang/ }).click();
  await expect(page).toHaveURL(/\/cart$/);
  await expect(page.getByRole("link", { name: "Product", exact: true })).toBeVisible();
  expect(await page.evaluate(() => sessionStorage.getItem("checkoutSelectedItemIds"))).toBe("[]");
  expect(await page.evaluate(() => sessionStorage.getItem("checkoutRequest:client"))).toBeNull();
  expect(fixture.submittedBodies).toHaveLength(1);
  expect(fixture.previews).toHaveLength(1);
});

test("v1 delivery discards old approval and requires a fresh quote and review", async ({ page }, testInfo) => {
  const fixture = await setup(page, 1);
  await page.goto("/checkout");
  await page.getByRole("button", { name: /Kirim ke alamat/ }).click();
  await page.getByText("Fixture Courier", { exact: true }).click();
  await page.getByRole("button", { name: "Lanjut", exact: true }).click();
  await expect(page.getByText("Rp 12.210", { exact: true })).toBeVisible();
  await page.getByRole("checkbox", { name: /Saya telah memeriksa/ }).check();
  await page.getByRole("button", { name: /Bayar Sekarang/ }).click();
  await expect(page.getByRole("alert").filter({ hasText: message })).toBeVisible();
  await expect(page.getByLabel("Alamat Pengiriman")).toBeVisible();
  await expect.poll(() => fixture.quotes.length).toBeGreaterThanOrEqual(2);
  await expect(page.getByRole("button", { name: "Lanjut", exact: true })).toBeDisabled();
  expect(fixture.previews).toHaveLength(1);
  expect(fixture.submittedBodies).toHaveLength(1);
  expect(await page.evaluate(() => sessionStorage.getItem("checkoutRequest:client"))).toBeNull();
  await page.screenshot({ path: testInfo.outputPath("delivery-stock-adjustment.png"), fullPage: true });
  await page.getByText("Fixture Courier", { exact: true }).click();
  await page.getByRole("button", { name: "Lanjut", exact: true }).click();
  await expect(page.getByText("Rp 6.660", { exact: true })).toBeVisible();
  await expect(page.getByRole("checkbox", { name: /Saya telah memeriksa/ })).not.toBeChecked();
  await page.getByRole("checkbox", { name: /Saya telah memeriksa/ }).check();
  await page.getByRole("button", { name: /Bayar Sekarang/ }).click();
  await expect.poll(() => fixture.submittedBodies.length).toBe(2);
  expect(fixture.previews[1]).toMatchObject({ fulfillmentMethod: "delivery", itemIds: ["item"], addressId: "address" });
  expect(fixture.submittedBodies[1]).toMatchObject({ reviewToken: "stock-review-2", approvedPricing: { total: "6660" } });
  expect(fixture.submittedBodies[1].requestKey).not.toBe(fixture.submittedBodies[0].requestKey);
});

for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
  test(`v1 stock adjustment retires the old review and request key at ${viewport.width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    const fixture = await setup(page, 1);
    await page.goto("/checkout");
    await reviewPickup(page);
    await expect(page.getByText("Rp 11.100", { exact: true })).toBeVisible();
    await page.getByRole("checkbox", { name: /Saya telah memeriksa/ }).check();
    await page.getByRole("button", { name: /Bayar Sekarang/ }).click();

    await expect(page.getByRole("alert").filter({ hasText: message })).toBeVisible();
    await expect(page.getByText("Rp 5.550", { exact: true })).toBeVisible();
    await expect(page.getByRole("checkbox", { name: /Saya telah memeriksa/ })).not.toBeChecked();
    await expect(page.getByRole("button", { name: /Bayar Sekarang/ })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Periksa ulang pesanan", exact: true })).toBeVisible();
    expect(fixture.submittedBodies).toHaveLength(1);
    expect(fixture.previews).toHaveLength(1);
    await expect.poll(() => page.evaluate(() => sessionStorage.getItem("checkoutRequest:client"))).toBeNull();
    await page.screenshot({ path: testInfo.outputPath("pickup-stock-adjustment.png"), fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    // A checkbox alone must not authorize the stale reviewed total/token.
    await page.getByRole("checkbox", { name: /Saya telah memeriksa/ }).check();
    await expect(page.getByRole("button", { name: /Bayar Sekarang/ })).toBeDisabled();

    await page.getByRole("button", { name: "Periksa ulang pesanan", exact: true }).click();
    await expect(page.getByRole("button", { name: "Periksa ulang pesanan", exact: true })).toHaveCount(0);
    await expect(page.getByRole("checkbox", { name: /Saya telah memeriksa/ })).not.toBeChecked();
    expect(fixture.previews).toHaveLength(2);
    await page.getByRole("checkbox", { name: /Saya telah memeriksa/ }).check();
    await page.getByRole("button", { name: /Bayar Sekarang/ }).click();
    await expect.poll(() => fixture.submittedBodies.length).toBe(2);
    expect(fixture.submittedBodies[0]).toMatchObject({ reviewToken: "stock-review-1", promoSelection: { kind: "none" } });
    expect(fixture.submittedBodies[1]).toMatchObject({ reviewToken: "stock-review-2", selectedItemIds: ["item"] });
    expect(fixture.submittedBodies[1].requestKey).not.toBe(fixture.submittedBodies[0].requestKey);
    expect(fixture.lookups).toEqual([]);
  });

  test(`checkout renders and requires fresh approval after stock adjustment at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const fixture = await setup(page);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto("/checkout");
    await expect(page.getByRole("heading", { name: "Checkout", exact: true })).toBeVisible();
    await page.getByLabel("Tanggal Pickup *").fill("2040-01-03");
    await page.getByRole("combobox").click();
    await page.getByRole("option", { name: "10:00", exact: true }).click();
    await page.getByLabel("Nomor Telepon *").fill("081234567890");
    await page.getByLabel("Email *", { exact: true }).fill("test@example.invalid");
    await page.getByRole("button", { name: "Lanjut", exact: true }).click();
    await page.getByRole("checkbox", { name: /Saya telah memeriksa/ }).check();
    await page.getByRole("button", { name: /Bayar Sekarang/ }).click();
    await expect(page.getByRole("alert").filter({ hasText: message })).toBeVisible();
    const review = page.getByRole("heading", { name: "Pembayaran", exact: true }).locator("..");
    await expect(review.getByText(/Qty 5$/)).toBeVisible();
    await expect(page.getByText("Rp 5.550", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: /Bayar Sekarang/ })).toBeDisabled();
    expect(fixture.submissions()).toBe(1);
    await page.getByRole("checkbox", { name: /Saya telah memeriksa/ }).check();
    await expect(page.getByRole("button", { name: /Bayar Sekarang/ })).toBeEnabled();
    expect(errors).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}
