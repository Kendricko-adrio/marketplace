import dotenv from "dotenv";
import path from "node:path";
dotenv.config({ path: path.resolve(import.meta.dirname, "../../../../.env"), quiet: true });

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";

import {
  DISCOUNT_IMPORT_LIMIT_KEYS,
} from "@marketplace/db/src/discount-import-limits";
import {
  APPLY_BUDGET_MS,
  APPLY_MAX_ROWS_PER_REQUEST,
  APPLY_MIN_ROW_BUDGET_MS,
  applyPriceChangeBatch,
  deriveBatchState,
  getPriceChangeBatch,
  getVariantPriceHistory,
  listPriceChangeCandidates,
  normalizeWholeRupiah,
  planRowBudget,
  remainingBudgetMs,
  stageManualPriceChange,
  stagePriceChangeBatch,
} from "./price-changes-administration";

// =========================================================
// Seam T — manual Markdown stage → review → apply on real PostgreSQL
// =========================================================
// Assertions go through the DOMAIN interface; direct SQL is used only for
// fixtures and for counting immutable history/audit rows. Expected money values
// are independent literals from the approved spec (§4.1, §4.4), never derived by
// calling the module under test.
//
// Fixture safety: constant prefixed ids, a disposable `marketplace_discounts_test_*`
// DATABASE_URL only, and FK-ordered cleanup.

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
      `[price-changes-db] Refusing to mutate database "${name ?? "<unknown>"}": ` +
        `DATABASE_URL must point at a "${TEST_DATABASE_PREFIX}*" database.`
    );
  }
}

const ROLE = "zz-fx-price-role";
const ACTOR = "zz-fx-price-user";
const VIEW_ROLE = "zz-fx-price-view-role";
const VIEW_ACTOR = "zz-fx-price-view-user";
const NO_PRODUCT_ROLE = "zz-fx-price-noproduct-role";
const NO_PRODUCT_ACTOR = "zz-fx-price-noproduct-user";
const NO_GRANT_ROLE = "zz-fx-price-nogrant-role";
const NO_GRANT_ACTOR = "zz-fx-price-nogrant-user";
const REVOKE_ROLE = "zz-fx-price-revoke-role";
const REVOKE_ACTOR = "zz-fx-price-revoke-user";
const ACTORS = [ACTOR, VIEW_ACTOR, NO_PRODUCT_ACTOR, NO_GRANT_ACTOR, REVOKE_ACTOR];

const PRODUCT_A = "zz-fx-price-product-a";
const PRODUCT_B = "zz-fx-price-product-b";
const VARIANT_A = "zz-fx-price-variant-a";
const VARIANT_B = "zz-fx-price-variant-b";
const SKU_A = "ZZ-PRICE-A";
const SKU_B = "ZZ-PRICE-B";

// Bulk fixture: 30 SKU stabil untuk chunk/202, resume, revoke, dan kandidat.
const BULK_PRODUCT = "zz-fx-bulk-product";
const BULK_VARIANT_COUNT = 30;
const BULK_VARIANTS = Array.from(
  { length: BULK_VARIANT_COUNT },
  (_, index) => `zz-fx-bulk-variant-${String(index + 1).padStart(2, "0")}`
);
const BULK_SKUS = Array.from(
  { length: BULK_VARIANT_COUNT },
  (_, index) => `ZZ-BULK-${String(index + 1).padStart(2, "0")}`
);

const PRODUCTS = [PRODUCT_A, PRODUCT_B, BULK_PRODUCT];
const VARIANTS = [VARIANT_A, VARIANT_B, ...BULK_VARIANTS];

const pool = url ? new Pool({ connectionString: url, max: 4 }) : null;

async function ready(): Promise<boolean> {
  if (!pool) return false;
  const result = await pool.query(
    `select to_regclass('public.price_change_batch') is not null
        and to_regclass('public.variant_price_revision') is not null
        and to_regclass('public.variant_price_current') is not null
        and to_regclass('public.price_change_apply_request') is not null as ok`
  );
  return result.rows[0]?.ok === true;
}

const dbReady = await ready();

async function cleanupPriceRows(): Promise<void> {
  if (!pool) return;
  await pool.query(
    `DELETE FROM variant_price_current WHERE variant_id = ANY($1::text[])`,
    [VARIANTS]
  );
  await pool.query(
    `UPDATE price_change_batch_row SET state = 'pending', applied_revision_id = NULL
      WHERE variant_id = ANY($1::text[])`,
    [VARIANTS]
  );
  // Audit milik fixture: per entity (variant) DAN per batch (khususnya baris SKU
  // tidak ditemukan yang tidak punya entity variant).
  await pool.query(
    `DELETE FROM audit_log
      WHERE entity_id = ANY($1::text[])
         OR changes->>'batchId' IN (
              SELECT id FROM price_change_batch WHERE actor_identity = ANY($2::text[])
            )`,
    [VARIANTS, ACTORS]
  );
  await pool.query(
    `DELETE FROM variant_price_revision WHERE variant_id = ANY($1::text[])`,
    [VARIANTS]
  );
  await pool.query(
    `DELETE FROM price_change_batch_row WHERE variant_id = ANY($1::text[])`,
    [VARIANTS]
  );
  // FK-ordered: apply request → row → batch (batch_id RESTRICT).
  await pool.query(
    `DELETE FROM price_change_apply_request
      WHERE batch_id IN (SELECT id FROM price_change_batch WHERE actor_identity = ANY($1::text[]))`,
    [ACTORS]
  );
  await pool.query(
    `DELETE FROM price_change_batch_row
      WHERE batch_id IN (SELECT id FROM price_change_batch WHERE actor_identity = ANY($1::text[]))`,
    [ACTORS]
  );
  await pool.query(
    `DELETE FROM price_change_batch WHERE actor_identity = ANY($1::text[])`,
    [ACTORS]
  );
}

async function cleanupOwnedRows(): Promise<void> {
  await cleanupPriceRows();
  await cleanupCatalogAndActors();
}

