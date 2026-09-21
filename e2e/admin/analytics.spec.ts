import { test, expect, type Page } from "@playwright/test";
import { AUTH } from "../config";
import { Pool } from "pg";
import { randomUUID } from "crypto";
import dotenv from "dotenv";

// The test process reads the DB directly for fixtures — load DATABASE_URL
// like rbac-security.spec.ts does (the webServer env does not reach here).
dotenv.config({ path: ".env" });

// Admin analytics — the endpoint (GET /api/admin/analytics), the dashboard
// page built on it, and the RBAC that gates both.
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

    // All original metric fields present with correct types.
    expect(typeof data.totalRevenue).toBe("number");
    expect(typeof data.monthlyRevenue).toBe("number");
    expect(typeof data.totalOrders).toBe("number");
    expect(typeof data.weeklyOrders).toBe("number");
    expect(typeof data.totalCustomers).toBe("number");
    expect(Array.isArray(data.ordersByStatus)).toBe(true);
    expect(Array.isArray(data.recentOrders)).toBe(true);

    // Additive fields: averageOrderValue + 30-day trend.
    expect(typeof data.averageOrderValue).toBe("number");
    expect(data.averageOrderValue).toBeGreaterThanOrEqual(0);
    expect(Array.isArray(data.trend)).toBe(true);
    expect(data.trend).toHaveLength(30);
    for (const point of data.trend) {
      expect(typeof point.date).toBe("string");
      expect(point.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(typeof point.revenue).toBe("number");
      expect(typeof point.orders).toBe("number");
    }

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

  test("revenue counts only paid, non-cancelled orders", async ({ page }) => {
    await loginAsHq(page);
    const res = await page.request.get("/api/admin/analytics");
    const { data } = await res.json();

    // Cross-check against the orders list: sum of totals of paid orders that
    // are NOT cancelled must equal totalRevenue (the revenue condition is
    // paymentStatus = 'paid' AND status <> 'cancelled').
    const orders = await (
      await page.request.get("/api/admin/orders?limit=100")
    ).json();
    const qualifyingTotal = orders.data
      .filter(
        (o: { paymentStatus: string; status: string }) =>
          o.paymentStatus === "paid" && o.status !== "cancelled"
      )
      .reduce(
        (acc: number, o: { total: string }) => acc + parseFloat(o.total),
        0
      );
    expect(data.totalRevenue).toBe(qualifyingTotal);
  });

  // =========================================================
  // RBAC: the server layout is the authority for the page (deny-by-default).
  // The shared saved session is admintoko (Admin Role, no analytics grant) —
  // direct navigation must redirect, and the sidebar must not offer the link.
  // =========================================================
  test("branch admin without the grant is redirected from /admin/analytics and sees no sidebar link", async ({
    browser,
  }) => {
    const context = await browser.newContext({
      storageState: AUTH.admin,
      baseURL: "http://localhost:3001",
    });
    const page = await context.newPage();
    await page.goto("/admin/analytics");
    await expect(page).toHaveURL(/\/admin\/no-access/);

    // The sidebar hides the Analitik link without the grant.
    await page.goto("/admin/orders");
    const sidebar = page.locator("aside");
    await expect(
      sidebar.getByRole("link", { name: "Analitik", exact: true })
    ).toHaveCount(0);
    await context.close();
  });

  test("HQ sees the Analitik sidebar link and the dashboard page renders", async ({
    page,
  }) => {
    await loginAsHq(page);
    const sidebar = page.locator("aside");
    const link = sidebar.getByRole("link", { name: "Analitik", exact: true });
    await expect(link).toBeVisible();
    await link.click();
    await expect(page).toHaveURL(/\/admin\/analytics/);
    // The page heading renders (server shell) — content asserted below.
    await expect(
      page.getByRole("heading", { name: "Analitik" })
    ).toBeVisible();
  });
});

