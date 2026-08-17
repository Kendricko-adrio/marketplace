import { test, expect } from "@playwright/test";
import { Pool } from "pg";
import dotenv from "dotenv";
import crypto from "node:crypto";

// Admin CMS — homepage sections, static pages, and footer: admin editor +
// storefront rendering. All three modules are HQ-only, so this spec logs in
// as hqmanager with a clean context.

dotenv.config({ path: ".env" });

const PAGE_SLUG = `e2e-page-${crypto.randomUUID().slice(0, 8)}`;
const PAGE_TITLE = `E2E Test Page ${PAGE_SLUG}`;

let pool: Pool;
let originalBrandName: string;

test.beforeAll(async () => {
  pool = new Pool({ connectionString: process.env.DATABASE_URL });
  // Remove announcement sections + e2e pages left over from previous (failed)
  // runs so the create/delete assertions start from a clean slate.
  await pool.query(
    `DELETE FROM homepage_section WHERE type = 'announcement_bar'`
  );
  await pool.query(`DELETE FROM static_page WHERE slug LIKE 'e2e-page-%'`);
  // Remember the footer brand so the footer test can restore it exactly.
  const row = await pool.query(
    `SELECT data->>'brandName' AS brand FROM footer_config LIMIT 1`
  );
  originalBrandName = row.rows[0]?.brand ?? "StoreFront";
});

test.afterAll(async () => {
  // Restore the footer brand the footer test edited.
  await pool.query(
    `UPDATE footer_config SET data = jsonb_set(data, '{brandName}', $1)`,
    [JSON.stringify(originalBrandName)]
  );
  await pool.end();
});

test.describe("admin CMS", () => {
  // The tests share the HQ login and mutate shared state (footer brand,
  // homepage sections) — run serially.
  test.describe.configure({ mode: "serial" });

  test.use({ storageState: { cookies: [], origins: [] } });

  test.beforeEach(async ({ page }) => {
    // HQ login (the saved session is a branch admin without CMS access).
    await page.goto("http://localhost:3001/login");
    await page.getByLabel("Email atau Username").fill("hqmanager");
    await page.getByLabel("Password").fill("hq123");
    await page.getByRole("button", { name: "Masuk", exact: true }).click();
    await page.waitForURL("**/admin/**");
  });

  test("homepage CMS: create an announcement section and delete it", async ({
    page,
  }) => {
    await page.goto("/admin/homepage");
    await expect(page.getByText("Tambah Section")).toBeVisible();

    // Create an announcement_bar section (simplest type).
    await page.getByRole("button", { name: "Tambah Section" }).click();
    await page.getByRole("button", { name: /Announcement Bar/ }).click();
    await page.waitForURL("**/admin/homepage/new?type=announcement_bar");

    await page.getByLabel("Pesan Pengumuman").fill("E2E announcement test");
    await page.getByRole("button", { name: "Buat Section" }).click();

    // Back on the list, the new section appears (Announcement Bar badge).
    await page.waitForURL("**/admin/homepage");
    const row = page
      .locator("div.rounded-lg.border.bg-card", {
        hasText: "Announcement Bar",
      })
      .last();
    await expect(row).toBeVisible();

    // Delete it again (cleanup): trash icon → confirm dialog.
    await row.getByRole("button").last().click();
    await page.getByRole("button", { name: "Hapus", exact: true }).click();
    await expect(page.getByText("Announcement Bar")).toHaveCount(0);
  });

  test("static pages: create a page and render it on the storefront", async ({
    page,
  }) => {
    await page.goto("/admin/pages");
    await page.getByRole("link", { name: "Halaman Baru" }).click();
    await page.waitForURL("**/admin/pages/new");

    // Role-based locators: the markdown toolbar also has "Judul N" buttons.
    await page.getByRole("textbox", { name: "Judul" }).fill(PAGE_TITLE);
    await page.getByRole("textbox", { name: "Slug (URL)" }).fill(PAGE_SLUG);
    // The content field is a TipTap editor (contentEditable) — typing raw
    // "## Heading" would be stored as escaped plain text, so use the toolbar's
    // H2 button to produce a real heading.
    const editor = page.locator(".prose-editor");
    await editor.click();
    // TipTap StarterKit heading shortcut: Ctrl+Alt+2 → H2 (avoids the toolbar
    // button stealing focus mid-typing).
    await page.keyboard.press("Control+Alt+2");
    await page.keyboard.type("Heading");
    await page.keyboard.press("Enter");
    await page.keyboard.type("E2E markdown content.");
    await page.getByRole("button", { name: "Buat Halaman" }).click();

    // Appears in the list with the published badge.
    await page.waitForURL("**/admin/pages");
    await expect(page.getByRole("cell", { name: PAGE_TITLE })).toBeVisible();

    // Storefront renders the markdown.
    await page.goto(`http://localhost:3000/pages/${PAGE_SLUG}`);
    await expect(
      page.getByRole("heading", { name: PAGE_TITLE })
    ).toBeVisible();
    await expect(page.getByRole("heading", { name: "Heading" })).toBeVisible();
    await expect(page.getByText("E2E markdown content.")).toBeVisible();

    // Cleanup: delete the page (kebab menu → Hapus → confirm dialog).
    await page.goto("http://localhost:3001/admin/pages");
    const row = page.locator("tr", { hasText: PAGE_TITLE });
    await row.getByRole("button", { name: "Open menu" }).click();
    await page.getByRole("menuitem", { name: "Hapus" }).click();
    await page.getByRole("button", { name: "Hapus", exact: true }).click();
    await expect(page.getByRole("cell", { name: PAGE_TITLE })).toHaveCount(0);
  });

  test("footer: edit the brand name and see it on the storefront", async ({
    page,
  }) => {
    // The destinations fetch only fires from the client (useEffect) — waiting
    // for it guarantees React hydration finished, otherwise a fill on the
    // SSR'd controlled input gets reverted when hydration takes over.
    const hydrated = page.waitForResponse((r) =>
      r.url().includes("/api/admin/linkable-destinations")
    );
    await page.goto("/admin/footer");
    await hydrated;

    const brand = page.getByLabel("Nama Brand");
    await expect(brand).toHaveValue(originalBrandName);

    const newBrand = `${originalBrandName} E2E`;
    await brand.fill(newBrand);
    await page.getByRole("button", { name: "Simpan" }).click();
    await expect(page.getByText("Konfigurasi footer tersimpan")).toBeVisible();

    // Storefront footer reflects the change (force-dynamic fetch).
    await page.goto("http://localhost:3000/products");
    await expect(page.locator("footer").getByText(newBrand)).toBeVisible();
  });
});
