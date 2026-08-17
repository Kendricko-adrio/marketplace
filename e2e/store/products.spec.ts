import { test, expect } from "@playwright/test";

// Storefront product listing — covers infinite-scroll, product-filters, and
// pricing-model (net price + RRP strikethrough + discount badge on cards).
// Uses the authenticated store session (storageState) but /products is public.

test.describe("storefront product listing", () => {
  test("renders the first page server-side and appends more on scroll", async ({
    page,
  }) => {
    await page.goto("/products");

    // First page is SSR'd with 20 products (limit=20).
    await expect(page.getByText(/Menampilkan 20 dari \d+ produk/)).toBeVisible();
    await expect(page.locator("div.rounded-lg.border")).toHaveCount(20);

    // Scroll to the bottom → the IntersectionObserver fetches page 2 and the
    // grid appends 20 more cards (the "Menampilkan X dari Y" header is
    // server-rendered and does not update — assert the grid itself).
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await expect(page.locator("div.rounded-lg.border")).toHaveCount(40, {
      timeout: 20_000,
    });
  });

  test("shows the end-of-list footer when all results fit on one page", async ({
    page,
  }) => {
    // A narrow search returns a single product → no more pages → footer state.
    await page.goto("/products?search=high+top");
    await expect(
      page.getByText(/Semua \d+ dari \d+ produk telah ditampilkan/)
    ).toBeVisible();
  });

  test("sidebar filters update the URL and narrow the results", async ({
    page,
  }) => {
    await page.goto("/products");

    // Category combobox — open it and pick "Sneakers" (seeded category).
    await page.getByRole("combobox", { name: "Kategori" }).click();
    await page.getByRole("option", { name: "Sneakers", exact: true }).click();

    // Brand dropdown.
    const brandSelect = page.locator("select", {
      has: page.locator("option", { hasText: "Semua brand" }),
    });
    await brandSelect.selectOption({ index: 1 });
    const brandSlug = await brandSelect
      .locator("option")
      .nth(1)
      .getAttribute("value");

    await page.getByRole("button", { name: "Terapkan Filter" }).click();

    // URL reflects every selection.
    await expect(page).toHaveURL(
      new RegExp(`category=sneakers&brand=${brandSlug}`)
    );
    // The grid reset to a fresh first page of the filtered set.
    await expect(page.getByText(/Menampilkan \d+ dari \d+ produk/)).toBeVisible();
  });

  test("branch filter lists active branches and excludes no-stock products", async ({
    page,
  }) => {
    await page.goto("/products");

    // The branch dropdown shows active branches only — the seeded Bandung
    // branch is nonaktif and must not appear.
    const branchSelect = page.locator("select", {
      has: page.locator("option", { hasText: "Semua cabang" }),
    });
    await expect(
      branchSelect.locator("option", { hasText: "Cabang Bandung Dago" })
    ).toHaveCount(0);

    // Resolve an active branch from the API (ids are random; the dev DB is
    // populated from the Jubelio sync, so pick whatever is active).
    const branch = await page.evaluate(async () => {
      const res = await fetch("/api/branches");
      const data = await res.json();
      return data.data[0] as { id: string; name: string };
    });

    await branchSelect.selectOption({ label: branch.name });
    await page.getByRole("button", { name: "Terapkan Filter" }).click();

    // URL reflects the branch selection (ids contain colons → URL-encoded).
    await expect(page).toHaveURL(
      new RegExp(`branch=${encodeURIComponent(branch.id)}`)
    );

    // The seeded no-stock product (zero stock in every branch) is excluded
    // from the branch-filtered results.
    await expect(page.getByText("AirRunner Pro Running Shoes")).toHaveCount(0);
  });

  test("category filter applied via URL narrows the SSR result set", async ({
    page,
  }) => {
    // Direct URL navigation exercises the SSR path (getProducts → /api/products),
    // which previously dropped the `category` param and returned every product
    // as if unfiltered. Assert the filtered total is strictly smaller than the
    // unfiltered total (and non-zero) to prove the category reaches the API.
    await page.goto("/products");
    const unfilteredHeader = page.getByText(/Menampilkan \d+ dari (\d+) produk/);
    await expect(unfilteredHeader).toBeVisible();
    const allText = (await unfilteredHeader.textContent()) ?? "";
    const totalAll = parseInt(allText.match(/dari (\d+) produk/)?.[1] ?? "0", 10);

    await page.goto("/products?category=sneakers");
    const filteredHeader = page.getByText(/Menampilkan \d+ dari (\d+) produk/);
    await expect(filteredHeader).toBeVisible();
    const catText = (await filteredHeader.textContent()) ?? "";
    const totalCat = parseInt(catText.match(/dari (\d+) produk/)?.[1] ?? "0", 10);

    expect(totalCat).toBeGreaterThan(0);
    expect(totalCat).toBeLessThan(totalAll);
  });

  test("category combobox is searchable", async ({ page }) => {
    await page.goto("/products");

    await page.getByRole("combobox", { name: "Kategori" }).click();

    // Typing a fragment narrows the list to matching categories.
    await page.getByPlaceholder("Cari kategori...").fill("sneak");
    await expect(
      page.getByRole("option", { name: "Sneakers", exact: true })
    ).toBeVisible();
    await expect(
      page.getByRole("option", { name: "Boots", exact: true })
    ).toHaveCount(0);

    // A nonsense query shows the empty state (cmdk fuzzy-matches, so use a
    // string with letters no category name contains).
    await page.getByPlaceholder("Cari kategori...").fill("qqqq");
    await expect(page.getByText("Tidak ada kategori ditemukan.")).toBeVisible();
  });

  test("cards show net price, RRP strikethrough, and discount badge", async ({
    page,
  }) => {
    await page.goto("/products?hasDiscount=true");

    // A discounted card shows the % badge, the net price, and the RRP
    // strikethrough (pricing-model: discount = basePrice > min variant price).
    const discountedCard = page
      .locator("div.rounded-lg.border", {
        has: page.locator(".bg-destructive"),
      })
      .first();
    await expect(discountedCard).toBeVisible();

    await expect(discountedCard.getByText(/^Rp [\d.]+$/).first()).toBeVisible();
    await expect(discountedCard.locator("span.line-through")).toBeVisible();
    await expect(discountedCard.locator(".bg-destructive").first()).toHaveText(
      /\d+%/
    );
  });

  test("out-of-stock cards are greyed out with a Stok Habis badge", async ({
    page,
  }) => {
    // The seeder leaves "AirRunner Pro Running Shoes" with zero stock in every
    // branch — its card must be greyed out (opacity) with a disabled link.
    await page.goto("/products?search=airrunner");

    const card = page
      .locator("div.rounded-lg.border", {
        hasText: "AirRunner Pro Running Shoes",
      })
      .first();
    await expect(card).toBeVisible();
    await expect(card.getByText("Stok Habis")).toBeVisible();
    // Greyed out: no navigation links inside the card.
    await expect(card.locator("a")).toHaveCount(0);
    // And the card root carries the opacity-50 class.
    await expect(card).toHaveClass(/opacity-50/);
  });
});
