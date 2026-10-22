import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";

import { DISCOUNT_IMPORT_LIMIT_KEYS } from "@marketplace/db/src/discount-import-limits";
import {
  PriceChangeError,
  applyPriceChangeBatch,
  exportPriceChangeWorkbook,
  getPriceChangeBatch,
  getPriceChangeReport,
  getPriceChangeTemplate,
  stageWorkbookPriceChange,
} from "./price-changes-administration";
import { parsePriceWorkbook } from "./price-workbook";
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
} from "./xlsx-test-support";

// =========================================================
// Seam T — workbook upload → staging → apply → report → linked retry
// =========================================================
// Real PostgreSQL through the public admin-domain interface. Expected money and
// row counts are independent literals; SQL is used only for fixtures, for
// counting durable records and for the FK-ordered cleanup.
//
// Fixture safety: prefixed ids, disposable `marketplace_discounts_test_*` DB only.

const url = process.env.DATABASE_URL;
const TEST_DATABASE_PREFIX = "marketplace_discounts_test_";

function databaseNameOf(connectionString: string): string | null {
  try {
    const parsed = new URL(connectionString);
    const name = decodeURIComponent(parsed.pathname).replace(/^\/+/, "").split("/")[0];
    return name ? name : null;
  } catch {
    return null;
  }
}

if (url) {
  const name = databaseNameOf(url);
  if (!name || !name.startsWith(TEST_DATABASE_PREFIX)) {
    throw new Error(
      `[price-workbook-db] Refusing to mutate database "${name ?? "<unknown>"}": ` +
        `DATABASE_URL must point at a "${TEST_DATABASE_PREFIX}*" database.`
    );
  }
}

const ROLE = "zz-fx-wb-role";
const ACTOR = "zz-fx-wb-user";
const VIEW_ROLE = "zz-fx-wb-view-role";
const VIEW_ACTOR = "zz-fx-wb-view-user";
const NO_PRODUCT_ROLE = "zz-fx-wb-noproduct-role";
const NO_PRODUCT_ACTOR = "zz-fx-wb-noproduct-user";
const NO_GRANT_ROLE = "zz-fx-wb-nogrant-role";
const NO_GRANT_ACTOR = "zz-fx-wb-nogrant-user";
const ACTORS = [ACTOR, VIEW_ACTOR, NO_PRODUCT_ACTOR, NO_GRANT_ACTOR];
const ROLES = [ROLE, VIEW_ROLE, NO_PRODUCT_ROLE, NO_GRANT_ROLE];

const PRODUCT = "zz-fx-wb-product";
const PRODUCT_NAME = "ZZ Workbook Product";
const SKU_A = "ZZ-WB-01";
const SKU_B = "ZZ-WB-02";
const SKU_RESTORE = "ZZ-WB-RESTORE";
const SKU_UNKNOWN = "ZZ-WB-UNKNOWN";
const SKU_DUP = "ZZ-WB-DUP";
const SOURCE_PRICE = "300000";

const BULK_COUNT = 97;
const BULK_SKUS = Array.from(
  { length: BULK_COUNT },
  (_, index) => `ZZ-WB-BULK-${String(index + 1).padStart(3, "0")}`
);
const BULK_VARIANTS = BULK_SKUS.map((sku) => `zz-fx-wb-${sku.toLowerCase()}`);

const VARIANTS = [
  "zz-fx-wb-variant-a",
  "zz-fx-wb-variant-b",
  "zz-fx-wb-variant-restore",
  ...BULK_VARIANTS,
];
const VARIANT_BY_SKU = new Map<string, string>([
  [SKU_A, VARIANTS[0]],
  [SKU_B, VARIANTS[1]],
  [SKU_RESTORE, VARIANTS[2]],
  ...BULK_SKUS.map((sku, index) => [sku, BULK_VARIANTS[index]] as const),
]);

const pool = url ? new Pool({ connectionString: url, max: 6 }) : null;

async function ready(): Promise<boolean> {
  if (!pool) return false;
  const result = await pool.query(
    `select to_regclass('public.price_change_batch') is not null
        and to_regclass('public.price_change_batch_row') is not null as ok`
  );
  return result.rows[0]?.ok === true;
}

