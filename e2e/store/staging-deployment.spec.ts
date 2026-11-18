import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

test.skip(process.env.STAGING_SMOKE !== "true", "Smoke staging hanya melalui config opt-in");
const origin = "https://dev-store.adfsport.cloud";

// Tidak ada database/provider client dalam smoke. Expected master dicatat dari
// GET sandbox independen sebelum import, bukan report importer atau fixture demo.
test("katalog sandbox, halaman lanjut dan detail tersedia tanpa transaksi", async ({ context, page, request }) => {
  const failures: string[] = [];
  await context.route("**/*", async route => {
    const req = route.request();
    const url = new URL(req.url());
    const publicCatalogImage = req.resourceType() === "image" && (
      url.origin === "https://jb-assets.sgp1.cdn.digitaloceanspaces.com" ||
      (url.origin === "https://www.static-src.com" && url.pathname.startsWith("/wcsstore/Indraprastha/images/catalog/"))
    );
    // Dua thumbnail mapped Jubelio memakai public image CDN static-src.com. Hanya image
    // pada prefix katalog tersebut, bukan script/API atau request bercredential.
    if ((!publicCatalogImage && url.origin !== origin) || !["GET", "HEAD"].includes(req.method())) {
      failures.push(`request di luar allowlist read-only: ${req.method()} ${url.origin}${url.pathname} (${req.resourceType()})`);
      return route.abort();
    }
    return route.continue();
  });
  page.on("pageerror", () => failures.push("browser pageerror"));
  page.on("response", response => {
    if (response.status() >= 500) failures.push(`HTTP ${response.status()} ${new URL(response.url()).pathname}`);
  });
  const source = process.env.STAGING_CATALOG_EVIDENCE_FILE;
  if (!source) throw new Error("STAGING_CATALOG_EVIDENCE_FILE required: independent sandbox master projection");
  const expected = JSON.parse(readFileSync(source, "utf8")) as { name: string; sku: string };
  if (!expected.name || !expected.sku) throw new Error("Incomplete independent master projection");

  const first = await request.get(`${origin}/api/products?limit=20&page=1`);
  expect(first.ok()).toBe(true);
  const catalog = await first.json();
  expect(catalog.success).toBe(true);
  expect(catalog.pagination.limit).toBe(20);
  expect(catalog.data.length).toBeGreaterThan(0);
  await page.goto(`${origin}/products`, { waitUntil: "networkidle" });
  await expect(page.getByRole("heading", { name: "Semua Produk", exact: true })).toBeVisible();
  if (catalog.pagination.totalPages > 1) {
    const second = await request.get(`${origin}/api/products?limit=20&page=2`);
    expect(second.ok()).toBe(true);
    const next = await second.json();
    expect(next.pagination.page).toBe(2);
    expect(next.data.length).toBeGreaterThan(0);
    await page.goto(`${origin}/products?page=2`, { waitUntil: "networkidle" });
    await expect(page.getByText(next.data[0].name, { exact: true }).first()).toBeVisible();
  } else {
    test.info().annotations.push({ type: "coverage", description: "Dataset tidak memiliki halaman kedua; bukan bukti pagination lintas halaman" });
  }
  const search = await request.get(`${origin}/api/products?limit=20&search=${encodeURIComponent(expected.name)}`);
  expect(search.ok()).toBe(true);
  const results = await search.json();
  const product = results.data.find((row: { name: string }) => row.name === expected.name);
  expect(product, "Produk master independen ditemukan melalui backend search").toBeTruthy();
  await page.goto(`${origin}/products?search=${encodeURIComponent(expected.name)}`, { waitUntil: "networkidle" });
  await expect(page.getByText(expected.name, { exact: true }).first()).toBeVisible();
  const detail = await request.get(`${origin}/api/products/${product.slug || product.id}`);
  expect(detail.ok()).toBe(true);
  const body = await detail.json();
  expect(body.data.variants.some((variant: { sku: string }) => variant.sku === expected.sku)).toBe(true);
  await page.goto(`${origin}/products/${product.slug || product.id}`, { waitUntil: "networkidle" });
  await expect(page.getByRole("heading", { name: expected.name, exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.screenshot({ path: `playwright/results/staging/catalog-${test.info().project.name}.png`, fullPage: false });
  expect(failures).toEqual([]);
});
