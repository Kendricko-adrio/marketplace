import { test, expect } from "@playwright/test";
import { Pool } from "pg";
import dotenv from "dotenv";

// Admin orders — list/detail, verify-pickup (wrong + correct code), and the
// audit-log entry written by a successful verification.
//
// The verify test mutates the seeded ready_for_pickup order; it is restored
// via direct DB access afterwards so the spec is re-runnable.
//
// The admin session is admintoko (own-branch scope pinned to the Home
// Branch "Jakarta Pusat"), and the orders list defaults its Order-Date
// filter to today — the list test therefore asserts only Home-Branch
// statuses, with the seeded orders' created_at shifted into that window
// (restored afterwards).

dotenv.config({ path: ".env" });

const READY_ORDER_ID = "90681d15-fc1a-4377-bdb7-1060da208ed6";
const PICKUP_CODE = "G4XUNM";

let pool: Pool;
let manualReviewOrderId = "";
let manualReviewOperationId = "";
// Home-Branch list facts (asserted by the list spec) + created_at restore map.
let homeBranchId = "";
let homeBranchCity = "";
let homeStatusLabels: string[] = [];
// Visible badge count per status label (orders share statuses, so a label
// can render once per matching row).
let homeStatusLabelCounts: Record<string, number> = {};
let homeStockReviewCount = 0;
let originalCreatedAt: Array<{ id: string; created_at: Date }> = [];

const STATUS_LABELS: Record<string, string> = {
  pending_payment: "Pending Payment",
  processing: "Processing",
  ready_for_pickup: "Ready for Pickup",
  completed: "Completed",
  cancelled: "Cancelled",
  failed_payment: "Payment Failed",
};

// Local YYYY-MM-DD (browser's clock) — matches the list page's default
// Order-Date filter, which it sends as plain dates the API interprets as
// [00:00Z, +1 day). Noon UTC of that local day is always inside the window.
function defaultListWindowFrom(): Date {
  const d = new Date();
  const tzOffset = d.getTimezoneOffset() * 60_000;
  const today = new Date(d.getTime() - tzOffset).toISOString().slice(0, 10);
  return new Date(`${today}T12:00:00Z`);
}

test.beforeAll(async () => {
  pool = new Pool({ connectionString: process.env.DATABASE_URL });

  // The Recheck test below flips the seeded release operation to
  // 'reconciling' and restores it in afterAll — but an interrupted run never
  // reaches afterAll. Heal the fixture so the spec stays re-runnable: reset
  // the seeded release operation and drop the stale audit entry. This runs
  // first so the fixture-count queries below derive their expectations from
  // the healed state.
  await pool.query(
    `UPDATE jubelio_stock_operation SET status = 'manual_review'
     WHERE note LIKE 'OKCIR_RELEASE:%' AND status <> 'manual_review'`
  );
  await pool.query(
    `DELETE FROM audit_log
     WHERE action = 'RECHECK_JUBELIO_STOCK' AND entity_id IN (
       SELECT order_id FROM jubelio_stock_operation
       WHERE note LIKE 'OKCIR_RELEASE:%'
     )`
  );

  // admintoko's Home Branch — the own-branch orders list is pinned to it.
  const home = await pool.query<{ branch_id: string; city: string | null }>(
    `SELECT u.branch_id, b.city
     FROM "user" u LEFT JOIN branch b ON b.id = u.branch_id
     WHERE u.username = 'admintoko'`
  );
  homeBranchId = home.rows[0].branch_id;
  homeBranchCity = home.rows[0].city ?? "";

  const statusRows = await pool.query<{ status: string; count: number }>(
    `SELECT status, count(*)::int AS count
     FROM orders WHERE branch_id = $1 GROUP BY status`,
    [homeBranchId]
  );
  homeStatusLabels = statusRows.rows
    .map((r) => STATUS_LABELS[r.status])
    .filter(Boolean)
    .sort();
  homeStatusLabelCounts = Object.fromEntries(
    statusRows.rows
      .map((r) => [STATUS_LABELS[r.status], r.count] as const)
      .filter(([label]) => Boolean(label))
  );
  homeStockReviewCount = (
    await pool.query<{ count: number }>(
      `SELECT count(DISTINCT o.id)::int AS count
       FROM orders o
       JOIN jubelio_stock_operation j ON j.order_id = o.id
        AND j.status = 'manual_review'
       WHERE o.branch_id = $1`,
      [homeBranchId]
    )
  ).rows[0].count;

  // The list page defaults its Order-Date filter to "today", so pull the
  // seeded Home-Branch orders into that window (originals restored in
  // afterAll).
  originalCreatedAt = (
    await pool.query<{ id: string; created_at: Date }>(
      `SELECT id, created_at FROM orders WHERE branch_id = $1`,
      [homeBranchId]
    )
  ).rows;
  const shifted = defaultListWindowFrom();
  await pool.query(
    `UPDATE orders SET created_at = $1 WHERE branch_id = $2`,
    [shifted, homeBranchId]
  );

  const manualReview = await pool.query<{ order_id: string; id: string }>(
    `SELECT order_id, id FROM jubelio_stock_operation
     WHERE status = 'manual_review'
     ORDER BY created_at ASC LIMIT 1`
  );
  manualReviewOrderId = manualReview.rows[0]?.order_id ?? "";
  manualReviewOperationId = manualReview.rows[0]?.id ?? "";
});

