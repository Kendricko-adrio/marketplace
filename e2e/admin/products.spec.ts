import { test, expect } from "@playwright/test";
import { TEST_USERS } from "../config";
import { Pool } from "pg";
import dotenv from "dotenv";

dotenv.config({ path: ".env" });

// Admin products — list/search, detail (gallery, info, variants), Jubelio
// sync API, and the upload API. Product CRUD was removed when Jubelio became
// the source of truth — the UI is read-only with per-product re-sync.

// 1x1 transparent PNG.
const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);

test.describe("admin products", () => {
  test("branch admin sees only products their branch carries", async ({
    page,
  }) => {
    // admintoko is scoped to Jakarta. The seeded AirRunner product has its
    // branch_stock rows deleted, so no branch carries it → it must be hidden
    // from a branch admin, while HQ still sees it (asserted in the HQ block).
    // Verify via the scoped search API (robust to pagination) and the UI list.
    const api = await page.request.get(
      "/api/admin/products?limit=50&search=AirRunner"
    );
    const apiJson = await api.json();
    expect(
      apiJson.data?.some((p: any) => p.name?.includes("AirRunner"))
    ).toBeFalsy();

    await page.goto("/admin/products");

    await expect(
      page.getByRole("heading", { name: "Produk" })
    ).toBeVisible();
    await expect(page.getByText("Daftar Produk")).toBeVisible();

    // AirRunner is NOT carried by any branch → absent from the branch admin list.
    await expect(
      page.getByRole("cell", { name: /AirRunner Pro Running Shoes/ })
    ).toHaveCount(0);

    // The list is still populated (other products are carried by Jakarta).
    const rows = page.locator('table tbody tr');
    await expect(rows.first()).toBeVisible();
    expect(await rows.count()).toBeGreaterThan(0);
  });

  test("branch admin cannot open a non-carried product detail", async ({
    page,
  }) => {
    // AirRunner is not carried by admintoko's branch → the detail API 404s and
    // the page shows the not-found message. Resolve the deterministic fixture
    // directly so this authorization test does not depend on a second login or
    // on an unrelated storefront catalog request.
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    const fixture = await pool.query(
      "SELECT id, name FROM product WHERE slug = $1 LIMIT 1",
      ["airrunner-pro-running-shoes"]
    );
    await pool.end();
    const airRunner = fixture.rows[0];
    if (!airRunner) {
      throw new Error("AirRunner not found for detail-404 test");
    }

    // As admintoko (default storageState), the non-carried product 404s.
    const res = await page.request.get(`/api/admin/products/${airRunner.id}`);
    expect(res.status()).toBe(404);

    await page.goto(`/admin/products/${airRunner.id}`);
    await expect(page.getByText("Produk tidak ditemukan.")).toBeVisible();
  });

  test("sidebar shows the branch admin's branch", async ({ page }) => {
    await page.goto("/admin/products");
    // admintoko is placed at Jakarta Pusat. The sidebar renders the branch name
    // below the role label.
    await expect(page.locator("aside").getByText(/Jakarta/)).toBeVisible();
  });

  test("opens a product detail with gallery, info, and variants", async ({
    page,
  }) => {
    await page.goto("/admin/products");

    // Open the first product's detail.
    await page.getByRole("link", { name: "Detail" }).first().click();
    await page.waitForURL("**/admin/products/*");

    // Info card: name + RRP.
    await expect(page.getByText("Harga (RRP):")).toBeVisible();
    // Variants table renders.
    await expect(page.getByText(/Varian \(\d+\)/)).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "SKU" })).toBeVisible();
  });

  test("gallery renders as a horizontal scroll row, not a downward grid", async ({
    page,
  }) => {
    await page.goto("/admin/products");
    await page.getByRole("link", { name: "Detail" }).first().click();
    await page.waitForURL("**/admin/products/*");

    // Locate the gallery by its overflow container that actually holds images
    // (avoids matching unrelated overflow-x-auto wrappers like a table).
    const container = page
      .locator(".overflow-x-auto")
      .filter({ has: page.locator("img") })
      .first();
    await expect(container).toBeVisible();
    const overflowX = await container.evaluate(
      (el) => getComputedStyle(el).overflowX
    );
    expect(["auto", "scroll"]).toContain(overflowX);

    // Images sit in one horizontal row (same top, increasing left), not a grid.
    const imgs = container.getByRole("img");
    const count = await imgs.count();
    await expect(imgs.nth(0)).toBeVisible();
    if (count >= 2) {
      const a = await imgs.nth(0).boundingBox();
      const b = await imgs.nth(1).boundingBox();
      expect(a).toBeTruthy();
      expect(b).toBeTruthy();
      // Playwright boundingBox returns {x, y, width, height}; y = top, x = left.
      expect(Math.abs(a!.y - b!.y)).toBeLessThan(2); // same row
      expect(b!.x).toBeGreaterThan(a!.x); // left-to-right
    }
  });

  test("Stok tab scopes to admin's own branch (admintoko)", async ({ page }) => {
    // Pick a product with stock. The list API returns totalStock per row.
    const res = await page.request.get("/api/admin/products?limit=50");
    const { data } = await res.json();
    const withStock = data.find((p: any) => p.totalStock > 0);
    if (!withStock) {
      throw new Error("No product with stock found for Stok-tab test");
    }

    await page.goto(`/admin/products/${withStock.id}`);
    await page.getByRole("tab", { name: "Stok" }).click();

    // Scope note for a branch admin.
    await expect(page.getByText("Menampilkan cabang Anda saja.")).toBeVisible();

    // A branch admin sees at most one branch block (their own). If the
    // chosen product has no stock at their branch, the list is empty.
    const branchHeadings = page.locator('h4');
    const headingCount = await branchHeadings.count();
    expect(headingCount).toBeLessThanOrEqual(1);
  });

  test("sync API rejects a non-Jubelio product (deterministic)", async ({
    page,
  }) => {
    // After import-jubelio the first product may be Jubelio-synced.
    // Fetch enough products to find a seeded one with jubelioItemGroupId === null.
    const res = await page.request.get("/api/admin/products?limit=50");
    const { data } = await res.json();
    const nonJubelio = data.find((p: any) => p.jubelioItemGroupId === null);
    if (!nonJubelio) {
      throw new Error("No non-Jubelio product found for sync-negative test");
    }

    const sync = await page.request.post(
      `/api/admin/products/${nonJubelio.id}/sync`
    );
    expect(sync.status()).toBe(400);
    const body = await sync.json();
    expect(body.error).toContain("not a Jubelio-synced product");
  });

  test("upload API stores an image and deletes it", async ({ page }) => {
    // Upload a tiny PNG to the products folder.
    const up = await page.request.post("/api/admin/upload?folder=products", {
      multipart: {
        file: { name: "e2e.png", mimeType: "image/png", buffer: TINY_PNG },
      },
    });
    expect(up.status()).toBe(200);
    const { url } = await up.json();
    expect(url).toMatch(/^\/uploads\/products\/[0-9a-f-]+\.png$/);

    // The store serves it.
    const served = await page.request.get(`http://localhost:3000${url}`);
    expect(served.status()).toBe(200);

    // Delete it again.
    const del = await page.request.delete(`/api/admin/upload?url=${url}`);
    expect(del.status()).toBe(200);
    const gone = await page.request.get(`http://localhost:3000${url}`);
    expect(gone.status()).toBe(404);
  });

  test("upload API rejects an invalid folder", async ({ page }) => {
    const res = await page.request.post("/api/admin/upload?folder=../../etc", {
      multipart: {
        file: { name: "e2e.png", mimeType: "image/png", buffer: TINY_PNG },
      },
    });
    expect(res.status()).toBe(400);
  });
});

