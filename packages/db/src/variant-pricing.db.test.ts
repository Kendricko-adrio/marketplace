import dotenv from "dotenv";
import path from "node:path";
dotenv.config({ path: path.resolve(import.meta.dirname, "../../../.env"), quiet: true });
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { Pool } from "pg";

// Seam D — SQL constraint tests untuk Markdown price change (spec §8.1–§8.4).
// Assertions hanya lewat constraint Postgres; fixture berprefix dan cleanup
// FK-ordered, tanpa TRUNCATE/delete luas.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 2,
  connectionTimeoutMillis: 2000,
});
let reachable = false;
try {
  const client = await pool.connect();
  client.release();
  reachable = true;
} catch {
  console.warn("variant pricing DB tests skipped: PostgreSQL unavailable");
}

const prefix = "variant-pricing-test-";
const productId = `${prefix}product`;
const variantId = `${prefix}variant`;
const otherVariantId = `${prefix}variant-other`;
const batchId = `${prefix}batch`;
const rowId = `${prefix}row`;
const revisionId = `${prefix}revision`;
const fingerprint = "a".repeat(64);
const requestKey = "11111111-1111-4111-8111-111111111111";

async function cleanup() {
  await pool.query("DELETE FROM variant_price_current WHERE variant_id LIKE $1", [`${prefix}%`]);
  await pool.query("UPDATE price_change_batch_row SET applied_revision_id = NULL, state = 'pending' WHERE batch_id LIKE $1", [`${prefix}%`]);
  await pool.query("DELETE FROM variant_price_revision WHERE variant_id LIKE $1", [`${prefix}%`]);
  await pool.query("DELETE FROM price_change_batch_row WHERE batch_id LIKE $1", [`${prefix}%`]);
  await pool.query("DELETE FROM price_change_batch WHERE id LIKE $1", [`${prefix}%`]);
  await pool.query("DELETE FROM product_variant WHERE id LIKE $1", [`${prefix}%`]);
  await pool.query("DELETE FROM product WHERE id LIKE $1", [`${prefix}%`]);
}

async function seedCatalog() {
  await pool.query(
    `INSERT INTO product (id, name, slug, base_price) VALUES ($1, $2, $2, '300000')`,
    [productId, productId]
  );
  await pool.query(
    `INSERT INTO product_variant (id, product_id, sku, price) VALUES ($1, $3, $2, '300000'), ($4, $3, $5, '300000')`,
    [variantId, `${prefix}sku`, productId, otherVariantId, `${prefix}sku-other`]
  );
}

async function insertBatch(overrides: Record<string, unknown> = {}) {
  const values = {
    id: batchId,
    actorIdentity: `${prefix}actor`,
    requestKey,
    fingerprint,
    source: "manual",
    state: "staged",
    rowCount: 1,
    appliedCount: 0,
    unchangedCount: 0,
    failedCount: 0,
    pendingCount: 1,
    ...overrides,
  };
  await pool.query(
    `INSERT INTO price_change_batch
       (id, actor_identity, request_key, fingerprint, source, state, row_count,
        applied_count, unchanged_count, failed_count, pending_count)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [
      values.id,
      values.actorIdentity,
      values.requestKey,
      values.fingerprint,
      values.source,
      values.state,
      values.rowCount,
      values.appliedCount,
      values.unchangedCount,
      values.failedCount,
      values.pendingCount,
    ]
  );
}

async function insertRow(overrides: Record<string, unknown> = {}) {
  const values = {
    id: rowId,
    batchId,
    rowNumber: 1,
    inputSku: `${prefix}sku`,
    variantId,
    action: "set_price",
    targetUnitPrice: "150000",
    previewJson: { base: "300000", target: "150000" },
    state: "pending",
    resultCode: null,
    ...overrides,
  };
  await pool.query(
    `INSERT INTO price_change_batch_row
       (id, batch_id, row_number, input_sku, variant_id, action, target_unit_price, preview_json, state, result_code)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [
      values.id,
      values.batchId,
      values.rowNumber,
      values.inputSku,
      values.variantId,
      values.action,
      values.targetUnitPrice,
      JSON.stringify(values.previewJson),
      values.state,
      values.resultCode,
    ]
  );
}

