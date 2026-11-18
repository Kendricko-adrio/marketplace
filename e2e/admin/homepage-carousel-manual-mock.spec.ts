/**
 * Carousel produk — preview manual dan simpan dari mode default.
 *
 * Contract (spec `.scratch/homepage-cms/plan/carousel-manual-preview-dan-simpan.md`):
 *   AC-01 the manual editor shows "Preview Produk Pilihan" and cards
 *         appear/disappear with the selection;
 *   AC-02 picks survive picker paging/search, and preview order follows the
 *         reorder buttons — including a product outside the first result page;
 *   AC-03 saving straight from the default manual mode succeeds (content.mode
 *         is sent), and reopening the editor shows the saved picks and order;
 *   AC-04 a temporary lookup failure keeps the selection, explains itself, and
 *         a retry brings the missing card back;
 *   AC-05 filter mode keeps its own preview and saves without manual picks;
 *   AC-06 a narrow viewport does not overflow and the order controls have
 *         accessible names.
 *
 * Run: npm run verify:batch:e2e -- e2e/admin/homepage-carousel-manual-mock.spec.ts
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
      "homepage-carousel-manual-mock.spec.ts must run under playwright.mock.config.ts: E2E_PROVIDER_MOCKS=true with E2E_MOCK_ADMIN_BASE_URL/E2E_MOCK_API_BASE_URL set"
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
        `homepage-carousel-manual-mock.spec.ts refuses a non-loopback/foreign-port ${name} base (${raw}); the isolated mock ports are 3110/3111/3112`
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const HQ = {
  identifier: process.env.E2E_ADMIN_HQ_IDENTIFIER || "hqmanager",
  password: process.env.E2E_ADMIN_HQ_PASSWORD || "hq123",
};

const MANUAL_TITLE = "E2E Carousel Manual Preview";
const FILTER_TITLE = "E2E Carousel Filter Preview";

interface PickerProduct {
  id: string;
  name: string;
}

interface SectionDetail {
  content: { mode?: string; filter?: unknown; limit?: number };
  products: { id: string; name: string; displayOrder: number }[];
}

let pool: Pool;
let hqContext: BrowserContext;
let pickA: PickerProduct;
let pickB: PickerProduct;
let manualSectionId = "";

/** Two products from the picker's second page: they are outside the default view. */
async function loadSecondPagePicks(context: BrowserContext): Promise<{
  first: PickerProduct;
  second: PickerProduct;
}> {
  const read = async (pageNumber: number) => {
    const response = await context.request.get(
      `/api/admin/products?page=${pageNumber}&limit=10`
    );
    expect(
      response.ok(),
      `products page ${pageNumber} failed (${response.status()})`
    ).toBe(true);
    const body = (await response.json()) as {
      data?: { id: string; name: string; slug: string }[];
    };
    return body.data ?? [];
  };

  const pageOne = await read(1);
  const pageTwo = await read(2);
  const firstPageIds = new Set(pageOne.map((product) => product.id));
  const outside = pageTwo.filter((product) => !firstPageIds.has(product.id));
  expect(
    outside.length,
    "the seeded catalog must have products beyond the picker's first page"
  ).toBeGreaterThanOrEqual(2);

  return {
    first: { id: outside[0].id, name: outside[0].name },
    second: { id: outside[1].id, name: outside[1].name },
  };
}

/** The preview cards, in render order. */
function previewCardTitles(page: Page) {
  return page
    .getByTestId("carousel-manual-preview")
    .locator("span.font-medium");
}

/** The "Urutan Tampil" rows, in their edited order. */
function orderRowTitles(page: Page) {
  return page
    .locator("div.space-y-1")
    .filter({ has: page.getByRole("button", { name: /Naikkan urutan/ }) })
    .first()
    .locator("span.truncate");
}

async function selectProduct(page: Page, name: string): Promise<void> {
  const search = page.getByPlaceholder("Cari produk...");
  await search.fill(name);
  const row = page.locator("label").filter({ hasText: name }).first();
  await expect(row, `picker row for ${name}`).toBeVisible();
  await row.getByRole("checkbox").click();
}

async function unselectProduct(page: Page, name: string): Promise<void> {
  const search = page.getByPlaceholder("Cari produk...");
  await search.fill(name);
  const row = page.locator("label").filter({ hasText: name }).first();
  await expect(row, `picker row for ${name}`).toBeVisible();
  await row.getByRole("checkbox").click();
}

