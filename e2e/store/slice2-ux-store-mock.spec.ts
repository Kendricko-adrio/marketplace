import { expect, test, type Page } from "@playwright/test";
import { TEST_USERS } from "../config";

const STORE_BASE_URL =
  process.env.E2E_MOCK_STORE_BASE_URL ?? "http://localhost:3110";
const MOCK_PORTS = new Set(["3110", "3111", "3112"]);

function requireIsolatedMockRun(): void {
  if (
    process.env.E2E_PROVIDER_MOCKS !== "true" ||
    !process.env.E2E_MOCK_STORE_BASE_URL
  ) {
    throw new Error(
      "slice2-ux-store-mock.spec.ts harus dijalankan lewat playwright.mock.config.ts"
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

async function signIn(page: Page) {
  const res = await page.request.post("/api/auth/sign-in/email", {
    data: TEST_USERS.store,
  });
  expect(res.ok(), `sign-in gagal: ${res.status()} ${await res.text()}`).toBe(
    true
  );
}

test.describe("Slice 2 Store — UX Storefront, Mobile, Boundaries & Dark-Mode Safety", () => {
  test.beforeEach(() => {
    requireIsolatedMockRun();
  });

  test("AC-1: /account default ke tab Profil, ?tab=orders ke Pesanan, Coba Lagi memicu fetch ulang, dead UI hilang, dan Keluar logout", async ({
    page,
  }) => {
    await signIn(page);

    await page.goto(`${STORE_BASE_URL}/account`);
    await expect(
      page.getByRole("button", { name: "Simpan Perubahan" })
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Riwayat Pesanan" })
    ).toHaveCount(0);
    await expect(page.getByText("Member Silver")).toHaveCount(0);
    await expect(page.getByPlaceholder("Cari pesanan...")).toHaveCount(0);

    let ordersCalls = 0;
    await page.route("**/api/orders", async (route) => {
      ordersCalls += 1;
      if (ordersCalls === 1) {
        await route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({
            success: false,
            error: "Gagal memuat pesanan",
          }),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ success: true, data: [] }),
      });
    });

    await page.goto(`${STORE_BASE_URL}/account?tab=orders`);
    await expect(
      page.getByRole("heading", { name: "Riwayat Pesanan" })
    ).toBeVisible();
    await expect(page.getByText("Gagal memuat pesanan")).toBeVisible();

    await page.getByRole("button", { name: "Coba Lagi" }).click();
    await expect(page.getByText("Belum ada pesanan")).toBeVisible();
    expect(ordersCalls).toBe(2);

    await page.getByRole("button", { name: "Keluar" }).click();
    await expect(page).toHaveURL(`${STORE_BASE_URL}/`);
  });

  test("AC-2: Mobile Header (390x844) 1 baris dengan Search dialog, Menu drawer, dan 0 nested interactive", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${STORE_BASE_URL}/`);

    const headerBox = await page.locator("header").boundingBox();
    expect(headerBox).not.toBeNull();
    expect(headerBox!.height).toBeLessThanOrEqual(72);

    const hasOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth
    );
    expect(hasOverflow).toBe(false);

    const nestedCount = await page
      .locator("header a button, header button a")
      .count();
    expect(nestedCount).toBe(0);

    await page.getByRole("button", { name: "Cari produk" }).click();
    const searchDialog = page.getByRole("dialog");
    await expect(searchDialog).toBeVisible();
    await searchDialog.getByPlaceholder("Cari produk...").fill("sepatu");
    await searchDialog.getByRole("button", { name: "Cari" }).click();
    await expect(page).toHaveURL(/\/products\?search=sepatu/);
    await expect(searchDialog).toBeHidden();

    await page.getByRole("button", { name: "Buka menu navigasi" }).click();
    const navDrawer = page.getByRole("dialog");
    await expect(navDrawer).toBeVisible();
    await navDrawer.getByRole("link", { name: "Cabang" }).click();
    await expect(page).toHaveURL(/\/branches$/);
  });

  test("AC-3: InfiniteProductGrid memakai URL relatif, retry error, dan update live counter", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });

    let page2Calls = 0;
    const requestedOrigins: string[] = [];
    await page.route("**/api/products?*", async (route) => {
      const url = new URL(route.request().url());
      requestedOrigins.push(url.origin);
      page2Calls += 1;
      if (page2Calls === 1) {
        await route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ success: false, error: "Server error" }),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          success: true,
          data: [
            {
              id: "mock-p-21",
              name: "Sepatu Uji Halaman 2 A",
              slug: "sepatu-uji-2a",
              price: "350000",
              basePrice: "350000",
              image: null,
              collection: "Running",
              gender: "Unisex",
              hasStock: true,
            },
            {
              id: "mock-p-22",
              name: "Sepatu Uji Halaman 2 B",
              slug: "sepatu-uji-2b",
              price: "420000",
              basePrice: "420000",
              image: null,
              collection: null,
              gender: null,
              hasStock: true,
            },
          ],
          pagination: {
            page: 2,
            limit: 20,
            total: 22,
            totalPages: 2,
          },
        }),
      });
    });

    await page.goto(`${STORE_BASE_URL}/products`);
    await expect(page.getByText(/Menampilkan 20 dari \d+ produk/)).toBeVisible();

    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await expect(
      page.getByText("Gagal memuat produk berikutnya.")
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Coba muat lagi" })
    ).toBeVisible();

    await page.getByRole("button", { name: "Coba muat lagi" }).click();
    await expect(page.getByText("Sepatu Uji Halaman 2 A")).toBeVisible();
    await expect(page.getByText("Menampilkan 22 dari 22 produk")).toBeVisible();
    expect(requestedOrigins.every((origin) => origin === STORE_BASE_URL)).toBe(
      true
    );
  });

  test("AC-4 & AC-5 & AC-6: html[lang=id], tombol ukuran All Size tidak terpotong, 404 berbahasa Indonesia, dan dark-mode safe", async ({
    page,
  }) => {
    await page.route("**/api/products/sepatu-all-size", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          success: true,
          data: {
            id: "prod-all-size",
            name: "Kaos Kaki Lari",
            slug: "sepatu-all-size",
            description: "<p>Nyaman dipakai.</p>",
            basePrice: "75000",
            status: "active",
            categories: [{ id: "cat-1", name: "Accessories" }],
            images: [],
            variants: [
              {
                id: "var-all-size",
                sku: "KKL-AS",
                color: "Hitam",
                size: "All Size",
                price: "75000",
                isDefault: true,
                images: [],
                branchStock: [
                  {
                    branchId: "br-1",
                    name: "Jakarta Pusat",
                    code: "JKT",
                    city: "Jakarta",
                    stock: 10,
                    reservedStock: 0,
                    available: 10,
                  },
                ],
              },
            ],
          },
        }),
      });
    });

    await page.goto(`${STORE_BASE_URL}/products/sepatu-all-size`);
    await expect(page.locator("html")).toHaveAttribute("lang", "id");

    const sizeBtn = page.getByRole("button", { name: "All Size" });
    await expect(sizeBtn).toBeVisible();
    const isClipped = await sizeBtn.evaluate(
      (el) => el.scrollWidth > el.clientWidth
    );
    expect(isClipped).toBe(false);

    // 404 boundary berbahasa Indonesia
    await page.goto(`${STORE_BASE_URL}/halaman-tidak-ditemukan-xyz`);
    await expect(
      page.getByRole("heading", { name: "Halaman tidak ditemukan" })
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Kembali ke Beranda" })
    ).toHaveAttribute("href", "/");
    await expect(
      page.getByRole("link", { name: "Lihat Katalog" })
    ).toHaveAttribute("href", "/products");

    // Dark mode safety check pada /products
    await page.goto(`${STORE_BASE_URL}/products`);
    await page.evaluate(() => document.documentElement.classList.add("dark"));
    const bodyBg = await page.evaluate(
      () => getComputedStyle(document.body).backgroundColor
    );
    expect(bodyBg).not.toBe("rgba(0, 0, 0, 0)");
  });
});
