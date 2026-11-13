import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { Pool } from "pg";
import { randomUUID } from "node:crypto";
import dotenv from "dotenv";
dotenv.config({ path: ".env", quiet: true });

const baseURL = process.env.E2E_MOCK_ADMIN_BASE_URL ?? "http://localhost:3111";
let context: BrowserContext;
const customers = Array.from({ length: 23 }, (_, index) => ({
  id: `fixture-customer-${index + 1}`,
  name: `Customer ${String(index + 1).padStart(2, "0")}`,
  email: `customer${index + 1}@example.test`,
  phone: index === 22 ? "081234999" : null,
  birthDate: null, gender: null, onboardingCompleted: index < 15,
  createdAt: "2040-01-01T00:00:00.000Z", updatedAt: "2040-01-01T00:00:00.000Z",
  orderCount: index === 22 ? 4 : 0,
}));

test.beforeAll(async ({ browser }) => {
  const origin = new URL(baseURL);
  if (process.env.E2E_PROVIDER_MOCKS !== "true" || !["3111", "3311"].includes(origin.port) || !["localhost", "127.0.0.1"].includes(origin.hostname)) {
    throw new Error("Customer spec requires isolated mock config");
  }
  context = await browser.newContext({ baseURL });
  const signIn = await context.request.post("/api/auth/sign-in/username", {
    data: { username: "hqmanager", password: "hq123" },
  });
  expect(signIn.ok()).toBe(true);
});
test.afterAll(async () => { await context?.close(); });

async function mockDirectory(page: Page) {
  await page.route("**/api/admin/customers?*", async (route) => {
    const params = new URL(route.request().url()).searchParams;
    const search = (params.get("search") ?? "").toLowerCase();
    const filtered = customers.filter((row) => [row.name, row.email, row.phone ?? ""].some((field) => field.toLowerCase().includes(search)));
    const current = Number(params.get("page") ?? 1);
    await route.fulfill({ json: {
      success: true, data: filtered.slice((current - 1) * 10, current * 10),
      pagination: { page: current, limit: 10, total: filtered.length, totalPages: Math.max(1, Math.ceil(filtered.length / 10)) },
    } });
  });
}

const rows = (page: Page) => page.getByRole("row").filter({ has: page.getByRole("link", { name: /Lihat detail/ }) });

test("shows 10/10/3 rows, preserves global summary, and resets search to page 1 across all customers", async () => {
  const page = await context.newPage();
  try {
    await mockDirectory(page);
    await page.goto("/admin/customers");
    await expect(rows(page)).toHaveCount(10);
    await expect(page.getByText("Page 1 of 3")).toBeVisible();
    await expect(page.getByRole("button", { name: "Previous" })).toBeDisabled();
    const summary = page.getByText("Registered customers", { exact: true }).locator("..");
    const globalSummary = await summary.textContent();
    await page.getByRole("button", { name: "Next", exact: true }).click();
    await expect(page.getByText("Page 2 of 3")).toBeVisible();
    await expect(rows(page)).toHaveCount(10);
    await expect(rows(page).first()).toContainText("Customer 11");
    await page.getByRole("button", { name: "Next", exact: true }).click();
    await expect(page.getByText("Page 3 of 3")).toBeVisible();
    await expect(rows(page)).toHaveCount(3);
    await expect(page.getByRole("button", { name: "Next", exact: true })).toBeDisabled();
    await page.getByRole("textbox", { name: "Cari customer berdasarkan nama, email, atau telepon" }).fill("CUSTOMER23@EXAMPLE.TEST");
    await expect(page.getByText("Page 1 of 1")).toBeVisible();
    await expect(rows(page)).toHaveCount(1);
    await expect(rows(page)).toContainText("Customer 23");
    await expect(summary).toHaveText(globalSummary);
    await expect(page.getByRole("link", { name: "Lihat detail Customer 23" })).toHaveAttribute("href", "/admin/customers/fixture-customer-23");
  } finally { await page.close(); }
});

