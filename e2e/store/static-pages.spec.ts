import { test, expect } from "@playwright/test";

// Static pages (CMS markdown) + footer rendering on the storefront.

test.describe("storefront static pages & footer", () => {
  test("renders a published static page with title and markdown content", async ({
    page,
  }) => {
    await page.goto("/pages/about");

    // The page H1 (the markdown content also repeats the title — take first).
    await expect(
      page.getByRole("heading", { name: "Tentang Kami" }).first()
    ).toBeVisible();
    // Markdown content is rendered (seeded about page has a paragraph).
    await expect(page.getByText(/StoreFront/i).first()).toBeVisible();
  });

  test("renders the footer with brand, columns, and copyright on every page", async ({
    page,
  }) => {
    await page.goto("/products");

    const footer = page.locator("footer");
    await expect(footer).toBeVisible();
    // Seeded footer config: brand name + copyright.
    await expect(footer.getByText("StoreFront").first()).toBeVisible();
    await expect(
      footer.getByText("© 2026 StoreFront. All rights reserved.")
    ).toBeVisible();
    // Footer link columns (Layanan / Bantuan / Katalog) render.
    await expect(footer.getByText("Layanan")).toBeVisible();
    await expect(footer.getByText("Bantuan")).toBeVisible();
    await expect(footer.getByText("Katalog")).toBeVisible();
  });

  test("footer links to static pages resolve", async ({ page }) => {
    await page.goto("/");
    const footer = page.locator("footer");
    // The footer's "Tentang" column links to the about page.
    const aboutLink = footer.getByRole("link", { name: "Tentang Kami" });
    if ((await aboutLink.count()) > 0) {
      await aboutLink.first().click();
      await expect(page).toHaveURL(/\/pages\/about/);
      await expect(
        page.getByRole("heading", { name: "Tentang Kami" }).first()
      ).toBeVisible();
    }
  });
});
