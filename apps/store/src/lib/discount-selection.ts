/**
 * Store seam — evaluasi satu Offer publik terpilih (ticket 07).
 *
 * READ ONLY. Dipakai preview untuk menampilkan breakdown dan place-order untuk
 * memvalidasi ulang kandidat. Di place-order, pemanggilan yang mengikat
 * keputusan adalah yang dijalankan DI DALAM transaksi di bawah lock Offer
 * (`SELECT ... FOR UPDATE`), sehingga hasil preview tidak pernah menjadi izin
 * reservasi. Reason aman tidak mendiscovery Offer lain.
 */
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  discountBenefits,
  discountClientUsage,
  discountOfferRevisions,
  discountOffers,
  discountOfferUsage,
} from "@/db";
import {
  describeOfferEligibilityReason,
  evaluateOfferEligibility,
  parseMoney,
  type OfferEligibilityReason,
} from "@marketplace/db/src/discount-eligibility";

type Database = typeof db;

export interface PublicOfferCandidate {
  offerId: string;
  offerName: string;
  revisionId: string;
  benefitId: string;
  policyVersion: number;
  /** Nominal fixed goods yang dikonfigurasi (belum di-clip). */
  fixedAmount: string;
  /** Nominal aktual yang akan direservasi (min(fixed, subtotal)). */
  benefitAmount: string;
  minSubtotal: string;
  startAt: Date | null;
  endAt: Date | null;
}

export type SelectedOfferEvaluation =
  | { ok: true; candidate: PublicOfferCandidate }
  | { ok: false; reason: OfferEligibilityReason; message: string };

export interface SelectedOfferInput {
  offerId: string;
  clientId: string;
  verifiedEmail: boolean;
  subtotalAfterMarkdown: string;
  now?: Date;
}

/**
 * Loads the current published revision/benefit/usage of one Offer and evaluates
 * eligibility. An unknown/inactive Offer returns the SAME safe reason as a
 * paused one (no existence leak). Never writes.
 */
export async function evaluateSelectedPublicOffer(
  input: SelectedOfferInput,
  database: Database = db
): Promise<SelectedOfferEvaluation> {
  const now = input.now ?? new Date();
  if (!Number.isFinite(now.getTime())) {
    return ineligible("INPUT_INVALID");
  }

  const [row] = await database
    .select({
      offerId: discountOffers.id,
      state: discountOffers.state,
      activationKind: discountOffers.activationKind,
      quotaCount: discountOffers.quotaCount,
      budgetAmount: discountOffers.budgetAmount,
      perClientLimit: discountOffers.perClientLimit,
      policyVersion: discountOffers.policyVersion,
      revisionId: discountOfferRevisions.id,
      name: discountOfferRevisions.name,
      minSubtotal: discountOfferRevisions.minSubtotal,
      startAt: discountOfferRevisions.startAt,
      endAt: discountOfferRevisions.endAt,
      publishedAt: discountOfferRevisions.publishedAt,
      benefitId: discountBenefits.id,
      benefitKind: discountBenefits.kind,
      paramsVersion: discountBenefits.paramsVersion,
      fixedAmount: discountBenefits.fixedAmount,
      reservedCount: discountOfferUsage.reservedCount,
      consumedCount: discountOfferUsage.consumedCount,
      reservedAmount: discountOfferUsage.reservedAmount,
      consumedAmount: discountOfferUsage.consumedAmount,
    })
    .from(discountOffers)
    .innerJoin(
      discountOfferRevisions,
      and(
        eq(discountOfferRevisions.id, discountOffers.currentRevisionId),
        eq(discountOfferRevisions.offerId, discountOffers.id)
      )
    )
    .innerJoin(
      discountBenefits,
      eq(discountBenefits.revisionId, discountOfferRevisions.id)
    )
    .innerJoin(discountOfferUsage, eq(discountOfferUsage.offerId, discountOffers.id))
    .where(eq(discountOffers.id, input.offerId))
    .limit(1);

  if (!row) return ineligible("OFFER_UNAVAILABLE");

  const [clientUsage] = await database
    .select({
      reservedCount: discountClientUsage.reservedCount,
      consumedCount: discountClientUsage.consumedCount,
      reservedAmount: discountClientUsage.reservedAmount,
      consumedAmount: discountClientUsage.consumedAmount,
    })
    .from(discountClientUsage)
    .where(
      and(
        eq(discountClientUsage.offerId, input.offerId),
        eq(discountClientUsage.clientId, input.clientId)
      )
    )
    .limit(1);

  const minSubtotal = moneyOrZero(row.minSubtotal);
  const eligibility = evaluateOfferEligibility({
    now,
    verifiedEmail: input.verifiedEmail,
    subtotalAfterMarkdown: input.subtotalAfterMarkdown,
    offer: {
      activationKind: row.activationKind,
      state: row.state,
      revisionPublished: row.publishedAt != null,
      startAt: row.startAt,
      endAt: row.endAt,
      minSubtotal,
      quotaCount: row.quotaCount,
      budgetAmount: moneyOrZero(row.budgetAmount),
      perClientLimit: row.perClientLimit,
      benefit: {
        kind: row.benefitKind,
        paramsVersion: row.paramsVersion,
        fixedAmount: moneyOrZero(row.fixedAmount),
      },
      usage: {
        reservedCount: row.reservedCount,
        consumedCount: row.consumedCount,
        reservedAmount: row.reservedAmount,
        consumedAmount: row.consumedAmount,
      },
      clientUsage: clientUsage ?? null,
    },
  });

  if (!eligibility.eligible || !eligibility.benefitAmount) {
    return ineligible(eligibility.reason ?? "BENEFIT_UNAVAILABLE");
  }

  return {
    ok: true,
    candidate: {
      offerId: row.offerId,
      offerName: row.name ?? "",
      revisionId: row.revisionId,
      benefitId: row.benefitId,
      policyVersion: row.policyVersion,
      fixedAmount: moneyOrZero(row.fixedAmount),
      benefitAmount: eligibility.benefitAmount,
      minSubtotal,
      startAt: row.startAt,
      endAt: row.endAt,
    },
  };
}

/** HTTP mapping from spec §5.4; safe message is the eligibility message. */
export function mapOfferReasonToHttp(reason: OfferEligibilityReason): {
  status: 403 | 409;
  code:
    | "PROMO_UNAVAILABLE"
    | "PROMO_INELIGIBLE"
    | "PROMO_CAPACITY_UNAVAILABLE"
    | "EMAIL_VERIFICATION_REQUIRED";
} {
  switch (reason) {
    case "EMAIL_VERIFICATION_REQUIRED":
      return { status: 403, code: "EMAIL_VERIFICATION_REQUIRED" };
    case "MINIMUM_NOT_MET":
      return { status: 409, code: "PROMO_INELIGIBLE" };
    case "CAPACITY_UNAVAILABLE":
      return { status: 409, code: "PROMO_CAPACITY_UNAVAILABLE" };
    default:
      return { status: 409, code: "PROMO_UNAVAILABLE" };
  }
}

export function offerReasonMessage(reason: OfferEligibilityReason): string {
  return describeOfferEligibilityReason(reason);
}

function ineligible(reason: OfferEligibilityReason): SelectedOfferEvaluation {
  return { ok: false, reason, message: describeOfferEligibilityReason(reason) };
}

function moneyOrZero(value: string | number | null | undefined): string {
  if (value == null) return "0";
  const parsed = parseMoney(value);
  return parsed === null ? "0" : parsed.toString();
}
