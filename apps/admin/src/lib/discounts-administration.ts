import { createHash, randomUUID } from "crypto";
import { and, asc, desc, eq, sql } from "drizzle-orm";

import { db } from "@/db";
import {
  adminRoleGrants,
  adminRoles,
  auditLogs,
  discountAdminRequests,
  discountBenefits,
  discountOfferRevisions,
  discountOffers,
  discountOfferUsage,
  systemConfig,
  users,
} from "@/db";
import type { Grant, GrantScope, ModuleKey } from "@marketplace/db/src/rbac/catalog";
import {
  MAX_MONEY_RUPIAH,
  buildPricingSnapshot,
  type PricingSnapshot,
} from "@marketplace/db/src/versioned-pricing";
import {
  evaluatePricing,
  type FixedGoodsBenefitInput,
} from "@marketplace/db/src/discount-pricing";
import { authorizeLoaded, loadPolicy, type LoadedPolicy } from "./rbac/resolver";
import {
  beginBoundedTransaction,
  hasGlobalGrant,
  loadActorPolicyInTransaction,
  type Executor,
} from "./admin-command";
import { writeAuditEvent } from "./rbac/audit-writer";

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
//   getDiscountOfferUsage()  — aggregate projection + capacity
//   getDiscountOfferHistory()— immutable audit trail for one Offer
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

export const CREATE_DRAFT_AUDIT_ACTION = "DISCOUNT_OFFER_DRAFT_CREATED";
export const SAVE_DRAFT_AUDIT_ACTION = "DISCOUNT_OFFER_DRAFT_SAVED";
export const PUBLISH_AUDIT_ACTION = "DISCOUNT_OFFER_PUBLISHED";
export const STATE_AUDIT_ACTION = "DISCOUNT_OFFER_STATE_CHANGED";
export const POLICY_AUDIT_ACTION = "DISCOUNT_OFFER_POLICY_CHANGED";

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
export function publicDraftCommandFingerprint(): string {
  const canonical = JSON.stringify({
    action: CREATE_DRAFT_ACTION,
    activationKind: "public",
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
  benefitFixedAmount: string;
}

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
      benefit: {
        kind: "fixed_goods",
        paramsVersion: 1,
        fixedAmount: input.terms.benefitFixedAmount,
      },
    },
    capacity: {
      quotaCount: input.capacity.quotaCount,
      budgetAmount: input.capacity.budgetAmount,
      perClientLimit: input.capacity.perClientLimit,
    },
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
  fixedAmount: string;
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
  usage: DiscountOfferUsageDto | null;
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
  liveRevision: {
    id: string;
    name: string | null;
    minSubtotal: string | null;
    startAt: string | null;
    endAt: string | null;
    fixedAmount: string | null;
  } | null;
  draftRevisionId: string | null;
}

type OfferRow = typeof discountOffers.$inferSelect;
type RevisionRow = typeof discountOfferRevisions.$inferSelect;
type BenefitRow = typeof discountBenefits.$inferSelect;
type UsageRow = typeof discountOfferUsage.$inferSelect;

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

/** Defensive predicate: a stored money value may be malformed in a fixture or
 * a future migration, and a review must report that instead of throwing. */
function isPositiveWholeMoney(value: string): boolean {
  try {
    const amount = dbMoneyToBigInt(value, "money");
    return amount > BigInt(0) && amount <= MAX_MONEY_RUPIAH;
  } catch {
    return false;
  }
}

function toBenefitDto(row: BenefitRow | undefined): DiscountBenefitDto | null {
  if (!row) return null;
  return {
    id: row.id,
    kind: row.kind,
    scope: row.scope,
    fixedAmount: dbMoneyText(row.fixedAmount),
    paramsVersion: row.paramsVersion,
  };
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

function toDetailDto(
  offer: OfferRow,
  revisions: readonly RevisionRow[],
  benefits: readonly BenefitRow[],
  usage: UsageRow | null
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
    usage: toUsageDto(usage),
  };
}

interface OfferAggregate {
  offer: OfferRow;
  revisions: RevisionRow[];
  benefits: BenefitRow[];
  usage: UsageRow | null;
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

  return { offer, revisions, benefits, usage: usageRows[0] ?? null };
}

