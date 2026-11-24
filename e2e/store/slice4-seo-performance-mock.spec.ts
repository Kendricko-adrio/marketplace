import { expect, test } from "@playwright/test";

const STORE_BASE_URL =
  process.env.E2E_MOCK_STORE_BASE_URL ?? "http://localhost:3110";
const MOCK_PORTS = new Set(["3110", "3111", "3112"]);

function requireIsolatedMockRun(): void {
  if (
    process.env.E2E_PROVIDER_MOCKS !== "true" ||
    !process.env.E2E_MOCK_STORE_BASE_URL
  ) {
    throw new Error(
      "slice4-seo-performance-mock.spec.ts harus dijalankan lewat playwright.mock.config.ts"
    );
  }
  const parsed = new URL(STORE_BASE_URL);
  const loopback =
    parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost";
  if (!loopback || !MOCK_PORTS.has(parsed.port)) {
    throw new Error(
      `spec ini menolak base store non-loopback/port asing (${STORE_BASE_URL})`
    );
  }
}

test.describe("Slice 4 Store — SEO & Performance (SSR Detail Produk & CMS Cache)", () => {
  test.beforeEach(() => {
    requireIsolatedMockRun();
  });

  test("AC-1 & AC-2: /products/[id] SSR merender HTML & metadata SEO tanpa initial client fetch, dan API /api/products/[id] tetap kompatibel", async ({
    page,
  }) => {
    const listRes = await page.request.get(`${STORE_BASE_URL}/api/products?limit=5`);
    expect(listRes.status()).toBe(200);
    const listJson = await listRes.json();
    const firstProduct = listJson.data?.[0];
    expect(firstProduct, "Harus ada minimal 1 produk di DB").toBeTruthy();

    const slugOrId: string = firstProduct.slug || firstProduct.id;
    const productName: string = firstProduct.name;

    const productApiRequests: string[] = [];
    page.on("request", (req) => {
      if (req.url().includes("/api/products/")) {
        productApiRequests.push(req.url());
      }
    });

    const response = await page.goto(
      `${STORE_BASE_URL}/products/${slugOrId}`
    );
    expect(response?.status()).toBe(200);

    await expect(page).toHaveTitle(
      new RegExp(`${productName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}.*\\| ADF Sports`, "i")
    );

    const ogTitle = await page
      .locator('meta[property="og:title"]')
      .getAttribute("content");
    const ogDescription = await page
      .locator('meta[property="og:description"]')
      .getAttribute("content");

    expect(ogTitle).toContain(productName);
    expect(ogDescription).toBeTruthy();
    expect(ogDescription).not.toMatch(/<[^>]+>/);
    expect((ogDescription ?? "").length).toBeLessThanOrEqual(160);

    await expect(
      page.getByRole("heading", { name: productName })
    ).toBeVisible();
    expect(productApiRequests).toHaveLength(0);

    // Backward-compatible JSON API contract check
    const apiRes = await page.request.get(
      `${STORE_BASE_URL}/api/products/${slugOrId}`
    );
    expect(apiRes.status()).toBe(200);
    const apiJson = await apiRes.json();
    expect(apiJson.success).toBe(true);
    expect(apiJson.data?.id).toBe(firstProduct.id);
  });

  test("AC-2: URL produk tidak ditemukan merender not-found Store dengan noindex", async ({
    page,
  }) => {
    const response = await page.goto(
      `${STORE_BASE_URL}/products/slug-produk-tidak-ada-404`
    );
    // Dengan loading.tsx (Suspense streaming), Next.js mengirim 200 + meta noindex + not-found UI;
    // tanpa loading.tsx, statusnya 404.
    expect([200, 404]).toContain(response?.status());
    await expect(
      page.getByRole("heading", { name: "Halaman tidak ditemukan" })
    ).toBeVisible();
    await expect(page.locator('meta[name="robots"]').first()).toHaveAttribute(
      "content",
      "noindex"
    );
  });

  test("AC-3: Interaksi pilih cabang & tambah keranjang tetap bekerja di desktop dan mobile", async ({
    page,
  }) => {
    const listRes = await page.request.get(`${STORE_BASE_URL}/api/products?limit=20`);
    const listJson = await listRes.json();
    const productsList: Array<{ id: string; slug?: string }> = listJson.data ?? [];

    let targetSlugOrId: string | null = null;
    for (const p of productsList) {
      const detailRes = await page.request.get(
        `${STORE_BASE_URL}/api/products/${p.slug || p.id}`
      );
      const detailJson = await detailRes.json();
      const hasStock = detailJson.data?.variants?.some(
        (v: { branchStock?: Array<{ available: number }> }) =>
          v.branchStock?.some((b) => b.available > 0)
      );
      if (hasStock) {
        targetSlugOrId = p.slug || p.id;
        break;
      }
    }
    expect(targetSlugOrId, "Harus ada minimal 1 produk berstok di DB").toBeTruthy();

    await page.route("**/api/cart/items", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ success: true }),
      });
    });

    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(`${STORE_BASE_URL}/products/${targetSlugOrId}`);

    const branchButton = page
      .locator("button", { hasText: /Stok terakhir: [1-9]\d*/ })
      .first();
    await branchButton.click();

    const addToCartBtn = page.getByRole("button", {
      name: "Masukkan Keranjang",
    });
    await expect(addToCartBtn).toBeEnabled();
    await addToCartBtn.click();
    await expect(
      page.getByText("Produk berhasil ditambahkan ke keranjang!")
    ).toBeVisible();

    // Mobile viewport check: no horizontal overflow
    await page.setViewportSize({ width: 390, height: 844 });
    const hasHorizontalOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth
    );
    expect(hasHorizontalOverflow).toBe(false);
  });

  test("AC-4: /pages/[slug] tetap merender judul dan konten markdown tanpa regresi", async ({
    page,
  }) => {
    const response = await page.goto(`${STORE_BASE_URL}/pages/about`);
    expect(response?.status()).toBe(200);
    await expect(page).toHaveTitle(/Tentang Kami/i);
    await expect(
      page.getByRole("heading", { name: "Tentang Kami" }).first()
    ).toBeVisible();
  });
});
