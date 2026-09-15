import {
  test,
  expect,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import { Pool } from "pg";
import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import dotenv from "dotenv";

// =========================================================
// Slice 6 — Role UI: list, editor, impact confirmation, safe browser
// states, and policy revalidation.
//
// The saved admin session is admintoko (Admin Role — NO roles grants), so
// this file opts out of the saved storage state and logs in explicitly:
// role-manager flows use the seeded HQ login (hqmanager — roles
// view/edit/delete, global scope); the No-Access flow uses a run-unique
// deny-all fixture user created directly in the DB.
//
// Fixtures are deterministic (run-unique `E2E Roles UI <case> <RUN>` names)
// and cleaned up in afterAll in FK order (audit_log → admin_session →
// admin_account → "user" → admin_role_grant → admin_role) so repeated runs
// stay isolated despite archived-name reservation.
//
// Covered (public browser behavior only — security semantics live in the
// API/RBAC specs):
// - searchable active list, explicit archived filter, System Owner visible
//   and immutable (list + editor);
// - new Role starts deny-all, unsupported actions/scopes cannot be
//   selected, only final Save creates it;
// - clone flow prefills an exact copy and only Save creates the copy;
// - editor saves a complete draft once (version bump);
// - reduction shows the exact grant diff + affected users and requires an
//   explicit reason before confirming;
// - two editors → visible stale-version conflict, no overwrite, retry;
// - archive block (active users / system Roles) and archive success with
//   restore review + validated restore;
// - deny-all user lands in the No-Access state (only recovery + logout);
// - failed policy refresh clears stale protected navigation/data and shows
//   the distinct Policy-Unavailable state with retry/recovery/logout;
//   successful retry restores the current policy without a logout;
// - policy revalidates on App Router navigation, window focus, and after
//   the centralized 403-revalidation event (browser seam).
// =========================================================

dotenv.config({ path: ".env" });

test.describe.configure({ mode: "serial" });

// Every login in this file is an explicit flow — start from empty contexts
// instead of the saved admintoko state (which would bounce /admin straight
// to /admin/no-access).
test.use({ storageState: { cookies: [], origins: [] } });

const RUN = Date.now().toString(36);
const PREFIX = "E2E Roles UI";
const HQ = { identifier: "hqmanager", password: "hq123" };
const DENY_USER_PASSWORD = `E2e-Roles-Ui-${RUN}-Pass!`;

let pool: Pool;
let hqRoleId = "";
let ownerRoleId = "";

// Fixture Role ids (deleted in afterAll in FK order).
let listRoleId = "";
let draftRoleId = "";
let reduceRoleId = "";
let staleRoleId = "";
let cloneRoleId = "";
let denyRoleId = "";
let denyUserId = "";

let hqPage: Page;
let hqRequest: Page["request"];
let hqContext: BrowserContext;
let hqUserId = "";

async function loginAs(
  page: Page,
  identifier: string,
  password: string
): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Email atau Username").fill(identifier);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Masuk", exact: true }).click();
  // Pathname check, not a glob: a successful login may land on exactly
  // `/admin` (no trailing segment), which `**/admin/**` cannot match. This
  // also cannot false-match `/login?callbackUrl=/admin` on a failed login —
  // a failed login stays on /login and still times out here.
  await page.waitForURL(
    (url) => url.pathname === "/admin" || url.pathname.startsWith("/admin/")
  );
}

/**
 * An isolated, unauthenticated browser context for explicit fixture-user
 * logins. Storage state is empty AND cookies are cleared so no saved or
 * leftover session can leak into the login flow (an authenticated session
 * makes the /login route bounce straight back to /admin before the
 * fixture-user credentials can be submitted).
 */
async function newIsolatedContext(browser: Browser): Promise<BrowserContext> {
  const context = await browser.newContext({
    storageState: { cookies: [], origins: [] },
  });
  await context.clearCookies();
  return context;
}

/**
 * Assert that the session in `request` really belongs to `expectedUserId` —
 * every fixture-user login in this file must prove the identity switch
 * before any No-Access / policy checks run (guards against a stale HQ or
 * saved admintoko session masquerading as the fixture identity).
 */
