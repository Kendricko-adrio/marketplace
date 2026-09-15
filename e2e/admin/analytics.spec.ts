import { test, expect, type Page } from "@playwright/test";
import { AUTH } from "../config";

// Admin analytics — the dashboard page is a placeholder, so the spec covers
// the metrics endpoint (GET /api/admin/analytics) and its invariants.
//
// Fixture note: the seeded Admin Role (admintoko) intentionally has NO
// analytics grant (deny-by-default — asserted in rbac-security). The metrics
// invariants below therefore run under the seeded HQ user, whose Role starts
// with analytics view-all.

async function loginAsHq(page: Page): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Email atau Username").fill("hqmanager");
  await page.getByLabel("Password").fill("hq123");
  await page.getByRole("button", { name: "Masuk", exact: true }).click();
  await page.waitForURL("**/admin/**");
}

test.describe("admin analytics", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("branch admin without the analytics grant is denied (deny-by-default)", async ({
    browser,
  }) => {
    // The shared saved session is admintoko (Admin Role): analytics is not
    // part of the seeded Admin grant set → 403.
    const context = await browser.newContext({
      storageState: AUTH.admin,
      baseURL: "http://localhost:3001",
    });
    const page = await context.newPage();
    const res = await page.request.get("/api/admin/analytics");
    expect(res.status()).toBe(403);
    await context.close();
  });

  test("HQ reads all dashboard metrics with consistent aggregates", async ({
    page,
  }) => {
    await loginAsHq(page);
    const res = await page.request.get("/api/admin/analytics");
    expect(res.status()).toBe(200);
    const { data } = await res.json();

    // All 7 metric fields present with correct types.
    expect(typeof data.totalRevenue).toBe("number");
    expect(typeof data.monthlyRevenue).toBe("number");
    expect(typeof data.totalOrders).toBe("number");
    expect(typeof data.weeklyOrders).toBe("number");
    expect(typeof data.totalCustomers).toBe("number");
    expect(Array.isArray(data.ordersByStatus)).toBe(true);
    expect(Array.isArray(data.recentOrders)).toBe(true);

    // ordersByStatus counts sum to totalOrders.
    const sum = data.ordersByStatus.reduce(
      (acc: number, row: { count: number }) => acc + row.count,
      0
    );
    expect(sum).toBe(data.totalOrders);

    // recentOrders: at most 5, newest first, with customer names.
    expect(data.recentOrders.length).toBeLessThanOrEqual(5);
    const times = data.recentOrders.map(
      (o: { createdAt: string }) => new Date(o.createdAt).getTime()
    );
    for (let i = 1; i < times.length; i++) {
      expect(times[i - 1]).toBeGreaterThanOrEqual(times[i]);
    }
    for (const order of data.recentOrders) {
      expect(typeof order.customer).toBe("string");
      expect(order.customer.length).toBeGreaterThan(0);
    }
  });

  test("revenue counts only paid orders", async ({ page }) => {
    await loginAsHq(page);
    const res = await page.request.get("/api/admin/analytics");
    const { data } = await res.json();

    // Cross-check against the orders list: sum of totals of paid orders must
    // equal totalRevenue (paid orders are terminal — no flakiness).
    const orders = await (
      await page.request.get("/api/admin/orders?limit=100")
    ).json();
    const paidTotal = orders.data
      .filter((o: { paymentStatus: string }) => o.paymentStatus === "paid")
      .reduce(
        (acc: number, o: { total: string }) => acc + parseFloat(o.total),
        0
      );
    expect(data.totalRevenue).toBe(paidTotal);
  });
});