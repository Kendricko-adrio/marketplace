import { expect, test, type BrowserContext } from "@playwright/test";

const ADMIN_BASE_URL =
  process.env.E2E_MOCK_ADMIN_BASE_URL ?? "http://localhost:3111";
const MOCK_PORTS = new Set(["3110", "3111", "3112"]);

let context: BrowserContext;

function requireIsolatedMockRun(): void {
  if (
    process.env.E2E_PROVIDER_MOCKS !== "true" ||
    !process.env.E2E_MOCK_ADMIN_BASE_URL
  ) {
    throw new Error(
      "slice1-security-links-mock.spec.ts harus dijalankan lewat playwright.mock.config.ts"
    );
  }
  const parsed = new URL(ADMIN_BASE_URL);
  const loopback =
    parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost";
  if (!loopback || !MOCK_PORTS.has(parsed.port)) {
    throw new Error(
      `spec ini menolak base admin non-loopback/port asing (${ADMIN_BASE_URL})`
    );
  }
}

test.beforeAll(async ({ browser }) => {
  requireIsolatedMockRun();
  context = await browser.newContext({ baseURL: ADMIN_BASE_URL });
  const signIn = await context.request.post("/api/auth/sign-in/username", {
    data: { username: "hqmanager", password: "hq123" },
  });
  expect(signIn.ok(), `sign-in admin gagal: ${signIn.status()}`).toBe(true);
});

test.afterAll(async () => {
  await context?.close();
});

test.describe("Slice 1 Admin — Link Storefront & Sanitasi Deskripsi Produk", () => {
  test("AC-2: link nama produk di /admin/products mengarah ke origin storefront dengan rel aman, tombol detail tetap ke /admin/products/{id}", async () => {
    const page = await context.newPage();
    try {
      await page.route("**/api/admin/products?*", async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            success: true,
            data: [
              {
                id: "prod-slice1-1",
                name: "Sepatu Lari Pro",
                slug: "sepatu-lari-pro",
                basePrice: "450000",
                status: "active",
                variants: [{ id: "var-1", price: "450000", isDefault: true }],
                variantCount: 1,
                totalStock: 10,
                totalReserved: 0,
                totalAvailable: 10,
                categories: ["Running"],
              },
            ],
            pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
          }),
        });
      });

      await page.goto("/admin/products");

      const productLink = page.getByRole("link", { name: "Sepatu Lari Pro" });
      await expect(productLink).toBeVisible();
      const href = await productLink.getAttribute("href");
      expect(href).toMatch(/^https?:\/\/.+\/products\/sepatu-lari-pro$/);
      expect(href).not.toContain(":3111");
      await expect(productLink).toHaveAttribute("target", "_blank");
      await expect(productLink).toHaveAttribute("rel", "noopener noreferrer");

      const detailLink = page.getByRole("link", { name: "Detail" }).first();
      await expect(detailLink).toHaveAttribute(
        "href",
        "/admin/products/prod-slice1-1"
      );
    } finally {
      await page.close();
    }
  });

  test("AC-1 (Admin): deskripsi produk di /admin/products/[id] disanitasi dari XSS sambil mempertahankan HTML aman", async () => {
    const page = await context.newPage();
    try {
      await page.route("**/api/admin/products/prod-slice1-1", async (route) => {
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
                '<p>Deskripsi <strong>aman</strong> admin.</p>' +
                '<script>window.__xssAdmin = true;</script>' +
                '<img src="https://cdn.example.com/safe.jpg" alt="Foto Aman" onerror="window.__xssAdmin = true" />' +
                '<a href="javascript:alert(1)">Link Berbahaya</a>' +
                '<a href="https://adfsports.id/panduan" target="_blank">Panduan Ukuran</a>',
              basePrice: "450000",
              status: "active",
              jubelioItemGroupId: 9001,
              thumbnail: null,
              categories: [{ id: "cat-1", name: "Running", slug: "running" }],
              images: [],
              variants: [],
              branchStock: { scope: "all", branches: [] },
            },
          }),
        });
      });

      await page.goto("/admin/products/prod-slice1-1");

      await expect(page.getByText("Deskripsi aman admin.")).toBeVisible();
      const xssFlag = await page.evaluate(
        () => (window as unknown as { __xssAdmin?: boolean }).__xssAdmin
      );
      expect(xssFlag).toBeUndefined();

      const descContainer = page.locator(".prose");
      await expect(descContainer.locator("script")).toHaveCount(0);
      await expect(descContainer.locator("strong")).toHaveText("aman");

      const safeImg = descContainer.locator('img[alt="Foto Aman"]');
      await expect(safeImg).toHaveAttribute(
        "src",
        "https://cdn.example.com/safe.jpg"
      );
      expect(await safeImg.getAttribute("onerror")).toBeNull();

      const safeAnchor = descContainer.getByRole("link", {
        name: "Panduan Ukuran",
      });
      await expect(safeAnchor).toHaveAttribute("target", "_blank");
      await expect(safeAnchor).toHaveAttribute("rel", "noopener noreferrer");

      expect(await descContainer.innerHTML()).not.toContain("javascript:");
    } finally {
      await page.close();
    }
  });
});
