import { test, expect, type Page } from "@playwright/test";
import { Pool } from "pg";
import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import dotenv from "dotenv";

// =========================================================
// Slice 5 — current-policy User RBAC APIs:
//   POST    /api/admin/users                  (strict roleId/Home Branch create)
//   GET     /api/admin/users                  (roleId/activity filters, no legacy role)
//   GET/PUT /api/admin/users/{id}             (strict assignment update)
//   POST    /api/admin/users/{id}/deactivate  (reason required, session revoke)
//   POST    /api/admin/users/{id}/reactivate  (validated under current policy)
//
// The actor is the seeded HQ login (hqmanager — users view/edit/delete,
// roles view/edit/delete, global scope) under the current DB-backed policy.
// Deterministic run-unique fixtures are created/cleaned by direct DB access
// in FK order (admin_session → admin_account → audit_log → "user" →
// admin_role_grant → admin_role). The tests share one fixture set and build
// on each other's state, so the file runs serially.
//
// BASELINE-AWARENESS (Owner safety):
//   Ambient (non-fixture) active System Owners — e.g. the bootstrapped
//   `owner` created by db:bootstrap-owner — are captured ONCE as an
//   immutable baseline and are NEVER deactivated, reactivated, demoted or
//   deleted by this file, not even temporarily: a crashed run must never
//   lock a production-like dev database out of its Owner. Every mutation
//   targets run-prefixed fixtures only, and after EVERY test (and again
//   after cleanup) the baseline identities are asserted still active and
//   unchanged.
//
// Coverage split for the last-active-Owner invariant:
//   - THIS file covers the HTTP surface baseline-adaptively. With a
//     zero baseline (fixture Owners are the only active Owners) the
//     concurrent-demotion race must produce exactly one 409
//     LAST_ACTIVE_OWNER; with baseline > 0 the ambient Owner preserves the
//     invariant, so BOTH fixture demotions must succeed and the ambient
//     population must return unchanged.
//   - The deterministic LAST_ACTIVE_OWNER rejection coverage is retained
//     outside this file: apps/admin/src/lib/rbac/users-planner.test.ts
//     (pure planner, otherActiveOwnerCount = 0 → LAST_ACTIVE_OWNER) and
//     apps/admin/src/lib/rbac/users-service-db.test.ts (DB transaction +
//     advisory-lock seam: serialization behind a half-open transaction and
//     the zero-baseline rejection, all on fixture rows only).
//
// Covered:
// - strict payload rejection of the legacy `role` field/filter;
// - required active roleId + mandatory Home Branch with atomic failure
//   (no partial user/account rows);
// - Authorization Ceiling, Owner-only promotion, self-assignment/branch;
// - deactivation: reason required, sessions revoked in-transaction, sign-in
//   blocked, identity/assignment retained;
// - last-active-Owner protection, adapted to the ambient Owner baseline
//   (zero-baseline rejection; baseline>0 permissive race + unchanged
//   ambient population);
// - validated reactivation (missing Home Branch / unusable Role) and
//   reserved inactive email/username.
// =========================================================

dotenv.config({ path: ".env" });

test.describe.configure({ mode: "serial" });

// Every login in this file is an explicit flow (HQ, viewer, member, blocked
// retry) — start from empty contexts instead of the saved admintoko state,
// which would redirect /login straight back to /admin.
test.use({ storageState: { cookies: [], origins: [] } });

const RUN = Date.now().toString(36);
const MEMBER_EMAIL = `e2e-urbac-member-${RUN}@example.com`;
const MEMBER_NAME = `E2E User RBAC Member ${RUN}`;
const MEMBER_PASSWORD = `E2e-Urbac-${RUN}-Pass!`;
const VIEWER_EMAIL = `e2e-urbac-viewer-${RUN}@example.com`;
const VIEWER_NAME = `E2E User RBAC Viewer ${RUN}`;
const VIEWER_PASSWORD = `E2e-Urbac-${RUN}-View!`;
const VIEWER_USERNAME = `e2e.urbac.viewer.${RUN}`;
const LEGACY_EMAIL = `e2e-urbac-legacy-${RUN}@example.com`;
// Throwaway password for DB-fixture users (only the viewer signs in, with
// VIEWER_PASSWORD).
const FIXTURE_PASSWORD = `E2e-Urbac-${RUN}-Fix!`;

let pool: Pool;
let hqRoleId = "";
let adminRoleId = "";
let ownerRoleId = "";
let jktBranchId = "";
let sbyBranchId = "";
let viewerRoleId = "";
let viewerId = "";
let memberId = "";
let owner1Id = "";
let owner2Id = "";
// Ambient (non-fixture) active System Owners captured in beforeAll as an
// IMMUTABLE baseline. This file never mutates them — not even temporarily —
// so a crashed run can never leave production-like dev state without an
// active Owner (the old deactivate-and-restore approach was unsafe).
interface BaselineOwnerRow {
  id: string;
  email: string;
  username: string | null;
  role_id: string;
  is_active: boolean;
}
let baselineOwnerRows: BaselineOwnerRow[] = [];

