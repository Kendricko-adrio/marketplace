import { z } from "zod";
import { clientAddressInputSchema } from "@/lib/client-addresses";

export const selectedIdsSchema = z.array(z.string().min(1).max(128))
  .min(1, "Select at least one item to checkout").max(50)
  .refine((ids) => new Set(ids).size === ids.length, "Duplicate selected cart item IDs");

export const reviewFields = {
  requestKey: z.string().uuid().transform((key) => key.toLowerCase()).optional(),
  reviewToken: z.string().min(1).max(2048).optional(),
  /**
   * Persetujuan penggantian/invalidation (ticket 08): selalu menunjuk candidate
   * fingerprint review token, bukan boolean bebas. Hanya persetujuan yang
   * ditandai token yang diperiksa; flag tambahan tidak memberi izin apa pun.
   */
  acknowledgements: z
    .strictObject({
      promoIncrease: z
        .strictObject({ candidateFingerprint: z.string().regex(/^[a-f0-9]{64}$/) })
        .optional(),
      continueWithoutPromo: z
        .strictObject({ candidateFingerprint: z.string().regex(/^[a-f0-9]{64}$/) })
        .optional(),
    })
    .optional(),
  // Satu slot promo: tanpa promo, satu Coupon publik, atau satu Manual Promo
  // Code (ticket 09). Promo delivery dimiliki ticket 11.
  promoSelection: z
    .discriminatedUnion("kind", [
      z.strictObject({ kind: z.literal("none") }),
      z.strictObject({
        kind: z.literal("public"),
        offerId: z.string().min(1).max(128),
      }),
      z.strictObject({
        kind: z.literal("manual"),
        code: z.string().min(1).max(128),
      }),
    ])
    .optional(),
};

export const placeOrderSchema = z.object({
  ...reviewFields,
  phone: z
    .string()
    .min(8, "Phone number is required")
    .max(20, "Phone number is too long"),
  email: z.string().email("Valid email is required"),
  pickupDate: z.string(), // YYYY-MM-DD
  pickupTime: z.string(), // HH:mm
  // Cart item ids the customer chose to checkout in this order.
  selectedItemIds: selectedIdsSchema,
}).strict();

// Ticket 04 — the delivery approval body. ONLY an approval: every money
// field is re-derived server-side (fresh quote) and compared; `pickupDate`/
// `pickupTime` are deliberately absent from a delivery submission.
export const REPRICE_REQUIRED_MESSAGE =
  "Ongkir telah berubah. Periksa kembali rincian pesanan sebelum melanjutkan.";

export const deliveryPlaceOrderBase = z
  .object({
    ...reviewFields,
    itemIds: selectedIdsSchema,
    contactPhone: z
      .string()
      .min(8, "Phone number is required")
      .max(20, "Phone number is too long"),
    contactEmail: z.string().email("Valid email is required"),
    fulfillmentMethod: z.literal("delivery"),
    courierId: z.number().int(),
    serviceId: z.number().int(),
    approvedPricing: z.record(z.string(), z.union([z.string(), z.number()])),
    originFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  });
export const deliveryPlaceOrderSchema = z.union([
  deliveryPlaceOrderBase.extend({ addressId: z.string().min(1).max(128) }).strict(),
  deliveryPlaceOrderBase.extend({ newAddress: clientAddressInputSchema, saveAddress: z.boolean(), saveRequestId: z.string().uuid() }).strict(),
]);

export type DeliveryPlaceOrderData = z.infer<typeof deliveryPlaceOrderSchema>;

export type PlaceOrderData = z.infer<typeof placeOrderSchema> | DeliveryPlaceOrderData;

export function parsePlaceOrderBody(body: unknown, fulfillmentMethod: unknown) {
  return fulfillmentMethod === "delivery"
    ? deliveryPlaceOrderSchema.safeParse(body)
    : placeOrderSchema.safeParse(body);
}

export function extractPlaceOrderFields(data: PlaceOrderData, isDelivery: boolean) {
  const deliveryBody = isDelivery ? (data as DeliveryPlaceOrderData) : null;
  const phone = isDelivery ? deliveryBody!.contactPhone : (data as { phone: string }).phone;
  const email = isDelivery ? deliveryBody!.contactEmail : (data as { email: string }).email;
  const selectedItemIds = isDelivery ? deliveryBody!.itemIds : (data as { selectedItemIds: string[] }).selectedItemIds;
  const pickupDate = isDelivery ? null : (data as { pickupDate: string }).pickupDate;
  const pickupTime = isDelivery ? null : (data as { pickupTime: string }).pickupTime;
  return { phone, email, selectedItemIds, pickupDate, pickupTime, deliveryBody };
}
