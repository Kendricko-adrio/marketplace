import { test, expect } from "@playwright/test";

// Admin analytics — the dashboard page is a placeholder, so the spec covers
// the metrics endpoint (GET /api/admin/analytics) and its invariants.

test.describe("admin analytics", () => {
  test("returns all dashboard metrics with consistent aggregates", async ({
    page,
  }) => {
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
