/**
 * Ticket 05 — Excel harga: template berversi, upload→preview→apply→partial,
 * laporan/subset gagal, dan linked retry batch baru.
 *
 * Bukti X01/X02/X03/X04/X06/A01 di seam B/H dengan app HTTP asli + PG disposable:
 *   - template diunduh dari HTTP dan diverifikasi oleh reader ZIP INDEPENDEN
 *     (marker A1, header resmi, tanpa formula);
 *   - upload hanya staging (harga live belum berubah), baris formula/duplikat
 *     difinalkan gagal saat stage, SKU unknown gagal saat apply;
 *   - apply menghasilkan counts jujur (2 diterapkan/1 unchanged/4 gagal), bukan
 *     klaim seluruh file sukses;
 *   - laporan dan subset gagal dibentuk dari row durable; subset gagal memuat
 *     `origin_row` = baris dirinya sendiri supaya bisa dikoreksi;
 *   - koreksi diunggah sebagai batch BARU yang tertaut ke baris final gagal
 *     (parent_batch_id + origin_retry_row_id), 3 baris lama tidak diulang;
 *   - workbook fatal (macro) ditolak sebelum ada batch/harga berubah;
 *   - replay key yang sama tidak menggandakan batch, payload berbeda 409;
 *   - Admin tanpa grant `prices` ditolak di API download maupun upload.
 *
 * Nilai uang adalah literal independen (source 300000).
 */
import { test, expect, type BrowserContext } from "@playwright/test";
import { Pool } from "pg";
import { randomUUID } from "node:crypto";
import dotenv from "dotenv";

import {
  HEADER_ROW,
  MARKER_ROW,
  buildWorkbookFixture,
  buildZipFixture,
  readZipFixture,
  sheetXml,
  textOf,
  workbookParts,
  type SheetRow,
} from "../../apps/admin/src/lib/xlsx-test-support";

dotenv.config({ path: ".env" });

test.describe.configure({ mode: "serial" });

const ADMIN_BASE_URL = process.env.E2E_MOCK_ADMIN_BASE_URL ?? "http://localhost:3111";
const PORTS = new Set(["3110", "3111", "3112"]);

