import { test, expect, type BrowserContext } from "@playwright/test";
import { Pool } from "pg";
import { randomUUID } from "node:crypto";
import dotenv from "dotenv";
import {
  buildWorkbookFixture,
  HEADER_ROW,
  MARKER_ROW,
} from "../../apps/admin/src/lib/xlsx-test-support";

dotenv.config({ path: ".env", quiet: true });
const ADMIN_URL =
  process.env.E2E_MOCK_ADMIN_BASE_URL ?? "http://localhost:3111";
const origin = new URL(ADMIN_URL);
const dbName = new URL(
  process.env.DATABASE_URL ?? "postgres://invalid/invalid",
).pathname.slice(1);
if (
  process.env.E2E_PROVIDER_MOCKS !== "true" ||
  !["localhost", "127.0.0.1"].includes(origin.hostname) ||
  origin.port !== "3111" ||
  !/^marketplace_discounts_test_[A-Za-z0-9_]+$/.test(dbName)
) {
  throw new Error(
    "Parity spec requires isolated mock origin and disposable discounts DB",
  );
}
const PRODUCT = "e2e-parity-product";
const variants = Array.from(
  { length: 30 },
  (_, i) => `e2e-parity-variant-${i + 1}`,
);
const skus = Array.from(
  { length: 30 },
  (_, i) => `E2E-PARITY-${String(i + 1).padStart(2, "0")}`,
);
let pool: Pool;
let context: BrowserContext;
let gateBefore:
  | { value: string; type: string; description: string | null }
  | undefined;

async function clean() {
  const batches = await pool.query<{ id: string }>(
    "SELECT DISTINCT batch_id AS id FROM price_change_batch_row WHERE variant_id=ANY($1::text[])",
    [variants],
  );
  const ids = batches.rows.map((row) => row.id);
  await pool.query(
    "DELETE FROM variant_price_current WHERE variant_id=ANY($1::text[])",
    [variants],
  );
  await pool.query(
    "UPDATE price_change_batch_row SET state='pending', applied_revision_id=NULL WHERE variant_id=ANY($1::text[])",
    [variants],
  );
  await pool.query(
    "DELETE FROM variant_price_revision WHERE variant_id=ANY($1::text[])",
    [variants],
  );
  await pool.query(
    "DELETE FROM price_change_batch_row WHERE batch_id=ANY($1::text[])",
    [ids],
  );
  await pool.query(
    "DELETE FROM price_change_apply_request WHERE batch_id=ANY($1::text[])",
    [ids],
  );
  await pool.query("DELETE FROM price_change_batch WHERE id=ANY($1::text[])", [
    ids,
  ]);
  await pool.query("DELETE FROM audit_log WHERE entity_id=ANY($1::text[])", [
    variants,
  ]);
  await pool.query("DELETE FROM product_variant WHERE id=ANY($1::text[])", [
    variants,
  ]);
  await pool.query("DELETE FROM product WHERE id=$1", [PRODUCT]);
}

test.beforeAll(async ({ browser }) => {
  pool = new Pool({ connectionString: process.env.DATABASE_URL });
  await clean();
  gateBefore = (
    await pool.query(
      "SELECT value,type,description FROM system_config WHERE key='discounts.contractVersion'",
    )
  ).rows[0];
  await pool.query(
    "INSERT INTO system_config (key,value,type) VALUES ('discounts.contractVersion','1','number') ON CONFLICT(key) DO UPDATE SET value='1',type='number'",
  );
  await pool.query(
    "INSERT INTO product (id,name,slug,base_price,status) VALUES ($1,'E2E Parity Product','e2e-parity-product',300000,'aktif')",
    [PRODUCT],
  );
  for (let i = 0; i < variants.length; i++)
    await pool.query(
      "INSERT INTO product_variant (id,product_id,sku,price) VALUES ($1,$2,$3,300000)",
      [variants[i], PRODUCT, skus[i]],
    );
  context = await browser.newContext({ baseURL: ADMIN_URL });
  const login = await context.request.post("/api/auth/sign-in/username", {
    data: { username: "hqmanager", password: "hq123" },
  });
  expect(login.ok()).toBe(true);
  const stage = await context.request.post("/api/admin/price-changes", {
    data: {
      requestKey: randomUUID(),
      source: "bulk",
      rows: [
        { sku: skus[0], action: "set_price", targetUnitPrice: "150000" },
        { sku: skus[29], action: "set_price", targetUnitPrice: "200000" },
      ],
    },
  });
  expect(stage.ok()).toBe(true);
  const batch = (await stage.json()).data;
  const applied = await context.request.post(
    `/api/admin/price-changes/${batch.id}/apply`,
    { data: { requestKey: randomUUID() } },
  );
  expect((await applied.json()).data.appliedCount).toBe(2);
  await pool.query("UPDATE product_variant SET price=150000 WHERE id=$1", [
    variants[29],
  ]);
});

