// One-operation full Jubelio import.
// It reuses the existing sync worker (fetch/upsert/category/stock mapping) and
// adds the bootstrap contract: target guard, session advisory lock, page-by-page
// progress with a durable report, a second enumeration for source drift, and a
// database reconciliation that must pass before the report says `complete`.

import { randomUUID } from "node:crypto";
import { isNotNull } from "drizzle-orm";

import * as schema from "./schema";
import {
  type Db,
  type JubelioCatalogProduct,
  type JubelioCategory,
  type JubelioLocation,
  type JubelioStockResponse,
  type MastersPage,
  ensureJubelioCategories,
  fetchCategories,
  fetchLocationsList,
  fetchMastersPage,
  fetchProductCatalog,
  fetchStocks,
  flattenStock,
  mapWithConcurrency,
  resolveJubelioThumbnail,
  upsertJubelioBranches,
  upsertJubelioProducts,
  upsertJubelioStock,
} from "./jubelio-sync";
import { createModuleLogger } from "./logger";
import {
  IMPORT_REPORT_FORMAT_VERSION,
  finalizeJubelioImportReport,
  reconcileJubelioImport,
  writeJubelioImportPartial,
  type JubelioImportReport,
} from "./jubelio-import-report";
import type { FullJubelioImportOptions } from "./jubelio-import-options";
import { assertTargetIdentity } from "./production-bootstrap/bootstrap-input";
import { readTargetIdentity } from "./production-bootstrap/production-bootstrap-repository";

const log = createModuleLogger("jubelio-full-import");

const STOCK_BATCH = 200;
const LOCK_KEY = "jubelio_full_import";

export interface JubelioImportProvider {
  fetchLocationsList(): Promise<JubelioLocation[]>;
  fetchCategories(): Promise<JubelioCategory[]>;
  fetchMastersPage(
    page: number,
    pageSize: number,
    query?: string
  ): Promise<MastersPage>;
  fetchProductCatalog(itemGroupId: number): Promise<JubelioCatalogProduct>;
  fetchStocks(itemIds: number[]): Promise<JubelioStockResponse>;
}

export interface ImportLockHandle {
  release(): Promise<void>;
}

export interface JubelioImportDependencies {
  db: Db;
  provider?: Partial<JubelioImportProvider>;
  concurrency?: number;
  acquireLock?: () => Promise<ImportLockHandle | null>;
  now?: () => Date;
  runId?: () => string;
  release?: string;
}

/** Provider/DB adapter used by default; tests inject a loopback fixture. */
function defaultProvider(): JubelioImportProvider {
  return {
    fetchLocationsList,
    fetchCategories,
    fetchMastersPage,
    fetchProductCatalog,
    fetchStocks,
  };
}

interface SessionClient {
  query(text: string): Promise<{ rows: Array<Record<string, unknown>> }>;
  release(): void;
}

/**
 * Session-level advisory lock on a dedicated connection: the importer holds it
 * for the whole run without wrapping thousands of HTTP requests in one
 * transaction. Two full imports can never interleave.
 */
async function acquireSessionLock(db: Db): Promise<ImportLockHandle | null> {
  const pool = (
    db as unknown as {
      $client: { connect(): Promise<SessionClient> };
    }
  ).$client;
  const client = await pool.connect();
  try {
    const result = await client.query(
      `select pg_try_advisory_lock(hashtext('${LOCK_KEY}')) as locked`
    );
    if (result.rows[0]?.locked !== true) {
      client.release();
      return null;
    }
  } catch (error) {
    client.release();
    throw error;
  }

  return {
    async release() {
      try {
        await client.query(
          `select pg_advisory_unlock(hashtext('${LOCK_KEY}'))`
        );
      } finally {
        client.release();
      }
    },
  };
}

