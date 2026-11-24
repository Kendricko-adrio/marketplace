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
      "slice1-security-shell-mock.spec.ts harus dijalankan lewat playwright.mock.config.ts"
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

test.describe("Slice 1 Store — Sanitasi Deskripsi & Shell tanpa LayoutWrapper", () => {
  test.beforeEach(() => {
    requireIsolatedMockRun();
  });

  test("AC-1 (Store): deskripsi produk di /products/[id] membuang payload XSS dan mempertahankan HTML aman", async ({
    page,
  }) => {
    await page.route("**/api/products/sepatu-lari-pro", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          success: true,
          data: {
            id: "prod-slice1-1",
            name: "Sepatu Lari Pro",
            slug: "sepatu-lari-pro",
            description:
              '<p>Nyaman untuk <strong>lari jauh</strong>.</p>' +
              '<script>window.__xssStore = true;</script>' +
              '<img src="https://cdn.example.com/shoe.jpg" alt="Detail Sol" onerror="window.__xssStore = true" />' +
              '<img src="data:image/svg+xml,<svg onload=window.__xssStore=true>" alt="Blocked SVG" />' +
              '<a href="https://adfsports.id/size" target="_blank">Tabel Ukuran</a>',
            basePrice: "450000",
            status: "active",
            categories: [{ id: "cat-1", name: "Running" }],
            images: [],
            variants: [
              {
                id: "var-1",
                sku: "SLP-42",
                color: "Hitam",
                size: "42",
                price: "450000",
                isDefault: true,
                images: [],
                branchStock: [
                  {
                    branchId: "br-1",
                    name: "Jakarta Pusat",
                    code: "JKT",
                    city: "Jakarta",
                    stock: 5,
                    reservedStock: 0,
                    available: 5,
                  },
                ],
              },
            ],
          },
        }),
      });
    });

    await page.goto(`${STORE_BASE_URL}/products/sepatu-lari-pro`);

    await expect(page.getByText("Nyaman untuk lari jauh.")).toBeVisible();
    const xssFlag = await page.evaluate(
      () => (window as unknown as { __xssStore?: boolean }).__xssStore
    );
    expect(xssFlag).toBeUndefined();

    const descRegion = page.locator("text=Nyaman untuk").locator("..");
    await expect(descRegion.locator("script")).toHaveCount(0);
    await expect(descRegion.locator("strong")).toHaveText("lari jauh");

    const safeImg = page.locator('img[alt="Detail Sol"]');
    await expect(safeImg).toHaveAttribute(
      "src",
      "https://cdn.example.com/shoe.jpg"
    );
    expect(await safeImg.getAttribute("onerror")).toBeNull();

    const blockedImg = page.locator('img[alt="Blocked SVG"]');
    if ((await blockedImg.count()) > 0) {
      expect(await blockedImg.getAttribute("src")).toBeNull();
    }

    const safeLink = page.getByRole("link", { name: "Tabel Ukuran" });
    await expect(safeLink).toHaveAttribute("target", "_blank");
    await expect(safeLink).toHaveAttribute("rel", "noopener noreferrer");
  });

  test("AC-5: homepage store merender header, main, footer tanpa LayoutWrapper dan tanpa link #admin (desktop & mobile)", async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(err.message));

    for (const viewport of [
      { width: 1280, height: 800 },
      { width: 390, height: 844 },
    ]) {
      await page.setViewportSize(viewport);
      await page.goto(`${STORE_BASE_URL}/`);

      await expect(page.locator("header")).toBeVisible();
      await expect(page.locator("main")).toBeVisible();
      await expect(page.locator("footer")).toBeVisible();
      await expect(page.locator('a[href="#admin"]')).toHaveCount(0);
    }

    expect(errors).toEqual([]);
  });
});