test("distinguishes empty and no-match states and lets the user recover from a failed request", async () => {
  const page = await context.newPage();
  let failure = false;
  try {
    await page.route("**/api/admin/customers?*", (route) => route.fulfill({
      status: failure ? 500 : 200,
      json: failure ? { success: false } : { success: true, data: [], pagination: { page: 1, totalPages: 1 } },
    }));
    await page.goto("/admin/customers");
    await expect(page.getByText("Belum ada customer.", { exact: true })).toBeVisible();
    await page.getByRole("textbox", { name: /Cari customer/ }).fill("missing");
    await expect(page.getByText("Tidak ada customer yang cocok dengan pencarian ini.")).toBeVisible();
    failure = true;
    await page.getByRole("textbox", { name: /Cari customer/ }).fill("retry");
    await expect(page.getByRole("alert").filter({ hasText: "Gagal memuat customer." })).toHaveText(/Gagal memuat customer/);
    await expect(page.getByRole("button", { name: "Next", exact: true })).toBeDisabled();
    failure = false;
    await page.getByRole("button", { name: "Coba lagi" }).click();
    await expect(page.getByText("Tidak ada customer yang cocok dengan pencarian ini.")).toBeVisible();
    await expect(page.getByRole("textbox", { name: /Cari customer/ })).toHaveValue("retry");
  } finally { await page.close(); }
});

test("shows loading, prevents repeated navigation, and ignores a delayed older response", async () => {
  const page = await context.newPage();
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => { release = resolve; });
  let started: () => void = () => {};
  const requestStarted = new Promise<void>((resolve) => { started = resolve; });
  try {
    await mockDirectory(page);
    await page.route("**/api/admin/customers?*", async (route) => {
      if (new URL(route.request().url()).searchParams.get("search") !== "Customer 0") return route.fallback();
      started();
      await held;
      await route.fulfill({ json: { success: true, data: [customers[0]], pagination: { page: 1, totalPages: 1 } } }).catch(() => {});
    });
    await page.goto("/admin/customers");
    await expect(rows(page)).toHaveCount(10);
    const input = page.getByRole("textbox", { name: /Cari customer/ });
    await input.fill("Customer 0");
    await requestStarted;
    await expect(page.getByRole("status")).toHaveText("Memuat customer...");
    await expect(page.getByRole("button", { name: "Next", exact: true })).toBeDisabled();
    await input.fill("081234999");
    await expect(rows(page)).toHaveCount(1);
    await expect(rows(page)).toContainText("Customer 23");
    release();
    // A subsequent search also tests trimming and replacement after the old response.
    await input.fill("  customer23@example.test  ");
    await expect(rows(page)).toContainText("Customer 23");
    await input.press("Tab");
    await expect(page.getByRole("link", { name: "Lihat detail Customer 23" })).toBeFocused();
  } finally { release(); await page.close(); }
});

test("the real API paginates 23 fixture customers and applies literal search before slicing", async () => {
  const databaseURL = new URL(process.env.DATABASE_URL!);
  if (!["localhost", "127.0.0.1"].includes(databaseURL.hostname)) throw new Error("Fixture writes require local PostgreSQL");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const prefix = `customer-pagination-${randomUUID()}`;
  const ids = Array.from({ length: 23 }, (_, i) => `${prefix}-${String(i + 1).padStart(2, "0")}`);
  try {
    for (let i = 0; i < ids.length; i++) {
      await pool.query(`INSERT INTO client (id,name,email,phone,created_at,updated_at)
        VALUES ($1,$2,$3,$4,$5,$5)`, [ids[i], `${prefix} ${i === 22 ? "%_" : i + 1}`, `${ids[i]}@example.test`, i === 22 ? `${prefix}-phone` : null, new Date("2040-01-01T00:00:00Z")]);
    }
    const allIds: string[] = [];
    for (const [index, expectedCount] of [10, 10, 3].entries()) {
      const response = await context.request.get(`/api/admin/customers?limit=10&page=${index + 1}&search=${prefix}`);
      expect(response.ok()).toBe(true);
      const body = await response.json();
      expect(body.pagination).toMatchObject({ page: index + 1, total: 23, totalPages: 3 });
      expect(body.data).toHaveLength(expectedCount);
      allIds.push(...body.data.map((row: { id: string }) => row.id));
    }
    expect(new Set(allIds).size).toBe(23);
    expect(allIds[0]).toBe(ids[22]); // equal timestamps use stable ID descending.
    for (const search of ["%_", `${prefix}-phone`, `${ids[22].toUpperCase()}@EXAMPLE.TEST`]) {
      const response = await context.request.get(`/api/admin/customers?page=99&limit=10&search=${encodeURIComponent(search)}`);
      const body = await response.json();
      expect(body.pagination).toMatchObject({ page: 1, total: 1, totalPages: 1 });
      expect(body.data[0]).toMatchObject({ id: ids[22], orderCount: 0 });
    }
    const anonymous = await context.browser()!.newContext({ baseURL });
    try { expect((await anonymous.request.get("/api/admin/customers")).status()).toBe(401); }
    finally { await anonymous.close(); }
  } finally {
    await pool.query("DELETE FROM client WHERE id = ANY($1::text[])", [ids]);
    await pool.end();
  }
});

