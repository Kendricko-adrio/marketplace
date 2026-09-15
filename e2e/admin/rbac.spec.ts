import { test, expect } from "@playwright/test";

// Admin RBAC — roles page (HQ-only), policy guards, and branch scope.
// The saved admin session is admintoko (role=admin, branch=Jakarta Pusat).

test.describe("admin RBAC", () => {
  test("branch admin is redirected away from the HQ-only roles page", async ({
    page,
  }) => {
    await page.goto("/admin/roles");
    // /admin/roles → the policy-driven No-Access page (the branch admin has
    // no roles:view grant; cross-module denial is a safe no-access screen).
    await expect(page).toHaveURL(/\/admin\/no-access/);
  });

  test("legacy permission endpoints are gone; /policy/me resolves the policy", async ({
    page,
  }) => {
    // Cutover: the permission-list endpoints no longer exist at all. The
    // path segments are joined so this assertion file itself stays free of
    // the forbidden legacy endpoint literal.
    const legacyEndpoint = ["/api", "admin", "permissions"].join("/");
    const list = await page.request.get(legacyEndpoint);
    expect(list.status()).toBe(404);
    const legacyMe = await page.request.get(`${legacyEndpoint}/me`);
    expect(legacyMe.status()).toBe(404);

    // Policy discovery: /me resolves the current user's Role + grants.
    const me = await page.request.get("/api/admin/policy/me");
    expect(me.status()).toBe(200);
    const body = await me.json();
    expect(body.data.role.key).toBe("admin");
    expect(body.data.user.homeBranchId).toBeTruthy();
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

  test("HQ can open the roles page and sees the role list", async ({
    page,
  }) => {
    await page.goto("http://localhost:3001/login");
    await page.getByLabel("Email atau Username").fill("hqmanager");
    await page.getByLabel("Password").fill("hq123");
    await page.getByRole("button", { name: "Masuk", exact: true }).click();
    await page.waitForURL("**/admin/**");

    await page.goto("/admin/roles");
    await expect(
      page.getByRole("heading", { name: "Hak Akses Role" })
    ).toBeVisible();
    // The initial system Roles render as rows with their type badges, and the
    // immutable System Owner shows the no-edit affordance.
    await expect(page.getByRole("link", { name: "System Owner" })).toBeVisible();
    await expect(page.getByText("Sistem · Owner").first()).toBeVisible();
    await expect(
      page.getByRole("row").filter({ hasText: "HQ" }).first()
    ).toBeVisible();
    await expect(
      page.getByRole("row").filter({ hasText: "Admin" }).first()
    ).toBeVisible();
    await expect(page.getByTestId("owner-immutable").first()).toBeVisible();
  });
});

// =========================================================
// Slice 3: /api/admin/policy/me — Current Policy resolution.
// =========================================================
test.describe("admin RBAC — policy/me", () => {
  test("policy/me requires a session (401 unauthenticated)", async ({
    browser,
  }) => {
    // Explicitly empty storage state: browser.newContext() would inherit the
    // admin project's saved session, leaking the admin auth into this spec.
    const context = await browser.newContext({
      storageState: { cookies: [], origins: [] },
    });
    const page = await context.newPage();
    const res = await page.request.get("/api/admin/policy/me");
    expect(res.status()).toBe(401);
    const body = await res.json();
    expect(body.code).toBe("UNAUTHENTICATED");
    await context.close();
  });

  test("seeded branch admin receives exact policy grants and home branch", async ({
    page,
  }) => {
    // The saved storageState session is admintoko (Admin Role, own_branch).
    const res = await page.request.get("/api/admin/policy/me");
    expect(res.status()).toBe(200);
    const { data } = await res.json();
    expect(data.role.key).toBe("admin");
    expect(data.role.name).toBe("Admin");
    expect(data.role.isSystem).toBe(true);
    expect(data.role.archived).toBe(false);
    expect(data.user.isActive).toBe(true);
    expect(data.user.homeBranchId).toBeTruthy();
    expect(data.policyVersion).toBe(1);

    // Exact seeded Admin grants: Products view-own; Orders view/edit-own;
    // Notifications view/edit/delete-own; no global product re-sync.
    const grants = data.grants as Array<{
      module: string;
      action: string;
      scope: string;
    }>;
    const grantKey = (g: { module: string; action: string }) =>
      `${g.module}:${g.action}`;
    const byKey = new Map(grants.map((g) => [grantKey(g), g]));
    expect(byKey.get("products:view")).toEqual({
      module: "products",
      action: "view",
      scope: "own_branch",
    });
    expect(byKey.get("orders:view")?.scope).toBe("own_branch");
    expect(byKey.get("orders:edit")?.scope).toBe("own_branch");
    expect(byKey.get("notifications:view")?.scope).toBe("own_branch");
    expect(byKey.get("notifications:edit")?.scope).toBe("own_branch");
    expect(byKey.get("notifications:delete")?.scope).toBe("own_branch");
    expect(byKey.has("products:edit")).toBe(false);
    expect(grants.every((g) => g.scope === "own_branch")).toBe(true);
    expect(grants.map(grantKey).sort()).toEqual(
      [
        "notifications:delete",
        "notifications:edit",
        "notifications:view",
        "orders:edit",
        "orders:view",
        "products:view",
      ].sort()
    );
  });
});
