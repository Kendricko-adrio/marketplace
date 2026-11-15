import { test, expect } from "@playwright/test";

// Browser/HTTP boundary fixtures. Service/authorization effects are covered by
// the PostgreSQL suites; these fixtures only assert visible presentation.
const orderId = "workflow-browser-fixture";
const original = {
  id: orderId, status: "processing", paymentStatus: "paid", fulfillmentMethod: "delivery",
  createdAt: "2026-05-01T08:00:00Z", updatedAt: "2026-05-01T08:00:00Z",
  customer: { id: "fixture-customer", name: "Workflow Customer", email: "fixture@example.test" },
  branch: { id: "bdg", name: "Bandung", city: "Bandung", address: "Fixture street" },
  contactPhone: "0800000000", stockOperations: [], items: [],
  subtotal: "100000", shippingCost: "20000", discount: "0", serviceFee: "0", ppnRate: "11", ppnAmount: "13200", total: "133200",
};

test("delivery detail retains evidence and specific read-only reasons, then hides protected data when policy fails", async ({ page }) => {
  await page.route(`**/api/admin/orders/${orderId}`, (route) => route.fulfill({ json: {
    success: true,
    data: { ...original, fulfillmentMethod: "delivery", status: "processing", paymentStatus: "paid", shipment: { state: "booked", awb: "AWB-READONLY", latestStatus: "PICKED_UP" }, workflow: {
      stage: { label: "Dibawa kurir", guidance: "Barang dibawa kurir. Pantau pengiriman.", terminal: false },
      access: { known: true, allowed: false, reasons: ["Hanya dapat dilihat. Anda tidak memiliki izin mengubah order.", "Hanya dapat dilihat. Home Branch Anda: Jakarta. Cabang order: Bandung. Tindakan pemenuhan harus dilakukan oleh staff dengan Home Branch Bandung dan izin yang sesuai."] },
      eligibility: { known: true, eligible: false },
    } },
  } }));
  await page.goto(`/admin/orders/${orderId}`);
  const guidance = page.getByRole("region", { name: "Langkah berikutnya" });
  await expect(guidance).toContainText("Barang dibawa kurir. Pantau pengiriman.");
  await expect(guidance).toContainText("Anda tidak memiliki izin mengubah order.");
  await expect(guidance).toContainText("Home Branch Anda: Jakarta. Cabang order: Bandung.");
  await expect(page.getByText("AWB-READONLY", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /Catat serah|Perbarui tracking|Selesaikan manual|Pesan pengiriman/ })).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(guidance).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.route("**/api/admin/policy/me", (route) => route.abort());
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.getByTestId("safe-state")).toBeVisible();
  await expect(guidance).toHaveCount(0);
  await expect(page.getByText("AWB-READONLY", { exact: true })).toHaveCount(0);
});

test("unknown action eligibility provides only safe read reload, without guessing a Home Branch denial", async ({ page }) => {
  await page.route(`**/api/admin/orders/${orderId}`, (route) => route.fulfill({ json: { success: true, data: { ...original, fulfillmentMethod: "delivery", workflow: undefined } } }));
  await page.goto(`/admin/orders/${orderId}`);
  await expect(page.getByRole("region", { name: "Langkah berikutnya" })).toContainText("Kelayakan tindakan belum dapat dipastikan. Muat ulang detail sebelum melanjutkan.");
  await expect(page.getByText(/Home Branch Anda:/)).toHaveCount(0);
  await expect(page.getByRole("button", { name: /packing|Pesan pengiriman|Selesaikan manual/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Muat ulang detail" })).toBeVisible();
});

test("unknown eligibility suppresses tracking actions even when separate tracking hints are present", async ({ page }) => {
  await page.route(`**/api/admin/orders/${orderId}`, (route) => route.fulfill({ json: { success: true, data: {
    ...original, shipment: { state: "booked", awb: "AWB-UNKNOWN", latestStatus: "WAITING" },
    workflow: {
      stage: { label: "Menunggu penjemputan", guidance: "Tunggu kurir. Catat serah terima setelah barang diserahkan.", terminal: false },
      access: { known: true, allowed: true, reasons: [] }, eligibility: { known: false, eligible: false },
      tracking: { handoff: true, reconcile: true }, special: { failure: false, release: false, finish: true },
    },
  } } }));
  await page.goto(`/admin/orders/${orderId}`);
  await expect(page.getByRole("region", { name: "Langkah berikutnya" })).toContainText("Kelayakan tindakan belum dapat dipastikan. Muat ulang detail sebelum melanjutkan.");
  await expect(page.getByText("AWB-UNKNOWN", { exact: true })).toBeVisible();
  await page.getByText("Penanganan khusus", { exact: true }).click();
  await expect(page.getByRole("button", { name: /Catat serah terima|Perbarui tracking|Selesaikan manual|Pesan pengiriman/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Muat ulang detail" })).toBeVisible();
});
