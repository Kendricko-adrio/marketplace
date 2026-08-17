import { expect, test } from "@playwright/test";
import dotenv from "dotenv";
import { Pool } from "pg";

dotenv.config({ path: ".env" });

test.beforeAll(async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  await pool.query(`
    INSERT INTO permission
      (id, role, module, can_view, can_edit, can_delete, created_at, updated_at)
    VALUES
      ('permission-admin-customers', 'admin', 'customers', false, false, false, now(), now())
    ON CONFLICT (role, module) DO UPDATE SET
      can_view = false,
      can_edit = false,
      can_delete = false,
      updated_at = now()
  `);
  await pool.end();
});

test.describe("admin customers — branch admin", () => {
  test("does not show or allow access to the Customer module", async ({
    page,
  }) => {
    await page.goto("/admin/products");
    await expect(
      page.getByRole("link", { name: "Customer" })
    ).toHaveCount(0);

    await page.goto("/admin/customers");
    await expect(page).toHaveURL(/\/admin\/products$/);
  });
});

test.describe("admin customers — HQ", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("lists registered customers and opens their order history", async ({
    page,
  }) => {
    await page.goto("http://localhost:3001/login");
    await page.getByLabel("Email atau Username").fill("hqmanager");
    await page.getByLabel("Password").fill("hq123");
    await page.getByRole("button", { name: "Masuk", exact: true }).click();
    await page.waitForURL("**/admin/**");

    await page.goto("/admin/customers");

    await expect(
      page.getByRole("heading", { name: "Customer", exact: true })
    ).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Birth Date" })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Onboarding" })).toBeVisible();

    const johnRow = page.getByRole("row").filter({ hasText: "john@example.com" });
    await expect(johnRow).toContainText("John Doe");
    await Promise.all([
      page.waitForURL(/\/admin\/customers\/[^/]+$/),
      johnRow.getByRole("link", { name: "View detail" }).click(),
    ]);

    await expect(page.getByRole("heading", { name: "John Doe" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Order History" })).toBeVisible();
    await expect(page.getByText("Ready for Pickup").first()).toBeVisible();
  });
});