async function loginAs(
  page: Page,
  identifier: string,
  password: string
): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Email atau Username").fill(identifier);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Masuk", exact: true }).click();
  await page.waitForURL("**/admin/**");
}

interface Session {
  context: Awaited<ReturnType<Page["context"]>>;
  request: Page["request"];
}

/**
 * Fresh empty context + hqmanager login. The project's saved session is
 * admintoko (Admin Role — no users grants), so every Users-API actor here
 * logs in as the seeded HQ role manager.
 */
async function newHQSession(
  browser: import("@playwright/test").Browser
): Promise<Session> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await loginAs(page, "hqmanager", "hq123");
  return { context, request: page.request };
}

async function activeOwnerCount(): Promise<number> {
  const res = await pool.query<{ count: string }>(
    `SELECT count(*) AS count FROM "user" u
     JOIN admin_role r ON u.role_id = r.id
     WHERE r.key = 'system_owner' AND u.is_active = true`
  );
  return Number(res.rows[0].count);
}

/**
 * The captured baseline (non-fixture) active System Owners must be untouched:
 * still present, still active, still holding the Owner Role, with identical
 * identity columns. Called after EVERY test and again after cleanup so a
 * mutation of ambient Owner state can never slip through unnoticed.
 */
async function expectBaselineOwnersUnchanged(): Promise<void> {
  if (baselineOwnerRows.length === 0) return;
  const rows = await pool.query<{
    id: string;
    email: string;
    username: string | null;
    role_id: string;
    is_active: boolean;
  }>(
    `SELECT id, email, username, role_id, is_active FROM "user"
     WHERE id = ANY($1)`,
    [baselineOwnerRows.map((row) => row.id)]
  );
  const byId = new Map(rows.rows.map((row) => [row.id, row]));
  for (const base of baselineOwnerRows) {
    const now = byId.get(base.id);
    expect(now, `baseline Owner ${base.id} must still exist`).toBeTruthy();
    expect(now!.is_active, `baseline Owner ${base.id} must remain active`).toBe(
      true
    );
    expect(now!.email).toBe(base.email);
    expect(now!.username).toBe(base.username);
    expect(now!.role_id).toBe(base.role_id);
  }
}

