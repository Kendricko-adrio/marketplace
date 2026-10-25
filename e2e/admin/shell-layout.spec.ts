import { test, expect, type Page } from "@playwright/test";

// Admin app shell — the layout contract behind "only the content area scrolls".
//
// Regressions covered here (all three used to move the whole window or make it
// scrollable, which pushed the sidebar and the "Admin Dashboard" header out of
// view — see docs/architecture/admin-app-shell.md):
//   1. the shell sized itself with `min-h-screen`, so the document grew with
//      the page content and <main>'s `overflow-y-auto` never activated;
//   2. the analytics chart's visually hidden fallback table escaped <main> —
//      `overflow` cannot clip a `display: table` box;
//   3. absolutely positioned `sr-only` inputs inside checkbox fields had no
//      positioned ancestor, so they resolved against the initial containing
//      block and grew the document too.
//
// The contract asserted below:
//   a. the document never scrolls inside /admin (md+),
//   b. scrolling moves only the <main> region, while the sidebar and the
//      header keep their viewport position,
//   c. a short viewport scrolls the sidebar navigation instead of clipping it
//      or hiding the account footer.

async function loginAsHq(page: Page): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Email atau Username").fill("hqmanager");
  await page.getByLabel("Password").fill("hq123");
  // A click before hydration falls through to a native form submit and leaves
  // the page on /login, so the submit is retried until the router moves.
  for (let attempt = 0; attempt < 3; attempt++) {
    await page.getByRole("button", { name: "Masuk", exact: true }).click();
    try {
      await page.waitForURL(/\/admin\//, { timeout: 15_000 });
      return;
    } catch {
      await page.waitForLoadState("domcontentloaded");
    }
  }
  throw new Error(`admin HQ login did not reach /admin (at ${page.url()})`);
}

/** Scrollable distance of the shell's <main> content region (the first main). */
async function mainScrollable(page: Page): Promise<number> {
  return page.evaluate(() => {
    const main = document.querySelector("main") as HTMLElement;
    return main.scrollHeight - main.clientHeight;
  });
}

/**
 * Scroll the content region down. Waits for the (client-fetched) content to
 * actually overflow first, so the assertion measures the shell instead of a
 * half-rendered page.
 */
async function scrollMain(page: Page): Promise<void> {
  await expect.poll(() => mainScrollable(page)).toBeGreaterThan(0);
  await page
    .locator("main")
    .first()
    .evaluate((el) => el.scrollTo({ top: 400, behavior: "instant" }));
  await expect
    .poll(() => page.evaluate(() => document.querySelector("main")!.scrollTop))
    .toBeGreaterThan(0);
}

async function documentOverflow(page: Page): Promise<number> {
  return page.evaluate(() => {
    const doc = document.scrollingElement as HTMLElement;
    return doc.scrollHeight - doc.clientHeight;
  });
}

/** Viewport-relative top of the sidebar, the page header and the window scroll. */
async function shellAnchors(
  page: Page
): Promise<{ aside: number; header: number; windowScroll: number }> {
  return page.evaluate(() => ({
    aside: Math.round(document.querySelector("aside")!.getBoundingClientRect().top),
    header: Math.round(document.querySelector("header")!.getBoundingClientRect().top),
    windowScroll: Math.round(window.scrollY),
  }));
}

const CHROME_IN_PLACE = { aside: 0, header: 0, windowScroll: 0 };

test.describe("admin shell scrolls only its content area", () => {
  test.use({ viewport: { width: 1280, height: 600 } });

  test("scrolling the page keeps the sidebar and header in place", async ({
    page,
  }) => {
    await page.goto("/admin/products");
    // Let the product table render tall enough to overflow <main>.
    await expect(page.getByText("Daftar Produk")).toBeVisible();

    expect(await documentOverflow(page)).toBe(0);
    expect(await shellAnchors(page)).toEqual(CHROME_IN_PLACE);

    // Scroll the content region (the only scroller in the shell).
    await scrollMain(page);

    expect(await shellAnchors(page)).toEqual(CHROME_IN_PLACE);
    expect(await documentOverflow(page)).toBe(0);
  });

  test("the safe-state page fills the content area without a second main landmark", async ({
    page,
  }) => {
    // The seeded Admin Role has no `footer` grant, so this module redirects to
    // the safe state — which renders INSIDE the shell content area.
    await page.goto("/admin/footer");
    await page.waitForURL(/\/admin\/no-access/);
    await expect(page.getByTestId("safe-state")).toBeVisible();

    // One <main> landmark only (the shell's), and no pointless scrolling: a
    // `min-h-screen` block inside the content area can never fit.
    expect(await page.locator("main").count()).toBe(1);
    expect(await documentOverflow(page)).toBe(0);
    expect(await mainScrollable(page)).toBe(0);
    expect(await shellAnchors(page)).toEqual(CHROME_IN_PLACE);
  });

  test("a short viewport scrolls the sidebar nav and keeps the account footer", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 520 });
    await page.goto("/admin/products");
    await expect(page.getByText("Daftar Produk")).toBeVisible();

    const nav = page.locator("aside nav");
    const navScroll = await nav.evaluate((el) => ({
      overflowY: getComputedStyle(el).overflowY,
      scrollable: el.scrollHeight - el.clientHeight,
    }));
    expect(navScroll.overflowY).toBe("auto");
    expect(navScroll.scrollable).toBeGreaterThan(0);

    // Scrolling the nav must not move the page, and the footer stays reachable.
    await nav.evaluate((el) => el.scrollTo(0, el.scrollHeight));
    expect(await shellAnchors(page)).toEqual(CHROME_IN_PLACE);
    expect(await documentOverflow(page)).toBe(0);
    await expect(page.locator("aside").getByRole("button").last()).toBeInViewport();
  });
});

// HQ has the module grants the two regressions need (analytics chart, footer
// editor); the shared saved session (seeded Admin Role) does not.
test.describe("admin pages with HQ grants do not grow the page scroll area", () => {
  test.use({
    storageState: { cookies: [], origins: [] },
    viewport: { width: 1440, height: 900 },
  });

  test("the analytics chart fallback table stays clipped inside the content area", async ({
    page,
  }) => {
    await loginAsHq(page);
    await page.goto("/admin/analytics");
    // 30-row visually hidden fallback table — the element that used to escape
    // <main> and make the document scrollable.
    await expect(page.getByTestId("analytics-trend-table")).toBeAttached();
    await expect(
      page.getByText("Tren Pendapatan", { exact: true })
    ).toBeVisible();

    expect(await documentOverflow(page)).toBe(0);
    await scrollMain(page);
    expect(await shellAnchors(page)).toEqual(CHROME_IN_PLACE);
    expect(await documentOverflow(page)).toBe(0);
  });

  test("absolutely positioned field helpers cannot grow the page", async ({
    page,
  }) => {
    // The footer editor renders many checkbox groups; each wraps an absolutely
    // positioned `sr-only` input.
    await loginAsHq(page);
    await page.goto("/admin/footer");
    await expect.poll(() => mainScrollable(page)).toBeGreaterThan(0);

    expect(await documentOverflow(page)).toBe(0);
    await scrollMain(page);
    expect(await shellAnchors(page)).toEqual(CHROME_IN_PLACE);
    expect(await documentOverflow(page)).toBe(0);
  });
});