async function expectIdentity(
  request: Page["request"],
  expectedUserId: string
): Promise<void> {
  const res = await request.get("/api/admin/me");
  expect(res.status()).toBe(200);
  expect(await res.json()).toMatchObject({
    success: true,
    user: { id: expectedUserId },
  });
}

/**
 * Timeout-safe context cleanup. Playwright tears down worker contexts when a
 * test fails/times out, so a close may race that teardown — only close a
 * context that is still open and swallow any close error from a lost race.
 */
async function closeContextSafe(context: BrowserContext): Promise<void> {
  try {
    if (!context.isClosed()) await context.close();
  } catch {
    // Already closed by project teardown — nothing left to clean up.
  }
}

/** Role detail straight from the API (HQ session). */
async function getRole(id: string): Promise<Record<string, unknown>> {
  const res = await hqRequest.get(`/api/admin/roles/${id}`);
  expect(res.status()).toBe(200);
  return (await res.json()).data as Record<string, unknown>;
}

/**
 * Select a matrix cell scope. `comboboxIndex` picks the action column
 * (0 = Lihat/view, 1 = Ubah/edit, 2 = Hapus/delete) within the module row.
 */
async function setCell(
  page: Page,
  moduleLabel: string,
  comboboxIndex: number,
  option: string
): Promise<void> {
  const row = page.getByRole("row").filter({ hasText: moduleLabel });
  await row.getByRole("combobox").nth(comboboxIndex).click();
  await page.getByRole("option", { name: option }).click();
}

test.beforeAll(async ({ browser }) => {
  pool = new Pool({ connectionString: process.env.DATABASE_URL });

  const roles = await pool.query<{ id: string; key: string }>(
    `SELECT id, key FROM admin_role`
  );
  const hqUser = await pool.query<{ id: string }>(
    `SELECT id FROM "user" WHERE username = $1`,
    [HQ.identifier]
  );
  hqUserId = hqUser.rows[0]!.id;
  const byKey = new Map(roles.rows.map((r) => [r.key, r.id]));
  hqRoleId = byKey.get("hq")!;
  ownerRoleId = byKey.get("system_owner")!;

  const branch = await pool.query<{ id: string }>(
    `SELECT id FROM branch ORDER BY city LIMIT 1`
  );
  const branchId = branch.rows[0].id;

  // ---- Run-unique fixture Roles (deterministic, FK-ordered cleanup) ----
  const fixtureRoles: Array<{ id: string; name: string; grants: string[] }> = [
    {
      id: (listRoleId = crypto.randomUUID()),
      name: `${PREFIX} List ${RUN}`,
      grants: ["footer:view:global"],
    },
    {
      id: (draftRoleId = crypto.randomUUID()),
      name: `${PREFIX} Draft ${RUN}`,
      grants: ["pages:view:global"],
    },
    {
      id: (reduceRoleId = crypto.randomUUID()),
      name: `${PREFIX} Reduce ${RUN}`,
      grants: ["homepage:view:global", "homepage:edit:global"],
    },
    {
      id: (staleRoleId = crypto.randomUUID()),
      name: `${PREFIX} Stale ${RUN}`,
      grants: ["pages:view:global"],
    },
    {
      id: (cloneRoleId = crypto.randomUUID()),
      name: `${PREFIX} Clone ${RUN}`,
      grants: ["footer:view:global"],
    },
    {
      id: (denyRoleId = crypto.randomUUID()),
      name: `${PREFIX} Deny All ${RUN}`,
      grants: [],
    },
  ];

  for (const role of fixtureRoles) {
    await pool.query(
      `INSERT INTO admin_role (id, name, is_system, version)
       VALUES ($1, $2, false, 1)`,
      [role.id, role.name]
    );
    for (const grant of role.grants) {
      const [module, action, scope] = grant.split(":");
      await pool.query(
        `INSERT INTO admin_role_grant (id, role_id, module, action, scope)
         VALUES ($1, $2, $3, $4, $5)`,
        [crypto.randomUUID(), role.id, module, action, scope]
      );
    }
  }

  // ---- Deny-all fixture user (No-Access state) ----
  denyUserId = crypto.randomUUID();
  const passwordHash = await bcrypt.hash(DENY_USER_PASSWORD, 10);
  await pool.query(
    `INSERT INTO "user"
       (id, name, username, display_username, email, email_verified,
        role_id, branch_id, is_active, must_reset_password)
     VALUES ($1, $2, $3, $3, $4, true, $5, $6, true, false)`,
    [
      denyUserId,
      `E2E Roles UI Deny User ${RUN}`,
      `e2e.roles.ui.deny.${RUN}`,
      `e2e-roles-ui-deny-${RUN}@example.com`,
      denyRoleId,
      branchId,
    ]
  );
  await pool.query(
    `INSERT INTO admin_account (id, user_id, account_id, provider_id, password)
     VALUES ($1, $2, $2, 'credential', $3)`,
    [crypto.randomUUID(), denyUserId, passwordHash]
  );

  // ---- Shared HQ session (role manager) ----
  hqContext = await newIsolatedContext(browser);
  hqPage = await hqContext.newPage();
  await loginAs(hqPage, HQ.identifier, HQ.password);
  hqRequest = hqPage.request;
  // Isolation guard: the shared session must really be the HQ role manager
  // before any list/editor test runs on it.
  await expectIdentity(hqRequest, hqUserId);
});

