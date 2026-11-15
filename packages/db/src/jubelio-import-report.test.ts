import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  finalizeJubelioImportReport,
  reconcileJubelioImport,
  type JubelioImportReport,
  type ImportReconciliationInput,
} from "./jubelio-import-report";

// Independent source of truth: the fixture contract from the approved plan
// (`.scratch/production-deployment/plan/first-production-deployment.md` §8.3)
// — 201 product groups, 202 SKUs, two locations, 404 explicit stock pairs.

const groups201 = Array.from({ length: 201 }, (_, i) => 1000 + i);
const skus202 = Array.from({ length: 202 }, (_, i) => 5000 + i);

function complete(): ImportReconciliationInput {
  return {
    reachedEnd: true,
    pagesVisited: 2,
    sourceProductGroupIds: groups201,
    sourceSkuIds: skus202,
    recheckProductGroupIds: groups201,
    databaseProductGroupIds: groups201,
    databaseSkuIds: skus202,
    stockObservations: 404,
    stockPairsRequested: 404,
    stockPairsCovered: 404,
    errors: [],
    mismatches: [],
  };
}

describe("full import reconciliation", () => {
  it("accepts a complete, drift-free import", () => {
    const result = reconcileJubelioImport(complete());

    expect(result.complete).toBe(true);
    expect(result.status).toBe("complete");
    expect(result.reasons).toEqual([]);
    expect(result.counts).toEqual({
      sourceProductGroups: 201,
      sourceSkus: 202,
      databaseProductGroups: 201,
      databaseSkus: 202,
    });
  });

  it("rejects an import that stopped before the end of pagination", () => {
    const result = reconcileJubelioImport({ ...complete(), reachedEnd: false });

    expect(result.complete).toBe(false);
    expect(result.reasons).toContain("DID_NOT_REACH_END");
  });

  it("rejects a result whose last group is only present in the report", () => {
    const result = reconcileJubelioImport({
      ...complete(),
      databaseProductGroupIds: groups201.slice(0, 200),
    });

    expect(result.complete).toBe(false);
    expect(result.reasons).toContain("MISSING_PRODUCT_GROUPS");
  });

  it("rejects a missing SKU even when the group count matches", () => {
    const result = reconcileJubelioImport({
      ...complete(),
      databaseSkuIds: skus202.slice(0, 201),
    });

    expect(result.complete).toBe(false);
    expect(result.reasons).toContain("MISSING_SKUS");
  });

  it("rejects source drift detected by the second enumeration", () => {
    const result = reconcileJubelioImport({
      ...complete(),
      recheckProductGroupIds: groups201.slice(0, 200),
    });

    expect(result.complete).toBe(false);
    expect(result.reasons).toContain("SOURCE_DRIFT");
  });

  it("rejects an empty catalog unless it was explicitly approved", () => {
    const result = reconcileJubelioImport({
      ...complete(),
      sourceProductGroupIds: [],
      sourceSkuIds: [],
      recheckProductGroupIds: [],
      databaseProductGroupIds: [],
      databaseSkuIds: [],
      stockObservations: 0,
      stockPairsRequested: 0,
      stockPairsCovered: 0,
    });

    expect(result.complete).toBe(false);
    expect(result.reasons).toContain("EMPTY_SOURCE");
  });

  it("rejects duplicate natural keys", () => {
    const result = reconcileJubelioImport({
      ...complete(),
      sourceProductGroupIds: [...groups201, 1000],
    });

    expect(result.complete).toBe(false);
    expect(result.reasons).toContain("DUPLICATE_IDS");
  });

  it("treats missing stock observations as incomplete, never as zero stock", () => {
    const result = reconcileJubelioImport({
      ...complete(),
      stockObservations: 403,
      stockPairsCovered: 403,
    });

    expect(result.complete).toBe(false);
    expect(result.reasons).toContain("MISSING_STOCK_OBSERVATIONS");
  });

  it("carries sanitized collected errors into an incomplete result", () => {
    const result = reconcileJubelioImport({
      ...complete(),
      errors: ["page 2: provider responded 503 after bounded retries"],
      mismatches: ["1 database product group is not in the source set"],
    });

    expect(result.complete).toBe(false);
    expect(result.reasons).toContain("COLLECTED_ERRORS");
    expect(result.reasons).toContain("COLLECTED_MISMATCHES");
  });
});

describe("durable import report", () => {
  const report: JubelioImportReport = {
    formatVersion: 1,
    runId: "run-fixture-1",
    database: "qadfstore_production",
    release: "release-fixture",
    startedAt: "2026-01-01T00:00:00.000Z",
    finishedAt: "2026-01-01T00:10:00.000Z",
    status: "complete",
    scope: { mode: "full", itemName: null, pageSize: 200, startPage: 1 },
    pagesVisited: 2,
    reachedEnd: true,
    source: {
      productGroupIds: groups201,
      skuIds: skus202,
      recheckProductGroupIds: groups201,
    },
    written: { productGroups: 201, skus: 202, stockObservations: 404 },
    counts: {
      sourceProductGroups: 201,
      sourceSkus: 202,
      databaseProductGroups: 201,
      databaseSkus: 202,
      stockPairsRequested: 404,
      stockPairsCovered: 404,
    },
    errors: [],
    mismatches: [],
    reasons: [],
    dataQuality: {
      productGroupsMissingImage: 0,
      productGroupsMissingDescription: 0,
      skusMissingParcelDimensions: 0,
    },
  };

  it("replaces an existing report atomically and leaves no partial file", async () => {
    const dir = mkdtempSync(join(tmpdir(), "jubelio-report-"));
    const target = join(dir, "import.json");
    writeFileSync(target, '{"status":"stale"}\n', "utf8");

    await finalizeJubelioImportReport(target, report);

    expect(JSON.parse(readFileSync(target, "utf8"))).toEqual(report);
    expect(readdirSync(dir)).toEqual(["import.json"]);
  });
});