async function readDetailDto(
  executor: Executor,
  offerId: string
): Promise<DiscountOfferDetailDto | null> {
  const aggregate = await loadOfferAggregate(executor, offerId);
  if (!aggregate) return null;
  return toDetailDto(
    aggregate.offer,
    aggregate.revisions,
    aggregate.benefits,
    aggregate.usage
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
    "state" | "quotaCount" | "budgetAmount" | "perClientLimit" | "currentRevisionId"
  >;
  draft: RevisionRow | null;
  benefit: BenefitRow | null;
}

/**
 * The publication completeness gate. A draft may be saved incomplete, but it
 * cannot be published until the terms, the fixed-goods benefit, the minimum
 * capacity bound and the time window are all valid. Returns the full list so
 * the admin review screen can show WHY a draft is not launchable.
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
    benefit.kind === "fixed_goods" &&
    benefit.scope === "goods" &&
    benefit.paramsVersion === 1 &&
    isPositiveWholeMoney(benefit.fixedAmount);
  validations.push({
    code: "BENEFIT_VALID",
    ok: benefitValid,
    message: benefitValid
      ? "Benefit fixed-goods dengan nominal positif valid"
      : "Tepat satu benefit fixed-goods dengan nominal positif wajib ada",
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

  // A public Offer has no customer-facing code. This slice cannot create one,
  // but the invariant is asserted on publish so a future code slice cannot
  // silently publish a public Offer with a code attached.
  validations.push({
    code: "CODE_FREE",
    ok: true,
    message: "Offer publik tidak memiliki kode kupon",
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
  if (input.activationKind !== "public") {
    throw inputInvalid("Only public Offers can be created by this endpoint");
  }
  return input.requestKey;
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
  const data = await readDetailDto(db, receipt.targetId);
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
  await requireActiveContract();
  const fingerprint = publicDraftCommandFingerprint();

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
        const replayed = await readDetailDto(tx, receipt.targetId);
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
        activationKind: "public",
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
      };

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
          resultJson: planned,
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

      // 4) Offer identity → one unpublished draft revision → zeroed usage.
      await tx.insert(discountOffers).values({
        id: offerId,
        key: planned.key,
        activationKind: "public",
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

      // 5) Immutable business audit in the SAME commit.
      await writeAuditEvent(tx, {
        actorId: actorUserId,
        action: CREATE_DRAFT_AUDIT_ACTION,
        entityType: "discount_offer",
        entityId: offerId,
        changes: {
          activationKind: "public",
          state: "draft",
          draftRevisionId: revisionId,
          revisionNo: 1,
          requestKey,
          quotaCount: null,
          budgetAmount: null,
          perClientLimit: DEFAULT_PER_CLIENT_LIMIT,
          policyVersionAfter: planned.policyVersion,
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
    throw mapDatabaseError(error);
  }
}

// =========================================================
// Detail / list reads
// =========================================================

/** Public detail read. Missing (or an id that is not an Offer) is null → 404. */
export async function getDiscountOfferDetail(
  offerId: string,
  actorUserId: string
): Promise<DiscountOfferDetailDto | null> {
  if (!offerId) return null;
  requireDiscountViewer(await loadPolicy(actorUserId));
  return readDetailDto(db, offerId);
}

export interface ListDiscountOffersInput {
  page?: number;
  limit?: number;
  state?: string;
}

export interface ListDiscountOffersResult {
  data: DiscountOfferSummaryDto[];
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
  const where = input.state
    ? eq(discountOffers.state, input.state)
    : undefined;

  const countRows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(discountOffers)
    .where(where);
  const total = countRows[0]?.count ?? 0;

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
      pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
    };
  }

  const ids = offerRows.map((row) => row.id);
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
      liveRevision: live
        ? {
            id: live.id,
            name: live.name,
            minSubtotal:
              live.minSubtotal === null ? null : dbMoneyText(live.minSubtotal),
            startAt: iso(live.startAt),
            endAt: iso(live.endAt),
            fixedAmount: (() => {
              const benefit = benefitByRevision.get(live.id);
              return benefit ? dbMoneyText(benefit.fixedAmount) : null;
            })(),
          }
        : null,
      draftRevisionId: draft?.id ?? null,
    };
  });

  return {
    data,
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
    fixedAmount: unknown;
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
  benefit: {
    kind: "fixed_goods";
    paramsVersion: 1;
    fixedAmount: string;
  };
}