test.beforeAll(async () => {
  pool = new Pool({ connectionString: process.env.DATABASE_URL });

  const roles = await pool.query<{ id: string; key: string }>(
    `SELECT id, key FROM admin_role`
  );
  const byKey = new Map(roles.rows.map((r) => [r.key, r.id]));
  hqRoleId = byKey.get("hq")!;
  adminRoleId = byKey.get("admin")!;
  ownerRoleId = byKey.get("system_owner")!;

  const branches = await pool.query<{ id: string; city: string }>(
    `SELECT id, city FROM branch`
  );
  jktBranchId =
    branches.rows.find((b) => b.city === "Jakarta Pusat")?.id ??
    branches.rows[0].id;
  sbyBranchId = branches.rows.find((b) => b.city !== "Jakarta Pusat")!.id;

  // Purge leftovers from interrupted runs of THIS file (run-unique
  // e2e-urbac-* fixtures only — never real data) in FK order, so stale
  // fixture Owners can never leak into the baseline capture below.
  const stale = await pool.query<{ id: string }>(
    `SELECT id FROM "user"
     WHERE email LIKE 'e2e-urbac-%' OR username LIKE 'e2e.urbac.%'`
  );
  if (stale.rows.length > 0) {
    const staleIds = stale.rows.map((row) => row.id);
    await pool.query(`DELETE FROM admin_session WHERE user_id = ANY($1)`, [
      staleIds,
    ]);
    await pool.query(`DELETE FROM admin_account WHERE user_id = ANY($1)`, [
      staleIds,
    ]);
    await pool.query(`DELETE FROM audit_log WHERE entity_id = ANY($1)`, [
      staleIds,
    ]);
    await pool.query(`DELETE FROM "user" WHERE id = ANY($1)`, [staleIds]);
  }

  // Baseline: active System Owners that exist BEFORE this run's fixtures
  // (e.g. the bootstrapped `owner` user created by db:bootstrap-owner).
  // Captured once, never mutated by this file; asserted unchanged after
  // every test and after cleanup.
  const baseline = await pool.query<BaselineOwnerRow>(
    `SELECT u.id, u.email, u.username, u.role_id, u.is_active FROM "user" u
     JOIN admin_role r ON u.role_id = r.id
     WHERE r.key = 'system_owner' AND u.is_active = true`
  );
  baselineOwnerRows = baseline.rows;
  // Exactly the baseline population is active right now (no leftover
  // fixture Owners from an interrupted run of this file).
  const ambientNow = await activeOwnerCount();
  expect(ambientNow).toBe(baselineOwnerRows.length);

  // ---- Direct DB fixtures (run-unique) ------------------------------
  // Custom ceiling boundary: users view/edit ONLY — deliberately below the
  // Admin Role so assignments above the ceiling fail.
  viewerRoleId = crypto.randomUUID();
  await pool.query(
    `INSERT INTO admin_role (id, name, is_system, version)
     VALUES ($1, $2, false, 1)`,
    [viewerRoleId, `E2E User RBAC Viewer Role ${RUN}`]
  );
  await pool.query(
    `INSERT INTO admin_role_grant (id, role_id, module, action, scope)
     VALUES
       ($1, $2, 'users', 'view', 'global'),
       ($3, $4, 'users', 'edit', 'global')`,
    [crypto.randomUUID(), viewerRoleId, crypto.randomUUID(), viewerRoleId]
  );

  const viewerHash = await bcrypt.hash(VIEWER_PASSWORD, 10);
  const fixtureHash = await bcrypt.hash(FIXTURE_PASSWORD, 10);
  viewerId = crypto.randomUUID();
  owner1Id = crypto.randomUUID();
  owner2Id = crypto.randomUUID();
  // Owner fixtures have NO Home Branch (the Owner Role accepts a null
  // branch) and skip the forced password reset (never used for sign-in).
  await pool.query(
    `INSERT INTO "user"
       (id, name, username, display_username, email, email_verified,
        role_id, branch_id, is_active, must_reset_password)
     VALUES
       ($1, $2, $3, $3, $4, true, $5, $6, true, false),
       ($7, $8, $9, $9, $10, true, $11, NULL, true, false),
       ($12, $13, $14, $14, $15, true, $11, NULL, true, false)`,
    [
      viewerId,
      VIEWER_NAME,
      VIEWER_USERNAME,
      VIEWER_EMAIL,
      viewerRoleId,
      sbyBranchId,
      owner1Id,
      "E2E User RBAC Owner One",
      `e2e.urbac.owner1.${RUN}`,
      `e2e-urbac-owner1-${RUN}@example.com`,
      ownerRoleId,
      owner2Id,
      "E2E User RBAC Owner Two",
      `e2e.urbac.owner2.${RUN}`,
      `e2e-urbac-owner2-${RUN}@example.com`,
    ]
  );
  await pool.query(
    `INSERT INTO admin_account (id, user_id, account_id, provider_id, password)
     VALUES
       ($1, $2, $2, 'credential', $3),
       ($4, $5, $5, 'credential', $6),
       ($7, $8, $8, 'credential', $6)`,
    [
      crypto.randomUUID(),
      viewerId,
      viewerHash,
      crypto.randomUUID(),
      owner1Id,
      fixtureHash,
      crypto.randomUUID(),
      owner2Id,
    ]
  );

  // The two fixture Owners were added EXACTLY on top of the immutable
  // baseline — the ambient Owner population is unchanged.
  expect(await activeOwnerCount()).toBe(baselineOwnerRows.length + 2);
  await expectBaselineOwnersUnchanged();
});

// After EVERY test: the immutable baseline Owners are still active and
// identical. This is the safety net that makes the never-mutate contract
// observable per test, not just at teardown.
test.afterEach(async () => {
  if (!pool) return;
  await expectBaselineOwnersUnchanged();
});

test.afterAll(async () => {
  if (!pool) return;
  const fixtureIds = [viewerId, memberId, owner1Id, owner2Id].filter(Boolean);
  // FK-order cleanup: sessions → accounts → audit events → users → grants → role.
  if (fixtureIds.length) {
    await pool.query(`DELETE FROM admin_session WHERE user_id = ANY($1)`, [
      fixtureIds,
    ]);
    await pool.query(`DELETE FROM admin_account WHERE user_id = ANY($1)`, [
      fixtureIds,
    ]);
    // Audit events reference fixture users by id (user_id FK is SET NULL).
    await pool.query(`DELETE FROM audit_log WHERE entity_id = ANY($1)`, [
      [...fixtureIds, viewerRoleId],
    ]);
    await pool.query(`DELETE FROM "user" WHERE id = ANY($1)`, [fixtureIds]);
  }
  await pool.query(`DELETE FROM admin_role_grant WHERE role_id = $1`, [
    viewerRoleId,
  ]);
  await pool.query(`DELETE FROM admin_role WHERE id = $1`, [viewerRoleId]);
  // Only run-prefixed fixture rows were removed. The immutable baseline
  // Owners were never touched — assert it one last time before disconnect.
  await expectBaselineOwnersUnchanged();
  await pool.end();
});

