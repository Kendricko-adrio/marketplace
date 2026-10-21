/**
 * Store read seam — daftar Coupon publik yang relevan untuk checkout pickup
 * (ticket 07, spec §5.1/§5.2). READ ONLY: tidak membuat Redemption/hold/usage
 * dan tidak memanggil provider. Kapasitas di sini bersifat advisory; commit
 * place-order tetap mengevaluasi ulang di bawah lock Offer.
 *
 * Discovery: hanya Offer publik `enabled` dengan revision published dan waktu
 * aktif (start inklusif, end eksklusif). Draft/paused/archived/manual-only dan
 * Offer di luar window tidak pernah muncul. Offer yang relevan tetapi belum
 * memenuhi minimum/verified email/kapasitas tampil `eligible:false` dengan
 * reason aman.
 */
import { and, asc, eq, inArray, isNull, lte, or, gt } from "drizzle-orm";
import { db } from "@/db";
import {
  cartItems,
  carts,
  clients,
  discountBenefits,
  discountClientUsage,
  discountOfferRevisions,
  discountOffers,
  discountOfferUsage,
  productVariants,
} from "@/db";
import {
  describeOfferEligibilityReason,
  evaluateOfferEligibility,
  parseMoney,
  type OfferEligibilityReason,
} from "@marketplace/db/src/discount-eligibility";
import { readVariantProjections } from "@/lib/variant-price-projection";

export const AVAILABLE_OFFERS_DEFAULT_LIMIT = 25;
export const AVAILABLE_OFFERS_MAX_LIMIT = 100;

export type DiscountAvailabilityErrorCode =
  | "INPUT_INVALID"
  | "NOT_FOUND";

export class DiscountAvailabilityError extends Error {
  constructor(readonly code: DiscountAvailabilityErrorCode, message: string) {
    super(message);
    this.name = "DiscountAvailabilityError";
  }
}

export interface AvailableOfferDto {
  offerId: string;
  name: string;
  /** Nominal fixed goods yang dikonfigurasi (belum di-clip ke subtotal). */
  benefitAmount: string;
  minSubtotal: string;
  endsAt: string | null;
  eligible: boolean;
  reason: OfferEligibilityReason | null;
  reasonMessage: string | null;
}

export interface AvailableOffersResult {
  items: AvailableOfferDto[];
  nextCursor: string | null;
}

type Database = typeof db;

/**
 * Context checkout pickup: selection milik client, satu branch, harga efektif
 * (Markdown) saat ini. `subtotalAfterMarkdown` adalah basis minimum/benefit.
 */
export async function loadPickupSelectionContext(
  input: { clientId: string; selectedItemIds: readonly string[] },
  database: Database = db
): Promise<{ subtotalAfterMarkdown: bigint; branchId: string; verifiedEmail: boolean }> {
  const selectedIds = [...input.selectedItemIds];
  if (selectedIds.length === 0 || selectedIds.length > 50 || new Set(selectedIds).size !== selectedIds.length) {
    throw new DiscountAvailabilityError("INPUT_INVALID", "Pilih barang yang valid.");
  }
  const [cart] = await database
    .select({ id: carts.id })
    .from(carts)
    .where(eq(carts.userId, input.clientId))
    .limit(1);
  if (!cart) throw new DiscountAvailabilityError("INPUT_INVALID", "Keranjang masih kosong.");

  const selected = await database
    .select({
      cartItemId: cartItems.id,
      quantity: cartItems.quantity,
      variantId: productVariants.id,
      variantPrice: productVariants.price,
      branchId: cartItems.branchId,
    })
    .from(cartItems)
    .innerJoin(productVariants, eq(cartItems.variantId, productVariants.id))
    .where(and(eq(cartItems.cartId, cart.id), inArray(cartItems.id, selectedIds)));

  if (selected.length !== selectedIds.length) {
    throw new DiscountAvailabilityError("NOT_FOUND", "Barang keranjang tidak ditemukan.");
  }
  if (selected.some((row) => !row.branchId)) {
    throw new DiscountAvailabilityError(
      "INPUT_INVALID",
      "Checkout hanya untuk satu cabang. Pilih barang dari satu cabang saja."
    );
  }
  const branches = new Set(selected.map((row) => row.branchId));
  if (branches.size !== 1) {
    throw new DiscountAvailabilityError(
      "INPUT_INVALID",
      "Checkout hanya untuk satu cabang. Pilih barang dari satu cabang saja."
    );
  }

  const projections = await readVariantProjections(selected.map((row) => row.variantId));
  let subtotal = BigInt(0);
  for (const row of selected) {
    const effective = projections.get(row.variantId)?.effectiveUnitPrice ?? row.variantPrice;
    const unit = parseMoney(effective);
    if (unit === null) {
      throw new DiscountAvailabilityError("INPUT_INVALID", "Data harga barang tidak valid.");
    }
    subtotal += unit * BigInt(row.quantity);
  }

  const [client] = await database
    .select({ emailVerified: clients.emailVerified })
    .from(clients)
    .where(eq(clients.id, input.clientId))
    .limit(1);
  if (!client) throw new DiscountAvailabilityError("NOT_FOUND", "Akun tidak ditemukan.");

  return {
    subtotalAfterMarkdown: subtotal,
    branchId: [...branches][0] as string,
    verifiedEmail: client.emailVerified,
  };
}

/**
 * List Offer publik relevan untuk context pickup. Pagination berbasis cursor
 * offset opak; kandidat dibatasi (limit+1) sehingga tidak pernah membaca
 * seluruh histori Offer.
 */