// HQ sees every branch's stock. This needs a fresh login (the default
// storageState is admintoko, an admin scoped to one branch), so opt out of the
// shared session and sign in as the seeded HQ user.
test.describe("HQ stock view", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  async function loginAsHq(page: import("@playwright/test").Page) {
    await page.goto("/login");
    await page.getByLabel("Email atau Username").fill("hqmanager");
    await page.getByLabel("Password").fill("hq123");
    await page.getByRole("button", { name: "Masuk", exact: true }).click();
    await page.waitForURL("**/admin/**");
  }

  test("HQ sees all branches in the Stok tab", async ({ page }) => {
    await loginAsHq(page);

    const res = await page.request.get("/api/admin/products?limit=50");
    const { data } = await res.json();
    const withStock = data.find((p: any) => p.totalStock > 0);
    if (!withStock) {
      throw new Error("No product with stock found for HQ Stok-tab test");
    }

    await page.goto(`/admin/products/${withStock.id}`);
    await page.getByRole("tab", { name: "Stok" }).click();

    // HQ scope note.
    await expect(page.getByText("Menampilkan semua cabang.")).toBeVisible();

    // HQ sees >= 2 branch blocks (the seeded DB has 3 branches; Jubelio DB
    // may have more — we only assert the minimum to stay robust).
    const branchHeadings = page.locator('h4');
    const headingCount = await branchHeadings.count();
    expect(headingCount).toBeGreaterThanOrEqual(2);
  });

  test("HQ sees the full catalog and can search by name", async ({ page }) => {
    await loginAsHq(page);

    // HQ is not branch-scoped → AirRunner (carried by no branch) is reachable
    // via the API. (The page-1 UI may not list it when there are >10 products,
    // so verify via the search-narrowed API + UI, not the default page-1 list.)
    const api = await page.request.get(
      "/api/admin/products?limit=50&search=AirRunner"
    );
    const apiJson = await api.json();
    expect(
      apiJson.data?.some((p: any) => p.name?.includes("AirRunner"))
    ).toBeTruthy();

    await page.goto("/admin/products");
    // Search narrows the table to matching products.
    await Promise.all([
      page.waitForResponse(
        (response) =>
          response.url().includes("/api/admin/products?") &&
          response.url().includes("search=AirRunner") &&
          response.ok()
      ),
      page.getByPlaceholder("Cari nama produk...").fill("AirRunner"),
    ]);
    await expect(
      page.getByRole("cell", { name: /AirRunner Pro Running Shoes/ })
    ).toBeVisible();
    await expect(
      page.getByRole("cell", { name: /Wild Glide 38/ })
    ).toHaveCount(0);
  });

  test("HQ sidebar shows Head Quarter", async ({ page }) => {
    await loginAsHq(page);
    await page.goto("/admin/products");

    // HQ has no placed branch → the sidebar shows "Head Quarter" below the role.
    await expect(page.locator("aside").getByText("Head Quarter")).toBeVisible();
  });
});