const dbReady = await ready();

// =========================================================
// Workbook fixtures (independent writer from `xlsx-test-support.ts`)
// =========================================================

function dataRow(
  row: number,
  sku: string,
  action: string,
  price?: number | string
): SheetRow {
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

function workbookBytes(rows: readonly SheetRow[]): Uint8Array {
  return buildWorkbookFixture([MARKER_ROW, HEADER_ROW, ...rows]);
}

function correctionWorkbookBytes(
  rows: ReadonlyArray<{ row: number; sku: string; action: string; price?: number; originRow: number }>
): Uint8Array {
  return buildWorkbookFixture([
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
  ]);
}

const LIMITS = {
  maxRows: 1000,
  maxFileBytes: 5 * 1024 * 1024,
  maxExpandedBytes: 25 * 1024 * 1024,
};

// =========================================================
// Fixture lifecycle
// =========================================================

async function cleanupPriceData(): Promise<void> {
  if (!pool) return;
  const batches = await pool.query<{ id: string }>(
    "SELECT id FROM price_change_batch WHERE actor_identity = ANY($1::text[])",
    [ACTORS]
  );
  const batchIds = batches.rows.map((row) => row.id);
  if (batchIds.length > 0) {
    // FKs: ledger/audit/rows first (the row self-FK references rows of the same
    // batch), then revisions/pointers, then the batch itself. Do NOT reset row
    // state to pending here: a workbook row that failed parsing is final and
    // resetting it would violate the row CHECKs.
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
  await pool.query("DELETE FROM variant_price_current WHERE variant_id = ANY($1::text[])", [
    VARIANTS,
  ]);
  await pool.query("DELETE FROM variant_price_revision WHERE variant_id = ANY($1::text[])", [
    VARIANTS,
  ]);
  await pool.query("DELETE FROM audit_log WHERE entity_id = ANY($1::text[])", [VARIANTS]);
  await pool.query("DELETE FROM price_change_batch WHERE actor_identity = ANY($1::text[])", [
    ACTORS,
  ]);
}

/** Full teardown (catalog + actors). NEVER run between cases: the actors are
 * created once in `beforeAll` and only the price data is reset per case. */
async function cleanupAll(): Promise<void> {
  if (!pool) return;
  await cleanupPriceData();
  await pool.query("DELETE FROM product_variant WHERE id = ANY($1::text[])", [VARIANTS]);
  await pool.query("DELETE FROM product WHERE id = $1", [PRODUCT]);
  await pool.query(`DELETE FROM "user" WHERE id = ANY($1::text[])`, [ACTORS]);
  await pool.query("DELETE FROM admin_role_grant WHERE role_id = ANY($1::text[])", [ROLES]);
  await pool.query("DELETE FROM admin_role WHERE id = ANY($1::text[])", [ROLES]);
}

async function insertActor(input: {
  roleId: string;
  userId: string;
  roleName: string;
  email: string;
  grants: ReadonlyArray<readonly [string, string, string]>;
}): Promise<void> {
  await pool!.query(
    `INSERT INTO admin_role (id, key, name, description, is_system, version)
     VALUES ($1, NULL, $2, 'price workbook fixture', false, 1)
     ON CONFLICT (id) DO NOTHING`,
    [input.roleId, input.roleName]
  );
  await pool!.query(
    `INSERT INTO "user" (id, name, email, role_id, is_active, email_verified)
     VALUES ($1, $2, $3, $4, true, true)
     ON CONFLICT (id) DO UPDATE SET role_id = EXCLUDED.role_id, is_active = true`,
    [input.userId, input.roleName, input.email, input.roleId]
  );
  for (const [module, action, scope] of input.grants) {
    await pool!.query(
      `INSERT INTO admin_role_grant (id, role_id, module, action, scope)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (role_id, module, action) DO UPDATE SET scope = EXCLUDED.scope`,
      [`${input.roleId}-${module}-${action}`, input.roleId, module, action, scope]
    );
  }
}

async function setGate(value: "0" | "1"): Promise<void> {
  await pool!.query(
    `INSERT INTO system_config (key, value, type, description)
     VALUES ('discounts.contractVersion', $1, 'number', 'test gate')
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [value]
  );
}

async function countBatches(actor = ACTOR): Promise<number> {
  const result = await pool!.query(
    "SELECT count(*)::int AS count FROM price_change_batch WHERE actor_identity = $1",
    [actor]
  );
  return Number(result.rows[0]?.count ?? 0);
}

async function countRevisions(): Promise<number> {
  const result = await pool!.query(
    "SELECT count(*)::int AS count FROM variant_price_revision WHERE variant_id = ANY($1::text[])",
    [VARIANTS]
  );
  return Number(result.rows[0]?.count ?? 0);
}

async function stageWorkbook(
  rows: readonly SheetRow[],
  options: { requestKey?: string; parentBatchId?: string; actor?: string } = {}
) {
  return stageWorkbookPriceChange(
    {
      requestKey: options.requestKey ?? randomUUID(),
      file: workbookBytes(rows),
      reason: "test workbook",
      parentBatchId: options.parentBatchId ?? null,
    },
    options.actor ?? ACTOR
  );
}

async function applyOnce(batchId: string, actor = ACTOR) {
  return applyPriceChangeBatch(
    batchId,
    { requestKey: randomUUID(), previewDigest: "workbook-digest" },
    actor
  );
}

async function applyUntilFinal(batchId: string, actor = ACTOR, maxRounds = 30) {
  let result = await applyOnce(batchId, actor);
  for (let round = 1; round < maxRounds && result.status === 202; round += 1) {
    result = await applyOnce(batchId, actor);
  }
  return result;
}

async function expectPriceChangeError(
  run: () => Promise<unknown>,
  expected: { status: number; code: string; reason?: string }
): Promise<void> {
  try {
    await run();
  } catch (error) {
    expect(error).toBeInstanceOf(PriceChangeError);
    const described = error as PriceChangeError;
    expect(described.status).toBe(expected.status);
    expect(described.code).toBe(expected.code);
    if (expected.reason !== undefined) {
      expect(described.details?.reason).toBe(expected.reason);
    }
    return;
  }
  throw new Error("expected a PriceChangeError");
}

/** Read the worksheet XML of a generated workbook (literal-text assertions). */
function sheetText(bytes: Uint8Array): string {
  return textOf(readZipFixture(bytes).get("xl/worksheets/sheet1.xml")!);
}

let limitsBefore: Array<{ key: string; value: string; type: string; description: string | null }> = [];
let gateBefore: { value: string; type: string; description: string | null } | undefined;

async function setMaxRows(value: string): Promise<void> {
  await pool!.query(
    `INSERT INTO system_config (key, value, type, description)
     VALUES ($1, $2, 'number', 'test import limit')
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [DISCOUNT_IMPORT_LIMIT_KEYS.maxRows, value]
  );
}

async function restoreLimits(): Promise<void> {
  if (!pool) return;
  await pool.query("DELETE FROM system_config WHERE key = ANY($1::text[])", [
    Object.values(DISCOUNT_IMPORT_LIMIT_KEYS),
  ]);
  for (const row of limitsBefore) {
    await pool.query(
      `INSERT INTO system_config (key, value, type, description)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, type = EXCLUDED.type, description = EXCLUDED.description`,
      [row.key, row.value, row.type, row.description]
    );
  }
}

describe.skipIf(!dbReady)("workbook price import (disposable DB)", () => {
  beforeAll(async () => {
    if (!pool) return;
    await cleanupAll();
    await pool.query(
      `INSERT INTO product (id, name, slug, base_price, status)
       VALUES ($1, $2, 'zz-fx-wb-product', '500000', 'aktif')
       ON CONFLICT (id) DO NOTHING`,
      [PRODUCT, PRODUCT_NAME]
    );
    await pool.query(
      `INSERT INTO product_variant (id, product_id, sku, price, is_default)
       SELECT unnest($1::text[]), $2, unnest($3::text[]), $4, true
       ON CONFLICT (id) DO UPDATE SET price = EXCLUDED.price`,
      [VARIANTS, PRODUCT, [SKU_A, SKU_B, SKU_RESTORE, ...BULK_SKUS], SOURCE_PRICE]
    );

    limitsBefore = (
      await pool.query(
        `SELECT key, value, type, description FROM system_config
          WHERE key = ANY($1::text[])`,
        [Object.values(DISCOUNT_IMPORT_LIMIT_KEYS)]
      )
    ).rows;
    gateBefore = (
      await pool.query(
        "SELECT value, type, description FROM system_config WHERE key='discounts.contractVersion'"
      )
    ).rows[0];
    await setGate("1");

    await insertActor({
      roleId: ROLE,
      userId: ACTOR,
      roleName: "ZZ Workbook Admin",
      email: "zz-fx-wb-admin@example.test",
      grants: [
        ["prices", "view", "global"],
        ["prices", "edit", "global"],
        ["products", "view", "all_branches"],
      ],
    });
    await insertActor({
      roleId: VIEW_ROLE,
      userId: VIEW_ACTOR,
      roleName: "ZZ Workbook Viewer",
      email: "zz-fx-wb-viewer@example.test",
      grants: [
        ["prices", "view", "global"],
        ["products", "view", "all_branches"],
      ],
    });
    await insertActor({
      roleId: NO_PRODUCT_ROLE,
      userId: NO_PRODUCT_ACTOR,
      roleName: "ZZ Workbook No Product",
      email: "zz-fx-wb-noproduct@example.test",
      grants: [
        ["prices", "view", "global"],
        ["prices", "edit", "global"],
        ["products", "view", "own_branch"],
      ],
    });
    await insertActor({
      roleId: NO_GRANT_ROLE,
      userId: NO_GRANT_ACTOR,
      roleName: "ZZ Workbook No Grant",
      email: "zz-fx-wb-nogrant@example.test",
      grants: [],
    });
  });

  beforeEach(async () => {
    if (!pool) return;
    await cleanupPriceData();
    await pool.query(
      `INSERT INTO product (id, name, slug, base_price, status)
       VALUES ($1, $2, 'zz-fx-wb-product', '500000', 'aktif')
       ON CONFLICT (id) DO NOTHING`,
      [PRODUCT, PRODUCT_NAME]
    );
    await pool.query(
      `INSERT INTO product_variant (id, product_id, sku, price, is_default)
       SELECT unnest($1::text[]), $2, unnest($3::text[]), $4, true
       ON CONFLICT (id) DO UPDATE SET price = EXCLUDED.price`,
      [VARIANTS, PRODUCT, [SKU_A, SKU_B, SKU_RESTORE, ...BULK_SKUS], SOURCE_PRICE]
    );
    await setGate("1");
    await restoreLimits();
  });

  afterAll(async () => {
    if (!pool) return;
    await cleanupAll();
    await restoreLimits();
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

  it("stages a workbook: valid rows pending, parse errors final failed, no live price yet", async () => {
    const before = await countRevisions();
    const staged = await stageWorkbook([
      dataRow(3, SKU_A, "set_price", 240000),
      dataRow(4, SKU_B, "set_price", 250000),
      dataRow(5, SKU_RESTORE, "restore_base"),
      dataRow(6, SKU_UNKNOWN, "set_price", 100000),
      {
        row: 7,
        cells: {
          A: { kind: "text", value: "ZZ-WB-FORMULA" },
          B: { kind: "text", value: "set_price" },
          C: { kind: "formula", formula: "1+1", cached: "999999" },
        },
      },
      dataRow(8, SKU_DUP, "set_price", 100000),
      dataRow(9, SKU_DUP, "restore_base"),
    ]);

    expect(staged.status).toBe(201);
    expect(staged.data).toMatchObject({
      source: "xlsx",
      templateVersion: "OKCIR_MARKDOWN_V1",
      state: "staged",
      rowCount: 7,
      appliedCount: 0,
      unchangedCount: 0,
      failedCount: 3,
      pendingCount: 4,
      parentBatchId: null,
    });
    const rows = staged.data.rows;
    expect(rows.map((row) => row.state)).toEqual([
      "pending",
      "pending",
      "pending",
      "pending",
      "failed",
      "failed",
      "failed",
    ]);
    expect(rows.map((row) => row.resultCode)).toEqual([
      null,
      null,
      null,
      null,
      "FORMULA_NOT_SUPPORTED",
      "DUPLICATE_SKU",
      "DUPLICATE_SKU",
    ]);
    // Row numbers come from the worksheet, so a report can name the exact row.
    expect(rows.map((row) => row.rowNumber)).toEqual([3, 4, 5, 6, 7, 8, 9]);
    expect(await countRevisions()).toBe(before);
    // No live price movement before apply.
    const a = await pool!.query<{ price: string }>(
      "SELECT price FROM product_variant WHERE id = $1",
      [VARIANTS[0]]
    );
    expect(a.rows[0].price).toBe(String(`${SOURCE_PRICE}.00`));
  });

  it("applies only valid rows and reports the partial result honestly", async () => {
    const staged = await stageWorkbook([
      dataRow(3, SKU_A, "set_price", 240000),
      dataRow(4, SKU_B, "set_price", 250000),
      dataRow(5, SKU_RESTORE, "restore_base"),
      dataRow(6, SKU_UNKNOWN, "set_price", 100000),
      {
        row: 7,
        cells: {
          A: { kind: "text", value: "ZZ-WB-FORMULA" },
          B: { kind: "text", value: "set_price" },
          C: { kind: "formula", formula: "A1" },
        },
      },
      dataRow(8, SKU_DUP, "set_price", 100000),
      dataRow(9, SKU_DUP, "set_price", 100000),
    ]);
    const batchId = staged.data.id;
    const applied = await applyUntilFinal(batchId);

    expect(applied.status).toBe(200);
    expect(applied.data).toMatchObject({
      state: "partially_applied",
      rowCount: 7,
      appliedCount: 2,
      unchangedCount: 1,
      failedCount: 4,
      pendingCount: 0,
    });
    expect(applied.data.rows.find((row) => row.inputSku === SKU_UNKNOWN)).toMatchObject({
      state: "failed",
      resultCode: "VARIANT_NOT_FOUND",
    });
    expect(await countRevisions()).toBe(2);

    // Report built from durable rows: every row, with status + reason columns.
    const report = await getPriceChangeReport(batchId, "all", ACTOR);
    expect(report).not.toBeNull();
    const parsed = parsePriceWorkbook(report!.bytes, LIMITS);
    expect(parsed.rows.map((row) => row.inputSku)).toEqual([
      SKU_A,
      SKU_B,
      SKU_RESTORE,
      SKU_UNKNOWN,
      "ZZ-WB-FORMULA",
      SKU_DUP,
      SKU_DUP,
    ]);
    const sheet = sheetText(report!.bytes);
    expect(sheet).not.toContain("<f>");
    expect((sheet.match(/>applied</g) ?? []).length).toBeGreaterThanOrEqual(2);
    expect((sheet.match(/>failed</g) ?? []).length).toBeGreaterThanOrEqual(4);
    expect(sheet).toContain("FORMULA_NOT_SUPPORTED");
    expect(sheet).toContain("DUPLICATE_SKU");
    expect(sheet).toContain("VARIANT_NOT_FOUND");

    const failedSubset = await getPriceChangeReport(batchId, "failed", ACTOR);
    const failedRows = parsePriceWorkbook(failedSubset!.bytes, LIMITS);
    expect(failedRows.rows).toHaveLength(4);
    expect(failedRows.rows.map((row) => row.inputSku)).toEqual([
      SKU_UNKNOWN,
      "ZZ-WB-FORMULA",
      SKU_DUP,
      SKU_DUP,
    ]);
  });

  it("links a correction to final failed rows only; replay never duplicates", async () => {
    const staged = await stageWorkbook([
      dataRow(3, SKU_A, "set_price", 240000),
      dataRow(4, SKU_B, "nope", 100000),
    ]);
    const applied = await applyUntilFinal(staged.data.id);
    expect(applied.data).toMatchObject({ appliedCount: 1, failedCount: 1 });
    const originRow = applied.data.rows.find((row) => row.state === "failed")!;
    expect(originRow.rowNumber).toBe(4);
    expect(originRow.resultCode).toBe("ACTION_INVALID");

    const requestKey = randomUUID();
    const correctionFile = correctionWorkbookBytes([
      { row: 3, sku: SKU_B, action: "set_price", price: 260000, originRow: 4 },
    ]);
    const correction = await stageWorkbookPriceChange(
      {
        requestKey,
        file: correctionFile,
        reason: "correction",
        parentBatchId: staged.data.id,
      },
      ACTOR
    );
    expect(correction.status).toBe(201);
    expect(correction.data).toMatchObject({
      source: "xlsx",
      parentBatchId: staged.data.id,
      rowCount: 1,
      failedCount: 0,
      pendingCount: 1,
    });
    const linked = correction.data.rows[0];
    const originRowId = (
      await pool!.query<{ id: string }>(
        "SELECT id FROM price_change_batch_row WHERE batch_id = $1 AND row_number = 4",
        [staged.data.id]
      )
    ).rows[0].id;
    const link = await pool!.query<{ origin_retry_row_id: string }>(
      "SELECT origin_retry_row_id FROM price_change_batch_row WHERE id = $1",
      [linked.id]
    );
    expect(link.rows[0].origin_retry_row_id).toBe(originRowId);

    // Replay: same key + same file returns the SAME batch (no second rows).
    const batchesBefore = await countBatches();
    const replayed = await stageWorkbookPriceChange(
      {
        requestKey,
        file: correctionFile,
        reason: "correction",
        parentBatchId: staged.data.id,
      },
      ACTOR
    );
    expect(replayed.status).toBe(200);
    expect(replayed.data.id).toBe(correction.data.id);
    expect(await countBatches()).toBe(batchesBefore);

    // Same key with a DIFFERENT correction is a conflict, not a second batch.
    await expectPriceChangeError(
      () =>
        stageWorkbookPriceChange(
          {
            requestKey,
            file: correctionWorkbookBytes([
              { row: 3, sku: SKU_B, action: "set_price", price: 255000, originRow: 4 },
            ]),
            reason: "correction",
            parentBatchId: staged.data.id,
          },
          ACTOR
        ),
      { status: 409, code: "REQUEST_KEY_CONFLICT" }
    );

    // A correction must not reopen a final APPLIED row of the parent batch.
    await expectPriceChangeError(
      () =>
        stageWorkbookPriceChange(
          {
            requestKey: randomUUID(),
            file: correctionWorkbookBytes([
              { row: 3, sku: SKU_A, action: "set_price", price: 200000, originRow: 3 },
            ]),
            parentBatchId: staged.data.id,
          },
          ACTOR
        ),
      { status: 400, code: "ORIGIN_INVALID" }
    );
    // ... nor point at a row of another batch, nor omit the parent.
    await expectPriceChangeError(
      () =>
        stageWorkbookPriceChange(
          {
            requestKey: randomUUID(),
            file: correctionWorkbookBytes([
              { row: 3, sku: SKU_B, action: "set_price", price: 260000, originRow: 99 },
            ]),
            parentBatchId: staged.data.id,
          },
          ACTOR
        ),
      { status: 400, code: "ORIGIN_INVALID" }
    );
    await expectPriceChangeError(
      () =>
        stageWorkbookPriceChange(
          {
            requestKey: randomUUID(),
            file: correctionWorkbookBytes([
              { row: 3, sku: SKU_B, action: "set_price", price: 260000, originRow: 4 },
            ]),
          },
          ACTOR
        ),
      { status: 400, code: "ORIGIN_INVALID" }
    );

    // The correction itself applies with a NEW key; the parent stays final.
    const corrected = await applyUntilFinal(correction.data.id);
    expect(corrected.data).toMatchObject({ appliedCount: 1, failedCount: 0 });
    const parent = await getPriceChangeBatch(staged.data.id, ACTOR);
    expect(parent).toMatchObject({ appliedCount: 1, failedCount: 1 });
  });

  it("rejects a fatal workbook before any batch or price write exists", async () => {
    const macro = buildZipFixture([
      ...workbookParts(sheetXml([MARKER_ROW, HEADER_ROW])),
      { name: "xl/vbaProject.bin", data: "macro" },
    ]);
    const batchesBefore = await countBatches();
    const revisionsBefore = await countRevisions();
    await expectPriceChangeError(
      () =>
        stageWorkbookPriceChange(
          { requestKey: randomUUID(), file: macro },
          ACTOR
        ),
      { status: 400, code: "WORKBOOK_REJECTED", reason: "MACRO_UNSUPPORTED" }
    );
    await setMaxRows("2");
    await expectPriceChangeError(
      () =>
        stageWorkbookPriceChange(
          {
            requestKey: randomUUID(),
            file: workbookBytes([
              dataRow(3, SKU_A, "set_price", 240000),
              dataRow(4, SKU_B, "set_price", 240000),
              dataRow(5, SKU_RESTORE, "set_price", 240000),
            ]),
          },
          ACTOR
        ),
      { status: 400, code: "WORKBOOK_REJECTED", reason: "ROW_LIMIT_EXCEEDED" }
    );
    expect(await countBatches()).toBe(batchesBefore);
    expect(await countRevisions()).toBe(revisionsBefore);
  });

  it("enforces the configured row limit exactly at the boundary", async () => {
    await setMaxRows("2");
    const atLimit = await stageWorkbook([
      dataRow(3, SKU_A, "set_price", 240000),
      dataRow(4, SKU_B, "set_price", 250000),
    ]);
    expect(atLimit.data.rowCount).toBe(2);

    await expectPriceChangeError(
      () =>
        stageWorkbook([
          dataRow(3, SKU_A, "set_price", 240000),
          dataRow(4, SKU_B, "set_price", 250000),
          dataRow(5, SKU_RESTORE, "restore_base"),
        ]),
      { status: 400, code: "WORKBOOK_REJECTED", reason: "ROW_LIMIT_EXCEEDED" }
    );
  });

  it("100 input rows → 97 applied + 3 failed, never 100 successes", async () => {
    const rows: SheetRow[] = BULK_SKUS.map((sku, index) =>
      dataRow(index + 3, sku, "set_price", 240000)
    );
    rows.push(
      {
        row: 100,
        cells: {
          A: { kind: "text", value: "ZZ-WB-TEXT" },
          B: { kind: "text", value: "set_price" },
          C: { kind: "text", value: "Rp150.000" },
        },
      },
      {
        row: 101,
        cells: {
          A: { kind: "text", value: "ZZ-WB-FORMULA" },
          B: { kind: "text", value: "set_price" },
          C: { kind: "formula", formula: "100000+1" },
        },
      },
      dataRow(102, "ZZ-WB-ACT", "SET_PRICE", 100000)
    );
    const staged = await stageWorkbook(rows);
    expect(staged.data).toMatchObject({
      rowCount: 100,
      pendingCount: 97,
      failedCount: 3,
    });

    const final = await applyUntilFinal(staged.data.id);
    expect(final.data).toMatchObject({
      state: "partially_applied",
      rowCount: 100,
      appliedCount: 97,
      unchangedCount: 0,
      failedCount: 3,
      pendingCount: 0,
    });
    expect(await countRevisions()).toBe(97);

    const report = await getPriceChangeReport(staged.data.id, "all", ACTOR);
    expect(parsePriceWorkbook(report!.bytes, LIMITS).rows).toHaveLength(100);
    const failedSubset = await getPriceChangeReport(
      staged.data.id,
      "failed",
      ACTOR
    );
    const failedRows = parsePriceWorkbook(failedSubset!.bytes, LIMITS).rows;
    expect(failedRows).toHaveLength(3);
    const sheet = sheetText(failedSubset!.bytes);
    expect(sheet).toContain("PRICE_INVALID");
    expect(sheet).toContain("FORMULA_NOT_SUPPORTED");
    expect(sheet).toContain("ACTION_INVALID");

    // A resumed apply after the final state writes nothing.
    const resumed = await applyOnce(staged.data.id);
    expect(resumed.data).toMatchObject({ appliedCount: 97, failedCount: 3 });
    expect(await countRevisions()).toBe(97);
  });

  it("exports selected SKUs from current server data and keeps literal text out of formulas", async () => {
    // A literal SKU that looks like a formula must stay text in export/report.
    await pool!.query(
      `INSERT INTO product_variant (id, product_id, sku, price, is_default)
       VALUES ('zz-fx-wb-variant-evil', $1, '=SUM(A1)', $2, true)`,
      [PRODUCT, SOURCE_PRICE]
    );
    try {
      const exported = await exportPriceChangeWorkbook(
        { variantIds: [VARIANT_BY_SKU.get(SKU_A)!, "zz-fx-wb-variant-evil"] },
        ACTOR
      );
      const parsed = parsePriceWorkbook(exported.bytes, LIMITS);
      expect(parsed.rows.map((row) => row.inputSku).sort()).toEqual([
        "=SUM(A1)",
        SKU_A,
      ]);
      expect(parsed.rows.every((row) => row.action === "set_price")).toBe(true);
      expect(sheetText(exported.bytes)).not.toContain("<f>");

      await expectPriceChangeError(
        () =>
          exportPriceChangeWorkbook(
            { variantIds: ["zz-fx-wb-missing-variant"] },
            ACTOR
          ),
        { status: 400, code: "INPUT_INVALID" }
      );
      await expectPriceChangeError(
        () => exportPriceChangeWorkbook({ variantIds: [] }, ACTOR),
        { status: 400, code: "INPUT_INVALID" }
      );
    } finally {
      await pool!.query("DELETE FROM product_variant WHERE id = 'zz-fx-wb-variant-evil'");
    }
  });

  it("requires current viewer grants for template/export/report and editor grants for upload", async () => {
    const staged = await stageWorkbook([dataRow(3, SKU_A, "set_price", 240000)]);
    const batchId = staged.data.id;
    await applyUntilFinal(batchId);

    // viewer: downloads allowed, upload denied
    const template = await getPriceChangeTemplate(VIEW_ACTOR);
    expect(parsePriceWorkbook(template, LIMITS).rows).toHaveLength(0);
    expect(
      await exportPriceChangeWorkbook(
        { variantIds: [VARIANT_BY_SKU.get(SKU_A)!] },
        VIEW_ACTOR
      )
    ).not.toBeNull();
    expect(
      (await getPriceChangeReport(batchId, "all", VIEW_ACTOR))?.bytes.length
    ).toBeGreaterThan(0);
    await expectPriceChangeError(
      () => stageWorkbook([dataRow(3, SKU_A, "set_price", 200000)], { actor: VIEW_ACTOR }),
      { status: 403, code: "DENIED" }
    );

    // no grant at all: every download is denied
    for (const run of [
      () => getPriceChangeTemplate(NO_GRANT_ACTOR),
      () =>
        exportPriceChangeWorkbook(
          { variantIds: [VARIANT_BY_SKU.get(SKU_A)!] },
          NO_GRANT_ACTOR
        ),
      () => getPriceChangeReport(batchId, "all", NO_GRANT_ACTOR),
      () => getPriceChangeBatch(batchId, NO_GRANT_ACTOR),
    ]) {
      await expectPriceChangeError(run, { status: 403, code: "DENIED" });
    }

    // prices:view + edit but no all-branches product view: downloads denied
    for (const run of [
      () => getPriceChangeTemplate(NO_PRODUCT_ACTOR),
      () =>
        exportPriceChangeWorkbook(
          { variantIds: [VARIANT_BY_SKU.get(SKU_A)!] },
          NO_PRODUCT_ACTOR
        ),
      () => getPriceChangeReport(batchId, "all", NO_PRODUCT_ACTOR),
    ]) {
      await expectPriceChangeError(run, { status: 403, code: "DENIED" });
    }
  });

  it("fails closed while the contract gate is 0", async () => {
    await setGate("0");
    await expectPriceChangeError(
      () => stageWorkbook([dataRow(3, SKU_A, "set_price", 240000)]),
      { status: 503, code: "DISCOUNTS_INACTIVE" }
    );
    await setGate("1");
  });
});
