import { test, expect } from "@playwright/test";

// Uses the authenticated storageState saved by the setup project — proves a
// store session (including the completed-onboarding cookie) is reusable.
test("authenticated customer can open /account", async ({ page }) => {
  await page.goto("/account");
  await expect(
    page.getByRole("heading", { name: "Riwayat Pesanan" })
  ).toBeVisible();
});
