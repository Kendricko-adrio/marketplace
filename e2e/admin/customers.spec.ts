import { expect, test } from "@playwright/test";

// Deny-by-default: the seeded Admin Role has no customers grant at all
// (absence of a grant row means deny), so no fixture rows are needed. The
// spec asserts that the module stays hidden and denied for a branch admin.

test.describe("admin customers — branch admin", () => {
  test("does not show or allow access to the Customer module", async ({
    page,
  }) => {
    await page.goto("/admin/products");
    // Wait for the policy-driven sidebar to resolve (the home-branch line in
    // the account button only renders once the policy has loaded), then the
    // Customer link must stay hidden. The policy fetch can be slow under
    // parallel dev-server load, so allow more than the default 5s.
    await expect(page.getByText("Cabang Jakarta Pusat")).toBeVisible({
      timeout: 15_000,
    });
    await expect(
      page.getByRole("link", { name: "Customer" })
    ).toHaveCount(0);

    await page.goto("/admin/customers");
    // Deny-by-default: the module redirects to the shared No-Access page.
    await expect(page).toHaveURL(/\/admin\/no-access/);
  });
});

test.describe("admin customers — HQ", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  // The HQ spec signs in fresh and traverses three dev-server-compiled pages;
  // under parallel load that alone can approach the default 30s test timeout.
  test.setTimeout(90_000);

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
    // App Router soft navigation never fires a load event, and the RSC
    // transition only commits after the detail payload + chunks arrive, so
    // assert the visible URL after the click with a load-tolerant timeout
    // instead of Promise.all(waitForURL(load), click).
    await johnRow.getByRole("link", { name: "View detail" }).click();
    await expect(page).toHaveURL(/\/admin\/customers\/[^/]+$/, {
      timeout: 30_000,
    });

    await expect(page.getByRole("heading", { name: "John Doe" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Order History" })).toBeVisible();
    await expect(page.getByText("Ready for Pickup").first()).toBeVisible();
  });
});
