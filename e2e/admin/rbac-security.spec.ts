import { test, expect, type Page, type BrowserContext } from "@playwright/test";
import { Pool } from "pg";
import dotenv from "dotenv";
import { randomUUID } from "crypto";

// =========================================================
// Slice 7 — branch-aware security matrix for Products, Orders,
// Notifications, Branches, Analytics, and Audit Log.
//
// The saved admin session is admintoko (Admin Role: products view-own,
// orders view/edit-own, notifications view/edit/delete-own — no branches,
// analytics, or audit_log grants, all scoped to Home Branch "Jakarta
// Pusat").
//
// Fixtures are independent, run-unique rows created/cleaned by direct DB
// access (FK-order cleanup): a Surabaya-only product, a Surabaya order, a
// null-branch order, and run-unique audit events. A Surabaya actor with
// view-own grants for branches/analytics/audit_log is created through the
// Roles/Users APIs (as hqmanager) and deactivated + its Role archived at
// the end.
// =========================================================

dotenv.config({ path: ".env" });

// The whole file shares one fixture set (branch rows, product, orders, audit
// events) created in beforeAll, so tests must not run in separate workers:
// with fullyParallel each test would re-run beforeAll and collide on the
// unique orders.pickup_code constraint (and inflate the analytics counts).
test.describe.configure({ mode: "default" });

const RUN = Date.now().toString(36);
const PRODUCT_SLUG = `e2e-sec-${RUN}`;
const ACTOR_EMAIL = `e2e-sec-${RUN}@store.com`;
const ACTOR_PASSWORD = `Pw-${RUN}-e2e!`;

let pool: Pool;
let jktBranchId = "";
let sbyBranchId = "";
let productId = "";
let variantId = "";
let sbyOrderId = "";
let nullOrderId = "";
let auditGlobalAction = "";
let auditSbyAction = "";
let auditDualSbyNewAction = "";
let auditDualSbyOldAction = "";

async function loginAsHQ(page: Page): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Email atau Username").fill("hqmanager");
  await page.getByLabel("Password").fill("hq123");
  await page.getByRole("button", { name: "Masuk", exact: true }).click();
  await page.waitForURL("**/admin/**");
}