function requireIsolatedRun(): void {
  if (process.env.E2E_PROVIDER_MOCKS !== "true") {
    throw new Error(
      "price-change-excel-mock.spec.ts must run under playwright.mock.config.ts"
    );
  }
  const parsed = new URL(ADMIN_BASE_URL);
  if (
    (parsed.hostname !== "127.0.0.1" && parsed.hostname !== "localhost") ||
    !PORTS.has(parsed.port)
  ) {
    throw new Error(
      `price-change-excel-mock.spec.ts refuses non-loopback admin origin ${ADMIN_BASE_URL}`
    );
  }
  const raw = process.env.DATABASE_URL ?? "";
  const name = raw ? decodeURIComponent(new URL(raw).pathname.replace(/^\//, "")) : "";
  if (!/^marketplace_discounts_test_[A-Za-z0-9_]+$/.test(name)) {
    throw new Error(
      `price-change-excel-mock.spec.ts requires a disposable marketplace_discounts_test_* DATABASE_URL, got "${name}"`
    );
  }
}
requireIsolatedRun();

const HQ = { identifier: "hqmanager", password: "hq123" };
const ADMIN = { identifier: "admintoko", password: "admin123" };

const PREFIX = "e2e-xls";
const PRODUCT_ID = `${PREFIX}-product`;
const PRODUCT_NAME = "E2E Excel Produk";
const SOURCE_PRICE = "300000";

const SKU_VALID = "E2E-XLS-01";
const SKU_VALID_2 = "E2E-XLS-02";
const SKU_CORRECT = "E2E-XLS-03";
const SKU_RESTORE = "E2E-XLS-RESTORE";
const SKU_UNKNOWN = "E2E-XLS-UNKNOWN";
const SKU_DUP = "E2E-XLS-DUP";
const SKUS = [SKU_VALID, SKU_VALID_2, SKU_CORRECT, SKU_RESTORE, SKU_DUP];
const VARIANT_IDS = SKUS.map((sku) => `${PREFIX}-${sku.toLowerCase()}`);

const XLSX_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

let pool: Pool;
let hqContext: BrowserContext;
let adminContext: BrowserContext;
let hqId = "";
let gateBefore: { value: string; type: string; description: string | null } | undefined;

async function signIn(context: BrowserContext, identifier: string, password: string) {
  const response = await context.request.post(
    `${ADMIN_BASE_URL}/api/auth/sign-in/username`,
    { data: { username: identifier, password } }
  );
  expect(response.ok(), `admin sign-in failed: ${await response.text()}`).toBe(true);
}

function dataRow(row: number, sku: string, action: string, price?: number | string): SheetRow {
  return {
    row,
    cells: {
      A: { kind: "text", value: sku },
      B: { kind: "text", value: action },
      ...(price === undefined
        ? {}
        : typeof price === "number"
          ? { C: { kind: "number", value: price } }
          : { C: { kind: "text", value: price } }),
    },
  };
}

function uploadWorkbook(rows: readonly SheetRow[]): Buffer {
  return Buffer.from(
    buildWorkbookFixture([MARKER_ROW, HEADER_ROW, ...rows])
  );
}

function correctionWorkbook(
  rows: ReadonlyArray<{
    row: number;
    sku: string;
    action: string;
    price?: number;
    originRow: number;
  }>
): Buffer {
  return Buffer.from(
    buildWorkbookFixture([
      MARKER_ROW,
      {
        row: 2,
        cells: {
          A: { kind: "text", value: "sku" },
          B: { kind: "text", value: "action" },
          C: { kind: "text", value: "new_price" },
          D: { kind: "text", value: "origin_row" },
        },
      },
      ...rows.map(
        (row): SheetRow => ({
          row: row.row,
          cells: {
            A: { kind: "text", value: row.sku },
            B: { kind: "text", value: row.action },
            ...(row.price === undefined
              ? {}
              : { C: { kind: "number", value: row.price } }),
            D: { kind: "number", value: row.originRow },
          },
        })
      ),
    ])
  );
}

function sheetOf(buffer: Uint8Array): string {
  return textOf(readZipFixture(buffer).get("xl/worksheets/sheet1.xml")!);
}

async function latestBatchId(source: "xlsx" | "bulk" | "manual"): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `SELECT id FROM price_change_batch
      WHERE actor_identity = $1 AND source = $2
      ORDER BY created_at DESC LIMIT 1`,
    [hqId, source]
  );
  return result.rows[0]?.id ?? "";
}

async function batchRowCount(): Promise<number> {
  const result = await pool.query<{ count: number }>(
    "SELECT count(*)::int AS count FROM price_change_batch WHERE actor_identity = $1",
    [hqId]
  );
  return Number(result.rows[0]?.count ?? 0);
}

async function revisionCount(variantId: string): Promise<number> {
  const result = await pool.query<{ count: number }>(
    "SELECT count(*)::int AS count FROM variant_price_revision WHERE variant_id = $1",
    [variantId]
  );
  return Number(result.rows[0]?.count ?? 0);
}