// =========================================================
// Strict payloads — the legacy `role` field/filter is gone
// =========================================================
test("rejects legacy role-name payloads and filters with strict 400s", async ({
  browser,
}) => {
  const { context, request } = await newHQSession(browser);
  try {
    // Legacy list filter → explicit removal code, not a silent ignore.
    const list = await request.get("/api/admin/users?role=hq");
    expect(list.status()).toBe(400);
    expect((await list.json()).code).toBe("LEGACY_FILTER_REMOVED");

    // Legacy create payload (`role` instead of `roleId`) — z.strictObject
    // rejects unknown keys → 400 INVALID_BODY.
    const create = await request.post("/api/admin/users", {
      data: {
        name: `E2E User RBAC Legacy ${RUN}`,
        email: LEGACY_EMAIL,
        role: "hq",
        passwordMode: "manual",
        password: MEMBER_PASSWORD,
      },
    });
    expect(create.status()).toBe(400);
    expect((await create.json()).code).toBe("INVALID_BODY");

    // Legacy update payload fails the same strict validation.
    const put = await request.put(`/api/admin/users/${viewerId}`, {
      data: { role: "hq" },
    });
    expect(put.status()).toBe(400);
    expect((await put.json()).code).toBe("INVALID_BODY");

    // Atomicity: the rejected create left no user row behind.
    const leftover = await pool.query<{ id: string }>(
      `SELECT id FROM "user" WHERE email = $1`,
      [LEGACY_EMAIL]
    );
    expect(leftover.rows).toHaveLength(0);
  } finally {
    await context.close();
  }
});

// =========================================================
// Create: valid active Role + mandatory Home Branch, atomic failure
// =========================================================
test("create requires a valid active roleId and Home Branch; failures are atomic", async ({
  browser,
}) => {
  const { context, request } = await newHQSession(browser);
  try {
    const attemptedEmails = [
      `e2e-urbac-invalid-role-${RUN}@example.com`,
      `e2e-urbac-no-branch-${RUN}@example.com`,
      `e2e-urbac-invalid-branch-${RUN}@example.com`,
    ];

    // Unknown roleId → INVALID_ROLE.
    const badRole = await request.post("/api/admin/users", {
      data: {
        name: MEMBER_NAME,
        email: attemptedEmails[0],
        roleId: crypto.randomUUID(),
        branchId: jktBranchId,
        passwordMode: "manual",
        password: MEMBER_PASSWORD,
      },
    });
    expect(badRole.status()).toBe(400);
    expect((await badRole.json()).code).toBe("INVALID_ROLE");

    // A non-Owner Role (HQ) requires exactly one Home Branch.
    const noBranch = await request.post("/api/admin/users", {
      data: {
        name: MEMBER_NAME,
        email: attemptedEmails[1],
        roleId: hqRoleId,
        passwordMode: "manual",
        password: MEMBER_PASSWORD,
      },
    });
    expect(noBranch.status()).toBe(400);
    expect((await noBranch.json()).code).toBe("BRANCH_REQUIRED");

    // Provided but nonexistent Home Branch → INVALID_BRANCH.
    const badBranch = await request.post("/api/admin/users", {
      data: {
        name: MEMBER_NAME,
        email: attemptedEmails[2],
        roleId: hqRoleId,
        branchId: crypto.randomUUID(),
        passwordMode: "manual",
        password: MEMBER_PASSWORD,
      },
    });
    expect(badBranch.status()).toBe(400);
    expect((await badBranch.json()).code).toBe("INVALID_BRANCH");

    // Atomic: no partial user/account rows survived any failure.
    const leftovers = await pool.query<{ id: string }>(
      `SELECT u.id FROM "user" u WHERE u.email = ANY($1)`,
      [attemptedEmails]
    );
    expect(leftovers.rows).toHaveLength(0);

    // Happy path: assignment + account + forced first-login reset in one unit.
    const created = await request.post("/api/admin/users", {
      data: {
        name: MEMBER_NAME,
        email: MEMBER_EMAIL,
        roleId: hqRoleId,
        branchId: jktBranchId,
        passwordMode: "manual",
        password: MEMBER_PASSWORD,
      },
    });
    expect(created.status()).toBe(201);
    const body = await created.json();
    memberId = body.data.id as string;
    expect(body.data.role.key).toBe("hq");
    expect(body.data.mustResetPassword).toBe(true);
    expect(typeof body.data.password).toBe("string");

    const dbUser = await pool.query<{
      role_id: string;
      branch_id: string;
      must_reset_password: boolean;
    }>(
      `SELECT role_id, branch_id, must_reset_password FROM "user" WHERE id = $1`,
      [memberId]
    );
    expect(dbUser.rows[0].role_id).toBe(hqRoleId);
    expect(dbUser.rows[0].branch_id).toBe(jktBranchId);
    expect(dbUser.rows[0].must_reset_password).toBe(true);
    const account = await pool.query<{ id: string }>(
      `SELECT id FROM admin_account WHERE user_id = $1 AND provider_id = 'credential'`,
      [memberId]
    );
    expect(account.rows).toHaveLength(1);

    // The member signs in later (deactivation spec); clear the forced reset.
    await pool.query(
      `UPDATE "user" SET must_reset_password = false WHERE id = $1`,
      [memberId]
    );

    // List filters use roleId + activity (no legacy role-name filter).
    const list = await request.get(
      `/api/admin/users?roleId=${hqRoleId}&active=true`
    );
    expect(list.status()).toBe(200);
    const listBody = await list.json();
    const listed = (listBody.data as Array<{ id: string }>).find(
      (u) => u.id === memberId
    );
    expect(listed).toBeTruthy();
  } finally {
    await context.close();
  }
});

