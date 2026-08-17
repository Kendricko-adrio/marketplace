import { test, expect } from "@playwright/test";
import { Pool } from "pg";
import dotenv from "dotenv";

// Admin notifications — long-poll endpoint, the notifications page, and
// mark-all-read. The seeded notifications are reset to unread before the
// spec so the assertions are deterministic.

dotenv.config({ path: ".env" });

let pool: Pool;

test.beforeAll(async () => {
  pool = new Pool({ connectionString: process.env.DATABASE_URL });
  // Reset both seeded notifications to unread.
  await pool.query("UPDATE notification SET is_read = false, read_at = NULL");
});

test.afterAll(async () => {
  await pool.end();
});

test.describe("admin notifications", () => {
  // The page test marks everything read — the poll test must run first.
  test.describe.configure({ mode: "serial" });

  test("long-poll endpoint reports the unread count", async ({ page }) => {
    const res = await page.request.get("/api/admin/notifications/poll");
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    // Initial poll (no `since`) returns the unread count + watermark at the
    // top level, with an empty data list.
    expect(Number(body.unreadCount)).toBe(2);
    expect(typeof body.serverNow).toBe("string");
  });

  test("notifications page lists rows and marks all as read on open", async ({
    page,
  }) => {
    await page.goto("/admin/notifications");

    // Seeded notification rows render.
    await expect(page.getByText("Order Paid").first()).toBeVisible();

    // Opening the page marks all in-scope notifications as read (product
    // decision) — the unread count drops to zero.
    await expect(page.getByText("Tidak ada notifikasi baru")).toBeVisible({
      timeout: 10_000,
    });
  });

  test("mark-all-read API is idempotent", async ({ page }) => {
    const res = await page.request.post(
      "/api/admin/notifications/mark-all-read"
    );
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);

    // After the page test, everything is read — poll confirms 0 unread.
    const poll = await (
      await page.request.get("/api/admin/notifications/poll")
    ).json();
    expect(Number(poll.unreadCount)).toBe(0);
  });
});
