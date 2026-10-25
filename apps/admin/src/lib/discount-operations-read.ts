import { and, desc, eq, sql } from "drizzle-orm";

import { db } from "@/db";
import {
  auditLogs,
  branches,
  clients,
  discountAdminRequests,
  discountCodes,
  discountOfferRevisions,
  discountOffers,
  discountOfferUsage,
  discountRedemptions,
  orders,
  users,
} from "@/db";
import { maskPromoCode } from "@marketplace/db/src/discount-code";
import type { BranchScope } from "@marketplace/db/src/rbac/catalog";
import { authorizeLoaded, loadPolicy, type LoadedPolicy } from "./rbac/resolver";
import { branchScopeFromAuthorization, type BranchPredicateScope } from "./rbac/branch-scope";
import { DiscountAdministrationError, type DiscountOfferUsageDto } from "./discounts-administration";
import {
  detectOfferUsageDrift,
  wholeRupiah,
  type UsageDriftReport,
} from "./discount-usage-drift";

// =========================================================
// Ops reads: Offer usage + immutable history (ticket 12)
// =========================================================
// The capacity authority is GLOBAL and stays global: one Offer has one
// projection row. The Redemption entries below are a SCOPED operational view
// (Orders grants + Home Branch), so a scoped list is never presented as if it
// equalled the global totals.
//
// Privacy rules (spec §7.3, §11):
//   - `discounts:view` alone yields the global aggregate only: no order ids,
//     customer identities, branch names, cursor or count that could disclose
//     another branch.
//   - Entries require `orders:view`; own-branch orders grants are pinned to the
//     server-trusted Home Branch. A direct entry id, a foreign `branchId`
//     filter or a manipulated page/count can never widen that predicate.
//   - Code labels are ALWAYS masked here (list/usage/history); the protected
//     editor interface (Offer detail) remains the only literal channel.
//   - Nothing in this module writes a counter, so a detected projection drift
//     is reported for review and is never reset/rebuild online.

const MAX_PAGE_SIZE = 50;
const UUID_PATTERN =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export type DiscountUsageEntryStatus = "reserved" | "consumed" | "released";
export type DiscountUsageEntryActivation = "public" | "manual_only";

export interface DiscountUsageAvailability {
  basis: "global";
  consumedCount: number;
  heldCount: number;
  consumedAmount: string;
  heldAmount: string;
  availableCount: number | null;
  availableAmount: string | null;
}

/**
 * Pure global capacity arithmetic (spec ticket 12 example):
 * quota100 / consumed90 / held10 → available0 and
 * budget100000 / consumed80000 / held20000 → available0. Unbounded stays
 * `null` (never a fabricated infinite number).
 */
export function computeAvailability(input: {
  quotaCount: number | null;
  budgetAmount: string | null;
  heldCount: number;
  consumedCount: number;
  heldAmount: string;
  consumedAmount: string;
}): DiscountUsageAvailability {
  return {
    basis: "global",
    consumedCount: input.consumedCount,
    heldCount: input.heldCount,
    consumedAmount: input.consumedAmount,
    heldAmount: input.heldAmount,
    availableCount:
      input.quotaCount === null
        ? null
        : Math.max(0, input.quotaCount - input.heldCount - input.consumedCount),
    availableAmount:
      input.budgetAmount === null
        ? null
        : (
            BigInt(input.budgetAmount) -
            BigInt(input.heldAmount) -
            BigInt(input.consumedAmount)
          ).toString(),
  };
}

export interface DiscountUsageFilters {
  page?: string | number | null;
  limit?: string | number | null;
  status?: string | null;
  activationKind?: string | null;
  /** Only honoured for an all-branch Orders grant; own-branch is pinned. */
  branchId?: string | null;
  /** Direct redemption id: scoped like every other entry, else 404. */
  entryId?: string | null;
}

export interface DiscountUsageEntryDto {
  id: string;
  orderId: string;
  status: DiscountUsageEntryStatus;
  activationKind: DiscountUsageEntryActivation;
  codeId: string | null;
  maskedCode: string | null;
  benefitAmount: string;
  revisionId: string;
  revisionNo: number;
  policyVersion: number;
  contractVersion: number;
  engineVersion: number;
  branch: { id: string; name: string } | null;
  customer: { id: string; name: string | null } | null;
  order: {
    status: string;
    paymentStatus: string;
    fulfillmentMethod: string;
    fulfillmentBlocked: boolean;
    fulfillmentBlockedReason: string | null;
  };
  review: {
    latePaidReview: boolean;
  };
  reservedAt: string;
  consumedAt: string | null;
  releasedAt: string | null;
  terminalReason: string | null;
  releaseSource: string | null;
}

