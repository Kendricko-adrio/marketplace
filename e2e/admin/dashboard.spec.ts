import { test, expect } from "@playwright/test";

// Uses the authenticated admin storageState saved by the setup project.
test("authenticated admin can open the dashboard", async ({ page }) => {
  await page.goto("/admin/products");
  await expect(page).toHaveURL(/\/admin\/products/);
  await expect(
    page.getByRole("heading", { name: "Admin Dashboard" })
  ).toBeVisible();
});