// =========================================================
// Dashboard UI: the analytics page client-fetches the endpoint with a
// skeleton, error + retry, and NO polling; renders KPI cards, the Recharts
// revenue trend (with an accessible fallback table), and recent orders.
// =========================================================
test.describe("admin analytics — dashboard UI", () => {
  test.describe.configure({ mode: "default" });
  test.use({ storageState: { cookies: [], origins: [] } });

  test("delayed API shows the skeleton, then KPIs, chart SVG, trend table, and recent order links", async ({
    page,
  }) => {
    await page.route("**/api/admin/analytics", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      await route.continue();
    });
    await loginAsHq(page);
    await page.goto("/admin/analytics");

    // While the fetch is in flight: skeleton.
    await expect(page.getByTestId("analytics-skeleton")).toBeVisible();

    // Data arrives: skeleton gone, KPI labels visible.
    await expect(page.getByTestId("analytics-skeleton")).toHaveCount(0);
    await expect(page.getByTestId("analytics-dashboard")).toBeVisible();
    await expect(page.getByText("Total Pendapatan")).toBeVisible();
    await expect(page.getByText("Pesanan 7 Hari")).toBeVisible();
    await expect(page.getByText("Rata-rata Nilai Pesanan")).toBeVisible();

    // The Recharts chart renders a real SVG surface.
    await expect(
      page.locator('[data-testid="analytics-dashboard"] svg.recharts-surface')
    ).toBeVisible();

    // Accessible 30-row fallback table for the trend.
    const trendRows = page
      .getByTestId("analytics-trend-table")
      .locator("tbody tr");
    await expect(trendRows).toHaveCount(30);

    // Recent orders render as anchors into the orders module.
    const recentLink = page
      .locator('[data-testid="analytics-dashboard"] a[href^="/admin/orders/"]')
      .first();
    await expect(recentLink).toBeVisible();
    const href = await recentLink.getAttribute("href");
    expect(href).toMatch(/^\/admin\/orders\/[A-Za-z0-9-]+$/);
  });

  test("API failure shows the error state; Coba Lagi retries and recovers", async ({
    page,
  }) => {
    let failed = false;
    await page.route("**/api/admin/analytics", async (route) => {
      if (!failed) {
        failed = true;
        return route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({
            success: false,
            error: "Failed to fetch analytics",
          }),
        });
      }
      return route.continue();
    });

    await loginAsHq(page);
    await page.goto("/admin/analytics");

    await expect(page.getByTestId("analytics-error")).toBeVisible();
    const retry = page.getByTestId("analytics-retry");
    await expect(retry).toBeVisible();
    await expect(retry).toHaveText("Coba Lagi");

    await retry.click();
    await expect(page.getByTestId("analytics-error")).toHaveCount(0);
    await expect(page.getByTestId("analytics-dashboard")).toBeVisible();
  });

  test("fetches exactly once on mount with no polling", async ({ page }) => {
    let requestCount = 0;
    await page.route("**/api/admin/analytics", async (route) => {
      requestCount += 1;
      await route.continue();
    });

    await loginAsHq(page);
    await page.goto("/admin/analytics");
    await expect(page.getByTestId("analytics-dashboard")).toBeVisible();

    // Long enough for any poll interval to have fired at least twice.
    await page.waitForTimeout(2500);
    expect(requestCount).toBe(1);
  });
});

