/**
 * Atomic Redemption reservation (ticket 07, spec §9.1–§9.2).
 *
 * Dipanggil DI DALAM transaksi place-order yang sudah memegang client lock dan
 * checkout request. Urutan lock group 3 wajib:
 *
 *   Offer identity → Offer usage → client usage
 *
 * sehingga dua reservasi untuk Offer yang sama terserialisasi di baris Offer
 * dan evaluasi kapasitas kedua melihat commit pertama. Semua tulis (Redemption,
 * event, counter global/per-client, allocation) memakai `tx` milik caller agar
 * satu commit dengan order/stock/intent/receipt.
 *
 * Lock+evaluasi HARUS dipanggil sebelum lock variant/source (group 4) dan order
 * (group 5); insert Redemption baru bisa setelah order ada (FK). Karena itu
 * modul ini memisahkan `lockAndEvaluateOfferReservation` dari
 * `insertRedemptionReservation`.
 */
import { and, eq, sql } from "drizzle-orm";
import {
  discountClientUsage,
  discountOfferUsage,
  discountOffers,
  discountRedemptionEvents,
  discountRedemptions,
  orderDiscountAllocations,
} from "@/db";
import type { PricingSnapshot } from "./versioned-pricing";
import {
  evaluateSelectedPublicOffer,
  offerReasonMessage,
  type PublicOfferCandidate,
} from "./discount-selection";
import type { OfferEligibilityReason } from "@marketplace/db/src/discount-eligibility";
import type { RedemptionTx } from "./discount-lifecycle";

/** Review context changed between preview and the authoritative commit. */
export class RedemptionReviewChangedError extends Error {
  constructor() {
    super("Pilihan promo berubah. Periksa kembali pesanan.");
    this.name = "RedemptionReviewChangedError";
  }
}

export type ReservationDecision =
  | { ok: true; candidate: PublicOfferCandidate }
  | { ok: false; reason: OfferEligibilityReason; message: string };

/**
 * Lock group 3 lalu evaluasi ulang authoritative. Lock Offer identity lebih
 * dulu membuat publish/pause/policy edit dan reservasi lain terserialisasi.
 */
export async function lockAndEvaluateOfferReservation(
  tx: RedemptionTx,
  input: {
    clientId: string;
    verifiedEmail: boolean;
    /** Kandidat yang direview di preview (identity + nominal + policy). */
    candidate: PublicOfferCandidate;
    subtotalAfterMarkdown: string;
  }
): Promise<ReservationDecision> {
  const candidate = input.candidate;
  await tx
    .select({ id: discountOffers.id })
    .from(discountOffers)
    .where(eq(discountOffers.id, candidate.offerId))
    .for("update");
  await tx
    .select({ offerId: discountOfferUsage.offerId })
    .from(discountOfferUsage)
    .where(eq(discountOfferUsage.offerId, candidate.offerId))
    .for("update");
  await tx
    .select({ offerId: discountClientUsage.offerId })
    .from(discountClientUsage)
    .where(
      and(
        eq(discountClientUsage.offerId, candidate.offerId),
        eq(discountClientUsage.clientId, input.clientId)
      )
    )
    .for("update");

  const fresh = await evaluateSelectedPublicOffer(
    {
      offerId: candidate.offerId,
      clientId: input.clientId,
      verifiedEmail: input.verifiedEmail,
      subtotalAfterMarkdown: input.subtotalAfterMarkdown,
    },
    tx as unknown as Parameters<typeof evaluateSelectedPublicOffer>[1]
  );
  if (!fresh.ok) {
    return { ok: false, reason: fresh.reason, message: offerReasonMessage(fresh.reason) };
  }
  if (
    fresh.candidate.revisionId !== candidate.revisionId ||
    fresh.candidate.benefitId !== candidate.benefitId ||
    fresh.candidate.benefitAmount !== candidate.benefitAmount ||
    fresh.candidate.policyVersion !== candidate.policyVersion
  ) {
    throw new RedemptionReviewChangedError();
  }
  return { ok: true, candidate: fresh.candidate };
}

/**
 * Menulis Redemption + event reserved + counter global/per-client. Prasyarat:
 * order sudah ada dan lock group 3 sudah dipegang oleh
 * `lockAndEvaluateOfferReservation` di transaksi yang sama.
 */