async function cleanup(): Promise<void> {
  const batches = await pool.query<{ id: string }>(
    "SELECT id FROM price_change_batch WHERE actor_identity = $1",
    [hqId]
  );
  const batchIds = batches.rows.map((row) => row.id);
  if (batchIds.length > 0) {
    await pool.query(
      "DELETE FROM audit_log WHERE changes->>'batchId' = ANY($1::text[])",
      [batchIds]
    );
    await pool.query(
      "DELETE FROM price_change_apply_request WHERE batch_id = ANY($1::text[])",
      [batchIds]
    );
    await pool.query(
      "DELETE FROM price_change_batch_row WHERE batch_id = ANY($1::text[])",
      [batchIds]
    );
  }
  await pool.query(
    "DELETE FROM variant_price_current WHERE variant_id = ANY($1::text[])",
    [VARIANT_IDS]
  );
  await pool.query(
    "DELETE FROM variant_price_revision WHERE variant_id = ANY($1::text[])",
    [VARIANT_IDS]
  );
  await pool.query("DELETE FROM audit_log WHERE entity_id = ANY($1::text[])", [
    VARIANT_IDS,
  ]);
  if (batchIds.length > 0) {
    await pool.query(
      "DELETE FROM price_change_batch WHERE id = ANY($1::text[])",
      [batchIds]
    );
  }
  await pool.query("DELETE FROM product_variant WHERE id = ANY($1::text[])", [
    VARIANT_IDS,
  ]);
  await pool.query("DELETE FROM product WHERE id = $1", [PRODUCT_ID]);
}

test.beforeAll(async ({ browser }) => {
  pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 4 });
  const hq = await pool.query<{ id: string }>(
    `SELECT id FROM "user" WHERE username=$1`,
    [HQ.identifier]
  );
  hqId = hq.rows[0]?.id ?? "";
  expect(hqId, "the seeded HQ identity must exist (npm run db:seed)").toBeTruthy();
  await cleanup();

  await pool.query(
    `INSERT INTO product (id, name, slug, base_price, status)
     VALUES ($1, $2, 'e2e-xls-product', '500000', 'aktif')`,
    [PRODUCT_ID, PRODUCT_NAME]
  );
  await pool.query(
    `INSERT INTO product_variant (id, product_id, sku, price, is_default)
     SELECT unnest($1::text[]), $2, unnest($3::text[]), $4, true`,
    [VARIANT_IDS, PRODUCT_ID, SKUS, SOURCE_PRICE]
  );

  gateBefore = (
    await pool.query<{ value: string; type: string; description: string | null }>(
      "SELECT value, type, description FROM system_config WHERE key='discounts.contractVersion'"
    )
  ).rows[0];
  await pool.query(
    `INSERT INTO system_config (key, value, type) VALUES ('discounts.contractVersion','1','number')
     ON CONFLICT (key) DO UPDATE SET value='1', type='number'`
  );

  hqContext = await browser.newContext({ baseURL: ADMIN_BASE_URL });
  await signIn(hqContext, HQ.identifier, HQ.password);
  adminContext = await browser.newContext({ baseURL: ADMIN_BASE_URL });
  await signIn(adminContext, ADMIN.identifier, ADMIN.password);
});

test.afterAll(async () => {
  await hqContext?.close().catch(() => {});
  await adminContext?.close().catch(() => {});
  await cleanup();
  if (gateBefore) {
    await pool.query(
      "UPDATE system_config SET value=$1, type=$2, description=$3 WHERE key='discounts.contractVersion'",
      [gateBefore.value, gateBefore.type, gateBefore.description]
    );
  } else {
    await pool.query("DELETE FROM system_config WHERE key='discounts.contractVersion'");
  }
  await pool.end();
});

test("UI dan template memakai markdown_v1 tanpa label merek", async () => {
  const page = await hqContext.newPage();
  await page.goto("/admin/products/harga");
  await page.getByRole("button", { name: "Import Excel", exact: true }).click();
  await page.getByText("Format file", { exact: true }).click();
  await expect(page.getByText("markdown_v1", { exact: true })).toBeVisible();
  await expect(page.locator("main")).not.toContainText(/okcir/i);
  await page.close();
  const response = await hqContext.request.get("/api/admin/price-changes/template");
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toContain("spreadsheetml.sheet");
  const sheet = sheetOf(new Uint8Array(await response.body()));
  expect(sheet).toContain(">markdown_v1<");
  expect(sheet).not.toMatch(/okcir/i);
  expect(sheet).toContain(">sku<");
  expect(sheet).toContain(">action<");
  expect(sheet).toContain(">new_price<");
  expect(sheet).not.toContain("<f>");
  expect((sheet.match(/<row /g) ?? []).length).toBe(2);
});