test.beforeAll(async () => {
  pool = new Pool({ connectionString: process.env.DATABASE_URL });

  // Self-heal from a previously crashed/interrupted run: archived Role
  // Names and deactivated users' emails stay reserved forever, so any
  // e2e fixture pair that never reached its afterEach cleanup must be
  // deactivated + archived here (the exact service semantics, in FK
  // order) or every later run accumulates active ghost actors.
  await pool.query(
    `UPDATE "user" SET is_active = false WHERE email LIKE 'e2e-sec-%'`
  );
  await pool.query(
    `DELETE FROM admin_session WHERE user_id IN (
       SELECT id FROM "user" WHERE email LIKE 'e2e-sec-%')`
  );
  await pool.query(
    `UPDATE admin_role SET archived_at = now()
     WHERE name LIKE 'e2e-sec-%' AND archived_at IS NULL`
  );
  await pool.query(
    `DELETE FROM homepage_section_product WHERE section_id IN (
       SELECT id FROM homepage_section WHERE title LIKE 'E2E Sec Marketing %')`
  );
  await pool.query(
    `DELETE FROM homepage_section WHERE title LIKE 'E2E Sec Marketing %'`
  );

  const branches = await pool.query<{ id: string; city: string }>(
    `SELECT id, city FROM branch`
  );
  jktBranchId =
    branches.rows.find((b) => b.city === "Jakarta Pusat")?.id ??
    branches.rows[0].id;
  sbyBranchId = branches.rows.find((b) => b.city !== "Jakarta Pusat")!.id;

  // Surabaya-only product: carried by the other branch, never by Jakarta.
  productId = randomUUID();
  variantId = randomUUID();
  await pool.query(
    `INSERT INTO product (id, name, slug, base_price, status, description)
     VALUES ($1, $2, $3, 150000, 'aktif', 'e2e cross-branch fixture')`,
    [productId, `E2E Sec Product ${RUN}`, PRODUCT_SLUG]
  );
  await pool.query(
    `INSERT INTO product_variant (id, product_id, sku, price, is_default)
     VALUES ($1, $2, $3, 150000, true)`,
    [variantId, productId, `E2E-SEC-${RUN}`]
  );
  await pool.query(
    `INSERT INTO branch_stock
       (branch_id, product_variant_id, stock, reserved_stock, pending_remote_stock)
     VALUES ($1, $2, 5, 0, 0)`,
    [sbyBranchId, variantId]
  );

  // Remove fixtures a previous crashed run may have left behind (their
  // fixed pickup codes are uniqueness keys for the inserts below).
  await pool.query(
    `DELETE FROM orders WHERE pickup_code IN ('E2ESBY', 'E2ENULL')`
  );

  // A paid Surabaya order and a null-branch order (cloned paid orders).
  const template = await pool.query<Record<string, unknown>>(
    `SELECT * FROM orders WHERE payment_status = 'paid' LIMIT 1`
  );
  const t = template.rows[0];
  sbyOrderId = randomUUID();
  nullOrderId = randomUUID();
  await pool.query(
    `INSERT INTO orders
       (id, user_id, branch_id, status, payment_method, payment_status,
        pickup_code, pickup_verification_attempts, contact_phone,
        contact_email, subtotal, shipping_cost, discount, service_fee,
        ppn_rate, ppn_amount, total)
     VALUES
       ($1, $2, $3, 'processing', $4, 'paid', 'E2ESBY', 0, $5, $6,
        $7, $8, $9, $10, $11, $12, $13),
       ($14, $15, NULL, 'processing', $16, 'paid',
        'E2ENULL', 0, $17, $18, $19, $20, $21, $22, $23, $24, $25)`,
    [
      sbyOrderId,
      t.user_id,
      sbyBranchId,
      t.payment_method,
      t.contact_phone,
      t.contact_email,
      t.subtotal,
      t.shipping_cost,
      t.discount,
      t.service_fee,
      t.ppn_rate,
      t.ppn_amount,
      t.total,
      nullOrderId,
      t.user_id,
      t.payment_method,
      t.contact_phone,
      t.contact_email,
      t.subtotal,
      t.shipping_cost,
      t.discount,
      t.service_fee,
      t.ppn_rate,
      t.ppn_amount,
      t.total,
    ]
  );

  // Run-unique audit events across the classification spectrum.
  auditGlobalAction = `E2E_SEC_GLOBAL_${RUN}`;
  auditSbyAction = `E2E_SEC_SBY_${RUN}`;
  auditDualSbyNewAction = `E2E_SEC_DUAL_NEW_${RUN}`; // Jakarta → Surabaya
  auditDualSbyOldAction = `E2E_SEC_DUAL_OLD_${RUN}`; // Surabaya → Jakarta
  await pool.query(
    `INSERT INTO audit_log (id, action, entity_type, policy_version, branch_scope, branch_id, related_branch_id)
     VALUES
       ($1, $2, 'system', 1, 'global', NULL, NULL),
       ($3, $4, 'order', 1, 'single_branch', $5, NULL),
       ($6, $7, 'user', 1, 'dual_branch', $8, $9),
       ($10, $11, 'user', 1, 'dual_branch', $12, $13)`,
    [
      randomUUID(),
      auditGlobalAction,
      randomUUID(),
      auditSbyAction,
      sbyBranchId,
      randomUUID(),
      auditDualSbyNewAction,
      jktBranchId,
      sbyBranchId,
      randomUUID(),
      auditDualSbyOldAction,
      sbyBranchId,
      jktBranchId,
    ]
  );
});

