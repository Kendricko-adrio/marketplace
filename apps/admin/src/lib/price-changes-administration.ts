import { createHash, randomUUID } from "crypto";
import { and, asc, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";

import { db } from "@/db";
import {
  priceChangeApplyRequests,
  priceChangeBatchRows,
  priceChangeBatches,
  productVariants,
  products,
  variantPriceCurrent,
  variantPriceRevisions,
} from "@/db";
import { MAX_MONEY_RUPIAH } from "@marketplace/db/src/versioned-pricing";
import {
  DiscountImportLimitError,
  type DiscountImportLimits,
} from "@marketplace/db/src/discount-import-limits";
import {
  MarkdownPriceError,
  computePercentTarget,
  projectMarkdownPrice,
  validateSetTarget,
  type MarkdownPriceProjection,
} from "@marketplace/db/src/markdown-pricing";
import { writeAuditEvent } from "./rbac/audit-writer";
import {
  parsePriceWorkbook,
  writePriceTemplate,
  writePriceWorkbook,
  type ParsedWorkbookRow,
  type WorkbookLimits,
} from "./price-workbook";
import { WorkbookFatalError } from "./xlsx-container";
import {
  ADMIN_LOCK_TIMEOUT_MS,
  ADMIN_STATEMENT_TIMEOUT_MS,
  beginBoundedTransaction,
  hasAllBranchProductView,
  hasGlobalGrant,
  isRetryableDatabaseError,
  isUniqueViolation,
  loadActorPolicyInTransaction,
  type Executor,
} from "./admin-command";
import { loadPolicy, type LoadedPolicy } from "./rbac/resolver";
import { readDiscountsContractVersion } from "./discounts-administration";
import { readDiscountImportLimitsUncached } from "./discount-import-limits";
import { createModuleLogger } from "./logger";

const workbookLog = createModuleLogger("price-workbook-staging");

// =========================================================
// Manual Markdown price changes — stage → review → apply + immutable history
// =========================================================
// Spec §4.1, §6.1–§6.4, §7.3, §8.1–§8.4. This module is the ONE writer of the
// `price_change_*` / `variant_price_*` records; the thin HTTP adapters never
// touch those tables.
//
//   stagePriceChangeBatch()   — 1..N row batch (manual/bulk), request-key idempotent
//   stageManualPriceChange()  — alias of the above (one manual row)
//   getPriceChangeBatch()     — paginated review/detail read (authorized viewer)
//   listPriceChangeCandidates() — SKU picker for the bulk UI
//   applyPriceChangeBatch()   — foreground chunked apply (≤25 rows / 5s), one
//                               transaction per row, replay/resume safe
//   getVariantPriceHistory()  — immutable revisions + current pointer
//
// Rules that are NOT negotiable here:
//   - the target is validated against the SOURCE READ INSIDE the apply
//     transaction; a stale stage preview never blocks, because source/target
//     movement must not force a re-review (spec §4.1). Invalid target fails the
//     row instead of writing it.
//   - NO-OP (restore without Markdown, or an identical target) becomes
//     `unchanged` — no fake revision, pointer untouched — but is still audited
//     exactly once.
//   - `restore_base` moves the current pointer to a NEW revision and never
//     rewinds history/version.
//   - the writer gate `discounts.contractVersion` must be 1 and is read
//     UNCACHED; grants (`prices:view/edit` global + `products:view
//     all_branches`) are re-read inside the transaction after SHARE locks so a
//     concurrent revoke serializes against the write.
//   - no provider/HTTP call happens inside a transaction.

export const PRICE_CHANGE_AUDIT_STAGED = "PRICE_CHANGE_STAGED";
export const PRICE_CHANGE_AUDIT_APPLIED = "PRICE_CHANGE_APPLIED";
export const PRICE_CHANGE_AUDIT_UNCHANGED = "PRICE_CHANGE_UNCHANGED";
export const PRICE_CHANGE_AUDIT_FAILED = "PRICE_CHANGE_FAILED";

export const PRICE_CHANGE_RESULT = {
  applied: "APPLIED",
  unchanged: "UNCHANGED",
  targetNotBelowSource: "TARGET_NOT_BELOW_SOURCE",
  targetInvalid: "TARGET_INVALID",
  sourcePriceInvalid: "SOURCE_PRICE_INVALID",
  variantNotFound: "VARIANT_NOT_FOUND",
  markdownAbsent: "MARKDOWN_ABSENT",
} as const;

// =========================================================
// Apply chunk budget (spec §6.4)
// =========================================================
// Foreground chunk: maksimum 25 row ATAU 5 detik per response, whichever comes
// first; tidak ada worker/background yang melanjutkan sesudah request mati.
// Sebelum mulai row baru, sisa budget dihitung ulang; timeout transaksi/lock/
// statement tidak pernah melewati sisa budget tersebut.

export const APPLY_MAX_ROWS_PER_REQUEST = 25;
export const APPLY_BUDGET_MS = 5000;
export const APPLY_MIN_ROW_BUDGET_MS = 250;

/** Halt reasons recorded on the batch when an apply stops for a policy/config
 * reason (the committed rows stay committed; pending rows stay pending). */
export const PRICE_CHANGE_HALT = {
  policyRevoked: "POLICY_REVOKED",
  rowLimitExceeded: "ROW_LIMIT_EXCEEDED",
} as const;

/** Sisa budget request dalam ms; 0 bila deadline sudah lewat. */
export function remainingBudgetMs(deadline: number, now: number): number {
  const remaining = deadline - now;
  if (!Number.isFinite(remaining) || remaining <= 0) return 0;
  return remaining;
}

/**
 * Terjemahkan sisa budget menjadi override timeout satu row. `null` berarti
 * tidak cukup budget untuk memulai row baru (jangan pernah memotong row yang
 * sudah berjalan). Lock/statement selalu di-clamp ke default 2s/5s.
 */
export function planRowBudget(
  remainingMs: number
): { lockTimeoutMs: number; statementTimeoutMs: number } | null {
  if (!Number.isFinite(remainingMs) || remainingMs < APPLY_MIN_ROW_BUDGET_MS) {
    return null;
  }
  return {
    lockTimeoutMs: Math.min(ADMIN_LOCK_TIMEOUT_MS, remainingMs),
    statementTimeoutMs: Math.min(ADMIN_STATEMENT_TIMEOUT_MS, remainingMs),
  };
}

/** Batch state dari counts yang selalu menjumlah `rowCount` (spec §6.4). */
export function deriveBatchState(counts: {
  rowCount: number;
  applied: number;
  unchanged: number;
  failed: number;
  pending: number;
}): PriceChangeBatchState {
  if (counts.pending > 0) return "in_progress";
  if (counts.rowCount > 0 && counts.failed >= counts.rowCount) return "failed";
  if (counts.failed > 0) return "partially_applied";
  return "applied";
}

const UUID_PATTERN =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const MAX_PAGE_SIZE = 100;
const MAX_REASON_LENGTH = 500;
const MAX_SEARCH_LENGTH = 100;
/** Static request-body bound; the EFFECTIVE bound is `discount.import.maxRows`. */
export const MAX_STAGE_ROWS_HARD_LIMIT = 5000;

export type PriceChangeAction = "set_price" | "restore_base";
/** A workbook row whose `action` cell was not a known literal. Such a row is
 * stored as a FINAL failed row (never pending), so the apply pipeline can never
 * execute it. */
export type PriceChangeRowAction = PriceChangeAction | "invalid";
export type PriceChangeRowState = "pending" | "applied" | "unchanged" | "failed";
export type PriceChangeBatchState =
  | "staged"
  | "in_progress"
  | "applied"
  | "partially_applied"
  | "failed";

export class PriceChangeError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    /** Machine-readable detail (e.g. the fatal workbook reason), never secrets. */
    readonly details?: { reason?: string }
  ) {
    super(message);
    this.name = "PriceChangeError";
  }
}

export function describePriceChangeError(
  error: unknown
): { status: number; code: string; message: string; details?: { reason?: string } } | null {
  if (error instanceof PriceChangeError) {
    return {
      status: error.status,
      code: error.code,
      message: error.message,
      ...(error.details ? { details: error.details } : {}),
    };
  }
  return null;
}

function inputInvalid(message: string): never {
  throw new PriceChangeError(400, "INPUT_INVALID", message);
}

function denied(): never {
  throw new PriceChangeError(
    403,
    "DENIED",
    "You do not have access to this resource"
  );
}

async function requireActiveContract(): Promise<number> {
  const version = await readDiscountsContractVersion();
  if (version !== 1) {
    throw new PriceChangeError(
      503,
      "DISCOUNTS_INACTIVE",
      "Price administration is not active on this deployment"
    );
  }
  return version;
}

// =========================================================
// Shared validation / normalization
// =========================================================

/** Whole Rupiah from either an API string or a `numeric(15,2)` DB value. */
export function normalizeWholeRupiah(
  value: unknown,
  field: string,
  options: { allowZero?: boolean } = {}
): string {
  if (typeof value !== "string" && typeof value !== "number") {
    inputInvalid(`${field} must be a whole Rupiah amount`);
  }
  const text = String(value).trim();
  const match = /^(\d+)(?:\.(\d+))?$/.exec(text);
  if (!match || !/^0*$/.test(match[2] ?? "")) {
    inputInvalid(`${field} must be an exact whole Rupiah amount`);
  }
  const amount = BigInt(match[1]);
  if (amount > MAX_MONEY_RUPIAH) {
    inputInvalid(`${field} is outside the supported Rupiah range`);
  }
  if (amount === BigInt(0) && !options.allowZero) {
    inputInvalid(`${field} must be greater than zero`);
  }
  return amount.toString();
}

function requireAction(value: unknown): PriceChangeAction {
  if (value !== "set_price" && value !== "restore_base") {
    inputInvalid("action must be set_price or restore_base");
  }
  return value;
}

function requireReason(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") inputInvalid("reason must be a string");
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length > MAX_REASON_LENGTH) {
    inputInvalid(`reason must not exceed ${MAX_REASON_LENGTH} characters`);
  }
  return trimmed;
}

function requireRequestKey(value: unknown): string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    inputInvalid("requestKey must be a UUID");
  }
  return value;
}

function requirePage(value: unknown, fallback: number, max: number): number {
  if (value === undefined || value === null || value === "") return fallback;
  const parsed = typeof value === "number" ? value : Number.parseInt(String(value), 10);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > max) {
    inputInvalid(`page/limit must be between 1 and ${max}`);
  }
  return parsed;
}

// =========================================================
// DTOs
// =========================================================

export interface PriceChangePreview {
  inputSku: string;
  variantId: string | null;
  productId: string | null;
  productName: string | null;
  /** Gabungan color/size apa adanya; null bila variant tidak punya keduanya. */
  variantLabel: string | null;
  action: PriceChangeRowAction;
  targetUnitPrice: string | null;
  /** Workbook-only raw action/target text (kept for review and the report). */
  inputActionRaw?: string | null;
  inputTargetRaw?: string | null;
  inputType?: "price" | "percent" | null;
  inputTypeRaw?: string | null;
  inputValueRaw?: string | null;
  /** Workbook row error that made this row fail before apply, if any. */
  errorReason?: string | null;
  /** Latest source price observed while STAGING (not the apply authority). */
  sourceUnitPrice: string | null;
  storedTargetBefore: string | null;
  effectiveUnitPriceBefore: string | null;
  markdownActiveBefore: boolean;
  markdownRevisionIdBefore: string | null;
  /** Effective price if the action is applied to the staged source. */
  effectiveUnitPriceAfter: string | null;
  delta: string | null;
  direction: "increase" | "decrease" | "same" | "unknown";
  percent: string | null;
  warnings: string[];
}