test.afterAll(async () => {
  await context?.close();
  if (pool) {
    await clean();
    if (gateBefore)
      await pool.query(
        "UPDATE system_config SET value=$1,type=$2,description=$3 WHERE key='discounts.contractVersion'",
        [gateBefore.value, gateBefore.type, gateBefore.description],
      );
    else
      await pool.query(
        "DELETE FROM system_config WHERE key='discounts.contractVersion'",
      );
    await pool.end();
  }
});

test("UX Harga memisahkan langkah import, memakai tabs konsisten, dan menjaga file serta pilihan lintas tab", async ({}, testInfo) => {
  const page = await context.newPage();
  try {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(`${ADMIN_URL}/admin/products/harga`);
    await expect(page.getByRole("heading", { name: "Harga SKU", exact: true })).toBeVisible();
    await page.getByTestId("bulk-search").fill("E2E Parity");
    await page.getByTestId("bulk-search").press("Enter");
    await page.getByRole("checkbox", { name: `Pilih SKU ${skus[1]}` }).check();
    const tabs = page.getByRole("tablist", { name: "Pengelolaan harga" });
    await expect(tabs).toHaveCSS("border-top-width", "1px");
    await page.screenshot({ path: testInfo.outputPath("prices-desktop.png"), fullPage: true, animations: "disabled" });
    await tabs.getByRole("tab", { name: "Harga coret", exact: true }).focus();
    await page.keyboard.press("ArrowRight");
    await expect(tabs.getByRole("tab", { name: "Import & batch", exact: true })).toBeFocused();
    await expect(tabs.getByRole("tab", { name: "Import & batch", exact: true })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("table", { name: "Harga coret SKU", exact: true })).toBeHidden();
    await expect(page.getByRole("region", { name: "1. Siapkan file", exact: true })).toBeVisible();
    await expect(page.getByRole("form", { name: "2. Unggah untuk review", exact: true })).toBeVisible();
    await expect(page.getByRole("region", { name: "3. Review & terapkan", exact: true })).toBeVisible();
    await expect(page.getByText("Upload belum mengubah harga.", { exact: true })).toBeVisible();
    await expect(page.getByText("markdown_v1", { exact: true })).not.toBeVisible();
    await page.getByText("Format file", { exact: true }).click();
    await expect(page.getByText("markdown_v1", { exact: true })).toBeVisible();
    await page.getByText("Format file", { exact: true }).click();
    await page.getByTestId("excel-reason").fill("Catatan tetap tersimpan");
    await page.getByTestId("excel-file").setInputFiles({
      name: "harga-review.xlsx",
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      buffer: Buffer.from(buildWorkbookFixture([MARKER_ROW, HEADER_ROW])),
    });
    await tabs.getByRole("tab", { name: "Harga coret", exact: true }).click();
    await expect(page.getByTestId("bulk-selection-count")).toHaveText("Terpilih: 1 SKU");
    await tabs.getByRole("tab", { name: "Import & batch", exact: true }).click();
    await expect(page.getByTestId("excel-reason")).toHaveValue("Catatan tetap tersimpan");
    expect(await page.getByTestId("excel-file").evaluate((input: HTMLInputElement) => input.files?.[0]?.name)).toBe("harga-review.xlsx");
    await page.screenshot({ path: testInfo.outputPath("import-desktop.png"), fullPage: true, animations: "disabled" });
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath("import-mobile.png"), fullPage: true, animations: "disabled" });
    await tabs.getByRole("tab", { name: "Harga coret", exact: true }).click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath("prices-mobile.png"), fullPage: true, animations: "disabled" });
  } finally { await page.close(); }
});