test.afterAll(async () => {
  // FK-order cleanup of every fixture + UI-created Role (names match the
  // run-unique prefix), the deny-all user, and their audit trail. Direct DB
  // deletion keeps repeated runs isolated even though archived Role Names
  // stay reserved by design.
  //
  // Order matters: user_role_id_admin_role_id_fk is RESTRICT, so every
  // "user" row assigned to a fixture Role (the deny-all user, plus any user
  // a partially-run test touched) must be removed — with its sessions,
  // accounts, and audit trail — BEFORE the admin_role rows themselves.
  // admin_session/admin_account already cascade on user delete; the explicit
  // deletes keep the trail audit_log points at from dangling.
  if (pool) {
    // The name sweep also catches Roles created by UI tests, so cleanup is
    // resilient even when the run stops after a partial pass.
    const sweep = await pool.query<{ id: string }>(
      `SELECT id FROM admin_role WHERE name LIKE $1`,
      [`${PREFIX} %`]
    );
    const roleIds = sweep.rows.map((r) => r.id);
    if (denyUserId && !roleIds.includes(denyUserId)) {
      roleIds.push(denyUserId);
    }

    if (roleIds.length > 0) {
      // 1. Users holding a fixture Role → drop their dependent rows first.
      const users = await pool.query<{ id: string }>(
        `SELECT id FROM "user" WHERE role_id = ANY($1)`,
        [roleIds]
      );
      const userIds = users.rows.map((r) => r.id);
      if (userIds.length > 0) {
        await pool.query(`DELETE FROM audit_log WHERE entity_id = ANY($1)`, [
          userIds,
        ]);
        await pool.query(`DELETE FROM admin_session WHERE user_id = ANY($1)`, [
          userIds,
        ]);
        await pool.query(`DELETE FROM admin_account WHERE user_id = ANY($1)`, [
          userIds,
        ]);
        await pool.query(`DELETE FROM "user" WHERE id = ANY($1)`, [userIds]);
      }

      // 2. Only then the fixture Roles: audit trail → grants → roles.
      await pool.query(`DELETE FROM audit_log WHERE entity_id = ANY($1)`, [
        roleIds,
      ]);
      await pool.query(`DELETE FROM admin_role_grant WHERE role_id = ANY($1)`, [
        roleIds,
      ]);
      await pool.query(`DELETE FROM admin_role WHERE id = ANY($1)`, [roleIds]);
    }
    await pool.end();
  }
  await closeContextSafe(hqContext);
});

