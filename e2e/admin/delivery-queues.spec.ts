import { test, expect } from "@playwright/test";

test("Orders defaults to delivery work, intersects stage with monitoring, and restores the list URL after detail", async ({ page }) => {
  await page.route("**/api/admin/orders?*", (route) => {
    const query = new URL(route.request().url()).searchParams;
    const empty = query.get("queue") === "monitoring" && query.get("stage") === "Siapkan barang";
    return route.fulfill({ json: { success: true, data: empty ? [] : [{ id: "queue-fixture", createdAt: "2026-01-01T00:00:00Z", fulfillmentMethod: "delivery", status: "processing", paymentStatus: "paid", customer: { name: "Queue Customer" }, branch: { name: "Bandung" }, stage: { label: "Siapkan barang", guidance: "Siapkan barang, lalu tandai siap.", terminal: false } }], pagination: { page: 1, total: empty ? 0 : 1, baseTotal: empty ? 0 : 1, totalPages: empty ? 0 : 1, limit: 20 } } });
  });
  await page.route("**/api/admin/orders/queue-fixture", (route) => route.fulfill({ json: { success: true, data: { id: "queue-fixture", status: "processing", paymentStatus: "paid", fulfillmentMethod: "delivery", createdAt: "2026-01-01T00:00:00Z", customer: { name: "Queue Customer", email: "fixture@example.test" }, items: [], stockOperations: [], subtotal: "100000", total: "133200", shippingCost: "20000", ppnRate: "11", ppnAmount: "13200", discount: "0", serviceFee: "0" } } }));
  await page.goto("/admin/orders");
  await expect(page.getByRole("tab", { name: "Delivery", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByLabel("Pekerjaan delivery")).toHaveValue("actionable");
  await expect(page.getByLabel("Tahap delivery")).toHaveValue("");
  await expect(page.getByLabel("Tanggal order dari")).toHaveValue("");
  await page.getByLabel("Tahap delivery").selectOption("Siapkan barang");
  await page.getByRole("link", { name: "Lihat detail", exact: true }).click();
  await page.getByRole("button", { name: "Back to Orders" }).click();
  await expect(page.getByLabel("Tahap delivery")).toHaveValue("Siapkan barang");
  await page.getByLabel("Pekerjaan delivery").selectOption("monitoring");
  await expect(page.getByText("Tidak ada pesanan yang cocok. Sesuaikan pekerjaan, tahap, pencarian atau tanggal.")).toBeVisible();
  await expect(page.getByLabel("Tahap delivery")).toHaveValue("Siapkan barang");
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