// =========================================================
// Ceiling, Owner-only promotion, self-protection
// =========================================================
test("assignment respects the ceiling, Owner-only promotion, and self-protection", async ({
  browser,
}) => {
  const { context } = await newHQSession(browser);
  const viewerContext = await browser.newContext();
  try {
    // Actor: the viewer fixture (users view/edit global ONLY).
    const viewer = await viewerContext.newPage();
    await loginAs(viewer, VIEWER_EMAIL, VIEWER_PASSWORD);
    const viewerRequest = viewer.request;

    // The Admin Role grants branch operations above the viewer's users-only
    // ceiling → 403 CEILING_VIOLATION.
    const ceiling = await viewerRequest.post("/api/admin/users", {
      data: {
        name: `E2E User RBAC Above Ceiling ${RUN}`,
        email: `e2e-urbac-ceiling-${RUN}@example.com`,
        roleId: adminRoleId,
        branchId: jktBranchId,
        passwordMode: "manual",
        password: MEMBER_PASSWORD,
      },
    });
    expect(ceiling.status()).toBe(403);
    expect((await ceiling.json()).code).toBe("CEILING_VIOLATION");

    // Only an active System Owner may assign the Owner Role.
    const ownerPromotion = await viewerRequest.post("/api/admin/users", {
      data: {
        name: `E2E User RBAC Owner Try ${RUN}`,
        email: `e2e-urbac-owner-try-${RUN}@example.com`,
        roleId: ownerRoleId,
        passwordMode: "manual",
        password: MEMBER_PASSWORD,
      },
    });
    expect(ownerPromotion.status()).toBe(403);
    expect((await ownerPromotion.json()).code).toBe(
      "OWNER_ASSIGNMENT_REQUIRED"
    );

    // Self-assignment: the viewer cannot change its own Role. The stable
    // denial contract is the code (SELF_ASSIGNMENT); the service maps it to
    // 400 alongside the other invalid-assignment codes.
    const selfRole = await viewerRequest.put(`/api/admin/users/${viewerId}`, {
      data: { roleId: adminRoleId },
    });
    expect([400, 403]).toContain(selfRole.status());
    expect((await selfRole.json()).code).toBe("SELF_ASSIGNMENT");

    // Self-branch pivot: the viewer cannot move its own Home Branch.
    const selfBranch = await viewerRequest.put(
      `/api/admin/users/${viewerId}`,
      {
        data: { branchId: jktBranchId },
      }
    );
    expect(selfBranch.status()).toBe(403);
    expect((await selfBranch.json()).code).toBe("SELF_BRANCH");

    // No partial mutation: the viewer's assignment/branch are unchanged.
    const dbViewer = await pool.query<{ role_id: string; branch_id: string }>(
      `SELECT role_id, branch_id FROM "user" WHERE id = $1`,
      [viewerId]
    );
    expect(dbViewer.rows[0].role_id).toBe(viewerRoleId);
    expect(dbViewer.rows[0].branch_id).toBe(sbyBranchId);
  } finally {
    await viewerContext.close();
    await context.close();
  }
});