export async function readAvailableOffers(
  input: {
    clientId: string;
    selectedItemIds: readonly string[];
    limit?: number;
    cursor?: string | null;
    now?: Date;
  },
  database: Database = db
): Promise<AvailableOffersResult> {
  const now = input.now ?? new Date();
  if (!Number.isFinite(now.getTime())) {
    throw new DiscountAvailabilityError("INPUT_INVALID", "Waktu server tidak valid.");
  }
  const limit = input.limit ?? AVAILABLE_OFFERS_DEFAULT_LIMIT;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > AVAILABLE_OFFERS_MAX_LIMIT) {
    throw new DiscountAvailabilityError("INPUT_INVALID", "Batas daftar promo tidak valid.");
  }
  const offset = decodeCursor(input.cursor ?? null);

  const context = await loadPickupSelectionContext(
    { clientId: input.clientId, selectedItemIds: input.selectedItemIds },
    database
  );

  const rows = await database
    .select({
      offerId: discountOffers.id,
      quotaCount: discountOffers.quotaCount,
      budgetAmount: discountOffers.budgetAmount,
      perClientLimit: discountOffers.perClientLimit,
      revisionId: discountOfferRevisions.id,
      name: discountOfferRevisions.name,
      minSubtotal: discountOfferRevisions.minSubtotal,
      startAt: discountOfferRevisions.startAt,
      endAt: discountOfferRevisions.endAt,
      publishedAt: discountOfferRevisions.publishedAt,
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
    .where(
      and(
        eq(discountOffers.state, "enabled"),
        eq(discountOffers.activationKind, "public"),
        or(
          isNull(discountOfferRevisions.startAt),
          lte(discountOfferRevisions.startAt, now)
        ),
        or(
          isNull(discountOfferRevisions.endAt),
          gt(discountOfferRevisions.endAt, now)
        )
      )
    )
    .orderBy(asc(discountOfferRevisions.name), asc(discountOffers.id))
    .limit(limit + 1)
    .offset(offset);

  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);
  const clientUsageRows = page.length === 0
    ? []
    : await database
        .select({
          offerId: discountClientUsage.offerId,
          reservedCount: discountClientUsage.reservedCount,
          consumedCount: discountClientUsage.consumedCount,
          reservedAmount: discountClientUsage.reservedAmount,
          consumedAmount: discountClientUsage.consumedAmount,
        })
        .from(discountClientUsage)
        .where(
          and(
            eq(discountClientUsage.clientId, input.clientId),
            inArray(
              discountClientUsage.offerId,
              page.map((row) => row.offerId)
            )
          )
        );
  const clientUsage = new Map(clientUsageRows.map((row) => [row.offerId, row]));

  const items: AvailableOfferDto[] = page.map((row) => {
    const minSubtotal = normalizeMoney(row.minSubtotal);
    const eligibility = evaluateOfferEligibility({
      now,
      verifiedEmail: context.verifiedEmail,
      subtotalAfterMarkdown: context.subtotalAfterMarkdown.toString(),
      offer: {
        activationKind: "public",
        state: "enabled",
        revisionPublished: row.publishedAt != null,
        startAt: row.startAt,
        endAt: row.endAt,
        minSubtotal,
        quotaCount: row.quotaCount,
        budgetAmount: normalizeMoney(row.budgetAmount),
        perClientLimit: row.perClientLimit,
        benefit:
          row.fixedAmount == null
            ? null
            : {
                kind: row.benefitKind,
                paramsVersion: row.paramsVersion,
                fixedAmount: normalizeMoney(row.fixedAmount),
              },
        usage: {
          reservedCount: row.reservedCount,
          consumedCount: row.consumedCount,
          reservedAmount: row.reservedAmount,
          consumedAmount: row.consumedAmount,
        },
        clientUsage: clientUsage.get(row.offerId) ?? null,
      },
    });
    return {
      offerId: row.offerId,
      name: row.name ?? "",
      benefitAmount: normalizeMoney(row.fixedAmount),
      minSubtotal,
      endsAt: row.endAt ? row.endAt.toISOString() : null,
      eligible: eligibility.eligible,
      reason: eligibility.reason,
      reasonMessage: eligibility.eligible
        ? null
        : describeOfferEligibilityReason(eligibility.reason),
    };
  });

  return {
    items,
    nextCursor: hasMore ? encodeCursor(offset + limit) : null,
  };
}

/** DB numeric scale2 → whole-Rupiah string; null/absent → "0". */
function normalizeMoney(value: string | number | null | undefined): string {
  if (value == null) return "0";
  const parsed = parseMoney(value);
  if (parsed === null) return "0";
  return parsed.toString();
}

function encodeCursor(offset: number): string {
  return Buffer.from(JSON.stringify({ v: 1, o: offset }), "utf8").toString("base64url");
}

function decodeCursor(cursor: string | null): number {
  if (!cursor) return 0;
  if (cursor.length > 128) {
    throw new DiscountAvailabilityError("INPUT_INVALID", "Cursor tidak valid.");
  }
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as {
      v?: unknown;
      o?: unknown;
    };
    if (parsed?.v !== 1 || !Number.isSafeInteger(parsed.o) || (parsed.o as number) < 0) {
      throw new Error("bad cursor");
    }
    return parsed.o as number;
  } catch {
    throw new DiscountAvailabilityError("INPUT_INVALID", "Cursor tidak valid.");
  }
}