async function insertRevision(overrides: Record<string, unknown> = {}) {
  const values = {
    id: revisionId,
    variantId,
    revisionNo: 1,
    action: "set_price",
    targetUnitPrice: "150000",
    sourceUnitPrice: "300000",
    effectiveUnitPrice: "150000",
    previousTargetUnitPrice: null,
    previousEffectiveUnitPrice: "300000",
    markdownActive: true,
    previousMarkdownActive: false,
    batchId,
    batchRowId: rowId,
    actorIdentity: `${prefix}actor`,
    ...overrides,
  };
  await pool.query(
    `INSERT INTO variant_price_revision
       (id, variant_id, revision_no, action, target_unit_price, source_unit_price,
        effective_unit_price, previous_target_unit_price, previous_effective_unit_price,
        markdown_active, previous_markdown_active, batch_id, batch_row_id, actor_identity)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
    [
      values.id,
      values.variantId,
      values.revisionNo,
      values.action,
      values.targetUnitPrice,
      values.sourceUnitPrice,
      values.effectiveUnitPrice,
      values.previousTargetUnitPrice,
      values.previousEffectiveUnitPrice,
      values.markdownActive,
      values.previousMarkdownActive,
      values.batchId,
      values.batchRowId,
      values.actorIdentity,
    ]
  );
}

async function expectPgError(run: () => Promise<unknown>, code: string) {
  await expect(run()).rejects.toMatchObject({ code });
}

describe("Markdown price change SQL constraints", () => {
  afterEach(async () => {
    if (reachable) await cleanup();
  });

  afterAll(async () => {
    await pool.end();
  });

  it.skipIf(!reachable)("menerima satu rantai batch→row→revision→current yang konsisten", async () => {
    await seedCatalog();
    await insertBatch();
    await insertRow();
    await insertRevision();
    await pool.query(
      `INSERT INTO variant_price_current (variant_id, revision_id, version) VALUES ($1,$2,1)`,
      [variantId, revisionId]
    );
    const revision = await pool.query(
      `SELECT action, target_unit_price, source_unit_price, effective_unit_price,
              markdown_active, previous_markdown_active, revision_no
         FROM variant_price_revision WHERE id = $1`,
      [revisionId]
    );
    expect(revision.rows[0]).toMatchObject({
      action: "set_price",
      target_unit_price: "150000.00",
      source_unit_price: "300000.00",
      effective_unit_price: "150000.00",
      markdown_active: true,
      previous_markdown_active: false,
      revision_no: 1,
    });
    const current = await pool.query(
      `SELECT revision_id, version FROM variant_price_current WHERE variant_id = $1`,
      [variantId]
    );
    expect(current.rows[0]).toEqual({ revision_id: revisionId, version: 1 });
  });

  it.skipIf(!reachable)("menolak row set_price tanpa target dan restore dengan target", async () => {
    await seedCatalog();
    await insertBatch();
    await expectPgError(
      () => insertRow({ targetUnitPrice: null }),
      "23514"
    );
    await expectPgError(
      () => insertRow({ action: "restore_base", targetUnitPrice: "150000" }),
      "23514"
    );
  });

  it.skipIf(!reachable)("menolak revision yang mengklaim coretan/effective tidak konsisten", async () => {
    await seedCatalog();
    await insertBatch();
    await insertRow();
    await expectPgError(
      () => insertRevision({ markdownActive: false }),
      "23514"
    );
    await expectPgError(
      () => insertRevision({ effectiveUnitPrice: "200000" }),
      "23514"
    );
    await expectPgError(
      () => insertRevision({ previousTargetUnitPrice: "150000", previousMarkdownActive: false }),
      "23514"
    );
    await expectPgError(
      () => insertRevision({ previousEffectiveUnitPrice: "250000" }),
      "23514"
    );
  });

  it.skipIf(!reachable)("menolak set_price dengan target >= source dan target pecahan", async () => {
    await seedCatalog();
    await insertBatch();
    await insertRow();
    await expectPgError(
      () => insertRevision({ targetUnitPrice: "300000", effectiveUnitPrice: "300000" }),
      "23514"
    );
    await expectPgError(
      () => insertRevision({ targetUnitPrice: "150000.5" }),
      "23514"
    );
  });

  it.skipIf(!reachable)("menegakkan unique revision_no per variant dan satu revision per batch row", async () => {
    await seedCatalog();
    await insertBatch();
    await insertRow();
    await insertRevision();
    // duplicate revision_no for the same variant
    await expectPgError(
      () => insertRevision({ id: `${prefix}revision-2`, batchRowId: `${prefix}row-2` }),
      "23505"
    );
    // duplicate batch_row_id
    await expectPgError(
      () => insertRevision({ id: `${prefix}revision-3`, revisionNo: 2 }),
      "23505"
    );
  });

  it.skipIf(!reachable)("current hanya menerima revision milik variant yang sama", async () => {
    await seedCatalog();
    await insertBatch();
    await insertRow();
    await insertRevision();
    await expectPgError(
      () =>
        pool.query(
          `INSERT INTO variant_price_current (variant_id, revision_id, version) VALUES ($1,$2,1)`,
          [otherVariantId, revisionId]
        ),
      "23503"
    );
  });

  it.skipIf(!reachable)("RESTRICT menjaga histori revision, current, variant, dan batch", async () => {
    await seedCatalog();
    await insertBatch();
    await insertRow();
    await insertRevision();
    await pool.query(
      `UPDATE price_change_batch_row SET applied_revision_id = $2, state = 'applied' WHERE id = $1`,
      [rowId, revisionId]
    );
    await pool.query(
      `INSERT INTO variant_price_current (variant_id, revision_id, version) VALUES ($1,$2,1)`,
      [variantId, revisionId]
    );
    await expectPgError(
      () => pool.query(`DELETE FROM product_variant WHERE id = $1`, [variantId]),
      "23503"
    );
    await expectPgError(
      () => pool.query(`DELETE FROM variant_price_revision WHERE id = $1`, [revisionId]),
      "23503"
    );
    await expectPgError(
      () => pool.query(`DELETE FROM price_change_batch WHERE id = $1`, [batchId]),
      "23503"
    );
  });

  it.skipIf(!reachable)("counts batch harus menjumlah row_count dan state terbatas", async () => {
    await seedCatalog();
    await expectPgError(
      () => insertBatch({ pendingCount: 2 }),
      "23514"
    );
    await expectPgError(
      () => insertBatch({ state: "applying" }),
      "23514"
    );
    await expectPgError(
      () => insertBatch({ requestKey: "not-a-uuid" }),
      "23514"
    );
    await expectPgError(
      () => insertBatch({ fingerprint: "abc" }),
      "23514"
    );
  });

  it.skipIf(!reachable)("preview row dibatasi 16KiB", async () => {
    await seedCatalog();
    await insertBatch();
    await expectPgError(
      () => insertRow({ previewJson: { blob: "x".repeat(17 * 1024) } }),
      "23514"
    );
  });
});