// =========================================================
// Deactivation: reason, session revocation, sign-in block, identity
// =========================================================
test("deactivation requires a reason, revokes sessions, blocks sign-in, preserves identity", async ({
  browser,
}) => {
  const { context, request } = await newHQSession(browser);
  const memberContext = await browser.newContext();
  try {
    // The member signs in — a live session must exist before deactivation.
    const memberPage = await memberContext.newPage();
    await loginAs(memberPage, MEMBER_EMAIL, MEMBER_PASSWORD);
    const sessionsBefore = await pool.query<{ count: string }>(
      `SELECT count(*) AS count FROM admin_session WHERE user_id = $1`,
      [memberId]
    );
    expect(Number(sessionsBefore.rows[0].count)).toBeGreaterThan(0);

    // Deactivation without a reason is rejected.
    const noReason = await request.post(
      `/api/admin/users/${memberId}/deactivate`,
      { data: {} }
    );
    expect(noReason.status()).toBe(400);
    expect((await noReason.json()).code).toBe("REASON_REQUIRED");

    // Deactivation with a reason flips activity and revokes every session
    // in the same transaction.
    const deactivated = await request.post(
      `/api/admin/users/${memberId}/deactivate`,
      { data: { reason: `e2e deactivation ${RUN}` } }
    );
    expect(deactivated.status()).toBe(200);
    expect((await deactivated.json()).data.isActive).toBe(false);

    const sessionsAfter = await pool.query<{ count: string }>(
      `SELECT count(*) AS count FROM admin_session WHERE user_id = $1`,
      [memberId]
    );
    expect(Number(sessionsAfter.rows[0].count)).toBe(0);

    // The revoked session is dead immediately — no cookie replay.
    const replay = await memberPage.request.get("/api/admin/policy/me");
    expect(replay.status()).toBe(401);

    // Future sign-in is blocked by the session-admission hook: the attempt
    // stays on /login with an error (the admission hook returns 403
    // INACTIVE_USER; the form surfaces its generic failure message) and no
    // session is created.
    const retryContext = await browser.newContext();
    const retryPage = await retryContext.newPage();
    await retryPage.goto("/login");
    await retryPage.getByLabel("Email atau Username").fill(MEMBER_EMAIL);
    await retryPage.getByLabel("Password").fill(MEMBER_PASSWORD);
    await retryPage.getByRole("button", { name: "Masuk", exact: true }).click();
    await expect(retryPage).toHaveURL(/\/login/);
    await expect(
      retryPage.getByText(/Account is deactivated|Email\/username atau password salah/)
    ).toBeVisible();
    const sessionCheck = await retryPage.request.get(
      "/api/admin/session-check"
    );
    expect((await sessionCheck.json()).authenticated).toBe(false);
    await retryContext.close();

    // Identity, assignment, and audit attribution are RETAINED.
    const dbMember = await pool.query<{
      email: string;
      username: string;
      role_id: string;
      branch_id: string;
      is_active: boolean;
    }>(
      `SELECT email, username, role_id, branch_id, is_active FROM "user" WHERE id = $1`,
      [memberId]
    );
    expect(dbMember.rows[0].email).toBe(MEMBER_EMAIL);
    expect(dbMember.rows[0].username).toBeTruthy();
    expect(dbMember.rows[0].role_id).toBe(hqRoleId);
    expect(dbMember.rows[0].branch_id).toBe(jktBranchId);
    expect(dbMember.rows[0].is_active).toBe(false);

    const detail = await request.get(`/api/admin/users/${memberId}`);
    expect(detail.status()).toBe(200);
    const detailBody = await detail.json();
    expect(detailBody.data.isActive).toBe(false);
    expect(detailBody.data.email).toBe(MEMBER_EMAIL);
    expect(detailBody.data.role.key).toBe("hq");
    expect(detailBody.data.branch.id).toBe(jktBranchId);

    // The inactive member is discoverable through the activity filter.
    const inactiveList = await request.get(
      `/api/admin/users?active=false&roleId=${hqRoleId}`
    );
    const inactiveBody = await inactiveList.json();
    expect(
      (inactiveBody.data as Array<{ id: string }>).some((u) => u.id === memberId)
    ).toBe(true);
  } finally {
    await memberContext.close();
    await context.close();
  }
});

// =========================================================
// Reserved identity across inactive users
// =========================================================
test("inactive users keep their email and username reserved", async ({
  browser,
}) => {
  const { context, request } = await newHQSession(browser);
  try {
    // Creating another user with the inactive member's email → 409.
    const emailClash = await request.post("/api/admin/users", {
      data: {
        name: `E2E User RBAC Clash ${RUN}`,
        email: MEMBER_EMAIL,
        roleId: hqRoleId,
        branchId: jktBranchId,
        passwordMode: "manual",
        password: MEMBER_PASSWORD,
      },
    });
    expect(emailClash.status()).toBe(409);
    expect((await emailClash.json()).code).toBe("IDENTITY_CONFLICT");

    // Updating a different user's email to the inactive member's → 409.
    const updateClash = await request.put(`/api/admin/users/${viewerId}`, {
      data: { email: MEMBER_EMAIL },
    });
    expect(updateClash.status()).toBe(409);
    expect((await updateClash.json()).code).toBe("IDENTITY_CONFLICT");

    // Usernames are reserved too: generation for the SAME display name
    // suffixes instead of reusing the inactive member's username.
    const member = await pool.query<{ username: string }>(
      `SELECT username FROM "user" WHERE id = $1`,
      [memberId]
    );
    const memberUsername = member.rows[0].username;
    const collider = await request.post("/api/admin/users", {
      data: {
        name: MEMBER_NAME,
        email: `e2e-urbac-collider-${RUN}@example.com`,
        roleId: hqRoleId,
        branchId: jktBranchId,
        passwordMode: "manual",
        password: MEMBER_PASSWORD,
      },
    });
    expect(collider.status()).toBe(201);
    const colliderBody = await collider.json();
    try {
      // Generation suffixes rather than reusing the reserved username.
      expect(colliderBody.data.username).toBe(`${memberUsername}2`);
    } finally {
      // Remove the throwaway collider directly (never used for sign-in).
      await pool.query(
        `DELETE FROM admin_session WHERE user_id = $1`,
        [colliderBody.data.id]
      );
      await pool.query(
        `DELETE FROM admin_account WHERE user_id = $1`,
        [colliderBody.data.id]
      );
      await pool.query(`DELETE FROM audit_log WHERE entity_id = $1`, [
        colliderBody.data.id,
      ]);
      await pool.query(`DELETE FROM "user" WHERE id = $1`, [
        colliderBody.data.id,
      ]);
    }
  } finally {
    await context.close();
  }
});

