import { test, expect } from "@playwright/test";
import { TEST_USERS } from "../config";

// The admin project is authenticated by default via storageState. Login tests
// need a clean browser context, so opt out explicitly.
test.use({ storageState: { cookies: [], origins: [] } });

test.describe("admin login flow", () => {
  test("signs in with valid credentials and lands on the dashboard", async ({
    page,
  }) => {
    await page.goto("/login");
    await page.getByLabel("Email atau Username").fill(TEST_USERS.admin.identifier);
    await page.getByLabel("Password").fill(TEST_USERS.admin.password);
    await page.getByRole("button", { name: "Masuk", exact: true }).click();

    // admintoko's first viewable module is /admin/products (seeded permissions).
    await page.waitForURL("**/admin/**");
    await expect(
      page.getByRole("heading", { name: "Admin Dashboard" })
    ).toBeVisible();
  });

  test("shows an error for invalid credentials", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email atau Username").fill(TEST_USERS.admin.identifier);
    await page.getByLabel("Password").fill("wrong-password");
    await page.getByRole("button", { name: "Masuk", exact: true }).click();

    const error = page.locator("div.bg-destructive\\/10");
    await expect(error).toBeVisible();
    await expect(error).toContainText(/salah|invalid|error/i);
  });

  test("redirects unauthenticated visitors from /admin to /login", async ({
    page,
  }) => {
    await page.goto("/admin");
    await expect(page).toHaveURL(/\/login\?callbackUrl=/);
  });
});
