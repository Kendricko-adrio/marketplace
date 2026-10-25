import dotenv from "dotenv";
import path from "node:path";
dotenv.config({ path: path.resolve(import.meta.dirname, "../../../.env"), quiet: true });

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import { productVariants, variantPriceRevisions } from "@marketplace/db/src/schema";

import {
  effectivePriceSql,
  markdownActiveSql,
  projectRow,
  readVariantProjections,
} from "./variant-price-projection";

/**
 * Seam T — the SQL effective-price expression and the bulk reader must agree
 * with the pure projection on real PostgreSQL. Expected values are the approved
 * spec §4.1/§4.4 literals, not the expression's own output.
 */
const url = process.env.DATABASE_URL;
const TEST_DATABASE_PREFIX = "marketplace_discounts_test_";
if (url) {
  const name = decodeURIComponent(new URL(url).pathname).replace(/^\/+/, "").split("/")[0];
  if (!name?.startsWith(TEST_DATABASE_PREFIX)) {
    throw new Error(
      `[projection-db] Refusing to mutate "${name ?? "<unknown>"}": DATABASE_URL must be a disposable "${TEST_DATABASE_PREFIX}*" database.`
    );
  }
}

const pool = url ? new Pool({ connectionString: url, max: 2 }) : null;
async function ready(): Promise<boolean> {
  if (!pool) return false;
  const r = await pool.query(
    `select to_regclass('public.variant_price_current') is not null as ok`
  );
  return r.rows[0]?.ok === true;
}
const dbReady = await ready();

const PRODUCT = "zz-fx-proj-product";
const SKU_PREFIX = "ZZ-PROJ";
const VARIANTS = ["zz-fx-proj-a", "zz-fx-proj-b", "zz-fx-proj-c", "zz-fx-proj-d"];
const TARGET = "150000";

async function cleanup() {
  if (!pool) return;
  await pool.query(`DELETE FROM variant_price_current WHERE variant_id = ANY($1::text[])`, [VARIANTS]);
  await pool.query(`UPDATE price_change_batch_row SET state='pending', applied_revision_id=NULL WHERE variant_id = ANY($1::text[])`, [VARIANTS]);
  await pool.query(`DELETE FROM variant_price_revision WHERE variant_id = ANY($1::text[])`, [VARIANTS]);
  await pool.query(`DELETE FROM price_change_batch_row WHERE variant_id = ANY($1::text[])`, [VARIANTS]);
  await pool.query(`DELETE FROM price_change_batch WHERE actor_identity = 'zz-fx-proj-actor'`);
  await pool.query(`DELETE FROM product_variant WHERE id = ANY($1::text[])`, [VARIANTS]);
  await pool.query(`DELETE FROM product WHERE id = $1`, [PRODUCT]);
}

async function seed(): Promise<void> {
  await pool!.query(
    `INSERT INTO product (id, name, slug, base_price, status)
     VALUES ($1, 'ZZ Projection', 'zz-projection', '300000', 'aktif')
     ON CONFLICT (id) DO NOTHING`,
    [PRODUCT]
  );
  const sources = ["300000", "120000", "150000", "400000"];
  for (let i = 0; i < VARIANTS.length; i += 1) {
    await pool!.query(
      `INSERT INTO product_variant (id, product_id, sku, price)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (id) DO UPDATE SET price = EXCLUDED.price`,
      [VARIANTS[i], PRODUCT, `${SKU_PREFIX}-${i}`, sources[i]]
    );
  }
  // One applied batch row + revision + current pointer for every variant, with
  // the SAME stored target 150000. apply-time source is 300000 for all of them
  // (the later source movement is exactly the fallback/increase scenario).
  const batchId = randomUUID();
  await pool!.query(
    `INSERT INTO price_change_batch (id, actor_identity, request_key, fingerprint, source, state, row_count, applied_count, unchanged_count, failed_count, pending_count)
     VALUES ($1, 'zz-fx-proj-actor', $2, $3, 'manual', 'applied', 4, 4, 0, 0, 0)`,
    [batchId, randomUUID(), "b".repeat(64)]
  );
  for (let i = 0; i < VARIANTS.length; i += 1) {
    const revisionId = randomUUID();
    const rowId = randomUUID();
    await pool!.query(
      `INSERT INTO variant_price_revision
         (id, variant_id, revision_no, action, target_unit_price, source_unit_price, effective_unit_price,
          previous_target_unit_price, previous_effective_unit_price, markdown_active, previous_markdown_active,
          batch_id, batch_row_id, actor_identity)
       VALUES ($1,$2,1,'set_price',$3,'300000',$3,NULL,'300000',true,false,$4,$5,'zz-fx-proj-actor')`,
      [revisionId, VARIANTS[i], TARGET, batchId, rowId]
    );
    await pool!.query(
      `INSERT INTO price_change_batch_row
         (id, batch_id, row_number, input_sku, variant_id, action, target_unit_price, preview_json, state, applied_revision_id)
       VALUES ($1,$2,$3,$4,$5,'set_price',$6,'{}'::jsonb,'applied',$7)`,
      [rowId, batchId, i + 1, `${SKU_PREFIX}-${i}`, VARIANTS[i], TARGET, revisionId]
    );
    await pool!.query(
      `INSERT INTO variant_price_current (variant_id, revision_id, version) VALUES ($1,$2,1)`,
      [VARIANTS[i], revisionId]
    );
  }
}

