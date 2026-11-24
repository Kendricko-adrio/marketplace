import { test, expect, type BrowserContext } from "@playwright/test";

const baseURL = process.env.E2E_MOCK_ADMIN_BASE_URL ?? "http://localhost:3111";
let context: BrowserContext;

test.beforeAll(async ({ browser }) => {
  context = await browser.newContext({ baseURL });
  const signIn = await context.request.post("/api/auth/sign-in/username", {
    data: { username: "hqmanager", password: "hq123" },
  });
  expect(signIn.ok()).toBe(true);
});

test.afterAll(async () => {
  await context?.close();
});

test.describe("Slice 3 UX Admin — Mobile Drawer, List Contract, A11y & Boundaries", () => {
  test("AC-1: mobile drawer opens from top bar hamburger, navigates, and closes automatically; desktop icons distinct", async () => {
    const page = await context.newPage();
    try {
      await page.route("**/api/admin/products?*", (route) =>
        route.fulfill({
          json: { success: true, data: [], pagination: { page: 1, totalPages: 1 } },
        })
      );
      await page.route("**/api/admin/orders?*", (route) =>
        route.fulfill({
          json: {
            success: true,
            data: [],
            pagination: { page: 1, limit: 20, total: 0, baseTotal: 0, totalPages: 0 },
          },
        })
      );

      // Desktop check: sidebar visible and Harga SKU vs Diskon icons are distinct
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.goto("/admin/products");
      const aside = page.locator("aside");
      await expect(aside).toBeVisible();
      const hargaIcon = await aside
        .getByRole("link", { name: "Harga SKU", exact: true })
        .locator("svg")
        .innerHTML();
      const diskonIcon = await aside
        .getByRole("link", { name: "Diskon", exact: true })
        .locator("svg")
        .innerHTML();
      expect(hargaIcon).not.toBe(diskonIcon);

      // Mobile check: aside hidden, hamburger trigger opens Sheet drawer & closes on navigation
      await page.setViewportSize({ width: 390, height: 844 });
      await expect(aside).toBeHidden();
      const trigger = page.getByRole("button", { name: "Buka menu navigasi" });
      await expect(trigger).toBeVisible();
      await trigger.click();

      const drawer = page.getByRole("dialog");
      await expect(drawer).toBeVisible();
      await drawer.getByRole("link", { name: "Pesanan", exact: true }).click();
      await expect(page).toHaveURL(/\/admin\/orders/);
      await expect(drawer).toBeHidden();
    } finally {
      await page.close();
    }
  });

  test("AC-2: /admin/orders debounces search 300ms, shows loading & error retry in Indonesian", async () => {
    const page = await context.newPage();
    try {
      let requestCount = 0;
      let shouldFail = true;

      await page.route("**/api/admin/orders?*", async (route) => {
        requestCount += 1;
        if (shouldFail) {
          await route.fulfill({
            status: 500,
            json: { success: false, error: "Internal Server Error" },
          });
          return;
        }
        await route.fulfill({
          json: {
            success: true,
            data: [
              {
                id: "ord-s3-001",
                createdAt: "2026-06-01T00:00:00Z",
                status: "ready_for_pickup",
                paymentStatus: "paid",
                total: "150000",
                fulfillmentMethod: "pickup",
                customer: { name: "Budi Santoso" },
                branch: { name: "Cabang Utama" },
              },
            ],
            pagination: { page: 1, limit: 20, total: 1, baseTotal: 1, totalPages: 1 },
          },
        });
      });

      await page.goto("/admin/orders");
      await expect(page.getByRole("heading", { name: "Pesanan", exact: true })).toBeVisible();
      await expect(page.getByText("Daftar pesanan belum berhasil dimuat.")).toBeVisible();

      shouldFail = false;
      await page.getByRole("button", { name: "Coba lagi" }).click();
      await expect(page.getByText("Budi Santoso")).toBeVisible();

      const beforeSearch = requestCount;
      const searchInput = page.getByLabel("Cari pesanan");
      await searchInput.pressSequentially("budi", { delay: 30 });
      expect(requestCount).toBe(beforeSearch);
      await expect.poll(() => requestCount, { timeout: 2000 }).toBe(beforeSearch + 1);
    } finally {
      await page.close();
    }
  });

  test("AC-3: /admin/products syncs search & page to URL, debounces, and separates error from empty state", async () => {
    const page = await context.newPage();
    try {
      let shouldFail = true;
      await page.route("**/api/admin/products?*", async (route) => {
        const url = new URL(route.request().url());
        if (shouldFail) {
          await route.fulfill({
            status: 500,
            json: { success: false, error: "DB error" },
          });
          return;
        }
        const search = url.searchParams.get("search") ?? "";
        await route.fulfill({
          json: {
            success: true,
            data: [
              {
                id: "prod-1",
                name: search ? `Produk ${search}` : "Produk Default",
                slug: "produk-1",
                basePrice: "50000",
                status: "aktif",
                variants: [],
                variantCount: 1,
                totalStock: 10,
                totalReserved: 0,
                totalAvailable: 10,
                categories: ["Umum"],
              },
            ],
            pagination: { page: Number(url.searchParams.get("page") ?? 1), totalPages: 2 },
          },
        });
      });

      await page.goto("/admin/products");
      await expect(page.getByText("Gagal memuat daftar produk.")).toBeVisible();
      await expect(page.getByText("Tidak ada produk ditemukan.")).toHaveCount(0);

      shouldFail = false;
      await page.getByRole("button", { name: "Coba lagi" }).click();
      await expect(page.getByText("Produk Default")).toBeVisible();

      await page.getByPlaceholder("Cari nama produk...").fill("semen");
      await expect(page).toHaveURL(/search=semen/);
      await expect(page.getByText("Produk semen")).toBeVisible();

      expect(await page.locator("a button").count()).toBe(0);
    } finally {
      await page.close();
    }
  });

  test("AC-4 & AC-5: /admin/discounts single h1, /admin/customers Indonesian KPIs, and 0 nested a>button", async () => {
    const page = await context.newPage();
    try {
      await page.route("**/api/admin/discounts?*", (route) =>
        route.fulfill({
          json: { success: true, data: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 1 } },
        })
      );
      await page.goto("/admin/discounts");
      await expect(page.locator("h1")).toHaveCount(1);
      await expect(page.locator("h1")).toHaveText("Admin Dashboard");
      await expect(page.getByRole("heading", { level: 2, name: "Diskon", exact: true })).toBeVisible();
      expect(await page.locator("a button").count()).toBe(0);

      await page.route("**/api/admin/customers?*", (route) =>
        route.fulfill({
          json: { success: true, data: [], pagination: { page: 1, limit: 10, total: 0, totalPages: 1 } },
        })
      );
      await page.goto("/admin/customers");
      await expect(page.getByText("Direktori customer", { exact: true })).toBeVisible();
      await expect(page.getByText("Customer terdaftar", { exact: true })).toBeVisible();
      await expect(page.getByText("Onboarding selesai", { exact: true })).toBeVisible();
      await expect(page.getByText("Menunggu onboarding", { exact: true })).toBeVisible();
      await expect(page.getByText("Total pesanan", { exact: true })).toBeVisible();
    } finally {
      await page.close();
    }
  });

  test("AC-6: Admin 404 renders Indonesian not-found page with Dashboard link", async () => {
    const page = await context.newPage();
    try {
      await page.goto("/admin/halaman-tidak-ada-404");
      await expect(
        page.getByRole("heading", { name: "Halaman tidak ditemukan" })
      ).toBeVisible();
      await expect(
        page.getByRole("link", { name: "Kembali ke Dashboard" })
      ).toHaveAttribute("href", "/admin");
    } finally {
      await page.close();
    }
  });
});