// =========================================================
// Searchable active list, archived filter, immutable System Owner
// =========================================================
test("list is searchable, archived Roles sit behind the explicit filter, and the System Owner is immutable", async () => {
  const roleName = `${PREFIX} List ${RUN}`;

  await hqPage.goto("/admin/roles");
  await expect(
    hqPage.getByRole("heading", { name: "Hak Akses Role" })
  ).toBeVisible();
  await expect(
    hqPage.getByRole("link", { name: "System Owner" })
  ).toBeVisible();

  // Search narrows the active list to the fixture Role only.
  await hqPage.getByLabel("Cari role").fill(roleName);
  await expect(hqPage.getByTestId("role-row")).toHaveCount(1);
  await expect(
    hqPage.getByTestId("role-row").filter({ hasText: roleName })
  ).toBeVisible();
  await expect(hqPage.getByText("Sistem · Owner")).toBeHidden();

  // Archive the fixture Role via the API (a roles:edit operation) — the UI
  // must then hide it from the default list and reveal it behind the
  // explicit archived filter with the retained-grants "Arsip" badge.
  const archived = await hqRequest.delete(`/api/admin/roles/${listRoleId}`, {
    data: { reason: "e2e archived-filter" },
  });
  expect(archived.status()).toBe(200);

  await hqPage.reload();
  await hqPage.getByLabel("Cari role").fill(roleName);
  await expect(hqPage.getByText("Tidak ada role yang cocok.")).toBeVisible({
    timeout: 10_000,
  });

  await hqPage.getByRole("switch").click();
  await expect(hqPage.getByTestId("role-row")).toHaveCount(1);
  const row = hqPage.getByTestId("role-row").filter({ hasText: roleName });
  await expect(row).toBeVisible();
  await expect(row.getByText("Arsip")).toBeVisible();
  // Archive bumps the version (retained grants stay visible to reviewers).
  await expect(row.locator("td").nth(2)).toHaveText("2");
});

test("System Owner is visible but immutable in the list and the editor", async () => {
  // List: the Owner row shows the immutable affordance instead of "Buka".
  const ownerRow = hqPage
    .getByTestId("role-row")
    .filter({ hasText: "System Owner" });
  await hqPage.goto("/admin/roles");
  await expect(ownerRow).toBeVisible();
  await expect(ownerRow.getByTestId("owner-immutable")).toHaveText("Tetap");
  await expect(ownerRow.getByRole("link", { name: "Buka" })).toHaveCount(0);

  // Editor: identity, grants, save, and archive are all locked down.
  await hqPage.goto(`/admin/roles/${ownerRoleId}`);
  await expect(hqPage.getByTestId("owner-immutable-note")).toBeVisible();
  await expect(hqPage.getByLabel("Nama Role")).toBeDisabled();
  await expect(hqPage.getByLabel("Deskripsi")).toBeDisabled();
  await expect(hqPage.getByTestId("role-save")).toHaveCount(0);
  await expect(hqPage.getByTestId("role-archive")).toHaveCount(0);
  // The Homepage row has one (disabled) combobox per action column
  // (Lihat/Ubah/Hapus) — assert every one of them deterministically instead
  // of a strict-single locator.
  const homepageRow = hqPage.getByRole("row").filter({ hasText: "Homepage" });
  await expect(homepageRow.getByRole("combobox")).toHaveCount(3);
  for (let i = 0; i < 3; i++) {
    await expect(homepageRow.getByRole("combobox").nth(i)).toBeDisabled();
  }
});

// =========================================================
// Deny-all create + unsupported cells
// =========================================================
test("new Role starts deny-all, unsupported actions/scopes cannot be selected, and only Save creates it", async () => {
  await hqPage.goto("/admin/roles/new");
  await expect(
    hqPage.getByRole("heading", { name: "Role Baru" })
  ).toBeVisible();
  await expect(hqPage.getByLabel("Nama Role")).toHaveValue("");

  // Branch modules: Produk edit is all-branches only and has no delete
  // action — the Hapus cell is inert ("—") and the scope selector cannot
  // offer own-branch for edit.
  const produkRow = hqPage.getByRole("row").filter({ hasText: "Produk" });
  await expect(produkRow.getByText("—", { exact: true })).toBeVisible();
  await expect(produkRow.getByRole("combobox")).toHaveCount(2);
  await produkRow.getByRole("combobox").nth(1).click();
  await expect(
    hqPage.getByRole("option", { name: "Cabang sendiri" })
  ).toHaveCount(0);
  await expect(
    hqPage.getByRole("option", { name: "Semua cabang" })
  ).toBeVisible();
  await hqPage.keyboard.press("Escape");

  // Global modules: no branch scope choice at all.
  const homepageRow = hqPage.getByRole("row").filter({ hasText: "Homepage" });
  await homepageRow.getByRole("combobox").nth(0).click();
  await expect(
    hqPage.getByRole("option", { name: "Cabang sendiri" })
  ).toHaveCount(0);
  await expect(
    hqPage.getByRole("option", { name: "Semua cabang" })
  ).toHaveCount(0);
  await expect(hqPage.getByRole("option", { name: "Global" })).toBeVisible();
  await hqPage.keyboard.press("Escape");

  // Deny-all draft: saving with no grants creates the Role atomically.
  const name = `${PREFIX} Deny Created ${RUN}`;
  await hqPage.getByLabel("Nama Role").fill(name);
  await hqPage.getByLabel("Deskripsi").fill("E2E deny-all draft");
  await hqPage.getByTestId("role-save").click();
  await hqPage.waitForURL(
    (url) =>
      /\/admin\/roles\/.+/.test(url.pathname) && !url.pathname.endsWith("/new")
  );
  const roleId = hqPage.url().split("/admin/roles/")[1]!;

  await expect(hqPage.getByText("Versi 1 · 0 pengguna")).toBeVisible();
  const role = await getRole(roleId);
  expect(role.name).toBe(name);
  expect(role.description).toBe("E2E deny-all draft");
  expect(role.grants).toEqual([]);
});

