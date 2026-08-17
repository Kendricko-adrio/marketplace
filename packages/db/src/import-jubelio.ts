/**
 * import-jubelio — one-shot full pull of product/stock master data from the
 * Jubelio API into the marketplace DB. Re-runnable (idempotent upserts) so it
 * doubles as a "refresh from Jubelio" tool.
 *
 * Usage (from repo root):
 *   npm run db:import-jubelio
 *
 * Env (../../.env):
 *   JUBELIO_EMAIL, JUBELIO_PASSWORD            — login credentials
 *   JUBELIO_API_BASE_URL                       — default https://api2.jubelio.com
 *   JUBELIO_SYNC_CONCURRENCY                   — parallel catalog fetches (default 5)
 *   JUBELIO_SYNC_MAX_PRODUCTS                  — cap products synced (empty = all;
 *                                                 set a small int for fast dev tests)
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
dotenv.config({ path: "../../.env" });

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
} from "./jubelio-sync";

const PAGE_SIZE = 200;
const STOCK_BATCH = 200;

async function main() {
  const concurrency = Math.max(
    1,
    Number(process.env.JUBELIO_SYNC_CONCURRENCY || 5)
  );
  const maxProductsRaw = (process.env.JUBELIO_SYNC_MAX_PRODUCTS || "").trim();
  const cap = maxProductsRaw ? Math.max(0, Number(maxProductsRaw)) : Infinity;
  if (!Number.isFinite(cap)) {
    throw new Error(
      `JUBELIO_SYNC_MAX_PRODUCTS must be a number or empty (got "${maxProductsRaw}")`
    );
  }
  console.log(
    `🔧 concurrency=${concurrency} | maxProducts=${
      cap === Infinity ? "ALL" : cap
    }`
  );

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const db = drizzle(pool, { schema }) as unknown as Db;
  const log = (m: string) => console.log("  " + m);

  let totalProducts = 0;
  let totalVariants = 0;
  let totalBrands = new Set<string>();
  let totalStockRows = 0;

  try {
    // 1. Branches (outlet locations).
    const locations = await fetchLocationsList();
    const branchCount = await upsertJubelioBranches(db, locations, {
      onProgress: log,
      // "Dago 123" is not a customer-facing outlet — skip it.
      excludeNames: ["dago 123"],
      // All pulled branches are active with fixed operating hours (Mon–Sun 07:00–22:00).
      status: "aktif",
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
    let page = 1;
    while (totalProducts < cap) {
      const masters = await fetchMastersPage(page, PAGE_SIZE);
      if (!masters.data.length) break;
      const remaining = cap - totalProducts;
      const slice =
        remaining < masters.data.length ? masters.data.slice(0, remaining) : masters.data;
      const lastPage = masters.data.length < PAGE_SIZE;

      console.log(
        `\n📄 masters page ${page}: ${slice.length} products (total in Jubelio: ${masters.totalCount})`
      );

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
            log(`page ${page}: fetched catalog ${done}/${total}`);
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
        { onProgress: log }
      );

      const prodRes = await upsertJubelioProducts(db, inputs, categoryMap, {
        onProgress: log,
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
        totalStockRows += await upsertJubelioStock(db, rows, { onProgress: log });
      }

      console.log(
        `📊 running totals: ${totalProducts} products, ${totalVariants} variants, ${totalStockRows} stock rows`
      );

      if (lastPage || totalProducts >= cap) break;
      page++;
    }

    console.log(
      `\n✅ Import complete: ${totalProducts} products, ${totalVariants} variants, ` +
        `${totalBrands.size} brands, ${totalStockRows} stock rows`
    );
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error("❌ Jubelio import failed:", e);
  process.exit(1);
});