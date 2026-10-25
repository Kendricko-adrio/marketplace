import { eq, sql } from "drizzle-orm";

import { db } from "@/db";
import {
  discountClientUsage,
  discountOfferUsage,
  discountRedemptions,
} from "@/db";

// =========================================================
// Targeted usage reconciliation (ticket 12, spec §9.3)
// =========================================================
// The projection rows (`discount_offer_usage` / `discount_client_usage`) are
// the capacity authority: lifecycle modules mutate them in the same commit as
// the Redemption. This module answers ONE bounded question per Offer — does
// the projection still agree with the append-only Redemption ledger? — using
// the indexed `(offer_id, status)` lookup.
//
// It never resets, rebuilds or writes a counter. A detected drift is reported
// to the admin read surface and fails closed for capacity-authority mutations
// (publish + policy); pause/archive stays available as the safe ops action.
// There is no online "repair" button: an operator reviews the affected
// Redemption rows through the usage reader / existing Orders ops workflow.

export interface UsageProjection {
  reservedCount: number;
  consumedCount: number;
  reservedAmount: string;
  consumedAmount: string;
}

export interface UsageLedger {
  reservedCount: number;
  consumedCount: number;
  reservedAmount: string;
  consumedAmount: string;
}

export type UsageDriftField =
  | "reservedCount"
  | "consumedCount"
  | "reservedAmount"
  | "consumedAmount";

export interface UsageDriftReport {
  /** True when at least one projection counter disagrees with the ledger. */
  detected: boolean;
  projection: UsageProjection;
  ledger: UsageLedger;
  mismatched: UsageDriftField[];
  /** Operators must review; there is no online reset/rebuild path. */
  action: "review_required" | null;
}

/** Canonical whole-Rupiah integer text from a `numeric` string (`"25000.00"`). */
export function wholeRupiah(value: string, field = "money"): string {
  const [whole, fraction = ""] = value.split(".");
  if (!/^\d+$/.test(whole) || fraction.replace(/0/g, "") !== "") {
    throw new Error(`${field} is not a whole Rupiah value: ${value}`);
  }
  return BigInt(whole).toString();
}

/** Any Drizzle executor (the app db or a transaction). */
type Executor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Sum the append-only Redemption ledger for one Offer. Counts come from the
 * status index; amounts are whole Rupiah (`benefit_amount` has a
 * `= trunc(...)` CHECK), so the comparison is exact.
 */
export async function readOfferUsageLedger(
  executor: Executor,
  offerId: string
): Promise<UsageLedger> {
  const rows = await executor
    .select({
      reservedCount: sql<number>`count(*) filter (where ${discountRedemptions.status} = 'reserved')::int`,
      consumedCount: sql<number>`count(*) filter (where ${discountRedemptions.status} = 'consumed')::int`,
      reservedAmount: sql<string>`coalesce(sum(${discountRedemptions.benefitAmount}) filter (where ${discountRedemptions.status} = 'reserved'), 0)::text`,
      consumedAmount: sql<string>`coalesce(sum(${discountRedemptions.benefitAmount}) filter (where ${discountRedemptions.status} = 'consumed'), 0)::text`,
    })
    .from(discountRedemptions)
    .where(eq(discountRedemptions.offerId, offerId));
  const row = rows[0];
  return {
    reservedCount: row?.reservedCount ?? 0,
    consumedCount: row?.consumedCount ?? 0,
    reservedAmount: wholeRupiah(row?.reservedAmount ?? "0", "reservedAmount"),
    consumedAmount: wholeRupiah(row?.consumedAmount ?? "0", "consumedAmount"),
  };
}

/**
 * Compare one Offer's projection row against the ledger. Missing projection
 * rows are read as zero (a draft identity has an empty projection).
 */
export async function detectOfferUsageDrift(
  executor: Executor,
  offerId: string,
  projectionInput?: UsageProjection | null
): Promise<UsageDriftReport> {
  let projection = projectionInput ?? null;
  if (!projection) {
    const rows = await executor
      .select({
        reservedCount: discountOfferUsage.reservedCount,
        consumedCount: discountOfferUsage.consumedCount,
        reservedAmount: discountOfferUsage.reservedAmount,
        consumedAmount: discountOfferUsage.consumedAmount,
      })
      .from(discountOfferUsage)
      .where(eq(discountOfferUsage.offerId, offerId))
      .limit(1);
    projection = rows[0]
      ? {
          reservedCount: rows[0].reservedCount,
          consumedCount: rows[0].consumedCount,
          reservedAmount: wholeRupiah(rows[0].reservedAmount, "reservedAmount"),
          consumedAmount: wholeRupiah(rows[0].consumedAmount, "consumedAmount"),
        }
      : {
          reservedCount: 0,
          consumedCount: 0,
          reservedAmount: "0",
          consumedAmount: "0",
        };
  }

  const ledger = await readOfferUsageLedger(executor, offerId);
  const mismatched: UsageDriftField[] = [];
  if (projection.reservedCount !== ledger.reservedCount) mismatched.push("reservedCount");
  if (projection.consumedCount !== ledger.consumedCount) mismatched.push("consumedCount");
  if (projection.reservedAmount !== ledger.reservedAmount) mismatched.push("reservedAmount");
  if (projection.consumedAmount !== ledger.consumedAmount) mismatched.push("consumedAmount");

  return {
    detected: mismatched.length > 0,
    projection,
    ledger,
    mismatched,
    action: mismatched.length > 0 ? "review_required" : null,
  };
}

/**
 * Highest per-client commitment (`reserved + consumed`) for one Offer. This is
 * the indexed bound a per-account limit reduction must clear; it reads the
 * `(offer_id, client_id)` primary key, never the whole history and never a
 * per-account row lock.
 */
export async function readMaxClientCommitment(
  executor: Executor,
  offerId: string
): Promise<number> {
  const rows = await executor
    .select({
      maxCommitment: sql<number>`coalesce(max(${discountClientUsage.reservedCount} + ${discountClientUsage.consumedCount}), 0)::int`,
    })
    .from(discountClientUsage)
    .where(eq(discountClientUsage.offerId, offerId));
  return rows[0]?.maxCommitment ?? 0;
}