/**
 * Strictly validate a complete draft. A draft may be saved while the Offer is
 * unlaunchable, but the SAVED terms themselves must be well-formed: unknown
 * benefit kinds/versions are refused instead of being stored and defaulted to
 * fixed goods later.
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
  if (input.benefit.kind !== "fixed_goods") {
    throw inputInvalid("benefit.kind is not supported by this deployment");
  }
  if (input.benefit.paramsVersion !== 1) {
    throw inputInvalid("benefit.paramsVersion is not supported");
  }
  const fixedAmount = parseWholeRupiah(
    input.benefit.fixedAmount,
    "benefit.fixedAmount",
    { allowZero: false }
  );
  return {
    name,
    currency: "IDR",
    minSubtotal,
    startAt,
    endAt,
    benefit: {
      kind: "fixed_goods",
      paramsVersion: 1,
      fixedAmount,
    },
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
          kind: "fixed_goods",
          scope: "goods",
          fixedAmount: terms.benefit.fixedAmount,
          paramsVersion: 1,
          createdAt: now,
        })
        .onConflictDoUpdate({
          target: discountBenefits.revisionId,
          set: {
            kind: "fixed_goods",
            scope: "goods",
            fixedAmount: terms.benefit.fixedAmount,
            paramsVersion: 1,
          },
        });

      await tx
        .update(discountOffers)
        .set({ draftVersion: offer.draftVersion + 1, updatedAt: now })
        .where(eq(discountOffers.id, offerId));

      await writeAuditEvent(tx, {
        actorId: actorUserId,
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

      const detail = await readDetailDto(tx, offerId);
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
  diff: {
    terms: ReviewDiffEntry[];
    benefit: { live: unknown; draft: unknown };
    capacity: { live: unknown; draft: unknown };
  };
  /** Explicit: a review is not a quote, an order or a capacity reservation. */
  simulation: false;
  notice: string;
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
    benefitFixedAmount: benefit.fixedAmount,
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
        const replayed = await readDetailDto(tx, receipt.targetId);
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
      });
      if (recomputed !== input.reviewFingerprint) {
        throw new DiscountAdministrationError(
          409,
          "STALE_REVISION",
          "The reviewed draft changed; reload and review again"
        );
      }

      const now = new Date();
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

      const detail = await readDetailDto(tx, offerId);
      if (!detail) throw new Error("Offer disappeared after publish");

      await tx.insert(discountAdminRequests).values({
        id: randomUUID(),
        actorIdentity: actorUserId,
        requestKey,
        fingerprint,
        action: PUBLISH_ACTION,
        targetId: offerId,
        version: detail.version,
        resultJson: detail,
        actorId: actorUserId,
        createdAt: now,
      });

      await writeAuditEvent(tx, {
        actorId: actorUserId,
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
  benefit: FixedGoodsBenefitInput;
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
  if (!benefitRow || benefitRow.kind !== "fixed_goods") {
    throw new DiscountAdministrationError(
      409,
      "OFFER_NOT_PUBLISHABLE",
      "Simulation needs a fixed-goods benefit on the draft"
    );
  }
  const benefit: FixedGoodsBenefitInput = {
    kind: "fixed_goods",
    paramsVersion: 1,
    fixedAmount: benefitRow.fixedAmount,
  };
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
  const eligible =
    dbMoneyToBigInt(baseline.subtotal, "subtotal") >=
    dbMoneyToBigInt(minSubtotal, "minSubtotal");
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
        const replayed = await readDetailDto(tx, receipt.targetId);
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

      const detail = await readDetailDto(tx, offerId);
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
        const replayed = await readDetailDto(tx, receipt.targetId);
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

      const detail = await readDetailDto(tx, offerId);
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

// =========================================================
// Usage + history reads
// =========================================================

export interface DiscountUsageResult {
  offerId: string;
  capacity: {
    quotaCount: number | null;
    budgetAmount: string | null;
    perClientLimit: number;
  };
  usage: DiscountOfferUsageDto | null;
  remaining: {
    count: number | null;
    amount: string | null;
  };
  note: string;
}

export async function getDiscountOfferUsage(
  offerId: string,
  actorUserId: string
): Promise<DiscountUsageResult> {
  const id = requireId(offerId, "offerId");
  requireDiscountViewer(await loadPolicy(actorUserId));
  const aggregate = await loadOfferAggregate(db, id);
  if (!aggregate) {
    throw new DiscountAdministrationError(404, "NOT_FOUND", "Offer not found");
  }
  const { offer, usage } = aggregate;
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
  return {
    offerId: offer.id,
    capacity: {
      quotaCount: offer.quotaCount,
      budgetAmount:
        offer.budgetAmount === null ? null : dbMoneyText(offer.budgetAmount),
      perClientLimit: offer.perClientLimit,
    },
    usage: toUsageDto(usage ?? null),
    remaining: {
      count:
        offer.quotaCount === null
          ? null
          : Math.max(0, offer.quotaCount - reservedCount - consumedCount),
      amount:
        offer.budgetAmount === null
          ? null
          : (
              dbMoneyToBigInt(offer.budgetAmount, "budgetAmount") -
              reservedAmount -
              consumedAmount
            ).toString(),
    },
    note:
      "Agregat global. Rincian per customer belum tersedia pada slice ini karena redemption belum diaktifkan.",
  };
}

export interface DiscountHistoryEntryDto {
  id: string;
  action: string;
  actorId: string | null;
  policyVersion: number | null;
  changes: unknown;
  createdAt: string;
}

export async function getDiscountOfferHistory(
  offerId: string,
  actorUserId: string
): Promise<DiscountHistoryEntryDto[]> {
  const id = requireId(offerId, "offerId");
  requireDiscountViewer(await loadPolicy(actorUserId));
  const offerRows = await db
    .select({ id: discountOffers.id })
    .from(discountOffers)
    .where(eq(discountOffers.id, id))
    .limit(1);
  if (offerRows.length === 0) {
    throw new DiscountAdministrationError(404, "NOT_FOUND", "Offer not found");
  }
  const rows = await db
    .select()
    .from(auditLogs)
    .where(
      and(
        eq(auditLogs.entityType, "discount_offer"),
        eq(auditLogs.entityId, id)
      )
    )
    .orderBy(desc(auditLogs.createdAt))
    .limit(100);
  return rows.map((row) => ({
    id: row.id,
    action: row.action,
    actorId: row.userId,
    policyVersion: row.policyVersion,
    changes: row.changes,
    createdAt: row.createdAt.toISOString(),
  }));
}