// =========================================================
// Clone flow
// =========================================================
test("clone prefills an exact draft copy and only Save creates the new Role", async () => {
  await hqPage.goto(`/admin/roles/${cloneRoleId}`);
  await expect(
    hqPage.getByRole("heading", { name: `${PREFIX} Clone ${RUN}` })
  ).toBeVisible();

  await hqPage
    .getByRole("link", { name: "Duplikat sebagai Role Baru" })
    .click();
  await hqPage.waitForURL("**/admin/roles/new?cloneFrom=*");
  await expect(hqPage.getByLabel("Nama Role")).toHaveValue(
    `${PREFIX} Clone ${RUN} - Salinan`
  );
  // The grant matrix carries the source's exact grants.
  const footerRow = hqPage.getByRole("row").filter({ hasText: "Footer" });
  await expect(footerRow.getByRole("combobox").nth(0)).toContainText("Global");

  await hqPage.getByTestId("role-save").click();
  await hqPage.waitForURL(
    (url) =>
      /\/admin\/roles\/.+/.test(url.pathname) && !url.pathname.endsWith("/new")
  );
  const roleId = hqPage.url().split("/admin/roles/")[1]!;

  await expect(hqPage.getByText("Versi 1 · 0 pengguna")).toBeVisible();
  const role = await getRole(roleId);
  expect(role.name).toBe(`${PREFIX} Clone ${RUN} - Salinan`);
  expect(role.version).toBe(1);
  expect(role.grants).toEqual([
    { module: "footer", action: "view", scope: "global" },
  ]);
});

// =========================================================
// Complete draft save
// =========================================================
test("editor saves a complete draft once and bumps the version", async () => {
  await hqPage.goto(`/admin/roles/${draftRoleId}`);
  await expect(
    hqPage.getByRole("heading", { name: `${PREFIX} Draft ${RUN}` })
  ).toBeVisible();
  await expect(hqPage.getByText("Versi 1 · 0 pengguna")).toBeVisible();

  await hqPage.getByLabel("Deskripsi").fill("E2E complete draft");
  await setCell(hqPage, "Halaman", 1, "Global");
  await hqPage.getByTestId("role-save").click();
  await expect(hqPage.getByTestId("role-editor-message")).toHaveText(
    "Perubahan role tersimpan."
  );
  await expect(hqPage.getByText("Versi 2 · 0 pengguna")).toBeVisible();

  const role = await getRole(draftRoleId);
  expect(role.version).toBe(2);
  expect(role.grants).toEqual([
    { module: "pages", action: "view", scope: "global" },
    { module: "pages", action: "edit", scope: "global" },
  ]);
});