async function sectionDetail(
  context: BrowserContext,
  id: string
): Promise<SectionDetail> {
  const response = await context.request.get(`/api/admin/homepage/${id}`);
  expect(response.ok(), `section detail failed (${response.status()})`).toBe(
    true
  );
  const body = (await response.json()) as { data: SectionDetail };
  return body.data;
}

async function deleteSectionByTitle(context: BrowserContext, title: string) {
  const list = (await (await context.request.get("/api/admin/homepage")).json()) as {
    data?: { id: string; title: string | null }[];
  };
  for (const section of list.data ?? []) {
    if (section.title === title) {
      await context.request.delete(`/api/admin/homepage/${section.id}`).catch(() => null);
    }
  }
}

// ---------------------------------------------------------------------------
// Fixture lifecycle
// ---------------------------------------------------------------------------

test.beforeAll(async ({ browser }) => {
  requireIsolatedMockRun();
  pool = new Pool({ connectionString: process.env.DATABASE_URL });

  // Heal leftovers from an interrupted previous run (deterministic titles).
  await pool.query(`DELETE FROM homepage_section WHERE title = ANY($1)`, [
    [MANUAL_TITLE, FILTER_TITLE],
  ]);

  hqContext = await browser.newContext({ baseURL: ADMIN_BASE_URL });
  await httpSignIn(hqContext, ADMIN_BASE_URL, HQ.identifier, HQ.password);
  const picks = await loadSecondPagePicks(hqContext);
  pickA = picks.first;
  pickB = picks.second;
});