test("upload staging, apply parsial, laporan dan subset gagal yang jujur", async () => {
  const workbook = uploadWorkbook([
    dataRow(3, SKU_VALID, "set_price", 240000),
    dataRow(4, SKU_VALID_2, "set_price", 250000),
    dataRow(5, SKU_RESTORE, "restore_base"),
    dataRow(6, SKU_UNKNOWN, "set_price", 100000),
    {
      row: 7,
      cells: {
        A: { kind: "text", value: "E2E-XLS-FORMULA" },
        B: { kind: "text", value: "set_price" },
        C: { kind: "formula", formula: "1+1", cached: "999999" },
      },
    },
    dataRow(8, SKU_DUP, "set_price", 100000),
    dataRow(9, SKU_DUP, "restore_base"),
  ]);

  const page = await hqContext.newPage();
  await page.goto("/admin/products/harga");
  await page.getByRole("button", { name: "Import Excel", exact: true }).click();
  await page.getByTestId("excel-file").setInputFiles({
    name: "harga-e2e.xlsx",
    mimeType: XLSX_MIME,
    buffer: workbook,
  });
  await page.getByTestId("excel-upload").click();

  const summary = page.getByTestId("excel-batch-summary");
  await expect(summary).toContainText("7 baris");
  await expect(summary).toContainText("3 gagal");
  await expect(summary).toContainText("4 pending");

  // STAGING only: the live price is untouched until apply.
  const stagedPrice = await pool.query<{ price: string }>(
    "SELECT price FROM product_variant WHERE id = $1",
    [VARIANT_IDS[0]]
  );
  expect(Number(stagedPrice.rows[0].price)).toBe(300000);

  const table = page.getByTestId("excel-row-table");
  await expect(table).toContainText("FORMULA_NOT_SUPPORTED");
  await expect(table).toContainText("DUPLICATE_SKU");

  await page.getByTestId("excel-apply").click();
  for (let round = 0; round < 4; round += 1) {
    const text = (await summary.textContent()) ?? "";
    if (!text.includes("Belum final")) break;
    const button = page.getByTestId("excel-apply");
    if ((await button.isDisabled()) === true) break;
    await button.click();
    await expect(summary).not.toContainText("Belum final");
  }
  await expect(summary).toContainText("2 diterapkan");
  await expect(summary).toContainText("1 tanpa perubahan");
  await expect(summary).toContainText("4 gagal");
  await expect(summary).toContainText("0 pending");
  await expect(summary).not.toContainText("Belum final");
  await expect(table).toContainText("VARIANT_NOT_FOUND");

  // The Markdown TARGET is a separate pointer; the Jubelio base price is never
  // overwritten by a manual Markdown (spec §4.1).
  const applied = await pool.query<{ target_unit_price: string }>(
    `SELECT r.target_unit_price FROM variant_price_current c
       JOIN variant_price_revision r ON r.id = c.revision_id
      WHERE c.variant_id = $1`,
    [VARIANT_IDS[0]]
  );
  expect(Number(applied.rows[0].target_unit_price)).toBe(240000);
  expect(await revisionCount(VARIANT_IDS[0])).toBe(1);

  const batchId = await latestBatchId("xlsx");
  expect(batchId).not.toBe("");

  const allReport = await hqContext.request.get(
    `/api/admin/price-changes/${batchId}/report?subset=all`
  );
  expect(allReport.status()).toBe(200);
  const allSheet = sheetOf(new Uint8Array(await allReport.body()));
  expect(allSheet).not.toContain("<f>");
  expect(allSheet).toContain("FORMULA_NOT_SUPPORTED");
  expect(allSheet).toContain("VARIANT_NOT_FOUND");
  expect((allSheet.match(/>applied</g) ?? []).length).toBe(2);
  expect((allSheet.match(/>failed</g) ?? []).length).toBe(4);

  const failedReport = await hqContext.request.get(
    `/api/admin/price-changes/${batchId}/report?subset=failed`
  );
  expect(failedReport.status()).toBe(200);
  const failedSheet = sheetOf(new Uint8Array(await failedReport.body()));
  // marker row + header row + the 4 failed data rows
  expect((failedSheet.match(/<row /g) ?? []).length).toBe(6);
  expect(failedSheet).toContain(">origin_row<");
  expect(failedSheet).not.toContain("<f>");

  await page.close();
});