export interface PriceChangeActual {
  sourceUnitPrice: string | null;
  previousTargetUnitPrice: string | null;
  previousEffectiveUnitPrice: string | null;
  previousMarkdownActive: boolean | null;
  targetUnitPrice: string | null;
  effectiveUnitPrice: string | null;
  markdownActive: boolean | null;
}

export interface PriceChangeBatchRowDto {
  id: string;
  rowNumber: number;
  inputSku: string;
  variantId: string | null;
  action: PriceChangeRowAction;
  targetUnitPrice: string | null;
  state: PriceChangeRowState;
  resultCode: string | null;
  preview: PriceChangePreview;
  actual: PriceChangeActual;
  appliedRevisionId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PriceChangeBatchPagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface PriceChangeBatchDto {
  id: string;
  source: "manual" | "bulk" | "xlsx";
  templateVersion: string | null;
  state: PriceChangeBatchState;
  reason: string | null;
  parentBatchId: string | null;
  rowCount: number;
  appliedCount: number;
  unchangedCount: number;
  failedCount: number;
  pendingCount: number;
  haltReason: string | null;
  createdAt: string;
  updatedAt: string;
  /** Halaman rows yang diminta; counts di atas selalu menggambarkan SELURUH batch. */
  rows: PriceChangeBatchRowDto[];
  pagination: PriceChangeBatchPagination;
}

export interface PriceChangeBatchQuery {
  page?: number | string;
  limit?: number | string;
  state?: string;
}

/** Satu baris picker SKU untuk bulk UI. `basePrice`/`effectiveUnitPrice` null
 * berarti source SKU tidak valid (baris tetap dihitung di pagination supaya
 * daftar dan total konsisten). */
export interface PriceChangeCandidate {
  variantId: string;
  sku: string;
  productId: string;
  productName: string;
  variantLabel: string | null;
  /** Source Jubelio saat ini (whole Rupiah). */
  basePrice: string | null;
  /** Proyeksi `projectMarkdownPrice` terhadap source/pointer terbaru. */
  effectiveUnitPrice: string | null;
  storedTarget: string | null;
  markdownActive: boolean;
  /** `variant_price_current.version`; null bila variant belum pernah di-apply. */
  priceVersion: number | null;
}

export interface PriceChangeCandidateQuery {
  markdownStatus?: string;
  search?: string;
  page?: number | string;
  limit?: number | string;
}

export interface VariantPriceHistoryEntry {
  id: string;
  revisionNo: number;
  action: PriceChangeAction;
  targetUnitPrice: string | null;
  sourceUnitPrice: string;
  effectiveUnitPrice: string;
  previousTargetUnitPrice: string | null;
  previousEffectiveUnitPrice: string;
  markdownActive: boolean;
  previousMarkdownActive: boolean;
  batchId: string;
  actorIdentity: string;
  createdAt: string;
}

export interface VariantPriceHistoryDto {
  variantId: string;
  sku: string;
  productId: string;
  productName: string;
  current: MarkdownPriceProjection | null;
  currentVersion: number | null;
  revisions: VariantPriceHistoryEntry[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

// =========================================================
// Permission gates (viewer = history/batch reads, editor = stage/apply)
// =========================================================

function requirePriceViewer(loaded: LoadedPolicy | null): LoadedPolicy {
  if (!loaded) denied();
  if (!hasGlobalGrant(loaded, "prices", "view")) denied();
  // Price history exposes catalog money across every branch: the same
  // all-branches product visibility the spec §7.3 table requires.
  if (!hasAllBranchProductView(loaded)) denied();
  return loaded;
}

function requirePriceEditor(loaded: LoadedPolicy | null): LoadedPolicy {
  const viewer = requirePriceViewer(loaded);
  if (!hasGlobalGrant(viewer, "prices", "edit")) denied();
  return viewer;
}

// =========================================================
// Read helpers
// =========================================================

function iso(value: Date | null | undefined): string | null {
  return value ? new Date(value).toISOString() : null;
}

function dbMoney(value: string | null): string | null {
  if (value === null) return null;
  try {
    return normalizeWholeRupiah(value, "money", { allowZero: true });
  } catch {
    // A legacy/source row carrying a Rupiah fraction is surfaced as null so the
    // caller shows a review warning instead of silently rounding it.
    return null;
  }
}

function variantRowSource(value: string): string | null {
  return dbMoney(value);
}

async function readCurrentMarkdown(
  executor: Executor,
  variantId: string,
  options: { forUpdate?: boolean } = {}
): Promise<{
  pointerVersion: number;
  revisionId: string;
  targetUnitPrice: string | null;
} | null> {
  const pointerQuery = executor
    .select({
      version: variantPriceCurrent.version,
      revisionId: variantPriceCurrent.revisionId,
      targetUnitPrice: variantPriceRevisions.targetUnitPrice,
      variantId: variantPriceRevisions.variantId,
    })
    .from(variantPriceCurrent)
    .innerJoin(
      variantPriceRevisions,
      and(
        eq(variantPriceRevisions.id, variantPriceCurrent.revisionId),
        eq(variantPriceRevisions.variantId, variantPriceCurrent.variantId)
      )
    )
    .where(eq(variantPriceCurrent.variantId, variantId))
    .limit(1);
  const pointerRows = options.forUpdate
    ? await pointerQuery.for("update")
    : await pointerQuery;
  const pointer = pointerRows[0];
  if (!pointer) return null;
  return {
    pointerVersion: pointer.version,
    revisionId: pointer.revisionId,
    targetUnitPrice: dbMoney(pointer.targetUnitPrice),
  };
}

async function readVariantForPricing(
  executor: Executor,
  where: { variantId: string } | { sku: string },
  options: { forUpdate?: boolean } = {}
) {
  const query = executor
    .select({
      variantId: productVariants.id,
      sku: productVariants.sku,
      price: productVariants.price,
      color: productVariants.color,
      size: productVariants.size,
      productId: products.id,
      productName: products.name,
    })
    .from(productVariants)
    .innerJoin(products, eq(products.id, productVariants.productId))
    .where("variantId" in where ? eq(productVariants.id, where.variantId) : eq(productVariants.sku, where.sku))
    .limit(1);
  const rows = options.forUpdate ? await query.for("update") : await query;
  return rows[0] ?? null;
}

function directionOf(delta: bigint): PriceChangePreview["direction"] {
  if (delta > BigInt(0)) return "increase";
  if (delta < BigInt(0)) return "decrease";
  return "same";
}

/** 2-decimal display percent of `delta / base`; null when base is 0. */
function percentOf(delta: bigint, base: bigint): string | null {
  if (base === BigInt(0)) return null;
  const scaled = (delta * BigInt(10000)) / base; // 2 decimals, trunc toward zero
  const negative = scaled < BigInt(0);
  const abs = negative ? -scaled : scaled;
  const whole = abs / BigInt(100);
  const fraction = (abs % BigInt(100)).toString().padStart(2, "0");
  return `${negative ? "-" : ""}${whole}.${fraction}`;
}

/** Gabungan color/size apa adanya (bukan bagian dari identitas/harga). */
function variantLabelOf(
  color: string | null,
  size: string | null
): string | null {
  const parts = [color, size]
    .map((part) => (part ?? "").trim())
    .filter((part) => part.length > 0);
  return parts.length === 0 ? null : parts.join(" / ");
}

interface PreviewVariant {
  variantId: string;
  productId: string;
  productName: string;
  price: string;
  color: string | null;
  size: string | null;
}

function buildPreview(input: {
  inputSku: string;
  /** null = SKU tidak ditemukan; baris tetap di-stage dengan warning. */
  variant: PreviewVariant | null;
  action: PriceChangeRowAction;
  targetUnitPrice: string | null;
  pointer: Awaited<ReturnType<typeof readCurrentMarkdown>> | null;
  inputActionRaw?: string | null;
  inputTargetRaw?: string | null;
  errorReason?: string | null;
}): PriceChangePreview {
  const warnings: string[] = [];
  const passthrough = {
    inputActionRaw: input.inputActionRaw ?? null,
    inputTargetRaw: input.inputTargetRaw ?? null,
    errorReason: input.errorReason ?? null,
  };
  if (input.variant === null) {
    warnings.push("VARIANT_NOT_FOUND");
    return {
      inputSku: input.inputSku,
      variantId: null,
      productId: null,
      productName: null,
      variantLabel: null,
      action: input.action,
      targetUnitPrice: input.targetUnitPrice,
      ...passthrough,
      sourceUnitPrice: null,
      storedTargetBefore: null,
      effectiveUnitPriceBefore: null,
      markdownActiveBefore: false,
      markdownRevisionIdBefore: null,
      effectiveUnitPriceAfter: null,
      delta: null,
      direction: "unknown",
      percent: null,
      warnings,
    };
  }
  const variant = input.variant;
  const source = variantRowSource(variant.price);
  if (source === null) warnings.push("SOURCE_PRICE_INVALID");
  let projection: MarkdownPriceProjection | null = null;
  if (source !== null) {
    try {
      projection = projectMarkdownPrice({
        sourceUnitPrice: source,
        storedTargetUnitPrice: input.pointer?.targetUnitPrice ?? null,
        markdownRevisionId: input.pointer?.revisionId ?? null,
      });
    } catch {
      warnings.push("CURRENT_MARKDOWN_INCONSISTENT");
    }
  }
  const sourceAmount = source === null ? null : BigInt(source);
  const targetAmount = input.targetUnitPrice === null ? null : BigInt(input.targetUnitPrice);
  let effectiveAfter: bigint | null = null;
  if (sourceAmount !== null && input.action !== "invalid") {
    if (input.action === "restore_base") {
      effectiveAfter = sourceAmount;
    } else if (targetAmount !== null) {
      effectiveAfter = targetAmount < sourceAmount ? targetAmount : sourceAmount;
      if (targetAmount >= sourceAmount) warnings.push("TARGET_NOT_BELOW_SOURCE");
    }
  }
  if (input.action === "restore_base" && projection?.storedTarget === null) {
    warnings.push("MARKDOWN_ABSENT");
  }
  const effectiveBefore =
    projection === null ? null : BigInt(projection.effectiveUnitPrice);
  const delta =
    effectiveAfter === null || effectiveBefore === null
      ? null
      : effectiveAfter - effectiveBefore;
  return {
    inputSku: input.inputSku,
    variantId: variant.variantId,
    productId: variant.productId,
    productName: variant.productName,
    variantLabel: variantLabelOf(variant.color, variant.size),
    action: input.action,
    targetUnitPrice: input.targetUnitPrice,
    ...passthrough,
    sourceUnitPrice: source,
    storedTargetBefore: projection?.storedTarget ?? input.pointer?.targetUnitPrice ?? null,
    effectiveUnitPriceBefore: projection?.effectiveUnitPrice ?? null,
    markdownActiveBefore: projection?.markdownActive ?? false,
    markdownRevisionIdBefore: projection?.markdownRevisionId ?? null,
    effectiveUnitPriceAfter: effectiveAfter === null ? null : effectiveAfter.toString(),
    delta: delta === null ? null : delta.toString(),
    direction: delta === null ? "unknown" : directionOf(delta),
    percent: delta === null ? null : percentOf(delta, effectiveBefore ?? BigInt(0)),
    warnings,
  };
}

function toBatchRowDto(
  row: typeof priceChangeBatchRows.$inferSelect
): PriceChangeBatchRowDto {
  return {
    id: row.id,
    rowNumber: row.rowNumber,
    inputSku: row.inputSku,
    variantId: row.variantId,
    action: row.action as PriceChangeRowAction,
    targetUnitPrice: dbMoney(row.targetUnitPrice),
    state: row.state as PriceChangeRowState,
    resultCode: row.resultCode,
    preview: row.previewJson as PriceChangePreview,
    actual: {
      sourceUnitPrice: dbMoney(row.sourceUnitPrice),
      previousTargetUnitPrice: dbMoney(row.previousTargetUnitPrice),
      previousEffectiveUnitPrice: dbMoney(row.previousEffectiveUnitPrice),
      previousMarkdownActive: row.previousMarkdownActive,
      targetUnitPrice: dbMoney(row.targetUnitPriceAfter),
      effectiveUnitPrice: dbMoney(row.effectiveUnitPrice),
      markdownActive: row.markdownActive,
    },
    appliedRevisionId: row.appliedRevisionId,
    createdAt: iso(row.createdAt)!,
    updatedAt: iso(row.updatedAt)!,
  };
}

interface ParsedBatchQuery {
  page: number;
  limit: number;
  state: PriceChangeRowState | "all";
}

const DEFAULT_BATCH_QUERY: ParsedBatchQuery = {
  page: 1,
  limit: 25,
  state: "all",
};

function parseRowStateFilter(value: unknown): PriceChangeRowState | "all" {
  if (value === undefined || value === null || value === "") return "all";
  if (
    value === "all" ||
    value === "pending" ||
    value === "applied" ||
    value === "unchanged" ||
    value === "failed"
  ) {
    return value;
  }
  inputInvalid("state must be all, pending, applied, unchanged, or failed");
}

function parseBatchQuery(query: PriceChangeBatchQuery = {}): ParsedBatchQuery {
  return {
    page: requirePage(query.page, 1, 1_000_000),
    limit: requirePage(query.limit, DEFAULT_BATCH_QUERY.limit, MAX_PAGE_SIZE),
    state: parseRowStateFilter(query.state),
  };
}

async function readBatchDto(
  executor: Executor,
  batchId: string,
  query: ParsedBatchQuery = DEFAULT_BATCH_QUERY
): Promise<PriceChangeBatchDto | null> {
  const batches = await executor
    .select()
    .from(priceChangeBatches)
    .where(eq(priceChangeBatches.id, batchId))
    .limit(1);
  const batch = batches[0];
  if (!batch) return null;
  const where =
    query.state === "all"
      ? eq(priceChangeBatchRows.batchId, batchId)
      : and(
          eq(priceChangeBatchRows.batchId, batchId),
          eq(priceChangeBatchRows.state, query.state)
        );
  const totalRows = await executor
    .select({ count: sql<number>`count(*)::int` })
    .from(priceChangeBatchRows)
    .where(where);
  const total = Number(totalRows[0]?.count ?? 0);
  const rows = await executor
    .select()
    .from(priceChangeBatchRows)
    .where(where)
    .orderBy(asc(priceChangeBatchRows.rowNumber))
    .limit(query.limit)
    .offset((query.page - 1) * query.limit);
  return {
    id: batch.id,
    source: batch.source as PriceChangeBatchDto["source"],
    templateVersion: batch.templateVersion,
    state: batch.state as PriceChangeBatchState,
    reason: batch.reason,
    parentBatchId: batch.parentBatchId,
    rowCount: batch.rowCount,
    appliedCount: batch.appliedCount,
    unchangedCount: batch.unchangedCount,
    failedCount: batch.failedCount,
    pendingCount: batch.pendingCount,
    haltReason: batch.haltReason,
    createdAt: iso(batch.createdAt)!,
    updatedAt: iso(batch.updatedAt)!,
    rows: rows.map(toBatchRowDto),
    pagination: {
      page: query.page,
      limit: query.limit,
      total,
      totalPages: Math.ceil(total / query.limit),
    },
  };
}

// =========================================================
// Stage — 1..N row batch (manual/bulk)
// =========================================================

export interface StagePriceChangeRowInput {
  sku: string;
  action: string;
  targetUnitPrice?: string | null;
  /** Optional percent shortcut the UI used; the server freezes a fixed target. */
  discountPercent?: string | null;
}

export interface StagePriceChangeInput {
  requestKey: string;
  /** Default: `rows.length === 1 ? "manual" : "bulk"`. */
  source?: "manual" | "bulk";
  reason?: string | null;
  rows: readonly StagePriceChangeRowInput[];
}

export interface StagePriceChangeResult {
  status: 200 | 201;
  data: PriceChangeBatchDto;
}

interface NormalizedStageRow {
  sku: string;
  action: PriceChangeRowAction;
  targetUnitPrice: string | null;
  /** Percent shortcut (discount off the source); resolved to a fixed target at stage. */
  discountPercent: string | null;
  /** Workbook row number; manual/bulk derive `index + 1` instead. */
  sheetRow: number | null;
  /** Workbook `origin_row` reference (correction of a final failed row). */
  originRow: number | null;
  /** Workbook parser rejection; such a row is staged FINAL failed, never pending. */
  rejectedReason: string | null;
  actionRaw: string | null;
  targetRaw: string | null;
  inputType?: "price" | "percent" | null;
  inputTypeRaw?: string | null;
}

function normalizeStageRow(
  raw: StagePriceChangeRowInput,
  index: number
): NormalizedStageRow {
  const field = `rows[${index}]`;
  if (
    typeof raw?.sku !== "string" ||
    raw.sku.length === 0 ||
    raw.sku.length > 128
  ) {
    inputInvalid(
      `${field}.sku must be a non-empty SKU of at most 128 characters`
    );
  }
  const action = requireAction(raw.action);
  let targetUnitPrice: string | null = null;
  let discountPercent: string | null = null;
  if (action === "set_price") {
    const hasTarget =
      raw.targetUnitPrice !== undefined && raw.targetUnitPrice !== null;
    const hasPercent =
      raw.discountPercent !== undefined &&
      raw.discountPercent !== null &&
      String(raw.discountPercent).trim() !== "";
    if (hasTarget === hasPercent) {
      inputInvalid(
        `${field} set_price needs exactly one of targetUnitPrice or discountPercent`
      );
    }
    if (hasTarget) {
      targetUnitPrice = normalizeWholeRupiah(
        raw.targetUnitPrice,
        `${field}.targetUnitPrice`
      );
    } else {
      discountPercent = String(raw.discountPercent).trim();
    }
  } else if (
    (raw.targetUnitPrice !== undefined && raw.targetUnitPrice !== null) ||
    (raw.discountPercent !== undefined && raw.discountPercent !== null)
  ) {
    inputInvalid(
      `${field} restore_base must not carry targetUnitPrice or discountPercent`
    );
  }
  return {
    sku: raw.sku,
    action,
    targetUnitPrice,
    discountPercent,
    sheetRow: null,
    originRow: null,
    rejectedReason: null,
    actionRaw: null,
    targetRaw: null,
  };
}

function normalizeStageInput(input: StagePriceChangeInput): {
  requestKey: string;
  source: "manual" | "bulk";
  reason: string | null;
  rows: NormalizedStageRow[];
  fingerprint: string;
} {
  const requestKey = requireRequestKey(input.requestKey);
  const reason = requireReason(input.reason);
  if (!Array.isArray(input.rows) || input.rows.length === 0) {
    inputInvalid("rows must contain at least one row");
  }
  const rows = input.rows.map((raw, index) => normalizeStageRow(raw, index));
  const requestedSource: "manual" | "bulk" | null | undefined = input.source;
  const source: "manual" | "bulk" =
    requestedSource === undefined || requestedSource === null
      ? rows.length === 1
        ? "manual"
        : "bulk"
      : requestedSource;
  if (source !== "manual" && source !== "bulk") {
    inputInvalid("source must be manual or bulk");
  }
  if (rows.length > MAX_STAGE_ROWS_HARD_LIMIT) {
    inputInvalid(
      `a price-change batch accepts at most ${MAX_STAGE_ROWS_HARD_LIMIT} rows`
    );
  }
  const seen = new Set<string>();
  for (const row of rows) {
    // Duplicate SKU is a fatal input error, never last-row-wins.
    if (seen.has(row.sku)) {
      inputInvalid(`rows contains the SKU ${row.sku} more than once`);
    }
    seen.add(row.sku);
  }
  const fingerprint = createHash("sha256")
    .update(
      JSON.stringify({
        source,
        reason,
        rows: rows.map((row) => ({
          sku: row.sku,
          action: row.action,
          targetUnitPrice: row.targetUnitPrice,
          discountPercent: row.discountPercent,
          sheetRow: row.sheetRow,
          originRow: row.originRow,
          rejectedReason: row.rejectedReason,
        })),
      })
    )
    .digest("hex");
  return { requestKey, source, reason, rows, fingerprint };
}

/** Configured limits dibaca UNCACHED sebelum transaksi; invalid = fail closed. */
async function readImportLimits(): Promise<DiscountImportLimits> {
  try {
    return await readDiscountImportLimitsUncached();
  } catch (error) {
    if (error instanceof DiscountImportLimitError) {
      throw new PriceChangeError(
        503,
        "IMPORT_LIMITS_INVALID",
        "The configured import limits are invalid, so the operation is blocked"
      );
    }
    throw error;
  }
}

interface PreparedStageRow {
  /** Workbook row number when the row came from a workbook upload. */
  sheetRow: number | null;
  inputType: "price" | "percent" | null;
  inputTypeRaw: string | null;
  targetRaw: string | null;
  id: string;
  rowNumber: number;
  inputSku: string;
  variantId: string | null;
  action: PriceChangeRowAction;
  targetUnitPrice: string | null;
  originRow: number | null;
  /** `failed` only for rows the workbook parser already rejected (final). */
  state: "pending" | "failed";
  resultCode: string | null;
  preview: PriceChangePreview;
}

/**
 * Resolve variant + current Markdown + fixed target untuk tiap row dalam SATU
 * transaksi stage. SKU tidak ditemukan atau source invalid TIDAK menolak batch:
 * baris tetap di-stage dengan `variantId: null` + warning, dan apply yang
 * memfinalkannya `failed`.
 */
async function prepareStageRows(
  tx: Executor,
  rows: readonly NormalizedStageRow[]
): Promise<PreparedStageRow[]> {
  const lookupSkus = [...new Set(rows.map((row) => row.sku).filter((sku) => sku.length > 0))];
  const variantRows =
    lookupSkus.length === 0
      ? []
      : await tx
          .select({
            variantId: productVariants.id,
            sku: productVariants.sku,
            price: productVariants.price,
            color: productVariants.color,
            size: productVariants.size,
            productId: products.id,
            productName: products.name,
          })
          .from(productVariants)
          .innerJoin(products, eq(products.id, productVariants.productId))
          .where(inArray(productVariants.sku, lookupSkus));
  const variantBySku = new Map(
    variantRows.map((variant) => [variant.sku, variant] as const)
  );

  const variantIds = variantRows.map((variant) => variant.variantId);
  const pointerRows: Array<{
    variantId: string;
    version: number;
    revisionId: string;
    targetUnitPrice: string | null;
  }> =
    variantIds.length === 0
      ? []
      : await tx
          .select({
            variantId: variantPriceCurrent.variantId,
            version: variantPriceCurrent.version,
            revisionId: variantPriceCurrent.revisionId,
            targetUnitPrice: variantPriceRevisions.targetUnitPrice,
          })
          .from(variantPriceCurrent)
          .innerJoin(
            variantPriceRevisions,
            and(
              eq(variantPriceRevisions.id, variantPriceCurrent.revisionId),
              eq(variantPriceRevisions.variantId, variantPriceCurrent.variantId)
            )
          )
          .where(inArray(variantPriceCurrent.variantId, variantIds));
  const pointerByVariant = new Map<
    string,
    {
      pointerVersion: number;
      revisionId: string;
      targetUnitPrice: string | null;
    }
  >(
    pointerRows.map((pointer) => [
      pointer.variantId,
      {
        pointerVersion: pointer.version,
        revisionId: pointer.revisionId,
        targetUnitPrice: dbMoney(pointer.targetUnitPrice),
      },
    ])
  );

  return rows.map((row, index) => {
    const variant = row.sku.length > 0 ? (variantBySku.get(row.sku) ?? null) : null;
    const pointer = variant
      ? (pointerByVariant.get(variant.variantId) ?? null)
      : null;
    let targetUnitPrice = row.targetUnitPrice;
    let rejectedReason = row.rejectedReason;
    if (
      row.action === "set_price" &&
      targetUnitPrice === null &&
      row.discountPercent !== null && rejectedReason === null
    ) {
      // Percent shortcut: the fixed target is frozen HERE against the source
      // read in this transaction, so apply never re-derives a percentage.
      if (!variant && row.sheetRow === null) {
        inputInvalid(`rows[${index}].discountPercent needs an existing SKU because the fixed target is frozen at stage`);
      }
      if (!variant) {
        rejectedReason = "VARIANT_NOT_FOUND";
      } else {
        try {
          targetUnitPrice = computePercentTarget(variant.price, row.discountPercent);
        } catch (error) {
          if (!(error instanceof MarkdownPriceError)) throw error;
          if (row.sheetRow === null) inputInvalid(`rows[${index}].discountPercent: ${error.message}`);
          rejectedReason = error.code;
        }
      }
    }
    return {
      sheetRow: row.sheetRow,
      inputType: row.inputType ?? null,
      inputTypeRaw: row.inputTypeRaw ?? null,
      targetRaw: row.targetRaw,
      id: randomUUID(),
      rowNumber: row.sheetRow ?? index + 1,
      inputSku: row.sku,
      variantId: variant?.variantId ?? null,
      action: row.action,
      targetUnitPrice,
      originRow: row.originRow,
      state: rejectedReason === null ? ("pending" as const) : ("failed" as const),
      resultCode: rejectedReason,
      preview: {
        ...buildPreview({
          inputSku: row.sku,
          variant,
          action: row.action,
          targetUnitPrice,
          pointer,
          inputActionRaw: row.actionRaw,
          inputTargetRaw: row.targetRaw,
          errorReason: rejectedReason,
        }),
        ...(row.sheetRow === null ? {} : {
          inputType: row.inputType ?? null,
          inputTypeRaw: row.inputTypeRaw ?? null,
          inputValueRaw: row.targetRaw,
        }),
      },
    };
  });
}

/**
 * Stage 1..N Markdown rows (manual/bulk). The preview is explicitly
 * non-authoritative: apply re-reads the latest source/current Markdown. The
 * batch, every row, and every `PRICE_CHANGE_STAGED` audit are committed in ONE
 * transaction, so a request never leaves a partial batch. Same
 * `(actor, requestKey)` replays the accepted batch; a different command under a
 * used key is 409.
 */
interface StageCommand {
  requestKey: string;
  source: "manual" | "bulk" | "xlsx";
  templateVersion: string | null;
  parentBatchId: string | null;
  reason: string | null;
  fingerprint: string;
  rows: readonly NormalizedStageRow[];
}

function originInvalid(message: string): never {
  throw new PriceChangeError(400, "ORIGIN_INVALID", message);
}

/**
 * A correction batch may only link to FINAL FAILED rows of an existing parent
 * batch. Reopening a pending/applied/unchanged row (or linking a row of another
 * batch) is rejected before ANY row is written, so a linked retry can never
 * replay the 97 successful rows of the original batch.
 */
async function validateOriginRows(
  tx: Executor,
  parentBatchId: string | null,
  rows: readonly NormalizedStageRow[]
): Promise<Map<number, string>> {
  const requested = new Map<number, number>();
  for (const row of rows) {
    if (row.originRow === null) continue;
    requested.set(row.originRow, (requested.get(row.originRow) ?? 0) + 1);
  }
  if (requested.size === 0) {
    if (parentBatchId !== null) {
      const parent = await tx
        .select({ id: priceChangeBatches.id })
        .from(priceChangeBatches)
        .where(eq(priceChangeBatches.id, parentBatchId))
        .limit(1);
      if (parent.length === 0) {
        originInvalid("The parent price-change batch does not exist");
      }
    }
    return new Map();
  }
  if (parentBatchId === null) {
    originInvalid("origin_row requires the parent batch of the correction");
  }
  for (const [originRow, count] of requested) {
    if (count > 1) {
      originInvalid(`origin_row ${originRow} is referenced more than once`);
    }
  }
  const parent = await tx
    .select({ id: priceChangeBatches.id })
    .from(priceChangeBatches)
    .where(eq(priceChangeBatches.id, parentBatchId))
    .limit(1);
  if (parent.length === 0) {
    originInvalid("The parent price-change batch does not exist");
  }
  const originRows = await tx
    .select({
      id: priceChangeBatchRows.id,
      rowNumber: priceChangeBatchRows.rowNumber,
      state: priceChangeBatchRows.state,
    })
    .from(priceChangeBatchRows)
    .where(
      and(
        eq(priceChangeBatchRows.batchId, parentBatchId),
        inArray(priceChangeBatchRows.rowNumber, [...requested.keys()])
      )
    );
  if (originRows.length !== requested.size) {
    originInvalid("origin_row does not reference a row of the parent batch");
  }
  const ids = new Map<number, string>();
  for (const row of originRows) {
    if (row.state !== "failed") {
      originInvalid(
        `origin_row ${row.rowNumber} is not a final failed row; final rows are never reopened`
      );
    }
    ids.set(row.rowNumber, row.id);
  }
  return ids;
}

async function runStage(
  command: StageCommand,
  actorUserId: string
): Promise<StagePriceChangeResult> {
  try {
    return await beginBoundedTransaction(async (tx) => {
      const actor = requirePriceEditor(
        await loadActorPolicyInTransaction(tx, actorUserId)
      );

      const existing = await tx
        .select()
        .from(priceChangeBatches)
        .where(
          and(
            eq(priceChangeBatches.actorIdentity, actorUserId),
            eq(priceChangeBatches.requestKey, command.requestKey)
          )
        )
        .for("update")
        .limit(1);
      if (existing.length > 0) {
        const batch = existing[0];
        if (batch.fingerprint !== command.fingerprint) {
          throw new PriceChangeError(
            409,
            "REQUEST_KEY_CONFLICT",
            "This request key was already used with a different command"
          );
        }
        const replayed = await readBatchDto(tx, batch.id);
        if (!replayed) throw new Error("Accepted price-change batch is missing");
        return { status: 200 as const, data: replayed };
      }

      const originRowIds = await validateOriginRows(
        tx,
        command.parentBatchId,
        command.rows
      );
      const prepared = await prepareStageRows(tx, command.rows);
      const now = new Date();
      const batchId = randomUUID();
      const pendingCount = prepared.filter((row) => row.state === "pending").length;
      const failedCount = prepared.length - pendingCount;
      const state =
        pendingCount > 0
          ? ("staged" as const)
          : deriveBatchState({
              rowCount: prepared.length,
              applied: 0,
              unchanged: 0,
              failed: failedCount,
              pending: 0,
            });
      const claimed = await tx
        .insert(priceChangeBatches)
        .values({
          id: batchId,
          actorIdentity: actorUserId,
          requestKey: command.requestKey,
          fingerprint: command.fingerprint,
          source: command.source,
          templateVersion: command.templateVersion,
          parentBatchId: command.parentBatchId,
          reason: command.reason,
          state,
          rowCount: prepared.length,
          appliedCount: 0,
          unchangedCount: 0,
          failedCount,
          pendingCount,
          actorId: actorUserId,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoNothing({
          target: [priceChangeBatches.actorIdentity, priceChangeBatches.requestKey],
        })
        .returning({ id: priceChangeBatches.id });
      if (claimed.length === 0) throw new BatchClaimed();

      await tx.insert(priceChangeBatchRows).values(
        prepared.map((row) => ({
          id: row.id,
          batchId,
          rowNumber: row.rowNumber,
          inputSku: row.inputSku,
          variantId: row.variantId,
          action: row.action,
          targetUnitPrice: row.targetUnitPrice,
          previewJson: row.preview,
          state: row.state,
          resultCode: row.resultCode,
          originRetryRowId:
            row.originRow === null ? null : (originRowIds.get(row.originRow) ?? null),
          createdAt: now,
          updatedAt: now,
        }))
      );

      for (const row of prepared) {
        await writeAuditEvent(tx, {
          actorId: actorUserId,
          action: PRICE_CHANGE_AUDIT_STAGED,
          entityType: "variant_price",
          entityId: row.variantId,
          changes: {
            batchId,
            rowId: row.id,
            rowNumber: row.rowNumber,
            sku: row.inputSku,
            action: row.action,
            targetUnitPrice: row.targetUnitPrice,
            sourceUnitPrice: row.preview.sourceUnitPrice,
            storedTargetBefore: row.preview.storedTargetBefore,
            effectiveUnitPriceBefore: row.preview.effectiveUnitPriceBefore,
            effectiveUnitPriceAfter: row.preview.effectiveUnitPriceAfter,
            source: command.source,
            templateVersion: command.templateVersion,
            parentBatchId: command.parentBatchId,
            rowError: row.resultCode,
            ...(row.sheetRow === null ? {} : {
              workbookInputType: row.inputType,
              workbookInputTypeRaw: row.inputTypeRaw,
              workbookInputValueRaw: row.targetRaw,
            }),
            reason: command.reason,
          },
          policyVersion: actor.policyVersion,
          branchScope: "global",
        });
      }

      const staged = await readBatchDto(tx, batchId);
      if (!staged) throw new Error("Staged price-change batch could not be read");
      return { status: 201 as const, data: staged };
    });
  } catch (error) {
    if (error instanceof BatchClaimed) {
      return replayStaged(actorUserId, command.requestKey, command.fingerprint);
    }
    throw mapDatabaseError(error);
  }
}

/**
 * Stage 1..N Markdown rows (manual/bulk). The preview is explicitly
 * non-authoritative: apply re-reads the latest source/current Markdown. The
 * batch, every row, and every `PRICE_CHANGE_STAGED` audit are committed in ONE
 * transaction, so a request never leaves a partial batch. Same
 * `(actor, requestKey)` replays the accepted batch; a different command under a
 * used key is 409.
 */
export async function stagePriceChangeBatch(
  input: StagePriceChangeInput,
  actorUserId: string
): Promise<StagePriceChangeResult> {
  const normalized = normalizeStageInput(input);
  await requireActiveContract();
  const limits = await readImportLimits();
  if (normalized.rows.length > limits.maxRows) {
    throw new PriceChangeError(
      400,
      "ROW_LIMIT_EXCEEDED",
      `A price-change batch accepts at most ${limits.maxRows} rows (configured limit)`
    );
  }

  return runStage(
    {
      requestKey: normalized.requestKey,
      source: normalized.source,
      templateVersion: null,
      parentBatchId: null,
      reason: normalized.reason,
      fingerprint: normalized.fingerprint,
      rows: normalized.rows,
    },
    actorUserId
  );
}

/**
 * Stage ONE manual Markdown row — kept as the ticket-03 public alias so existing
 * callers and tests keep working; it is the same 1..N batch writer.
 */
export async function stageManualPriceChange(
  input: StagePriceChangeInput,
  actorUserId: string
): Promise<StagePriceChangeResult> {
  return stagePriceChangeBatch(input, actorUserId);
}

class BatchClaimed extends Error {}

async function replayStaged(
  actorUserId: string,
  requestKey: string,
  fingerprint: string
): Promise<StagePriceChangeResult> {
  const rows = await db
    .select()
    .from(priceChangeBatches)
    .where(
      and(
        eq(priceChangeBatches.actorIdentity, actorUserId),
        eq(priceChangeBatches.requestKey, requestKey)
      )
    )
    .limit(1);
  const batch = rows[0];
  if (!batch) {
    throw new PriceChangeError(
      409,
      "REQUEST_KEY_CONFLICT",
      "The request key could not be claimed"
    );
  }
  if (batch.fingerprint !== fingerprint) {
    throw new PriceChangeError(
      409,
      "REQUEST_KEY_CONFLICT",
      "This request key was already used with a different command"
    );
  }
  const dto = await readBatchDto(db, batch.id);
  if (!dto) throw new Error("Accepted price-change batch is missing");
  return { status: 200, data: dto };
}

function mapDatabaseError(error: unknown): unknown {
  if (isRetryableDatabaseError(error)) {
    return new PriceChangeError(
      503,
      "BUSY",
      "The request could not be completed in time; please retry"
    );
  }
  if (isUniqueViolation(error)) {
    return new PriceChangeError(
      409,
      "CONFLICT",
      "The record was modified concurrently"
    );
  }
  return error;
}

// =========================================================
// Detail read
// =========================================================

export async function getPriceChangeBatch(
  batchId: string,
  actorUserId: string,
  query: PriceChangeBatchQuery = {}
): Promise<PriceChangeBatchDto | null> {
  if (typeof batchId !== "string" || batchId.length === 0) return null;
  requirePriceViewer(await loadPolicy(actorUserId));
  return readBatchDto(db, batchId, parseBatchQuery(query));
}

// =========================================================
// Apply — foreground chunk, ONE transaction per row
// =========================================================
// Spec §6.4. Setiap row commit adalah transaksi bounded sendiri:
//   claim row lock → source/current Markdown terbaru → immutable revision +
//   current pointer + durable row result + audit, semuanya dalam commit itu.
// Batch TIDAK pernah jadi satu transaksi besar dan tidak ada worker background:
// response mengembalikan 202 selama masih ada row pending, dan timeout/failure
// tidak pernah mengubah row menjadi `failed` — status durable-nya dibaca ulang
// sebelum loop dilanjutkan.

export interface ApplyPriceChangeInput {
  requestKey: string;
  /** Review digest the admin approved; recorded, but price movement never
   * forces a re-review (spec §4.1). */
  previewDigest?: string | null;
}

export interface ApplyPriceChangeResult {
  status: 200 | 202;
  data: PriceChangeBatchDto;
}

interface ApplyOutcome {
  resultCode: string;
  state: PriceChangeRowState;
  revisionId: string | null;
  revisionNo: number | null;
  actual: PriceChangeActual;
}

/** Batch lock is taken AFTER the in-transaction policy re-read (spec §9.2
 * group 1 → group 2) and BEFORE the variant/pointer locks (group 4). */
async function lockBatch(
  tx: Executor,
  batchId: string
): Promise<typeof priceChangeBatches.$inferSelect> {
  const batches = await tx
    .select()
    .from(priceChangeBatches)
    .where(eq(priceChangeBatches.id, batchId))
    .for("update")
    .limit(1);
  const batch = batches[0];
  if (!batch) {
    throw new PriceChangeError(404, "NOT_FOUND", "Price-change batch not found");
  }
  return batch;
}

async function lockBatchRow(
  tx: Executor,
  batchId: string,
  rowId: string
): Promise<typeof priceChangeBatchRows.$inferSelect | null> {
  const rows = await tx
    .select()
    .from(priceChangeBatchRows)
    .where(
      and(
        eq(priceChangeBatchRows.id, rowId),
        eq(priceChangeBatchRows.batchId, batchId)
      )
    )
    .for("update")
    .limit(1);
  return rows[0] ?? null;
}

/** Non-throwing editor check, so a mid-request revoke can halt the loop instead
 * of losing the honest counts of the rows already committed. */
function isPriceEditor(loaded: LoadedPolicy | null): loaded is LoadedPolicy {
  return (
    hasGlobalGrant(loaded, "prices", "view") &&
    hasAllBranchProductView(loaded) &&
    hasGlobalGrant(loaded, "prices", "edit")
  );
}

async function applyRow(
  tx: Executor,
  input: {
    batch: typeof priceChangeBatches.$inferSelect;
    row: typeof priceChangeBatchRows.$inferSelect;
    actorUserId: string;
    policyVersion: number;
  }
): Promise<ApplyOutcome> {
  const { batch, row, actorUserId } = input;
  if (!row.variantId) {
    // SKU yang tidak ditemukan saat stage tetap di-stage (dengan warning) dan
    // difinalkan `failed` di sini, bukan ditolak seluruh batch.
    const actual: PriceChangeActual = {
      sourceUnitPrice: null,
      previousTargetUnitPrice: null,
      previousEffectiveUnitPrice: null,
      previousMarkdownActive: null,
      targetUnitPrice: null,
      effectiveUnitPrice: null,
      markdownActive: null,
    };
    return { resultCode: PRICE_CHANGE_RESULT.variantNotFound, state: "failed", revisionId: null, revisionNo: null, actual };
  }

  if (row.action !== "set_price" && row.action !== "restore_base") {
    // Defensive: an unparseable workbook row is staged already-failed and can
    // never be pending, so this branch only protects the invariant.
    return {
      resultCode: PRICE_CHANGE_RESULT.targetInvalid,
      state: "failed",
      revisionId: null,
      revisionNo: null,
      actual: {
        sourceUnitPrice: null,
        previousTargetUnitPrice: null,
        previousEffectiveUnitPrice: null,
        previousMarkdownActive: null,
        targetUnitPrice: null,
        effectiveUnitPrice: null,
        markdownActive: null,
      },
    };
  }

  // Lock order (spec §9.2 group 4): variant/source → current Markdown, sorted by
  // variant ID. Locking the variant row also serializes against a master sync.
  const variantRows = await tx
    .select({
      variantId: productVariants.id,
      sku: productVariants.sku,
      price: productVariants.price,
    })
    .from(productVariants)
    .where(eq(productVariants.id, row.variantId))
    .for("update")
    .limit(1);
  const variant = variantRows[0];
  if (!variant) {
    return {
      resultCode: PRICE_CHANGE_RESULT.targetInvalid,
      state: "failed",
      revisionId: null,
      revisionNo: null,
      actual: {
        sourceUnitPrice: null,
        previousTargetUnitPrice: null,
        previousEffectiveUnitPrice: null,
        previousMarkdownActive: null,
        targetUnitPrice: null,
        effectiveUnitPrice: null,
        markdownActive: null,
      },
    };
  }

  const source = variantRowSource(variant.price);
  const pointer = await readCurrentMarkdown(tx, variant.variantId, { forUpdate: true });
  const previousTarget = pointer?.targetUnitPrice ?? null;
  const previousProjection = source === null
    ? null
    : (() => {
        try {
          return projectMarkdownPrice({
            sourceUnitPrice: source,
            storedTargetUnitPrice: previousTarget,
            markdownRevisionId: pointer?.revisionId ?? null,
          });
        } catch {
          return null;
        }
      })();

  const actualBase: PriceChangeActual = {
    sourceUnitPrice: source,
    previousTargetUnitPrice: previousTarget,
    previousEffectiveUnitPrice: previousProjection?.effectiveUnitPrice ?? null,
    previousMarkdownActive: previousProjection?.markdownActive ?? null,
    targetUnitPrice: previousTarget,
    effectiveUnitPrice: previousProjection?.effectiveUnitPrice ?? null,
    markdownActive: previousProjection?.markdownActive ?? null,
  };

  if (source === null) {
    return {
      resultCode: PRICE_CHANGE_RESULT.sourcePriceInvalid,
      state: "failed",
      revisionId: null,
      revisionNo: null,
      actual: actualBase,
    };
  }

  let nextTarget: string | null;
  if (row.action === "set_price") {
    const target = row.targetUnitPrice === null ? null : dbMoney(row.targetUnitPrice);
    if (target === null) {
      return {
        resultCode: PRICE_CHANGE_RESULT.targetInvalid,
        state: "failed",
        revisionId: null,
        revisionNo: null,
        actual: actualBase,
      };
    }
    try {
      nextTarget = validateSetTarget(target, source);
    } catch (error) {
      if (error instanceof MarkdownPriceError) {
        return {
          resultCode: PRICE_CHANGE_RESULT.targetNotBelowSource,
          state: "failed",
          revisionId: null,
          revisionNo: null,
          actual: actualBase,
        };
      }
      throw error;
    }
    if (previousTarget === nextTarget) {
      return {
        resultCode: PRICE_CHANGE_RESULT.unchanged,
        state: "unchanged",
        revisionId: null,
        revisionNo: null,
        actual: actualBase,
      };
    }
  } else {
    if (previousTarget === null) {
      return {
        resultCode: PRICE_CHANGE_RESULT.unchanged,
        state: "unchanged",
        revisionId: null,
        revisionNo: null,
        actual: actualBase,
      };
    }
    nextTarget = null;
  }

  const revisionNoRows = await tx
    .select({
      next: sql<number>`coalesce(max(${variantPriceRevisions.revisionNo}), 0) + 1`,
    })
    .from(variantPriceRevisions)
    .where(eq(variantPriceRevisions.variantId, variant.variantId));
  const revisionNo = Number(revisionNoRows[0]?.next ?? 1);
  const revisionId = randomUUID();
  const markdownActive = nextTarget !== null;
  const effective = markdownActive ? nextTarget! : source;
  await tx.insert(variantPriceRevisions).values({
    id: revisionId,
    variantId: variant.variantId,
    revisionNo,
    action: row.action,
    targetUnitPrice: nextTarget,
    sourceUnitPrice: source,
    effectiveUnitPrice: effective,
    previousTargetUnitPrice: previousTarget,
    previousEffectiveUnitPrice: previousProjection?.effectiveUnitPrice ?? source,
    markdownActive,
    previousMarkdownActive: previousProjection?.markdownActive ?? false,
    batchId: batch.id,
    batchRowId: row.id,
    actorId: actorUserId,
    actorIdentity: actorUserId,
  });
  await tx
    .insert(variantPriceCurrent)
    .values({
      variantId: variant.variantId,
      revisionId,
      version: revisionNo,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: variantPriceCurrent.variantId,
      set: { revisionId, version: revisionNo, updatedAt: new Date() },
    });

  return {
    resultCode: PRICE_CHANGE_RESULT.applied,
    state: "applied",
    revisionId,
    revisionNo,
    actual: {
      sourceUnitPrice: source,
      previousTargetUnitPrice: previousTarget,
      previousEffectiveUnitPrice: previousProjection?.effectiveUnitPrice ?? null,
      previousMarkdownActive: previousProjection?.markdownActive ?? null,
      targetUnitPrice: nextTarget,
      effectiveUnitPrice: effective,
      markdownActive,
    },
  };
}

async function recalcBatchState(
  tx: Executor,
  batchId: string,
  fallbackRowCount: number
): Promise<void> {
  const counts = await tx
    .select({
      state: priceChangeBatchRows.state,
      count: sql<number>`count(*)::int`,
    })
    .from(priceChangeBatchRows)
    .where(eq(priceChangeBatchRows.batchId, batchId))
    .groupBy(priceChangeBatchRows.state);
  let applied = 0;
  let unchanged = 0;
  let failed = 0;
  let pending = 0;
  for (const row of counts) {
    if (row.state === "applied") applied = Number(row.count);
    else if (row.state === "unchanged") unchanged = Number(row.count);
    else if (row.state === "failed") failed = Number(row.count);
    else pending = Number(row.count);
  }
  const rowCount = applied + unchanged + failed + pending || fallbackRowCount;
  await tx
    .update(priceChangeBatches)
    .set({
      state: deriveBatchState({ rowCount, applied, unchanged, failed, pending }),
      rowCount,
      appliedCount: applied,
      unchangedCount: unchanged,
      failedCount: failed,
      pendingCount: pending,
      // A row was processed, so the acting editor is valid again: drop a stale
      // halt reason (it is re-recorded if the next row is blocked).
      haltReason: null,
      updatedAt: new Date(),
    })
    .where(eq(priceChangeBatches.id, batchId));
}

function normalizePreviewDigest(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || value.length === 0 || value.length > 128) {
    inputInvalid("previewDigest must be a short string");
  }
  return value;
}

/**
 * Record a halt reason on the batch. Ini catatan keselamatan (bukan price
 * write): ditulis pada transaksi pendek terpisah supaya sisa row yang ditahan
 * tetap dapat dijelaskan walaupun grant edit pencetus sudah dicabut. Row/counts
 * yang sudah committed tidak pernah diubah di sini.
 */
async function recordHalt(batchId: string, haltReason: string): Promise<void> {
  try {
    await beginBoundedTransaction(async (tx) => {
      await tx
        .update(priceChangeBatches)
        .set({
          haltReason,
          // Pending rows tetap pending (tidak ada rollback hasil committed).
          state: sql`case when ${priceChangeBatches.pendingCount} > 0 then 'in_progress' else ${priceChangeBatches.state} end`,
          updatedAt: new Date(),
        })
        .where(eq(priceChangeBatches.id, batchId));
    });
  } catch {
    // Jangan menutupi outcome asli: halt adalah observability best-effort.
  }
}

interface ApplyClaim {
  rowCount: number;
  policyVersion: number;
}

/**
 * Claim `(actor, requestKey)` untuk batch ini. Key sama + batch sama + digest
 * sama = resume/replay; kombinasi lain di bawah key terpakai = 409.
 */
async function claimApplyRequest(
  batchId: string,
  actorUserId: string,
  requestKey: string,
  previewDigest: string | null
): Promise<ApplyClaim> {
  return beginBoundedTransaction(async (tx) => {
    const actor = requirePriceEditor(
      await loadActorPolicyInTransaction(tx, actorUserId)
    );
    const batchRows = await tx
      .select({ id: priceChangeBatches.id, rowCount: priceChangeBatches.rowCount })
      .from(priceChangeBatches)
      .where(eq(priceChangeBatches.id, batchId))
      .limit(1);
    const batch = batchRows[0];
    if (!batch) {
      throw new PriceChangeError(404, "NOT_FOUND", "Price-change batch not found");
    }
    const claimedRows = await tx
      .insert(priceChangeApplyRequests)
      .values({
        id: randomUUID(),
        actorIdentity: actorUserId,
        requestKey,
        batchId: batch.id,
        previewDigest,
        createdAt: new Date(),
      })
      .onConflictDoNothing({
        target: [
          priceChangeApplyRequests.actorIdentity,
          priceChangeApplyRequests.requestKey,
        ],
      })
      .returning({ id: priceChangeApplyRequests.id });
    if (claimedRows.length === 0) {
      const priorRows = await tx
        .select()
        .from(priceChangeApplyRequests)
        .where(
          and(
            eq(priceChangeApplyRequests.actorIdentity, actorUserId),
            eq(priceChangeApplyRequests.requestKey, requestKey)
          )
        )
        .limit(1);
      const prior = priorRows[0];
      if (
        !prior ||
        prior.batchId !== batchId ||
        (prior.previewDigest ?? null) !== previewDigest
      ) {
        throw new PriceChangeError(
          409,
          "REQUEST_KEY_CONFLICT",
          "This apply request key was already used with a different batch or review digest"
        );
      }
    }
    return { rowCount: batch.rowCount, policyVersion: actor.policyVersion };
  });
}

/** Discovery read di luar transaksi row (spec §9.2); row tetap di-re-read di
 * bawah lock dan divalidasi ulang sebelum ada write. */
async function readNextPendingRow(
  batchId: string
): Promise<{ id: string } | null> {
  const rows = await db
    .select({ id: priceChangeBatchRows.id })
    .from(priceChangeBatchRows)
    .where(
      and(
        eq(priceChangeBatchRows.batchId, batchId),
        eq(priceChangeBatchRows.state, "pending")
      )
    )
    .orderBy(asc(priceChangeBatchRows.rowNumber))
    .limit(1);
  return rows[0] ?? null;
}

/** State row yang durable setelah kegagalan transient — timeout BUKAN rollback. */
async function readRowStateDurably(
  batchId: string,
  rowId: string
): Promise<PriceChangeRowState | null> {
  const rows = await db
    .select({ state: priceChangeBatchRows.state })
    .from(priceChangeBatchRows)
    .where(
      and(
        eq(priceChangeBatchRows.id, rowId),
        eq(priceChangeBatchRows.batchId, batchId)
      )
    )
    .limit(1);
  return (rows[0]?.state as PriceChangeRowState | undefined) ?? null;
}

type RowAttempt =
  | { kind: "processed" }
  | { kind: "skipped" }
  | { kind: "policy_revoked" };

/**
 * Apply ONE pending row dalam transaksi bounded sendiri. `skipped` berarti apply
 * lain sudah memfinalkan row tersebut (tanpa revision/audit/result kedua), dan
 * `policy_revoked` berarti tidak ada write sama sekali karena grant edit hilang.
 */
async function applyOneRow(
  batchId: string,
  rowId: string,
  actorUserId: string,
  requestKey: string,
  previewDigest: string | null,
  budget: { lockTimeoutMs: number; statementTimeoutMs: number }
): Promise<RowAttempt> {
  return beginBoundedTransaction(async (tx) => {
    const actor = await loadActorPolicyInTransaction(tx, actorUserId);
    if (!isPriceEditor(actor)) return { kind: "policy_revoked" as const };

    const batch = await lockBatch(tx, batchId);
    const row = await lockBatchRow(tx, batch.id, rowId);
    if (!row || row.state !== "pending") return { kind: "skipped" as const };

    const outcome = await applyRow(tx, {
      batch,
      row,
      actorUserId,
      policyVersion: actor.policyVersion,
    });
    await tx
      .update(priceChangeBatchRows)
      .set({
        state: outcome.state,
        resultCode: outcome.resultCode,
        previousTargetUnitPrice: outcome.actual.previousTargetUnitPrice,
        previousEffectiveUnitPrice: outcome.actual.previousEffectiveUnitPrice,
        previousMarkdownActive: outcome.actual.previousMarkdownActive,
        sourceUnitPrice: outcome.actual.sourceUnitPrice,
        targetUnitPriceAfter: outcome.actual.targetUnitPrice,
        effectiveUnitPrice: outcome.actual.effectiveUnitPrice,
        markdownActive: outcome.actual.markdownActive,
        appliedRevisionId: outcome.revisionId,
        updatedAt: new Date(),
      })
      .where(eq(priceChangeBatchRows.id, row.id));

    await writeAuditEvent(tx, {
      actorId: actorUserId,
      action:
        outcome.state === "applied"
          ? PRICE_CHANGE_AUDIT_APPLIED
          : outcome.state === "unchanged"
            ? PRICE_CHANGE_AUDIT_UNCHANGED
            : PRICE_CHANGE_AUDIT_FAILED,
      entityType: "variant_price",
      entityId: row.variantId,
      changes: {
        batchId: batch.id,
        rowId: row.id,
        revisionId: outcome.revisionId,
        revisionNo: outcome.revisionNo,
        sku: row.inputSku,
        action: row.action,
        targetRequested: dbMoney(row.targetUnitPrice),
        resultCode: outcome.resultCode,
        sourceUnitPrice: outcome.actual.sourceUnitPrice,
        previousTargetUnitPrice: outcome.actual.previousTargetUnitPrice,
        previousEffectiveUnitPrice: outcome.actual.previousEffectiveUnitPrice,
        previousMarkdownActive: outcome.actual.previousMarkdownActive,
        targetUnitPrice: outcome.actual.targetUnitPrice,
        effectiveUnitPrice: outcome.actual.effectiveUnitPrice,
        markdownActive: outcome.actual.markdownActive,
        applyRequestKey: requestKey,
        previewDigest,
      },
      policyVersion: actor.policyVersion,
      branchScope: "global",
    });

    await recalcBatchState(tx, batch.id, batch.rowCount);
    return { kind: "processed" as const };
  }, budget);
}

/**
 * Apply (atau resume) staged rows di foreground: maksimum
 * `APPLY_MAX_ROWS_PER_REQUEST` row ATAU `APPLY_BUDGET_MS`, mana yang lebih dulu,
 * dan 202 selama masih ada row pending. Tiap row punya transaksi sendiri, sehingga
 * dua apply pada batch yang sama serial lewat batch lock dan tidak pernah
 * menggandakan revision/audit/result.
 */
export async function applyPriceChangeBatch(
  batchId: string,
  input: ApplyPriceChangeInput,
  actorUserId: string
): Promise<ApplyPriceChangeResult> {
  if (typeof batchId !== "string" || batchId.length === 0) {
    inputInvalid("batchId is required");
  }
  const requestKey = requireRequestKey(input.requestKey);
  const previewDigest = normalizePreviewDigest(input.previewDigest);
  await requireActiveContract();
  const limits = await readImportLimits();

  let claim: ApplyClaim;
  try {
    claim = await claimApplyRequest(batchId, actorUserId, requestKey, previewDigest);
  } catch (error) {
    // Grant dicabut: berhenti di sini, lalu catat MENGAPA sisa row ditahan.
    if (error instanceof PriceChangeError && error.code === "DENIED") {
      await recordHalt(batchId, PRICE_CHANGE_HALT.policyRevoked);
    }
    throw mapDatabaseError(error);
  }

  // Batch yang melebihi limit row TERBARU ditahan: tidak ada row write, pending
  // tetap pending, dan row committed tidak pernah di-rollback (spec §6.2).
  if (claim.rowCount > limits.maxRows) {
    await recordHalt(batchId, PRICE_CHANGE_HALT.rowLimitExceeded);
    const held = await readBatchDto(db, batchId);
    if (!held) {
      throw new PriceChangeError(404, "NOT_FOUND", "Price-change batch not found");
    }
    return { status: held.pendingCount > 0 ? 202 : 200, data: held };
  }

  const deadline = Date.now() + APPLY_BUDGET_MS;
  let processed = 0;
  const maxIterations = APPLY_MAX_ROWS_PER_REQUEST * 4;

  for (
    let iteration = 0;
    iteration < maxIterations && processed < APPLY_MAX_ROWS_PER_REQUEST;
    iteration += 1
  ) {
    const budget = planRowBudget(remainingBudgetMs(deadline, Date.now()));
    if (!budget) break;
    const next = await readNextPendingRow(batchId);
    if (!next) break;

    let attempt: RowAttempt | null = null;
    try {
      attempt = await applyOneRow(
        batchId,
        next.id,
        actorUserId,
        requestKey,
        previewDigest,
        budget
      );
    } catch (error) {
      if (!isRetryableDatabaseError(error)) throw mapDatabaseError(error);
      // Statement/lock/serialization timeout: jangan anggap rollback. Baca state
      // durable; row yang masih pending dikembalikan jujur sebagai pending.
      const durable = await readRowStateDurably(batchId, next.id);
      if (!durable) break;
      if (durable === "pending") break;
      processed += 1;
      continue;
    }
    if (attempt === null) break;

    if (attempt.kind === "policy_revoked") {
      await recordHalt(batchId, PRICE_CHANGE_HALT.policyRevoked);
      break;
    }
    if (attempt.kind === "skipped") continue;
    processed += 1;
  }

  const dto = await readBatchDto(db, batchId);
  if (!dto) {
    throw new PriceChangeError(404, "NOT_FOUND", "Price-change batch not found");
  }
  return { status: dto.pendingCount > 0 ? 202 : 200, data: dto };
}

// =========================================================
// Immutable history read
// =========================================================

export async function getVariantPriceHistory(
  variantId: string,
  query: { page?: number | string; limit?: number | string },
  actorUserId: string
): Promise<VariantPriceHistoryDto | null> {
  if (typeof variantId !== "string" || variantId.length === 0) return null;
  requirePriceViewer(await loadPolicy(actorUserId));
  const page = requirePage(query.page, 1, 1_000_000);
  const limit = requirePage(query.limit, 25, MAX_PAGE_SIZE);

  const variant = await readVariantForPricing(db, { variantId });
  if (!variant) return null;
  const pointer = await readCurrentMarkdown(db, variantId);
  const source = variantRowSource(variant.price);
  let projection: MarkdownPriceProjection | null = null;
  if (source !== null) {
    try {
      projection = projectMarkdownPrice({
        sourceUnitPrice: source,
        storedTargetUnitPrice: pointer?.targetUnitPrice ?? null,
        markdownRevisionId: pointer?.revisionId ?? null,
      });
    } catch {
      projection = null;
    }
  }

  const totalRows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(variantPriceRevisions)
    .where(eq(variantPriceRevisions.variantId, variantId));
  const total = Number(totalRows[0]?.count ?? 0);
  const revisions = await db
    .select()
    .from(variantPriceRevisions)
    .where(eq(variantPriceRevisions.variantId, variantId))
    .orderBy(desc(variantPriceRevisions.revisionNo))
    .limit(limit)
    .offset((page - 1) * limit);

  return {
    variantId,
    sku: variant.sku,
    productId: variant.productId,
    productName: variant.productName,
    current: projection,
    currentVersion: pointer?.pointerVersion ?? null,
    revisions: revisions.map((revision) => ({
      id: revision.id,
      revisionNo: revision.revisionNo,
      action: revision.action as PriceChangeAction,
      targetUnitPrice: dbMoney(revision.targetUnitPrice),
      sourceUnitPrice: dbMoney(revision.sourceUnitPrice)!,
      effectiveUnitPrice: dbMoney(revision.effectiveUnitPrice)!,
      previousTargetUnitPrice: dbMoney(revision.previousTargetUnitPrice),
      previousEffectiveUnitPrice: dbMoney(revision.previousEffectiveUnitPrice)!,
      markdownActive: revision.markdownActive,
      previousMarkdownActive: revision.previousMarkdownActive,
      batchId: revision.batchId,
      actorIdentity: revision.actorIdentity,
      createdAt: iso(revision.createdAt)!,
    })),
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
}

// =========================================================
// SKU candidates for the bulk picker
// =========================================================

function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

function normalizeSearch(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") inputInvalid("search must be a string");
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length > MAX_SEARCH_LENGTH) {
    inputInvalid(`search must not exceed ${MAX_SEARCH_LENGTH} characters`);
  }
  return trimmed;
}

/**
 * SKU picker untuk bulk UI: search case-insensitive pada SKU dan nama produk,
 * urut `sku asc` supaya pagination stabil. Proyeksi memakai
 * `projectMarkdownPrice` yang sama (bukan rumus duplikat). Baris dengan source
 * tidak valid tetap dikembalikan dengan base/effective `null` dan tetap dihitung
 * di pagination, supaya daftar dan total tidak pernah tidak konsisten.
 */
export async function listPriceChangeCandidates(
  query: PriceChangeCandidateQuery,
  actorUserId: string
): Promise<{
  rows: PriceChangeCandidate[];
  pagination: PriceChangeBatchPagination;
}> {
  requirePriceViewer(await loadPolicy(actorUserId));
  const page = requirePage(query.page, 1, 1_000_000);
  const limit = requirePage(query.limit, 25, MAX_PAGE_SIZE);
  const search = normalizeSearch(query.search);
  if (
    query.markdownStatus !== undefined &&
    !["inactive", "configured", "unconfigured"].includes(query.markdownStatus)
  ) {
    inputInvalid("markdownStatus must be inactive, configured, or unconfigured when provided");
  }
  const searchFilter =
    search === null
      ? undefined
      : or(
          ilike(productVariants.sku, `%${escapeLikePattern(search)}%`),
          ilike(products.name, `%${escapeLikePattern(search)}%`)
        );

  // Same predicate and joins for rows/count: status filters cover the entire
  // catalogue, not only the current page. Setup is based on the current target,
  // not historical revisions or whether the markdown is active today.
  // Match the whole-Rupiah source reader
  // (zero is valid; legacy fractional/negative/oversized sources are not).
  const candidateFilter = and(
    searchFilter,
    query.markdownStatus === "inactive"
      ? sql`${variantPriceRevisions.targetUnitPrice} > 0
          AND ${productVariants.price} >= 0
          AND ${productVariants.price} <= ${MAX_MONEY_RUPIAH.toString()}::numeric
          AND ${productVariants.price} = trunc(${productVariants.price})
          AND ${productVariants.price} <= ${variantPriceRevisions.targetUnitPrice}`
      : query.markdownStatus === "configured"
        ? sql`${variantPriceRevisions.targetUnitPrice} IS NOT NULL`
        : query.markdownStatus === "unconfigured"
          ? sql`${variantPriceRevisions.targetUnitPrice} IS NULL`
          : undefined
  );
  const totalRows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(productVariants)
    .innerJoin(products, eq(products.id, productVariants.productId))
    .leftJoin(variantPriceCurrent, eq(variantPriceCurrent.variantId, productVariants.id))
    .leftJoin(variantPriceRevisions, and(
      eq(variantPriceRevisions.id, variantPriceCurrent.revisionId),
      eq(variantPriceRevisions.variantId, variantPriceCurrent.variantId)
    ))
    .where(candidateFilter);
  const total = Number(totalRows[0]?.count ?? 0);

  const rows = await db
    .select({
      variantId: productVariants.id,
      sku: productVariants.sku,
      price: productVariants.price,
      color: productVariants.color,
      size: productVariants.size,
      productId: products.id,
      productName: products.name,
      revisionId: variantPriceCurrent.revisionId,
      version: variantPriceCurrent.version,
      revisionTarget: variantPriceRevisions.targetUnitPrice,
    })
    .from(productVariants)
    .innerJoin(products, eq(products.id, productVariants.productId))
    .leftJoin(
      variantPriceCurrent,
      eq(variantPriceCurrent.variantId, productVariants.id)
    )
    .leftJoin(
      variantPriceRevisions,
      and(
        eq(variantPriceRevisions.id, variantPriceCurrent.revisionId),
        eq(variantPriceRevisions.variantId, variantPriceCurrent.variantId)
      )
    )
    .where(candidateFilter)
    .orderBy(asc(productVariants.sku))
    .limit(limit)
    .offset((page - 1) * limit);

  return {
    rows: rows.map((row) => {
      const source = variantRowSource(row.price);
      const pointerTarget = dbMoney(row.revisionTarget ?? null);
      const revisionId = row.revisionId ?? null;
      let storedTarget: string | null = pointerTarget;
      let markdownActive = false;
      let effectiveUnitPrice: string | null = source;
      if (source !== null && pointerTarget !== null && revisionId !== null) {
        try {
          const projection = projectMarkdownPrice({
            sourceUnitPrice: source,
            storedTargetUnitPrice: pointerTarget,
            markdownRevisionId: revisionId,
          });
          storedTarget = projection.storedTarget;
          markdownActive = projection.markdownActive;
          effectiveUnitPrice = projection.effectiveUnitPrice;
        } catch {
          // Pointer tidak konsisten: tampilkan source saja, tanpa badge Markdown.
          storedTarget = null;
          markdownActive = false;
          effectiveUnitPrice = source;
        }
      }
      return {
        variantId: row.variantId,
        sku: row.sku,
        productId: row.productId,
        productName: row.productName,
        variantLabel: variantLabelOf(row.color, row.size),
        basePrice: source,
        effectiveUnitPrice,
        storedTarget,
        markdownActive,
        priceVersion: row.version ?? null,
      };
    }),
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
}


// =========================================================
// Workbook upload → staged batch (xlsx)
// =========================================================
// Spec §6.2–§6.4. The workbook is parsed and validated in memory BEFORE any
// transaction exists, so a fatal container/marker/header/bounds problem rejects
// the FILE without a batch or any price write. Structurally valid files may
// still contain bad ROWS: those are staged as final `failed` rows (with their
// row number + reason) so the admin can download the report/subset and upload a
// corrected batch linked to the failed rows. The workbook bytes are never
// archived; the request scope owns them and they are released when it ends.

export interface StageWorkbookInput {
  requestKey: string;
  file: Uint8Array | ArrayBuffer | Buffer;
  reason?: string | null;
  /** Parent batch for a correction; required when the sheet carries origin_row. */
  parentBatchId?: string | null;
}

/** Limits used by the HTTP layer to bound the upload BEFORE buffering it. */
export async function readWorkbookUploadLimits(): Promise<WorkbookLimits> {
  return readImportLimits();
}

function normalizeParentBatchId(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    inputInvalid("parentBatchId must be a UUID");
  }
  return value;
}

function workbookRowToStageRow(row: ParsedWorkbookRow): NormalizedStageRow {
  return {
    sku: row.inputSku,
    // An unparseable action is stored as `invalid` and never as an executable
    // `set_price`/`restore_base`, even when a price cell was present.
    action: row.action,
    targetUnitPrice: row.action === "invalid" ? null : row.targetUnitPrice,
    discountPercent: row.discountPercent,
    inputType: row.inputType,
    inputTypeRaw: row.inputTypeRaw,
    sheetRow: row.rowNumber,
    originRow: row.originRow,
    rejectedReason: row.error,
    actionRaw: row.actionRaw,
    targetRaw: row.targetRaw,
  };
}

/**
 * Parse a versioned workbook and stage it. Fatal workbook problems are a 400
 * `WORKBOOK_REJECTED` (with the machine reason) and never create a batch.
 */
export async function stageWorkbookPriceChange(
  input: StageWorkbookInput,
  actorUserId: string
): Promise<StagePriceChangeResult> {
  const requestKey = requireRequestKey(input.requestKey);
  const reason = requireReason(input.reason);
  const parentBatchId = normalizeParentBatchId(input.parentBatchId);
  await requireActiveContract();
  const limits = await readImportLimits();

  let parsed;
  try {
    parsed = parsePriceWorkbook(input.file, limits);
  } catch (error) {
    if (error instanceof WorkbookFatalError) {
      throw new PriceChangeError(400, "WORKBOOK_REJECTED", error.message, {
        reason: error.reason,
      });
    }
    throw error;
  }

  if (parsed.rows.length === 0) {
    throw new PriceChangeError(
      400,
      "INPUT_INVALID",
      "The workbook contains no data rows"
    );
  }
  if (parsed.rows.length > MAX_STAGE_ROWS_HARD_LIMIT) {
    throw new PriceChangeError(
      400,
      "ROW_LIMIT_EXCEEDED",
      `A price-change batch accepts at most ${MAX_STAGE_ROWS_HARD_LIMIT} rows`
    );
  }

  const rows = parsed.rows.map(workbookRowToStageRow);
  const fingerprint = createHash("sha256")
    .update(
      JSON.stringify({
        source: "xlsx",
        templateVersion: parsed.templateVersion,
        parentBatchId,
        reason,
        rows: rows.map((row) => ({
          sku: row.sku,
          action: row.action,
          actionRaw: row.actionRaw,
          targetUnitPrice: row.targetUnitPrice,
          targetRaw: row.targetRaw,
          inputType: row.inputType,
          inputTypeRaw: row.inputTypeRaw,
          discountPercent: row.discountPercent,
          sheetRow: row.sheetRow,
          originRow: row.originRow,
          rejectedReason: row.rejectedReason,
        })),
      })
    )
    .digest("hex");

  try {
    const result = await runStage(
      {
        requestKey,
        source: "xlsx",
        templateVersion: parsed.templateVersion,
        parentBatchId,
        reason,
        fingerprint,
        rows,
      },
      actorUserId
    );
    workbookLog.info(`Workbook batch ${result.data.id}: ${result.data.rowCount} baris di-stage, ${result.data.failedCount} gagal, ${result.data.pendingCount} pending`);
    return result;
  } catch (error) {
    workbookLog.error(`Staging workbook gagal (${rows.length} baris)`, {
      name: error instanceof Error ? error.name : "Error",
      message: "Workbook staging failed",
      code: error instanceof PriceChangeError ? error.code : "UNEXPECTED_ERROR",
    });
    throw error;
  }
}

// =========================================================
// Template, export, and report/failed-subset workbooks
// =========================================================

/** Blank versioned template; viewer grants are checked per current policy. */
export async function getPriceChangeTemplate(
  actorUserId: string
): Promise<Uint8Array> {
  requirePriceViewer(await loadPolicy(actorUserId));
  return writePriceTemplate();
}

export interface ExportPriceChangeInput {
  variantIds: readonly string[];
}

export interface PriceWorkbookFile {
  filename: string;
  bytes: Uint8Array;
}

function normalizeVariantIds(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    inputInvalid("variantIds must contain at least one variant");
  }
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const raw of value) {
    if (typeof raw !== "string" || raw.length === 0 || raw.length > 128) {
      inputInvalid("variantIds contains an invalid variant id");
    }
    if (seen.has(raw)) continue;
    seen.add(raw);
    ids.push(raw);
  }
  if (ids.length > MAX_STAGE_ROWS_HARD_LIMIT) {
    inputInvalid(
      `variantIds accepts at most ${MAX_STAGE_ROWS_HARD_LIMIT} variants`
    );
  }
  return ids;
}

/**
 * Export the CURRENT server data for the selected variants (never browser
 * values). Reference columns are advisory; `new_price` is prefilled with the
 * current effective price and `action` with `set_price`, so a re-upload is an
 * explicit no-op until the admin edits it.
 */
export async function exportPriceChangeWorkbook(
  input: ExportPriceChangeInput,
  actorUserId: string
): Promise<PriceWorkbookFile> {
  requirePriceViewer(await loadPolicy(actorUserId));
  const limits = await readImportLimits();
  const requested = normalizeVariantIds(input.variantIds);
  if (requested.length > limits.maxRows) {
    throw new PriceChangeError(
      400,
      "ROW_LIMIT_EXCEEDED",
      `An export accepts at most ${limits.maxRows} variants (configured limit)`
    );
  }

  const rows = await db
    .select({
      variantId: productVariants.id,
      sku: productVariants.sku,
      price: productVariants.price,
      color: productVariants.color,
      size: productVariants.size,
      productId: products.id,
      productName: products.name,
      revisionId: variantPriceCurrent.revisionId,
      revisionTarget: variantPriceRevisions.targetUnitPrice,
    })
    .from(productVariants)
    .innerJoin(products, eq(products.id, productVariants.productId))
    .leftJoin(
      variantPriceCurrent,
      eq(variantPriceCurrent.variantId, productVariants.id)
    )
    .leftJoin(
      variantPriceRevisions,
      and(
        eq(variantPriceRevisions.id, variantPriceCurrent.revisionId),
        eq(variantPriceRevisions.variantId, variantPriceCurrent.variantId)
      )
    )
    .where(inArray(productVariants.id, requested))
    .orderBy(asc(productVariants.sku));
  if (rows.length !== requested.length) {
    inputInvalid("variantIds contains a variant that does not exist");
  }

  const workbookRows = rows.map((row) => {
    const source = variantRowSource(row.price);
    const pointerTarget = dbMoney(row.revisionTarget ?? null);
    let effective: string | null = source;
    if (source !== null && pointerTarget !== null && row.revisionId) {
      try {
        const projection = projectMarkdownPrice({
          sourceUnitPrice: source,
          storedTargetUnitPrice: pointerTarget,
          markdownRevisionId: row.revisionId,
        });
        effective = projection.effectiveUnitPrice;
      } catch {
        effective = source;
      }
    }
    return {
      rowNumber: null,
      sku: row.sku,
      action: "set_price",
      newPrice: effective,
      productName: row.productName,
      variantLabel: variantLabelOf(row.color, row.size),
      sourcePrice: source,
      effectivePrice: effective,
      originRow: null,
      status: null,
      errorReason: source === null ? "SOURCE_PRICE_INVALID" : null,
    };
  });

  return {
    filename: "harga-export.xlsx",
    bytes: writePriceWorkbook(workbookRows, { withReferences: true }),
  };
}

export type PriceChangeReportSubset = "all" | "failed";

function normalizeReportSubset(value: unknown): PriceChangeReportSubset {
  if (value === undefined || value === null || value === "" || value === "all") {
    return "all";
  }
  if (value === "failed") return "failed";
  inputInvalid("subset must be all or failed");
}

/** Hard bound for a report read: no stage can ever exceed this row count. */
const REPORT_MAX_ROWS = MAX_STAGE_ROWS_HARD_LIMIT;

/**
 * Report/failed-subset workbook from DURABLE batch row records (never from an
 * archived upload). Text is written as literal inline strings, so a SKU or
 * reason beginning with `=`/`+`/`-`/`@` can never become a formula.
 */
export async function getPriceChangeReport(
  batchId: string,
  subset: unknown,
  actorUserId: string
): Promise<PriceWorkbookFile | null> {
  if (typeof batchId !== "string" || batchId.length === 0) return null;
  requirePriceViewer(await loadPolicy(actorUserId));
  const normalizedSubset = normalizeReportSubset(subset);

  const batches = await db
    .select()
    .from(priceChangeBatches)
    .where(eq(priceChangeBatches.id, batchId))
    .limit(1);
  const batch = batches[0];
  if (!batch) return null;
  if (batch.rowCount > REPORT_MAX_ROWS) {
    throw new PriceChangeError(
      409,
      "REPORT_TOO_LARGE",
      "This batch is larger than the supported report bound"
    );
  }

  const where =
    normalizedSubset === "failed"
      ? and(
          eq(priceChangeBatchRows.batchId, batchId),
          eq(priceChangeBatchRows.state, "failed")
        )
      : eq(priceChangeBatchRows.batchId, batchId);
  const rows = await db
    .select()
    .from(priceChangeBatchRows)
    .where(where)
    .orderBy(asc(priceChangeBatchRows.rowNumber))
    .limit(REPORT_MAX_ROWS);

  const originIds = [
    ...new Set(
      rows
        .map((row) => row.originRetryRowId)
        .filter((id): id is string => typeof id === "string")
    ),
  ];
  const originRows =
    originIds.length === 0
      ? []
      : await db
          .select({
            id: priceChangeBatchRows.id,
            rowNumber: priceChangeBatchRows.rowNumber,
          })
          .from(priceChangeBatchRows)
          .where(inArray(priceChangeBatchRows.id, originIds));
  const originNumberById = new Map(
    originRows.map((row) => [row.id, row.rowNumber] as const)
  );

  const workbookRows = rows.map((row) => {
    const preview = row.previewJson as PriceChangePreview;
    const requestedTarget = dbMoney(row.targetUnitPrice);
    return {
      rowNumber: row.rowNumber,
      sku: row.inputSku,
      action:
        row.action === "invalid"
          ? (preview.inputActionRaw ?? "invalid")
          : row.action,
      // The report names the REQUESTED target; raw workbook text is used when
      // the row never produced a usable integer.
      inputType: preview.inputTypeRaw !== undefined ? (preview.inputTypeRaw ?? "") : (preview.inputType ?? (row.action === "restore_base" ? "" : "price")),
      newPrice: preview.inputValueRaw ?? requestedTarget ?? preview.inputTargetRaw ?? null,
      productName: preview.productName,
      variantLabel: preview.variantLabel,
      sourcePrice: dbMoney(row.sourceUnitPrice) ?? preview.sourceUnitPrice,
      effectivePrice:
        dbMoney(row.effectiveUnitPrice) ?? preview.effectiveUnitPriceAfter,
      // The FAILED SUBSET is the retry input: each row points at ITSELF so the
      // corrected upload can link back to this final failed row. A full report
      // shows the existing link (if the row is itself a correction).
      originRow: row.originRetryRowId
        ? (originNumberById.get(row.originRetryRowId) ?? null)
        : normalizedSubset === "failed"
          ? row.rowNumber
          : null,
      status: row.state,
      errorReason: row.resultCode ?? preview.errorReason ?? null,
    };
  });

  return {
    filename:
      normalizedSubset === "failed"
        ? `harga-${batchId}-gagal.xlsx`
        : `harga-${batchId}-laporan.xlsx`,
    bytes: writePriceWorkbook(workbookRows, { withReferences: true }),
  };
}
