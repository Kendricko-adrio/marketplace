/**
 * Branch form layout contract (create + edit).
 *
 * Regression: /admin/branches/[id]/edit and /admin/branches/new rendered the
 * fields straight onto the page surface, so `Input`/`Textarea`/`select`
 * (`bg-background`, #F2F3F3) had EXACTLY the page background behind them and
 * the admin could not tell a field from the page. Every other admin editor
 * (Halaman, Pengguna, Footer, Diskon, Role) groups fields into `Card`
 * sections, whose white surface is what makes the field fill readable.
 *
 * This spec therefore pins the user-visible contract, not the JSX:
 *   1. each section is a labeled card (heading + description) and every
 *      field inside it sits on a surface whose colour DIFFERS from the
 *      field fill;
 *   2. the page header offers the same back-link + description as its peers;
 *   3. the actions row offers Batal next to the save button, and Batal
 *      leaves without persisting anything.
 *
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
      "branch-form-layout-mock.spec.ts must run under playwright.mock.config.ts: E2E_PROVIDER_MOCKS=true with E2E_MOCK_ADMIN_BASE_URL/E2E_MOCK_API_BASE_URL set"
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
        `branch-form-layout-mock.spec.ts refuses a non-loopback/foreign-port ${name} base (${raw}); the isolated mock ports are 3110/3111/3112`
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Fixture: one run-unique branch + the seeded HQ actor (branches edit)
// ---------------------------------------------------------------------------

const HQ = {
  identifier: process.env.E2E_ADMIN_HQ_IDENTIFIER || "hqmanager",
  password: process.env.E2E_ADMIN_HQ_PASSWORD || "hq123",
};

const FIXTURE_CODE = "E2EFMLAYOUT";
const FIXTURE_NAME = "E2E Form Layout Branch";
const FIXTURE_CITY = "Jakarta Pusat";
const FIXTURE_ADDRESS = "Jl. Fixture Layout No. 2";

// Canonical provider hierarchy — the create route refuses an incomplete origin.
const ORIGIN = {
  shippingPhone: "021999888777",
  shippingAddress: "Jl. Layout E2E No. 9",
  shippingPostalCode: "01234",
  shippingAreaId: "01010101",
  shippingProvinceId: "01",
  shippingCityId: "0101",
  shippingDistrictId: "010101",
} as const;

/** Section cards the admin must see, in order, on both pages. */
const SECTIONS = [
  {
    name: "Informasi Cabang",
    description:
      "Nama, kode, alamat, dan koordinat cabang yang tampil di storefront.",
  },
  {
    name: "Asal Pengiriman",
    description:
      "Wilayah Shipment wajib dipilih untuk semua cabang. Tidak mengubah kota atau alamat umum cabang.",
  },
  {
    name: "Jam Operasional",
    description: "Aktifkan hari buka, lalu atur jam layanan cabang.",
  },
] as const;

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
    { data: { username: identifier, password } }
  );
  expect(
    response.ok(),
    `HTTP sign-in seam failed for ${identifier}: ${await response.text()}`
  ).toBe(true);
}

function branchBody(overrides: Record<string, unknown> = {}) {
  return {
    name: FIXTURE_NAME,
    code: FIXTURE_CODE,
    city: FIXTURE_CITY,
    address: FIXTURE_ADDRESS,
    latitude: "",
    longitude: "",
    operatingHours: {},
    googleMapsUrl: "",
    status: "aktif",
    ...ORIGIN,
    ...overrides,
  };
}

/** The section card that owns `heading`, located by its rendered surface. */
function sectionCard(page: Page, heading: string) {
  return page
    .getByRole("heading", { name: heading, exact: true })
    .locator(
      'xpath=ancestor::div[contains(concat(" ", normalize-space(@class), " "), " bg-card ")][1]'
    );
}