describe.skipIf(!dbReady)("storefront Markdown projection (disposable DB)", () => {
  beforeAll(async () => {
    if (!pool) return;
    await cleanup();
    await seed();
  });
  afterAll(async () => {
    if (!pool) return;
    await cleanup();
    await pool.end();
  });

  it("SQL expression dan bulk reader sama dengan literal spec §4.1", async () => {
    // Use the same expression through the pool with explicit parameters:
    const expressions = await pool!.query(
      `SELECT v.id,
              case when r.target_unit_price is not null and r.target_unit_price < v.price
                   then r.target_unit_price else v.price end AS effective,
              (r.target_unit_price is not null and r.target_unit_price < v.price) AS active,
              v.price AS source,
              r.target_unit_price AS target
         FROM product_variant v
         LEFT JOIN variant_price_current c ON c.variant_id = v.id
         LEFT JOIN variant_price_revision r ON r.id = c.revision_id AND r.variant_id = c.variant_id
        WHERE v.id = ANY($1::text[])
        ORDER BY v.id`,
      [VARIANTS]
    );
    const expected = [
      { source: "300000", target: "150000", effective: "150000", active: true },
      { source: "120000", target: "150000", effective: "120000", active: false },
      { source: "150000", target: "150000", effective: "150000", active: false },
      { source: "400000", target: "150000", effective: "150000", active: true },
    ];
    const byId = new Map(expressions.rows.map((row) => [row.id, row]));
    VARIANTS.forEach((variantId, index) => {
      const row = byId.get(variantId)!;
      expect({
        source: Number(row.source),
        target: Number(row.target),
        effective: Number(row.effective),
        active: row.active,
      }).toEqual({
        source: Number(expected[index].source),
        target: Number(expected[index].target),
        effective: Number(expected[index].effective),
        active: expected[index].active,
      });
    });

    const projections = await readVariantProjections(VARIANTS);
    VARIANTS.forEach((variantId, index) => {
      const projection = projections.get(variantId)!;
      expect(projection.sourceUnitPrice).toBe(expected[index].source);
      expect(projection.storedTarget).toBe(expected[index].target);
      expect(projection.effectiveUnitPrice).toBe(expected[index].effective);
      expect(projection.markdownActive).toBe(expected[index].active);
      expect(Boolean(projection.markdownRevisionId)).toBe(expected[index].active);
    });

    // The exported SQL helpers must produce the same expression semantics.
    const drizzleDb = drizzle(pool!);
    const viaHelpers = await drizzleDb.execute(sql`
      SELECT ${effectivePriceSql(productVariants.price, variantPriceRevisions.targetUnitPrice)} AS effective,
             ${markdownActiveSql(productVariants.price, variantPriceRevisions.targetUnitPrice)} AS active
        FROM product_variant
        LEFT JOIN variant_price_current ON variant_price_current.variant_id = product_variant.id
        LEFT JOIN variant_price_revision ON variant_price_revision.id = variant_price_current.revision_id
             AND variant_price_revision.variant_id = variant_price_current.variant_id
       WHERE product_variant.id = ${VARIANTS[1]}
    `);
    expect(viaHelpers.rows[0]).toEqual({ effective: "120000.00", active: false });
  });

  it("projectRow menolak pointer/revision yang tidak konsisten", () => {
    expect(() =>
      projectRow({
        variantId: "v",
        sourceUnitPrice: "300000",
        storedTargetUnitPrice: "150000",
        markdownRevisionId: null,
      })
    ).toThrow(/inconsistent Markdown data/);
  });
});