test.afterAll(async () => {
  // Restore the fixture orders' original created_at.
  if (originalCreatedAt.length > 0) {
    await pool.query(
      `UPDATE orders SET created_at = v.created_at
       FROM (SELECT unnest($1::text[]) AS id, unnest($2::timestamptz[]) AS created_at) AS v
       WHERE orders.id = v.id`,
      [
        originalCreatedAt.map((r) => r.id),
        originalCreatedAt.map((r) => r.created_at),
      ]
    );
  }

  // Restore the order the verify test completed.
  await pool.query(
    `UPDATE orders SET status = 'ready_for_pickup', payment_status = 'paid'
     WHERE id = $1`,
    [READY_ORDER_ID]
  );
  if (manualReviewOperationId) {
    await pool.query(
      `UPDATE jubelio_stock_operation SET status = 'manual_review'
       WHERE id = $1`,
      [manualReviewOperationId]
    );
    await pool.query(
      `DELETE FROM audit_log
       WHERE action = 'RECHECK_JUBELIO_STOCK' AND entity_id = $1`,
      [manualReviewOrderId]
    );
  }
  await pool.end();
});

test.describe("admin orders", () => {
  // The audit-log test depends on the verify test having run — serialize.
  test.describe.configure({ mode: "serial" });

  test("lists Home-Branch orders with status badges", async ({ page }) => {
    await page.goto("/admin/orders");

    await expect(
      page.getByRole("heading", { name: /Pesanan|Orders/i })
    ).toBeVisible();

    // Own-branch scope is pinned server-side to the Home Branch, so every
    // visible row must be a Home-Branch order. Scope badges to the table
    // body — the tab strip also renders status names as labels.
    const body = page.getByRole("table").locator("tbody");
    const rows = body.locator("tr");
    await expect(rows.first()).toBeVisible();
    const rowCount = await rows.count();
    expect(rowCount).toBeGreaterThan(0);
    for (let i = 0; i < rowCount; i++) {
      await expect(rows.nth(i).locator("td").nth(3)).toContainText(
        homeBranchCity
      );
    }

    // Every Home-Branch status seeded in the DB is visible as a badge.
    // Several orders can share a status, so each label renders once per
    // matching row — assert the exact DB-derived count when the fixture has
    // multiple orders of that status, and first-match visibility for the
    // single-order case (all Home-Branch fixtures fit the default 25-row
    // page, so the count is fully visible).
    for (const label of homeStatusLabels) {
      const badge = body.getByText(label, { exact: true });
      const count = homeStatusLabelCounts[label] ?? 0;
      if (count > 1) {
        await expect(badge).toHaveCount(count);
      } else {
        await expect(badge.first()).toBeVisible();
      }
    }
    if (homeStockReviewCount > 0) {
      await expect(body.getByText("Stock review")).toHaveCount(
        homeStockReviewCount
      );
    } else {
      await expect(body.getByText("Stock review")).toHaveCount(0);
    }
  });

  test("shows the durable Jubelio lifecycle and manual-review reason", async ({
    page,
  }) => {
    expect(manualReviewOrderId).toBeTruthy();
    await page.goto(`/admin/orders/${manualReviewOrderId}`);

    await expect(page.getByText("Jubelio stock lifecycle")).toBeVisible();
    await expect(page.getByText("manual review")).toBeVisible();
    await expect(
      page.getByText("Seeded release requires operator reconciliation")
    ).toBeVisible();

    await page.getByRole("button", { name: "Recheck safely" }).click();
    await expect(page.getByText("Safe Jubelio reconciliation queued")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText("reconciling")).toBeVisible({ timeout: 15_000 });
  });

  test("order detail shows the immutable PPN snapshot", async ({ page }) => {
    await page.goto(`/admin/orders/${READY_ORDER_ID}`);
    await expect(page.getByText("PPN (11%)")).toBeVisible();
    const stored = await pool.query(
      `SELECT ppn_amount FROM orders WHERE id = $1`,
      [READY_ORDER_ID]
    );
    await expect(
      page.getByText(`Rp ${Number(stored.rows[0].ppn_amount).toLocaleString("id-ID")}`).first()
    ).toBeVisible();
  });

  test("order detail opens the verify dialog for a ready_for_pickup order", async ({
    page,
  }) => {
    await page.goto(`/admin/orders/${READY_ORDER_ID}`);

    // The admin asks the customer for the code — the dialog is the entry point.
    await page.getByRole("button", { name: "Customer Pick Up" }).click();
    await expect(
      page.getByRole("heading", { name: "Customer Pick Up" })
    ).toBeVisible();
    await expect(page.getByLabel("Pickup Code")).toBeVisible();
  });

  test("verify-pickup rejects a wrong code and completes with the right one", async ({
    page,
  }) => {
    await page.goto(`/admin/orders/${READY_ORDER_ID}`);
    await page.getByRole("button", { name: "Customer Pick Up" }).click();

    // Wrong code → error, order stays ready_for_pickup.
    await page.getByLabel("Pickup Code").fill("AAAAAA");
    await page.getByRole("button", { name: "Verify & Complete" }).click();
    await expect(
      page.getByText(/invalid|salah|mismatch|tidak cocok/i).first()
    ).toBeVisible();

    // Correct code → success toast.
    await page.getByLabel("Pickup Code").fill(PICKUP_CODE);
    await page.getByRole("button", { name: "Verify & Complete" }).click();
    await expect(page.getByText("Order completed successfully")).toBeVisible();
  });

  test("successful verification writes a VERIFY_PICKUP_CODE audit-log entry", async () => {
    // The audit-log API is intentionally outside the branch admin's grant
    // set (403 — see rbac-security.spec.ts), so the written entry is
    // verified through direct DB access instead.
    const res = await pool.query(
      `SELECT action, entity_id, changes FROM audit_log
       WHERE action = 'VERIFY_PICKUP_CODE' AND entity_id = $1
       ORDER BY created_at DESC LIMIT 1`,
      [READY_ORDER_ID]
    );
    const entry = res.rows[0];
    expect(entry).toBeTruthy();
    expect(entry.action).toBe("VERIFY_PICKUP_CODE");
    expect(entry.changes.status.from).toBe("ready_for_pickup");
    expect(entry.changes.status.to).toBe("completed");
  });
});