test("koreksi subset gagal menjadi batch baru tertaut, tanpa mengulang baris lama", async () => {
  const parentBatchId = await latestBatchId("xlsx");
  expect(parentBatchId).not.toBe("");

  const correction = correctionWorkbook([
    // origin 6 = SKU unknown, 7 = formula, 8/9 = duplikat
    { row: 3, sku: SKU_CORRECT, action: "set_price", price: 230000, originRow: 6 },
    { row: 4, sku: SKU_VALID_2, action: "set_price", price: 250000, originRow: 7 },
    { row: 5, sku: SKU_DUP, action: "set_price", price: 260000, originRow: 8 },
    { row: 6, sku: SKU_DUP, action: "restore_base", originRow: 9 },
  ]);

  const page = await hqContext.newPage();
  await page.goto("/admin/products/harga");
  await page.getByRole("button", { name: "Import Excel", exact: true }).click();
  await page.getByTestId("excel-file").setInputFiles({
    name: "harga-e2e.xlsx",
    mimeType: XLSX_MIME,
    buffer: uploadWorkbook([
      dataRow(3, SKU_VALID, "set_price", 240000),
      dataRow(4, SKU_UNKNOWN, "set_price", 100000),
    ]),
  });
  await page.getByTestId("excel-upload").click();
  await expect(page.getByTestId("excel-batch-summary")).toContainText("2 baris");
  await page.getByTestId("excel-apply").click();
  await expect(page.getByTestId("excel-batch-summary")).toContainText("1 gagal");
  const secondBatchId = await latestBatchId("xlsx");
  expect(secondBatchId).not.toBe(parentBatchId);

  // The correction must link to the SECOND batch's failed row (row 4).
  const correctedFile = correctionWorkbook([
    { row: 3, sku: SKU_VALID_2, action: "set_price", price: 245000, originRow: 4 },
  ]);

  await page.getByTestId("excel-correction-file").setInputFiles({
    name: "koreksi.xlsx",
    mimeType: XLSX_MIME,
    buffer: correctedFile,
  });
  await page.getByTestId("excel-correction-upload").click();
  await expect(page.getByTestId("excel-batch-summary")).toContainText("Koreksi tertaut");
  await page.getByTestId("excel-apply").click();
  await expect(page.getByTestId("excel-batch-summary")).toContainText("1 diterapkan");

  const correctionBatch = await latestBatchId("xlsx");
  const link = await pool.query<{
    parent_batch_id: string | null;
    origin_retry_row_id: string | null;
    state: string;
    action: string;
  }>(
    `SELECT b.parent_batch_id, r.origin_retry_row_id, r.state, r.action
       FROM price_change_batch b
       JOIN price_change_batch_row r ON r.batch_id = b.id
      WHERE b.id = $1`,
    [correctionBatch]
  );
  expect(link.rows[0]).toMatchObject({
    parent_batch_id: secondBatchId,
    state: "applied",
    action: "set_price",
  });
  expect(link.rows[0].origin_retry_row_id).not.toBeNull();

  // The parent's failed row is final: the correction did not reopen it.
  const parentRow = await pool.query<{ state: string }>(
    "SELECT state FROM price_change_batch_row WHERE batch_id = $1 AND row_number = 4",
    [secondBatchId]
  );
  expect(parentRow.rows[0].state).toBe("failed");

  // The original 1-applied batch is untouched: no replay of its successful row.
  const firstBatch = await pool.query<{ applied_count: number; failed_count: number }>(
    "SELECT applied_count, failed_count FROM price_change_batch WHERE id = $1",
    [parentBatchId]
  );
  expect(firstBatch.rows[0]).toMatchObject({ applied_count: 2, failed_count: 4 });

  await page.close();
});

