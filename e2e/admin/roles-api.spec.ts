import { test, expect, type Page } from "@playwright/test";

// =========================================================
// Slice 4 — Role query/create/revise/impact/archive/restore APIs.
// The saved admin session is admintoko (Admin Role: NO roles grants), used
// for the denial specs. Role-manager specs log in as hqmanager (HQ Role:
// roles view/edit/delete, global scope).
//
// Roles are soft-archived and archived Role Names stay reserved, so every
// spec uses a run-unique name suffix and archives its fixture Roles at the
// end (best effort) to leave a clean, name-reserved trail.
// =========================================================

const RUN = Date.now().toString(36);
const PREFIX = "e2e-roles-api-";

type Grant = { module: string; action: string; scope: string };

const g = (module: string, action: string, scope: string): Grant => ({
  module,
  action,
  scope,
});

async function loginAsHQ(page: Page): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Email atau Username").fill("hqmanager");
  await page.getByLabel("Password").fill("hq123");
  await page.getByRole("button", { name: "Masuk", exact: true }).click();
  await page.waitForURL("**/admin/**");
}

async function createRole(
  request: Page["request"],
  body: Record<string, unknown>
): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await request.post("/api/admin/roles", { data: body });
  return { status: res.status(), json: await res.json() };
}

// =========================================================
// Denials — saved admintoko session has no Roles grants.
// =========================================================
test.describe("roles API — requires Roles grants", () => {
  test("list and detail are 403 without roles:view", async ({ request }) => {
    const list = await request.get("/api/admin/roles");
    expect(list.status()).toBe(403);
    expect((await list.json()).code).toBe("DENIED");

    const detail = await request.get(
      "/api/admin/roles/00000000-0000-0000-0000-000000000000"
    );
    expect(detail.status()).toBe(403);
  });

  test("create/revise/archive are 403 without roles:edit/delete", async ({
    request,
  }) => {
    const create = await createRole(request, {
      name: `${PREFIX}denied ${RUN}`,
      grants: [],
    });
    expect(create.status).toBe(403);

    const revise = await request.put(
      `/api/admin/roles/00000000-0000-0000-0000-000000000000`,
      {
        data: {
          expectedVersion: 1,
          name: `${PREFIX}denied ${RUN}`,
          grants: [],
        },
      }
    );
    expect(revise.status()).toBe(403);

    const archive = await request.delete(
      `/api/admin/roles/00000000-0000-0000-0000-000000000000`,
      { data: { reason: "should be denied" } }
    );
    expect(archive.status()).toBe(403);
  });
});

