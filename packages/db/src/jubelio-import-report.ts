// =========================================================
// Full import report + completeness reconciliation
// =========================================================
// The report is durable evidence, not a log sink: a `complete` status is only
// written after every check below passes, and the file is finalized atomically
// so an interrupted run can never leave a success marker behind.
//
// Sanitization boundary: callers pass already-sanitized error/mismatch strings
// (no provider bodies, tokens, PII or connection strings). This module never
// fetches or logs provider payloads.

import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export const IMPORT_REPORT_FORMAT_VERSION = 1;

export type JubelioImportMode = "full" | "filtered";

export interface ImportReconciliationInput {
  reachedEnd: boolean;
  pagesVisited: number;
  sourceProductGroupIds: readonly number[];
  sourceSkuIds: readonly number[];
  recheckProductGroupIds: readonly number[];
  databaseProductGroupIds: readonly number[];
  databaseSkuIds: readonly number[];
  stockObservations: number;
  stockPairsRequested: number;
  stockPairsCovered: number;
  errors: readonly string[];
  mismatches: readonly string[];
}

export interface ImportReconciliationCounts {
  sourceProductGroups: number;
  sourceSkus: number;
  databaseProductGroups: number;
  databaseSkus: number;
}

export interface ImportReconciliationResult {
  complete: boolean;
  status: "complete" | "incomplete";
  reasons: string[];
  counts: ImportReconciliationCounts;
}

export interface JubelioImportReport {
  formatVersion: typeof IMPORT_REPORT_FORMAT_VERSION;
  runId: string;
  database: string;
  release: string;
  startedAt: string;
  finishedAt: string | null;
  status: "partial" | "complete" | "incomplete";
  scope: {
    mode: JubelioImportMode;
    itemName: string | null;
    pageSize: number;
    startPage: number;
  };
  pagesVisited: number;
  reachedEnd: boolean;
  source: {
    productGroupIds: number[];
    skuIds: number[];
    recheckProductGroupIds: number[];
  };
  written: {
    productGroups: number;
    skus: number;
    stockObservations: number;
  };
  /**
   * Provider fields that were absent. They are reported as data quality, never
   * invented (no placeholder image, description or parcel size).
   */
  dataQuality: {
    productGroupsMissingImage: number;
    productGroupsMissingDescription: number;
    skusMissingParcelDimensions: number;
  };
  counts: ImportReconciliationCounts & {
    stockPairsRequested: number;
    stockPairsCovered: number;
  };
  errors: string[];
  mismatches: string[];
  /** Reconciliation reasons; empty only for a complete run. */
  reasons: string[];
}

function uniqueSorted(ids: readonly number[]): number[] {
  return [...new Set(ids)].sort((a, b) => a - b);
}

function hasDuplicates(ids: readonly number[]): boolean {
  return new Set(ids).size !== ids.length;
}

function isSameSet(a: readonly number[], b: readonly number[]): boolean {
  const left = uniqueSorted(a);
  const right = uniqueSorted(b);
  return (
    left.length === right.length && left.every((id, index) => id === right[index])
  );
}

function isSubset(subset: readonly number[], superset: readonly number[]): boolean {
  const available = new Set(superset);
  return [...new Set(subset)].every((id) => available.has(id));
}

/**
 * Decide whether a full import is complete. Every reason is reported; the
 * caller must not translate a non-empty reason list into success.
 */
export function reconcileJubelioImport(
  input: ImportReconciliationInput
): ImportReconciliationResult {
  const reasons: string[] = [];

  const sourceGroups = uniqueSorted(input.sourceProductGroupIds);
  const sourceSkus = uniqueSorted(input.sourceSkuIds);

  if (sourceGroups.length === 0) reasons.push("EMPTY_SOURCE");
  if (!input.reachedEnd) reasons.push("DID_NOT_REACH_END");

  if (
    hasDuplicates(input.sourceProductGroupIds) ||
    hasDuplicates(input.sourceSkuIds) ||
    hasDuplicates(input.recheckProductGroupIds) ||
    hasDuplicates(input.databaseProductGroupIds) ||
    hasDuplicates(input.databaseSkuIds)
  ) {
    reasons.push("DUPLICATE_IDS");
  }

  if (!isSameSet(sourceGroups, input.recheckProductGroupIds)) {
    reasons.push("SOURCE_DRIFT");
  }

  if (!isSubset(sourceGroups, input.databaseProductGroupIds)) {
    reasons.push("MISSING_PRODUCT_GROUPS");
  }
  if (!isSubset(input.databaseProductGroupIds, sourceGroups)) {
    reasons.push("DATABASE_PRODUCT_GROUPS_OUTSIDE_SOURCE");
  }
  if (!isSubset(sourceSkus, input.databaseSkuIds)) {
    reasons.push("MISSING_SKUS");
  }
  if (!isSubset(input.databaseSkuIds, sourceSkus)) {
    reasons.push("DATABASE_SKUS_OUTSIDE_SOURCE");
  }

  if (
    input.stockPairsCovered < input.stockPairsRequested ||
    input.stockObservations < input.stockPairsCovered
  ) {
    reasons.push("MISSING_STOCK_OBSERVATIONS");
  }

  if (input.errors.length > 0) reasons.push("COLLECTED_ERRORS");
  if (input.mismatches.length > 0) reasons.push("COLLECTED_MISMATCHES");

  const complete = reasons.length === 0;
  return {
    complete,
    status: complete ? "complete" : "incomplete",
    reasons,
    counts: {
      sourceProductGroups: sourceGroups.length,
      sourceSkus: sourceSkus.length,
      databaseProductGroups: uniqueSorted(input.databaseProductGroupIds).length,
      databaseSkus: uniqueSorted(input.databaseSkuIds).length,
    },
  };
}

function serialize(report: JubelioImportReport): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}

/**
 * Write an intermediate progress file next to the final report. Only
 * `finalizeJubelioImportReport` publishes the report path used by the
 * verifier, so a killed process leaves no success artifact.
 */
export async function writeJubelioImportPartial(
  path: string,
  report: JubelioImportReport
): Promise<string> {
  const partialPath = `${path}.partial`;
  await mkdir(dirname(path), { recursive: true });
  await writeFile(partialPath, serialize({ ...report, finishedAt: null }), "utf8");
  return partialPath;
}

/**
 * Publish the final report atomically (write-then-rename). A `complete` status
 * requires a finished timestamp; an interrupted run cannot claim success.
 */
export async function finalizeJubelioImportReport(
  path: string,
  report: JubelioImportReport
): Promise<void> {
  if (report.status === "complete" && report.finishedAt === null) {
    throw new Error(
      "a complete import report requires finishedAt; refusing to publish an unfinished run as complete"
    );
  }
  const partialPath = `${path}.partial`;
  await mkdir(dirname(path), { recursive: true });
  await writeFile(partialPath, serialize(report), "utf8");
  await rename(partialPath, path);
}