export async function insertRedemptionReservation(
  tx: RedemptionTx,
  input: {
    orderId: string;
    clientId: string;
    candidate: PublicOfferCandidate;
    deadline: Date;
    pricing: PricingSnapshot;
  }
): Promise<{ redemptionId: string }> {
  const candidate = input.candidate;
  const benefitAmount = candidate.benefitAmount;
  const redemptionId = crypto.randomUUID();
  const now = new Date();
  await tx.insert(discountRedemptions).values({
    id: redemptionId,
    orderId: input.orderId,
    clientId: input.clientId,
    offerId: candidate.offerId,
    revisionId: candidate.revisionId,
    benefitId: candidate.benefitId,
    activationKind: "public",
    status: "reserved",
    benefitAmount,
    deadline: input.deadline,
    policyVersion: candidate.policyVersion,
    termsSnapshot: {
      name: candidate.offerName,
      minSubtotal: candidate.minSubtotal,
      startAt: candidate.startAt ? candidate.startAt.toISOString() : null,
      endAt: candidate.endAt ? candidate.endAt.toISOString() : null,
    },
    resultSnapshot: {
      version: 1,
      offerId: candidate.offerId,
      revisionId: candidate.revisionId,
      benefitId: candidate.benefitId,
      benefitAmount,
      pricing: {
        subtotal: input.pricing.subtotal,
        goodsDiscount: input.pricing.goodsDiscount,
        netGoods: input.pricing.netGoods,
        ppnAmount: input.pricing.ppnAmount,
        total: input.pricing.total,
        expectedProviderPayable: input.pricing.expectedProviderPayable,
      },
    },
  });
  await tx.insert(discountRedemptionEvents).values({
    id: crypto.randomUUID(),
    redemptionId,
    eventKey: `${redemptionId}:reserved`,
    kind: "reserved",
    previousStatus: null,
    nextStatus: "reserved",
    amount: benefitAmount,
    source: "checkout",
  });

  const [offerUsage] = await tx
    .update(discountOfferUsage)
    .set({
      reservedCount: sql`${discountOfferUsage.reservedCount} + 1`,
      reservedAmount: sql`${discountOfferUsage.reservedAmount} + ${benefitAmount}::numeric`,
      version: sql`${discountOfferUsage.version} + 1`,
      updatedAt: now,
    })
    .where(eq(discountOfferUsage.offerId, candidate.offerId))
    .returning({ offerId: discountOfferUsage.offerId });
  if (!offerUsage) throw new Error("Offer usage projection missing during reservation");

  // Conflict-safe per-client projection, created after the Offer lock.
  await tx
    .insert(discountClientUsage)
    .values({
      offerId: candidate.offerId,
      clientId: input.clientId,
      reservedCount: 1,
      reservedAmount: benefitAmount,
    })
    .onConflictDoUpdate({
      target: [discountClientUsage.offerId, discountClientUsage.clientId],
      set: {
        reservedCount: sql`${discountClientUsage.reservedCount} + 1`,
        reservedAmount: sql`${discountClientUsage.reservedAmount} + ${benefitAmount}::numeric`,
        version: sql`${discountClientUsage.version} + 1`,
        updatedAt: now,
      },
    });

  return { redemptionId };
}

/** Convenience composition for callers (and race tests) that own the tx. */
export async function reserveRedemptionForOrder(
  tx: RedemptionTx,
  input: Parameters<typeof lockAndEvaluateOfferReservation>[1] & {
    orderId: string;
    deadline: Date;
    pricing: PricingSnapshot;
  }
): Promise<
  | { ok: true; redemptionId: string; candidate: PublicOfferCandidate }
  | { ok: false; reason: OfferEligibilityReason; message: string }
> {
  const decision = await lockAndEvaluateOfferReservation(tx, input);
  if (!decision.ok) return decision;
  const inserted = await insertRedemptionReservation(tx, {
    orderId: input.orderId,
    clientId: input.clientId,
    candidate: decision.candidate,
    deadline: input.deadline,
    pricing: input.pricing,
  });
  return { ok: true, ...inserted, candidate: decision.candidate };
}

/**
 * Per-line allocation evidence in the same commit: Markdown is a SEPARATE
 * component from the Offer slot; a zero allocation is never stored. A goods
 * allocation needs the Redemption/benefit pair so the composite FKs prove the
 * item and Redemption belong to this order.
 */
export async function writeOrderDiscountAllocations(
  tx: RedemptionTx,
  input: {
    orderId: string;
    orderItemIdByVariant: ReadonlyMap<string, string>;
    pricing: PricingSnapshot;
    redemption: { id: string; benefitId: string } | null;
  }
): Promise<void> {
  for (const line of input.pricing.lines) {
    const orderItemId = input.orderItemIdByVariant.get(line.variantId);
    if (!orderItemId) throw new Error("Order line missing for discount allocation");
    if (line.markdownAmount !== "0") {
      if (!line.markdownRevisionId) {
        throw new Error("Markdown allocation requires its revision");
      }
      await tx.insert(orderDiscountAllocations).values({
        id: crypto.randomUUID(),
        orderId: input.orderId,
        orderItemId,
        component: "markdown",
        markdownRevisionId: line.markdownRevisionId,
        amount: line.markdownAmount,
      });
    }
    if (input.redemption && line.goodsDiscountAmount !== "0") {
      await tx.insert(orderDiscountAllocations).values({
        id: crypto.randomUUID(),
        orderId: input.orderId,
        orderItemId,
        component: "offer_goods",
        redemptionId: input.redemption.id,
        benefitId: input.redemption.benefitId,
        amount: line.goodsDiscountAmount,
      });
    }
  }
}