async function cleanupCatalogAndActors(): Promise<void> {
  if (!pool) return;
  await pool.query(
    `DELETE FROM product_variant WHERE id = ANY($1::text[])`,
    [VARIANTS]
  );
  await pool.query(`DELETE FROM product WHERE id = ANY($1::text[])`, [PRODUCTS]);
  await pool.query(`DELETE FROM "user" WHERE id = ANY($1::text[])`, [ACTORS]);
  await pool.query(
    `DELETE FROM admin_role_grant WHERE role_id = ANY($1::text[])`,
    [[ROLE, VIEW_ROLE, NO_PRODUCT_ROLE, NO_GRANT_ROLE, REVOKE_ROLE]]
  );
  await pool.query(
    `DELETE FROM admin_role WHERE id = ANY($1::text[])`,
    [[ROLE, VIEW_ROLE, NO_PRODUCT_ROLE, NO_GRANT_ROLE, REVOKE_ROLE]]
  );
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
     VALUES ($1, NULL, $2, 'price change fixture', false, 1)
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

async function setSourcePrice(variantId: string, price: string): Promise<void> {
  await pool!.query(`UPDATE product_variant SET price = $2 WHERE id = $1`, [
    variantId,
    price,
  ]);
}

async function countRevisions(variantId: string): Promise<number> {
  const result = await pool!.query(
    `SELECT count(*)::int AS count FROM variant_price_revision WHERE variant_id = $1`,
    [variantId]
  );
  return Number(result.rows[0]?.count ?? 0);
}

async function countAudit(variantId: string, action: string): Promise<number> {
  const result = await pool!.query(
    `SELECT count(*)::int AS count FROM audit_log WHERE entity_id = $1 AND action = $2`,
    [variantId, action]
  );
  return Number(result.rows[0]?.count ?? 0);
}

async function stage(
  input: { sku: string; action: "set_price" | "restore_base"; targetUnitPrice?: string | null; discountPercent?: string | null },
  actor = ACTOR,
  requestKey = randomUUID()
) {
  return stageManualPriceChange(
    {
      requestKey,
      reason: "test",
      rows: [input],
    },
    actor
  );
}

async function apply(batchId: string, actor = ACTOR) {
  return applyPriceChangeBatch(
    batchId,
    { requestKey: randomUUID(), previewDigest: "digest-1" },
    actor
  );
}

async function stageBatch(
  rows: ReadonlyArray<{
    sku: string;
    action: "set_price" | "restore_base";
    targetUnitPrice?: string | null;
    discountPercent?: string | null;
  }>,
  actor = ACTOR,
  options: {
    requestKey?: string;
    source?: "manual" | "bulk";
    reason?: string | null;
  } = {}
) {
  return stagePriceChangeBatch(
    {
      requestKey: options.requestKey ?? randomUUID(),
      source: options.source ?? "bulk",
      reason: options.reason ?? "test",
      rows,
    },
    actor
  );
}

/** Satu klik = satu chunk; resume selalu memakai request key BARU. */
async function resumeUntilFinal(
  batchId: string,
  actor = ACTOR,
  maxRounds = 8
) {
  let result = await apply(batchId, actor);
  for (let round = 1; round < maxRounds && result.status === 202; round += 1) {
    result = await apply(batchId, actor);
  }
  return result;
}

async function setLimit(key: string, value: string): Promise<void> {
  await pool!.query(
    `INSERT INTO system_config (key, value, type, description)
     VALUES ($1, $2, 'number', 'test import limit')
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [key, value]
  );
}

async function clearLimits(): Promise<void> {
  // Only the three configured keys this suite owns — never a broad LIKE that
  // would silently delete operator values from the disposable database.
  await pool!.query(
    `DELETE FROM system_config WHERE key = ANY($1::text[])`,
    [Object.values(DISCOUNT_IMPORT_LIMIT_KEYS)]
  );
}

interface ImportLimitRow {
  key: string;
  value: string;
  type: string;
  description: string | null;
}

let importLimitsBefore: ImportLimitRow[] = [];

/** Manual/bulk: percent masuk fingerprint dan targetnya dibekukan di stage. */
async function insertManualRowRaw(input: {
  sku: string;
  target?: string | null;
  percent?: string | null;
}): Promise<ReturnType<typeof stage>> {
  return stage({
    sku: input.sku,
    action: "set_price",
    targetUnitPrice: input.target ?? undefined,
    discountPercent: input.percent ?? undefined,
  });
}

async function restoreImportLimits(): Promise<void> {
  await clearLimits();
  for (const row of importLimitsBefore) {
    await pool!.query(
      `INSERT INTO system_config (key, value, type, description)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (key) DO UPDATE SET
         value = EXCLUDED.value, type = EXCLUDED.type, description = EXCLUDED.description`,
      [row.key, row.value, row.type, row.description]
    );
  }
}

async function countRevisionsIn(variantIds: readonly string[]): Promise<number> {
  const result = await pool!.query(
    `SELECT count(*)::int AS count FROM variant_price_revision WHERE variant_id = ANY($1::text[])`,
    [variantIds]
  );
  return Number(result.rows[0]?.count ?? 0);
}

async function countAuditByBatch(
  batchId: string,
  action: string
): Promise<number> {
  const result = await pool!.query(
    `SELECT count(*)::int AS count FROM audit_log
      WHERE action = $1 AND changes->>'batchId' = $2`,
    [action, batchId]
  );
  return Number(result.rows[0]?.count ?? 0);
}

/** Fixture katalog stabil: 2 SKU manual + 30 SKU bulk, source 300000. */
async function resetCatalog(): Promise<void> {
  if (!pool) return;
  await pool.query(
    `INSERT INTO product (id, name, slug, base_price, status)
     VALUES ($1, 'ZZ Price Product A', 'zz-price-product-a', '300000', 'aktif'),
            ($2, 'ZZ Price Product B', 'zz-price-product-b', '300000', 'aktif'),
            ($3, 'ZZ Bulk Product', 'zz-bulk-product', '300000', 'aktif')
     ON CONFLICT (id) DO NOTHING`,
    [PRODUCT_A, PRODUCT_B, BULK_PRODUCT]
  );
  for (let index = 0; index < BULK_VARIANT_COUNT; index += 1) {
    await pool.query(
      `INSERT INTO product_variant (id, product_id, sku, price)
       VALUES ($1, $2, $3, '300000')
       ON CONFLICT (id) DO UPDATE SET price = '300000'`,
      [BULK_VARIANTS[index], BULK_PRODUCT, BULK_SKUS[index]]
    );
  }
  await pool.query(
    `INSERT INTO product_variant (id, product_id, sku, price)
     VALUES ($1, $3, $4, '300000'), ($2, $5, $6, '300000')
     ON CONFLICT (id) DO UPDATE SET price = '300000'`,
    [VARIANT_A, VARIANT_B, PRODUCT_A, SKU_A, PRODUCT_B, SKU_B]
  );
}

describe.skipIf(!dbReady)("manual Markdown price changes (disposable DB)", () => {
  beforeAll(async () => {
    if (!pool) return;
    if (!dbReady) return;
    // Preserve the seeded/operator import-limit rows: the suite deletes them
    // between cases, so the previous values are restored in afterAll.
    const before = await pool.query<ImportLimitRow>(
      `SELECT key, value, type, description FROM system_config
        WHERE key = ANY($1::text[])`,
      [Object.values(DISCOUNT_IMPORT_LIMIT_KEYS)]
    );
    importLimitsBefore = before.rows;
    await cleanupOwnedRows();
    await insertActor({
      roleId: ROLE,
      userId: ACTOR,
      roleName: "ZZ Price Admin",
      email: "zz-price-admin@example.test",
      grants: [
        ["prices", "view", "global"],
        ["prices", "edit", "global"],
        ["products", "view", "all_branches"],
      ],
    });
    await insertActor({
      roleId: VIEW_ROLE,
      userId: VIEW_ACTOR,
      roleName: "ZZ Price Viewer",
      email: "zz-price-viewer@example.test",
      grants: [
        ["prices", "view", "global"],
        ["products", "view", "all_branches"],
      ],
    });
    await insertActor({
      roleId: NO_PRODUCT_ROLE,
      userId: NO_PRODUCT_ACTOR,
      roleName: "ZZ Price No Product",
      email: "zz-price-noproduct@example.test",
      grants: [
        ["prices", "view", "global"],
        ["prices", "edit", "global"],
        ["products", "view", "own_branch"],
      ],
    });
    await insertActor({
      roleId: NO_GRANT_ROLE,
      userId: NO_GRANT_ACTOR,
      roleName: "ZZ Price No Grant",
      email: "zz-price-nogrant@example.test",
      grants: [],
    });
    await insertActor({
      roleId: REVOKE_ROLE,
      userId: REVOKE_ACTOR,
      roleName: "ZZ Price Revoke",
      email: "zz-price-revoke@example.test",
      grants: [
        ["prices", "view", "global"],
        ["prices", "edit", "global"],
        ["products", "view", "all_branches"],
      ],
    });
    await resetCatalog();
  });

  beforeEach(async () => {
    if (!pool) return;
    await setGate("1");
    await clearLimits();
    await cleanupPriceRows();
    await resetCatalog();
  });

  afterAll(async () => {
    if (!pool) return;
    await cleanupOwnedRows();
    await restoreImportLimits();
    await setGate("0");
    await pool.end();
  });

  it("manual persen membekukan target persen saat stage tanpa revision", async () => {
    const first = await insertManualRowRaw({ sku: SKU_A, percent: "15" });
    expect(first.status).toBe(201);
    expect(first.data.rows[0].targetUnitPrice).toBe("255000");
    expect(await countRevisions(VARIANTS[0])).toBe(0);
  });

  it("stage → review → apply menulis revision, pointer, hasil, dan audit sekali", async () => {
    const staged = await stage({
      sku: SKU_A,
      action: "set_price",
      targetUnitPrice: "150000",
    });
    expect(staged.status).toBe(201);
    // Review shows actual base/current/target/dampak (independent literals).
    expect(staged.data.rows[0].preview).toMatchObject({
      sourceUnitPrice: "300000",
      storedTargetBefore: null,
      effectiveUnitPriceBefore: "300000",
      markdownActiveBefore: false,
      targetUnitPrice: "150000",
      effectiveUnitPriceAfter: "150000",
      delta: "-150000",
      direction: "decrease",
      warnings: [],
    });
    expect(staged.data).toMatchObject({
      source: "manual",
      state: "staged",
      rowCount: 1,
      pendingCount: 1,
      appliedCount: 0,
    });

    const applied = await apply(staged.data.id);
    expect(applied.data).toMatchObject({
      state: "applied",
      appliedCount: 1,
      pendingCount: 0,
    });
    expect(applied.data.rows[0]).toMatchObject({
      state: "applied",
      resultCode: "APPLIED",
    });
    expect(applied.data.rows[0].actual).toEqual({
      sourceUnitPrice: "300000",
      previousTargetUnitPrice: null,
      previousEffectiveUnitPrice: "300000",
      previousMarkdownActive: false,
      targetUnitPrice: "150000",
      effectiveUnitPrice: "150000",
      markdownActive: true,
    });

    // The variant SOURCE stays untouched; only the projection changes.
    const source = await pool!.query(
      `SELECT price FROM product_variant WHERE id = $1`,
      [VARIANT_A]
    );
    expect(source.rows[0].price).toBe("300000.00");

    const history = await getVariantPriceHistory(
      VARIANT_A,
      { page: 1, limit: 10 },
      ACTOR
    );
    expect(history?.current).toEqual({
      sourceUnitPrice: "300000",
      effectiveUnitPrice: "150000",
      storedTarget: "150000",
      markdownActive: true,
      markdownRevisionId: applied.data.rows[0].appliedRevisionId,
    });
    expect(history?.currentVersion).toBe(1);
    expect(history?.revisions).toHaveLength(1);
    expect(await countAudit(VARIANT_A, "PRICE_CHANGE_STAGED")).toBe(1);
    expect(await countAudit(VARIANT_A, "PRICE_CHANGE_APPLIED")).toBe(1);
  });

  it("replay stage/apply tidak menggandakan batch, revision, atau audit", async () => {
    const requestKey = randomUUID();
    const first = await stage(
      { sku: SKU_A, action: "set_price", targetUnitPrice: "150000" },
      ACTOR,
      requestKey
    );
    const replay = await stage(
      { sku: SKU_A, action: "set_price", targetUnitPrice: "150000" },
      ACTOR,
      requestKey
    );
    expect(first.status).toBe(201);
    expect(replay.status).toBe(200);
    expect(replay.data.id).toBe(first.data.id);
    await expect(
      stage(
        { sku: SKU_A, action: "set_price", targetUnitPrice: "140000" },
        ACTOR,
        requestKey
      )
    ).rejects.toMatchObject({ code: "REQUEST_KEY_CONFLICT" });

    await apply(first.data.id);
    const replayApply = await apply(first.data.id);
    expect(replayApply.data.rows[0].state).toBe("applied");
    expect(await countRevisions(VARIANT_A)).toBe(1);
    expect(await countAudit(VARIANT_A, "PRICE_CHANGE_APPLIED")).toBe(1);
  });

  it("no-op set target identik dan restore tanpa Markdown menjadi unchanged tanpa revision", async () => {
    const first = await stage({
      sku: SKU_A,
      action: "set_price",
      targetUnitPrice: "150000",
    });
    await apply(first.data.id);

    const sameTarget = await stage({
      sku: SKU_A,
      action: "set_price",
      targetUnitPrice: "150000",
    });
    const unchanged = await apply(sameTarget.data.id);
    expect(unchanged.data.rows[0]).toMatchObject({
      state: "unchanged",
      resultCode: "UNCHANGED",
    });
    expect(await countRevisions(VARIANT_A)).toBe(1);

    const restoreNoop = await stage({ sku: SKU_B, action: "restore_base" });
    expect(restoreNoop.data.rows[0].preview.warnings).toContain("MARKDOWN_ABSENT");
    const restoredNoop = await apply(restoreNoop.data.id);
    expect(restoredNoop.data.rows[0]).toMatchObject({
      state: "unchanged",
      resultCode: "UNCHANGED",
    });
    expect(await countRevisions(VARIANT_B)).toBe(0);
    expect(await countAudit(VARIANT_B, "PRICE_CHANGE_UNCHANGED")).toBe(1);
  });

  it("restore melepas target terbaru, memakai base terbaru, dan version tetap monotonic", async () => {
    const set = await stage({
      sku: SKU_A,
      action: "set_price",
      targetUnitPrice: "150000",
    });
    await apply(set.data.id);
    await setSourcePrice(VARIANT_A, "320000");

    const restore = await stage({ sku: SKU_A, action: "restore_base" });
    // Review must mention the latest Markdown that will be released.
    expect(restore.data.rows[0].preview).toMatchObject({
      storedTargetBefore: "150000",
      effectiveUnitPriceBefore: "150000",
      markdownActiveBefore: true,
      effectiveUnitPriceAfter: "320000",
      direction: "increase",
    });
    const appliedRestore = await apply(restore.data.id);
    expect(appliedRestore.data.rows[0]).toMatchObject({
      state: "applied",
      resultCode: "APPLIED",
    });
    expect(appliedRestore.data.rows[0].actual).toMatchObject({
      sourceUnitPrice: "320000",
      previousTargetUnitPrice: "150000",
      previousEffectiveUnitPrice: "150000",
      targetUnitPrice: null,
      effectiveUnitPrice: "320000",
      markdownActive: false,
    });

    const history = await getVariantPriceHistory(
      VARIANT_A,
      { page: 1, limit: 10 },
      ACTOR
    );
    expect(history?.currentVersion).toBe(2);
    expect(history?.current).toMatchObject({
      effectiveUnitPrice: "320000",
      storedTarget: null,
      markdownActive: false,
    });
    expect(history?.revisions.map((r) => [r.revisionNo, r.action])).toEqual([
      [2, "restore_base"],
      [1, "set_price"],
    ]);
    expect(await countRevisions(VARIANT_A)).toBe(2);
  });

  it("memakai source TERBARU saat apply: target valid tetap diterapkan walau base naik", async () => {
    const staged = await stage({
      sku: SKU_A,
      action: "set_price",
      targetUnitPrice: "150000",
    });
    await setSourcePrice(VARIANT_A, "400000");
    const applied = await apply(staged.data.id);
    expect(applied.data.rows[0].actual).toMatchObject({
      sourceUnitPrice: "400000",
      targetUnitPrice: "150000",
      effectiveUnitPrice: "150000",
      markdownActive: true,
    });
    const history = await getVariantPriceHistory(
      VARIANT_A,
      { page: 1, limit: 10 },
      ACTOR
    );
    expect(history?.revisions[0].sourceUnitPrice).toBe("400000");
  });

  it("target invalid terhadap source terbaru gagal sebagai row tanpa menulis target", async () => {
    const staged = await stage({
      sku: SKU_A,
      action: "set_price",
      targetUnitPrice: "200000",
    });
    await setSourcePrice(VARIANT_A, "150000");
    const applied = await apply(staged.data.id);
    expect(applied.data).toMatchObject({
      state: "failed",
      failedCount: 1,
    });
    expect(applied.data.rows[0]).toMatchObject({
      state: "failed",
      resultCode: "TARGET_NOT_BELOW_SOURCE",
    });
    expect(await countRevisions(VARIANT_A)).toBe(0);
    const history = await getVariantPriceHistory(
      VARIANT_A,
      { page: 1, limit: 10 },
      ACTOR
    );
    // No revision was written: the read projection simply follows the source.
    expect(history?.current).toEqual({
      sourceUnitPrice: "150000",
      effectiveUnitPrice: "150000",
      storedTarget: null,
      markdownActive: false,
      markdownRevisionId: null,
    });
    expect(history?.currentVersion).toBeNull();
    expect(history?.revisions).toEqual([]);
    expect(await countAudit(VARIANT_A, "PRICE_CHANGE_FAILED")).toBe(1);
  });

  it("menolak stage/apply tanpa prices:edit global atau tanpa products view-all", async () => {
    await expect(
      stage(
        { sku: SKU_A, action: "set_price", targetUnitPrice: "150000" },
        NO_GRANT_ACTOR
      )
    ).rejects.toMatchObject({ code: "DENIED" });
    await expect(
      stage(
        { sku: SKU_A, action: "set_price", targetUnitPrice: "150000" },
        VIEW_ACTOR
      )
    ).rejects.toMatchObject({ code: "DENIED" });
    await expect(
      stage(
        { sku: SKU_A, action: "set_price", targetUnitPrice: "150000" },
        NO_PRODUCT_ACTOR
      )
    ).rejects.toMatchObject({ code: "DENIED" });
    // A viewer cannot read history without the same paired grants.
    await expect(
      getVariantPriceHistory(VARIANT_A, { page: 1, limit: 10 }, NO_GRANT_ACTOR)
    ).rejects.toMatchObject({ code: "DENIED" });
    const viewerRead = await getVariantPriceHistory(
      VARIANT_A,
      { page: 1, limit: 10 },
      VIEW_ACTOR
    );
    expect(viewerRead?.revisions).toEqual([]);
  });

  it("revoke prices:edit setelah stage menghentikan apply berikutnya", async () => {
    const staged = await stage(
      { sku: SKU_A, action: "set_price", targetUnitPrice: "150000" },
      REVOKE_ACTOR
    );
    await pool!.query(
      "DELETE FROM admin_role_grant WHERE role_id=$1 AND module='prices' AND action='edit'",
      [REVOKE_ROLE]
    );
    await expect(
      apply(staged.data.id, REVOKE_ACTOR)
    ).rejects.toMatchObject({ code: "DENIED" });
    expect(await countRevisions(VARIANT_A)).toBe(0);
    // The staged batch stays pending; a re-granted editor may still apply it.
    await pool!.query(
      `INSERT INTO admin_role_grant (id, role_id, module, action, scope)
       VALUES ($1,$2,'prices','edit','global')
       ON CONFLICT (role_id, module, action) DO UPDATE SET scope='global'`,
      [`${REVOKE_ROLE}-prices-edit`, REVOKE_ROLE]
    );
    const applied = await apply(staged.data.id, REVOKE_ACTOR);
    expect(applied.data.rows[0].state).toBe("applied");
  });

  it("menolak mutasi saat gate kontrak 0 dan mengembalikan 503", async () => {
    await setGate("0");
    await expect(
      stage({ sku: SKU_A, action: "set_price", targetUnitPrice: "150000" })
    ).rejects.toMatchObject({ code: "DISCOUNTS_INACTIVE" });
  });

  it("apply paralel hanya memfinalkan satu revision dan satu audit", async () => {
    const staged = await stage({
      sku: SKU_A,
      action: "set_price",
      targetUnitPrice: "150000",
    });
    const [left, right] = await Promise.all([
      apply(staged.data.id),
      apply(staged.data.id),
    ]);
    expect(left.data.rows[0].state).toBe("applied");
    expect(right.data.rows[0].state).toBe("applied");
    expect(await countRevisions(VARIANT_A)).toBe(1);
    expect(await countAudit(VARIANT_A, "PRICE_CHANGE_APPLIED")).toBe(1);
  });

  it("detail batch dan history menolak id yang tidak dikenal dengan 404/null", async () => {
    const missing = await getPriceChangeBatch(randomUUID(), ACTOR);
    expect(missing).toBeNull();
    const missingHistory = await getVariantPriceHistory(
      randomUUID(),
      { page: 1, limit: 10 },
      ACTOR
    );
    expect(missingHistory).toBeNull();
  });

  // =======================================================
  // Ticket 04 — bulk stage, chunked apply, resume, kandidat
  // =======================================================

  it("bulk stage 3 row menulis satu batch pending, audit staged per row, dan row lain tidak tersentuh", async () => {
    const targetVariants = BULK_VARIANTS.slice(0, 3);
    const staged = await stageBatch(
      BULK_SKUS.slice(0, 3).map((sku) => ({
        sku,
        action: "set_price" as const,
        targetUnitPrice: "150000",
      }))
    );
    expect(staged.status).toBe(201);
    expect(staged.data).toMatchObject({
      source: "bulk",
      state: "staged",
      rowCount: 3,
      appliedCount: 0,
      unchangedCount: 0,
      failedCount: 0,
      pendingCount: 3,
      haltReason: null,
    });
    expect(staged.data.rows.map((row) => [row.rowNumber, row.state])).toEqual([
      [1, "pending"],
      [2, "pending"],
      [3, "pending"],
    ]);
    expect(staged.data.pagination).toEqual({
      page: 1,
      limit: 25,
      total: 3,
      totalPages: 1,
    });
    const batchId = staged.data.id;
    expect(await countAuditByBatch(batchId, "PRICE_CHANGE_STAGED")).toBe(3);
    expect(await countRevisionsIn(targetVariants)).toBe(0);

    const applied = await apply(batchId);
    expect(applied.status).toBe(200);
    expect(applied.data).toMatchObject({
      state: "applied",
      rowCount: 3,
      appliedCount: 3,
      unchangedCount: 0,
      failedCount: 0,
      pendingCount: 0,
    });
    expect(await countRevisionsIn(targetVariants)).toBe(3);
    expect(await countAuditByBatch(batchId, "PRICE_CHANGE_APPLIED")).toBe(3);

    // Variant yang tidak dipilih tidak punya revision/pointer, dan source setiap
    // variant yang dipilih tetap 300000 (hanya projection yang berubah).
    const untouched = await pool!.query(
      `SELECT (SELECT count(*)::int FROM variant_price_revision WHERE variant_id = $1) AS revisions,
              (SELECT count(*)::int FROM variant_price_current WHERE variant_id = $1) AS pointers`,
      [VARIANT_A]
    );
    expect(untouched.rows[0]).toEqual({ revisions: 0, pointers: 0 });
    const sources = await pool!.query(
      `SELECT price FROM product_variant WHERE id = ANY($1::text[])`,
      [targetVariants]
    );
    expect(sources.rows.map((row) => row.price)).toEqual([
      "300000.00",
      "300000.00",
      "300000.00",
    ]);
  });

  it("SKU yang tidak ditemukan tetap di-stage dengan warning dan final failed tanpa revision", async () => {
    const staged = await stageBatch([
      { sku: BULK_SKUS[0], action: "set_price", targetUnitPrice: "150000" },
      { sku: "ZZ-BULK-DOES-NOT-EXIST", action: "set_price", targetUnitPrice: "150000" },
    ]);
    expect(staged.data.rows[1].variantId).toBeNull();
    expect(staged.data.rows[1].preview.warnings).toContain("VARIANT_NOT_FOUND");

    const applied = await apply(staged.data.id);
    expect(applied.data).toMatchObject({
      state: "partially_applied",
      appliedCount: 1,
      unchangedCount: 0,
      failedCount: 1,
      pendingCount: 0,
    });
    expect(applied.data.rows[1]).toMatchObject({
      state: "failed",
      resultCode: "VARIANT_NOT_FOUND",
      appliedRevisionId: null,
    });
    expect(await countRevisionsIn([BULK_VARIANTS[0]])).toBe(1);
  });

  it("shortcut persen dibekukan menjadi target fixed saat stage dan tidak dihitung ulang saat apply", async () => {
    await pool!.query(
      `UPDATE product_variant SET price = '100001' WHERE id = $1`,
      [BULK_VARIANTS[0]]
    );
    const staged = await stageBatch([
      // 85% dari 100001 = 85001 (half-up, spec §4.4) — bukan floor 85000.
      { sku: BULK_SKUS[0], action: "set_price", discountPercent: "15" },
      // Diskon 20% dari base 300000 = target 240000 (bukan 80% dari harga Markdown).
      { sku: BULK_SKUS[1], action: "set_price", discountPercent: "20" },
    ]);
    expect(staged.data.rows.map((row) => row.targetUnitPrice)).toEqual([
      "85001",
      "240000",
    ]);
    expect(staged.data.rows[0].preview).toMatchObject({
      sourceUnitPrice: "100001",
      targetUnitPrice: "85001",
      effectiveUnitPriceAfter: "85001",
    });

    // Source bergerak setelah stage: persen tidak pernah dihitung ulang saat apply.
    await pool!.query(
      `UPDATE product_variant SET price = '200000' WHERE id = $1`,
      [BULK_VARIANTS[0]]
    );
    const applied = await apply(staged.data.id);
    expect(applied.data.rows[0].actual).toMatchObject({
      sourceUnitPrice: "200000",
      targetUnitPrice: "85001",
      effectiveUnitPrice: "85001",
      markdownActive: true,
    });
    expect(applied.data.rows[1].actual).toMatchObject({
      sourceUnitPrice: "300000",
      targetUnitPrice: "240000",
      effectiveUnitPrice: "240000",
    });
  });

  it("apply 30 row mengembalikan 202 dengan pending jujur, lalu resume sampai final tanpa proses ganda", async () => {
    const staged = await stageBatch(
      BULK_SKUS.map((sku) => ({
        sku,
        action: "set_price" as const,
        targetUnitPrice: "249000",
      }))
    );
    expect(staged.data).toMatchObject({ rowCount: 30, pendingCount: 30 });

    const first = await apply(staged.data.id);
    expect(first.status).toBe(202);
    expect(first.data.state).toBe("in_progress");
    expect(first.data.appliedCount).toBeGreaterThanOrEqual(1);
    expect(first.data.pendingCount).toBeGreaterThanOrEqual(1);
    expect(first.data.appliedCount + first.data.pendingCount).toBe(30);
    expect(await countRevisionsIn(BULK_VARIANTS)).toBe(first.data.appliedCount);

    const final = await resumeUntilFinal(staged.data.id);
    expect(final.status).toBe(200);
    expect(final.data).toMatchObject({
      state: "applied",
      appliedCount: 30,
      unchangedCount: 0,
      failedCount: 0,
      pendingCount: 0,
      haltReason: null,
    });
    expect(await countRevisionsIn(BULK_VARIANTS)).toBe(30);
    expect(await countAuditByBatch(staged.data.id, "PRICE_CHANGE_APPLIED")).toBe(30);
    const duplicates = await pool!.query(
      `SELECT count(*)::int AS count FROM (
         SELECT batch_row_id FROM variant_price_revision
          WHERE batch_id = $1 GROUP BY batch_row_id HAVING count(*) > 1
       ) AS duplicated`,
      [staged.data.id]
    );
    expect(duplicates.rows[0].count).toBe(0);
  });

  it("dua apply paralel tidak menggandakan revision atau audit batch", async () => {
    const staged = await stageBatch(
      BULK_SKUS.map((sku) => ({
        sku,
        action: "set_price" as const,
        targetUnitPrice: "249000",
      }))
    );
    const [left, right] = await Promise.all([
      apply(staged.data.id),
      apply(staged.data.id),
    ]);
    for (const result of [left, right]) {
      expect([200, 202]).toContain(result.status);
      expect(
        result.data.appliedCount +
          result.data.unchangedCount +
          result.data.failedCount +
          result.data.pendingCount
      ).toBe(30);
    }

    const afterParallel = await getPriceChangeBatch(staged.data.id, ACTOR, {
      limit: 100,
    });
    expect(afterParallel!.appliedCount).toBeGreaterThanOrEqual(1);
    expect(await countRevisionsIn(BULK_VARIANTS)).toBe(afterParallel!.appliedCount);

    const final = await resumeUntilFinal(staged.data.id);
    expect(final.data).toMatchObject({ appliedCount: 30, pendingCount: 0 });
    expect(await countRevisionsIn(BULK_VARIANTS)).toBe(30);
    expect(await countAuditByBatch(staged.data.id, "PRICE_CHANGE_APPLIED")).toBe(30);
  });

  it("lock timeout saat row apply bukan bukti rollback: row tetap pending tanpa revision/audit, resume setelah lock lepas", async () => {
    // Real-PG rollback seam (spec §6.4): tahan batch lock dari koneksi lain lebih
    // lama dari lock_timeout row apply. Transaksi row gagal/rollback, tetapi
    // status durable-nya tetap pending — bukan failed dan bukan applied.
    const fiveSkus = BULK_SKUS.slice(0, 5);
    const fiveVariants = BULK_VARIANTS.slice(0, 5);
    const staged = await stageBatch(
      fiveSkus.map((sku) => ({
        sku,
        action: "set_price" as const,
        targetUnitPrice: "249000",
      }))
    );

    const blocker = await pool!.connect();
    let timedOut;
    try {
      // Lock ONLY the first variant row: the apply-request claim (batch FK key
      // share) still succeeds, then the first row transaction blocks on the
      // variant FOR UPDATE and hits its 2s lock_timeout.
      await blocker.query("BEGIN");
      await blocker.query(
        "SELECT id FROM product_variant WHERE id = $1 FOR UPDATE",
        [fiveVariants[0]]
      );
      const startedAt = Date.now();
      timedOut = await apply(staged.data.id);
      expect(Date.now() - startedAt).toBeGreaterThanOrEqual(1000);
    } finally {
      await blocker.query("ROLLBACK");
      blocker.release();
    }

    expect(timedOut.status).toBe(202);
    expect(timedOut.data).toMatchObject({
      appliedCount: 0,
      pendingCount: 5,
      haltReason: null,
    });
    // Transient lock timeout must never look like a rollback OR a final row.
    expect(["staged", "in_progress"]).toContain(timedOut.data.state);
    expect(await countRevisionsIn(fiveVariants)).toBe(0);
    expect(await countAuditByBatch(staged.data.id, "PRICE_CHANGE_APPLIED")).toBe(0);

    const resumed = await resumeUntilFinal(staged.data.id);
    expect(resumed.data).toMatchObject({
      state: "applied",
      appliedCount: 5,
      pendingCount: 0,
    });
    expect(await countRevisionsIn(fiveVariants)).toBe(5);
  });

  it("revoke prices:edit menghentikan apply berikutnya, mencatat halt reason, dan resume setelah re-grant", async () => {
    const staged = await stageBatch(
      BULK_SKUS.map((sku) => ({
        sku,
        action: "set_price" as const,
        targetUnitPrice: "249000",
      })),
      REVOKE_ACTOR
    );
    const firstChunk = await apply(staged.data.id, REVOKE_ACTOR);
    expect(firstChunk.status).toBe(202);
    const committed = firstChunk.data.appliedCount;
    expect(committed).toBeGreaterThanOrEqual(1);
    expect(await countRevisionsIn(BULK_VARIANTS)).toBe(committed);

    await pool!.query(
      "DELETE FROM admin_role_grant WHERE role_id=$1 AND module='prices' AND action='edit'",
      [REVOKE_ROLE]
    );

    await expect(apply(staged.data.id, REVOKE_ACTOR)).rejects.toMatchObject({
      code: "DENIED",
    });
    const halted = await getPriceChangeBatch(staged.data.id, REVOKE_ACTOR);
    expect(halted).toMatchObject({
      state: "in_progress",
      haltReason: "POLICY_REVOKED",
      appliedCount: committed,
      pendingCount: 30 - committed,
    });
    expect(await countRevisionsIn(BULK_VARIANTS)).toBe(committed);

    await pool!.query(
      `INSERT INTO admin_role_grant (id, role_id, module, action, scope)
       VALUES ($1,$2,'prices','edit','global')
       ON CONFLICT (role_id, module, action) DO UPDATE SET scope='global'`,
      [`${REVOKE_ROLE}-prices-edit`, REVOKE_ROLE]
    );
    const final = await resumeUntilFinal(staged.data.id, REVOKE_ACTOR);
    expect(final.data).toMatchObject({
      state: "applied",
      appliedCount: 30,
      pendingCount: 0,
      haltReason: null,
    });
    expect(await countRevisionsIn(BULK_VARIANTS)).toBe(30);
  });

  it("config limit: stage di atas limit ditolak 400, batch oversized ditahan, config invalid fail closed", async () => {
    await setLimit("discount.import.maxRows", "2");
    await expect(
      stageBatch(
        BULK_SKUS.slice(0, 3).map((sku) => ({
          sku,
          action: "set_price" as const,
          targetUnitPrice: "150000",
        }))
      )
    ).rejects.toMatchObject({ status: 400, code: "ROW_LIMIT_EXCEEDED" });
    expect(await countRevisionsIn(BULK_VARIANTS)).toBe(0);

    // Limit 1000: 3 row bisa staged + applied (row committed).
    await setLimit("discount.import.maxRows", "1000");
    const committed = await stageBatch(
      BULK_SKUS.slice(0, 3).map((sku) => ({
        sku,
        action: "set_price" as const,
        targetUnitPrice: "150000",
      }))
    );
    const committedApply = await apply(committed.data.id);
    expect(committedApply.data.appliedCount).toBe(3);
    expect(await countRevisionsIn(BULK_VARIANTS)).toBe(3);

    // Stage dengan limit lama, lalu limit diturunkan: batch ditahan tanpa rollback.
    const oversized = await stageBatch(
      BULK_SKUS.slice(3, 6).map((sku) => ({
        sku,
        action: "set_price" as const,
        targetUnitPrice: "150000",
      }))
    );
    await setLimit("discount.import.maxRows", "2");
    const held = await apply(oversized.data.id);
    expect(held.status).toBe(202);
    expect(held.data).toMatchObject({
      state: "in_progress",
      haltReason: "ROW_LIMIT_EXCEEDED",
      appliedCount: 0,
      pendingCount: 3,
    });
    expect(await countRevisionsIn(BULK_VARIANTS)).toBe(3);

    // Config invalid: operasi baru fail closed, batch final lama tetap terbaca.
    await setLimit("discount.import.maxRows", "abc");
    await expect(
      stageBatch([
        { sku: BULK_SKUS[6], action: "set_price", targetUnitPrice: "150000" },
      ])
    ).rejects.toMatchObject({ status: 503, code: "IMPORT_LIMITS_INVALID" });
    await expect(apply(oversized.data.id)).rejects.toMatchObject({
      status: 503,
      code: "IMPORT_LIMITS_INVALID",
    });
    const stillReadable = await getPriceChangeBatch(committed.data.id, ACTOR);
    expect(stillReadable).toMatchObject({ state: "applied", appliedCount: 3 });

    // Key hilang → default 1000.
    await clearLimits();
    const defaultBatch = await stageBatch([
      { sku: BULK_SKUS[6], action: "set_price", targetUnitPrice: "150000" },
      { sku: BULK_SKUS[7], action: "set_price", targetUnitPrice: "150000" },
    ]);
    expect(defaultBatch.status).toBe(201);
    expect(defaultBatch.data.rowCount).toBe(2);
  });

  it("memakai source terbaru saat apply: invalid gagal row tanpa revision, valid diterapkan, restore melepas target terbaru", async () => {
    const staged = await stageBatch(
      [{ sku: SKU_A, action: "set_price", targetUnitPrice: "150000" }],
      ACTOR,
      { source: "manual" }
    );
    await setSourcePrice(VARIANT_A, "100000");
    const failed = await apply(staged.data.id);
    expect(failed.data).toMatchObject({ state: "failed", failedCount: 1 });
    expect(failed.data.rows[0]).toMatchObject({
      state: "failed",
      resultCode: "TARGET_NOT_BELOW_SOURCE",
      appliedRevisionId: null,
    });
    expect(failed.data.rows[0].actual).toMatchObject({
      sourceUnitPrice: "100000",
      targetUnitPrice: null,
    });
    expect(await countRevisions(VARIANT_A)).toBe(0);

    await setSourcePrice(VARIANT_A, "200000");
    const retried = await stageBatch(
      [{ sku: SKU_A, action: "set_price", targetUnitPrice: "150000" }],
      ACTOR,
      { source: "manual" }
    );
    const applied = await apply(retried.data.id);
    expect(applied.data.rows[0]).toMatchObject({
      state: "applied",
      resultCode: "APPLIED",
    });
    expect(applied.data.rows[0].actual).toMatchObject({
      sourceUnitPrice: "200000",
      targetUnitPrice: "150000",
      effectiveUnitPrice: "150000",
      markdownActive: true,
    });
    expect(await countRevisions(VARIANT_A)).toBe(1);

    const restore = await stageBatch(
      [{ sku: SKU_A, action: "restore_base" }],
      ACTOR,
      { source: "manual" }
    );
    expect(restore.data.rows[0].preview).toMatchObject({
      storedTargetBefore: "150000",
      effectiveUnitPriceBefore: "150000",
      markdownActiveBefore: true,
    });
    const restored = await apply(restore.data.id);
    expect(restored.data.rows[0].actual).toMatchObject({
      sourceUnitPrice: "200000",
      targetUnitPrice: null,
      effectiveUnitPrice: "200000",
      markdownActive: false,
    });
    expect(await countRevisions(VARIANT_A)).toBe(2);
  });

  it("no-op bukan perubahan fiktif: unchanged diaudit sekali tanpa revision dan tidak diulang saat resume", async () => {
    const first = await stageBatch(
      [{ sku: SKU_A, action: "set_price", targetUnitPrice: "150000" }],
      ACTOR,
      { source: "manual" }
    );
    await apply(first.data.id);
    expect(await countRevisions(VARIANT_A)).toBe(1);

    const sameTarget = await stageBatch(
      [{ sku: SKU_A, action: "set_price", targetUnitPrice: "150000" }],
      ACTOR,
      { source: "manual" }
    );
    const unchanged = await apply(sameTarget.data.id);
    expect(unchanged.data.rows[0]).toMatchObject({
      state: "unchanged",
      resultCode: "UNCHANGED",
    });
    expect(await countRevisions(VARIANT_A)).toBe(1);
    expect(await countAudit(VARIANT_A, "PRICE_CHANGE_UNCHANGED")).toBe(1);

    // Row sudah final: apply ulang tidak menambah audit/revision.
    await apply(sameTarget.data.id);
    expect(await countRevisions(VARIANT_A)).toBe(1);
    expect(await countAudit(VARIANT_A, "PRICE_CHANGE_UNCHANGED")).toBe(1);

    const restoreNoop = await stageBatch(
      [{ sku: SKU_B, action: "restore_base" }],
      ACTOR,
      { source: "manual" }
    );
    const noChange = await apply(restoreNoop.data.id);
    expect(noChange.data.rows[0]).toMatchObject({
      state: "unchanged",
      resultCode: "UNCHANGED",
    });
    expect(await countRevisions(VARIANT_B)).toBe(0);
    expect(await countAudit(VARIANT_B, "PRICE_CHANGE_UNCHANGED")).toBe(1);
  });

  it("apply request key: digest berbeda 409, payload sama tanpa duplikasi, key baru pada batch final tanpa write", async () => {
    const staged = await stageBatch(
      [{ sku: SKU_A, action: "set_price", targetUnitPrice: "150000" }],
      ACTOR,
      { source: "manual" }
    );
    const requestKey = randomUUID();
    const first = await applyPriceChangeBatch(
      staged.data.id,
      { requestKey, previewDigest: "digest-a" },
      ACTOR
    );
    expect(first.data.rows[0].state).toBe("applied");
    expect(await countRevisions(VARIANT_A)).toBe(1);

    await expect(
      applyPriceChangeBatch(
        staged.data.id,
        { requestKey, previewDigest: "digest-b" },
        ACTOR
      )
    ).rejects.toMatchObject({ code: "REQUEST_KEY_CONFLICT" });

    const replay = await applyPriceChangeBatch(
      staged.data.id,
      { requestKey, previewDigest: "digest-a" },
      ACTOR
    );
    expect(replay.status).toBe(200);
    expect(replay.data.rows[0].state).toBe("applied");
    expect(await countRevisions(VARIANT_A)).toBe(1);
    expect(await countAudit(VARIANT_A, "PRICE_CHANGE_APPLIED")).toBe(1);

    const newKeyOnFinal = await applyPriceChangeBatch(
      staged.data.id,
      { requestKey: randomUUID(), previewDigest: "digest-a" },
      ACTOR
    );
    expect(newKeyOnFinal.status).toBe(200);
    expect(await countRevisions(VARIANT_A)).toBe(1);
    expect(await countAudit(VARIANT_A, "PRICE_CHANGE_APPLIED")).toBe(1);

    // Key yang sama dipakai pada batch lain adalah konflik juga.
    const otherBatch = await stageBatch(
      [{ sku: SKU_A, action: "set_price", targetUnitPrice: "140000" }],
      ACTOR,
      { source: "manual" }
    );
    await expect(
      applyPriceChangeBatch(
        otherBatch.data.id,
        { requestKey, previewDigest: "digest-a" },
        ACTOR
      )
    ).rejects.toMatchObject({ code: "REQUEST_KEY_CONFLICT" });
  });

  it("detail batch: pagination, filter state, actuals untuk report/retry, dan grant viewer", async () => {
    const staged = await stageBatch([
      { sku: BULK_SKUS[0], action: "set_price", targetUnitPrice: "150000" },
      { sku: BULK_SKUS[1], action: "set_price", targetUnitPrice: "999999" },
      { sku: BULK_SKUS[2], action: "restore_base" },
    ]);
    const applied = await apply(staged.data.id);
    expect(applied.data).toMatchObject({
      state: "partially_applied",
      appliedCount: 1,
      unchangedCount: 1,
      failedCount: 1,
      pendingCount: 0,
    });

    const pageOne = await getPriceChangeBatch(staged.data.id, ACTOR, {
      page: 1,
      limit: 2,
    });
    expect(pageOne!.rowCount).toBe(3);
    expect(pageOne!.pagination).toEqual({
      page: 1,
      limit: 2,
      total: 3,
      totalPages: 2,
    });
    expect(pageOne!.rows.map((row) => row.rowNumber)).toEqual([1, 2]);

    const pageTwo = await getPriceChangeBatch(staged.data.id, ACTOR, {
      page: "2",
      limit: "2",
    });
    expect(pageTwo!.rows.map((row) => row.rowNumber)).toEqual([3]);

    const failedOnly = await getPriceChangeBatch(staged.data.id, ACTOR, {
      state: "failed",
    });
    expect(failedOnly!.pagination).toMatchObject({ page: 1, total: 1 });
    expect(failedOnly!.rows).toHaveLength(1);
    expect(failedOnly!.rows[0]).toMatchObject({
      inputSku: BULK_SKUS[1],
      state: "failed",
      resultCode: "TARGET_NOT_BELOW_SOURCE",
    });
    expect(failedOnly!.rows[0].actual).toMatchObject({
      sourceUnitPrice: "300000",
      targetUnitPrice: null,
    });
    expect(failedOnly!.rows[0].preview).toMatchObject({
      sourceUnitPrice: "300000",
      targetUnitPrice: "999999",
      variantLabel: null,
    });

    await expect(
      getPriceChangeBatch(staged.data.id, ACTOR, { state: "bogus" })
    ).rejects.toMatchObject({ status: 400, code: "INPUT_INVALID" });
    await expect(
      getPriceChangeBatch(staged.data.id, NO_GRANT_ACTOR)
    ).rejects.toMatchObject({ code: "DENIED" });
    await expect(
      getPriceChangeBatch(staged.data.id, NO_PRODUCT_ACTOR)
    ).rejects.toMatchObject({ code: "DENIED" });
    const viewerRead = await getPriceChangeBatch(staged.data.id, VIEW_ACTOR);
    expect(viewerRead).toMatchObject({ appliedCount: 1, failedCount: 1 });
  });

  it("filter setup mencakup target aktif/nonaktif, tanpa target dan restore, dengan search serta pagination global", async () => {
    const staged = await stageBatch([
      { sku: SKU_A, action: "set_price", targetUnitPrice: "200000" },
      { sku: SKU_B, action: "set_price", targetUnitPrice: "200000" },
    ]);
    await apply(staged.data.id);
    await pool!.query("UPDATE product_variant SET price='150000' WHERE id=$1", [VARIANT_B]);
    const configured = { search: "zz price product", markdownStatus: "configured", limit: 1 };
    const first = await listPriceChangeCandidates(configured, ACTOR);
    expect(first.pagination).toEqual({ page: 1, limit: 1, total: 2, totalPages: 2 });
    expect(first.rows[0]).toMatchObject({ sku: SKU_A, markdownActive: true });
    const second = await listPriceChangeCandidates({ ...configured, page: 2 }, ACTOR);
    expect(second.rows.map((row) => row.sku)).toEqual([SKU_B]);
    expect(second.rows[0]).toMatchObject({ storedTarget: "200000", markdownActive: false });
    expect((await listPriceChangeCandidates({ ...configured, markdownStatus: "unconfigured" }, ACTOR)).pagination.total).toBe(0);
    const missing = await listPriceChangeCandidates({ search: "ZZ-BULK", markdownStatus: "unconfigured", limit: 25, page: 2 }, ACTOR);
    expect(missing.pagination).toEqual({ page: 2, limit: 25, total: 30, totalPages: 2 });
    expect(missing.rows.map((row) => row.sku)).toEqual(["ZZ-BULK-26", "ZZ-BULK-27", "ZZ-BULK-28", "ZZ-BULK-29", "ZZ-BULK-30"]);
    const restored = await stageBatch([{ sku: SKU_A, action: "restore_base" }]);
    await apply(restored.data.id);
    const afterRestore = await listPriceChangeCandidates({ search: "ZZ-PRICE", markdownStatus: "unconfigured" }, ACTOR);
    expect(afterRestore.rows.map((row) => row.sku)).toEqual([SKU_A]);
    expect(afterRestore.rows[0].storedTarget).toBeNull();
    expect((await listPriceChangeCandidates(configured, ACTOR)).pagination.total).toBe(1);
    for (const markdownStatus of ["configured", "unconfigured"]) {
      await expect(listPriceChangeCandidates({ markdownStatus }, NO_GRANT_ACTOR)).rejects.toMatchObject({ code: "DENIED" });
    }
  });

  it("target nonaktif: filter lintas halaman memakai source terbaru, count konsisten, dan query tervalidasi", async () => {
    const staged = await stageBatch([
      { sku: SKU_A, action: "set_price", targetUnitPrice: "200000" },
      { sku: SKU_B, action: "set_price", targetUnitPrice: "200000" },
    ]);
    await apply(staged.data.id);
    // Base turun: di bawah target dan tepat sama dengan target sama-sama nonaktif.
    await pool!.query("UPDATE product_variant SET price='150000' WHERE id=$1", [VARIANT_A]);
    await pool!.query("UPDATE product_variant SET price='200000' WHERE id=$1", [VARIANT_B]);
    const query = { search: "ZZ-PRICE", markdownStatus: "inactive", limit: 1 };
    const first = await listPriceChangeCandidates(query, ACTOR);
    expect(first.pagination).toEqual({ page: 1, limit: 1, total: 2, totalPages: 2 });
    expect(first.rows).toHaveLength(1);
    expect(first.rows[0]).toMatchObject({ sku: SKU_A, basePrice: "150000", effectiveUnitPrice: "150000", storedTarget: "200000", markdownActive: false });
    const second = await listPriceChangeCandidates({ ...query, page: 2 }, ACTOR);
    expect(second.pagination.total).toBe(2);
    expect(second.rows.map((row) => row.sku)).toEqual([SKU_B]);
    await pool!.query("UPDATE product_variant SET price='300000' WHERE id=$1", [VARIANT_A]);
    expect((await listPriceChangeCandidates(query, ACTOR)).pagination.total).toBe(1);
    await pool!.query("UPDATE product_variant SET price='150000.50' WHERE id=$1", [VARIANT_B]);
    expect((await listPriceChangeCandidates(query, ACTOR)).pagination.total).toBe(0);
    const invalid = { ...query, markdownStatus: "bogus" };
    await expect(listPriceChangeCandidates(invalid, ACTOR)).rejects.toMatchObject({ code: "INPUT_INVALID" });
    await expect(listPriceChangeCandidates(query, NO_GRANT_ACTOR)).rejects.toMatchObject({ code: "DENIED" });
  });

  it("kandidat SKU: search case-insensitive, proyeksi Markdown, pagination konsisten, dan grant wajib", async () => {
    const staged = await stageBatch(
      [{ sku: SKU_A, action: "set_price", targetUnitPrice: "150000" }],
      ACTOR,
      { source: "manual" }
    );
    await apply(staged.data.id);

    const bySku = await listPriceChangeCandidates(
      { search: "ZZ-PRICE-A", limit: 10 },
      ACTOR
    );
    expect(bySku.pagination).toEqual({
      page: 1,
      limit: 10,
      total: 1,
      totalPages: 1,
    });
    expect(bySku.rows[0]).toEqual({
      variantId: VARIANT_A,
      sku: SKU_A,
      productId: PRODUCT_A,
      productName: "ZZ Price Product A",
      variantLabel: null,
      basePrice: "300000",
      effectiveUnitPrice: "150000",
      storedTarget: "150000",
      markdownActive: true,
      priceVersion: 1,
    });

    const byProductName = await listPriceChangeCandidates(
      { search: "zz price product b" },
      ACTOR
    );
    expect(byProductName.rows.map((row) => row.sku)).toEqual([SKU_B]);
    expect(byProductName.rows[0]).toMatchObject({
      basePrice: "300000",
      effectiveUnitPrice: "300000",
      storedTarget: null,
      markdownActive: false,
      priceVersion: null,
    });

    const firstPage = await listPriceChangeCandidates(
      { search: "ZZ-BULK", page: 1, limit: 10 },
      ACTOR
    );
    expect(firstPage.pagination).toEqual({
      page: 1,
      limit: 10,
      total: 30,
      totalPages: 3,
    });
    expect(firstPage.rows).toHaveLength(10);
    expect(firstPage.rows[0].sku).toBe("ZZ-BULK-01");
    const lastPage = await listPriceChangeCandidates(
      { search: "ZZ-BULK", page: "3", limit: "10" },
      ACTOR
    );
    expect(lastPage.pagination.total).toBe(30);
    expect(lastPage.rows).toHaveLength(10);
    expect(lastPage.rows[0].sku).toBe("ZZ-BULK-21");
    expect(lastPage.rows[9].sku).toBe("ZZ-BULK-30");

    await expect(
      listPriceChangeCandidates({ search: "x".repeat(101) }, ACTOR)
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
    await expect(
      listPriceChangeCandidates({}, NO_GRANT_ACTOR)
    ).rejects.toMatchObject({ code: "DENIED" });
    await expect(
      listPriceChangeCandidates({}, NO_PRODUCT_ACTOR)
    ).rejects.toMatchObject({ code: "DENIED" });
  });
});

describe("normalizeWholeRupiah", () => {
  it("menerima Rupiah utuh scale2 dan menolak pecahan/bounds", () => {
    expect(normalizeWholeRupiah("150000.00", "target")).toBe("150000");
    expect(normalizeWholeRupiah(150000, "target")).toBe("150000");
    expect(() => normalizeWholeRupiah("150000.50", "target")).toThrow();
    expect(() => normalizeWholeRupiah("0", "target")).toThrow();
    expect(() => normalizeWholeRupiah("10000000000000", "target")).toThrow();
    expect(() => normalizeWholeRupiah("abc", "target")).toThrow();
  });
});

// =========================================================
// Seam L — chunk budget dan state turunan (expected literal)
// =========================================================

describe("planRowBudget / remainingBudgetMs", () => {
  it("mengekspor batas chunk yang disepakati", () => {
    expect(APPLY_MAX_ROWS_PER_REQUEST).toBe(25);
    expect(APPLY_BUDGET_MS).toBe(5000);
    expect(APPLY_MIN_ROW_BUDGET_MS).toBe(250);
  });

  it("lock dibatasi 2s dan statement 5s terhadap sisa budget", () => {
    expect(planRowBudget(5000)).toEqual({
      lockTimeoutMs: 2000,
      statementTimeoutMs: 5000,
    });
    expect(planRowBudget(3000)).toEqual({
      lockTimeoutMs: 2000,
      statementTimeoutMs: 3000,
    });
    expect(planRowBudget(1200)).toEqual({
      lockTimeoutMs: 1200,
      statementTimeoutMs: 1200,
    });
    expect(planRowBudget(250)).toEqual({
      lockTimeoutMs: 250,
      statementTimeoutMs: 250,
    });
  });

  it("tidak memulai row baru bila sisa budget di bawah minimum", () => {
    expect(planRowBudget(249)).toBeNull();
    expect(planRowBudget(0)).toBeNull();
    expect(planRowBudget(-100)).toBeNull();
  });

  it("remainingBudgetMs tidak pernah negatif", () => {
    expect(remainingBudgetMs(1000, 250)).toBe(750);
    expect(remainingBudgetMs(1000, 1000)).toBe(0);
    expect(remainingBudgetMs(1000, 1500)).toBe(0);
  });
});

describe("deriveBatchState", () => {
  it("pending berarti belum final walau banyak row sudah committed", () => {
    expect(
      deriveBatchState({
        rowCount: 100,
        applied: 60,
        unchanged: 0,
        failed: 3,
        pending: 37,
      })
    ).toBe("in_progress");
    expect(
      deriveBatchState({
        rowCount: 100,
        applied: 0,
        unchanged: 0,
        failed: 0,
        pending: 100,
      })
    ).toBe("in_progress");
  });

  it("final tanpa failed adalah applied, termasuk semua unchanged", () => {
    expect(
      deriveBatchState({
        rowCount: 100,
        applied: 100,
        unchanged: 0,
        failed: 0,
        pending: 0,
      })
    ).toBe("applied");
    expect(
      deriveBatchState({
        rowCount: 100,
        applied: 0,
        unchanged: 100,
        failed: 0,
        pending: 0,
      })
    ).toBe("applied");
  });

  it("failed parsial tidak pernah disebut sukses penuh", () => {
    expect(
      deriveBatchState({
        rowCount: 100,
        applied: 97,
        unchanged: 0,
        failed: 3,
        pending: 0,
      })
    ).toBe("partially_applied");
  });

  it("semua row final failed berarti failed", () => {
    expect(
      deriveBatchState({
        rowCount: 3,
        applied: 0,
        unchanged: 0,
        failed: 3,
        pending: 0,
      })
    ).toBe("failed");
  });
});
