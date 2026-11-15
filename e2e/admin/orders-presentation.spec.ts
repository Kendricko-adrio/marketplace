import { test, expect } from "@playwright/test";

// HTTP fixtures isolate presentation from the imported catalog/order dataset.
test("Orders uses the standard admin table styling without changing Pickup context", async ({ page }) => {
  await page.route("**/api/admin/products?*", (route) => route.fulfill({ json: {
    success: true, data: [{ id: "style-product", name: "Style Product", slug: "style-product", basePrice: "100000", status: "aktif", variants: [], variantCount: 0, totalStock: 0, totalReserved: 0, totalAvailable: 0, categories: [] }],
    pagination: { page: 1, totalPages: 1 },
  } }));
  await page.goto("/admin/products");
  const referenceHead = page.getByRole("columnheader", { name: "Nama Produk", exact: true });
  await expect(referenceHead).toBeVisible();
  const referenceStyle = await referenceHead.evaluate((element) => {
    const style = getComputedStyle(element);
    return { color: style.color, height: style.height, fontWeight: style.fontWeight };
  });
  const referenceRow = page.getByRole("table").locator("tbody tr").first();
  const referencePadding = await referenceRow.locator("td").first().evaluate((element) => getComputedStyle(element).padding);
  await referenceRow.hover();
  const referenceHover = await referenceRow.evaluate(async (element) => {
    getComputedStyle(element).backgroundColor;
    await Promise.all(element.getAnimations().map((animation) => animation.finished));
    return getComputedStyle(element).backgroundColor;
  });

  await page.route("**/api/admin/orders?*", (route) => route.fulfill({ json: {
    success: true, data: [{ id: "style-order", createdAt: "2026-05-01T00:00:00Z", status: "ready_for_pickup", paymentStatus: "paid", fulfillmentMethod: "pickup", customer: { name: "Style Customer" }, branch: { name: "Style Branch" } }],
    pagination: { page: 1, limit: 20, total: 1, baseTotal: 1, totalPages: 1 },
  } }));
  await page.goto("/admin/orders?tab=pickup&status=ready_for_pickup&search=style");
  const head = page.getByRole("columnheader", { name: "Referensi / tanggal", exact: true });
  await expect(head).toHaveCSS("color", referenceStyle.color);
  await expect(head).toHaveCSS("height", referenceStyle.height);
  await expect(head).toHaveCSS("font-weight", referenceStyle.fontWeight);
  const row = page.getByRole("table").locator("tbody tr").first();
  await expect(row.locator("td").first()).toHaveCSS("padding", referencePadding);
  await row.hover();
  await expect(row).toHaveCSS("background-color", referenceHover);
  await expect(page.getByRole("columnheader")).toHaveText(["Referensi / tanggal", "Customer", "Asal kirim", "Payment", "Status", "Langkah berikutnya", "Detail"]);
  await expect(page.getByRole("tab", { name: "Pickup", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByLabel("Status order")).toHaveValue("ready_for_pickup");
  await expect(page.getByLabel("Cari pesanan")).toHaveValue("style");
  await expect(page.getByRole("link", { name: "Verifikasi Pickup", exact: true })).toHaveAttribute("href", "/admin/orders/style-order?verify=1&returnTo=%2Fadmin%2Forders%3Ftab%3Dpickup%26status%3Dready_for_pickup%26search%3Dstyle");
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("Review Jubelio highlights only its own sidebar menu and ordinary order routes retain Pesanan", async ({ page }) => {
  await page.route("**/api/admin/orders?*", (route) => route.fulfill({ json: { success: true, data: [], pagination: { page: 1, limit: 20, total: 0, baseTotal: 0, totalPages: 0 } } }));
  await page.route("**/api/admin/reviews/sales-operations", (route) => route.fulfill({ json: { success: true, data: { operations: [], blockedOrders: [] } } }));
  await page.route(/\/api\/admin\/orders\/(?:sidebar-fixture|reviews-extra)$/, (route) => route.fulfill({ status: 404, json: { success: false, error: "Order not found" } }));
  await page.goto("/admin/orders");
  await expect(page.getByRole("heading", { name: "Orders", exact: true })).toBeVisible();
  const nav = page.getByRole("navigation");
  const orders = nav.getByRole("button", { name: "Pesanan", exact: true });
  const review = nav.getByRole("button", { name: "Review Jubelio", exact: true });
  const activeColor = await orders.evaluate((element) => getComputedStyle(element).backgroundColor);
  await nav.getByRole("link", { name: "Review Jubelio", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Antrean Review Jubelio", exact: true })).toBeVisible();
  await page.mouse.move(1000, 600);
  await expect(review).toHaveCSS("background-color", activeColor);
  await expect(orders).not.toHaveCSS("background-color", activeColor);
  await expect(nav.locator('a[aria-current="page"]')).toHaveCount(1);
  await expect(nav.locator('a[aria-current="page"]')).toHaveText("Review Jubelio");

  for (const pathname of ["/admin/orders", "/admin/orders/sidebar-fixture", "/admin/orders/reviews-extra"]) {
    await page.goto(pathname);
    await expect(orders).toHaveCSS("background-color", activeColor);
    await expect(review).not.toHaveCSS("background-color", activeColor);
    await expect(nav.locator('a[aria-current="page"]')).toHaveCount(1);
    await expect(nav.locator('a[aria-current="page"]')).toHaveText("Pesanan");
  }
});