test("replay upload dengan key sama tidak menggandakan batch; payload beda 409", async () => {
  const requestKey = randomUUID();
  const workbook = uploadWorkbook([dataRow(3, SKU_VALID, "set_price", 240000)]);
  const send = (buffer: Buffer, key = requestKey) =>
    hqContext.request.post("/api/admin/price-changes", {
      multipart: {
        requestKey: key,
        reason: "replay",
        workbook: { name: "replay.xlsx", mimeType: XLSX_MIME, buffer },
      },
    });

  const first = await send(workbook);
  expect(first.status()).toBe(201);
  const firstBody = await first.json();
  const batchesBefore = await batchRowCount();

  const replay = await send(workbook);
  expect(replay.status()).toBe(200);
  const replayBody = await replay.json();
  expect(replayBody.data.id).toBe(firstBody.data.id);
  expect(await batchRowCount()).toBe(batchesBefore);

  const changed = await send(
    uploadWorkbook([dataRow(3, SKU_VALID, "set_price", 245000)])
  );
  expect(changed.status()).toBe(409);
  expect((await changed.json()).code).toBe("REQUEST_KEY_CONFLICT");
  expect(await batchRowCount()).toBe(batchesBefore);
});

test("workbook fatal ditolak sebelum ada batch atau harga berubah", async () => {
  const batchesBefore = await batchRowCount();
  const revisionsBefore = await revisionCount(VARIANT_IDS[0]);
  const macro = Buffer.from(
    buildZipFixture([
      ...workbookParts(sheetXml([MARKER_ROW, HEADER_ROW])),
      { name: "xl/vbaProject.bin", data: "macro" },
    ])
  );

  const page = await hqContext.newPage();
  await page.goto("/admin/products/harga");
  await page.getByRole("button", { name: "Import Excel", exact: true }).click();
  await page.getByTestId("excel-file").setInputFiles({
    name: "macro.xlsm",
    mimeType: XLSX_MIME,
    buffer: macro,
  });
  await page.getByTestId("excel-upload").click();
  const fatal = page.getByTestId("excel-fatal");
  await expect(fatal).toContainText("MACRO_UNSUPPORTED");
  await expect(fatal).toContainText("Tidak ada baris yang di-stage");
  await page.close();

  expect(await batchRowCount()).toBe(batchesBefore);
  expect(await revisionCount(VARIANT_IDS[0])).toBe(revisionsBefore);
});

test("admin tanpa grant prices ditolak pada template/report/export/upload", async () => {
  const page = await adminContext.newPage();
  await page.goto(`${ADMIN_BASE_URL}/admin/products/harga`);
  // Without `prices:view` the page itself redirects; the direct API calls below
  // are the real authorization boundary (UI hiding is never authorization).
  await expect(page).toHaveURL(/\/admin\/no-access$/);
  await page.close();

  const template = await adminContext.request.get(
    "/api/admin/price-changes/template"
  );
  expect(template.status()).toBe(403);

  const batchId = await latestBatchId("xlsx");
  const report = await adminContext.request.get(
    `/api/admin/price-changes/${batchId}/report?subset=failed`
  );
  expect(report.status()).toBe(403);

  const exported = await adminContext.request.post(
    "/api/admin/price-changes/export",
    { data: { variantIds: [VARIANT_IDS[0]] } }
  );
  expect(exported.status()).toBe(403);

  const upload = await adminContext.request.post("/api/admin/price-changes", {
    multipart: {
      requestKey: randomUUID(),
      workbook: {
        name: "denied.xlsx",
        mimeType: XLSX_MIME,
        buffer: uploadWorkbook([dataRow(3, SKU_VALID, "set_price", 240000)]),
      },
    },
  });
  expect(upload.status()).toBe(403);
});
