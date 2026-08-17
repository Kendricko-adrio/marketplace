import { test, expect } from "@playwright/test";

// Product detail page — pricing-model metadata (task-002): brand, gender,
// category, net price + RRP strikethrough, discount badge, stock per branch.

test.describe("storefront product detail", () => {
  test("renders full metadata for a product with rich data", async ({
    page,
  }) => {
    // Seeded product with brand/gender/collection/season/articleNumber/category.
    await page.goto("/products/classic-leather-oxford-formal");
    await page.waitForLoadState("networkidle");

    // Title + price (net) + RRP strikethrough + discount badge.
    await expect(
      page.getByRole("heading", { name: /Classic Leather Oxford/i })
    ).toBeVisible();
    await expect(page.getByText("Rp 1.500.000")).toBeVisible();
    await expect(page.getByText("Rp 1.900.000")).toBeVisible(); // RRP
    await expect(page.getByText(/Hemat \d+%/)).toBeVisible();

    // Metadata dl: brand, gender, koleksi, season, kode artikel, SKU.
    await expect(page.getByText("OxfordCo", { exact: true })).toBeVisible();
    await expect(page.getByText("Men", { exact: true })).toBeVisible();
    await expect(page.getByText("Formal", { exact: true })).toBeVisible();
    await expect(page.getByText("FW25", { exact: true })).toBeVisible();
    await expect(page.getByText("SEED-OX-003", { exact: true })).toBeVisible();
    await expect(page.getByText(/^OX-\w+-\d+$/)).toBeVisible(); // variant SKU

    // Category chip.
    await expect(page.getByText("Formal Shoes", { exact: true })).toBeVisible();

    // Stock per branch: the branch picker lists branches with available units.
    await expect(
      page.getByRole("heading", { name: "Pilih Cabang" })
    ).toBeVisible();
    const branchRows = page.locator("button", { hasText: /Stok: \d+/ });
    expect(await branchRows.count()).toBeGreaterThan(0);
  });

  test("shows out-of-stock state when no branch has stock", async ({
    page,
  }) => {
    // The seeder leaves "AirRunner Pro Running Shoes" with zero stock.
    await page.goto("/products/airrunner-pro-running-shoes");
    await page.waitForLoadState("networkidle");

    await expect(
      page.getByText("Stok habis di semua cabang")
    ).toBeVisible();
    // Add-to-cart is disabled without a selected branch.
    await expect(
      page.getByRole("button", { name: "Masukkan Keranjang" })
    ).toBeDisabled();
  });

  test("renders the description section", async ({ page }) => {
    await page.goto("/products/classic-leather-oxford-formal");
    await page.waitForLoadState("networkidle");
    await expect(page.getByText("Deskripsi")).toBeVisible();
    await expect(page.getByText(/Sepatu formal/i)).toBeVisible();
  });
});