// =========================================================
// Reduction impact: exact diff + affected users + required reason
// =========================================================
test("reduction shows the exact grant diff and requires an explicit reason", async () => {
  await hqPage.goto(`/admin/roles/${reduceRoleId}`);
  await expect(
    hqPage.getByRole("heading", { name: `${PREFIX} Reduce ${RUN}` })
  ).toBeVisible();

  // Drop homepage edit (all→none) — a reduction.
  await setCell(hqPage, "Homepage", 1, "Tidak diizinkan");
  await hqPage.getByTestId("role-save").click();

  const dialog = hqPage.getByTestId("impact-dialog");
  await expect(dialog).toBeVisible();
  await expect(hqPage.getByTestId("impact-diff")).toContainText(
    "Homepage · Ubah · Global"
  );
  await expect(hqPage.getByText("Pengguna aktif terdampak: 0")).toBeVisible();

  // The confirmation is locked until a reason is provided.
  const confirm = hqPage.getByTestId("impact-confirm");
  await expect(confirm).toBeDisabled();
  await hqPage.getByLabel("Alasan pengurangan").fill("Least-privilege cleanup");
  await confirm.click();

  await expect(dialog).toBeHidden();
  await expect(hqPage.getByTestId("role-editor-message")).toHaveText(
    "Perubahan role tersimpan."
  );
  await expect(hqPage.getByText("Versi 2 · 0 pengguna")).toBeVisible();

  const role = await getRole(reduceRoleId);
  expect(role.version).toBe(2);
  expect(role.grants).toEqual([
    { module: "homepage", action: "view", scope: "global" },
  ]);
});

// =========================================================
// Stale-version conflict: visible, no overwrite, retryable
// =========================================================
test("stale-version save shows a visible conflict, never overwrites the other editor, and retries cleanly", async () => {
  const otherName = `${PREFIX} Stale A ${RUN}`;
  const myName = `${PREFIX} Stale B ${RUN}`;

  await hqPage.goto(`/admin/roles/${staleRoleId}`);
  await expect(
    hqPage.getByRole("heading", { name: `${PREFIX} Stale ${RUN}` })
  ).toBeVisible();
  await expect(hqPage.getByText("Versi 1 · 0 pengguna")).toBeVisible();

  // Editor A (this browser) renames the draft but does not save yet.
  await hqPage.getByLabel("Nama Role").fill(myName);

  // Editor B saves first via the API.
  const other = await hqRequest.put(`/api/admin/roles/${staleRoleId}`, {
    data: {
      expectedVersion: 1,
      name: otherName,
      grants: [{ module: "pages", action: "view", scope: "global" }],
    },
  });
  expect(other.status()).toBe(200);

  // Editor A saves on the stale base version → 409, surfaced visibly.
  await hqPage.getByTestId("role-save").click();
  await expect(hqPage.getByTestId("stale-version-conflict")).toBeVisible();
  await expect(hqPage.getByText("Versi sudah kedaluwarsa")).toBeVisible();

  // No overwrite: the server state is still editor B's; the re-fetched
  // editor shows it instead of silently pushing the stale draft.
  const afterConflict = await getRole(staleRoleId);
  expect(afterConflict.name).toBe(otherName);
  expect(
    (afterConflict.grants as Array<{ action: string }>).map((g) => g.action)
  ).toEqual(["view"]);
  await expect(hqPage.getByRole("heading", { name: otherName })).toBeVisible();

  // Retry on the fresh version succeeds.
  await hqPage.getByLabel("Nama Role").fill(myName);
  await hqPage.getByTestId("role-save").click();
  await expect(hqPage.getByTestId("role-editor-message")).toHaveText(
    "Perubahan role tersimpan."
  );
  const retried = await getRole(staleRoleId);
  expect(retried.name).toBe(myName);
  expect(retried.version).toBe(3);
});

