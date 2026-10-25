import { createHash, randomUUID } from "crypto";
import { and, asc, desc, eq, sql } from "drizzle-orm";

import { db } from "@/db";
import {
  discountAdminRequests,
  discountBenefits,
  discountCodes,
  discountOfferRevisions,
  discountOffers,
  discountOfferUsage,
  systemConfig,
} from "@/db";
import {
  canonicalizePromoCode,
  maskPromoCode,
} from "@marketplace/db/src/discount-code";
import {
  MAX_MONEY_RUPIAH,
  buildPricingSnapshot,
  type PricingSnapshot,
} from "@marketplace/db/src/versioned-pricing";
import {
  evaluatePricing,
  offerBenefitAmount,
  parseOfferBenefit,
  tryParseOfferBenefit,
  type OfferBenefitInput,
  type ParsedOfferBenefit,
} from "@marketplace/db/src/discount-pricing";
import { loadPolicy, type LoadedPolicy } from "./rbac/resolver";
import {
  beginBoundedTransaction,
  hasGlobalGrant,
  loadActorPolicyInTransaction,
  type Executor,
} from "./admin-command";
import { writeAuditEvent } from "./rbac/audit-writer";
import {
  detectOfferUsageDrift,
  readMaxClientCommitment,
  wholeRupiah,
} from "./discount-usage-drift";

// =========================================================
// Discount administration — public fixed Offer lifecycle
// =========================================================
// This module is the ONE place that writes the discount administration
// records. The thin HTTP adapters below call these functions and never touch
// the tables. Scope of ticket 06 (spec §7.1–§7.3, §8.1–§8.4, §9.2):
//
//   createPublicDraftOffer() — request-key-idempotent draft creation
//   saveDiscountOfferDraft() — edit ONE unpublished draft (never live terms)
//   reviewDiscountOffer()    — server-bound diff + publish fingerprint
//   publishDiscountOffer()   — atomic pointer move + benefit + audit + receipt
//   simulateDiscountOffer()  — admin pricing preview (no hold/quote promise)
//   setDiscountOfferState()  — enable/pause/archive without usage reset
//   setDiscountOfferPolicy() — quota/budget/per-account capacity with grants
//   getDiscountOfferDetail() — safe read (no customer code, no provider call)
//   listDiscountOffers()     — safe paginated list
// Usage/entry/history ops reads live in ./discount-operations-read.ts (ticket 12);
// they are deliberately separate so capacity-authority arithmetic and the
// Orders-scoped entry projection have their own seam.
//
// NOT in this slice: customer redemption/reservation (07/12), manual codes
// (09), percentage/shipping benefits (10/11), and any provider call.
//
// Trust rules:
//   - the app resolves the Current Policy itself (never from the browser);
//   - the domain writer gate `discounts.contractVersion` is read UNCACHED and
//     must be 1 (default 0 keeps every operational environment inactive);
//   - authorization is re-read INSIDE the transaction after SHARE locks on the
//     acting Admin User then its Role, so a concurrent revoke serializes
//     against this write (spec §7.3 enforcement race);
//   - receipts are keyed by `(actor_identity, request_key)` with an immutable
//     actor identity, so replay returns the stored result and a changed
//     command under the same key is a conflict — never a second mutation;
//   - receipt + domain rows + audit commit together, and no HTTP/provider call
//     happens inside a transaction.

export const DISCOUNTS_CONTRACT_CONFIG_KEY = "discounts.contractVersion";
export const SUPPORTED_CONTRACT_VERSION = 1;
export const OFFER_SCHEMA_VERSION = 1;
export const OFFER_ENGINE_VERSION = 1;
export const DEFAULT_PER_CLIENT_LIMIT = 1;
export const PPN_CONFIG_KEY = "tax.ppnRatePercent";
export const FALLBACK_PPN_RATE_PERCENT = "11";

export const CREATE_DRAFT_ACTION = "create_draft";
export const PUBLISH_ACTION = "publish_offer";
export const STATE_ACTION = "change_state";
export const POLICY_ACTION = "change_policy";
export const ADD_CODE_ACTION = "add_code";
export const CODE_STATE_ACTION = "change_code_state";

export const CREATE_DRAFT_AUDIT_ACTION = "DISCOUNT_OFFER_DRAFT_CREATED";
export const SAVE_DRAFT_AUDIT_ACTION = "DISCOUNT_OFFER_DRAFT_SAVED";
export const PUBLISH_AUDIT_ACTION = "DISCOUNT_OFFER_PUBLISHED";
export const STATE_AUDIT_ACTION = "DISCOUNT_OFFER_STATE_CHANGED";
export const POLICY_AUDIT_ACTION = "DISCOUNT_OFFER_POLICY_CHANGED";
export const ADD_CODE_AUDIT_ACTION = "DISCOUNT_CODE_ADDED";
export const CODE_STATE_AUDIT_ACTION = "DISCOUNT_CODE_STATE_CHANGED";

/** Safety ceiling for one list page; callers cannot request an unbounded scan. */
const MAX_PAGE_SIZE = 50;

const UUID_PATTERN =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
/** ISO-8601 with an explicit offset (the admin UI sends WIB `+07:00`). An
 * instant without an offset is ambiguous, so it is refused instead of being
 * interpreted with the server's local timezone. */
const ISO_WITH_OFFSET =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/;

export class DiscountAdministrationError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string
  ) {
    super(message);
  }
}

/** Transport-agnostic descriptor for a stable error response (no NextResponse
 * coupling in this module — the thin HTTP adapters build the envelope). */
export interface DiscountErrorDescriptor {
  status: number;
  code: string;
  message: string;
}

export function describeDiscountAdministrationError(
  error: unknown
): DiscountErrorDescriptor | null {
  if (error instanceof DiscountAdministrationError) {
    return { status: error.status, code: error.code, message: error.message };
  }
  return null;
}

function inputInvalid(message: string): DiscountAdministrationError {
  // Spec §5.4 has exactly one stable code for shape/limits (`INPUT_INVALID`);
  // the message carries which field was refused. Do not invent per-field codes:
  // the browser must not read a domain decision into an input error.
  return new DiscountAdministrationError(400, "INPUT_INVALID", message);
}


// =========================================================
// Domain writer gate
// =========================================================

/**
 * Read `discounts.contractVersion` UNCACHED so an operator change applies to
 * the next request. Missing is legacy 0 (inactive); a malformed value never
 * silently becomes legacy — it fails closed.
 */
export async function readDiscountsContractVersion(): Promise<number> {
  const rows = await db
    .select({ value: systemConfig.value })
    .from(systemConfig)
    .where(eq(systemConfig.key, DISCOUNTS_CONTRACT_CONFIG_KEY))
    .limit(1);
  const value = rows[0]?.value;
  if (value === undefined || value === "0") return 0;
  if (value === "1") return 1;
  throw new DiscountAdministrationError(
    503,
    "DISCOUNTS_CONTRACT_UNSUPPORTED",
    "The discounts contract version is not supported by this deployment"
  );
}

async function requireActiveContract(): Promise<number> {
  const version = await readDiscountsContractVersion();
  if (version !== SUPPORTED_CONTRACT_VERSION) {
    throw new DiscountAdministrationError(
      503,
      "DISCOUNTS_INACTIVE",
      "Discount administration is not active on this deployment"
    );
  }
  return version;
}

// =========================================================
// Money / instant / identifier parsing
// =========================================================

/** Canonical whole-Rupiah decimal string, bounded by the store money bound. */
export function parseWholeRupiah(
  value: unknown,
  field: string,
  options: { allowZero?: boolean } = {}
): string {
  const allowZero = options.allowZero ?? true;
  const text =
    typeof value === "string"
      ? value.trim()
      : typeof value === "number" && Number.isFinite(value)
        ? String(value)
        : "";
  if (!/^\d+$/.test(text)) {
    throw inputInvalid(`${field} must be a whole Rupiah amount`);
  }
  const amount = BigInt(text);
  if (!allowZero && amount === BigInt(0)) {
    throw inputInvalid(`${field} must be greater than zero`);
  }
  if (amount > MAX_MONEY_RUPIAH) {
    throw inputInvalid(`${field} exceeds the supported money bound`);
  }
  return amount.toString();
}

/** Optional ISO-8601 instant with an explicit offset; null stays null. */
export function parseOptionalInstant(
  value: unknown,
  field: string
): Date | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string" || !ISO_WITH_OFFSET.test(value.trim())) {
    throw inputInvalid(
      `${field} must be an ISO-8601 timestamp with an explicit UTC offset`
    );
  }
  const instant = new Date(value.trim());
  if (Number.isNaN(instant.getTime())) {
    throw inputInvalid(`${field} is not a valid timestamp`);
  }
  return instant;
}

function requirePositiveInteger(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw inputInvalid(`${field} must be a positive integer`);
  }
  if (value > 2147483647) {
    throw inputInvalid(`${field} exceeds the supported count bound`);
  }
  return value;
}

function requirePageInteger(value: unknown, field: string, max: number): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > max) {
    throw inputInvalid(`${field} must be an integer between 1 and ${max}`);
  }
  return value;
}

function requireId(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length < 1 || value.length > 128) {
    throw inputInvalid(`${field} must be a non-empty identifier up to 128 characters`);
  }
  return value;
}

// =========================================================
// Canonical command fingerprints
// =========================================================

/**
 * Canonical SHA-256 fingerprint of the validated create command. The field
 * list is explicit (stable key order) and contains ONLY user intent: no
 * request id, no headers/cookies, no timestamps, no transport metadata. Two
 * requests with the same validated command therefore replay; anything else
 * conflicts.
 */
