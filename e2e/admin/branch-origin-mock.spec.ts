/**
 * Mandatory branch Shipment regions at browser, guarded API and audit seams.
 * Independent loopback fixtures: 01 → 0101 → 010101 → 01010101 / 01234.
 * Covers canonical create/edit/reopen, legacy completion, explicit retry,
 * missing options, same-postcode reset, stale responses and store isolation.
 * Local fixture rows only; sync ownership is covered by jubelio-sync.test.ts.
 * Run: npx playwright test --config=playwright.mock.config.ts
 */
import { test, expect, type BrowserContext, type Page } from "@playwright/test";
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

// Independent canonical provider hierarchy; sender data stays locally owned.
const ORIGIN = {
  shippingPhone: "021999888777",
  shippingAddress: "Jl. Origin E2E No. 7, Gudang B",
  shippingPostalCode: "01234",
  shippingAreaId: "01010101",
  shippingProvinceId: "01",
  shippingCityId: "0101",
  shippingDistrictId: "010101",
} as const;

// Existing sender labels remain stable; manual Area ID entry is removed.
const ORIGIN_LABELS = {
  shippingPhone: "Telepon Pengirim",
  shippingAddress: "Alamat Asal Kirim",
  shippingPostalCode: "Kode Pos Asal Kirim",
} as const;

async function selectRegion(page: Page) {
  for (const [label, value] of [["Provinsi Pengiriman", "01"], ["Kota/Kabupaten Pengiriman", "0101"], ["Kecamatan Pengiriman", "010101"], ["Kelurahan/Desa Pengiriman", "01010101"]]) {
    await page.getByLabel(label, { exact: true }).selectOption(value);
  }
}

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
    ...ORIGIN,
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