test.afterAll(async () => {
  if (hqContext) {
    await deleteSectionByTitle(hqContext, MANUAL_TITLE).catch(() => {});
    await deleteSectionByTitle(hqContext, FILTER_TITLE).catch(() => {});
  }
  await hqContext?.close().catch(() => {});
  if (pool) await pool.end();
});

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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe("carousel produk manual", () => {
  test.describe.configure({ mode: "serial" });

  test("picks across picker pages stay in the preview, reorder, and save from the default mode", async () => {
    const page = await hqContext.newPage();
    try {
      await page.goto("/admin/homepage/new?type=carousel_product");

      // Default mode is manual — the reported bug was saving straight from it.
      await expect(
        page.getByRole("combobox").filter({ hasText: "Pilih Produk Manual" })
      ).toBeVisible();
      await expect(page.getByTestId("carousel-manual-preview")).toHaveCount(0);
      await expect(
        page.getByText("Pilih produk untuk melihat preview carousel.")
      ).toBeVisible();

      // AC-01 / AC-02: pick a second-page product, then a different one from
      // another search — the first card must survive the new search.
      await selectProduct(page, pickA.name);
      await expect(previewCardTitles(page).first()).toHaveText(pickA.name);

      await selectProduct(page, pickB.name);
      await expect(previewCardTitles(page).nth(1)).toHaveText(pickB.name);

      const search = page.getByPlaceholder("Cari produk...");
      await search.fill("");
      await expect(previewCardTitles(page).first()).toHaveText(pickA.name);
      await expect(previewCardTitles(page).nth(1)).toHaveText(pickB.name);

      // Reorder: move the second pick up; preview must follow.
      await page
        .getByRole("button", { name: `Naikkan urutan ${pickB.name}` })
        .click();
      await expect(previewCardTitles(page).first()).toHaveText(pickB.name);
      await expect(previewCardTitles(page).nth(1)).toHaveText(pickA.name);
      await expect(orderRowTitles(page).first()).toHaveText(pickB.name);

      // AC-03: save without touching the mode.
      await page.getByLabel("Judul", { exact: true }).fill(MANUAL_TITLE);
      await page.getByRole("button", { name: "Buat Section" }).click();
      await page.waitForURL("**/admin/homepage");

      const list = (await (await hqContext.request.get("/api/admin/homepage")).json()) as {
        data?: { id: string; title: string | null }[];
      };
      manualSectionId =
        list.data?.find((section) => section.title === MANUAL_TITLE)?.id ?? "";
      expect(manualSectionId, "the section must be persisted").not.toBe("");

      const saved = await sectionDetail(hqContext, manualSectionId);
      expect(saved.content.mode).toBe("manual");
      expect(saved.products.map((product) => product.id)).toEqual([
        pickB.id,
        pickA.id,
      ]);

      // Reopening the editor shows the saved picks and order without searching.
      const edit = await hqContext.newPage();
      try {
        await edit.goto(`/admin/homepage/${manualSectionId}/edit`);
        await expect(previewCardTitles(edit).first()).toHaveText(pickB.name);
        await expect(previewCardTitles(edit).nth(1)).toHaveText(pickA.name);
        await expect(orderRowTitles(edit).first()).toHaveText(pickB.name);
        await expect(orderRowTitles(edit).nth(1)).toHaveText(pickA.name);

        // AC-01 / AC-04: deselecting a product removes exactly its card.
        await unselectProduct(edit, pickB.name);
        await expect(previewCardTitles(edit)).toHaveCount(1);
        await expect(previewCardTitles(edit).first()).toHaveText(pickA.name);
        await expect(orderRowTitles(edit)).toHaveCount(1);
      } finally {
        await edit.close();
      }
    } finally {
      await page.close();
    }
  });

  test("a temporary lookup failure keeps the pick and recovers on retry", async () => {
    test.skip(!manualSectionId, "depends on the saved manual section");

    const page = await hqContext.newPage();
    try {
      await page.route(
        new RegExp(`/api/admin/products/${pickB.id}$`),
        (route) =>
          route.request().method() === "GET"
            ? route.fulfill({ status: 500, body: "boom" })
            : route.fallback()
      );

      await page.goto(`/admin/homepage/${manualSectionId}/edit`);
      await expect(
        page.getByText("Sebagian atau seluruh preview produk gagal dimuat.")
      ).toBeVisible();
      await expect(previewCardTitles(page).first()).toHaveText(pickA.name);
      await expect(orderRowTitles(page)).toHaveCount(2);

      await page.unroute(new RegExp(`/api/admin/products/${pickB.id}$`));
      await page.getByRole("button", { name: "Coba lagi" }).first().click();
      // The saved order puts pickB first, so the recovered card returns there.
      await expect(previewCardTitles(page).first()).toHaveText(pickB.name);
      await expect(previewCardTitles(page).nth(1)).toHaveText(pickA.name);
      await expect(
        page.getByText("Preview mengikuti pilihan dan urutan saat ini.")
      ).toBeVisible();
    } finally {
      await page.close();
    }
  });

  test("filter mode keeps its own preview and saves without manual picks", async () => {
    await deleteSectionByTitle(hqContext, FILTER_TITLE);
    const page = await hqContext.newPage();
    let filterId = "";
    try {
      await page.goto("/admin/homepage/new?type=carousel_product");
      await page.getByRole("combobox").click();
      await page.getByRole("option", { name: "Filter Otomatis" }).click();

      await expect(
        page.getByText(
          "Preview produk yang akan muncul (berdasarkan filter)"
        )
      ).toBeVisible();
      await expect(
        page.getByText("Preview Produk Pilihan", { exact: true })
      ).toHaveCount(0);

      await page.getByLabel("Judul", { exact: true }).fill(FILTER_TITLE);
      await page.getByRole("button", { name: "Buat Section" }).click();
      await page.waitForURL("**/admin/homepage");

      const list = (await (await hqContext.request.get("/api/admin/homepage")).json()) as {
        data?: { id: string; title: string | null }[];
      };
      filterId =
        list.data?.find((section) => section.title === FILTER_TITLE)?.id ?? "";
      expect(filterId, "the filter section must be persisted").not.toBe("");

      const saved = await sectionDetail(hqContext, filterId);
      expect(saved.content.mode).toBe("filter");
      expect(saved.products).toEqual([]);
    } finally {
      if (filterId) {
        await hqContext.request
          .delete(`/api/admin/homepage/${filterId}`)
          .catch(() => null);
      }
      await page.close();
    }
  });

  test("the manual preview fits a narrow viewport and the order controls are labelled", async () => {
    test.skip(!manualSectionId, "depends on the saved manual section");

    const context = await hqContext.browser()!.newContext({
      baseURL: ADMIN_BASE_URL,
      viewport: { width: 390, height: 844 },
    });
    try {
      await httpSignIn(context, ADMIN_BASE_URL, HQ.identifier, HQ.password);
      const page = await context.newPage();
      await page.goto(`/admin/homepage/${manualSectionId}/edit`);
      await expect(previewCardTitles(page).first()).toBeVisible();

      const overflow = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));
      expect(
        overflow.scrollWidth,
        "the editor must not overflow horizontally on a narrow viewport"
      ).toBeLessThanOrEqual(overflow.clientWidth);

      const downButton = page.getByRole("button", {
        name: `Turunkan urutan ${pickB.name}`,
      });
      await downButton.focus();
      await expect(downButton).toBeFocused();
    } finally {
      await context.close();
    }
  });
});
