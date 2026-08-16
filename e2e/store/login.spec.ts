import { test, expect } from "@playwright/test";
import { TEST_USERS } from "../config";

// The store project is authenticated by default via storageState. Login tests
// need a clean browser context, so opt out explicitly.
test.use({ storageState: { cookies: [], origins: [] } });

test.describe("store login flow", () => {
  test("signs in with valid credentials and lands on onboarding", async ({
    page,
  }) => {
    await page.goto("/login");
    // Use a customer the auth setup never onboards, so the fresh-user flow is
    // deterministic (middleware sends a successful sign-in to /onboarding).
    await page.getByLabel("Email").fill(TEST_USERS.storeFresh.email);
    await page.keyboard.press("Tab");
    await page.getByLabel("Password").fill(TEST_USERS.storeFresh.password);
    await page.keyboard.press("Enter");

    // The onboarding form's CardTitle is a <div> (not a heading role), so
    // assert a form field instead.
    await page.waitForURL("**/onboarding");
    await expect(page.getByLabel("Nomor Telepon")).toBeVisible();
  });

  test("shows an error for invalid credentials", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill(TEST_USERS.store.email);
    await page.keyboard.press("Tab");
    await page.getByLabel("Password").fill("wrong-password");
    await page.keyboard.press("Enter");

    const error = page.locator("div.bg-destructive\\/10");
    await expect(error).toBeVisible();
    await expect(error).toContainText(/salah|invalid|error/i);
  });

  test("redirects unauthenticated visitors from /account to /login", async ({
    page,
  }) => {
    await page.goto("/account");
    await expect(page).toHaveURL(/\/login\?callbackUrl=/);
  });
});