test("harga coret langsung memuat tabel terpadu, target tersimpan, dan target nonaktif lintas halaman", async () => {
  const page = await context.newPage();
  await page.goto(`${ADMIN_URL}/admin/products/harga`);
  const table = page.getByRole("table", {
    name: "Harga coret SKU",
    exact: true,
  });
  await expect(table).toBeVisible();
  await expect(
    table.getByRole("columnheader", { name: "Target tersimpan", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Ubah manual", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Target harga website (Rp)")).toBeHidden();
  await expect(page.getByTestId("excel-upload")).toBeHidden();
  await page
    .getByRole("searchbox", { name: "Cari SKU atau nama produk" })
    .fill("E2E Parity");
  await page.getByRole("button", { name: "Cari SKU", exact: true }).click();
  const row = table.getByRole("row").filter({ hasText: skus[0] });
  await expect(
    row.getByRole("cell", { name: "Rp 150.000", exact: true }),
  ).toBeVisible();
  await expect(row.locator("s")).toHaveText("Rp 300.000");
  await expect(
    row.getByRole("button", { name: "Ubah", exact: true }),
  ).toBeVisible();
  const inactive = page.getByRole("region", {
    name: "Target nonaktif",
    exact: true,
  });
  await expect(
    inactive.getByRole("cell", { name: skus[29], exact: true }),
  ).toBeVisible();
  await expect(
    inactive.getByRole("cell", { name: "Rp 200.000", exact: true }),
  ).toBeVisible();
  await expect(
    table.getByRole("cell", { name: skus[29], exact: true }),
  ).toBeHidden();
  expect(
    (
      await context.request.get(
        "/api/admin/price-changes/candidates?markdownStatus=bogus",
      )
    ).status(),
  ).toBe(400);
  await page.close();
});

test("aksi dari selection membuka dialog, review kenaikan jujur, hasil dapat dibuka ulang, dan restore per baris", async () => {
  const page = await context.newPage();
  await page.goto(`${ADMIN_URL}/admin/products/harga`);
  await page
    .getByRole("searchbox", { name: "Cari SKU atau nama produk" })
    .fill(skus[0]);
  await page.getByRole("button", { name: "Cari SKU", exact: true }).click();
  await page.getByRole("checkbox", { name: `Pilih SKU ${skus[0]}` }).check();
  const trigger = page.getByRole("button", {
    name: "Ubah massal (% dari base)",
    exact: true,
  });
  await trigger.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Ubah massal harga coret");
  await page.getByLabel("Diskon (%) dari base").fill("20");
  await dialog
    .getByRole("button", { name: "Lihat review", exact: true })
    .click();
  await expect(dialog).toContainText("Rp 240.000");
  await expect(dialog).toContainText("Naik Rp 90.000");
  const before = (
    await (
      await context.request.get(`/api/admin/prices/${variants[0]}/history`)
    ).json()
  ).data;
  expect(before.current.effectiveUnitPrice).toBe("150000");
  await dialog.getByRole("button", { name: "Tutup", exact: true }).click();
  await expect(trigger).toBeFocused();
  await page
    .getByRole("button", { name: "Hasil perubahan", exact: true })
    .click();
  await page.getByTestId("bulk-apply").click();
  await expect(page.getByTestId("bulk-status")).toContainText(
    "1 baris diterapkan.",
  );
  await dialog.getByRole("button", { name: "Tutup", exact: true }).click();
  const row = page
    .getByRole("table", { name: "Harga coret SKU", exact: true })
    .getByRole("row")
    .filter({ hasText: skus[0] });
  await expect(row).toContainText("Rp 240.000");
  await row.getByRole("button", { name: "Riwayat", exact: true }).click();
  await expect(dialog).toContainText("Histori harga");
  await expect(dialog).toContainText("Rp 240.000");
  await dialog.getByRole("button", { name: "Tutup", exact: true }).click();
  await row.getByRole("button", { name: "Restore", exact: true }).click();
  await expect(dialog).toContainText("Markdown terbaru akan dilepas");
  await dialog
    .getByRole("button", { name: "Lihat review", exact: true })
    .click();
  await expect(dialog).toContainText("melepas Markdown");
  await page.getByTestId("bulk-apply").click();
  await expect(page.getByTestId("bulk-status")).toContainText(
    "1 baris diterapkan.",
  );
  await dialog.getByRole("button", { name: "Tutup", exact: true }).click();
  await expect(row).toContainText("Tanpa markdown");
  await page.close();
});

test("selection terpadu, export dan hasil import bertahan saat pindah tampilan", async () => {
  const page = await context.newPage();
  await page.goto(`${ADMIN_URL}/admin/products/harga`);
  await page.getByTestId("bulk-search").fill("E2E Parity");
  await page.getByTestId("bulk-search").press("Enter");
  await page.getByRole("checkbox", { name: `Pilih SKU ${skus[1]}` }).check();
  await page.getByTestId("bulk-next-page").click();
  await page.getByRole("checkbox", { name: `Pilih SKU ${skus[29]}` }).check();
  await expect(page.getByTestId("bulk-selection-count")).toHaveText(
    "Terpilih: 2 SKU",
  );
  await page.getByRole("button", { name: "Import Excel", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Import harga Excel", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("table", { name: "Harga coret SKU", exact: true }),
  ).toBeHidden();
  const request = page.waitForRequest(
    (request) =>
      request.url().endsWith("/price-changes/export") &&
      request.method() === "POST",
  );
  const download = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Export terpilih", exact: true })
    .click();
  expect((await request).postDataJSON()).toEqual({
    variantIds: [variants[1], variants[29]],
  });
  expect((await download).suggestedFilename()).toBe("harga-export.xlsx");
  const workbook = Buffer.from(
    buildWorkbookFixture([
      MARKER_ROW,
      HEADER_ROW,
      {
        row: 3,
        cells: {
          A: { kind: "text", value: skus[1] },
          B: { kind: "text", value: "set_price" },
          C: { kind: "number", value: 150000 },
        },
      },
    ]),
  );
  await page
    .getByTestId("excel-file")
    .setInputFiles({
      name: "parity.xlsx",
      mimeType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      buffer: workbook,
    });
  await page.getByTestId("excel-upload").click();
  await expect(page.getByTestId("excel-batch-summary")).toContainText(
    "1 pending",
  );
  await page.getByRole("tab", { name: "Harga coret", exact: true }).click();
  await expect(page.getByTestId("bulk-selection-count")).toHaveText(
    "Terpilih: 2 SKU",
  );
  await page.getByRole("button", { name: "Hasil import", exact: true }).click();
  await expect(page.getByTestId("excel-batch-summary")).toContainText(
    "1 pending",
  );
  await page.getByTestId("excel-apply").click();
  await expect(page.getByTestId("excel-batch-summary")).toContainText(
    "1 diterapkan",
  );
  await page.getByRole("tab", { name: "Harga coret", exact: true }).click();
  await page.getByTestId("bulk-prev-page").click();
  const updated = page
    .getByRole("table", { name: "Harga coret SKU", exact: true })
    .getByRole("row")
    .filter({ hasText: skus[1] });
  await expect(updated).toContainText("Rp 150.000");
  await page
    .getByRole("button", { name: "Restore terpilih", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toContainText(skus[1]);
  await expect(page.getByRole("dialog")).toContainText(skus[29]);
  await page.getByRole("button", { name: "Batal", exact: true }).click();
  await page.close();
});

test("respons apply hilang: hasil dan request key tetap tersedia tanpa menghapus selection lain", async () => {
  const page = await context.newPage();
  await page.goto(`${ADMIN_URL}/admin/products/harga`);
  await page.getByTestId("bulk-search").fill("E2E Parity");
  await page.getByRole("button", { name: "Cari SKU", exact: true }).click();
  await page.getByRole("checkbox", { name: `Pilih SKU ${skus[1]}` }).check();
  const row = page
    .getByRole("table", { name: "Harga coret SKU", exact: true })
    .getByRole("row")
    .filter({ hasText: skus[2] });
  await row.getByRole("button", { name: "Ubah", exact: true }).click();
  await page.getByLabel("Target harga website (Rp)").fill("150000");
  await page.getByRole("button", { name: "Lihat review", exact: true }).click();
  let lostKey = "";
  await page.route("**/price-changes/*/apply", async (route) => {
    lostKey = route.request().postDataJSON().requestKey;
    const committed = await route.fetch();
    expect(committed.ok()).toBe(true);
    await route.abort("failed");
  });
  await page.getByTestId("bulk-apply").click();
  await expect(page.getByRole("dialog").getByRole("alert")).toBeVisible();
  await page.getByRole("button", { name: "Tutup", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Ubah manual", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Hasil perubahan", exact: true })
    .click();
  await page.unroute("**/price-changes/*/apply");
  const replay = page.waitForRequest(
    (request) =>
      request.url().endsWith("/apply") && request.method() === "POST",
  );
  await page.getByTestId("bulk-resume").click();
  expect((await replay).postDataJSON().requestKey).toBe(lostKey);
  await expect(page.getByTestId("bulk-status")).toContainText(
    "1 baris diterapkan.",
  );
  await page.getByRole("button", { name: "Tutup", exact: true }).click();
  await expect(page.getByTestId("bulk-selection-count")).toHaveText(
    "Terpilih: 1 SKU",
  );
  await expect(
    page.getByRole("checkbox", { name: `Pilih SKU ${skus[1]}` }),
  ).toBeChecked();
  const history = (
    await (
      await context.request.get(`/api/admin/prices/${variants[2]}/history`)
    ).json()
  ).data;
  expect(history.revisions).toHaveLength(1);
  expect(history.current.effectiveUnitPrice).toBe("150000");
  await page.close();
});

test("mobile tidak overflow halaman dan dialog dapat dipakai dengan keyboard", async () => {
  const page = await context.newPage();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${ADMIN_URL}/admin/products/harga`);
  await page.getByTestId("bulk-search").fill(skus[2]);
  await page.getByTestId("bulk-search").press("Enter");
  const row = page
    .getByRole("table", { name: "Harga coret SKU", exact: true })
    .getByRole("row")
    .filter({ hasText: skus[2] });
  await row.getByRole("button", { name: "Ubah", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  const bounds = await dialog.boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(844);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await page.close();
});