// =========================================================
// 30-day WIB trend + revenue semantics against the real DB.
//
// The fixture (a paid+cancelled order) proves the revenue condition excludes
// it everywhere while it still counts as an order. The "stable probe" pattern
// re-reads the DB around each API call and retries until the DB reading is
// unchanged, so concurrent order writes from other specs cannot flake the
// comparison.
// =========================================================
test.describe("admin analytics — 30-day WIB trend & revenue semantics", () => {
  // Keep the whole describe in one worker (fixture beforeAll must run once).
  test.describe.configure({ mode: "default" });
  test.use({ storageState: { cookies: [], origins: [] } });

  const RUN = Date.now().toString(36);
  const FIXTURE_PICKUP_CODE = `E2EANL${RUN}`.slice(0, 6).toUpperCase() + RUN;
  const FIXTURE_TOTAL = 77777.77;

  let pool: Pool;
  let fixtureOrderId = "";

  // Independent WIB oracle (Intl, not the app's helper arithmetic).
  function wibDateString(date: Date): string {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Jakarta",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(date);
  }

  test.beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });

    // Self-heal: remove a fixture a crashed run may have left behind.
    await pool.query(
      `DELETE FROM orders WHERE pickup_code LIKE 'E2EANL%'`
    );

    // Clone a paid order as paid+cancelled with a distinctive total. It must
    // count as an order (trend.orders, totalOrders) but contribute ZERO
    // revenue anywhere (paid AND not cancelled).
    const template = await pool.query<Record<string, unknown>>(
      `SELECT * FROM orders WHERE payment_status = 'paid' LIMIT 1`
    );
    const t = template.rows[0];
    fixtureOrderId = randomUUID();
    await pool.query(
      `INSERT INTO orders
         (id, user_id, branch_id, status, payment_method, payment_status,
          pickup_code, pickup_verification_attempts, contact_phone,
          contact_email, subtotal, shipping_cost, discount, service_fee,
          ppn_rate, ppn_amount, total, created_at)
       VALUES ($1, $2, $3, 'cancelled', $4, 'paid',
        $5, 0, $6, $7, $8, $9, $10, $11, $12, $13, $14, now())`,
      [
        fixtureOrderId,
        t.user_id,
        t.branch_id,
        t.payment_method,
        FIXTURE_PICKUP_CODE,
        t.contact_phone,
        t.contact_email,
        t.subtotal,
        t.shipping_cost,
        t.discount,
        t.service_fee,
        t.ppn_rate,
        t.ppn_amount,
        FIXTURE_TOTAL.toFixed(2),
      ]
    );
  });

  test.afterAll(async () => {
    if (!pool) return;
    await pool.query(`DELETE FROM orders WHERE id = $1`, [fixtureOrderId]);
    await pool.end();
  });

  // Re-read a scalar probe around `act`; only compare when the DB did not
  // change underneath us (other specs may insert orders concurrently).
  async function compareWhenStable(
    probe: () => Promise<string>,
    act: () => Promise<string>,
    assert: (dbValue: string, apiValue: string) => void
  ): Promise<void> {
    for (let attempt = 0; attempt < 5; attempt++) {
      const before = await probe();
      const apiValue = await act();
      const after = await probe();
      if (before === after) {
        assert(before, apiValue);
        return;
      }
    }
    throw new Error("DB reading never stabilized under concurrent writers");
  }

  test("revenue semantics: paid+cancelled counts as an order but never as revenue", async ({
    page,
  }) => {
    await loginAsHq(page);

    // One probe samples EVERY quantity the assertions compare against — the
    // paid-inclusive sum, the qualifying sum and the qualifying order count —
    // in a single statement, so all of them come from the same stable DB
    // reading. Sampling paidInclusive OUTSIDE the stability window (as an
    // earlier revision did) flakes under concurrent writers: a paid order
    // inserted between the two reads shifts the qualifying sum relative to
    // the stale paid-inclusive reading, breaking the fixture delta. The SQL
    // stays an independent source of truth — read straight from the DB via
    // pg, never from the API under test.
    const revenueProbe = () =>
      pool
        .query<{
          paid_inclusive: string;
          qualifying: string;
          qualifying_count: string;
        }>(
          `SELECT COALESCE(SUM(total) FILTER (
                    WHERE payment_status = 'paid'
                  ), 0)::text AS paid_inclusive,
                  COALESCE(SUM(total) FILTER (
                    WHERE payment_status = 'paid' AND status <> 'cancelled'
                  ), 0)::text AS qualifying,
                  COUNT(*) FILTER (
                    WHERE payment_status = 'paid' AND status <> 'cancelled'
                  )::text AS qualifying_count
           FROM orders`
        )
        .then(
          (r) =>
            `${r.rows[0].paid_inclusive}|${r.rows[0].qualifying}|${r.rows[0].qualifying_count}`
        );

    await compareWhenStable(
      revenueProbe,
      async () => {
        const res = await page.request.get("/api/admin/analytics");
        expect(res.status()).toBe(200);
        const { data } = await res.json();
        return `${data.totalRevenue}|${data.averageOrderValue}`;
      },
      (dbValue, apiValue) => {
        const [paidInclusive, dbQualifying, dbCount] = dbValue
          .split("|")
          .map(Number);
        const [apiRevenue, apiAov] = apiValue.split("|").map(Number);

        // The paid-inclusive sum must EXCEED the qualifying sum by exactly
        // the fixture total — otherwise the exclusion would be vacuous. Both
        // sides of the delta come from the same stable probe window.
        expect(paidInclusive - dbQualifying).toBeCloseTo(FIXTURE_TOTAL, 2);
        // The API matches the independent SQL reading (same stable sample).
        expect(apiRevenue).toBeCloseTo(dbQualifying, 2);
        // AOV: all-time qualifying revenue ÷ qualifying order count, from the
        // same sample; 0 when there are no qualifying orders.
        expect(apiAov).toBeCloseTo(dbCount > 0 ? dbQualifying / dbCount : 0, 2);
      }
    );
  });

  test("trend covers exactly the last 30 WIB calendar days ending today", async ({
    page,
  }) => {
    await loginAsHq(page);
    const res = await page.request.get("/api/admin/analytics");
    expect(res.status()).toBe(200);
    const { data } = await res.json();

    const todayWib = wibDateString(new Date());
    const [y, m, d] = todayWib.split("-").map(Number);
    const oldest = new Date(Date.UTC(y, m - 1, d, 12) - 29 * 86_400_000)
      .toISOString()
      .slice(0, 10);

    // Oldest → newest WIB calendar days, ending today (WIB).
    expect(data.trend).toHaveLength(30);
    expect(data.trend[0].date).toBe(oldest);
    expect(data.trend[29].date).toBe(todayWib);
    for (let i = 1; i < data.trend.length; i++) {
      const prev = Date.parse(`${data.trend[i - 1].date}T00:00:00Z`);
      const curr = Date.parse(`${data.trend[i].date}T00:00:00Z`);
      expect(curr - prev).toBe(86_400_000);
    }
    // Distinct days — no duplicated bucket.
    expect(new Set(data.trend.map((p: { date: string }) => p.date)).size).toBe(
      30
    );
  });

  test("trend aggregates match the DB over the WIB window", async ({
    page,
  }) => {
    await loginAsHq(page);

    const todayWib = wibDateString(new Date());
    const [y, m, d] = todayWib.split("-").map(Number);
    const oldest = new Date(Date.UTC(y, m - 1, d, 12) - 29 * 86_400_000)
      .toISOString()
      .slice(0, 10);
    // Inclusive lower bound: 00:00 WIB on the oldest window day.
    const trendStart = `${oldest}T00:00:00+07:00`;

    // Window aggregates straight from the DB: orders = all statuses,
    // revenue = paid AND not cancelled.
    const windowProbe = () =>
      pool
        .query<{ orders: string; revenue: string }>(
          `SELECT COUNT(*)::text AS orders,
                  COALESCE(SUM(total) FILTER (
                    WHERE payment_status = 'paid' AND status <> 'cancelled'
                  ), 0)::text AS revenue
           FROM orders WHERE created_at >= $1`,
          [trendStart]
        )
        .then((r) => `${r.rows[0].orders}|${r.rows[0].revenue}`);

    await compareWhenStable(
      windowProbe,
      async () => {
        const res = await page.request.get("/api/admin/analytics");
        const { data } = await res.json();
        const orders = data.trend.reduce(
          (acc: number, p: { orders: number }) => acc + p.orders,
          0
        );
        const revenue = data.trend.reduce(
          (acc: number, p: { revenue: number }) => acc + p.revenue,
          0
        );
        return `${orders}|${revenue}`;
      },
      (dbValue, apiValue) => {
        const [dbOrders, dbRevenue] = dbValue.split("|");
        const [apiOrders, apiRevenue] = apiValue.split("|");
        expect(Number(apiOrders)).toBe(Number(dbOrders));
        expect(Number(apiRevenue)).toBeCloseTo(Number(dbRevenue), 2);
      }
    );

    // The paid+cancelled fixture is inside the window (created now): its WIB
    // day bucket must match the day-scoped DB aggregates exactly — counting
    // the fixture as an order while its revenue contributes nothing.
    const fixtureCreated = await pool
      .query<{ created_at: Date }>(
        `SELECT created_at FROM orders WHERE id = $1`,
        [fixtureOrderId]
      )
      .then((r) => r.rows[0].created_at);
    const fixtureDay = wibDateString(new Date(fixtureCreated));

    const dayProbe = () =>
      pool
        .query<{ orders: string; revenue: string }>(
          `SELECT COUNT(*)::text AS orders,
                  COALESCE(SUM(total) FILTER (
                    WHERE payment_status = 'paid' AND status <> 'cancelled'
                  ), 0)::text AS revenue
           FROM orders
           WHERE to_char(created_at AT TIME ZONE 'Asia/Jakarta',
                         'YYYY-MM-DD') = $1`,
          [fixtureDay]
        )
        .then((r) => `${r.rows[0].orders}|${r.rows[0].revenue}`);

    await compareWhenStable(
      dayProbe,
      async () => {
        const res = await page.request.get("/api/admin/analytics");
        const { data } = await res.json();
        const point = data.trend.find(
          (p: { date: string }) => p.date === fixtureDay
        );
        expect(point, `trend bucket for ${fixtureDay}`).toBeTruthy();
        return `${point.orders}|${point.revenue}`;
      },
      (dbValue, apiValue) => {
        const [dbOrders, dbRevenue] = dbValue.split("|");
        const [apiOrders, apiRevenue] = apiValue.split("|");
        expect(Number(apiOrders)).toBe(Number(dbOrders));
        expect(Number(apiRevenue)).toBeCloseTo(Number(dbRevenue), 2);
      }
    );
  });
});