test("denies branch-admin access and sends an expired session back through the page guard", async ({ browser }) => {
  const branch = await browser.newContext({ baseURL });
  const expired = await browser.newContext({ baseURL, storageState: await context.storageState() });
  try {
    expect((await branch.request.post("/api/auth/sign-in/username", {
      data: { username: "admintoko", password: "admin123" },
    })).ok()).toBe(true);
    expect((await branch.request.get("/api/admin/customers")).status()).toBe(403);
    const deniedPage = await branch.newPage();
    await deniedPage.goto("/admin/customers");
    await expect(deniedPage).toHaveURL(/\/admin\/no-access/);
    const expiredPage = await expired.newPage();
    await expiredPage.route("**/api/admin/customers?*", async (route) => {
      await expired.clearCookies();
      await route.fulfill({ status: 401, json: { success: false } });
    });
    await expiredPage.goto("/admin/customers");
    await expect(expiredPage).toHaveURL(/\/login/);
  } finally { await branch.close(); await expired.close(); }
});

test("opens an existing customer detail without changing the order-history flow", async () => {
  const response = await context.request.get("/api/admin/customers?limit=1");
  expect(response.ok()).toBe(true);
  const { data } = await response.json();
  expect(data.length).toBe(1);
  const page = await context.newPage();
  try {
    await page.goto("/admin/customers");
    await page.getByRole("textbox", { name: /Cari customer/ }).fill(data[0].email);
    await page.getByRole("link", { name: `Lihat detail ${data[0].name}`, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/admin/customers/${data[0].id}$`));
    await expect(page.getByRole("heading", { name: data[0].name, exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Order History" })).toBeVisible();
  } finally { await page.close(); }
});

test("matches Branches table controls at desktop and keeps the wide table scrollable on mobile", async () => {
  const page = await context.newPage();
  try {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/admin/branches");
    await expect(page.getByRole("columnheader", { name: "Nama Cabang" })).toBeVisible();
    const peer = await page.getByRole("columnheader", { name: "Nama Cabang" }).evaluate((element) => {
      const style = getComputedStyle(element);
      return { fontSize: style.fontSize, height: style.height, padding: style.padding, fontWeight: style.fontWeight };
    });
    await page.screenshot({ path: "playwright/mcp/customers-table/branches-desktop.png", fullPage: true });
    await mockDirectory(page);
    await page.goto("/admin/customers");
    await expect(rows(page)).toHaveCount(10);
    const actual = await page.getByRole("columnheader", { name: "Nama", exact: true }).evaluate((element) => {
      const style = getComputedStyle(element);
      return { fontSize: style.fontSize, height: style.height, padding: style.padding, fontWeight: style.fontWeight };
    });
    expect(actual).toEqual(peer);
    await page.screenshot({ path: "playwright/mcp/customers-table/customers-desktop.png", fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const table = page.getByRole("table").locator("..");
    expect(await table.evaluate((element) => element.scrollWidth > element.clientWidth && getComputedStyle(element).overflowX === "auto")).toBe(true);
    await page.getByRole("button", { name: "Next", exact: true }).scrollIntoViewIfNeeded();
    await expect(page.getByRole("button", { name: "Next", exact: true })).toBeInViewport();
    await page.screenshot({ path: "playwright/mcp/customers-table/customers-mobile.png", fullPage: true });
  } finally { await page.close(); }
});
