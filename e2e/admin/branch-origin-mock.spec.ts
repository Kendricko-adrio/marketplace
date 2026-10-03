/**
 * Ticket 02 — mock-only branch shipping origin (browser + HTTP + audit seams).
 *
 * ONE Playwright spec that proves the branch-origin slice of ticket 02 WITHOUT
 * any live provider traffic (spec Ready, "Asal dan parcel"; tracker 02):
 *
 *   the seeded HQ actor (hqmanager — the only seeded identity with
 *   branches:edit, all-branch scope) opens the EXISTING Branch edit menu, sets
 *   the local shipping-origin complement once — sender phone, sender address,
 *   sender postal code and the optional Shipment area id (string incl.
 *   leading zeros) — saves through the existing "Simpan Perubahan" flow, the
 *   values persist through the branches API and the edit form re-fill, the
 *   edit lands as ONE audited UPDATE_BRANCH transaction, and an INVALID origin
 *   (bad phone/postal/area id) fails closed with the stored origin untouched.
 *
 * Independent source of truth: the literal fixture origin below (area id
 * "01010101" from the ticket-02 mock region chain, postal "10110" as the
 * Jakarta-Pusat-style literal) — never recomputed from the implementation.
 *
 * The "survives Jubelio sync" invariant is proven at the unit level
 * (packages/db/src/jubelio-sync.test.ts asserts the sync upsert's insert
 * values and conflict SET never contain shipping* keys); triggering a real
 * sync flow in E2E would need provider fixtures this slice does not own.
 *
 * Seams (pre-agreed):
 * - Browser: /admin/branches/{id}/edit — the existing Branch edit form; four
 *   NEW labeled inputs (proposed copy): "Telepon Pengirim", "Alamat Asal
 *   Kirim", "Kode Pos Asal Kirim", "Area ID Shipment (opsional)".
 * - Public HTTP: Better Auth sign-in (username seam, same-origin on isolated
 *   ports), POST/GET/DELETE /api/admin/branches(/id) guarded by branches:edit
 *   (all) — hqmanager — and PUT with invalid origin failing closed.
 * - Database fixture seam: the spec creates ONE run-unique fixture branch via
 *   the API (never the seeded branches) and deletes it in afterAll; audit_log
 *   counts are asserted around the mutation; NO live writes anywhere.
 *
 * RED UNTIL THE PARENT IMPLEMENTS (in this order):
 * 1. The branch schema misses the nullable shipping columns
 *    (shipping_phone/shipping_address/shipping_postal_code/shipping_area_id).
 *    The implementer adds them ONLY in packages/db/src/schema/branches.ts +
 *    `npm run db:push` (main applies).
 * 2. The Branch edit form lacks the four labeled origin inputs → the UI test
 *    fails on the absent "Telepon Pengirim" field (that IS the red).
 * 3. PUT /api/admin/branches/{id} still strips/ignores unknown origin keys and
 *    accepts invalid ones (the current zod is not strict about origin input)
 *    → the fail-closed test fails on the 4xx assertion.
 * 4. The branch service UPDATE SET list lacks the origin fields and the
 *    audit diff omits them → the API-persistence assertions fail (the unit
 *    branches-service.test.ts reds pin the service contract precisely).
 *
 * Run with the isolated mock config (never alongside the live suite); the
 * parent selects this spec by updating playwright.mock.config.ts:
 *   npx playwright test --config=playwright.mock.config.ts
 */
import { test, expect, type BrowserContext } from "@playwright/test";
import { Pool } from "pg";
import dotenv from "dotenv";
dotenv.config({ path: ".env" });

// ---------------------------------------------------------------------------
// Run-environment contract (also set by playwright.mock.config.ts; keep in sync)
// ---------------------------------------------------------------------------

const ADMIN_BASE_URL =
  process.env.E2E_MOCK_ADMIN_BASE_URL ?? "http://localhost:3111";