// =========================================================
// Reactivation is validated under the CURRENT policy
// =========================================================
test("reactivation validates the retained assignment under the current policy", async ({
  browser,
}) => {
  const { context, request } = await newHQSession(browser);
  try {
    // --- Member: missing required Home Branch blocks reactivation. ---
    await pool.query(`UPDATE "user" SET branch_id = NULL WHERE id = $1`, [
      memberId,
    ]);
    const blockedBranch = await request.post(
      `/api/admin/users/${memberId}/reactivate`,
      { data: { reason: "e2e reactivate" } }
    );
    expect(blockedBranch.status()).toBe(400);
    expect((await blockedBranch.json()).code).toBe("REACTIVATION_BLOCKED");
    const stillInactive = await pool.query<{ is_active: boolean }>(
      `SELECT is_active FROM "user" WHERE id = $1`,
      [memberId]
    );
    expect(stillInactive.rows[0].is_active).toBe(false);

    // Home Branch restored → reactivation succeeds.
    await pool.query(`UPDATE "user" SET branch_id = $2 WHERE id = $1`, [
      memberId,
      jktBranchId,
    ]);
    const reactivated = await request.post(
      `/api/admin/users/${memberId}/reactivate`,
      { data: { reason: "e2e reactivate ok" } }
    );
    expect(reactivated.status()).toBe(200);
    expect((await reactivated.json()).data.isActive).toBe(true);

    // Reactivating an ACTIVE user is a stable 409.
    const notInactive = await request.post(
      `/api/admin/users/${memberId}/reactivate`,
      { data: {} }
    );
    expect(notInactive.status()).toBe(409);
    expect((await notInactive.json()).code).toBe("USER_NOT_INACTIVE");

    // --- Viewer: an unusable (archived) Role blocks reactivation. ---
    const viewerDeactivated = await request.post(
      `/api/admin/users/${viewerId}/deactivate`,
      { data: { reason: `e2e deactivation ${RUN}` } }
    );
    expect(viewerDeactivated.status()).toBe(200);

    // Archive the retained viewer Role under the current policy (allowed:
    // the viewer is inactive). The retained assignment becomes unusable.
    const archived = await request.delete(`/api/admin/roles/${viewerRoleId}`, {
      data: { reason: `e2e archive ${RUN}` },
    });
    expect(archived.status()).toBe(200);

    const blockedRole = await request.post(
      `/api/admin/users/${viewerId}/reactivate`,
      { data: { reason: "e2e reactivate" } }
    );
    expect(blockedRole.status()).toBe(400);
    expect((await blockedRole.json()).code).toBe("ROLE_NOT_USABLE");

    // The viewer stays inactive — a blocked reactivation is not a pass.
    const viewerStillInactive = await pool.query<{ is_active: boolean }>(
      `SELECT is_active FROM "user" WHERE id = $1`,
      [viewerId]
    );
    expect(viewerStillInactive.rows[0].is_active).toBe(false);
  } finally {
    await context.close();
  }
});