// =========================================================
// Role manager specs — fresh HQ login.
// =========================================================
test.describe("roles API — role manager (HQ)", () => {
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
    // Archive every Role created by the spec (best effort; fixtures have no
    // users so archiving always succeeds). Archived names stay reserved.
    try {
      const list = await request.get(
        `/api/admin/roles?q=${encodeURIComponent(PREFIX + RUN)}&archived=true`
      );
      if (list.status() !== 200) return;
      const { data } = await list.json();
      for (const role of data as Array<Record<string, unknown>>) {
        if (!role.isSystem && !role.archived) {
          await request.delete(`/api/admin/roles/${role.id}`, {
            data: { reason: "e2e cleanup" },
          });
        }
      }
    } finally {
      await page.context().close();
    }
  });

  test("role manager lists Roles with identity, version, counts, and grants", async () => {
    const res = await request.get("/api/admin/roles");
    expect(res.status()).toBe(200);
    const { data } = await res.json();
    const byKey = new Map(
      (data as Array<Record<string, unknown>>).map((r) => [r.key, r])
    );
    // Initial Roles are visible with their system/archive flags and version.
    const owner = byKey.get("system_owner");
    expect(owner).toBeTruthy();
    expect(owner!.isSystem).toBe(true);
    expect(owner!.archived).toBe(false);
    expect((owner!.version as number) >= 1).toBe(true);
    expect(byKey.get("hq")).toBeTruthy();
    expect(byKey.get("admin")).toBeTruthy();
  });

  test("creates a Role atomically and rejects invalid drafts", async () => {
    const name = `${PREFIX}create ${RUN}`;

    // Protected names cannot identify a custom Role.
    const protectedName = await createRole(request, {
      name: "System Owner",
      grants: [],
    });
    expect(protectedName.status).toBe(400);
    expect(protectedName.json.code).toBe("PROTECTED_NAME");

    // Invalid scope: products edit-own is not in the catalog (products edit
    // is all-branches only) — an unsupported tuple is INVALID_GRANTS and
    // must win over both the ceiling and the coverage verdict.
    const badScope = await createRole(request, {
      name: `${name} bad-scope`,
      grants: [g("products", "edit", "own_branch")],
    });
    expect(badScope.status).toBe(400);
    expect(badScope.json.code).toBe("INVALID_GRANTS");

    // Invalid coverage: homepage edit without homepage view.
    const badCoverage = await createRole(request, {
      name: `${name} bad-coverage`,
      grants: [g("homepage", "edit", "global")],
    });
    expect(badCoverage.status).toBe(400);
    expect(badCoverage.json.code).toBe("COVERAGE_VIOLATION");

    // Valid creation returns 201 with the final draft.
    const created = await createRole(request, {
      name,
      grants: [g("homepage", "view", "global"), g("homepage", "edit", "global")],
    });
    expect(created.status).toBe(201);
    const role = created.json.data as Record<string, unknown>;
    expect(role.version).toBe(1);
    expect(role.grants).toHaveLength(2);
  });

  test("Role Names are case-insensitively unique across active and archived Roles", async () => {
    const name = `${PREFIX}unique ${RUN}`;
    const first = await createRole(request, { name, grants: [] });
    expect(first.status).toBe(201);

    // Same name, different case + whitespace runs → 409.
    const clash = await createRole(request, {
      name: `${PREFIX}UNIQUE   ${RUN}`,
      grants: [],
    });
    expect(clash.status).toBe(409);
    expect(clash.json.code).toBe("DUPLICATE_NAME");

    // Archive the Role; the name stays reserved.
    const archived = await request.delete(
      `/api/admin/roles/${(first.json.data as Record<string, unknown>).id}`,
      { data: { reason: "reserve test" } }
    );
    expect(archived.status()).toBe(200);

    const reserved = await createRole(request, { name, grants: [] });
    expect(reserved.status).toBe(409);
    expect(reserved.json.code).toBe("DUPLICATE_NAME");
  });

  test("default list excludes archived Roles; archived filter shows them", async () => {
    const name = `${PREFIX}archive-list ${RUN}`;
    const created = await createRole(request, { name, grants: [] });
    const role = created.json.data as Record<string, unknown>;

    let list = await request.get(
      `/api/admin/roles?q=${encodeURIComponent(name)}`
    );
    expect((await list.json()).data).toHaveLength(1);

    const archived = await request.delete(`/api/admin/roles/${role.id}`, {
      data: { reason: "list test" },
    });
    expect(archived.status()).toBe(200);

    list = await request.get(`/api/admin/roles?q=${encodeURIComponent(name)}`);
    expect((await list.json()).data).toHaveLength(0);

    list = await request.get(
      `/api/admin/roles?q=${encodeURIComponent(name)}&archived=true`
    );
    const archivedRows = (await list.json()).data as Array<
      Record<string, unknown>
    >;
    expect(archivedRows).toHaveLength(1);
    expect(archivedRows[0]!.archived).toBe(true);
    // Retained grants survive archive (visible to the reviewer).
    expect(archivedRows[0]!.version as number).toBeGreaterThan(1);
  });

  test("non-Owner cannot revise the Role assigned to them or the immutable Owner", async () => {
    const list = await request.get("/api/admin/roles");
    const { data } = await list.json();
    const byKey = new Map(
      (data as Array<Record<string, unknown>>).map((r) => [r.key, r])
    );

    // The actor (hqmanager) is assigned the HQ Role: self-role revision is a
    // 403 even for a role manager.
    const selfRevise = await request.put(
      `/api/admin/roles/${(byKey.get("hq") as Record<string, unknown>).id}`,
      {
        data: {
          expectedVersion: 1,
          name: "HQ Renamed",
          grants: [],
        },
      }
    );
    expect(selfRevise.status()).toBe(403);
    expect((await selfRevise.json()).code).toBe("SELF_ROLE_REVISION");

    // System Owner is immutable for everyone.
    const ownerRevise = await request.put(
      `/api/admin/roles/${
        (byKey.get("system_owner") as Record<string, unknown>).id
      }`,
      {
        data: {
          expectedVersion: 1,
          name: "Owner Renamed",
          grants: [],
        },
      }
    );
    expect(ownerRevise.status()).toBe(403);
    expect((await ownerRevise.json()).code).toBe("OWNER_IMMUTABLE");
  });

  test("system Roles cannot be archived; a reason is required", async () => {
    const list = await request.get("/api/admin/roles");
    const { data } = await list.json();
    const hq = (data as Array<Record<string, unknown>>).find(
      (r) => r.key === "hq"
    );

    const noReason = await request.delete(`/api/admin/roles/${hq!.id}`, {
      data: {},
    });
    expect(noReason.status()).toBe(400);

    const archiveSystem = await request.delete(`/api/admin/roles/${hq!.id}`, {
      data: { reason: "should not be allowed" },
    });
    expect(archiveSystem.status()).toBe(403);
    expect((await archiveSystem.json()).code).toBe(
      "SYSTEM_ROLE_NOT_ARCHIVABLE"
    );
  });

  test("concurrent revisions from one base version: first wins, second gets 409 STALE_VERSION", async () => {
    const name = `${PREFIX}stale ${RUN}`;
    const created = await createRole(request, {
      name,
      grants: [g("pages", "view", "global")],
    });
    const role = created.json.data as Record<string, unknown>;
    expect(role.version).toBe(1);

    const first = await request.put(`/api/admin/roles/${role.id}`, {
      data: {
        expectedVersion: 1,
        name: `${name} A`,
        grants: [g("pages", "view", "global")],
      },
    });
    expect(first.status()).toBe(200);
    expect((await first.json()).data.version).toBe(2);

    // Second editor still based on version 1 → 409, no partial replacement.
    const second = await request.put(`/api/admin/roles/${role.id}`, {
      data: {
        expectedVersion: 1,
        name: `${name} B`,
        grants: [],
      },
    });
    expect(second.status()).toBe(409);
    expect((await second.json()).code).toBe("STALE_VERSION");

    const detail = await request.get(`/api/admin/roles/${role.id}`);
    const after = (await detail.json()).data as Record<string, unknown>;
    expect(after.name).toBe(`${name} A`);
    expect((after.grants as Grant[]).map((x) => x.action)).toContain("view");
  });

  test("reduction requires a reason; confirmed reduction writes full before/after audit", async () => {
    const name = `${PREFIX}reduce ${RUN}`;
    const created = await createRole(request, {
      name,
      grants: [g("homepage", "view", "global"), g("homepage", "edit", "global")],
    });
    const role = created.json.data as Record<string, unknown>;

    // Dropping the edit grant is a reduction → reason required.
    const noReason = await request.put(`/api/admin/roles/${role.id}`, {
      data: {
        expectedVersion: 1,
        name,
        grants: [g("homepage", "view", "global")],
      },
    });
    expect(noReason.status()).toBe(400);
    expect((await noReason.json()).code).toBe("REDUCTION_REASON_REQUIRED");

    // Impact preview reports the reduction and the affected-user count.
    const impact = await request.post(`/api/admin/roles/${role.id}/impact`, {
      data: { grants: [g("homepage", "view", "global")] },
    });
    expect(impact.status()).toBe(200);
    const preview = (await impact.json()).data as Record<string, unknown>;
    expect(preview.reduction).toBe(true);
    expect(preview.affectedActiveUsers).toBe(0);
    const removed = preview.diff as { removed: Grant[] };
    expect(removed.removed).toEqual([g("homepage", "edit", "global")]);

    // Confirmed reduction with a reason.
    const confirmed = await request.put(`/api/admin/roles/${role.id}`, {
      data: {
        expectedVersion: 1,
        name,
        grants: [g("homepage", "view", "global")],
        reason: "Least-privilege cleanup",
      },
    });
    expect(confirmed.status()).toBe(200);
    expect((await confirmed.json()).data.version).toBe(2);

    // The audit event records actor, before/after, and the policy version.
    const logs = await request.get("/api/admin/audit-log?limit=50");
    expect(logs.status()).toBe(200);
    const { data } = await logs.json();
    const event = (data as Array<Record<string, unknown>>).find(
      (e) => e.action === "ROLE_UPDATED" && e.entityId === role.id
    );
    expect(event).toBeTruthy();
    expect((event!.policyVersion as number) > 0).toBe(true);
    const changes = event!.changes as {
      before: { name: string; grants: Grant[] };
      after: { name: string; grants: Grant[] };
      reason: string;
    };
    expect(changes.before.name).toBe(name);
    expect(changes.before.grants).toHaveLength(2);
    expect(changes.after.grants).toEqual([g("homepage", "view", "global")]);
    expect(changes.reason).toBe("Least-privilege cleanup");
  });

  test("detail fetches an archived Role by id; restore review stays separately validated", async () => {
    const name = `${PREFIX}archived-detail ${RUN}`;
    const created = await createRole(request, {
      name,
      grants: [g("homepage", "view", "global")],
    });
    expect(created.status).toBe(201);
    const role = created.json.data as Record<string, unknown>;
    const version = role.version as number;

    const archived = await request.delete(`/api/admin/roles/${role.id}`, {
      data: { reason: "detail regression" },
    });
    expect(archived.status()).toBe(200);

    // The archived Role stays fetchable by id (roles:view) so the editor can
    // show the archived mode and restore review; only the default LIST
    // excludes archived Roles (pinned by its own test above).
    const detail = await request.get(`/api/admin/roles/${role.id}`);
    expect(detail.status()).toBe(200);
    const detailBody = (await detail.json()).data as Record<string, unknown>;
    expect(detailBody.id).toBe(role.id);
    expect(detailBody.name).toBe(name);
    expect(detailBody.archived).toBe(true);
    // Grants are retained and the archive bumped the version.
    expect(detailBody.grants).toEqual([g("homepage", "view", "global")]);
    expect(detailBody.version).toBe(version + 1);

    // Restore review remains separately validated: it exists for the
    // archived Role and its POST still rejects a non-archived/unknown Role,
    // not implicitly through the detail endpoint.
    const review = await request.get(`/api/admin/roles/${role.id}/restore`);
    expect(review.status()).toBe(200);
    const reviewBody = (await review.json()).data as Record<string, unknown>;
    expect(reviewBody.validGrants).toEqual([g("homepage", "view", "global")]);

    const missingReview = await request.get(
      `/api/admin/roles/00000000-0000-0000-0000-000000000000/restore`
    );
    expect(missingReview.status()).toBe(404);

    // The default list still hides the archived Role.
    const list = await request.get(
      `/api/admin/roles?q=${encodeURIComponent(name)}`
    );
    expect((await list.json()).data).toHaveLength(0);
  });

  test("archive blocks, restore reviews retained grants and revalidates", async () => {
    const name = `${PREFIX}restore ${RUN}`;
    const created = await createRole(request, {
      name,
      grants: [g("footer", "view", "global")],
    });
    const role = created.json.data as Record<string, unknown>;
    const version = role.version as number;

    // Archive (custom Role, no users, reason present).
    const archived = await request.delete(`/api/admin/roles/${role.id}`, {
      data: { reason: "restore flow test" },
    });
    expect(archived.status()).toBe(200);
    const archivedBody = (await archived.json()).data as Record<
      string,
      unknown
    >;
    expect(archivedBody.archived).toBe(true);
    // Grants are RETAINED so the reviewer sees them.
    expect(archivedBody.grants).toEqual([g("footer", "view", "global")]);

    // Restore review exposes the retained grants under the current catalog.
    const review = await request.get(`/api/admin/roles/${role.id}/restore`);
    expect(review.status()).toBe(200);
    const reviewBody = (await review.json()).data as Record<string, unknown>;
    expect(reviewBody.validGrants).toEqual([g("footer", "view", "global")]);
    expect(reviewBody.invalidGrants).toEqual([]);

    // Restore with a stale version → 409.
    const stale = await request.post(`/api/admin/roles/${role.id}/restore`, {
      data: {
        expectedVersion: version - 1,
        name,
        grants: [g("footer", "view", "global")],
      },
    });
    expect(stale.status()).toBe(409);
    expect((await stale.json()).code).toBe("STALE_VERSION");

    // Restore revalidates the draft and bumps the version.
    const restored = await request.post(`/api/admin/roles/${role.id}/restore`, {
      data: {
        expectedVersion: version + 1,
        name,
        grants: [g("footer", "view", "global"), g("footer", "edit", "global")],
      },
    });
    expect(restored.status()).toBe(200);
    const restoredBody = (await restored.json()).data as Record<
      string,
      unknown
    >;
    expect(restoredBody.archived).toBe(false);
    expect(restoredBody.version).toBe(version + 2);
    expect(restoredBody.grants).toHaveLength(2);
  });
});