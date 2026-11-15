/**
 * import-jubelio — pull product/stock master data from the Jubelio API into the
 * marketplace DB. Re-runnable (idempotent upserts) so it doubles as a
 * "refresh from Jubelio" tool.
 *
 * Two modes share one pipeline:
 *   - development/filtered (default): honours the development cap, start page
 *     and exact-name filter. Loads ../../.env for local convenience.
 *   - `--full` (production bootstrap): page 1 → end, no cap/filter/skip,
 *     explicit expected database, session advisory lock and a durable
 *     completeness report. It never loads a development `.env`.
 *
 * Usage (from repo root):
 *   npm run db:import-jubelio
 *   npm run db:import-jubelio -- --item-name="Exact Jubelio item name"
 *   npm run db:import-jubelio -- --full \
 *     --expected-database=qadfstore_production \
 *     --report-file=/home/ops/log/marketplace-bootstrap/production/import.json
 *
 * Flow: locations → branches; fetch the Jubelio category tree (id → name map,
 * NOT bulk-imported); paginate /inventory/items/masters, and per product fetch
 * /inventory/catalog/{id} for brand/description/images/variants +
 * /inventory/items/all-stocks/ for per-branch stock; upsert page-by-page
 * (memory-bounded). Categories are created on demand — only the ones used by
 * the synced products (see ensureJubelioCategories), so our category table
 * matches the products we actually carry.
 */

import dotenv from "dotenv";

// A production full import must receive its configuration explicitly; only the
// development/filtered path keeps the local `.env` convenience.
const rawArgv = process.argv.slice(2);
const fullMode = rawArgv.includes("--full");
if (!fullMode) {
  dotenv.config({ path: "../../.env" });
}

import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";
import {
  type Db,
  fetchLocationsList,
  fetchCategories,
  fetchMastersPage,
  fetchProductCatalog,
  fetchStocks,
  flattenStock,
  upsertJubelioBranches,
  ensureJubelioCategories,
  upsertJubelioProducts,
  upsertJubelioStock,
  mapWithConcurrency,
  parseJubelioStartPage,
} from "./jubelio-sync";
import {
  filterExactItemNameMatches,
  parseJubelioImportArgs,
  parseJubelioMaxProducts,
  validateFullJubelioImportOptions,
} from "./jubelio-import-options";
import {
  importJubelio,
  sanitizeImportReason,
} from "./import-jubelio-service";
import { createModuleLogger, withExecutionContext } from "./logger";
import {
  BOOTSTRAP_EXIT,
  ProductionBootstrapInputError,
} from "./production-bootstrap/bootstrap-input";

const PAGE_SIZE = 200;
const STOCK_BATCH = 200;

const log = createModuleLogger("import-jubelio");

async function runFullImport(): Promise<number> {
  const options = parseJubelioImportArgs(rawArgv);
  const fullOptions = validateFullJubelioImportOptions(options, process.env);
  if (fullOptions === null) {
    throw new Error("--full was requested but the full-import scope is invalid");
  }
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required for a full bootstrap import");
  }

  // Provider prerequisites are checked per phase: the full import needs
  // master-read credentials, and nothing else (no payment/shipment writes).
  const missingCredentials = ["JUBELIO_EMAIL", "JUBELIO_PASSWORD"].filter(
    (key) => !process.env[key]?.trim()
  );
  if (missingCredentials.length > 0) {
    throw new ProductionBootstrapInputError(
      "MISSING_PROVIDER_CREDENTIALS",
      `full import requires ${missingCredentials.join(", ")}`
    );
  }

  const pool = new Pool({ connectionString: databaseUrl });
  const db = drizzle(pool, { schema }) as unknown as Db;
  try {
    const report = await importJubelio(fullOptions, { db });
    if (report.status !== "complete") {
      log.error(
        `kode=FULL_IMPORT_INCOMPLETE report=${fullOptions.reportFile} errors=${
          report.errors.join(" | ") || "none"
        } mismatches=${report.mismatches.join(" | ") || "none"}`
      );
      return BOOTSTRAP_EXIT.incomplete;
    }
    log.info(
      `kode=FULL_IMPORT_COMPLETE report=${fullOptions.reportFile} product_groups=${report.counts.databaseProductGroups} skus=${report.counts.databaseSkus}`
    );
    return BOOTSTRAP_EXIT.ok;
  } finally {
    await pool.end();
  }
}

