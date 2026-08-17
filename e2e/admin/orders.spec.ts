import { test, expect } from "@playwright/test";
import { Pool } from "pg";
import dotenv from "dotenv";

// Admin orders — list/detail, verify-pickup (wrong + correct code), and the
// audit-log entry written by a successful verification.
//
// The verify test mutates the seeded ready_for_pickup order; it is restored
// via direct DB access afterwards so the spec is re-runnable.

dotenv.config({ path: ".env" });

const READY_ORDER_ID = "90681d15-fc1a-4377-bdb7-1060da208ed6";
const PICKUP_CODE = "G4XUNM";

let pool: Pool;

test.beforeAll(async () => {
  pool = new Pool({ connectionString: process.env.DATABASE_URL });
});

test.afterAll(async () => {
  // Restore the order the verify test completed.
  await pool.query(
    `UPDATE orders SET status = 'ready_for_pickup', payment_status = 'paid'
     WHERE id = $1`,
    [READY_ORDER_ID]
  );
  await pool.end();
});

test.describe("admin orders", () => {
  // The audit-log test depends on the verify test having run — serialize.
  test.describe.configure({ mode: "serial" });

  test("lists orders with status badges", async ({ page }) => {
    await page.goto("/admin/orders");

    await expect(
      page.getByRole("heading", { name: /Pesanan|Orders/i })
    ).toBeVisible();
    // The seeded ready_for_pickup order is visible with its status badge.
    await expect(page.getByText("Ready for Pickup").first()).toBeVisible();
    await expect(page.getByText("Payment Failed").first()).toBeVisible();
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

  test("successful verification writes a VERIFY_PICKUP_CODE audit-log entry", async ({
    page,
  }) => {
    const res = await page.request.get("/api/admin/audit-log?limit=50");
    expect(res.status()).toBe(200);
    const { data } = await res.json();
    const entry = data.find(
      (e: { action: string; entityId: string }) =>
        e.action === "VERIFY_PICKUP_CODE" && e.entityId === READY_ORDER_ID
    );
    expect(entry).toBeTruthy();
    expect(entry.changes.status.from).toBe("ready_for_pickup");
    expect(entry.changes.status.to).toBe("completed");
  });
});