export function publicDraftCommandFingerprint(input?: {
  activationKind?: string;
  canonicalCodes?: readonly string[];
}): string {
  const canonical = JSON.stringify({
    action: CREATE_DRAFT_ACTION,
    activationKind: input?.activationKind ?? "public",
    // Hanya canonical code yang sudah tervalidasi; literal mentah tidak pernah
    // masuk fingerprint/receipt/log.
    codes: [...(input?.canonicalCodes ?? [])],
  });
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

export interface CapacitySnapshot {
  quotaCount: number | null;
  budgetAmount: string | null;
  perClientLimit: number;
}

export interface RevisionTerms {
  name: string;
  currency: "IDR";
  minSubtotal: string;
  startAt: string | null;
  endAt: string | null;
  benefit: NormalizedBenefitTerms;
}

/** Benefit tersimpan dalam bentuk exact yang dipakai publish fingerprint, DTO,
 * dan evaluasi pricing. Rate sudah dinormalisasi (tanpa nol ekor) dan cap NULL
 * berarti tanpa cap. */
export type NormalizedBenefitTerms =
  | { kind: "fixed_goods"; paramsVersion: 1; fixedAmount: string }
  | {
      kind: "percentage_goods";
      paramsVersion: 1;
      rate: string;
      capAmount: string | null;
    }
  | { kind: "shipping"; paramsVersion: 1; capAmount: string };

/**
 * Fingerprint bound to everything a publish decision depended on: the Offer
 * versions, the live pointer, the exact draft terms/benefit, the capacity and
 * the state the publication would produce. `publishDiscountOffer` recomputes
 * this from locked rows and refuses a mismatch, so a browser cannot publish a
 * draft whose terms changed after review.
 */
export function publishReviewFingerprint(input: {
  offerId: string;
  offerVersion: number;
  draftVersion: number;
  policyVersion: number;
  liveRevisionId: string | null;
  draftRevisionId: string;
  stateAfter: string;
  terms: RevisionTerms;
  capacity: CapacitySnapshot;
  /**
   * Usulan kode manual yang akan direservasi pada commit publish. Ikut di
   * fingerprint supaya usulan yang berubah setelah review tidak pernah
   * "lolos" dengan fingerprint lama (dan tidak mereservasi kode tak direview).
   */
  proposedCodes?: readonly string[];
}): string {
  const canonical = JSON.stringify({
    action: PUBLISH_ACTION,
    offerId: input.offerId,
    offerVersion: input.offerVersion,
    draftVersion: input.draftVersion,
    policyVersion: input.policyVersion,
    liveRevisionId: input.liveRevisionId,
    draftRevisionId: input.draftRevisionId,
    stateAfter: input.stateAfter,
    terms: {
      name: input.terms.name,
      currency: input.terms.currency,
      minSubtotal: input.terms.minSubtotal,
      startAt: input.terms.startAt,
      endAt: input.terms.endAt,
      benefit: input.terms.benefit,
    },
    capacity: {
      quotaCount: input.capacity.quotaCount,
      budgetAmount: input.capacity.budgetAmount,
      perClientLimit: input.capacity.perClientLimit,
    },
    proposedCodes: [...(input.proposedCodes ?? [])],
  });
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

// =========================================================
// Safe DTOs
// =========================================================

export interface DiscountBenefitDto {
  id: string;
  kind: string;
  scope: string;
  /** NULL untuk `percentage_goods`. */
  fixedAmount: string | null;
  /** NULL untuk `fixed_goods`. */
  rate: string | null;
  /** NULL = percentage tanpa cap (atau fixed goods). */
  capAmount: string | null;
  paramsVersion: number;
}

export interface DiscountOfferRevisionDto {
  id: string;
  revisionNo: number;
  draftVersion: number;
  name: string | null;
  currency: string | null;
  minSubtotal: string | null;
  startAt: string | null;
  endAt: string | null;
  schemaVersion: number;
  engineVersion: number;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
  benefit: DiscountBenefitDto | null;
}

export interface DiscountOfferUsageDto {
  reservedCount: number;
  consumedCount: number;
  reservedAmount: string;
  consumedAmount: string;
  version: number;
  updatedAt: string;
}

/**
 * Safe code label (ticket 09). `maskedCode` selalu aman untuk viewer, list,
 * history, audit dan export. Literal `code` HANYA diisi untuk aktor yang
 * memiliki `discounts:view` + `discounts:edit` global (editor promo). Field itu
 * tidak pernah ikut tersimpan di receipt/audit/log.
 */
export interface DiscountCodeDto {
  id: string;
  maskedCode: string;
  code?: string;
  state: string;
  version: number;
  publishedAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface DiscountOfferDetailDto {
  id: string;
  key: string;
  activationKind: string;
  state: string;
  /** NULL while no revision is published — the draft stays unlaunchable. */
  currentRevisionId: string | null;
  version: number;
  draftVersion: number;
  policyVersion: number;
  perClientLimit: number;
  /** NULL in an incomplete draft: no voucher-style default capacity. */
  quotaCount: number | null;
  budgetAmount: string | null;
  createdAt: string;
  updatedAt: string;
  /** Terms currently live for customers (the published revision). */
  liveRevision: DiscountOfferRevisionDto | null;
  /** The single unpublished draft revision, when one exists. */
  draftRevision: DiscountOfferRevisionDto | null;
  /** Reserved manual codes; literal only for a promo editor. */
  codes: DiscountCodeDto[];
  /** True when this response may carry full literals (editor interface). */
  codeLiteralVisible: boolean;
  usage: DiscountOfferUsageDto | null;
  /**
   * Global capacity summary for the detail page (ticket 12): consumed + held
   * against the global quota/budget. `basis: "global"` keeps a scoped ops list
   * from being read as if it equalled these totals.
   */
  capacitySummary: {
    basis: "global";
    consumedCount: number;
    heldCount: number;
    consumedAmount: string;
    heldAmount: string;
    availableCount: number | null;
    availableAmount: string | null;
  };
}

export interface DiscountOfferSummaryDto {
  id: string;
  key: string;
  activationKind: string;
  state: string;
  version: number;
  draftVersion: number;
  policyVersion: number;
  perClientLimit: number;
  quotaCount: number | null;
  budgetAmount: string | null;
  updatedAt: string;
  capacitySummary: DiscountOfferDetailDto["capacitySummary"] | null;
  liveRevision: {
    id: string;
    revisionNo: number;
    kind: string | null;
    scope: string | null;
    name: string | null;
    minSubtotal: string | null;
    startAt: string | null;
    endAt: string | null;
    fixedAmount: string | null;
    rate: string | null;
    capAmount: string | null;
  } | null;
  draftRevisionId: string | null;
  /** Masked code labels only — a list is never an editor channel. */
  codes: { id: string; maskedCode: string; state: string }[];
  codeCount: number;
}

type OfferRow = typeof discountOffers.$inferSelect;
type RevisionRow = typeof discountOfferRevisions.$inferSelect;
type BenefitRow = typeof discountBenefits.$inferSelect;
type UsageRow = typeof discountOfferUsage.$inferSelect;
type CodeRow = typeof discountCodes.$inferSelect;

function iso(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
}

/**
 * `numeric(15,2)` comes back from `pg` as a scaled string (`"25000.00"`).
 * Discount money is whole Rupiah, so parse it exactly and refuse a fractional
 * value instead of silently rounding it.
 */
function dbMoneyToBigInt(value: string, field: string): bigint {
  const [whole, fraction = ""] = value.split(".");
  if (!/^\d+$/.test(whole) || fraction.replace(/0/g, "") !== "") {
    throw new Error(`${field} is not a whole Rupiah value: ${value}`);
  }
  return BigInt(whole);
}

/** Canonical whole-Rupiah text for the wire (no `.00` scale noise). */
function dbMoneyText(value: string): string {
  return dbMoneyToBigInt(value, "money").toString();
}

/**
 * Baris `discount_benefit` → payload parser bersama. Bentuk yang tidak sesuai
 * (kind/versi/precision/field campuran) menghasilkan null, bukan default ke
 * fixed goods.
 */
function benefitRowPayload(row: BenefitRow): Record<string, unknown> {
  if (row.kind === "fixed_goods") {
    return {
      kind: row.kind,
      paramsVersion: row.paramsVersion,
      fixedAmount: row.fixedAmount,
    };
  }
  if (row.kind === "shipping") {
    return {
      kind: row.kind,
      paramsVersion: row.paramsVersion,
      capAmount: row.capAmount,
    };
  }
  return {
    kind: row.kind,
    paramsVersion: row.paramsVersion,
    rate: row.rate,
    capAmount: row.capAmount,
  };
}

function tryParseBenefitRow(row: BenefitRow): ParsedOfferBenefit | null {
  return tryParseOfferBenefit(benefitRowPayload(row));
}

/**
 * Terms benefit yang dipakai fingerprint/DTO/pricing, atau 409 bila baris
 * tersimpan tidak lagi sesuai kontrak (tidak pernah ditebak).
 */
function benefitTermsFromRow(row: BenefitRow): NormalizedBenefitTerms {
  const parsed = tryParseBenefitRow(row);
  if (!parsed) {
    throw new DiscountAdministrationError(
      409,
      "OFFER_NOT_PUBLISHABLE",
      "The stored benefit is not a supported version1 goods benefit"
    );
  }
  if (parsed.kind === "fixed_goods") {
    return {
      kind: "fixed_goods",
      paramsVersion: 1,
      fixedAmount: parsed.fixedAmount.toString(),
    };
  }
  if (parsed.kind === "shipping") {
    return {
      kind: "shipping",
      paramsVersion: 1,
      capAmount: parsed.capAmount.toString(),
    };
  }
  return {
    kind: "percentage_goods",
    paramsVersion: 1,
    rate: parsed.ratePercent,
    capAmount: parsed.capAmount === null ? null : parsed.capAmount.toString(),
  };
}

function toBenefitDto(row: BenefitRow | undefined): DiscountBenefitDto | null {
  if (!row) return null;
  return {
    id: row.id,
    kind: row.kind,
    scope: row.scope,
    fixedAmount: row.fixedAmount === null ? null : dbMoneyText(row.fixedAmount),
    rate: row.rate === null ? null : normalizeRateText(row.rate),
    capAmount: row.capAmount === null ? null : dbMoneyText(row.capAmount),
    paramsVersion: row.paramsVersion,
  };
}

/** `numeric(9,6)` → teks rate kanonik tanpa nol ekor (`10.000000` → `10`). */
function normalizeRateText(value: string): string {
  const trimmed = value.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return trimmed;
  const [whole, fraction = ""] = trimmed.split(".");
  const normalizedFraction = fraction.replace(/0+$/, "");
  return normalizedFraction ? `${whole}.${normalizedFraction}` : whole;
}

function toRevisionDto(
  row: RevisionRow,
  benefit: BenefitRow | undefined
): DiscountOfferRevisionDto {
  return {
    id: row.id,
    revisionNo: row.revisionNo,
    draftVersion: row.draftVersion,
    name: row.name,
    currency: row.currency,
    minSubtotal: row.minSubtotal === null ? null : dbMoneyText(row.minSubtotal),
    startAt: iso(row.startAt),
    endAt: iso(row.endAt),
    schemaVersion: row.schemaVersion,
    engineVersion: row.engineVersion,
    publishedAt: iso(row.publishedAt),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    benefit: toBenefitDto(benefit),
  };
}

function toUsageDto(row: UsageRow | null): DiscountOfferUsageDto | null {
  if (!row) return null;
  return {
    reservedCount: row.reservedCount,
    consumedCount: row.consumedCount,
    reservedAmount: dbMoneyText(row.reservedAmount),
    consumedAmount: dbMoneyText(row.consumedAmount),
    version: row.version,
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toCodeDto(row: CodeRow, includeLiteral: boolean): DiscountCodeDto {
  const dto: DiscountCodeDto = {
    id: row.id,
    maskedCode: maskPromoCode(row.canonicalCode),
    state: row.state,
    version: row.version,
    publishedAt: row.publishedAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
  if (includeLiteral) dto.code = row.canonicalCode;
  return dto;
}

function toDetailDto(
  offer: OfferRow,
  revisions: readonly RevisionRow[],
  benefits: readonly BenefitRow[],
  usage: UsageRow | null,
  codes: readonly CodeRow[],
  includeCodeLiterals = false
): DiscountOfferDetailDto {
  const benefitByRevision = new Map(benefits.map((row) => [row.revisionId, row]));
  const live = revisions.find((row) => row.id === offer.currentRevisionId);
  const draft = revisions.find((row) => row.publishedAt === null);
  return {
    id: offer.id,
    key: offer.key,
    activationKind: offer.activationKind,
    state: offer.state,
    currentRevisionId: offer.currentRevisionId,
    version: offer.version,
    draftVersion: offer.draftVersion,
    policyVersion: offer.policyVersion,
    perClientLimit: offer.perClientLimit,
    quotaCount: offer.quotaCount,
    budgetAmount:
      offer.budgetAmount === null ? null : dbMoneyText(offer.budgetAmount),
    createdAt: offer.createdAt.toISOString(),
    updatedAt: offer.updatedAt.toISOString(),
    liveRevision: live
      ? toRevisionDto(live, benefitByRevision.get(live.id))
      : null,
    draftRevision: draft
      ? toRevisionDto(draft, benefitByRevision.get(draft.id))
      : null,
    codes: codes.map((row) => toCodeDto(row, includeCodeLiterals)),
    codeLiteralVisible: includeCodeLiterals,
    usage: toUsageDto(usage),
    capacitySummary: capacitySummaryFor(offer, usage),
  };
}

/** Global consumed/held/available projection for the Offer detail response. */
function capacitySummaryFor(
  offer: OfferRow,
  usage: UsageRow | null
): DiscountOfferDetailDto["capacitySummary"] {
  const heldCount = usage?.reservedCount ?? 0;
  const consumedCount = usage?.consumedCount ?? 0;
  const heldAmount = wholeRupiah(usage?.reservedAmount ?? "0", "reservedAmount");
  const consumedAmount = wholeRupiah(
    usage?.consumedAmount ?? "0",
    "consumedAmount"
  );
  const budgetAmount =
    offer.budgetAmount === null ? null : dbMoneyText(offer.budgetAmount);
  return {
    basis: "global",
    consumedCount,
    heldCount,
    consumedAmount,
    heldAmount,
    availableCount:
      offer.quotaCount === null
        ? null
        : Math.max(0, offer.quotaCount - heldCount - consumedCount),
    availableAmount:
      budgetAmount === null
        ? null
        : (
            BigInt(budgetAmount) -
            BigInt(heldAmount) -
            BigInt(consumedAmount)
          ).toString(),
  };
}

interface OfferAggregate {
  offer: OfferRow;
  revisions: RevisionRow[];
  benefits: BenefitRow[];
  usage: UsageRow | null;
  codes: CodeRow[];
}

async function loadOfferAggregate(
  executor: Executor,
  offerId: string,
  options: { forUpdate?: boolean } = {}
): Promise<OfferAggregate | null> {
  const offerQuery = executor
    .select()
    .from(discountOffers)
    .where(eq(discountOffers.id, offerId))
    .limit(1);
  const offerRows = options.forUpdate
    ? await offerQuery.for("update")
    : await offerQuery;
  const offer = offerRows[0];
  if (!offer) return null;

  const revisionQuery = executor
    .select()
    .from(discountOfferRevisions)
    .where(eq(discountOfferRevisions.offerId, offerId))
    .orderBy(asc(discountOfferRevisions.revisionNo));
  const revisions = options.forUpdate
    ? await revisionQuery.for("update")
    : await revisionQuery;

  const benefits =
    revisions.length === 0
      ? []
      : await executor
          .select()
          .from(discountBenefits)
          .where(
            sql`${discountBenefits.revisionId} in (${sql.join(
              revisions.map((row) => sql`${row.id}`),
              sql`, `
            )})`
          );

  const usageQuery = executor
    .select()
    .from(discountOfferUsage)
    .where(eq(discountOfferUsage.offerId, offerId))
    .limit(1);
  const usageRows = options.forUpdate
    ? await usageQuery.for("update")
    : await usageQuery;

  const codeQuery = executor
    .select()
    .from(discountCodes)
    .where(eq(discountCodes.offerId, offerId))
    .orderBy(asc(discountCodes.createdAt), asc(discountCodes.canonicalCode));
  const codes = options.forUpdate ? await codeQuery.for("update") : await codeQuery;

  return { offer, revisions, benefits, usage: usageRows[0] ?? null, codes };
}

async function readDetailDto(
  executor: Executor,
  offerId: string,
  includeCodeLiterals = false
): Promise<DiscountOfferDetailDto | null> {
  const aggregate = await loadOfferAggregate(executor, offerId);
  if (!aggregate) return null;
  return toDetailDto(
    aggregate.offer,
    aggregate.revisions,
    aggregate.benefits,
    aggregate.usage,
    aggregate.codes,
    includeCodeLiterals
  );
}

/**
 * Both discount modules are Global Modules, so a write needs current
 * `discounts:view` AND `discounts:edit` at GLOBAL scope. `requiredScope` is not
 * passed to the authorizer: the System Owner bypass is code-owned and carries
 * no grant rows, so the scope is asserted on the RESULT instead (a branch-scope
 * row cannot even be stored by the schema CHECK).
 */
function requireDiscountViewer(loaded: LoadedPolicy | null): LoadedPolicy {
  const denied = new DiscountAdministrationError(
    403,
    "DENIED",
    "You do not have access to this resource"
  );
  if (!loaded) throw denied;
  if (!hasGlobalGrant(loaded, "discounts", "view")) throw denied;
  return loaded;
}

/** Literal exposure decision (spec §7.1): promo editor only, never audit-only. */
function canViewCodeLiterals(loaded: LoadedPolicy | null): boolean {
  return (
    loaded !== null &&
    hasGlobalGrant(loaded, "discounts", "view") &&
    hasGlobalGrant(loaded, "discounts", "edit")
  );
}

function requireDiscountEditor(loaded: LoadedPolicy | null): LoadedPolicy {
  const denied = new DiscountAdministrationError(
    403,
    "DENIED",
    "You do not have access to this resource"
  );
  if (!loaded) throw denied;
  if (!requireDiscountViewer(loaded)) throw denied;
  if (!hasGlobalGrant(loaded, "discounts", "edit")) throw denied;
  return loaded;
}

/** Capacity changes that enlarge an Offer need BOTH modules at global scope. */
function requireCapacityEditor(loaded: LoadedPolicy): void {
  if (!hasGlobalGrant(loaded, "discount_capacity", "view") ||
      !hasGlobalGrant(loaded, "discount_capacity", "edit")) {
    throw new DiscountAdministrationError(
      403,
      "DENIED",
      "You need the discount capacity grant for this change"
    );
  }
}

// =========================================================
// Validation — shared by review and publish
// =========================================================

export type ReviewValidationCode =
  | "TERMS_COMPLETE"
  | "BENEFIT_VALID"
  | "CAPACITY_BOUND"
  | "WINDOW_ORDERED"
  | "CODE_FREE"
  | "LIVE_TERMS_IMMUTABLE";

export interface ReviewValidation {
  code: ReviewValidationCode;
  ok: boolean;
  message: string;
}

interface PublishableInput {
  offer: Pick<
    OfferRow,
    | "state"
    | "activationKind"
    | "quotaCount"
    | "budgetAmount"
    | "perClientLimit"
    | "currentRevisionId"
  >;
  draft: RevisionRow | null;
  benefit: BenefitRow | null;
}

/**
 * The publication completeness gate. A draft may be saved incomplete, but it
 * cannot be published until the terms, the one typed benefit (fixed or
 * percentage goods), the minimum capacity bound and the time window are all
 * valid. Returns the full list so the admin review screen can show WHY a draft
 * is not launchable.
 */
export function validatePublishable(input: PublishableInput): ReviewValidation[] {
  const { draft, benefit } = input;
  const validations: ReviewValidation[] = [];

  const termsComplete =
    draft !== null &&
    typeof draft.name === "string" &&
    draft.name.trim().length > 0 &&
    draft.currency === "IDR" &&
    draft.minSubtotal !== null;
  validations.push({
    code: "TERMS_COMPLETE",
    ok: termsComplete,
    message: termsComplete
      ? "Nama, mata uang IDR, dan minimum subtotal terisi"
      : "Nama, mata uang IDR, dan minimum subtotal wajib terisi sebelum publish",
  });

  const benefitValid =
    benefit !== null &&
    ((benefit.scope === "goods" &&
      (benefit.kind === "fixed_goods" || benefit.kind === "percentage_goods")) ||
      (benefit.scope === "shipping" && benefit.kind === "shipping")) &&
    benefit.paramsVersion === 1 &&
    tryParseBenefitRow(benefit) !== null;
  validations.push({
    code: "BENEFIT_VALID",
    ok: benefitValid,
    message: benefitValid
      ? benefit.scope === "shipping"
        ? "Benefit shipping version1 (cap ongkir positif) valid"
        : "Benefit goods version1 dengan parameter valid"
      : "Tepat satu benefit version1 (fixed nominal, percentage rate/cap, atau cap ongkir) wajib ada",
  });

  const hasBound =
    input.offer.quotaCount !== null || input.offer.budgetAmount !== null;
  validations.push({
    code: "CAPACITY_BOUND",
    ok: hasBound,
    message: hasBound
      ? "Minimal satu batas kapasitas (kuota atau budget) aktif"
      : "Offer live wajib memiliki minimal satu batas kuota atau budget",
  });

  const windowOrdered =
    draft === null ||
    draft.startAt === null ||
    draft.endAt === null ||
    draft.startAt.getTime() < draft.endAt.getTime();
  validations.push({
    code: "WINDOW_ORDERED",
    ok: windowOrdered,
    message: windowOrdered
      ? "Jendela waktu valid (start inklusif, end eksklusif)"
      : "startAt harus lebih awal dari endAt",
  });

  // A public Offer has no customer-facing code; a manual Offer reserves its
  // codes explicitly through add-code/publish. This is the invariant the review
  // screen shows, not a storage default.
  validations.push({
    code: "CODE_FREE",
    ok: true,
    message:
      input.offer.activationKind === "manual_only"
        ? "Offer manual memakai kode yang direservasi pada add/publish"
        : "Offer publik tidak memiliki kode kupon",
  });

  // The draft row is by definition unpublished, so publishing never mutates a
  // live revision. The check makes that explicit in the review payload.
  validations.push({
    code: "LIVE_TERMS_IMMUTABLE",
    ok: draft === null || draft.publishedAt === null,
    message: "Draft terpisah dari terms live yang sudah terbit",
  });

  return validations;
}

// =========================================================
// Capacity classification
// =========================================================

export type CapacityDirection = "same" | "reduce" | "enlarge";

interface CapacityChange {
  direction: CapacityDirection;
  /** Human-readable reasons, used in the audit payload and the API error. */
  reasons: string[];
}

/**
 * Classify a requested capacity change. Enlarging (initial assignment, any
 * increase, or removal of a bound that was limiting) needs the capacity grant;
 * reducing only needs the promo grant but must stay above committed usage.
 * per-account limit increases are enlarging too.
 */
export function classifyCapacityChange(
  before: CapacitySnapshot,
  after: CapacitySnapshot
): CapacityChange {
  const reasons: string[] = [];
  let enlarge = false;
  let reduce = false;

  const compareCount = (label: string, oldValue: number | null, newValue: number | null) => {
    if (oldValue === newValue) return;
    if (oldValue === null) {
      enlarge = true;
      reasons.push(`${label} diisi dari kosong`);
      return;
    }
    if (newValue === null) {
      enlarge = true;
      reasons.push(`${label} dihapus (batas melebar)`);
      return;
    }
    if (newValue > oldValue) {
      enlarge = true;
      reasons.push(`${label} dinaikkan`);
    } else {
      reduce = true;
      reasons.push(`${label} diturunkan`);
    }
  };

  const compareMoney = (label: string, oldValue: string | null, newValue: string | null) => {
    if (oldValue === newValue) return;
    if (oldValue === null) {
      enlarge = true;
      reasons.push(`${label} diisi dari kosong`);
      return;
    }
    if (newValue === null) {
      enlarge = true;
      reasons.push(`${label} dihapus (batas melebar)`);
      return;
    }
    const oldAmount = dbMoneyToBigInt(oldValue, label);
    const newAmount = dbMoneyToBigInt(newValue, label);
    if (newAmount > oldAmount) {
      enlarge = true;
      reasons.push(`${label} dinaikkan`);
    } else {
      reduce = true;
      reasons.push(`${label} diturunkan`);
    }
  };

  compareCount("Kuota", before.quotaCount, after.quotaCount);
  compareMoney("Budget", before.budgetAmount, after.budgetAmount);
  compareCount(
    "Jatah per akun",
    before.perClientLimit,
    after.perClientLimit
  );

  return {
    direction: enlarge ? "enlarge" : reduce ? "reduce" : "same",
    reasons,
  };
}

// =========================================================
// Create a public draft Offer
// =========================================================

export interface CreatePublicDraftInput {
  requestKey: string;
  activationKind: string;
  /**
   * Usulan kode untuk Offer manual_only. Divalidasi & direservasi DI DALAM
   * transaksi create; mengetik draft di browser tidak pernah menulis canonical
   * code. Offer publik wajib mengirim array kosong/tanpa field ini.
   */
  codes?: unknown;
}

export interface CreatePublicDraftResult {
  /** 201 for a fresh draft, 200 for a request-key replay. */
  status: 200 | 201;
  data: DiscountOfferDetailDto;
}

/** Sentinel: another transaction committed the same `(actor, key)` first. */
class RequestKeyClaimed extends Error {}

export function assertCreateInput(input: CreatePublicDraftInput): string {
  if (typeof input.requestKey !== "string" || !UUID_PATTERN.test(input.requestKey)) {
    throw inputInvalid("requestKey must be a UUID");
  }
  // Never default to "public" silently: an unsupported activation kind is an
  // explicit 400, even though the HTTP schema already narrows the field.
  if (input.activationKind !== "public" && input.activationKind !== "manual_only") {
    throw inputInvalid("activationKind must be public or manual_only");
  }
  return input.requestKey;
}

/** Batas satu perintah; bukan batas global Offer. */
export const MAX_CODE_PROPOSALS_PER_COMMAND = 50;

/**
 * Menormalkan usulan kode DARI SATU perintah tulis. Semua literal harus sah
 * canonical, unik setelah normalisasi, dan tidak boleh ada pada Offer publik.
 * Tidak ada penulisan apa pun di sini: hanya validasi input (reservasi canonical
 * terjadi di transaksi add-code/publish/create yang berhasil).
 */
export function normalizeCodeProposals(
  raw: unknown,
  activationKind: string
): string[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) {
    throw inputInvalid("codes must be an array of code strings");
  }
  if (raw.length > MAX_CODE_PROPOSALS_PER_COMMAND) {
    throw inputInvalid("too many code proposals in one command");
  }
  if (activationKind !== "manual_only") {
    if (raw.length > 0) {
      throw new DiscountAdministrationError(
        400,
        "CODE_NOT_SUPPORTED",
        "A public Offer has no customer code"
      );
    }
    return [];
  }
  const seen = new Set<string>();
  const codes: string[] = [];
  for (const value of raw) {
    const canonical = canonicalizePromoCode(value);
    if (canonical === null) {
      throw inputInvalid(
        "code must be 3-64 ASCII alphanumerics, underscore or hyphen, starting alphanumeric"
      );
    }
    if (seen.has(canonical)) {
      throw inputInvalid("duplicate canonical code in one command");
    }
    seen.add(canonical);
    codes.push(canonical);
  }
  return codes;
}

/** Hasil DTO yang aman untuk receipt: literal kode tidak pernah disimpan. */
function sanitizeDetailForReceipt(detail: DiscountOfferDetailDto): DiscountOfferDetailDto {
  return {
    ...detail,
    codeLiteralVisible: false,
    codes: detail.codes.map(({ id, maskedCode, state, version, publishedAt, createdAt, updatedAt }) => ({
      id,
      maskedCode,
      state,
      version,
      publishedAt,
      createdAt,
      updatedAt,
    })),
  };
}

function mapDatabaseError(error: unknown): unknown {
  const code = (error as { code?: string } | null)?.code;
  if (code === "55P03" || code === "57014" || code === "40001" || code === "40P01") {
    // Lock timeout, statement timeout, serialization failure/deadlock: the
    // whole transaction rolled back, so a retry is safe and nothing partial is
    // visible (spec §9.2 bounded execution).
    return new DiscountAdministrationError(
      503,
      "BUSY",
      "The request could not be completed in time; please retry"
    );
  }
  if (code === "23505") {
    return new DiscountAdministrationError(
      409,
      "CONFLICT",
      "The record was modified concurrently"
    );
  }
  return error;
}

async function findReceipt(
  executor: Executor,
  actorUserId: string,
  requestKey: string
) {
  const rows = await executor
    .select()
    .from(discountAdminRequests)
    .where(
      and(
        eq(discountAdminRequests.actorIdentity, actorUserId),
        eq(discountAdminRequests.requestKey, requestKey)
      )
    )
    .limit(1);
  return rows[0] ?? null;
}

async function replayAcceptedResult(
  actorUserId: string,
  requestKey: string,
  fingerprint: string
): Promise<CreatePublicDraftResult> {
  const receipt = await findReceipt(db, actorUserId, requestKey);
  if (!receipt) {
    throw new DiscountAdministrationError(
      409,
      "REQUEST_KEY_CONFLICT",
      "The request key could not be claimed"
    );
  }
  if (receipt.fingerprint !== fingerprint) {
    throw new DiscountAdministrationError(
      409,
      "REQUEST_KEY_CONFLICT",
      "This request key was already used with a different command"
    );
  }
  if (!receipt.targetId) {
    throw new Error("Accepted discount receipt has no target Offer");
  }
  const data = await readDetailDto(db, receipt.targetId, true);
  if (!data) {
    throw new Error("Accepted discount receipt names a missing Offer");
  }
  return { status: 200, data };
}

/**
 * Create ONE public fixed Offer draft, or replay the accepted result of the
 * same `(actor, request key)` command.
 *
 * Global lock order used here (spec §9.2): Admin User → Role (SHARE) → command
 * receipt → Offer → Offer usage. Everything after the gate and the fingerprint
 * happens in one short transaction; no HTTP/provider call occurs inside it.
 */
export async function createPublicDraftOffer(
  input: CreatePublicDraftInput,
  actorUserId: string
): Promise<CreatePublicDraftResult> {
  const requestKey = assertCreateInput(input);
  const activationKind = input.activationKind;
  const proposedCodes = normalizeCodeProposals(input.codes, activationKind);
  await requireActiveContract();
  const fingerprint = publicDraftCommandFingerprint({
    activationKind,
    canonicalCodes: proposedCodes,
  });

  try {
    return await beginBoundedTransaction(async (tx) => {
      // 1) Current Policy re-read under SHARE locks (actor first, then Role).
      const actor = requireDiscountEditor(
        await loadActorPolicyInTransaction(tx, actorUserId)
      );

      // 2) Accepted receipt for this exact (actor, key).
      const existing = await tx
        .select()
        .from(discountAdminRequests)
        .where(
          and(
            eq(discountAdminRequests.actorIdentity, actorUserId),
            eq(discountAdminRequests.requestKey, requestKey)
          )
        )
        .for("update")
        .limit(1);
      if (existing.length > 0) {
        const receipt = existing[0];
        if (receipt.fingerprint !== fingerprint) {
          throw new DiscountAdministrationError(
            409,
            "REQUEST_KEY_CONFLICT",
            "This request key was already used with a different command"
          );
        }
        if (!receipt.targetId) {
          throw new Error("Accepted discount receipt has no target Offer");
        }
        const replayed = await readDetailDto(tx, receipt.targetId, true);
        if (!replayed) {
          throw new Error("Accepted discount receipt names a missing Offer");
        }
        return { status: 200 as const, data: replayed };
      }

      // 3) Claim the key. A concurrent identical command that commits first
      //    makes this insert a no-op — the loser rolls back and reads the
      //    winner's accepted result instead of creating a second Offer.
      const now = new Date();
      const offerId = randomUUID();
      const revisionId = randomUUID();
      const planned: DiscountOfferDetailDto = {
        id: offerId,
        key: randomUUID(),
        activationKind,
        state: "draft",
        currentRevisionId: null,
        version: 1,
        draftVersion: 1,
        policyVersion: 1,
        perClientLimit: DEFAULT_PER_CLIENT_LIMIT,
        quotaCount: null,
        budgetAmount: null,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
        liveRevision: null,
        draftRevision: {
          id: revisionId,
          revisionNo: 1,
          draftVersion: 1,
          name: null,
          currency: null,
          minSubtotal: null,
          startAt: null,
          endAt: null,
          schemaVersion: OFFER_SCHEMA_VERSION,
          engineVersion: OFFER_ENGINE_VERSION,
          publishedAt: null,
          createdAt: now.toISOString(),
          updatedAt: now.toISOString(),
          benefit: null,
        },
        usage: {
          reservedCount: 0,
          consumedCount: 0,
          reservedAmount: "0",
          consumedAmount: "0",
          version: 1,
          updatedAt: now.toISOString(),
        },
        // Usulan kode manual sudah direservasi pada commit ini (bukan saat
        // mengetik draft): label di receipt selalu masked.
        codes: proposedCodes.map((canonical) => ({
          id: randomUUID(),
          maskedCode: maskPromoCode(canonical),
          code: canonical,
          state: "active",
          version: 1,
          publishedAt: now.toISOString(),
          createdAt: now.toISOString(),
          updatedAt: now.toISOString(),
        })),
        codeLiteralVisible: true,
        capacitySummary: {
          basis: "global",
          consumedCount: 0,
          heldCount: 0,
          consumedAmount: "0",
          heldAmount: "0",
          availableCount: null,
          availableAmount: null,
        },
      };
      const receiptResult = sanitizeDetailForReceipt(planned);

      const claimed = await tx
        .insert(discountAdminRequests)
        .values({
          id: randomUUID(),
          actorIdentity: actorUserId,
          requestKey,
          fingerprint,
          action: CREATE_DRAFT_ACTION,
          targetId: offerId,
          version: planned.version,
          resultJson: receiptResult,
          actorId: actorUserId,
          createdAt: now,
        })
        .onConflictDoNothing({
          target: [
            discountAdminRequests.actorIdentity,
            discountAdminRequests.requestKey,
          ],
        })
        .returning({ id: discountAdminRequests.id });
      if (claimed.length === 0) throw new RequestKeyClaimed();

      // 4) Offer identity → one unpublished draft revision → zeroed usage →
      //    reserved manual codes (canonical unique), all in ONE commit.
      await tx.insert(discountOffers).values({
        id: offerId,
        key: planned.key,
        activationKind,
        state: "draft",
        currentRevisionId: null,
        version: planned.version,
        draftVersion: planned.draftVersion,
        quotaCount: null,
        budgetAmount: null,
        perClientLimit: DEFAULT_PER_CLIENT_LIMIT,
        policyVersion: planned.policyVersion,
        actorId: actorUserId,
        actorIdentity: actorUserId,
        createdAt: now,
        updatedAt: now,
      });
      await tx.insert(discountOfferRevisions).values({
        id: revisionId,
        offerId,
        revisionNo: 1,
        // An incomplete draft revision: terms/benefit stay absent until an
        // editor saves the draft and publication validates them.
        name: null,
        currency: null,
        minSubtotal: null,
        startAt: null,
        endAt: null,
        schemaVersion: OFFER_SCHEMA_VERSION,
        engineVersion: OFFER_ENGINE_VERSION,
        draftVersion: 1,
        publishedAt: null,
        actorId: actorUserId,
        actorIdentity: actorUserId,
        createdAt: now,
        updatedAt: now,
      });
      await tx.insert(discountOfferUsage).values({
        offerId,
        reservedCount: 0,
        consumedCount: 0,
        reservedAmount: "0",
        consumedAmount: "0",
        version: 1,
        updatedAt: now,
      });

      // 5) Reserved codes for a manual Offer: canonical unique globally, owner
      //    fixed forever. Public Offers have no codes (validated above).
      for (const [index, canonical] of proposedCodes.entries()) {
        // Conflict-safe like add-code/publish: a rolled-back loser must not
        // surface a raw unique violation, and an archived literal stays
        // reserved for the Offer that already owns it.
        const inserted = await tx
          .insert(discountCodes)
          .values({
            id: planned.codes[index]!.id,
            offerId,
            activationKind: "manual_only",
            canonicalCode: canonical,
            state: "active",
            version: 1,
            publishedAt: now,
            actorId: actorUserId,
            actorIdentity: actorUserId,
            createdAt: now,
            updatedAt: now,
          })
          .onConflictDoNothing({ target: discountCodes.canonicalCode })
          .returning({ id: discountCodes.id });
        if (inserted.length === 0) throw new CodeCanonicalConflict();
      }

      // 6) Immutable business audit in the SAME commit. Kode dicatat sebagai ID
      //    + label masked; audit grant sendiri tidak membuka literal.
      await writeAuditEvent(tx, {
        actorId: actorUserId,
        actorIdentity: actorUserId,
        action: CREATE_DRAFT_AUDIT_ACTION,
        entityType: "discount_offer",
        entityId: offerId,
        changes: {
          activationKind,
          state: "draft",
          draftRevisionId: revisionId,
          revisionNo: 1,
          requestKey,
          quotaCount: null,
          budgetAmount: null,
          perClientLimit: DEFAULT_PER_CLIENT_LIMIT,
          policyVersionAfter: planned.policyVersion,
          codes: planned.codes.map((code) => ({
            codeId: code.id,
            maskedCode: code.maskedCode,
          })),
        },
        policyVersion: actor.policyVersion,
        branchScope: "global",
      });

      return { status: 201 as const, data: planned };
    });
  } catch (error) {
    if (error instanceof RequestKeyClaimed) {
      // The winner committed (its receipt is durable, ours rolled back), so the
      // accepted result is readable now: replay it, or report a real conflict.
      return replayAcceptedResult(actorUserId, requestKey, fingerprint);
    }
    if (error instanceof CodeCanonicalConflict || isCanonicalUniqueViolation(error)) {
      // A published/archived code literal stays reserved forever: creating a
      // new Offer with it is a stable 409, never a raw unique violation.
      throw new DiscountAdministrationError(
        409,
        "CODE_CONFLICT",
        "Kode ini sudah direservasi Offer lain"
      );
    }
    throw mapDatabaseError(error);
  }
}

// =========================================================
// Manual Promo Code management (ticket 09)
// =========================================================

/** Konflik canonical code yang sudah direservasi Offer lain/nonaktif. */
class CodeCanonicalConflict extends Error {}

function isCanonicalUniqueViolation(error: unknown): boolean {
  const value = error as { code?: string; constraint?: string; detail?: string } | null;
  if (value?.code !== "23505") return false;
  const marker = `${value.constraint ?? ""} ${value.detail ?? ""}`;
  return marker.includes("canonical") || marker.includes("discount_code");
}

async function receiptFor(
  tx: Executor,
  actorUserId: string,
  requestKey: string
) {
  const rows = await tx
    .select()
    .from(discountAdminRequests)
    .where(
      and(
        eq(discountAdminRequests.actorIdentity, actorUserId),
        eq(discountAdminRequests.requestKey, requestKey)
      )
    )
    .for("update")
    .limit(1);
  return rows[0] ?? null;
}

export interface AddDiscountCodeInput {
  offerId: string;
  requestKey: string;
  code: unknown;
  expectedOfferVersion: number;
}

export interface AddDiscountCodeResult {
  status: 200 | 201;
  data: DiscountOfferDetailDto;
  replayed: boolean;
}

/**
 * Menambah SATU kode manual ke Offer manual_only yang sudah ada.
 *
 * Request-key idempotent: key sama + perintah sama mengembalikan detail yang
 * sama (tidak menggandakan code/audit/version bump); isi berbeda 409. Canonical
 * direservasi pada commit ini — bukan saat admin mengetik — dan literal/owner
 * tidak pernah berubah setelahnya (tidak ada update canonical/offer_id).
 */
export async function addDiscountCode(
  input: AddDiscountCodeInput,
  actorUserId: string
): Promise<AddDiscountCodeResult> {
  await requireActiveContract();
  const offerId = requireId(input.offerId, "offerId");
  if (typeof input.requestKey !== "string" || !UUID_PATTERN.test(input.requestKey)) {
    throw inputInvalid("requestKey must be a UUID");
  }
  const expectedOfferVersion = assertExpectedVersion(
    input.expectedOfferVersion,
    "expectedOfferVersion"
  );
  const canonical = canonicalizePromoCode(input.code);
  if (canonical === null) {
    throw inputInvalid(
      "code must be 3-64 ASCII alphanumerics, underscore or hyphen, starting alphanumeric"
    );
  }
  const requestKey = input.requestKey;
  const fingerprint = createHash("sha256")
    .update(
      JSON.stringify({
        action: ADD_CODE_ACTION,
        offerId,
        code: canonical,
        expectedOfferVersion,
      }),
      "utf8"
    )
    .digest("hex");

  try {
    return await beginBoundedTransaction(async (tx) => {
      const actor = requireDiscountEditor(
        await loadActorPolicyInTransaction(tx, actorUserId)
      );

      const existing = await receiptFor(tx, actorUserId, requestKey);
      if (existing) {
        if (existing.fingerprint !== fingerprint) {
          throw new DiscountAdministrationError(
            409,
            "REQUEST_KEY_CONFLICT",
            "This request key was already used with a different command"
          );
        }
        if (!existing.targetId) {
          throw new Error("Accepted code receipt has no target Offer");
        }
        const replayed = await readDetailDto(tx, existing.targetId, true);
        if (!replayed) throw new Error("Accepted code receipt names a missing Offer");
        return { status: 200 as const, data: replayed, replayed: true };
      }

      const aggregate = await loadOfferAggregate(tx, offerId, { forUpdate: true });
      if (!aggregate) {
        throw new DiscountAdministrationError(404, "NOT_FOUND", "Offer not found");
      }
      const { offer } = aggregate;
      if (offer.activationKind !== "manual_only") {
        throw new DiscountAdministrationError(
          409,
          "CODE_NOT_SUPPORTED",
          "A public Offer has no customer code"
        );
      }
      if (offer.version !== expectedOfferVersion) {
        throw new DiscountAdministrationError(
          409,
          "STALE_REVISION",
          "The Offer changed; reload before adding a code"
        );
      }

      const now = new Date();
      const codeId = randomUUID();
      const inserted = await tx
        .insert(discountCodes)
        .values({
          id: codeId,
          offerId,
          activationKind: "manual_only",
          canonicalCode: canonical,
          state: "active",
          version: 1,
          publishedAt: now,
          actorId: actorUserId,
          actorIdentity: actorUserId,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoNothing({ target: discountCodes.canonicalCode })
        .returning({ id: discountCodes.id });
      if (inserted.length === 0) throw new CodeCanonicalConflict();

      await tx
        .update(discountOffers)
        .set({ version: offer.version + 1, updatedAt: now })
        .where(eq(discountOffers.id, offerId));

      const detail = await readDetailDto(tx, offerId, true);
      if (!detail) throw new Error("Offer disappeared after adding a code");

      await tx.insert(discountAdminRequests).values({
        id: randomUUID(),
        actorIdentity: actorUserId,
        requestKey,
        fingerprint,
        action: ADD_CODE_ACTION,
        targetId: offerId,
        version: detail.version,
        resultJson: sanitizeDetailForReceipt(detail),
        actorId: actorUserId,
        createdAt: now,
      });

      await writeAuditEvent(tx, {
        actorId: actorUserId,
        actorIdentity: actorUserId,
        action: ADD_CODE_AUDIT_ACTION,
        entityType: "discount_offer",
        entityId: offerId,
        changes: {
          requestKey,
          codeId,
          maskedCode: maskPromoCode(canonical),
          expectedOfferVersion,
          offerVersionAfter: detail.version,
        },
        policyVersion: actor.policyVersion,
        branchScope: "global",
      });

      return { status: 201 as const, data: detail, replayed: false };
    });
  } catch (error) {
    if (error instanceof CodeCanonicalConflict || isCanonicalUniqueViolation(error)) {
      throw new DiscountAdministrationError(
        409,
        "CODE_CONFLICT",
        "Kode ini sudah direservasi Offer lain"
      );
    }
    throw mapDatabaseError(error);
  }
}

export interface SetDiscountCodeStateInput {
  offerId: string;
  codeId: string;
  expectedOfferVersion: number;
  expectedCodeVersion: number;
  state: string;
}

export interface SetDiscountCodeStateResult {
  status: 200;
  data: DiscountOfferDetailDto;
  replayed: boolean;
}

const CODE_STATES = new Set(["active", "inactive", "archived"] as const);

/**
 * Mengubah state satu kode (active/inactive/archived) dengan dua version
 * guard. Perintah ini TIDAK menerima literal maupun owner baru: kode inactive/
 * arsip tidak bisa dipindah ke Offer lain. Arsip bersifat terminal (tidak ada
 * workflow restore arsip), dan usage Offer tidak pernah direset.
 */
export async function setDiscountCodeState(
  input: SetDiscountCodeStateInput,
  actorUserId: string
): Promise<SetDiscountCodeStateResult> {
  await requireActiveContract();
  const offerId = requireId(input.offerId, "offerId");
  const codeId = requireId(input.codeId, "codeId");
  const expectedOfferVersion = assertExpectedVersion(
    input.expectedOfferVersion,
    "expectedOfferVersion"
  );
  const expectedCodeVersion = assertExpectedVersion(
    input.expectedCodeVersion,
    "expectedCodeVersion"
  );
  if (typeof input.state !== "string" || !CODE_STATES.has(input.state as "active")) {
    throw inputInvalid("state must be active, inactive or archived");
  }

  try {
    return await beginBoundedTransaction(async (tx) => {
      const actor = requireDiscountEditor(
        await loadActorPolicyInTransaction(tx, actorUserId)
      );
      const aggregate = await loadOfferAggregate(tx, offerId, { forUpdate: true });
      if (!aggregate) {
        throw new DiscountAdministrationError(404, "NOT_FOUND", "Offer not found");
      }
      const { offer } = aggregate;
      const code = aggregate.codes.find((row) => row.id === codeId);
      if (!code) {
        throw new DiscountAdministrationError(404, "NOT_FOUND", "Code not found");
      }
      if (
        offer.version !== expectedOfferVersion ||
        code.version !== expectedCodeVersion
      ) {
        throw new DiscountAdministrationError(
          409,
          "STALE_REVISION",
          "The Offer or code changed; reload before changing the code state"
        );
      }
      if (code.state === "archived" && input.state !== "archived") {
        throw new DiscountAdministrationError(
          409,
          "CODE_ARCHIVED",
          "An archived code cannot be reactivated or moved"
        );
      }
      if (code.state === input.state) {
        const current = await readDetailDto(tx, offerId, true);
        if (!current) throw new Error("Offer disappeared while reading the code state");
        return { status: 200 as const, data: current, replayed: true };
      }

      const now = new Date();
      await tx
        .update(discountCodes)
        .set({ state: input.state, version: code.version + 1, updatedAt: now })
        .where(and(eq(discountCodes.id, codeId), eq(discountCodes.offerId, offerId)));
      await tx
        .update(discountOffers)
        .set({ version: offer.version + 1, updatedAt: now })
        .where(eq(discountOffers.id, offerId));

      const detail = await readDetailDto(tx, offerId, true);
      if (!detail) throw new Error("Offer disappeared after changing the code state");

      await writeAuditEvent(tx, {
        actorId: actorUserId,
        actorIdentity: actorUserId,
        action: CODE_STATE_AUDIT_ACTION,
        entityType: "discount_offer",
        entityId: offerId,
        changes: {
          codeId,
          maskedCode: maskPromoCode(code.canonicalCode),
          fromState: code.state,
          toState: input.state,
          expectedOfferVersion,
          expectedCodeVersion,
          offerVersionAfter: detail.version,
        },
        policyVersion: actor.policyVersion,
        branchScope: "global",
      });

      return { status: 200 as const, data: detail, replayed: false };
    });
  } catch (error) {
    throw mapDatabaseError(error);
  }
}

// =========================================================
// Detail / list reads
// =========================================================

/**
 * Detail read. Viewer selalu menerima label masked; literal hanya untuk promo
 * editor (`discounts:view` + `discounts:edit`) pada interface terlindungi ini.
 */
export async function getDiscountOfferDetail(
  offerId: string,
  actorUserId: string
): Promise<DiscountOfferDetailDto | null> {
  if (!offerId) return null;
  const actor = requireDiscountViewer(await loadPolicy(actorUserId));
  return readDetailDto(db, offerId, canViewCodeLiterals(actor));
}

export interface ListDiscountOffersInput {
  page?: number;
  limit?: number;
  state?: string;
  activationKind?: string;
}

export interface ListDiscountOffersResult {
  data: DiscountOfferSummaryDto[];
  countsByActivationKind: { public: number; manual_only: number };
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

const OFFER_STATES = new Set(["draft", "enabled", "paused", "archived"]);

export async function listDiscountOffers(
  input: ListDiscountOffersInput,
  actorUserId: string
): Promise<ListDiscountOffersResult> {
  requireDiscountViewer(await loadPolicy(actorUserId));
  const page = requirePageInteger(input.page ?? 1, "page", 100000);
  const limit = requirePageInteger(input.limit ?? 10, "limit", MAX_PAGE_SIZE);
  if (input.state !== undefined && !OFFER_STATES.has(input.state)) {
    throw inputInvalid("state filter is not a supported Offer state");
  }
  if (input.activationKind !== undefined && !["public", "manual_only"].includes(input.activationKind)) {
    throw inputInvalid("activationKind filter is not supported");
  }
  const stateWhere = input.state ? eq(discountOffers.state, input.state) : undefined;
  const where = and(stateWhere, input.activationKind
    ? eq(discountOffers.activationKind, input.activationKind) : undefined);
  const countRows = await db
    .select({ activationKind: discountOffers.activationKind, count: sql<number>`count(*)::int` })
    .from(discountOffers)
    .where(stateWhere)
    .groupBy(discountOffers.activationKind);
  const countsByActivationKind = { public: 0, manual_only: 0 };
  for (const row of countRows) {
    if (row.activationKind === "public" || row.activationKind === "manual_only") {
      countsByActivationKind[row.activationKind] = row.count;
    }
  }
  const total = input.activationKind === "public" ? countsByActivationKind.public
    : input.activationKind === "manual_only" ? countsByActivationKind.manual_only
    : countsByActivationKind.public + countsByActivationKind.manual_only;

  const offerRows = await db
    .select()
    .from(discountOffers)
    .where(where)
    .orderBy(desc(discountOffers.updatedAt))
    .limit(limit)
    .offset((page - 1) * limit);

  if (offerRows.length === 0) {
    return {
      data: [],
      countsByActivationKind,
      pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
    };
  }

  const ids = offerRows.map((row) => row.id);
  const usageRows = await db.select().from(discountOfferUsage).where(
    sql`${discountOfferUsage.offerId} in (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})`
  );
  const usageByOffer = new Map(usageRows.map((row) => [row.offerId, row]));
  const revisionRows = await db
    .select()
    .from(discountOfferRevisions)
    .where(
      sql`${discountOfferRevisions.offerId} in (${sql.join(
        ids.map((id) => sql`${id}`),
        sql`, `
      )})`
    );
  const revisionIds = revisionRows.map((row) => row.id);
  const benefitRows =
    revisionIds.length === 0
      ? []
      : await db
          .select()
          .from(discountBenefits)
          .where(
            sql`${discountBenefits.revisionId} in (${sql.join(
              revisionIds.map((id) => sql`${id}`),
              sql`, `
            )})`
          );
  const benefitByRevision = new Map(
    benefitRows.map((row) => [row.revisionId, row])
  );

  const codeRows = await db
    .select({
      id: discountCodes.id,
      offerId: discountCodes.offerId,
      canonicalCode: discountCodes.canonicalCode,
      state: discountCodes.state,
      createdAt: discountCodes.createdAt,
    })
    .from(discountCodes)
    .where(
      sql`${discountCodes.offerId} in (${sql.join(
        ids.map((id) => sql`${id}`),
        sql`, `
      )})`
    )
    .orderBy(asc(discountCodes.createdAt), asc(discountCodes.canonicalCode));
  const codesByOffer = new Map<string, typeof codeRows>();
  for (const row of codeRows) {
    const list = codesByOffer.get(row.offerId) ?? [];
    list.push(row);
    codesByOffer.set(row.offerId, list);
  }

  const data = offerRows.map((offer): DiscountOfferSummaryDto => {
    const live = revisionRows.find((row) => row.id === offer.currentRevisionId);
    const draft = revisionRows.find(
      (row) => row.offerId === offer.id && row.publishedAt === null
    );
    return {
      id: offer.id,
      key: offer.key,
      activationKind: offer.activationKind,
      state: offer.state,
      version: offer.version,
      draftVersion: offer.draftVersion,
      policyVersion: offer.policyVersion,
      perClientLimit: offer.perClientLimit,
      quotaCount: offer.quotaCount,
      budgetAmount:
        offer.budgetAmount === null ? null : dbMoneyText(offer.budgetAmount),
      updatedAt: offer.updatedAt.toISOString(),
      capacitySummary: (() => {
        const usage = usageByOffer.get(offer.id);
        if (!usage) return null;
        const summary = capacitySummaryFor(offer, usage);
        if ((offer.quotaCount !== null && summary.heldCount + summary.consumedCount > offer.quotaCount)
          || (summary.availableAmount !== null && BigInt(summary.availableAmount) < BigInt(0))) return null;
        return summary;
      })(),
      liveRevision: live
        ? {
            id: live.id,
            revisionNo: live.revisionNo,
            kind: benefitByRevision.get(live.id)?.kind ?? null,
            scope: benefitByRevision.get(live.id)?.scope ?? null,
            name: live.name,
            minSubtotal:
              live.minSubtotal === null ? null : dbMoneyText(live.minSubtotal),
            startAt: iso(live.startAt),
            endAt: iso(live.endAt),
            fixedAmount: (() => {
              const benefit = benefitByRevision.get(live.id);
              return benefit && benefit.fixedAmount !== null
                ? dbMoneyText(benefit.fixedAmount)
                : null;
            })(),
            rate: (() => {
              const benefit = benefitByRevision.get(live.id);
              return benefit && benefit.rate !== null
                ? normalizeRateText(benefit.rate)
                : null;
            })(),
            capAmount: (() => {
              const benefit = benefitByRevision.get(live.id);
              return benefit && benefit.capAmount !== null
                ? dbMoneyText(benefit.capAmount)
                : null;
            })(),
          }
        : null,
      draftRevisionId: draft?.id ?? null,
      codes: (codesByOffer.get(offer.id) ?? []).map((row) => ({
        id: row.id,
        maskedCode: maskPromoCode(row.canonicalCode),
        state: row.state,
      })),
      codeCount: (codesByOffer.get(offer.id) ?? []).length,
    };
  });

  return {
    data,
    countsByActivationKind,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    },
  };
}

// =========================================================
// Draft save
// =========================================================

export interface DraftTermsInput {
  name: unknown;
  currency: unknown;
  minSubtotal: unknown;
  startAt?: unknown;
  endAt?: unknown;
  benefit: {
    kind: unknown;
    paramsVersion: unknown;
    fixedAmount?: unknown;
    rate?: unknown;
    capAmount?: unknown;
  };
}

export interface SaveDiscountOfferDraftInput {
  offerId: string;
  expectedOfferVersion: number;
  expectedDraftVersion: number;
  terms: DraftTermsInput;
}

export interface NormalizedDraftTerms {
  name: string;
  currency: "IDR";
  minSubtotal: string;
  startAt: Date | null;
  endAt: Date | null;
  benefit: NormalizedBenefitTerms;
}

const FIXED_BENEFIT_FIELDS = new Set(["kind", "paramsVersion", "fixedAmount"]);
const PERCENTAGE_BENEFIT_FIELDS = new Set([
  "kind",
  "paramsVersion",
  "rate",
  "capAmount",
]);
// Subsidi ongkir: hanya cap, tanpa rate/fixed goods (ticket 11).
const SHIPPING_BENEFIT_FIELDS = new Set(["kind", "paramsVersion", "capAmount"]);

/**
 * Strictly validate a complete draft. A draft may be saved while the Offer is
 * unlaunchable, but the SAVED terms themselves must be well-formed: unknown
 * benefit kinds/versions/fields/precision are refused instead of being stored
 * and defaulted to fixed goods later.
 */
export function validateDraftTerms(input: DraftTermsInput): NormalizedDraftTerms {
  if (typeof input.name !== "string") {
    throw inputInvalid("name must be a string");
  }
  const name = input.name.trim();
  if (name.length < 1 || name.length > 120) {
    throw inputInvalid("name must be 1..120 characters");
  }
  if (input.currency !== "IDR") {
    throw inputInvalid("currency must be IDR");
  }
  const minSubtotal = parseWholeRupiah(input.minSubtotal, "minSubtotal");
  const startAt = parseOptionalInstant(input.startAt, "startAt");
  const endAt = parseOptionalInstant(input.endAt, "endAt");
  if (startAt && endAt && startAt.getTime() >= endAt.getTime()) {
    throw inputInvalid("startAt must be earlier than endAt");
  }
  if (!input.benefit || typeof input.benefit !== "object") {
    throw inputInvalid("benefit is required");
  }
  for (const key of Object.keys(input.benefit)) {
    const allowed =
      input.benefit.kind === "fixed_goods"
        ? FIXED_BENEFIT_FIELDS
        : input.benefit.kind === "shipping"
          ? SHIPPING_BENEFIT_FIELDS
          : PERCENTAGE_BENEFIT_FIELDS;
    if (!allowed.has(key)) {
      throw inputInvalid(
        `benefit carries a field that does not belong to kind ${String(
          input.benefit.kind
        )}: ${key}`
      );
    }
  }
  // Bentuk payload per kind: field milik kind lain tidak pernah diteruskan ke
  // parser, sehingga tidak ada konversi diam-diam percentage → fixed.
  const payload =
    input.benefit.kind === "fixed_goods"
      ? {
          kind: input.benefit.kind,
          paramsVersion: input.benefit.paramsVersion,
          fixedAmount: input.benefit.fixedAmount,
        }
      : input.benefit.kind === "shipping"
        ? {
            kind: input.benefit.kind,
            paramsVersion: input.benefit.paramsVersion,
            // Cap ongkir WAJIB positif; form kosong bukan "tanpa cap".
            capAmount: input.benefit.capAmount,
          }
        : {
            kind: input.benefit.kind,
            paramsVersion: input.benefit.paramsVersion,
            rate: input.benefit.rate,
            // Cap "tidak diisi" pada form = tanpa cap; nilai lain tetap divalidasi
            // ketat (bukan pembulatan/default).
            capAmount:
              input.benefit.capAmount === undefined ? null : input.benefit.capAmount,
          };
  let parsed: ParsedOfferBenefit;
  try {
    parsed = parseOfferBenefit(payload);
  } catch (error) {
    throw inputInvalid(
      error instanceof Error ? error.message : "benefit is not supported"
    );
  }
  const benefit: NormalizedBenefitTerms =
    parsed.kind === "fixed_goods"
      ? {
          kind: "fixed_goods",
          paramsVersion: 1,
          fixedAmount: parsed.fixedAmount.toString(),
        }
      : parsed.kind === "shipping"
        ? {
            kind: "shipping",
            paramsVersion: 1,
            capAmount: parsed.capAmount.toString(),
          }
        : {
            kind: "percentage_goods",
            paramsVersion: 1,
            rate: parsed.ratePercent,
            capAmount:
              parsed.capAmount === null ? null : parsed.capAmount.toString(),
          };
  return {
    name,
    currency: "IDR",
    minSubtotal,
    startAt,
    endAt,
    benefit,
  };
}

function assertExpectedVersion(value: unknown, field: string): number {
  return requirePositiveInteger(value, field);
}

export async function saveDiscountOfferDraft(
  input: SaveDiscountOfferDraftInput,
  actorUserId: string
): Promise<DiscountOfferDetailDto> {
  await requireActiveContract();
  const offerId = requireId(input.offerId, "offerId");
  const expectedOfferVersion = assertExpectedVersion(
    input.expectedOfferVersion,
    "expectedOfferVersion"
  );
  const expectedDraftVersion = assertExpectedVersion(
    input.expectedDraftVersion,
    "expectedDraftVersion"
  );
  const terms = validateDraftTerms(input.terms);

  try {
    return await beginBoundedTransaction(async (tx) => {
      const actor = requireDiscountEditor(
        await loadActorPolicyInTransaction(tx, actorUserId)
      );

      const aggregate = await loadOfferAggregate(tx, offerId, {
        forUpdate: true,
      });
      if (!aggregate) {
        throw new DiscountAdministrationError(
          404,
          "NOT_FOUND",
          "Offer not found"
        );
      }
      const { offer } = aggregate;
      if (
        offer.version !== expectedOfferVersion ||
        offer.draftVersion !== expectedDraftVersion
      ) {
        throw new DiscountAdministrationError(
          409,
          "STALE_REVISION",
          "The Offer changed since it was loaded; reload before editing"
        );
      }

      const draft = aggregate.revisions.find((row) => row.publishedAt === null);
      const now = new Date();
      let draftRevisionId: string;
      if (draft) {
        await tx
          .update(discountOfferRevisions)
          .set({
            name: terms.name,
            currency: terms.currency,
            minSubtotal: terms.minSubtotal,
            startAt: terms.startAt,
            endAt: terms.endAt,
            draftVersion: draft.draftVersion + 1,
            updatedAt: now,
          })
          .where(eq(discountOfferRevisions.id, draft.id));
        draftRevisionId = draft.id;
      } else {
        // Publishing consumed the previous draft: the next edit starts a new
        // unpublished revision on top of the immutable live one.
        const maxRevision = aggregate.revisions.reduce(
          (max, row) => (row.revisionNo > max ? row.revisionNo : max),
          0
        );
        draftRevisionId = randomUUID();
        await tx.insert(discountOfferRevisions).values({
          id: draftRevisionId,
          offerId,
          revisionNo: maxRevision + 1,
          name: terms.name,
          currency: terms.currency,
          minSubtotal: terms.minSubtotal,
          startAt: terms.startAt,
          endAt: terms.endAt,
          schemaVersion: OFFER_SCHEMA_VERSION,
          engineVersion: OFFER_ENGINE_VERSION,
          draftVersion: 1,
          publishedAt: null,
          actorId: actorUserId,
          actorIdentity: actorUserId,
          createdAt: now,
          updatedAt: now,
        });
      }

      await tx
        .insert(discountBenefits)
        .values({
          id: randomUUID(),
          revisionId: draftRevisionId,
          ...benefitColumns(terms.benefit),
          paramsVersion: 1,
          createdAt: now,
        })
        .onConflictDoUpdate({
          target: discountBenefits.revisionId,
          set: {
            ...benefitColumns(terms.benefit),
            paramsVersion: 1,
          },
        });

      await tx
        .update(discountOffers)
        .set({ draftVersion: offer.draftVersion + 1, updatedAt: now })
        .where(eq(discountOffers.id, offerId));

      await writeAuditEvent(tx, {
        actorId: actorUserId,
        actorIdentity: actorUserId,
        action: SAVE_DRAFT_AUDIT_ACTION,
        entityType: "discount_offer",
        entityId: offerId,
        changes: {
          draftRevisionId,
          draftVersionAfter: offer.draftVersion + 1,
          terms: {
            name: terms.name,
            currency: terms.currency,
            minSubtotal: terms.minSubtotal,
            startAt: terms.startAt?.toISOString() ?? null,
            endAt: terms.endAt?.toISOString() ?? null,
            benefit: terms.benefit,
          },
          policyVersionAfter: offer.policyVersion,
        },
        policyVersion: actor.policyVersion,
        branchScope: "global",
      });

      const detail = await readDetailDto(tx, offerId, true);
      if (!detail) throw new Error("Offer disappeared after draft save");
      return detail;
    });
  } catch (error) {
    throw mapDatabaseError(error);
  }
}

// =========================================================
// Review (read-only, server-bound fingerprint)
// =========================================================

export interface ReviewDiscountOfferInput {
  offerId: string;
  expectedOfferVersion: number;
  expectedDraftVersion: number;
  /** Usulan kode manual yang ikut direview (reservasi hanya saat publish). */
  proposedCodes?: unknown;
}

export interface ReviewDiffEntry {
  field: string;
  live: unknown;
  draft: unknown;
}

export interface ReviewDiscountOfferResult {
  offerId: string;
  offerVersion: number;
  draftVersion: number;
  policyVersion: number;
  liveRevisionId: string | null;
  draftRevisionId: string;
  stateAfter: string;
  validations: ReviewValidation[];
  canPublish: boolean;
  fingerprint: string;
  /** Usulan kode yang ikut di fingerprint publish; kosong untuk Offer publik. */
  proposedCodes: string[];
  diff: {
    terms: ReviewDiffEntry[];
    benefit: { live: unknown; draft: unknown };
    capacity: { live: unknown; draft: unknown };
  };
  /** Explicit: a review is not a quote, an order or a capacity reservation. */
  simulation: false;
  notice: string;
}

/** Kolom `discount_benefit` untuk satu bentuk benefit; field kind lain di-null-kan
 * supaya upsert draft tidak meninggalkan sisa bentuk sebelumnya. */
function benefitColumns(benefit: NormalizedBenefitTerms) {
  if (benefit.kind === "fixed_goods") {
    return {
      kind: "fixed_goods" as const,
      scope: "goods" as const,
      fixedAmount: benefit.fixedAmount,
      rate: null,
      capAmount: null,
    };
  }
  if (benefit.kind === "shipping") {
    return {
      kind: "shipping" as const,
      scope: "shipping" as const,
      fixedAmount: null,
      rate: null,
      capAmount: benefit.capAmount,
    };
  }
  return {
    kind: "percentage_goods" as const,
    scope: "goods" as const,
    fixedAmount: null,
    rate: benefit.rate,
    capAmount: benefit.capAmount,
  };
}

function draftTermsFrom(revision: RevisionRow, benefit: BenefitRow | null): RevisionTerms {
  if (
    revision.name === null ||
    revision.currency === null ||
    revision.minSubtotal === null ||
    benefit === null
  ) {
    throw new DiscountAdministrationError(
      409,
      "OFFER_NOT_PUBLISHABLE",
      "The draft is incomplete; save its terms and benefit before review"
    );
  }
  return {
    name: revision.name,
    currency: revision.currency as "IDR",
    minSubtotal: revision.minSubtotal,
    startAt: iso(revision.startAt),
    endAt: iso(revision.endAt),
    benefit: benefitTermsFromRow(benefit),
  };
}

export async function reviewDiscountOffer(
  input: ReviewDiscountOfferInput,
  actorUserId: string
): Promise<ReviewDiscountOfferResult> {
  await requireActiveContract();
  const offerId = requireId(input.offerId, "offerId");
  const expectedOfferVersion = assertExpectedVersion(
    input.expectedOfferVersion,
    "expectedOfferVersion"
  );
  const expectedDraftVersion = assertExpectedVersion(
    input.expectedDraftVersion,
    "expectedDraftVersion"
  );
  requireDiscountEditor(await loadPolicy(actorUserId));

  const aggregate = await loadOfferAggregate(db, offerId);
  if (!aggregate) {
    throw new DiscountAdministrationError(404, "NOT_FOUND", "Offer not found");
  }
  const { offer } = aggregate;
  if (
    offer.version !== expectedOfferVersion ||
    offer.draftVersion !== expectedDraftVersion
  ) {
    throw new DiscountAdministrationError(
      409,
      "STALE_REVISION",
      "The Offer changed since it was loaded; reload before reviewing"
    );
  }
  const draft = aggregate.revisions.find((row) => row.publishedAt === null);
  if (!draft) {
    throw new DiscountAdministrationError(
      409,
      "OFFER_NOT_PUBLISHABLE",
      "There is no draft revision to review"
    );
  }
  const draftBenefit =
    aggregate.benefits.find((row) => row.revisionId === draft.id) ?? null;
  const proposedCodes = normalizeCodeProposals(
    input.proposedCodes,
    offer.activationKind
  );
  const live = aggregate.revisions.find(
    (row) => row.id === offer.currentRevisionId
  );
  const liveBenefit = live
    ? aggregate.benefits.find((row) => row.revisionId === live.id) ?? null
    : null;

  const validations = validatePublishable({
    offer,
    draft,
    benefit: draftBenefit,
  });
  const canPublish = validations.every((row) => row.ok);
  const stateAfter = offer.state === "draft" ? "enabled" : offer.state;

  const terms = canPublish
    ? draftTermsFrom(draft, draftBenefit)
    : null;
  const fingerprint = terms
    ? publishReviewFingerprint({
        offerId,
        offerVersion: offer.version,
        draftVersion: offer.draftVersion,
        policyVersion: offer.policyVersion,
        liveRevisionId: offer.currentRevisionId,
        draftRevisionId: draft.id,
        stateAfter,
        terms,
        capacity: {
          quotaCount: offer.quotaCount,
          budgetAmount: offer.budgetAmount,
          perClientLimit: offer.perClientLimit,
        },
        proposedCodes,
      })
    : "";

  const termsDiff: ReviewDiffEntry[] = [
    { field: "name", live: live?.name ?? null, draft: draft.name },
    { field: "currency", live: live?.currency ?? null, draft: draft.currency },
    {
      field: "minSubtotal",
      live: live?.minSubtotal ?? null,
      draft: draft.minSubtotal,
    },
    { field: "startAt", live: iso(live?.startAt), draft: iso(draft.startAt) },
    { field: "endAt", live: iso(live?.endAt), draft: iso(draft.endAt) },
  ];

  return {
    offerId,
    offerVersion: offer.version,
    draftVersion: offer.draftVersion,
    policyVersion: offer.policyVersion,
    liveRevisionId: offer.currentRevisionId,
    draftRevisionId: draft.id,
    stateAfter,
    validations,
    canPublish,
    fingerprint,
    proposedCodes,
    diff: {
      terms: termsDiff,
      benefit: {
        live: liveBenefit ? toBenefitDto(liveBenefit) : null,
        draft: draftBenefit ? toBenefitDto(draftBenefit) : null,
      },
      capacity: {
        live: {
          quotaCount: offer.quotaCount,
          budgetAmount: offer.budgetAmount,
          perClientLimit: offer.perClientLimit,
        },
        draft: {
          quotaCount: offer.quotaCount,
          budgetAmount: offer.budgetAmount,
          perClientLimit: offer.perClientLimit,
        },
      },
    },
    simulation: false,
    notice:
      "Review tidak menerbitkan Offer, tidak menahan kapasitas, dan bukan quote atau order.",
  };
}

// =========================================================
// Publish
// =========================================================

export interface PublishDiscountOfferInput {
  offerId: string;
  requestKey: string;
  expectedOfferVersion: number;
  expectedDraftVersion: number;
  expectedPolicyVersion: number;
  reviewFingerprint: string;
  /**
   * Usulan kode manual untuk direservasi pada commit publish. Harus persis
   * usulan yang direview (terikat fingerprint), dan hanya sah untuk Offer
   * manual_only.
   */
  proposedCodes?: unknown;
}

export interface PublishDiscountOfferResult {
  status: 200;
  data: DiscountOfferDetailDto;
  replayed: boolean;
}

export async function publishDiscountOffer(
  input: PublishDiscountOfferInput,
  actorUserId: string
): Promise<PublishDiscountOfferResult> {
  await requireActiveContract();
  const offerId = requireId(input.offerId, "offerId");
  if (typeof input.requestKey !== "string" || !UUID_PATTERN.test(input.requestKey)) {
    throw inputInvalid("requestKey must be a UUID");
  }
  const expectedOfferVersion = assertExpectedVersion(
    input.expectedOfferVersion,
    "expectedOfferVersion"
  );
  const expectedDraftVersion = assertExpectedVersion(
    input.expectedDraftVersion,
    "expectedDraftVersion"
  );
  const expectedPolicyVersion = assertExpectedVersion(
    input.expectedPolicyVersion,
    "expectedPolicyVersion"
  );
  if (
    typeof input.reviewFingerprint !== "string" ||
    !/^[0-9a-f]{64}$/.test(input.reviewFingerprint)
  ) {
    throw inputInvalid("reviewFingerprint must be a SHA-256 hex digest");
  }
  const requestKey = input.requestKey;

  try {
    return await beginBoundedTransaction(async (tx) => {
      const actor = requireDiscountEditor(
        await loadActorPolicyInTransaction(tx, actorUserId)
      );

      // Review fingerprint is part of the command: the same key + a changed
      // review is a conflict, never a publish of unreviewed terms.
      const fingerprint = createHash("sha256")
        .update(
          JSON.stringify({
            action: PUBLISH_ACTION,
            reviewFingerprint: input.reviewFingerprint,
          }),
          "utf8"
        )
        .digest("hex");

      const existing = await tx
        .select()
        .from(discountAdminRequests)
        .where(
          and(
            eq(discountAdminRequests.actorIdentity, actorUserId),
            eq(discountAdminRequests.requestKey, requestKey)
          )
        )
        .for("update")
        .limit(1);
      if (existing.length > 0) {
        const receipt = existing[0];
        if (receipt.fingerprint !== fingerprint) {
          throw new DiscountAdministrationError(
            409,
            "REQUEST_KEY_CONFLICT",
            "This request key was already used with a different publish command"
          );
        }
        if (!receipt.targetId) {
          throw new Error("Accepted publish receipt has no target Offer");
        }
        const replayed = await readDetailDto(tx, receipt.targetId, true);
        if (!replayed) {
          throw new Error("Accepted publish receipt names a missing Offer");
        }
        return { status: 200 as const, data: replayed, replayed: true };
      }

      const aggregate = await loadOfferAggregate(tx, offerId, {
        forUpdate: true,
      });
      if (!aggregate) {
        throw new DiscountAdministrationError(
          404,
          "NOT_FOUND",
          "Offer not found"
        );
      }
      const { offer } = aggregate;
      if (
        offer.version !== expectedOfferVersion ||
        offer.draftVersion !== expectedDraftVersion ||
        offer.policyVersion !== expectedPolicyVersion
      ) {
        throw new DiscountAdministrationError(
          409,
          "STALE_REVISION",
          "The Offer changed since review; reload and review again"
        );
      }
      const draft = aggregate.revisions.find((row) => row.publishedAt === null);
      if (!draft) {
        throw new DiscountAdministrationError(
          409,
          "OFFER_NOT_PUBLISHABLE",
          "There is no draft revision to publish"
        );
      }

      // Ticket 12 — publishing can change capacity/terms, so a drifted
      // projection fails closed here too (never an online counter rebuild).
      const publishDrift = await detectOfferUsageDrift(tx, offerId);
      if (publishDrift.detected) {
        throw new DiscountAdministrationError(
          409,
          "USAGE_DRIFT_REVIEW",
          "Usage projection disagrees with the Redemption ledger; review before publishing"
        );
      }
      const draftBenefit =
        aggregate.benefits.find((row) => row.revisionId === draft.id) ?? null;

      const validations = validatePublishable({
        offer,
        draft,
        benefit: draftBenefit,
      });
      const failed = validations.filter((row) => !row.ok);
      if (failed.length > 0) {
        throw new DiscountAdministrationError(
          409,
          "OFFER_NOT_PUBLISHABLE",
          `The draft cannot be published: ${failed.map((row) => row.code).join(", ")}`
        );
      }

      const stateAfter = offer.state === "draft" ? "enabled" : offer.state;
      const terms = draftTermsFrom(draft, draftBenefit);
      // Usulan kode direservasi HANYA pada commit publish ini; bentuknya harus
      // persis usulan yang direview (fingerprint) dan hanya sah untuk Offer
      // manual_only.
      const proposedCodes = normalizeCodeProposals(
        input.proposedCodes,
        offer.activationKind
      );
      const recomputed = publishReviewFingerprint({
        offerId,
        offerVersion: offer.version,
        draftVersion: offer.draftVersion,
        policyVersion: offer.policyVersion,
        liveRevisionId: offer.currentRevisionId,
        draftRevisionId: draft.id,
        stateAfter,
        terms,
        capacity: {
          quotaCount: offer.quotaCount,
          budgetAmount: offer.budgetAmount,
          perClientLimit: offer.perClientLimit,
        },
        proposedCodes,
      });
      if (recomputed !== input.reviewFingerprint) {
        throw new DiscountAdministrationError(
          409,
          "STALE_REVISION",
          "The reviewed draft changed; reload and review again"
        );
      }

      const now = new Date();
      const publishedCodeIds: string[] = [];
      for (const canonical of proposedCodes) {
        const codeId = randomUUID();
        const inserted = await tx
          .insert(discountCodes)
          .values({
            id: codeId,
            offerId,
            activationKind: "manual_only",
            canonicalCode: canonical,
            state: "active",
            version: 1,
            publishedAt: now,
            actorId: actorUserId,
            actorIdentity: actorUserId,
            createdAt: now,
            updatedAt: now,
          })
          .onConflictDoNothing({ target: discountCodes.canonicalCode })
          .returning({ id: discountCodes.id });
        if (inserted.length === 0) throw new CodeCanonicalConflict();
        publishedCodeIds.push(codeId);
      }
      await tx
        .update(discountOfferRevisions)
        .set({ publishedAt: now, updatedAt: now })
        .where(eq(discountOfferRevisions.id, draft.id));
      await tx
        .update(discountOffers)
        .set({
          state: stateAfter,
          currentRevisionId: draft.id,
          version: offer.version + 1,
          updatedAt: now,
        })
        .where(eq(discountOffers.id, offerId));

      const detail = await readDetailDto(tx, offerId, true);
      if (!detail) throw new Error("Offer disappeared after publish");

      await tx.insert(discountAdminRequests).values({
        id: randomUUID(),
        actorIdentity: actorUserId,
        requestKey,
        fingerprint,
        action: PUBLISH_ACTION,
        targetId: offerId,
        version: detail.version,
        resultJson: sanitizeDetailForReceipt(detail),
        actorId: actorUserId,
        createdAt: now,
      });

      await writeAuditEvent(tx, {
        actorId: actorUserId,
        actorIdentity: actorUserId,
        action: PUBLISH_AUDIT_ACTION,
        entityType: "discount_offer",
        entityId: offerId,
        changes: {
          requestKey,
          fromState: offer.state,
          toState: stateAfter,
          fromRevisionId: offer.currentRevisionId,
          toRevisionId: draft.id,
          revisionNo: draft.revisionNo,
          terms,
          capacity: {
            quotaCount: offer.quotaCount,
            budgetAmount: offer.budgetAmount,
            perClientLimit: offer.perClientLimit,
          },
          reviewFingerprint: input.reviewFingerprint,
          policyVersionAfter: offer.policyVersion,
          codes: publishedCodeIds.map((codeId, index) => ({
            codeId,
            maskedCode: maskPromoCode(proposedCodes[index] ?? ""),
          })),
        },
        policyVersion: actor.policyVersion,
        branchScope: "global",
      });

      return { status: 200 as const, data: detail, replayed: false };
    });
  } catch (error) {
    if (error instanceof CodeCanonicalConflict || isCanonicalUniqueViolation(error)) {
      throw new DiscountAdministrationError(
        409,
        "CODE_CONFLICT",
        "Kode ini sudah direservasi Offer lain"
      );
    }
    throw mapDatabaseError(error);
  }
}

// =========================================================
// Simulation
// =========================================================

export interface SimulationLineInput {
  variantId: string;
  unitPrice: string | number;
  quantity: number;
}

export interface SimulateDiscountOfferInput {
  offerId: string;
  expectedDraftVersion: number;
  lines: SimulationLineInput[];
  fulfillmentMethod: "pickup" | "delivery";
  /** Customer-facing shipping before any subsidy; pickup must be 0. */
  shippingCost?: string | number;
}

export interface SimulationBreakdownDto {
  subtotal: string;
  goodsDiscount: string;
  netGoods: string;
  shippingBeforeSubsidy: string;
  shippingSubsidy: string;
  shippingNet: string;
  taxableBase: string;
  ppnRatePercent: string;
  ppnAmount: string;
  total: string;
  expectedProviderPayable: string;
  lines: Array<{
    variantId: string;
    quantity: number;
    sourceUnitPrice: string;
    effectiveUnitPrice: string;
    markdownAmount: string;
    netLineAmount: string;
    goodsDiscountAmount: string;
  }>;
}

export interface SimulateDiscountOfferResult {
  simulation: true;
  offerId: string;
  draftRevisionId: string;
  draftVersion: number;
  benefit: OfferBenefitInput;
  applied: boolean;
  eligible: boolean;
  minSubtotal: string;
  breakdown: SimulationBreakdownDto;
  notice: string;
}

function normalizeSimulationLines(
  lines: readonly SimulationLineInput[]
): SimulationLineInput[] {
  if (!Array.isArray(lines) || lines.length < 1 || lines.length > 50) {
    throw inputInvalid("lines must contain 1..50 rows");
  }
  const seen = new Set<string>();
  return lines.map((line) => {
    const variantId = requireId(line.variantId, "lines[].variantId");
    if (seen.has(variantId)) {
      throw inputInvalid("lines[].variantId must be unique");
    }
    seen.add(variantId);
    return {
      variantId,
      unitPrice: parseWholeRupiah(line.unitPrice, "lines[].unitPrice", {
        allowZero: false,
      }),
      quantity: requirePageInteger(line.quantity, "lines[].quantity", 99),
    };
  });
}

async function readPpnRatePercent(): Promise<string> {
  const rows = await db
    .select({ value: systemConfig.value })
    .from(systemConfig)
    .where(eq(systemConfig.key, PPN_CONFIG_KEY))
    .limit(1);
  const raw = rows[0]?.value?.trim();
  if (!raw || !/^\d{1,2}(\.\d{1,6})?$/.test(raw)) {
    return FALLBACK_PPN_RATE_PERCENT;
  }
  return raw;
}

function toBreakdown(snapshot: PricingSnapshot): SimulationBreakdownDto {
  return {
    subtotal: snapshot.subtotal,
    goodsDiscount: snapshot.goodsDiscount,
    netGoods: snapshot.netGoods,
    shippingBeforeSubsidy: snapshot.shippingBeforeSubsidy,
    shippingSubsidy: snapshot.shippingSubsidy,
    shippingNet: snapshot.shippingCost,
    taxableBase: snapshot.taxableBase,
    ppnRatePercent: snapshot.ppnRatePercent,
    ppnAmount: snapshot.ppnAmount,
    total: snapshot.total,
    expectedProviderPayable: snapshot.expectedProviderPayable,
    lines: snapshot.lines.map((line) => ({
      variantId: line.variantId,
      quantity: line.quantity,
      sourceUnitPrice: line.sourceUnitPrice,
      effectiveUnitPrice: line.effectiveUnitPrice,
      markdownAmount: line.markdownAmount,
      netLineAmount: line.netLineAmount,
      goodsDiscountAmount: line.goodsDiscountAmount,
    })),
  };
}

export async function simulateDiscountOffer(
  input: SimulateDiscountOfferInput,
  actorUserId: string
): Promise<SimulateDiscountOfferResult> {
  await requireActiveContract();
  const offerId = requireId(input.offerId, "offerId");
  const expectedDraftVersion = assertExpectedVersion(
    input.expectedDraftVersion,
    "expectedDraftVersion"
  );
  requireDiscountEditor(await loadPolicy(actorUserId));

  if (input.fulfillmentMethod !== "pickup" && input.fulfillmentMethod !== "delivery") {
    throw inputInvalid("fulfillmentMethod must be pickup or delivery");
  }
  const lines = normalizeSimulationLines(input.lines);
  const shipping =
    input.fulfillmentMethod === "pickup"
      ? "0"
      : parseWholeRupiah(input.shippingCost ?? "0", "shippingCost");

  const aggregate = await loadOfferAggregate(db, offerId);
  if (!aggregate) {
    throw new DiscountAdministrationError(404, "NOT_FOUND", "Offer not found");
  }
  const { offer } = aggregate;
  if (offer.draftVersion !== expectedDraftVersion) {
    throw new DiscountAdministrationError(
      409,
      "STALE_REVISION",
      "The draft changed since it was loaded; reload before simulating"
    );
  }
  const draft = aggregate.revisions.find((row) => row.publishedAt === null);
  const revision = draft ?? aggregate.revisions.find(
    (row) => row.id === offer.currentRevisionId
  );
  if (!revision) {
    throw new DiscountAdministrationError(
      409,
      "OFFER_NOT_PUBLISHABLE",
      "There are no terms to simulate yet"
    );
  }
  const benefitRow =
    aggregate.benefits.find((row) => row.revisionId === revision.id) ?? null;
  if (!benefitRow) {
    throw new DiscountAdministrationError(
      409,
      "OFFER_NOT_PUBLISHABLE",
      "Simulation needs a version1 goods benefit on the draft"
    );
  }
  // Bentuk benefit yang tidak didukung tidak pernah disimulasikan sebagai fixed:
  // parsernya gagal tertutup, sama seperti publish/evaluasi.
  const benefit = benefitTermsFromRow(benefitRow);
  const parsedBenefit = tryParseOfferBenefit(benefit);
  if (!parsedBenefit) {
    throw new DiscountAdministrationError(
      409,
      "OFFER_NOT_PUBLISHABLE",
      "Simulation needs a version1 benefit on the draft"
    );
  }
  const ppnRatePercent = await readPpnRatePercent();
  const pricingLines = lines.map((line) => ({
    variantId: line.variantId,
    quantity: line.quantity,
    sourceUnitPrice: line.unitPrice,
    effectiveUnitPrice: line.unitPrice,
    markdownRevisionId: null,
  }));

  // Baseline first: the minimum-subtotal eligibility gate is applied to the
  // subtotal AFTER Markdown, and an ineligible simulation must not show a
  // discount the customer would never receive.
  const baseline = buildPricingSnapshot({
    fulfillmentMethod: input.fulfillmentMethod,
    ppnRatePercent,
    lines: pricingLines,
    shippingBeforeSubsidy: shipping,
    providerQuotedShippingCost: shipping,
  });
  const minSubtotal = revision.minSubtotal ?? "0";
  const subtotal = dbMoneyToBigInt(baseline.subtotal, "subtotal");
  const minimumMet = subtotal >= dbMoneyToBigInt(minSubtotal, "minSubtotal");
  // Benefit yang dibulatkan menjadi0 (mis. subtotal50 rate1%) atau subsidi
  // ongkir pada pickup/ongkir0 tidak pernah diterapkan; simulasi menampilkan
  // baseline tanpa diskon (disabled dengan alasan), bukan memaksa nominal.
  let benefitAmount = BigInt(0);
  try {
    benefitAmount = offerBenefitAmount(parsedBenefit, {
      subtotal,
      fulfillmentMethod: input.fulfillmentMethod,
      shippingBeforeSubsidy: shipping,
    });
  } catch {
    benefitAmount = BigInt(0);
  }
  const eligible = minimumMet && benefitAmount > BigInt(0);
  const snapshot = eligible
    ? evaluatePricing({
        fulfillmentMethod: input.fulfillmentMethod,
        ppnRatePercent,
        lines: pricingLines,
        shippingBeforeSubsidy: shipping,
        providerQuotedShippingCost: shipping,
        benefit,
      })
    : baseline;

  return {
    simulation: true,
    offerId,
    draftRevisionId: revision.id,
    draftVersion: offer.draftVersion,
    benefit,
    applied: eligible,
    eligible,
    minSubtotal: dbMoneyText(minSubtotal),
    breakdown: toBreakdown(snapshot),
    notice:
      "Simulasi admin: bukan quote, bukan order, tidak menahan stok atau kapasitas, dan tidak menjanjikan ketersediaan kuota/budget.",
  };
}

// =========================================================
// State transitions
// =========================================================

export type OfferLifecycleState = "enabled" | "paused" | "archived";

export interface SetDiscountOfferStateInput {
  offerId: string;
  requestKey: string;
  expectedVersion: number;
  state: OfferLifecycleState;
}

export interface SetDiscountOfferStateResult {
  data: DiscountOfferDetailDto;
  replayed: boolean;
}

export async function setDiscountOfferState(
  input: SetDiscountOfferStateInput,
  actorUserId: string
): Promise<SetDiscountOfferStateResult> {
  await requireActiveContract();
  const offerId = requireId(input.offerId, "offerId");
  if (typeof input.requestKey !== "string" || !UUID_PATTERN.test(input.requestKey)) {
    throw inputInvalid("requestKey must be a UUID");
  }
  const requestKey = input.requestKey;
  const expectedVersion = assertExpectedVersion(input.expectedVersion, "expectedVersion");
  if (!["enabled", "paused", "archived"].includes(input.state)) {
    throw inputInvalid("state must be enabled, paused, or archived");
  }

  try {
    return await beginBoundedTransaction(async (tx) => {
      const actor = requireDiscountEditor(
        await loadActorPolicyInTransaction(tx, actorUserId)
      );

      // Same receipt contract as publish: a lost response replays the committed
      // state change instead of repeating it, and the same key with a different
      // command is a conflict.
      const fingerprint = createHash("sha256")
        .update(
          JSON.stringify({
            action: STATE_ACTION,
            offerId,
            expectedVersion,
            state: input.state,
          }),
          "utf8"
        )
        .digest("hex");
      const existing = await tx
        .select()
        .from(discountAdminRequests)
        .where(
          and(
            eq(discountAdminRequests.actorIdentity, actorUserId),
            eq(discountAdminRequests.requestKey, requestKey)
          )
        )
        .for("update")
        .limit(1);
      if (existing.length > 0) {
        const receipt = existing[0];
        if (receipt.fingerprint !== fingerprint) {
          throw new DiscountAdministrationError(
            409,
            "REQUEST_KEY_CONFLICT",
            "This request key was already used with a different state command"
          );
        }
        if (!receipt.targetId) {
          throw new Error("Accepted state receipt has no target Offer");
        }
        const replayed = await readDetailDto(tx, receipt.targetId, true);
        if (!replayed) {
          throw new Error("Accepted state receipt names a missing Offer");
        }
        return { data: replayed, replayed: true };
      }

      const aggregate = await loadOfferAggregate(tx, offerId, { forUpdate: true });
      if (!aggregate) {
        throw new DiscountAdministrationError(404, "NOT_FOUND", "Offer not found");
      }
      const { offer } = aggregate;
      if (offer.version !== expectedVersion) {
        throw new DiscountAdministrationError(
          409,
          "STALE_REVISION",
          "The Offer changed since it was loaded; reload before changing state"
        );
      }
      if (offer.state === "archived") {
        throw new DiscountAdministrationError(
          409,
          "INVALID_STATE_TRANSITION",
          "An archived Offer is terminal"
        );
      }
      // draft → enabled is publication, not a state toggle; draft → paused has
      // no live terms to pause. Both are explicit refusals, never a silent
      // publish.
      if (offer.state === "draft" && input.state !== "archived") {
        throw new DiscountAdministrationError(
          409,
          "INVALID_STATE_TRANSITION",
          "A draft Offer must be published before it can be enabled or paused"
        );
      }

      const now = new Date();
      await tx
        .update(discountOffers)
        .set({ state: input.state, version: offer.version + 1, updatedAt: now })
        .where(eq(discountOffers.id, offerId));

      // Pausing/archiving never touches usage counters or the published
      // revision: history and capacity commitments survive (spec §7.1).
      await writeAuditEvent(tx, {
        actorId: actorUserId,
        actorIdentity: actorUserId,
        action: STATE_AUDIT_ACTION,
        entityType: "discount_offer",
        entityId: offerId,
        changes: {
          requestKey,
          fromState: offer.state,
          toState: input.state,
          currentRevisionId: offer.currentRevisionId,
          usagePreserved: aggregate.usage
            ? {
                reservedCount: aggregate.usage.reservedCount,
                consumedCount: aggregate.usage.consumedCount,
                reservedAmount: aggregate.usage.reservedAmount,
                consumedAmount: aggregate.usage.consumedAmount,
              }
            : null,
          policyVersionAfter: offer.policyVersion,
        },
        policyVersion: actor.policyVersion,
        branchScope: "global",
      });

      const detail = await readDetailDto(tx, offerId, true);
      if (!detail) throw new Error("Offer disappeared after state change");

      await tx.insert(discountAdminRequests).values({
        id: randomUUID(),
        actorIdentity: actorUserId,
        requestKey,
        fingerprint,
        action: STATE_ACTION,
        targetId: offerId,
        version: detail.version,
        resultJson: detail,
        actorId: actorUserId,
        createdAt: now,
      });

      return { data: detail, replayed: false };
    });
  } catch (error) {
    throw mapDatabaseError(error);
  }
}

// =========================================================
// Capacity / policy
// =========================================================

export interface SetDiscountOfferPolicyInput {
  offerId: string;
  requestKey: string;
  expectedOfferVersion: number;
  expectedPolicyVersion: number;
  quotaCount: number | null;
  budgetAmount: string | number | null;
  perClientLimit: number;
}

export interface SetDiscountOfferPolicyResult {
  data: DiscountOfferDetailDto;
  replayed: boolean;
}

export async function setDiscountOfferPolicy(
  input: SetDiscountOfferPolicyInput,
  actorUserId: string
): Promise<SetDiscountOfferPolicyResult> {
  await requireActiveContract();
  const offerId = requireId(input.offerId, "offerId");
  if (typeof input.requestKey !== "string" || !UUID_PATTERN.test(input.requestKey)) {
    throw inputInvalid("requestKey must be a UUID");
  }
  const requestKey = input.requestKey;
  const expectedOfferVersion = assertExpectedVersion(
    input.expectedOfferVersion,
    "expectedOfferVersion"
  );
  const expectedPolicyVersion = assertExpectedVersion(
    input.expectedPolicyVersion,
    "expectedPolicyVersion"
  );

  const quotaCount =
    input.quotaCount === null
      ? null
      : requirePositiveInteger(input.quotaCount, "quotaCount");
  const budgetAmount =
    input.budgetAmount === null
      ? null
      : parseWholeRupiah(input.budgetAmount, "budgetAmount");
  const perClientLimit = requirePositiveInteger(
    input.perClientLimit,
    "perClientLimit"
  );

  const fingerprint = createHash("sha256")
    .update(
      JSON.stringify({
        action: POLICY_ACTION,
        offerId,
        expectedOfferVersion,
        expectedPolicyVersion,
        quotaCount,
        budgetAmount,
        perClientLimit,
      }),
      "utf8"
    )
    .digest("hex");

  try {
    return await beginBoundedTransaction(async (tx) => {
      const actor = requireDiscountEditor(
        await loadActorPolicyInTransaction(tx, actorUserId)
      );

      const existing = await tx
        .select()
        .from(discountAdminRequests)
        .where(
          and(
            eq(discountAdminRequests.actorIdentity, actorUserId),
            eq(discountAdminRequests.requestKey, requestKey)
          )
        )
        .for("update")
        .limit(1);
      if (existing.length > 0) {
        const receipt = existing[0];
        if (receipt.fingerprint !== fingerprint) {
          throw new DiscountAdministrationError(
            409,
            "REQUEST_KEY_CONFLICT",
            "This request key was already used with a different policy command"
          );
        }
        if (!receipt.targetId) {
          throw new Error("Accepted policy receipt has no target Offer");
        }
        const replayed = await readDetailDto(tx, receipt.targetId, true);
        if (!replayed) {
          throw new Error("Accepted policy receipt names a missing Offer");
        }
        return { data: replayed, replayed: true };
      }

      const aggregate = await loadOfferAggregate(tx, offerId, { forUpdate: true });
      if (!aggregate) {
        throw new DiscountAdministrationError(404, "NOT_FOUND", "Offer not found");
      }
      const { offer, usage } = aggregate;
      if (
        offer.version !== expectedOfferVersion ||
        offer.policyVersion !== expectedPolicyVersion
      ) {
        throw new DiscountAdministrationError(
          409,
          "STALE_REVISION",
          "The Offer policy changed since it was loaded; reload before saving"
        );
      }

      const before: CapacitySnapshot = {
        quotaCount: offer.quotaCount,
        budgetAmount: offer.budgetAmount,
        perClientLimit: offer.perClientLimit,
      };
      const after: CapacitySnapshot = { quotaCount, budgetAmount, perClientLimit };
      const change = classifyCapacityChange(before, after);
      if (change.direction === "enlarge") {
        requireCapacityEditor(actor);
      }

      if (offer.state !== "draft" && after.quotaCount === null && after.budgetAmount === null) {
        throw new DiscountAdministrationError(
          409,
          "CAPACITY_REQUIREMENT",
          "A live Offer must keep at least one of quota or budget"
        );
      }

      const reservedCount = usage?.reservedCount ?? 0;
      const consumedCount = usage?.consumedCount ?? 0;
      const reservedAmount = dbMoneyToBigInt(
        usage?.reservedAmount ?? "0",
        "usage.reservedAmount"
      );
      const consumedAmount = dbMoneyToBigInt(
        usage?.consumedAmount ?? "0",
        "usage.consumedAmount"
      );

      // Ticket 12 — a drifting projection is NOT repaired online: it fails
      // closed for capacity-authority writes and is reviewed through the usage
      // reader. Pause/archive intentionally stays allowed as the safe action.
      const drift = await detectOfferUsageDrift(tx, offerId, {
        reservedCount,
        consumedCount,
        reservedAmount: reservedAmount.toString(),
        consumedAmount: consumedAmount.toString(),
      });
      if (drift.detected) {
        throw new DiscountAdministrationError(
          409,
          "USAGE_DRIFT_REVIEW",
          "Usage projection disagrees with the Redemption ledger; review before changing capacity"
        );
      }

      if (after.quotaCount !== null && after.quotaCount < reservedCount + consumedCount) {
        throw new DiscountAdministrationError(
          409,
          "CAPACITY_BELOW_COMMITMENTS",
          "Quota cannot be lower than the reserved + consumed count"
        );
      }
      if (
        after.budgetAmount !== null &&
        dbMoneyToBigInt(after.budgetAmount, "budgetAmount") <
          reservedAmount + consumedAmount
      ) {
        throw new DiscountAdministrationError(
          409,
          "CAPACITY_BELOW_COMMITMENTS",
          "Budget cannot be lower than the reserved + consumed amount"
        );
      }
      // Per-account reduction must clear every indexed client commitment under
      // the SAME Offer lock — no unbounded account-row scan and no per-account
      // lock (which could deadlock against a concurrent reservation).
      if (after.perClientLimit < before.perClientLimit) {
        const maxClientCommitment = await readMaxClientCommitment(tx, offerId);
        if (after.perClientLimit < maxClientCommitment) {
          throw new DiscountAdministrationError(
            409,
            "CAPACITY_BELOW_COMMITMENTS",
            "Per-account limit cannot be lower than the highest reserved + consumed commitment"
          );
        }
      }

      const now = new Date();
      await tx
        .update(discountOffers)
        .set({
          quotaCount: after.quotaCount,
          budgetAmount: after.budgetAmount,
          perClientLimit: after.perClientLimit,
          policyVersion: offer.policyVersion + 1,
          version: offer.version + 1,
          updatedAt: now,
        })
        .where(eq(discountOffers.id, offerId));

      await writeAuditEvent(tx, {
        actorId: actorUserId,
        actorIdentity: actorUserId,
        action: POLICY_AUDIT_ACTION,
        entityType: "discount_offer",
        entityId: offerId,
        changes: {
          requestKey,
          before,
          after,
          direction: change.direction,
          reasons: change.reasons,
          policyVersionAfter: offer.policyVersion + 1,
        },
        policyVersion: actor.policyVersion,
        branchScope: "global",
      });

      const detail = await readDetailDto(tx, offerId, true);
      if (!detail) throw new Error("Offer disappeared after policy change");

      await tx.insert(discountAdminRequests).values({
        id: randomUUID(),
        actorIdentity: actorUserId,
        requestKey,
        fingerprint,
        action: POLICY_ACTION,
        targetId: offerId,
        version: detail.version,
        resultJson: detail,
        actorId: actorUserId,
        createdAt: now,
      });

      return { data: detail, replayed: false };
    });
  } catch (error) {
    throw mapDatabaseError(error);
  }
}