/** Asserts the labeled card + field/surface contrast contract for `heading`. */
async function expectReadableSection(page: Page, heading: string) {
  const card = sectionCard(page, heading);
  await expect(card, `${heading} must render as a Card surface`).toHaveCount(1);

  // The field fill must differ from the surface behind it — the reported bug
  // was `field colour === page colour`, so the two sampled colours are the
  // assertion, not a class name.
  const colours = await card.evaluate((element) => {
    const field = element.querySelector<HTMLElement>(
      "input:not([type=hidden]), textarea, select"
    );
    if (!field) return null;
    return {
      surface: getComputedStyle(element).backgroundColor,
      fill: getComputedStyle(field).backgroundColor,
    };
  });
  expect(colours, `${heading} must contain at least one field`).not.toBeNull();
  expect(
    colours!.surface,
    `${heading}: the card surface must be opaque`
  ).not.toMatch(/rgba\(.*,\s*0(\.\d+)?\)$/);
  expect(
    colours!.fill,
    `${heading}: the field fill must differ from the surface behind it`
  ).not.toBe(colours!.surface);
}

// ---------------------------------------------------------------------------
// Fixture lifecycle
// ---------------------------------------------------------------------------

test.beforeAll(async ({ browser }) => {
  requireIsolatedMockRun();
  pool = new Pool({ connectionString: process.env.DATABASE_URL });

  // Heal leftovers from an interrupted previous run (deterministic code).
  await pool.query(`DELETE FROM branch WHERE code LIKE '${FIXTURE_CODE}%'`);

  hqContext = await browser.newContext({ baseURL: ADMIN_BASE_URL });
  await httpSignIn(hqContext, ADMIN_BASE_URL, HQ.identifier, HQ.password);

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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe("branch form layout", () => {
  test.describe.configure({ mode: "serial" });

  test("edit page groups fields into labeled cards on a distinct surface", async () => {
    const page = await hqContext.newPage();
    try {
      await page.goto(`/admin/branches/${branchId}/edit`);
      await expect(page.getByLabel("Nama Cabang")).toHaveValue(FIXTURE_NAME);

      // Page header matches the other admin editors (back-link + description).
      await expect(
        page.getByRole("link", { name: "Kembali ke daftar cabang" })
      ).toBeVisible();
      await expect(
        page.getByRole("heading", { name: "Edit Cabang", exact: true })
      ).toBeVisible();
      await expect(page.getByText(FIXTURE_CODE, { exact: false }).first()).toBeVisible();

      for (const section of SECTIONS) {
        await expect(
          page.getByRole("heading", { name: section.name, exact: true })
        ).toBeVisible();
        await expect(page.getByText(section.description)).toBeVisible();
        await expectReadableSection(page, section.name);
      }

      // The actions row offers Batal next to the primary save action.
      await expect(page.getByRole("button", { name: "Batal" })).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Simpan Perubahan" })
      ).toBeVisible();
    } finally {
      await page.close();
    }
  });

  test("Batal abandons the edit and returns to the branch list", async () => {
    const page = await hqContext.newPage();
    try {
      await page.goto(`/admin/branches/${branchId}/edit`);
      await page.getByLabel("Nama Cabang").fill("Nama Tidak Disimpan");
      await page.getByRole("button", { name: "Batal" }).click();
      await page.waitForURL("**/admin/branches");

      const persisted = (await (
        await hqContext.request.get(`/api/admin/branches/${branchId}`)
      ).json()) as { data?: { name?: string } };
      expect(
        persisted.data?.name,
        "Batal must not persist the edited name"
      ).toBe(FIXTURE_NAME);
    } finally {
      await page.close();
    }
  });

  test("create page shares the same card structure and can be cancelled", async () => {
    const page = await hqContext.newPage();
    try {
      await page.goto("/admin/branches/new");
      await expect(
        page.getByRole("link", { name: "Kembali ke daftar cabang" })
      ).toBeVisible();
      await expect(
        page.getByRole("heading", { name: "Tambah Cabang", exact: true })
      ).toBeVisible();

      for (const section of SECTIONS) {
        await expect(
          page.getByRole("heading", { name: section.name, exact: true })
        ).toBeVisible();
        await expectReadableSection(page, section.name);
      }

      await page.getByRole("button", { name: "Batal" }).click();
      await page.waitForURL("**/admin/branches");
    } finally {
      await page.close();
    }
  });
});
