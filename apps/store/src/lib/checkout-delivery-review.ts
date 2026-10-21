import { z } from "zod";
import { and, eq, inArray, asc } from "drizzle-orm";
import { db, carts, cartItems } from "@/db";
import { clientAddressInputSchema } from "./client-addresses";
import { loadOwnedQuoteCartItems, loadQuoteOriginBranch, loadRevalidatedDestination, loadRevalidatedNewDestination, loadShipmentParcelConfig, DeliveryQuoteDataError } from "./delivery-quote-data";
import { getPpnRatePercent } from "./config";
import { quoteDelivery, QuoteDeliveryError } from "./delivery-quote";
import { createJubelioShipmentGateway } from "./jubelio-shipment-client";
import { buildShipmentParcel } from "./shipment-parcel";
import { createDeliverySnapshot } from "./delivery-order";
import { buildPricingSnapshot } from "./versioned-pricing";
import { buildCheckoutReviewContextFingerprint, createCheckoutReviewToken } from "./checkout-review";

const base = z.object({
  fulfillmentMethod: z.literal("delivery"),
  itemIds: z.array(z.string().min(1).max(128)).min(1).max(50)
    .refine((ids) => new Set(ids).size === ids.length),
  contactPhone: z.string().min(8).max(20), contactEmail: z.string().email(),
  courierId: z.number().int(), serviceId: z.number().int(),
  originFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  approvedPricing: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
  promoSelection: z.object({ kind: z.literal("none") }).strict(),
});
export const deliveryReviewSchema = z.union([
  base.extend({ addressId: z.string().min(1).max(128) }).strict(),
  base.extend({ newAddress: clientAddressInputSchema, saveAddress: z.boolean(), saveRequestId: z.string().uuid() }).strict(),
]);

/** Preview delivery read/rates-only; tidak membuat order/hold/address/intent. */
export async function previewDeliveryReview(clientId: string, input: z.infer<typeof deliveryReviewSchema>) {
  const loaded = await loadOwnedQuoteCartItems(clientId, input.itemIds);
  const { branchId } = loaded;
  const items = loaded.items.map((item) => {
    if (!item.variantId) throw new DeliveryQuoteDataError("INVALID_INPUT", "Variant tidak tersedia.");
    return { ...item, variantId: item.variantId };
  });
  items.sort((a, b) => a.variantId < b.variantId ? -1 : a.variantId > b.variantId ? 1 : 0);
  const ppnRatePercent = await getPpnRatePercent();
  // Source bounds sebelum region/rates HTTP.
  const lines = items.map((item) => ({ variantId: item.variantId, quantity: item.quantity,
    sourceUnitPrice: String(item.value),
    effectiveUnitPrice: String(item.effectiveValue ?? item.value),
    markdownRevisionId: item.markdownRevisionId ?? null }));
  buildPricingSnapshot({ fulfillmentMethod: "delivery", ppnRatePercent, lines });
  const origin = await loadQuoteOriginBranch(branchId);
  const destination = "addressId" in input ? await loadRevalidatedDestination(clientId, input.addressId)
    : await loadRevalidatedNewDestination(input.newAddress);
  const parcelConfig = await loadShipmentParcelConfig();
  const quote = await quoteDelivery({ pricingContractVersion: 1, branch: origin, items,
    destination: { postalCode: destination.postalCode, areaId: destination.areaId },
    fallback: parcelConfig.fallback, packagingWeight: parcelConfig.packagingWeightGrams, ppnRatePercent,
  }, createJubelioShipmentGateway());
  const chosen = quote.services.find((service) => service.courierId === input.courierId && service.serviceId === input.serviceId);
  if (!chosen || chosen.originFingerprint !== input.originFingerprint) {
    throw new QuoteDeliveryError("INVALID_INPUT", "Layanan pengiriman berubah. Periksa kembali ongkir.");
  }
  const snapshot = buildPricingSnapshot({ fulfillmentMethod: "delivery", ppnRatePercent, lines,
    shippingBeforeSubsidy: chosen.shippingCost, providerQuotedShippingCost: null });
  const pricing = { subtotal: snapshot.subtotal, discount: snapshot.goodsDiscount,
    sourceGoodsSubtotal: snapshot.sourceGoodsSubtotal, markdownTotal: snapshot.markdownTotal,
    taxableBase: snapshot.taxableBase,
    shippingCost: snapshot.shippingCost, serviceFee: snapshot.serviceFee, ppnRatePercent: snapshot.ppnRatePercent,
    ppnAmount: snapshot.ppnAmount, total: snapshot.total };
  const parcel = buildShipmentParcel({ items: items.map((item) => ({ itemName: item.itemName, quantity: item.quantity,
    value: Number(item.value), dimensions: item.dimensions })), fallback: parcelConfig.fallback,
    packagingWeight: parcelConfig.packagingWeightGrams });
  const deliverySnapshot = createDeliverySnapshot({ address: { ...destination.canonical,
    recipientName: destination.recipientName, phone: destination.phone, fullAddress: destination.fullAddress },
    origin: { branchId, name: origin.name, phone: origin.shippingPhone, address: origin.shippingAddress,
      zipcode: origin.shippingPostalCode, areaId: origin.shippingAreaId },
    parcel, service: { courierId: chosen.courierId, serviceId: chosen.serviceId, name: chosen.name,
      shippingCost: chosen.shippingCost }, pricing });
  const selected = await db.select({ cartItemId: cartItems.id, variantId: cartItems.variantId, quantity: cartItems.quantity })
    .from(cartItems).innerJoin(carts, eq(carts.id, cartItems.cartId)).where(and(eq(carts.userId, clientId), inArray(cartItems.id, input.itemIds))).orderBy(asc(cartItems.id));
  if (selected.length !== input.itemIds.length || items.some((item) =>
    !selected.some((row) => row.variantId === item.variantId && row.quantity === item.quantity))) {
    throw new DeliveryQuoteDataError("INVALID_INPUT", "Keranjang berubah. Periksa kembali pesanan.");
  }
  const contextFingerprint = buildCheckoutReviewContextFingerprint({ clientId,
    contactPhone: input.contactPhone, contactEmail: input.contactEmail, branchId,
    fulfillmentMethod: "delivery", pickupDate: null, pickupTime: null, deliverySnapshot, promo: { kind: "none" },
    pricing: { ...pricing, currency: snapshot.currency, pricingContractVersion: 1, pricingEngineVersion: 1, providerContractVersion: 2 },
    lines: snapshot.lines.map((line) => ({ cartItemId: selected.find((row) => row.variantId === line.variantId)!.cartItemId,
      variantId: line.variantId, branchId, quantity: line.quantity, sourceUnitPrice: line.sourceUnitPrice })),
  });
  return { pricing, contextFingerprint, ...createCheckoutReviewToken({ contextFingerprint }),
    deliveryService: { ...chosen, pricing } };
}