// =========================================================
// Archive block/success + restore review
// =========================================================
test("archive is blocked for system Roles and Roles with active users, and succeeds with a restore review for a clean custom Role", async () => {
  // System Roles expose no archive affordance at all.
  await hqPage.goto(`/admin/roles/${hqRoleId}`);
  await expect(hqPage.getByRole("heading", { name: "HQ" })).toBeVisible();
  await expect(hqPage.getByTestId("role-archive")).toHaveCount(0);

  // A custom Role with an active user is blocked at the seam (409).
  await hqPage.goto(`/admin/roles/${denyRoleId}`);
  await expect(hqPage.getByTestId("role-archive")).toBeVisible();
  await hqPage.getByTestId("role-archive").click();
  const dialog = hqPage.getByTestId("archive-dialog");
  await expect(dialog).toBeVisible();
  const confirm = hqPage.getByTestId("archive-confirm");
  await expect(confirm).toBeDisabled();
  await hqPage.getByLabel("Alasan pengarsipan").fill("e2e blocked attempt");
  await confirm.click();
  await expect(hqPage.getByTestId("role-editor-message")).toHaveText(
    "Reassign or deactivate the active users of this Role first"
  );
  await expect(dialog).toBeVisible();

  // Clean custom Role: archive succeeds and flips the editor into the
  // archived mode with the restore review of the retained grants.
  await hqPage.goto(`/admin/roles/${staleRoleId}`);
  await expect(
    hqPage.getByRole("heading", { name: `${PREFIX} Stale B ${RUN}` })
  ).toBeVisible();
  await hqPage.getByTestId("role-archive").click();
  await hqPage.getByLabel("Alasan pengarsipan").fill("e2e archive success");
  await hqPage.getByTestId("archive-confirm").click();

  await expect(hqPage.getByText("Diarsipkan")).toBeVisible();
  await expect(hqPage.getByTestId("restore-review")).toBeVisible();
  await expect(hqPage.getByTestId("restore-review")).toContainText(
    "Halaman · Lihat · Global"
  );
  await expect(hqPage.getByText("Izin tidak valid: —")).toBeVisible();
  await expect(hqPage.getByTestId("role-save")).toHaveCount(0);
  await expect(hqPage.getByLabel("Nama Role")).toBeDisabled();

  // Restore revalidates the reviewed draft and reactivates the Role.
  await hqPage.getByTestId("role-restore").click();
  await expect(hqPage.getByTestId("role-editor-message")).toHaveText(
    "Role berhasil diaktifkan kembali."
  );
  await expect(hqPage.getByTestId("restore-review")).toHaveCount(0);
  const restored = await getRole(staleRoleId);
  expect(restored.archived).toBe(false);
  expect(restored.version).toBe(5);
});

// =========================================================
// No-Access state
// =========================================================
test("deny-all user lands in the No-Access state with only recovery and logout", async ({
  browser,
}) => {
  // Isolated empty context + cleared cookies: a bare browser.newContext()
  // has been observed reusing the worker's HQ session, which keeps this test
  // on the HQ role editor instead of the fixture-user login flow.
  const context = await newIsolatedContext(browser);
  const page = await context.newPage();
  try {
    // The context must be truly unauthenticated before the fixture login.
    expect((await page.request.get("/api/admin/me")).status()).toBe(401);

    await loginAs(page, `e2e.roles.ui.deny.${RUN}`, DENY_USER_PASSWORD);
    // The login must actually switch the identity to the deny-all fixture
    // user before the No-Access checks mean anything.
    await expectIdentity(page.request, denyUserId);

    // The policy RESOLVED with zero view grants → the client gate swaps the
    // dashboard for the No-Access card: no protected content, no retry.
    await expect(page.getByTestId("safe-state")).toBeVisible({
      timeout: 15_000,
    });
    // CardTitle renders a <div>, so assert the safe-state card text, not a
    // heading role.
    await expect(page.getByTestId("safe-state")).toContainText(
      "Akses tidak tersedia"
    );
    await expect(
      page.getByRole("heading", { name: "Akses Terbatas" })
    ).toBeHidden();
    await expect(page.getByTestId("policy-retry")).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Produk" })).toBeHidden();

    // Server-side gates route protected modules to the same safe state.
    await page.goto("/admin/roles");
    await expect(page).toHaveURL(/\/admin\/no-access/);
    await expect(page.getByTestId("safe-state")).toBeVisible();

    // Logout is one of the two explicit recovery actions. toHaveURL instead
    // of a pending waitForURL — on teardown the navigation races Playwright's
    // context cleanup and a still-pending waitForURL would fail the run.
    await page.getByTestId("safe-state-logout").click();
    await expect(page).toHaveURL(/\/login/, { timeout: 15_000 });
  } finally {
    await closeContextSafe(context);
  }
});