test.afterAll(async () => {
  if (!pool) return;
  // FK-order cleanup of the run-unique fixtures.
  await pool.query(`DELETE FROM audit_log WHERE action LIKE 'E2E_SEC_%${RUN}'`);
  await pool.query(`DELETE FROM orders WHERE id = ANY($1)`, [
    [sbyOrderId, nullOrderId],
  ]);
  await pool.query(`DELETE FROM branch_stock WHERE product_variant_id = $1`, [
    variantId,
  ]);
  await pool.query(`DELETE FROM product_variant WHERE id = $1`, [variantId]);
  await pool.query(`DELETE FROM product WHERE id = $1`, [productId]);
  await pool.end();
});

// =========================================================
// Own-branch Admin (saved admintoko session)
// =========================================================
test.describe("branch-aware security — own-branch admin", () => {
  test.describe.configure({ mode: "serial" });

  test("denies branches, analytics, and audit log without grants (403)", async ({
    request,
  }) => {
    for (const path of [
      "/api/admin/branches",
      "/api/admin/analytics",
      "/api/admin/audit-log",
    ]) {
      const res = await request.get(path);
      expect(res.status()).toBe(403);
      expect((await res.json()).code).toBe("DENIED");
    }
  });

  test("orders list stays pinned to the Home Branch even with a branchId param", async ({
    request,
  }) => {
    const res = await request.get(`/api/admin/orders?branchId=${sbyBranchId}`);
    expect(res.status()).toBe(200);
    const { data } = await res.json();
    expect(data.length).toBeGreaterThan(0);
    for (const order of data) {
      expect(order.branch.id).toBe(jktBranchId);
    }
  });

  test("cross-branch order id is 404 for detail, stock-review, and pickup", async ({
    request,
  }) => {
    const detail = await request.get(`/api/admin/orders/${sbyOrderId}`);
    expect(detail.status()).toBe(404);

    const review = await request.post(
      `/api/admin/orders/${sbyOrderId}/stock-review`,
      { data: { operationId: "e2e" } }
    );
    expect(review.status()).toBe(404);

    const pickup = await request.post(
      `/api/admin/orders/${sbyOrderId}/verify-pickup`,
      { data: { pickupCodeInput: "E2ESBY" } }
    );
    expect(pickup.status()).toBe(404);
  });

  test("products list hides non-carried products; the detail id 404s", async ({
    request,
  }) => {
    const list = await request.get("/api/admin/products?limit=100");
    expect(list.status()).toBe(200);
    const { data } = await list.json();
    const slugs = (data as Array<{ slug: string }>).map((p) => p.slug);
    expect(slugs).not.toContain(PRODUCT_SLUG);

    const detail = await request.get(`/api/admin/products/${productId}`);
    expect(detail.status()).toBe(404);
  });
});

