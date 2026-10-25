/**
 * Redemption lifecycle seam (ticket 07, spec §9.3).
 *
 * Setiap transisi berjalan di dalam transaksi milik caller, bersama:
 *   - perubahan order (paid/failed/cancel accounting),
 *   - projection usage global + per-client,
 *   - event append-only dengan `event_key` unik (idempotensi authoritative).
 *
 * Lock ordering §9.2 dijaga caller: Offer identity → Offer usage → client usage
 * sebelum order/Redemption. Helper di bawah TIDAK pernah membuka transaksi
 * sendiri, sehingga tidak bisa mengambil lock di luar urutan tersebut.
 */
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  discountClientUsage,
  discountOfferUsage,
  discountOffers,
  discountRedemptionEvents,
  discountRedemptions,
} from "@/db";

export type RedemptionTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export interface RedemptionIdentity {
  id: string;
  offerId: string;
  clientId: string;
  benefitAmount: string;
  status: "reserved" | "consumed" | "released";
}

/** Discovery via unlocked read; caller harus re-read di dalam transaksi. */
export async function findRedemptionForOrder(
  orderId: string,
  database = db
): Promise<RedemptionIdentity | null> {
  const [row] = await database
    .select({
      id: discountRedemptions.id,
      offerId: discountRedemptions.offerId,
      clientId: discountRedemptions.clientId,
      benefitAmount: discountRedemptions.benefitAmount,
      status: discountRedemptions.status,
    })
    .from(discountRedemptions)
    .where(eq(discountRedemptions.orderId, orderId))
    .limit(1);
  return (row as RedemptionIdentity | undefined) ?? null;
}

/**
 * Lock group 3 untuk Offer yang sudah diketahui (bukan discovery): Offer
 * identity → global usage → per-client usage. Reservasi paralel untuk Offer
 * yang sama terserialisasi di baris Offer ini.
 */
export async function lockRedemptionOwners(
  tx: RedemptionTx,
  identity: Pick<RedemptionIdentity, "offerId" | "clientId">
): Promise<void> {
  await tx
    .select({ id: discountOffers.id })
    .from(discountOffers)
    .where(eq(discountOffers.id, identity.offerId))
    .for("update");
  await tx
    .select({ offerId: discountOfferUsage.offerId })
    .from(discountOfferUsage)
    .where(eq(discountOfferUsage.offerId, identity.offerId))
    .for("update");
  await tx
    .select({ offerId: discountClientUsage.offerId })
    .from(discountClientUsage)
    .where(
      and(
        eq(discountClientUsage.offerId, identity.offerId),
        eq(discountClientUsage.clientId, identity.clientId)
      )
    )
    .for("update");
}

/**
 * reserved → consumed: paid authoritative. Idempotent: baris kedua kali tidak
 * match dan tidak mengurangi counter; event key unik menolak duplikasi.
 */
export async function consumeReservedRedemption(
  tx: RedemptionTx,
  input: {
    identity: Pick<RedemptionIdentity, "offerId" | "clientId" | "benefitAmount">;
    orderId?: string;
    redemptionId: string;
    source: string;
    correlation?: string | null;
    reason?: string | null;
  }
): Promise<boolean> {
  const now = new Date();
  const [updated] = await tx
    .update(discountRedemptions)
    .set({ status: "consumed", consumedAt: now, updatedAt: now })
    .where(
      and(
        eq(discountRedemptions.id, input.redemptionId),
        eq(discountRedemptions.status, "reserved")
      )
    )
    .returning({ id: discountRedemptions.id, benefitAmount: discountRedemptions.benefitAmount });
  if (!updated) return false;

  await insertEvent(tx, {
    redemptionId: updated.id,
    eventKey: `${updated.id}:consumed`,
    kind: "consumed",
    previousStatus: "reserved",
    nextStatus: "consumed",
    amount: updated.benefitAmount,
    source: input.source,
    correlation: input.correlation ?? null,
    reason: input.reason ?? null,
  });

  const amount = updated.benefitAmount;
  const [offerUsage] = await tx
    .update(discountOfferUsage)
    .set({
      reservedCount: sql`${discountOfferUsage.reservedCount} - 1`,
      consumedCount: sql`${discountOfferUsage.consumedCount} + 1`,
      reservedAmount: sql`${discountOfferUsage.reservedAmount} - ${amount}::numeric`,
      consumedAmount: sql`${discountOfferUsage.consumedAmount} + ${amount}::numeric`,
      version: sql`${discountOfferUsage.version} + 1`,
      updatedAt: now,
    })
    .where(
      and(
        eq(discountOfferUsage.offerId, input.identity.offerId),
        sql`${discountOfferUsage.reservedCount} >= 1`,
        sql`${discountOfferUsage.reservedAmount} >= ${amount}::numeric`
      )
    )
    .returning({ offerId: discountOfferUsage.offerId });
  if (!offerUsage) {
    throw new Error("Redemption usage drifted: offer reserved projection is below the consumed amount");
  }
  const [clientUsage] = await tx
    .update(discountClientUsage)
    .set({
      reservedCount: sql`${discountClientUsage.reservedCount} - 1`,
      consumedCount: sql`${discountClientUsage.consumedCount} + 1`,
      reservedAmount: sql`${discountClientUsage.reservedAmount} - ${amount}::numeric`,
      consumedAmount: sql`${discountClientUsage.consumedAmount} + ${amount}::numeric`,
      version: sql`${discountClientUsage.version} + 1`,
      updatedAt: now,
    })
    .where(
      and(
        eq(discountClientUsage.offerId, input.identity.offerId),
        eq(discountClientUsage.clientId, input.identity.clientId),
        sql`${discountClientUsage.reservedCount} >= 1`,
        sql`${discountClientUsage.reservedAmount} >= ${amount}::numeric`
      )
    )
    .returning({ offerId: discountClientUsage.offerId });
  if (!clientUsage) {
    throw new Error("Redemption usage drifted: client reserved projection is below the consumed amount");
  }
  return true;
}