async function runDevelopmentImport(): Promise<void> {
  const { itemName } = parseJubelioImportArgs(rawArgv);
  const concurrency = Math.max(
    1,
    Number(process.env.JUBELIO_SYNC_CONCURRENCY || 5)
  );
  const configuredCap = parseJubelioMaxProducts(
    process.env.JUBELIO_SYNC_MAX_PRODUCTS
  );
  // Exact-name mode imports every identical match, regardless of the general
  // development cap.
  const cap = itemName ? Infinity : configuredCap;
  const startPage = parseJubelioStartPage(process.env.JUBELIO_SYNC_START_PAGE);
  console.log(
    `🔧 concurrency=${concurrency} | maxProducts=${
      cap === Infinity ? "ALL" : cap
    } | startPage=${startPage}${
      itemName ? ` | exactItemName="${itemName}"` : ""
    }`
  );

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const db = drizzle(pool, { schema }) as unknown as Db;
  const logProgress = (m: string) => console.log("  " + m);

  let totalProducts = 0;
  let totalVariants = 0;
  const totalBrands = new Set<string>();
  let totalStockRows = 0;

  try {
    // 1. Branches (outlet locations).
    const locations = await fetchLocationsList();
    const branchCount = await upsertJubelioBranches(db, locations, {
      onProgress: logProgress,
      // All locations are imported; status mirrors Jubelio is_active.
      operatingHours: {
        monday: { open: "07:00", close: "22:00" },
        tuesday: { open: "07:00", close: "22:00" },
        wednesday: { open: "07:00", close: "22:00" },
        thursday: { open: "07:00", close: "22:00" },
        friday: { open: "07:00", close: "22:00" },
        saturday: { open: "07:00", close: "22:00" },
        sunday: { open: "07:00", close: "22:00" },
      },
    });
    console.log(`✅ branches: ${branchCount} outlets`);

    // 2. Categories — fetch the full Jubelio tree once (id → name map) but do
    //    NOT bulk-import it. Only categories actually used by synced products
    //    are created (per page below), so our category table matches the
    //    products we actually carry.
    const jubelioCats = await fetchCategories();
    console.log(
      `✅ categories: ${jubelioCats.length} in Jubelio (created on demand)`
    );

    // 3. Paginate masters, enrich per product, upsert page-by-page.
    let page = startPage;
    while (totalProducts < cap) {
      const masters = await fetchMastersPage(page, PAGE_SIZE, itemName);
      if (!masters.data.length) break;
      const exactMatches = itemName
        ? filterExactItemNameMatches(masters.data, itemName)
        : masters.data;
      const remaining = cap - totalProducts;
      const slice =
        remaining < exactMatches.length
          ? exactMatches.slice(0, remaining)
          : exactMatches;
      const lastPage = masters.data.length < PAGE_SIZE;

      console.log(
        `\n📄 masters page ${page}: ${slice.length} products ` +
          `(search results in Jubelio: ${masters.totalCount})`
      );

      if (!slice.length) {
        if (lastPage) break;
        page++;
        continue;
      }

      // Enrich: fetch catalog per product (brand + description + images + variants).
      const inputs = await mapWithConcurrency(
        slice,
        concurrency,
        async (m) => {
          const catalog = await fetchProductCatalog(m.item_group_id);
          return { catalog, thumbnail: m.thumbnail };
        },
        (done, total) => {
          if (done % 10 === 0 || done === total)
            logProgress(`page ${page}: fetched catalog ${done}/${total}`);
        }
      );

      // Categories — ensure only the ones used by this page's products exist
      // (created on demand; the rest of the Jubelio tree stays out of our DB).
      const usedCatIds = inputs
        .map((i) => i.catalog.item_category_id)
        .filter((id) => id != null);
      const categoryMap = await ensureJubelioCategories(
        db,
        jubelioCats,
        usedCatIds,
        { onProgress: logProgress }
      );

      const prodRes = await upsertJubelioProducts(db, inputs, categoryMap, {
        onProgress: logProgress,
      });
      totalProducts += prodRes.products;
      totalVariants += prodRes.variants;
      // Track distinct brands touched (approximate, from product names).
      for (const inp of inputs) {
        const bn = inp.catalog.selected_brand_name?.trim();
        if (bn) totalBrands.add(bn.toLowerCase());
      }

      // Per-branch stock for this page's variants (batched).
      const itemIds = inputs.flatMap((i) =>
        (i.catalog.product_skus ?? []).map((s) => s.item_id)
      );
      for (let i = 0; i < itemIds.length; i += STOCK_BATCH) {
        const batch = itemIds.slice(i, i + STOCK_BATCH);
        const stockResp = await fetchStocks(batch);
        const rows = flattenStock(stockResp);
        totalStockRows += await upsertJubelioStock(db, rows, {
          onProgress: logProgress,
        });
      }

      console.log(
        `📊 running totals: ${totalProducts} products, ${totalVariants} variants, ${totalStockRows} stock rows`
      );

      if (lastPage || totalProducts >= cap) break;
      page++;
    }

    if (itemName && totalProducts === 0) {
      throw new Error(
        `No Jubelio product found with exact item_name "${itemName}"`
      );
    }

    console.log(
      `\n✅ Import complete: ${totalProducts} products, ${totalVariants} variants, ` +
        `${totalBrands.size} brands, ${totalStockRows} stock rows`
    );
  } finally {
    await pool.end();
  }
}

async function main(): Promise<void> {
  if (!fullMode) {
    await runDevelopmentImport();
    return;
  }

  await withExecutionContext(async () => {
    try {
      process.exitCode = await runFullImport();
    } catch (error) {
      const refused =
        error instanceof ProductionBootstrapInputError ||
        (error instanceof Error &&
          error.message.startsWith("IMPORT_ALREADY_RUNNING"));
      log.error(
        `kode=${refused ? "FULL_IMPORT_REFUSED" : "FULL_IMPORT_FAILED"} ${sanitizeImportReason(error)}`,
        error
      );
      process.exitCode = refused
        ? BOOTSTRAP_EXIT.refused
        : BOOTSTRAP_EXIT.failed;
    }
  });
}

main().catch((e) => {
  console.error("❌ Jubelio import failed:", e);
  process.exit(1);
});