test.describe("mock-only verified branch shipping regions", () => {
  // The whole spec shares one fixture branch: serial order, no extra workers.
  test.describe.configure({ mode: "serial" });

  test("a store-only session cannot look up admin regions or mutate branches", async ({ browser }) => {
    const context = await browser.newContext({ baseURL: ADMIN_BASE_URL });
    try {
      const login = await context.request.post(`${process.env.E2E_MOCK_STORE_BASE_URL}/api/auth/sign-in/email`, { data: { email: process.env.E2E_STORE_EMAIL ?? "john@example.com", password: process.env.E2E_STORE_PASSWORD ?? "password123" } });
      expect(login.ok()).toBe(true);
      expect((await context.request.get("/api/admin/shipment/regions?level=provinces")).status()).toBe(401);
      expect((await context.request.post("/api/admin/branches", { data: branchBody() })).status()).toBe(401);
      expect((await context.request.put(`/api/admin/branches/${branchId}`, { data: branchBody() })).status()).toBe(401);
    } finally { await context.close(); }
  });

  test("creation requires a complete picker and stores canonical labels", async () => {
    const page = await hqContext.newPage();
    let createdId = "";
    try {
      await page.goto("/admin/branches/new");
      await page.getByLabel("Nama Cabang").fill("E2E Region Create");
      await page.getByLabel("Kode Cabang").fill(`${FIXTURE_CODE}NEW`);
      await page.getByLabel("Kota", { exact: true }).fill("General City");
      await page.getByLabel("Alamat", { exact: true }).fill("General Address");
      const save = page.getByRole("button", { name: "Buat Cabang", exact: true });
      await expect(save).toBeDisabled();
      await selectRegion(page);
      await expect(save).toBeEnabled();
      const response = page.waitForResponse((res) => res.url().endsWith("/api/admin/branches") && res.request().method() === "POST");
      await save.click();
      const created = await response;
      expect(created.status()).toBe(201);
      const row = (await created.json()).data;
      createdId = row.id;
      expect(row).toMatchObject({ shippingProvinceId: "01", shippingCityId: "0101", shippingDistrictId: "010101", shippingAreaId: "01010101", shippingPostalCode: "01234", shippingProvince: "Fixture Province", shippingArea: "Fixture Area", city: "General City", address: "General Address", shippingPhone: null, shippingAddress: null });
    } finally {
      if (createdId) await hqContext.request.delete(`/api/admin/branches/${createdId}`);
      await page.close();
    }
  });

  test("lookup failure blocks saving and explicit retry preserves unrelated inputs", async () => {
    const page = await hqContext.newPage();
    let fail = true;
    await page.route("**/api/admin/shipment/regions?*", async (route) => {
      if (fail && new URL(route.request().url()).searchParams.get("level") === "provinces") {
        await route.fulfill({ status: 503, json: { success: false, error: "Unavailable" } });
      } else await route.continue();
    });
    await page.goto(`/admin/branches/${branchId}/edit`);
    await page.getByLabel("Nama Cabang").fill("Preserve my input");
    await expect(page.getByRole("button", { name: "Simpan Perubahan" })).toBeDisabled();
    fail = false;
    await page.getByRole("button", { name: "Coba lagi — Provinsi Pengiriman" }).click();
    await expect(page.getByLabel("Nama Cabang")).toHaveValue("Preserve my input");
    await expect(page.getByRole("button", { name: "Simpan Perubahan" })).toBeEnabled();
    await page.close();
  });

  test("unavailable saved village requires correction rather than substitution", async () => {
    const page = await hqContext.newPage();
    await page.route("**/api/admin/shipment/regions?level=areas*", (route) => route.fulfill({ json: { success: true, data: [] } }));
    await page.goto(`/admin/branches/${branchId}/edit`);
    await expect(page.getByText("Wilayah tersimpan tidak tersedia. Pilih ulang wilayah ini.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Simpan Perubahan" })).toBeDisabled();
    await expect(page.getByLabel("Kode Pos Asal Kirim")).toHaveValue("01234");
    await expect(page.getByLabel("Kelurahan/Desa Pengiriman")).toHaveValue("01010101");
    await page.close();
  });

  test("parent changes clear same-postcode villages and ignore delayed old responses", async () => {
    const page = await hqContext.newPage();
    let releaseOld!: () => void;
    let oldStarted!: () => void;
    const started = new Promise<void>((resolve) => { oldStarted = resolve; });
    const oldDelay = new Promise<void>((resolve) => { releaseOld = resolve; });
    await page.route("**/api/admin/shipment/regions?*", async (route) => {
      const query = new URL(route.request().url()).searchParams;
      const level = query.get("level");
      const parent = query.get("parentId");
      if (level === "provinces") return route.fulfill({ json: { success: true, data: [{ id: "01", name: "Fixture Province" }, { id: "02", name: "Delayed Province" }, { id: "03", name: "Current Province" }] } });
      if (level === "areas" && parent === "010101") return route.fulfill({ json: { success: true, data: [{ id: "01010101", name: "Fixture Area", parentId: "010101", postalCode: "01234" }, { id: "01010102", name: "Same Postcode Area", parentId: "010101", postalCode: "01234" }] } });
      if (level === "cities" && parent === "02") {
        oldStarted();
        await oldDelay;
        await route.fulfill({ json: { success: true, data: [{ id: "0201", name: "Stale City", parentId: "02" }] } }).catch(() => {});
        return;
      }
      if (level === "cities" && parent === "03") return route.fulfill({ json: { success: true, data: [{ id: "0301", name: "Current City", parentId: "03" }] } });
      await route.continue();
    });
    try {
      await page.goto(`/admin/branches/${branchId}/edit`);
      await page.getByLabel("Kelurahan/Desa Pengiriman").selectOption("01010102");
      await expect(page.getByLabel("Kode Pos Asal Kirim")).toHaveValue("01234");
      await page.getByLabel("Kecamatan Pengiriman").selectOption("");
      await expect(page.getByLabel("Kelurahan/Desa Pengiriman")).toHaveValue("");
      await expect(page.getByLabel("Kode Pos Asal Kirim")).toHaveValue("");
      await page.getByLabel("Provinsi Pengiriman").selectOption("02");
      await started;
      await expect(page.getByLabel("Kota/Kabupaten Pengiriman")).toBeDisabled();
      await page.getByLabel("Provinsi Pengiriman").selectOption("03");
      await expect(page.getByLabel("Kota/Kabupaten Pengiriman")).toBeEnabled();
      releaseOld();
      await expect(page.getByLabel("Kota/Kabupaten Pengiriman").locator("option")).toHaveText(["Pilih wilayah", "Current City"]);
      await expect(page.getByLabel("Kecamatan Pengiriman")).toHaveValue("");
      await expect(page.getByLabel("Kelurahan/Desa Pengiriman")).toHaveValue("");
      await expect(page.getByLabel("Kode Pos Asal Kirim")).toHaveValue("");
      await expect(page.getByRole("button", { name: "Simpan Perubahan" })).toBeDisabled();
    } finally { releaseOld?.(); await page.close(); }
  });

  test("returning to an earlier parent cannot reuse its loaded options during a new request", async () => {
    const page = await hqContext.newPage();
    let delay = false;
    let release!: () => void;
    let started!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    const requested = new Promise<void>((resolve) => { started = resolve; });
    await page.route("**/api/admin/shipment/regions?*", async (route) => {
      const query = new URL(route.request().url()).searchParams;
      if (query.get("level") === "provinces") return route.fulfill({ json: { success: true, data: [{ id: "01", name: "Fixture Province" }, { id: "02", name: "Other Province" }] } });
      if (delay && query.get("level") === "cities" && query.get("parentId") === "01") { started(); await pending; }
      await route.continue().catch(() => {});
    });
    try {
      await page.goto(`/admin/branches/${branchId}/edit`);
      await expect(page.getByRole("button", { name: "Simpan Perubahan" })).toBeEnabled();
      await page.getByLabel("Provinsi Pengiriman").selectOption("02");
      delay = true;
      await page.getByLabel("Provinsi Pengiriman").selectOption("01");
      await requested;
      await expect(page.getByLabel("Kota/Kabupaten Pengiriman")).toBeDisabled();
      await expect(page.getByLabel("Kode Pos Asal Kirim")).toHaveValue("");
      release();
      await expect(page.getByLabel("Kota/Kabupaten Pengiriman")).toBeEnabled();
      await expect(page.getByLabel("Kota/Kabupaten Pengiriman")).toHaveValue("");
    } finally { release?.(); await page.close(); }
  });

  test("legacy pickup-only edits require region completion", async () => {
    await pool.query("UPDATE branch SET shipping_province_id=NULL, shipping_city_id=NULL, shipping_district_id=NULL WHERE id=$1", [branchId]);
    const page = await hqContext.newPage();
    try {
      await page.goto(`/admin/branches/${branchId}/edit`);
      await expect(page.getByText("Wilayah pengiriman cabang belum lengkap. Lengkapi pilihan sebelum menyimpan perubahan.")).toBeVisible();
      await expect(page.getByRole("button", { name: "Simpan Perubahan" })).toBeDisabled();
      await selectRegion(page);
      await expect(page.getByRole("button", { name: "Simpan Perubahan" })).toBeEnabled();
    } finally {
      await pool.query("UPDATE branch SET shipping_province_id='01', shipping_city_id='0101', shipping_district_id='010101' WHERE id=$1", [branchId]);
      await page.close();
    }
  });

  test("the existing Branch edit menu sets the shipping origin once and persists it audited", async () => {
    const page = await hqContext!.newPage();
    await page.goto(`/admin/branches/${branchId}/edit`);
    await expect(page.getByLabel("Nama Cabang")).toBeVisible(); // existing form loaded

    const auditsBefore = await countOriginAudits(branchId!);

    // Fill the four origin inputs (proposed labels; see header doc).
    await page.getByLabel(ORIGIN_LABELS.shippingPhone, { exact: true }).fill(ORIGIN.shippingPhone);
    await page.getByLabel(ORIGIN_LABELS.shippingAddress, { exact: true }).fill(ORIGIN.shippingAddress);
    await page.getByLabel("Provinsi Pengiriman", { exact: true }).selectOption("01");
    await page.getByLabel("Kota/Kabupaten Pengiriman", { exact: true }).selectOption("0101");
    await page.getByLabel("Kecamatan Pengiriman", { exact: true }).selectOption("010101");
    await page.getByLabel("Kelurahan/Desa Pengiriman", { exact: true }).selectOption("01010101");
    await expect(page.getByLabel(ORIGIN_LABELS.shippingPostalCode, { exact: true })).toHaveValue("01234");
    await expect(page.getByLabel(ORIGIN_LABELS.shippingPostalCode, { exact: true })).toHaveAttribute("readonly", "");
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
    await expect(page.getByLabel("Kelurahan/Desa Pengiriman", { exact: true })).toHaveValue(ORIGIN.shippingAreaId);
    await expect(page.getByLabel("Kota", { exact: true })).toHaveValue(FIXTURE_CITY);

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