export interface DiscountUsageResult {
  offerId: string;
  /** Global projection — the capacity authority, never the scoped list. */
  capacity: {
    quotaCount: number | null;
    budgetAmount: string | null;
    perClientLimit: number;
  };
  usage: DiscountOfferUsageDto | null;
  /**
   * Consumed + held (reserved) and what remains against the GLOBAL bounds.
   * `basis: "global"` is part of the wire contract so no client can mistake a
   * scoped entries page for the global totals.
   */
  availability: DiscountUsageAvailability;
  drift: UsageDriftReport;
  entriesAccess: "aggregate_only" | "scoped";
  scope: { mode: "all" } | { mode: "own"; branchId: string } | null;
  entries: {
    items: DiscountUsageEntryDto[];
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  } | null;
  note: string;
}

export interface DiscountHistoryActorDto {
  /** FK actor id, null after the Admin User row is gone. */
  id: string | null;
  /** Immutable identity string retained in the audit payload. */
  identity: string | null;
  /** Display name while the actor row still exists; never the email. */
  label: string | null;
  available: boolean;
}

export interface DiscountHistoryEntryDto {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  policyVersion: number | null;
  actor: DiscountHistoryActorDto;
  /** Actual revision/draft/code references carried by the stored audit row. */
  references: {
    revisionId: string | null;
    revisionNo: number | null;
    draftRevisionId: string | null;
    draftVersion: number | null;
    codeId: string | null;
    maskedCode: string | null;
  };
  changes: unknown;
  createdAt: string;
}

const deny = () =>
  new DiscountAdministrationError(
    403,
    "DENIED",
    "You do not have access to this resource"
  );

function requireViewer(loaded: LoadedPolicy | null): LoadedPolicy {
  if (!loaded) throw deny();
  const authorized = authorizeLoaded(loaded, "discounts", "view");
  if (!authorized.allowed) throw deny();
  return loaded;
}