/**
 * reserved → released: HANYA setelah terminal unpaid yang authoritative dan
 * aman (cancel provider confirmed / definitive never-applied create). Released
 * rows tetap retained; kapasitas kembali ke projection sekali.
 */
export async function releaseReservedRedemption(
  tx: RedemptionTx,
  input: {
    identity: Pick<RedemptionIdentity, "offerId" | "clientId" | "benefitAmount">;
    orderId: string;
    source: string;
    reason: string;
  }
): Promise<boolean> {
  const now = new Date();
  const [updated] = await tx
    .update(discountRedemptions)
    .set({
      status: "released",
      releasedAt: now,
      terminalReason: input.reason,
      releaseSource: input.source,
      updatedAt: now,
    })
    .where(
      and(
        eq(discountRedemptions.orderId, input.orderId),
        eq(discountRedemptions.status, "reserved")
      )
    )
    .returning({ id: discountRedemptions.id, benefitAmount: discountRedemptions.benefitAmount });
  if (!updated) return false;

  await insertEvent(tx, {
    redemptionId: updated.id,
    eventKey: `${updated.id}:released`,
    kind: "released",
    previousStatus: "reserved",
    nextStatus: "released",
    amount: updated.benefitAmount,
    source: input.source,
    correlation: null,
    reason: input.reason,
  });

  const amount = updated.benefitAmount;
  const [offerUsage] = await tx
    .update(discountOfferUsage)
    .set({
      reservedCount: sql`${discountOfferUsage.reservedCount} - 1`,
      reservedAmount: sql`${discountOfferUsage.reservedAmount} - ${amount}::numeric`,
      version: sql`${discountOfferUsage.version} + 1`,
      updatedAt: now,
    })
    .where(
      and(
        eq(discountOfferUsage.offerId, input.identity.offerId),
        sql`${discountOfferUsage.reservedCount} >= 1`,
        sql`${discountOfferUsage.reservedAmount} >= ${amount}::numeric`
      )
    )
    .returning({ offerId: discountOfferUsage.offerId });
  if (!offerUsage) {
    throw new Error("Redemption usage drifted: offer reserved projection is below the released amount");
  }
  const [clientUsage] = await tx
    .update(discountClientUsage)
    .set({
      reservedCount: sql`${discountClientUsage.reservedCount} - 1`,
      reservedAmount: sql`${discountClientUsage.reservedAmount} - ${amount}::numeric`,
      version: sql`${discountClientUsage.version} + 1`,
      updatedAt: now,
    })
    .where(
      and(
        eq(discountClientUsage.offerId, input.identity.offerId),
        eq(discountClientUsage.clientId, input.identity.clientId),
        sql`${discountClientUsage.reservedCount} >= 1`,
        sql`${discountClientUsage.reservedAmount} >= ${amount}::numeric`
      )
    )
    .returning({ offerId: discountClientUsage.offerId });
  if (!clientUsage) {
    throw new Error("Redemption usage drifted: client reserved projection is below the released amount");
  }
  return true;
}

/**
 * Late paid SETELAH release: catat satu event review, status tetap released,
 * fulfillment tetap blocked. Tidak pernah reacquire kapasitas atau membuat
 * replacement SO. Duplicate callback dengan correlation sama = no-op.
 */
export async function recordLatePaidReview(
  tx: RedemptionTx,
  input: {
    orderId: string;
    correlation?: string | null;
    reason: string;
    source?: string;
  }
): Promise<boolean> {
  const [redemption] = await tx
    .select({
      id: discountRedemptions.id,
      status: discountRedemptions.status,
      benefitAmount: discountRedemptions.benefitAmount,
    })
    .from(discountRedemptions)
    .where(eq(discountRedemptions.orderId, input.orderId))
    .limit(1);
  if (!redemption || redemption.status !== "released") return false;
  const [inserted] = await tx
    .insert(discountRedemptionEvents)
    .values({
      id: crypto.randomUUID(),
      redemptionId: redemption.id,
      eventKey: `${redemption.id}:late_paid_review:${input.correlation ?? "unknown"}`,
      kind: "late_paid_review",
      previousStatus: "released",
      nextStatus: "released",
      amount: redemption.benefitAmount,
      source: input.source ?? "midtrans",
      correlation: input.correlation ?? null,
      reason: input.reason,
      actorIdentity: null,
    })
    .onConflictDoNothing()
    .returning({ id: discountRedemptionEvents.id });
  return inserted != null;
}

async function insertEvent(
  tx: RedemptionTx,
  input: {
    redemptionId: string;
    eventKey: string;
    kind: "reserved" | "consumed" | "released";
    previousStatus: string | null;
    nextStatus: string;
    amount: string;
    source: string;
    correlation: string | null;
    reason: string | null;
  }
): Promise<void> {
  await tx
    .insert(discountRedemptionEvents)
    .values({
      id: crypto.randomUUID(),
      redemptionId: input.redemptionId,
      eventKey: input.eventKey,
      kind: input.kind,
      previousStatus: input.previousStatus,
      nextStatus: input.nextStatus,
      amount: input.amount,
      source: input.source,
      correlation: input.correlation,
      reason: input.reason,
      actorIdentity: null,
    })
    .onConflictDoNothing();
}
