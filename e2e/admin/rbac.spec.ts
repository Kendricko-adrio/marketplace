import { test, expect } from "@playwright/test";

// Admin RBAC — roles page (HQ-only), permission guards, and branch scope.
// The saved admin session is admintoko (role=admin, branch=Jakarta Pusat).

test.describe("admin RBAC", () => {
  test("branch admin is redirected away from the HQ-only roles page", async ({
    page,
  }) => {
    await page.goto("/admin/roles");
    // /admin/roles → /admin?error=forbidden → /admin/<first viewable module>.
    await expect(page).toHaveURL(/\/admin\/products/);
  });

  test("permissions API is HQ-only but /me is open to any admin", async ({
    page,
  }) => {
    // Branch admin → 403 on the full permission list.
    const list = await page.request.get("/api/admin/permissions");
    expect(list.status()).toBe(403);

    // /me resolves the current user's role + permission map.
    const me = await page.request.get("/api/admin/permissions/me");
    expect(me.status()).toBe(200);
    const body = await me.json();
    expect(body.data.role).toBe("admin");
    expect(body.data.permissions.products.canView).toBe(true);
    // Seeded default: branches module has no row → deny by default.
    expect(body.data.permissions.branches.canView).toBe(false);
  });

  test("branch admin sees only their own branch's orders (branch scope)", async ({
    page,
  }) => {
    const res = await page.request.get("/api/admin/orders?limit=50");
    expect(res.status()).toBe(200);
    const { data } = await res.json();
    expect(data.length).toBeGreaterThan(0);
    for (const order of data) {
      expect(order.branch.name).toBe("Cabang Jakarta Pusat");
    }
  });

});

// HQ login needs a clean browser context (the saved session is a branch
// admin) — separate describe with its own storageState.
test.describe("admin RBAC — HQ", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("HQ can open the roles page and sees the read-only matrix", async ({
    page,
  }) => {
    await page.goto("http://localhost:3001/login");
    await page.getByLabel("Email atau Username").fill("hqmanager");
    await page.getByLabel("Password").fill("hq123");
    await page.getByRole("button", { name: "Masuk", exact: true }).click();
    await page.waitForURL("**/admin/**");

    await page.goto("/admin/roles");
    await expect(page.getByText("Akses penuh").first()).toBeVisible();
    // Both role rows render (HQ + Admin).
    await expect(page.getByText("HQ").first()).toBeVisible();
    await expect(page.getByText("Admin").first()).toBeVisible();
  });
});