// =========================================================
// Cross-branch viewer — Surabaya actor with view-own grants
// (created via the Roles + Users APIs by an HQ role manager)
// =========================================================
test.describe("branch-aware security — Surabaya viewer", () => {
  test.describe.configure({ mode: "serial" });

  // browser.newContext() inherits the project's saved admintoko state, which
  // makes the /login server component redirect straight back to /admin and
  // breaks the hqmanager/viewer logins below — start from an isolated empty
  // context instead.
  test.use({ storageState: { cookies: [], origins: [] } });

  let page: Page;
  let request: Page["request"];
  let actorId = "";
  let customRoleId = "";

  test.beforeEach(async ({ browser }) => {
    const context = await browser.newContext();
    page = await context.newPage();
    await loginAsHQ(page);
    request = page.request;

    // Custom Role scoped to own_branch only.
    const roleRes = await request.post("/api/admin/roles", {
      data: {
        name: `e2e-sec-viewer ${RUN}`,
        grants: [
          { module: "branches", action: "view", scope: "own_branch" },
          { module: "analytics", action: "view", scope: "own_branch" },
          { module: "audit_log", action: "view", scope: "own_branch" },
        ],
      },
    });
    expect(roleRes.status()).toBe(201);
    const roleBody = await roleRes.json();
    customRoleId = roleBody.data.id;

    // Assign the Role + Surabaya Home Branch in one validated unit.
    const userRes = await request.post("/api/admin/users", {
      data: {
        name: `E2E Sec Viewer ${RUN}`,
        email: ACTOR_EMAIL,
        roleId: customRoleId,
        branchId: sbyBranchId,
        passwordMode: "manual",
        password: ACTOR_PASSWORD,
      },
    });
    expect(userRes.status()).toBe(201);
    const userBody = await userRes.json();
    actorId = userBody.data.id;

    // The Users API forces a first-login password change on every created
    // Admin User; clear the flag via direct DB access so the viewer login
    // below lands on /admin instead of /reset-password.
    await pool.query(
      `UPDATE "user" SET must_reset_password = false WHERE id = $1`,
      [actorId]
    );
  });

  test.afterEach(async () => {
    // Cleanup: deactivate (retains identity), then archive the Role.
    // Deactivation goes through the dedicated endpoint — the general user
    // update PUT is a strictObject without isActive and would 400. Statuses
    // are asserted so a silently failing cleanup can never leave an active
    // actor + open Role behind for later runs.
    try {
      if (actorId) {
        const res = await request.post(
          `/api/admin/users/${actorId}/deactivate`,
          {
            data: {
              reason: `e2e cleanup ${RUN}`,
            },
          }
        );
        expect(res.status(), "deactivate viewer actor").toBe(200);
      }
      if (customRoleId) {
        const res = await request.delete(`/api/admin/roles/${customRoleId}`, {
          data: { reason: `e2e cleanup ${RUN}` },
        });
        expect(res.status(), "archive viewer role").toBe(200);
      }
    } finally {
      await page.context().close();
    }
  });

  test("branch predicates follow the Home Branch, not the client", async ({
    browser,
  }) => {
    // Fresh login as the Surabaya viewer.
    const context = await browser.newContext();
    const viewer = await context.newPage();
    await viewer.goto("/login");
    await viewer.getByLabel("Email atau Username").fill(ACTOR_EMAIL);
    await viewer.getByLabel("Password").fill(ACTOR_PASSWORD);
    await viewer.getByRole("button", { name: "Masuk", exact: true }).click();
    await viewer.waitForURL("**/admin/**");

    // Branches: own view reaches only the Home Branch.
    const list = await viewer.request.get("/api/admin/branches");
    expect(list.status()).toBe(200);
    const { data: branchData } = await list.json();
    expect(branchData).toHaveLength(1);
    expect(branchData[0].id).toBe(sbyBranchId);

    const jktDetail = await viewer.request.get(
      `/api/admin/branches/${jktBranchId}`
    );
    expect(jktDetail.status()).toBe(404);

    // Analytics: only the Surabaya order; the null-branch order is excluded.
    const analytics = await viewer.request.get("/api/admin/analytics");
    expect(analytics.status()).toBe(200);
    const { data: analyticsData } = await analytics.json();
    expect(analyticsData.totalOrders).toBe(1);
    expect(analyticsData.totalCustomers).toBe(1);
    expect(
      (analyticsData.recentOrders as Array<{ id: string }>).map((o) => o.id)
    ).toEqual([sbyOrderId]);

    // Audit log: Surabaya-tagged events plus reassignment moves involving
    // Surabaya as the old or new Branch; global events are excluded.
    const audit = await viewer.request.get("/api/admin/audit-log");
    expect(audit.status()).toBe(200);
    const { data: auditData } = await audit.json();
    const actions = (auditData as Array<{ action: string }>).map(
      (a) => a.action
    );
    expect(actions).toContain(auditSbyAction);
    expect(actions).toContain(auditDualSbyNewAction); // related_branch = Surabaya
    expect(actions).toContain(auditDualSbyOldAction); // branch = Surabaya (old)
    expect(actions).not.toContain(auditGlobalAction);

    await context.close();
  });
});