function boundedPage(value: string | number | null | undefined): number {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

function boundedLimit(value: string | number | null | undefined): number {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return 20;
  return Math.min(parsed, MAX_PAGE_SIZE);
}

function isEntryStatus(value: unknown): value is DiscountUsageEntryStatus {
  return value === "reserved" || value === "consumed" || value === "released";
}

function isActivation(value: unknown): value is DiscountUsageEntryActivation {
  return value === "public" || value === "manual_only";
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function refString(changes: Record<string, unknown> | null, key: string): string | null {
  const value = changes?.[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function refNumber(changes: Record<string, unknown> | null, key: string): number | null {
  const value = changes?.[key];
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

/**
 * Resolve the Orders predicate for Redemption entries. `null` means the actor
 * holds no Orders:view grant: the reader then returns the global aggregate
 * only — there is no "view without grant" fallback that leaks identities.
 */
function resolveOrdersScope(loaded: LoadedPolicy): BranchPredicateScope | null {
  const ordersAuthorization = authorizeLoaded(loaded, "orders", "view");
  if (!ordersAuthorization.allowed) return null;
  return branchScopeFromAuthorization({
    allowed: true,
    scope: ordersAuthorization.scope as BranchScope | "global",
    homeBranchId: ordersAuthorization.homeBranchId,
  });
}

export async function readDiscountOfferUsage(input: {
  offerId: string;
  actorUserId: string;
  filters?: DiscountUsageFilters;
}): Promise<DiscountUsageResult> {
  const offerId = input.offerId;
  if (!UUID_PATTERN.test(offerId)) {
    throw new DiscountAdministrationError(404, "NOT_FOUND", "Offer not found");
  }
  const policy = requireViewer(await loadPolicy(input.actorUserId));

  const filters = input.filters ?? {};
  const status =
    filters.status === undefined || filters.status === null || filters.status === ""
      ? null
      : filters.status;
  if (status !== null && !isEntryStatus(status)) {
    throw new DiscountAdministrationError(
      400,
      "INPUT_INVALID",
      "Unknown usage status filter"
    );
  }
  const activationKind =
    filters.activationKind === undefined ||
    filters.activationKind === null ||
    filters.activationKind === ""
      ? null
      : filters.activationKind;
  if (activationKind !== null && !isActivation(activationKind)) {
    throw new DiscountAdministrationError(
      400,
      "INPUT_INVALID",
      "Unknown activation kind filter"
    );
  }

  const offerRows = await db
    .select({
      id: discountOffers.id,
      quotaCount: discountOffers.quotaCount,
      budgetAmount: discountOffers.budgetAmount,
      perClientLimit: discountOffers.perClientLimit,
    })
    .from(discountOffers)
    .where(eq(discountOffers.id, offerId))
    .limit(1);
  if (offerRows.length === 0) {
    throw new DiscountAdministrationError(404, "NOT_FOUND", "Offer not found");
  }
  const offer = offerRows[0];

  const usageRows = await db
    .select()
    .from(discountOfferUsage)
    .where(eq(discountOfferUsage.offerId, offerId))
    .limit(1);
  const usageRow = usageRows[0] ?? null;
  const projection = {
    reservedCount: usageRow?.reservedCount ?? 0,
    consumedCount: usageRow?.consumedCount ?? 0,
    reservedAmount: wholeRupiah(usageRow?.reservedAmount ?? "0", "reservedAmount"),
    consumedAmount: wholeRupiah(usageRow?.consumedAmount ?? "0", "consumedAmount"),
  };
  const drift = await detectOfferUsageDrift(db, offerId, projection);

  const budgetAmount =
    offer.budgetAmount === null ? null : wholeRupiah(offer.budgetAmount, "budgetAmount");
  const availability = computeAvailability({
    quotaCount: offer.quotaCount,
    budgetAmount,
    heldCount: projection.reservedCount,
    consumedCount: projection.consumedCount,
    heldAmount: projection.reservedAmount,
    consumedAmount: projection.consumedAmount,
  });

  const baseResult: DiscountUsageResult = {
    offerId: offer.id,
    capacity: {
      quotaCount: offer.quotaCount,
      budgetAmount,
      perClientLimit: offer.perClientLimit,
    },
    usage: usageRow
      ? {
          reservedCount: usageRow.reservedCount,
          consumedCount: usageRow.consumedCount,
          reservedAmount: projection.reservedAmount,
          consumedAmount: projection.consumedAmount,
          version: usageRow.version,
          updatedAt: usageRow.updatedAt.toISOString(),
        }
      : null,
    availability,
    drift,
    entriesAccess: "aggregate_only",
    scope: null,
    entries: null,
    note:
      "Agregat global adalah otoritas kapasitas. Rincian order/customer memerlukan grant Orders:view dan mengikuti scope cabang.",
  };

  const ordersScope = resolveOrdersScope(policy);
  if (!ordersScope) return baseResult;

  // Own-branch is pinned to the server-trusted Home Branch: a client-supplied
  // `branchId` cannot widen it. All-branch may optionally narrow by branch.
  if ((filters.branchId?.length ?? 0) > 128 || (filters.entryId?.length ?? 0) > 128) {
    throw new DiscountAdministrationError(400, "INPUT_INVALID", "Usage filter id is too long");
  }
  const requestedBranch =
    filters.branchId && filters.branchId.length > 0 ? filters.branchId : null;
  if (ordersScope.mode === "own") {
    // Ignoring a foreign branchId is safer than reflecting a decision that
    // suggests the caller can select another branch.
    if (requestedBranch && requestedBranch !== ordersScope.branchId) {
      throw deny();
    }
  }
  const branchFilter =
    ordersScope.mode === "own" ? ordersScope.branchId : requestedBranch;

  const conditions = [eq(discountRedemptions.offerId, offerId)];
  if (status) conditions.push(eq(discountRedemptions.status, status));
  if (activationKind) conditions.push(eq(discountRedemptions.activationKind, activationKind));
  if (branchFilter) conditions.push(eq(orders.branchId, branchFilter));
  const entryId =
    filters.entryId && filters.entryId.length > 0 ? filters.entryId : null;
  if (entryId) conditions.push(eq(discountRedemptions.id, entryId));

  const where = and(...conditions);
  const page = boundedPage(filters.page);
  const limit = boundedLimit(filters.limit);
  const offset = (page - 1) * limit;

  const countRows = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(discountRedemptions)
    .innerJoin(orders, eq(orders.id, discountRedemptions.orderId))
    .where(where);
  const total = countRows[0]?.total ?? 0;

  const rows = await db
    .select({
      id: discountRedemptions.id,
      orderId: discountRedemptions.orderId,
      status: discountRedemptions.status,
      activationKind: discountRedemptions.activationKind,
      codeId: discountRedemptions.codeId,
      canonicalCode: discountCodes.canonicalCode,
      benefitAmount: discountRedemptions.benefitAmount,
      revisionId: discountRedemptions.revisionId,
      revisionNo: discountOfferRevisions.revisionNo,
      policyVersion: discountRedemptions.policyVersion,
      contractVersion: discountRedemptions.contractVersion,
      engineVersion: discountRedemptions.engineVersion,
      reservedAt: discountRedemptions.reservedAt,
      consumedAt: discountRedemptions.consumedAt,
      releasedAt: discountRedemptions.releasedAt,
      terminalReason: discountRedemptions.terminalReason,
      releaseSource: discountRedemptions.releaseSource,
      orderStatus: orders.status,
      paymentStatus: orders.paymentStatus,
      fulfillmentMethod: orders.fulfillmentMethod,
      fulfillmentBlockedReason: orders.fulfillmentBlockedReason,
      branchId: branches.id,
      branchName: branches.name,
      clientId: clients.id,
      clientName: clients.name,
      latePaidReview: sql<boolean>`exists (
        select 1 from discount_redemption_event e
         where e.redemption_id = ${discountRedemptions.id}
           and e.kind = 'late_paid_review'
      )`,
    })
    .from(discountRedemptions)
    .innerJoin(orders, eq(orders.id, discountRedemptions.orderId))
    .innerJoin(clients, eq(clients.id, discountRedemptions.clientId))
    .innerJoin(discountOfferRevisions, eq(discountOfferRevisions.id, discountRedemptions.revisionId))
    .leftJoin(branches, eq(branches.id, orders.branchId))
    .leftJoin(discountCodes, eq(discountCodes.id, discountRedemptions.codeId))
    .where(where)
    .orderBy(desc(discountRedemptions.createdAt), desc(discountRedemptions.id))
    .limit(limit)
    .offset(offset);

  if (entryId && rows.length === 0) {
    // A direct id outside the Orders scope is indistinguishable from a missing
    // one: 404, never a scoped empty page that confirms existence elsewhere.
    throw new DiscountAdministrationError(404, "NOT_FOUND", "Redemption not found");
  }

  const items: DiscountUsageEntryDto[] = rows.map((row) => {
    // This projection intentionally INNER JOINs orders; attempt-only entries
    // are exposed through checkout review, not through fabricated order links.
    if (row.orderId === null) throw new Error("Order-backed Redemption has no order");
    return ({
    id: row.id,
    orderId: row.orderId,
    status: row.status as DiscountUsageEntryStatus,
    activationKind: row.activationKind as DiscountUsageEntryActivation,
    codeId: row.codeId,
    maskedCode: row.canonicalCode ? maskPromoCode(row.canonicalCode) : null,
    benefitAmount: wholeRupiah(row.benefitAmount, "benefitAmount"),
    revisionId: row.revisionId,
    revisionNo: row.revisionNo,
    policyVersion: row.policyVersion,
    contractVersion: row.contractVersion,
    engineVersion: row.engineVersion,
    branch:
      row.branchId === null
        ? null
        : { id: row.branchId, name: row.branchName ?? "" },
    customer: { id: row.clientId, name: row.clientName },
    order: {
      status: row.orderStatus,
      paymentStatus: row.paymentStatus,
      fulfillmentMethod: row.fulfillmentMethod,
      fulfillmentBlocked: row.fulfillmentBlockedReason !== null,
      fulfillmentBlockedReason: row.fulfillmentBlockedReason,
    },
    review: { latePaidReview: row.latePaidReview === true },
    reservedAt: row.reservedAt.toISOString(),
    consumedAt: row.consumedAt?.toISOString() ?? null,
    releasedAt: row.releasedAt?.toISOString() ?? null,
    terminalReason: row.terminalReason,
    releaseSource: row.releaseSource,
    });
  });

  return {
    ...baseResult,
    entriesAccess: "scoped",
    scope:
      ordersScope.mode === "own"
        ? { mode: "own", branchId: ordersScope.branchId }
        : { mode: "all" },
    entries: {
      items,
      page,
      limit,
      total,
      totalPages: total === 0 ? 0 : Math.ceil(total / limit),
    },
    note:
      "Agregat global adalah otoritas kapasitas. Daftar entry mengikuti grant Orders:view dan scope cabang; total daftar tidak mewakili total global.",
  };
}

/**
 * Immutable Offer history. The reader exposes the stored audit row, the actual
 * revision/draft/code references it names, and a safe attribution that survives
 * a deleted Admin User FK (`user_id` → NULL): the immutable identity string in
 * the payload is still reported, the display name is simply unavailable.
 */
export async function readDiscountOfferHistory(input: {
  offerId: string;
  actorUserId: string;
  limit?: string | number | null;
}): Promise<DiscountHistoryEntryDto[]> {
  const offerId = input.offerId;
  if (!UUID_PATTERN.test(offerId)) {
    throw new DiscountAdministrationError(404, "NOT_FOUND", "Offer not found");
  }
  requireViewer(await loadPolicy(input.actorUserId));

  const exist = await db
    .select({ id: discountOffers.id })
    .from(discountOffers)
    .where(eq(discountOffers.id, offerId))
    .limit(1);
  if (exist.length === 0) {
    throw new DiscountAdministrationError(404, "NOT_FOUND", "Offer not found");
  }

  const parsedLimit = Number.parseInt(String(input.limit ?? ""), 10);
  const limit =
    Number.isFinite(parsedLimit) && parsedLimit > 0
      ? Math.min(parsedLimit, 100)
      : 100;

  // Receipts retain the immutable actor identity even after the Admin User row
  // is gone; they backfill attribution for events written before the audit
  // payload started carrying `actorIdentity`.
  const receiptRows = await db
    .select({
      requestKey: discountAdminRequests.requestKey,
      actorIdentity: discountAdminRequests.actorIdentity,
    })
    .from(discountAdminRequests)
    .where(eq(discountAdminRequests.targetId, offerId));
  const receiptActor = new Map(
    receiptRows.map((row) => [row.requestKey, row.actorIdentity])
  );

  const rows = await db
    .select({
      id: auditLogs.id,
      action: auditLogs.action,
      entityType: auditLogs.entityType,
      entityId: auditLogs.entityId,
      policyVersion: auditLogs.policyVersion,
      changes: auditLogs.changes,
      createdAt: auditLogs.createdAt,
      actorId: auditLogs.userId,
      actorName: users.name,
    })
    .from(auditLogs)
    .leftJoin(users, eq(users.id, auditLogs.userId))
    .where(
      and(eq(auditLogs.entityType, "discount_offer"), eq(auditLogs.entityId, offerId))
    )
    .orderBy(desc(auditLogs.createdAt))
    .limit(limit);

  return rows.map((row) => {
    const changes = asObject(row.changes);
    const requestKey = refString(changes, "requestKey");
    const identity =
      refString(changes, "actorIdentity") ??
      (requestKey ? receiptActor.get(requestKey) ?? null : null) ??
      row.actorId;
    const maskedCode = refString(changes, "maskedCode");
    return {
      id: row.id,
      action: row.action,
      entityType: row.entityType,
      entityId: row.entityId,
      policyVersion: row.policyVersion,
      actor: {
        id: row.actorId,
        identity,
        label: row.actorId === null ? null : row.actorName,
        available: row.actorId !== null,
      },
      references: {
        revisionId:
          refString(changes, "draftRevisionId") ??
          refString(changes, "revisionId"),
        revisionNo: refNumber(changes, "revisionNo"),
        draftRevisionId: refString(changes, "draftRevisionId"),
        draftVersion: refNumber(changes, "draftVersionAfter"),
        codeId: refString(changes, "codeId"),
        maskedCode,
      },
      changes: row.changes,
      createdAt: row.createdAt.toISOString(),
    };
  });
}