// =========================================================
// Last-active-Owner invariant under concurrency (baseline-adaptive)
// =========================================================
test("concurrent demotions of the fixture Owners respect the ambient Owner baseline", async ({
  browser,
}) => {
  const { context, request } = await newHQSession(browser);
  try {
    // Sanity: the fixture pair sits EXACTLY on top of the immutable
    // baseline (beforeAll asserted the ambient population unchanged).
    expect(await activeOwnerCount()).toBe(baselineOwnerRows.length + 2);

    // Two concurrent cross-row demotions of the fixture Owners: the
    // Owner-invariant advisory lock serializes the invariant count across
    // the two DIFFERENT target rows. Demoting an Owner (no Home Branch) to
    // HQ needs an explicit target Home Branch — HQ is a branch-required
    // Role, so omitting one would 400 before the invariant is even
    // evaluated.
    const [first, second] = await Promise.all([
      request.put(`/api/admin/users/${owner1Id}`, {
        data: {
          roleId: hqRoleId,
          branchId: jktBranchId,
          reason: `e2e concurrent demotion ${RUN}`,
        },
      }),
      request.put(`/api/admin/users/${owner2Id}`, {
        data: {
          roleId: hqRoleId,
          branchId: jktBranchId,
          reason: `e2e concurrent demotion ${RUN}`,
        },
      }),
    ]);

    if (baselineOwnerRows.length === 0) {
      // Zero baseline: owner1/owner2 are the ONLY active Owners, so exactly
      // one demotion may eliminate the final remaining Owner — the other
      // must be refused with LAST_ACTIVE_OWNER.
      const statuses = [first.status(), second.status()].sort();
      expect(statuses).toEqual([200, 409]);

      const losing = first.status() === 409 ? first : second;
      expect((await losing.json()).code).toBe("LAST_ACTIVE_OWNER");

      // Exactly one active fixture Owner survives.
      expect(await activeOwnerCount()).toBe(1);
    } else {
      // Baseline > 0: the ambient Owner preserves the invariant, so BOTH
      // fixture demotions succeed and the active-Owner population returns
      // exactly to the immutable baseline (serialization must not
      // over-block when other active Owners exist).
      expect([first.status(), second.status()]).toEqual([200, 200]);
      expect(await activeOwnerCount()).toBe(baselineOwnerRows.length);
    }
  } finally {
    await context.close();
  }
});

test("the surviving last fixture Owner cannot be demoted or deactivated, even with a reason", async ({
  browser,
}) => {
  const { context, request } = await newHQSession(browser);
  try {
    if (baselineOwnerRows.length > 0) {
      // Baseline > 0: BOTH fixture Owners were legitimately demoted in the
      // previous test (the ambient Owner preserves the invariant), so no
      // fixture holds the Owner Role anymore and the HTTP-level
      // LAST_ACTIVE_OWNER rejection cannot be triggered without mutating
      // the immutable ambient baseline — which this file must never do.
      // The deterministic true-rejection coverage is retained elsewhere
      // (documented split, see the file header):
      //   - users-planner.test.ts: pure planner, otherActiveOwnerCount = 0
      //     → LAST_ACTIVE_OWNER (demotion AND deactivation paths);
      //   - users-service-db.test.ts: DB transaction + advisory-lock seam
      //     with zero-baseline LAST_ACTIVE_OWNER rejection assertions on
      //     fixture rows only.
      // Here we only assert that the invariant held: no active fixture
      // Owner remains and the ambient baseline is untouched.
      const ambient = await activeOwnerCount();
      expect(ambient).toBe(baselineOwnerRows.length);
      const fixtureOwners = await pool.query<{ id: string }>(
        `SELECT id FROM "user" WHERE id = ANY($1) AND role_id = $2 AND is_active = true`,
        [[owner1Id, owner2Id], ownerRoleId]
      );
      expect(fixtureOwners.rows).toHaveLength(0);
      await expectBaselineOwnersUnchanged();
      return;
    }

    // Zero baseline: still exactly one active Owner.
    expect(await activeOwnerCount()).toBe(1);
    // Both fixtures are active, but only one still HOLDS the Owner Role —
    // the demotion winner is active on HQ. The last active Owner is the
    // one whose retained assignment is still the Owner Role.
    const survivorRows = await pool.query<{ id: string }>(
      `SELECT id FROM "user" WHERE id = ANY($1) AND role_id = $2 AND is_active = true`,
      [[owner1Id, owner2Id], ownerRoleId]
    );
    expect(survivorRows.rows).toHaveLength(1);
    const survivor = survivorRows.rows[0].id;

    // A viable demotion payload (target Home Branch for the branch-required
    // HQ Role) proves the block comes from the Owner invariant, not from
    // branch validation — the response is 409 LAST_ACTIVE_OWNER.
    const demote = await request.put(`/api/admin/users/${survivor}`, {
      data: {
        roleId: hqRoleId,
        branchId: jktBranchId,
        reason: "e2e last owner demotion",
      },
    });
    expect(demote.status()).toBe(409);
    expect((await demote.json()).code).toBe("LAST_ACTIVE_OWNER");

    const deactivate = await request.post(
      `/api/admin/users/${survivor}/deactivate`,
      { data: { reason: "e2e last owner deactivation" } }
    );
    expect(deactivate.status()).toBe(409);
    expect((await deactivate.json()).code).toBe("LAST_ACTIVE_OWNER");

    // The invariant held: still exactly one active Owner.
    expect(await activeOwnerCount()).toBe(1);
  } finally {
    await context.close();
  }
});