/** Remove credentials/connection strings and bound the length of log/report text. */
export function sanitizeImportReason(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  return raw
    .replace(/postgres(?:ql)?:\/\/\S+/gi, "postgresql://[redacted]")
    .replace(/(password|token|authorization|secret)(["'\s:=]+)[^\s,&}"']+/gi, "$1$2[redacted]")
    .slice(0, 300);
}

export async function importJubelio(
  input: FullJubelioImportOptions,
  dependencies: JubelioImportDependencies
): Promise<JubelioImportReport> {
  const db = dependencies.db;
  const provider: JubelioImportProvider = {
    ...defaultProvider(),
    ...dependencies.provider,
  };
  const now = dependencies.now ?? (() => new Date());
  const release = dependencies.release ?? process.env.APP_RELEASE ?? "unspecified";
  const runId = dependencies.runId ? dependencies.runId() : randomUUID();
  const concurrency = Math.max(1, dependencies.concurrency ?? 2);

  const identity = await readTargetIdentity(db);
  assertTargetIdentity(identity, input.expectedDatabase);

  const acquireLock = dependencies.acquireLock ?? (() => acquireSessionLock(db));
  const lock = await acquireLock();
  if (lock === null) {
    throw new Error(
      "IMPORT_ALREADY_RUNNING: another full import holds the advisory lock"
    );
  }

  const startedAt = now().toISOString();
  const errors: string[] = [];
  const mismatches: string[] = [];
  const sourceGroups = new Set<number>();
  const sourceSkus = new Set<number>();
  const recheckGroups = new Set<number>();
  const coveredPairs = new Set<string>();
  const written = { productGroups: 0, skus: 0, stockObservations: 0 };
  const dataQuality = {
    productGroupsMissingImage: 0,
    productGroupsMissingDescription: 0,
    skusMissingParcelDimensions: 0,
  };
  let stockPairsCovered = 0;
  let stockPairsRequested = 0;
  let pagesVisited = 0;
  let reachedEnd = false;

  const report = (
    status: JubelioImportReport["status"],
    finishedAt: string | null
  ): JubelioImportReport => ({
    formatVersion: IMPORT_REPORT_FORMAT_VERSION,
    runId,
    database: identity.database,
    release,
    startedAt,
    finishedAt,
    status,
    scope: { mode: "full", itemName: null, pageSize: input.pageSize, startPage: 1 },
    pagesVisited,
    reachedEnd,
    source: {
      productGroupIds: [...sourceGroups].sort((a, b) => a - b),
      skuIds: [...sourceSkus].sort((a, b) => a - b),
      recheckProductGroupIds: [...recheckGroups].sort((a, b) => a - b),
    },
    written,
    dataQuality,
    counts: {
      sourceProductGroups: sourceGroups.size,
      sourceSkus: sourceSkus.size,
      databaseProductGroups: 0,
      databaseSkus: 0,
      stockPairsRequested,
      stockPairsCovered,
    },
    errors,
    mismatches,
    reasons: [],
  });

  const lockReleased = { done: false };
  const releaseLock = async () => {
    if (lockReleased.done) return;
    lockReleased.done = true;
    await lock.release();
  };

  try {
    const locations = await provider.fetchLocationsList();
    const outletIds = locations
      .filter((location) => location.location_name?.trim())
      .map((location) => location.location_id);
    // No operating-hours override: a provider location is not a business truth,
    // so new branches keep `{}` and existing operator hours are preserved.
    await upsertJubelioBranches(db, locations);

    const categories = await provider.fetchCategories();

    for (let page = 1; ; page++) {
      const masters = await provider.fetchMastersPage(page, input.pageSize);
      pagesVisited = page;
      if (masters.data.length === 0) {
        reachedEnd = true;
        break;
      }

      for (const master of masters.data) {
        sourceGroups.add(master.item_group_id);
      }

      const inputs = await mapWithConcurrency(
        masters.data,
        concurrency,
        async (master) => ({
          catalog: await provider.fetchProductCatalog(master.item_group_id),
          thumbnail: master.thumbnail,
        })
      );
      for (const item of inputs) {
        for (const sku of item.catalog.product_skus ?? []) {
          sourceSkus.add(sku.item_id);
          if (!sku.parcelDimensions) dataQuality.skusMissingParcelDimensions += 1;
        }
        if (!resolveJubelioThumbnail(item.thumbnail, item.catalog.images)) {
          dataQuality.productGroupsMissingImage += 1;
        }
        if (!item.catalog.description || !item.catalog.description.trim()) {
          dataQuality.productGroupsMissingDescription += 1;
        }
      }

      const usedCategoryIds = inputs
        .map((item) => item.catalog.item_category_id)
        .filter((id): id is number => id != null);
      const categoryMap = await ensureJubelioCategories(
        db,
        categories,
        usedCategoryIds
      );
      const productsResult = await upsertJubelioProducts(
        db,
        inputs,
        categoryMap
      );
      written.productGroups += productsResult.products;
      written.skus += productsResult.variants;

      const providerItemIds = new Set(
        inputs.flatMap((item) =>
          (item.catalog.product_skus ?? []).map((sku) => sku.item_id)
        )
      );
      const itemIds = [...providerItemIds];
      for (let index = 0; index < itemIds.length; index += STOCK_BATCH) {
        const batch = itemIds.slice(index, index + STOCK_BATCH);
        const stockResponse = await provider.fetchStocks(batch);
        const rows = flattenStock(stockResponse);
        written.stockObservations += await upsertJubelioStock(db, rows);
        for (const row of rows) {
          if (!providerItemIds.has(row.itemId)) continue;
          if (!outletIds.includes(row.locationId)) continue;
          const pair = `${row.itemId}:${row.locationId}`;
          if (!coveredPairs.has(pair)) {
            coveredPairs.add(pair);
            stockPairsCovered += 1;
          }
        }
      }

      log.info(
        `halaman ${page}: ${masters.data.length} product group, total ${sourceGroups.size} group / ${sourceSkus.size} SKU`
      );
      await writeJubelioImportPartial(input.reportFile, report("partial", null));

      if (masters.data.length < input.pageSize) {
        reachedEnd = true;
        break;
      }
    }

    stockPairsRequested = sourceSkus.size * outletIds.length;

    // Second, cheap enumeration: masters only, no catalog/stock traffic. It
    // detects provider drift during the import window instead of trusting the
    // last response.
    for (let page = 1; ; page++) {
      const masters = await provider.fetchMastersPage(page, input.pageSize);
      for (const master of masters.data) recheckGroups.add(master.item_group_id);
      if (masters.data.length < input.pageSize) break;
    }
  } catch (error) {
    errors.push(sanitizeImportReason(error));
    log.error(`full import gagal: ${sanitizeImportReason(error)}`);
  } finally {
    await releaseLock();
  }

  const groupRows = await db
    .select({ id: schema.products.jubelioItemGroupId })
    .from(schema.products)
    .where(isNotNull(schema.products.jubelioItemGroupId));
  const skuRows = await db
    .select({ id: schema.productVariants.jubelioItemId })
    .from(schema.productVariants)
    .where(isNotNull(schema.productVariants.jubelioItemId));
  const databaseGroupIds = groupRows
    .map((row) => row.id)
    .filter((id): id is number => id != null);
  const databaseSkuIds = skuRows
    .map((row) => row.id)
    .filter((id): id is number => id != null);

  const sourceGroupList = [...sourceGroups];
  const missingFromDatabase = sourceGroupList.filter(
    (id) => !databaseGroupIds.includes(id)
  );
  if (missingFromDatabase.length > 0) {
    mismatches.push(
      `${missingFromDatabase.length} source product group(s) are not mapped in the database`
    );
  }
  const extraInDatabase = databaseGroupIds.filter(
    (id) => !sourceGroups.has(id)
  );
  if (extraInDatabase.length > 0) {
    mismatches.push(
      `${extraInDatabase.length} database product group(s) are not in the provider source set`
    );
  }
  if (
    recheckGroups.size !== sourceGroups.size ||
    [...recheckGroups].some((id) => !sourceGroups.has(id))
  ) {
    mismatches.push(
      "the second provider enumeration did not match the imported source set"
    );
  }

  const reconciliation = reconcileJubelioImport({
    reachedEnd,
    pagesVisited,
    sourceProductGroupIds: sourceGroupList,
    sourceSkuIds: [...sourceSkus],
    recheckProductGroupIds: [...recheckGroups],
    databaseProductGroupIds: databaseGroupIds,
    databaseSkuIds,
    stockObservations: written.stockObservations,
    stockPairsRequested,
    stockPairsCovered,
    errors,
    mismatches,
  });

  const finalReport: JubelioImportReport = {
    ...report(reconciliation.status, now().toISOString()),
    counts: {
      ...reconciliation.counts,
      stockPairsRequested,
      stockPairsCovered,
    },
    reasons: reconciliation.reasons,
  };

  await finalizeJubelioImportReport(input.reportFile, finalReport);

  if (
    dataQuality.productGroupsMissingImage > 0 ||
    dataQuality.productGroupsMissingDescription > 0 ||
    dataQuality.skusMissingParcelDimensions > 0
  ) {
    log.warn(
      `kualitas data provider: ${dataQuality.productGroupsMissingImage} group tanpa gambar, ${dataQuality.productGroupsMissingDescription} group tanpa deskripsi, ${dataQuality.skusMissingParcelDimensions} SKU tanpa dimensi parcel (tidak diisi placeholder)`
    );
  }

  if (finalReport.status === "complete") {
    log.info(
      `FULL_IMPORT_COMPLETE: ${reconciliation.counts.databaseProductGroups} product group, ${reconciliation.counts.databaseSkus} SKU, ${stockPairsCovered}/${stockPairsRequested} pasangan stok`
    );
  } else {
    log.error(
      `FULL_IMPORT_INCOMPLETE: ${reconciliation.reasons.join(", ")}`
    );
  }

  return finalReport;
}