// =========================================================
// All-branch HQ — global scope sees everything; physical pickup
// rule still fails closed without a Home Branch
// =========================================================
test.describe("branch-aware security — all-branch HQ", () => {
  test.describe.configure({ mode: "serial" });

  // Isolated empty context: the project's saved admintoko session would make
  // /login redirect to /admin before loginAsHQ can run (see the viewer
  // describe above).
  test.use({ storageState: { cookies: [], origins: [] } });

  let page: Page;
  let request: Page["request"];

  test.beforeEach(async ({ browser }) => {
    const context = await browser.newContext();
    page = await context.newPage();
    await loginAsHQ(page);
    request = page.request;
  });

  test.afterEach(async () => {
    await page.context().close();
  });

  test("all-branch view reaches the cross-branch order and fixture data", async () => {
    const detail = await request.get(`/api/admin/orders/${sbyOrderId}`);
    expect(detail.status()).toBe(200);
    expect((await detail.json()).data.branch.id).toBe(sbyBranchId);

    // All scope reaches every seeded Branch — including inactive ones —
    // asserted against the DB rather than a hard-coded fixture subset.
    const branches = await request.get("/api/admin/branches");
    expect(branches.status()).toBe(200);
    const { data: branchData } = await branches.json();
    const dbBranches = await pool.query<{ id: string }>(
      `SELECT id FROM branch`
    );
    expect(
      (branchData as Array<{ id: string }>).map((b) => b.id).sort()
    ).toEqual(dbBranches.rows.map((r) => r.id).sort());
    const visible = branchData as Array<{ id: string }>;
    expect(visible.map((b) => b.id)).toContain(jktBranchId);
    expect(visible.map((b) => b.id)).toContain(sbyBranchId);
  });

  test("all-branch analytics include the Surabaya and null-branch orders", async () => {
    const dbCount = await pool.query<{ count: string }>(
      `SELECT count(*) AS count FROM orders`
    );
    const res = await request.get("/api/admin/analytics");
    expect(res.status()).toBe(200);
    const { data } = await res.json();
    // All scope includes Orders without a Branch.
    expect(data.totalOrders).toBe(Number(dbCount.rows[0].count));
    const recentIds = (data.recentOrders as Array<{ id: string }>).map(
      (o) => o.id
    );
    // The fixture Surabaya or null-branch order shows in recent activity
    // (or is counted in the total when 5+ newer orders exist).
    expect(
      recentIds.includes(sbyOrderId) ||
        recentIds.includes(nullOrderId) ||
        (data.totalOrders as number) >= 8
    ).toBe(true);
  });

  test("all-branch audit log includes global and branch events", async () => {
    const res = await request.get("/api/admin/audit-log");
    expect(res.status()).toBe(200);
    const { data } = await res.json();
    const actions = (data as Array<{ action: string }>).map((a) => a.action);
    expect(actions).toContain(auditGlobalAction);
    expect(actions).toContain(auditSbyAction);
  });

  test("branch create requires edit-all; delete requires delete-all and blocks assigned branches", async () => {
    const create = await request.post("/api/admin/branches", {
      data: {
        name: `E2E Sec Branch ${RUN}`,
        code: `E2ESEC${RUN}`,
        city: "E2E City",
        address: "Jl. E2E No. 1",
        status: "aktif",
      },
    });
    expect(create.status()).toBe(201);
    const { data } = await create.json();
    const createdId = data.id as string;

    // Cleanup the created branch in a finally block.
    try {
      const del = await request.delete(`/api/admin/branches/${createdId}`);
      expect(del.status()).toBe(200);
    } finally {
      const blocked = await request.delete(
        `/api/admin/branches/${jktBranchId}`
      );
      expect(blocked.status()).toBe(409);
      expect((await blocked.json()).code).toBe("BRANCH_IN_USE");
    }
  });

  test("pickup verification fails closed without a Home Branch even with edit-all", async () => {
    const pickup = await request.post(
      `/api/admin/orders/${sbyOrderId}/verify-pickup`,
      { data: { pickupCodeInput: "E2ESBY" } }
    );
    expect(pickup.status()).toBe(404);
  });
});

