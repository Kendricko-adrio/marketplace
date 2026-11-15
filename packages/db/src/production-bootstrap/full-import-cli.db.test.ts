import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";
import { Client, Pool } from "pg";

import * as schema from "../schema";
import type { Db } from "../jubelio-sync";
import type { JubelioImportReport } from "../jubelio-import-report";
import {
  createScratchDatabase,
  resolveTestDatabaseUrl,
  runMigrate,
  type ScratchDatabase,
} from "../testing/disposable-database";
import {
  startJubelioBootstrapFixture,
  type BootstrapFixtureServer,
} from "../testing/jubelio-bootstrap-fixture";

// =========================================================
// Full bootstrap import on a disposable PostgreSQL database + loopback provider
// fixture. Fixture contract (independent of the implementation): 201 product
// groups, 202 SKUs, 2 locations, 404 explicit stock pairs, one unused category.
//
// Skipped unless TEST_DATABASE_URL points at a test database.
// =========================================================

const baseUrl = resolveTestDatabaseUrl();
const describeDb = baseUrl ? describe : describe.skip;

let scratch: ScratchDatabase;
let fixture: BootstrapFixtureServer;
let pool: Pool;
let db: Db;
let reportDir: string;
let importJubelio: typeof import("../import-jubelio-service").importJubelio;

async function query<T extends Record<string, unknown>>(
  text: string,
  values: readonly unknown[] = []
): Promise<T[]> {
  const client = new Client({ connectionString: scratch.appUrl });
  await client.connect();
  try {
    return (await client.query(text, [...values])).rows as T[];
  } finally {
    await client.end();
  }
}

async function resetCatalog(): Promise<void> {
  await query(
    "TRUNCATE TABLE branch_stock, product_to_category, product_variant, product, branch, category, brand CASCADE"
  );
}

let runCounter = 0;

async function runImport(): Promise<JubelioImportReport> {
  runCounter += 1;
  return importJubelio(
    {
      mode: "full",
      expectedDatabase: scratch.database,
      reportFile: path.join(reportDir, `import-${runCounter}.json`),
      pageSize: 200,
    },
    {
      db,
      concurrency: 2,
      acquireLock: async () => ({ release: async () => {} }),
      now: () => new Date("2026-01-01T00:00:00.000Z"),
      runId: () => `fixture-run-${runCounter}`,
      release: "fixture-release",
    }
  );
}