const MOCK_BASE_URL =
  process.env.E2E_MOCK_API_BASE_URL ?? "http://127.0.0.1:3112";
const MOCK_PORTS = new Set(["3110", "3111", "3112"]);

/** Fail closed unless the ISOLATED mock run (loopback flags pinned). */
function requireIsolatedMockRun(): void {
  if (
    process.env.E2E_PROVIDER_MOCKS !== "true" ||
    !process.env.E2E_MOCK_ADMIN_BASE_URL ||
    !process.env.E2E_MOCK_API_BASE_URL
  ) {
    throw new Error(
      "branch-origin-mock.spec.ts must run under playwright.mock.config.ts: E2E_PROVIDER_MOCKS=true with E2E_MOCK_ADMIN_BASE_URL/E2E_MOCK_API_BASE_URL set"
    );
  }
  for (const [name, raw] of [
    ["admin", ADMIN_BASE_URL],
    ["mock", MOCK_BASE_URL],
  ] as const) {
    const parsed = new URL(raw);
    const loopback =
      parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost";
    if (!loopback || !MOCK_PORTS.has(parsed.port)) {
      throw new Error(
        `branch-origin-mock.spec.ts refuses a non-loopback/foreign-port ${name} base (${raw}); the isolated mock ports are 3110/3111/3112`
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Fixture: one run-unique branch + the seeded HQ actor's origin values
// ---------------------------------------------------------------------------

// hqmanager is the seeded HQ Role identity (branches edit/delete ALL-branch —
// admintoko has no branches grants at all, see rbac-security.spec.ts). The
// login goes through the public Better Auth HTTP seam (username), same as
// pickup-mock.spec.ts, NOT through the UI (the UI login flows are locked to
// the canonical ports by .env.local).
const HQ = {
  identifier: process.env.E2E_ADMIN_HQ_IDENTIFIER || "hqmanager",
  password: process.env.E2E_ADMIN_HQ_PASSWORD || "hq123",
};

const FIXTURE_CODE = "E2EORIGIN";
const FIXTURE_NAME = "E2E Origin Mock Branch";
const FIXTURE_CITY = "Jakarta Pusat";
const FIXTURE_ADDRESS = "Jl. Fixture E2E Edit No. 1";

// Local shipping-origin complement (spec line "asal"): phone/address/postal
// required-valid, Shipment area_id optional. Values are independent literals
// (area id reuses the ticket-02 mock region chain incl. leading zeros).
const ORIGIN = {
  shippingPhone: "021999888777",
  shippingAddress: "Jl. Origin E2E No. 7, Gudang B",
  shippingPostalCode: "10110",
  shippingAreaId: "01010101",
} as const;

// Proposed form copy for the NEW labeled inputs in the existing edit menu
// (the implementer adds these four labels to BranchForm's edit mode).
const ORIGIN_LABELS = {
  shippingPhone: "Telepon Pengirim",
  shippingAddress: "Alamat Asal Kirim",
  shippingPostalCode: "Kode Pos Asal Kirim",
  shippingAreaId: "Area ID Shipment (opsional)",
} as const;

let pool: Pool;
let hqContext: BrowserContext;
let branchId = "";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Signs in a Better Auth session over public HTTP on the isolated origin. */
async function httpSignIn(
  context: BrowserContext,
  base: string,
  identifier: string,
  password: string
): Promise<void> {
  const response = await context.request.post(
    `${base}/api/auth/sign-in/username`,
    {
      data: { username: identifier, password },
    }
  );
  expect(
    response.ok(),
    `HTTP sign-in seam failed for ${identifier}: ${await response.text()}`
  ).toBe(true);
}

/** UPDATE_BRANCH audit events recorded for the fixture branch so far. */
async function countOriginAudits(id: string): Promise<number> {
  const result = await pool!.query<{ n: number }>(
    "SELECT count(*)::int AS n FROM audit_log WHERE action = 'UPDATE_BRANCH' AND entity_type = 'branch' AND entity_id = $1",
    [id]
  );
  return Number(result.rows[0]?.n ?? 0);
}

/**
 * Full branch body for PUT (the route is full-replace) — non-origin fields
 * stay identical to the created fixture so a delta can only come from origin
 * handling.
 */
function branchBody(overrides: Record<string, unknown> = {}) {
  return {
    name: FIXTURE_NAME,
    code: FIXTURE_CODE,
    city: FIXTURE_CITY,
    address: FIXTURE_ADDRESS,
    // Strings per the route zod (empty string → null after \"|| null\" mapping).
    latitude: "",
    longitude: "",
    operatingHours: {},
    googleMapsUrl: "",
    status: "aktif",
    ...overrides,
  };
}

/** Reads the branch through the public detail API (success envelope). */
async function readBranch(context: BrowserContext, id: string) {
  const response = await context.request.get(`/api/admin/branches/${id}`);
  expect(response.ok(), `branch detail failed: ${await response.text()}`).toBe(true);
  const body = (await response.json()) as { data?: Record<string, unknown> };
  return body.data ?? (body as unknown as Record<string, unknown>);
}

// ---------------------------------------------------------------------------
// Fixture lifecycle
// ---------------------------------------------------------------------------

test.beforeAll(async ({ browser }) => {
  requireIsolatedMockRun();
  pool = new Pool({ connectionString: process.env.DATABASE_URL });

  // Heal leftovers from an interrupted previous run (deterministic code).
  await pool.query(`DELETE FROM branch WHERE code LIKE '${FIXTURE_CODE}%'`);

  // Own session on the isolated origin (public HTTP sign-in seam).
  hqContext = await browser.newContext({ baseURL: ADMIN_BASE_URL });
  await httpSignIn(hqContext, ADMIN_BASE_URL, HQ.identifier, HQ.password);

  // Fixture branch THROUGH the guarded API seam (branches:edit all + audit) —
  // the rbac-security pattern: create as HQ, delete in a finally/afterAll.
  const create = await hqContext.request.post("/api/admin/branches", {
    data: branchBody(),
  });
  expect(
    create.status(),
    `fixture branch create failed: ${await create.text()}`
  ).toBe(201);
  const created = (await create.json()) as { data?: { id?: string } };
  branchId = String(created.data?.id ?? "");
  expect(branchId.length, "fixture branch id must be returned").toBeGreaterThan(0);
});

test.afterAll(async () => {
  // Cleanup is best-effort and fail-safe: the API seam delete is the audited
  // path; the deterministic SQL heal guarantees a clean next run regardless.
  if (hqContext && branchId && pool) {
    const res = await hqContext.request
      .delete(`/api/admin/branches/${branchId}`)
      .catch(() => null);
    if (!res || !res.ok()) {
      await pool
        .query(`DELETE FROM branch WHERE code LIKE '${FIXTURE_CODE}%'`)
        .catch(() => {});
    }
  }
  await hqContext?.close().catch(() => {});
  if (pool) await pool.end();
});

test.describe("mock-only branch shipping origin (ticket 02)", () => {
  // The whole spec shares one fixture branch: serial order, no extra workers.
  test.describe.configure({ mode: "serial" });

  test("the existing Branch edit menu sets the shipping origin once and persists it audited", async () => {
    const page = await hqContext!.newPage();
    await page.goto(`/admin/branches/${branchId}/edit`);
    await expect(page.getByLabel("Nama Cabang")).toBeVisible(); // existing form loaded

    const auditsBefore = await countOriginAudits(branchId!);

    // Fill the four origin inputs (proposed labels; see header doc).
    await page.getByLabel(ORIGIN_LABELS.shippingPhone, { exact: true }).fill(ORIGIN.shippingPhone);
    await page.getByLabel(ORIGIN_LABELS.shippingAddress, { exact: true }).fill(ORIGIN.shippingAddress);
    await page.getByLabel(ORIGIN_LABELS.shippingPostalCode, { exact: true }).fill(ORIGIN.shippingPostalCode);
    await page.getByLabel(ORIGIN_LABELS.shippingAreaId, { exact: true }).fill(ORIGIN.shippingAreaId);
    await page.getByRole("button", { name: /Simpan Perubahan/ }).click();
    await page.waitForURL("**/admin/branches");

    // Exactly ONE audited transaction for the origin edit.
    const auditsAfter = await countOriginAudits(branchId!);
    expect(auditsAfter, "the origin edit must land as ONE UPDATE_BRANCH audit event").toBe(
      auditsBefore + 1
    );

    // Persisted through the branches API — strings incl. leading zeros.
    const persisted = await readBranch(hqContext!, branchId!);
    expect(persisted).toMatchObject({
      shippingPhone: ORIGIN.shippingPhone,
      shippingAddress: ORIGIN.shippingAddress,
      shippingPostalCode: ORIGIN.shippingPostalCode,
      shippingAreaId: ORIGIN.shippingAreaId,
    });
    // The sender identity stays the branch NAME (spec: "Nama cabang menjadi
    // pengirim") — no other sender field is invented on this surface.
    expect(persisted.name).toBe(FIXTURE_NAME);

    // The edit menu re-fills the saved values (persisted roundtrip in UI).
    await page.goto(`/admin/branches/${branchId}/edit`);
    await expect(page.getByLabel(ORIGIN_LABELS.shippingPhone, { exact: true })).toHaveValue(
      ORIGIN.shippingPhone
    );
    await expect(page.getByLabel(ORIGIN_LABELS.shippingAddress, { exact: true })).toHaveValue(
      ORIGIN.shippingAddress
    );
    await expect(page.getByLabel(ORIGIN_LABELS.shippingPostalCode, { exact: true })).toHaveValue(
      ORIGIN.shippingPostalCode
    );
    await expect(page.getByLabel(ORIGIN_LABELS.shippingAreaId, { exact: true })).toHaveValue(
      ORIGIN.shippingAreaId
    );

    await page.close();
  });

  test("an invalid shipping origin fails closed and leaves the stored origin untouched", async () => {
    const page = await hqContext!.newPage();

    const auditsBefore = await countOriginAudits(branchId!);

    const rejected = await hqContext!.request.put(`/api/admin/branches/${branchId}`, {
      data: branchBody({
        shippingPhone: "belum-telepon",
        shippingAddress: "Jl. Sementara Tidak Sah",
        shippingPostalCode: "bukan-kode-pos",
        shippingAreaId: "bukan-angka",
      }),
    });
    expect(
      rejected.status(),
      `an invalid shipping origin must fail closed (4xx), got: ${await rejected.text()}`
    ).toBeGreaterThanOrEqual(400);

    // The last accepted origin survives byte-for-byte (the happy-path values).
    const persisted = await readBranch(hqContext!, branchId!);
    expect(persisted).toMatchObject({
      shippingPhone: ORIGIN.shippingPhone,
      shippingAddress: ORIGIN.shippingAddress,
      shippingPostalCode: ORIGIN.shippingPostalCode,
      shippingAreaId: ORIGIN.shippingAreaId,
    });
    expect(persisted.address, "the general branch address is NOT the sender block").toBe(
      FIXTURE_ADDRESS
    );

    // A rejected mutation leaves no Audit Event behind.
    expect(await countOriginAudits(branchId!)).toBe(auditsBefore);

    // The edit form still shows the SURVIVING values (not the rejected ones).
    await page.goto(`/admin/branches/${branchId}/edit`);
    await expect(page.getByLabel(ORIGIN_LABELS.shippingPhone, { exact: true })).toHaveValue(
      ORIGIN.shippingPhone
    );
    await expect(page.getByLabel(ORIGIN_LABELS.shippingPostalCode, { exact: true })).toHaveValue(
      ORIGIN.shippingPostalCode
    );

    await page.close();
  });
});