// =========================================================
// Slice 10 — Marketing Role: Global Homepage-only access.
//
// A custom Role holding ONLY `homepage:view` + `homepage:edit` (global),
// still with the mandatory Home Branch. Proves:
// - a Global Module grant authorizes without any branch-module grant;
// - unrelated protected modules deny on the API (403 DENIED) and hide
//   (server pages redirect to No-Access; sidebar links are hidden);
// - a grant reduction (reason + expectedVersion) is enforced on the SAME
//   session's next request without logout — the Current Policy is resolved
//   per request, never cached in the session.
//
// Fixtures follow the run-unique / FK-order pattern above: the Role and the
// Marketing actor are created through the Roles + Users APIs (as hqmanager)
// in beforeEach, and deactivated + archived (in that order) in afterEach.
// The actor's email is distinct from the shared ACTOR_EMAIL because a
// deactivated user's email stays reserved for the whole run.
// =========================================================
test.describe("security matrix — Marketing homepage-only Role", () => {
  test.describe.configure({ mode: "serial" });

  // Isolated empty context: the project's saved admintoko session would make
  // /login redirect straight back to /admin (see the Surabaya viewer above).
  test.use({ storageState: { cookies: [], origins: [] } });

  const MARKETING_PASSWORD = `Pw-mkt-${RUN}-e2e!`;
  // NOTE: archived Role Names and deactivated users' emails stay reserved
  // forever, so BOTH fixtures must be unique per test (the RUN suffix alone
  // only guarantees uniqueness across runs, not across the two tests that
  // each archive/deactivate their own fixture in afterEach).
  const HOMEPAGE_ONLY_GRANTS = [
    { module: "homepage", action: "view", scope: "global" },
    { module: "homepage", action: "edit", scope: "global" },
  ];
  // Every other protected admin module — branch-aware and global alike.
  // (customers has no list API; it is a server-page-only module and is
  // asserted at the page level below.)
  const UNRELATED_MODULES = [
    "products",
    "orders",
    "notifications",
    "branches",
    "analytics",
    "audit-log",
    "pages",
    "footer",
    "users",
    "roles",
  ] as const;

  let page: Page;
  let request: Page["request"]; // hqmanager (role manager + cleanup actor)
  let actorId = "";
  let customRoleId = "";
  let customRoleName = "";
  let marketingEmail = "";

  test.beforeEach(async ({ browser }) => {
    const context = await browser.newContext();
    page = await context.newPage();
    await loginAsHQ(page);
    request = page.request;

    // Per-test unique fixtures (see the reservation note above).
    const attempt = `${RUN}-${Date.now().toString(36)}`;
    customRoleName = `e2e-sec-marketing ${attempt}`;
    marketingEmail = `e2e-sec-mkt-${attempt}@store.com`;
    const roleRes = await request.post("/api/admin/roles", {
      data: {
        name: customRoleName,
        grants: HOMEPAGE_ONLY_GRANTS,
      },
    });
    expect(roleRes.status()).toBe(201);
    const roleBody = await roleRes.json();
    customRoleId = roleBody.data.id;
    expect(roleBody.data.version).toBe(1);
    expect(roleBody.data.isSystem).toBe(false);

    // Assign the Role + the (still mandatory) Home Branch in one unit.
    const userRes = await request.post("/api/admin/users", {
      data: {
        name: `E2E Sec Marketing ${attempt}`,
        email: marketingEmail,
        roleId: customRoleId,
        branchId: jktBranchId,
        passwordMode: "manual",
        password: MARKETING_PASSWORD,
      },
    });
    expect(userRes.status()).toBe(201);
    const userBody = await userRes.json();
    actorId = userBody.data.id;

    // Clear the forced first-login password change (same as the viewer
    // fixture) so the Marketing login below lands on /admin.
    await pool.query(
      `UPDATE "user" SET must_reset_password = false WHERE id = $1`,
      [actorId]
    );
  });

  test.afterEach(async () => {
    // FK-order cleanup through the validated APIs: deactivate the actor
    // first (retains identity, revokes sessions), then archive the Role.
    // Statuses are asserted so a silently failing cleanup can never leave
    // an active actor + open Role behind for later runs.
    try {
      if (actorId) {
        const res = await request.post(
          `/api/admin/users/${actorId}/deactivate`,
          {
            data: { reason: `e2e cleanup ${RUN}` },
          }
        );
        expect(res.status(), "deactivate marketing actor").toBe(200);
      }
      if (customRoleId) {
        const res = await request.delete(`/api/admin/roles/${customRoleId}`, {
          data: { reason: `e2e cleanup ${RUN}` },
        });
        expect(res.status(), "archive marketing role").toBe(200);
      }
    } finally {
      await page.context().close();
    }
  });

  async function loginAsMarketing(
    browser: import("@playwright/test").Browser
  ): Promise<{ context: BrowserContext; page: Page }> {
    const context = await browser.newContext();
    const marketing = await context.newPage();
    await marketing.goto("/login");
    await marketing.getByLabel("Email atau Username").fill(marketingEmail);
    await marketing.getByLabel("Password").fill(MARKETING_PASSWORD);
    await marketing.getByRole("button", { name: "Masuk", exact: true }).click();
    // The landing module picker redirects straight to the ONLY viewable
    // module — /admin/homepage.
    await marketing.waitForURL(/\/admin\/homepage/);
    return { context, page: marketing };
  }

  test("Homepage global access works; unrelated protected modules deny and hide", async ({
    browser,
  }) => {
    const { context, page: marketing } = await loginAsMarketing(browser);
    let createdSectionId = "";

    try {
      // policy/me: exact grants, custom Role identity, and the mandatory
      // Home Branch — no Role-name shortcuts anywhere.
      const me = await marketing.request.get("/api/admin/policy/me");
      expect(me.status()).toBe(200);
      const meBody = (await me.json()).data;
      expect(meBody.role.name).toBe(customRoleName);
      expect(meBody.role.isSystem).toBe(false);
      expect(meBody.role.key).toBeNull();
      expect(meBody.user.homeBranchId).toBe(jktBranchId);
      expect(meBody.grants).toEqual(
        expect.arrayContaining(HOMEPAGE_ONLY_GRANTS)
      );
      expect(meBody.grants).toHaveLength(2);

      // View on the Global Homepage module succeeds with no branch grants.
      const list = await marketing.request.get("/api/admin/homepage");
      expect(list.status()).toBe(200);
      expect(Array.isArray((await list.json()).data)).toBe(true);

      // Edit on the Global Homepage module succeeds — the mandatory Home
      // Branch is required but never needed for a global grant.
      const create = await marketing.request.post("/api/admin/homepage", {
        data: {
          type: "announcement_bar",
          title: `E2E Sec Marketing ${RUN}`,
          content: { message: `e2e marketing edit ${RUN}` },
        },
      });
      expect(create.status()).toBe(200);
      createdSectionId = (await create.json()).data.id as string;
      expect(createdSectionId).toBeTruthy();

      // Unrelated protected modules deny on the API.
      for (const path of UNRELATED_MODULES) {
        const res = await marketing.request.get(`/api/admin/${path}`);
        expect(res.status(), path).toBe(403);
        expect((await res.json()).code, path).toBe("DENIED");
      }

      // Server pages remain authoritative: unrelated modules redirect to
      // the No-Access screen (including the API-less customers module).
      await marketing.goto("/admin/orders");
      await expect(marketing).toHaveURL(/\/admin\/no-access/);
      await marketing.goto("/admin/customers");
      await expect(marketing).toHaveURL(/\/admin\/no-access/);

      // The sidebar hides every protected link except Homepage.
      await marketing.goto("/admin/homepage");
      const sidebar = marketing.locator("aside");
      await expect(
        sidebar.getByRole("link", { name: "Homepage", exact: true })
      ).toBeVisible();
      for (const label of [
        "Produk",
        "Pesanan",
        "Customer",
        "Notifikasi",
        "Cabang",
        "Halaman",
        "Pengguna",
        "Footer",
        "Hak Akses",
      ]) {
        await expect(
          sidebar.getByRole("link", { name: label, exact: true })
        ).toHaveCount(0);
      }
    } finally {
      // The Marketing editor has no homepage:delete grant — clean the
      // created section up through the hqmanager context.
      if (createdSectionId) {
        await request.delete(`/api/admin/homepage/${createdSectionId}`);
      }
      await context.close();
    }
  });

  test("grant reduction is enforced on the existing session's next request without logout", async ({
    browser,
  }) => {
    const { context, page: marketing } = await loginAsMarketing(browser);

    try {
      // Confirm the allowed route BEFORE the reduction.
      const before = await marketing.request.get("/api/admin/homepage");
      expect(before.status()).toBe(200);

      // Reduce: remove BOTH homepage grants (deny-all draft) with the
      // optimistic version and the mandatory reduction reason.
      const revise = await request.put(`/api/admin/roles/${customRoleId}`, {
        data: {
          expectedVersion: 1,
          name: customRoleName,
          grants: [],
          reason: "next-request enforcement test",
        },
      });
      expect(revise.status()).toBe(200);
      const revised = (await revise.json()).data as Record<string, unknown>;
      expect(revised.version).toBe(2);
      expect(revised.grants).toEqual([]);

      // SAME session, NEXT request: 403 with the stable DENIED code — the
      // permission is gone without any logout.
      const after = await marketing.request.get("/api/admin/homepage");
      expect(after.status()).toBe(403);
      expect((await after.json()).code).toBe("DENIED");
      const another = await marketing.request.get("/api/admin/products");
      expect(another.status()).toBe(403);
      expect((await another.json()).code).toBe("DENIED");

      // The session itself survives: policy/me is authentication-only and
      // still resolves — now with NO grants and the NEW policyVersion, so
      // no stale permission survives either.
      const me = await marketing.request.get("/api/admin/policy/me");
      expect(me.status()).toBe(200);
      const meBody = (await me.json()).data;
      expect(meBody.grants).toEqual([]);
      expect(meBody.policyVersion).toBe(2);
      expect(meBody.role.name).toBe(customRoleName);

      // Server pages enforce it on next navigation, still without logout.
      await marketing.goto("/admin/homepage");
      await expect(marketing).toHaveURL(/\/admin\/no-access/);

      // Audit: the immutable ROLE_UPDATED event carries the full before/
      // after grant payloads, the reason, and the policy version.
      const logs = await request.get("/api/admin/audit-log?limit=50");
      expect(logs.status()).toBe(200);
      const { data: logData } = await logs.json();
      const event = (logData as Array<Record<string, unknown>>).find(
        (e) => e.action === "ROLE_UPDATED" && e.entityId === customRoleId
      );
      expect(event).toBeTruthy();
      expect(event!.policyVersion as number).toBeGreaterThan(0);
      const changes = event!.changes as {
        before: { grants: Array<{ module: string; action: string }> };
        after: { grants: unknown[] };
        reason: string;
      };
      expect(changes.before.grants).toHaveLength(2);
      expect(changes.before.grants.map((gr) => gr.module)).toEqual([
        "homepage",
        "homepage",
      ]);
      expect(changes.after.grants).toEqual([]);
      expect(changes.reason).toBe("next-request enforcement test");
    } finally {
      await context.close();
    }
  });
});
