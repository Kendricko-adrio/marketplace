import { test, expect, type Page } from "@playwright/test";
import { Pool } from "pg";
import dotenv from "dotenv";

dotenv.config({ path: ".env" });

// =========================================================
// Admin Branches — search spans the WHOLE result set, not the current page
// =========================================================
// Regression for: typing in the Branch list search box only filtered the 10
// rows already loaded, so a Branch rendered on page 2 could never be found.
//
// Fixtures are 12 run-unique Branch rows inserted directly (the create API
// requires verified Shipment regions, covered by branch-origin-mock.spec.ts)
// with DESCENDING created_at, matching the list's `created_at desc` order:
// page 1 = the 10 newest fixtures, page 2 = the two oldest, and TARGET is the
// oldest → it is NOT on page 1 before searching.
//
// The signed-in actor is hqmanager (branches view/edit/delete ALL-branch);
// admintoko has no branches grants at all.

const HQ = {
  identifier: process.env.E2E_ADMIN_HQ_IDENTIFIER || "hqmanager",
  password: process.env.E2E_ADMIN_HQ_PASSWORD || "hq123",
};

const RUN = Date.now().toString(36).toUpperCase();
const CODE_PREFIX = "E2ESRCH";
const FIXTURE_COUNT = 12;
const SHARED_CITY = `E2E Kota Cari ${RUN}`;
const OLDEST = {
  code: `${CODE_PREFIX}${RUN}OLD`,
  name: `E2E Cabang Terlama ${RUN}`,
};

const SEARCH_LABEL = "Cari cabang berdasarkan nama, kode, atau kota";

let pool: Pool;

test.use({ storageState: { cookies: [], origins: [] } });

// The three tests share one fixture set (and one run-unique code prefix), so
// they must not run in parallel workers: a second worker's `beforeAll`
// self-heal would delete the rows another worker is asserting on.
test.describe.configure({ mode: "serial" });

async function loginAsHQ(page: Page): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Email atau Username").fill(HQ.identifier);
  await page.getByLabel("Password").fill(HQ.password);
  await page.getByRole("button", { name: "Masuk", exact: true }).click();
  await page.waitForURL("**/admin/**");
}

/** The table body rows currently rendered (header excluded). */
function bodyRows(page: Page) {
  return page.locator("table tbody tr");
}

test.beforeAll(async () => {
  pool = new Pool({ connectionString: process.env.DATABASE_URL });
  // Self-heal leftovers from a crashed run (run-unique codes otherwise pile up).
  await pool.query("DELETE FROM branch WHERE code LIKE $1", [
    `${CODE_PREFIX}%`,
  ]);

  for (let i = 0; i < FIXTURE_COUNT; i++) {
    const isOldest = i === FIXTURE_COUNT - 1;
    await pool.query(
      `INSERT INTO branch (id, name, code, city, address, status, created_at)
       VALUES ($1, $2, $3, $4, $5, 'nonaktif', now() - ($6 || ' minutes')::interval)`,
      [
        `e2e-search-${RUN}-${i}`,
        isOldest ? OLDEST.name : `E2E Cabang Cari ${RUN} ${i}`,
        isOldest ? OLDEST.code : `${CODE_PREFIX}${RUN}${i}`,
        SHARED_CITY,
        "Jl. E2E Search No. 1",
        String(i),
      ]
    );
  }
});

test.afterAll(async () => {
  await pool.query("DELETE FROM branch WHERE code LIKE $1", [
    `${CODE_PREFIX}%`,
  ]);
  await pool.end();
});

test.beforeEach(async ({ page }) => {
  await loginAsHQ(page);
});

test.describe("admin branches — server-side search", () => {
  test("finds a Branch that lives beyond the first page", async ({ page }) => {
    await page.goto("/admin/branches");
    await expect(page.getByRole("heading", { name: "Cabang" })).toBeVisible();

    // Page 1 holds the 10 newest fixtures; the target is the oldest one, so it
    // is provably not rendered before searching.
    await expect(bodyRows(page)).toHaveCount(10);
    await expect(page.getByText(OLDEST.name)).toHaveCount(0);

    const responsePromise = page.waitForResponse(
      (res) =>
        res.url().includes("/api/admin/branches?") &&
        res.url().includes("search=")
    );
    await page.getByLabel(SEARCH_LABEL).fill(OLDEST.name);
    const response = await responsePromise;

    // The term reaches the API (server-side filter), which reports a single
    // match — not the 10 rows of the current page.
    expect(new URL(response.url()).searchParams.get("search")).toBe(
      OLDEST.name
    );
    const payload = await response.json();
    expect(payload.pagination.total).toBe(1);

    await expect(page.getByText(OLDEST.name)).toBeVisible();
    await expect(bodyRows(page)).toHaveCount(1);

    // A new search starts from page 1 again.
    await expect(page.getByText("Page 1 of 1")).toBeVisible();
  });

  test("matches by city and reports pagination over the whole match set", async ({
    page,
  }) => {
    await page.goto("/admin/branches");
    await expect(bodyRows(page)).toHaveCount(10);

    await page.getByLabel(SEARCH_LABEL).fill(SHARED_CITY);

    // All 12 fixtures share the city → two pages, still page 1.
    await expect(page.getByText("Page 1 of 2")).toBeVisible();
    await expect(bodyRows(page)).toHaveCount(10);
    await expect(
      page.getByText(`E2E Cabang Cari ${RUN} 0`, { exact: true })
    ).toBeVisible();

    await page.getByRole("button", { name: "Next", exact: true }).click();
    await expect(page.getByText("Page 2 of 2")).toBeVisible();

    // The oldest fixture is reachable through the filtered pages — the case
    // that silently failed when the filter was client-side.
    await expect(page.getByText(OLDEST.name)).toBeVisible();
  });

  test("distinguishes 'no match' from 'no data' and recovers on clearing", async ({
    page,
  }) => {
    await page.goto("/admin/branches");
    await expect(bodyRows(page)).toHaveCount(10);

    await page.getByLabel(SEARCH_LABEL).fill(`TidakAda ${RUN}`);

    await expect(
      page.getByText(`Tidak ada cabang yang cocok dengan pencarian "TidakAda ${RUN}".`)
    ).toBeVisible();

    await page.getByLabel(SEARCH_LABEL).fill("");
    await expect(bodyRows(page)).toHaveCount(10);
  });
});