describeDb("full bootstrap import (disposable database + fixture)", () => {
  beforeAll(async () => {
    scratch = await createScratchDatabase(baseUrl as string);
    const migrate = runMigrate(scratch.appUrl);
    if (migrate.status !== 0) {
      throw new Error(`migration failed: ${migrate.stderr}`);
    }

    fixture = await startJubelioBootstrapFixture();
    process.env.JUBELIO_API_BASE_URL = fixture.url;
    process.env.JUBELIO_EMAIL = "fixture@example.invalid";
    process.env.JUBELIO_PASSWORD = "fixture-password";

    pool = new Pool({ connectionString: scratch.appUrl });
    db = drizzle(pool, { schema }) as unknown as Db;
    reportDir = mkdtempSync(path.join(tmpdir(), "jubelio-full-import-"));
    ({ importJubelio } = await import("../import-jubelio-service"));
  }, 300_000);

  afterAll(async () => {
    await pool?.end();
    await fixture?.close();
    if (scratch) await scratch.drop();
  }, 60_000);

  it("imports every page and reconciles 201 groups / 202 SKUs / 404 stock pairs", async () => {
    await resetCatalog();
    fixture.configure({});
    const report = await runImport();

    expect(report.status).toBe("complete");
    expect(report.reasons).toEqual([]);
    expect(report.pagesVisited).toBe(2);
    expect(report.reachedEnd).toBe(true);
    expect(report.counts.databaseProductGroups).toBe(201);
    expect(report.counts.databaseSkus).toBe(202);
    expect(report.counts.stockPairsRequested).toBe(404);
    expect(report.counts.stockPairsCovered).toBe(404);
    // Fixture contract: group thumbnails exist, but no descriptions and no
    // per-SKU parcel masters. They are reported as data quality, never invented.
    expect(report.dataQuality).toEqual({
      productGroupsMissingImage: 0,
      productGroupsMissingDescription: 201,
      skusMissingParcelDimensions: 202,
    });

    const groups = await query<{ count: number }>(
      "select count(*)::int as count from product where jubelio_item_group_id is not null"
    );
    expect(groups[0]?.count).toBe(201);
    const skus = await query<{ count: number }>(
      "select count(*)::int as count from product_variant where jubelio_item_id is not null"
    );
    expect(skus[0]?.count).toBe(202);
    // The group on the second page really exists, not only in the report.
    const lastPage = await query<{ id: string }>(
      "select id from product where jubelio_item_group_id = 100200"
    );
    expect(lastPage).toHaveLength(1);
    // The unused fixture category is never imported.
    const categories = await query<{ count: number }>(
      "select count(*)::int as count from category where jubelio_category_id is not null"
    );
    expect(categories[0]?.count).toBe(1);
    // Provider branches keep unconfigured hours; no invented 07:00–22:00.
    const hours = await query<{ operating_hours: Record<string, unknown> }>(
      "select operating_hours from branch where jubelio_location_id is not null"
    );
    expect(hours).toHaveLength(2);
    for (const row of hours) expect(row.operating_hours).toEqual({});
  }, 180_000);

  it("reports source drift detected by the second enumeration", async () => {
    await resetCatalog();
    fixture.configure({ driftOnRecheck: true });
    const report = await runImport();

    expect(report.status).toBe("incomplete");
    expect(report.reasons).toContain("SOURCE_DRIFT");
  }, 180_000);

  it("treats a missing stock observation as incomplete", async () => {
    await resetCatalog();
    fixture.configure({ missingStockPairs: 2 });
    const report = await runImport();

    expect(report.status).toBe("incomplete");
    expect(report.reasons).toContain("MISSING_STOCK_OBSERVATIONS");
    expect(report.counts.stockPairsCovered).toBe(402);
  }, 180_000);

  it("leaves a recoverable partial import and reruns without duplicates", async () => {
    await resetCatalog();
    fixture.configure({ failAfterPage: 1 });
    const failed = await runImport();
    expect(failed.status).toBe("incomplete");
    expect(failed.reasons).toContain("COLLECTED_ERRORS");

    const partial = await query<{ count: number }>(
      "select count(*)::int as count from product where jubelio_item_group_id is not null"
    );
    expect(partial[0]?.count).toBe(200);

    fixture.configure({});
    const rerun = await runImport();
    expect(rerun.status).toBe("complete");
    expect(rerun.counts.databaseProductGroups).toBe(201);

    const duplicates = await query<{ count: number }>(
      "select count(*)::int as count from (select jubelio_item_group_id from product where jubelio_item_group_id is not null group by 1 having count(*) > 1) duplicates"
    );
    expect(duplicates[0]?.count).toBe(0);

    // A local checkout hold must survive a re-sync: the importer only writes
    // provider series and never the checkout-managed reserved stock.
    const [hold] = await query<{
      branch_id: string;
      product_variant_id: string;
    }>(
      "select branch_id, product_variant_id from branch_stock order by branch_id, product_variant_id limit 1"
    );
    await query(
      "update branch_stock set reserved_stock = 3 where branch_id = $1 and product_variant_id = $2",
      [hold?.branch_id ?? "", hold?.product_variant_id ?? ""]
    );
    const third = await runImport();
    expect(third.status).toBe("complete");
    const [afterHold] = await query<{ reserved_stock: number }>(
      "select reserved_stock from branch_stock where branch_id = $1 and product_variant_id = $2",
      [hold?.branch_id ?? "", hold?.product_variant_id ?? ""]
    );
    expect(afterHold?.reserved_stock).toBe(3);
  }, 180_000);

  it("refuses to run a second full import while the advisory lock is held", async () => {
    await expect(
      importJubelio(
        {
          mode: "full",
          expectedDatabase: scratch.database,
          reportFile: path.join(reportDir, "locked.json"),
          pageSize: 200,
        },
        {
          db,
          acquireLock: async () => null,
          now: () => new Date("2026-01-01T00:00:00.000Z"),
          runId: () => "locked-run",
        }
      )
    ).rejects.toThrow("IMPORT_ALREADY_RUNNING");
  });
});