// =========================================================
// Policy-Unavailable: stale clearing, retry, revalidation triggers
// =========================================================
test("failed policy refresh clears protected navigation and shows Policy-Unavailable; retry and revalidation triggers recover without logout", async ({
  browser,
}) => {
  // Same isolation as the deny-all test: own empty context + cleared
  // cookies, explicit HQ login, and an identity assertion, so the policy
  // blocking below can never act on a leaked stale session.
  const context = await newIsolatedContext(browser);
  const page = await context.newPage();
  try {
    await loginAs(page, HQ.identifier, HQ.password);
    await expectIdentity(page.request, hqUserId);
    const request = page.request;

    await page.goto("/admin/roles");
    await expect(
      page.getByRole("heading", { name: "Hak Akses Role" })
    ).toBeVisible();
    await expect(page.getByRole("link", { name: "Hak Akses" })).toBeVisible();

    const route = "**/api/admin/policy/me";
    const blockPolicy = async () => {
      await page.route(route, (r) => r.abort());
    };
    const unblockPolicy = async () => {
      await page.unroute(route);
    };

    // Trigger 1 — App Router navigation (pathname change): a client-side
    // sidebar navigation revalidates the policy; the failed refresh clears
    // the stale policy, so the gate drops the protected page and the sidebar
    // hides every protected link.
    //
    // The route block is armed BEFORE the click but only takes effect once
    // the pathname change has actually reached /admin/products: blocking
    // unconditionally would also abort the in-flight policy refresh from the
    // login/initial load, which clears the policy (and detaches the Produk
    // link) before Playwright can click it — a lost race, not the behavior
    // under test. Until then the request falls through untouched, so the
    // failed refresh below is exactly the navigation-triggered revalidation.
    await page.route(route, (r) =>
      new URL(page.url()).pathname === "/admin/products"
        ? r.abort()
        : r.fallback()
    );
    await page.getByRole("link", { name: "Produk" }).click();
    // The block is armed only after the navigation reached /admin/products —
    // make that order explicit before asserting the failed-refresh UI.
    await expect(page).toHaveURL(/\/admin\/products\/?$/, { timeout: 15_000 });
    await expect(page.getByTestId("safe-state")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId("safe-state")).toContainText(
      "Kebijakan akses tidak dapat dimuat"
    );
    await expect(page.getByTestId("policy-retry")).toBeVisible();
    await expect(page.getByRole("link", { name: "Produk" })).toBeHidden();
    // The protected page content (the products list) is gone with the stale
    // policy — the gate dropped it together with the navigation.
    await expect(page.getByText("Daftar Produk")).toBeHidden();
    await expect(
      page.getByRole("heading", { name: "Hak Akses Role" })
    ).toBeHidden();
    // A failed refresh never logs the user out.
    expect(page.url()).not.toContain("/login");

    // Successful retry restores the Current Policy without a logout.
    await unblockPolicy();
    await page.getByTestId("policy-retry").click();
    await expect(page.getByRole("link", { name: "Hak Akses" })).toBeVisible({
      timeout: 15_000,
    });
    await page.getByRole("link", { name: "Hak Akses" }).click();
    await expect(
      page.getByRole("heading", { name: "Hak Akses Role" })
    ).toBeVisible();
    await expect(page.getByTestId("safe-state")).toHaveCount(0);

    // Trigger 2 — window focus.
    await blockPolicy();
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(page.getByTestId("safe-state")).toBeVisible({
      timeout: 15_000,
    });
    await unblockPolicy();
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(
      page.getByRole("heading", { name: "Hak Akses Role" })
    ).toBeVisible({ timeout: 15_000 });

    // Trigger 3 — the centralized 403 revalidation event (the seam any 403
    // response dispatches through the policy-aware fetch).
    await blockPolicy();
    await page.evaluate(() =>
      window.dispatchEvent(new Event("rbac:policy-revalidate"))
    );
    await expect(page.getByTestId("safe-state")).toBeVisible({
      timeout: 15_000,
    });
    await unblockPolicy();
    await page.evaluate(() =>
      window.dispatchEvent(new Event("rbac:policy-revalidate"))
    );
    await expect(
      page.getByRole("heading", { name: "Hak Akses Role" })
    ).toBeVisible({ timeout: 15_000 });
    expect(page.url()).not.toContain("/login");
  } finally {
    await closeContextSafe(context);
  }
});
