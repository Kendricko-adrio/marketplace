/**
 * delivery-order — the immutable delivery snapshot + the re-approval gate
 * (ticket 04, spec Ready "Harga dan UX quote" + "Penyimpanan").
 *
 * Public seam (pinned by delivery-order.test.ts):
 * - createDeliverySnapshot({address, origin, parcel, service, pricing}) →
 *   a DEEP-INDEPENDENT plain JSON payload (persisted in
 *   `orders.delivery_snapshot`) holding exactly the five immutable blocks.
 *   Later edits to the address book, the branch origin, the master parcel,
 *   the config or the prices can never rewrite a taken snapshot; Shipment
 *   region ids stay STRINGS incl. leading zeros.
 * - compareDeliveryApproval(approvedPricing, currentPricing) →
 *   {approved, changedFields} — the Buat-pesanan gate: approved ONLY when
 *   EVERY money field of the order-pricing reuse matches what the customer
 *   approved; a missing money field can never silently approve; non-money
 *   extras (no quote id / ttl) are ignored.
 */
import type { DeliverySnapshotPayload } from "@marketplace/db/src/schema";
import type { OrderPricing } from "./order-pricing";

/** Parcel block as built by the shipment parcel adapter (buildShipmentParcel). */
export interface DeliveryParcelInput {
  weight: number;
  items: Array<{
    item_name: string;
    quantity: number;
    value?: number;
    weight: number;
    length: number;
    width: number;
    height: number;
  }>;
}

/** Quoted canonical destination at approval time. */
export interface DeliverySnapshotAddressInput {
  recipientName: string;
  phone: string | null;
  fullAddress: string;
  provinceId: string;
  province: string;
  cityId: string;
  city: string;
  districtId: string;
  district: string;
  areaId: string | null;
  area: string;
  postalCode: string | null;
}

/** Origin sender block (branch + its configured local complement). */
export interface DeliverySnapshotOriginInput {
  branchId: string;
  name: string;
  phone: string | null;
  address: string | null;
  zipcode: string | null;
  areaId: string | null;
}

/** The quoted service the customer approved. */
export interface DeliverySnapshotServiceInput {
  courierId: number;
  serviceId: number;
  name: string;
  shippingCost: string | number;
  validEta?: { from: string; to: string };
}

export interface DeliverySnapshotInput {
  address: DeliverySnapshotAddressInput;
  origin: DeliverySnapshotOriginInput;
  parcel: DeliveryParcelInput;
  service: DeliverySnapshotServiceInput;
  pricing: OrderPricing;
}

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/**
 * Freezes the quoted delivery input into a deep-independent plain JSON
 * snapshot: the returned value holds NO reference into the live objects, so
 * ANY later mutation of the address book, the origin branch, the master
 * parcel, the config or the pricing cannot change it (the aliasing tests).
 */
export function createDeliverySnapshot(input: DeliverySnapshotInput): DeliverySnapshotPayload {
  return deepClone({
    address: {
      recipientName: input.address.recipientName,
      phone: input.address.phone ?? "",
      fullAddress: input.address.fullAddress,
      provinceId: input.address.provinceId,
      province: input.address.province,
      cityId: input.address.cityId,
      city: input.address.city,
      districtId: input.address.districtId,
      district: input.address.district,
      areaId: input.address.areaId ?? "",
      area: input.address.area,
      postalCode: input.address.postalCode ?? "",
    },
    origin: {
      branchId: input.origin.branchId,
      name: input.origin.name,
      phone: input.origin.phone ?? "",
      address: input.origin.address ?? "",
      zipcode: input.origin.zipcode ?? "",
      areaId: input.origin.areaId ?? null,
    },
    parcel: {
      weight: input.parcel.weight,
      items: input.parcel.items.map((item) => ({
        item_name: item.item_name,
        quantity: item.quantity,
        ...(item.value === undefined ? {} : { value: item.value }),
        weight: item.weight,
        length: item.length,
        width: item.width,
        height: item.height,
      })),
    },
    service: {
      courierId: input.service.courierId,
      serviceId: input.service.serviceId,
      name: input.service.name,
      shippingCost: input.service.shippingCost,
      ...(input.service.validEta ? { validEta: input.service.validEta } : {}),
    },
    pricing: {
      subtotal: input.pricing.subtotal,
      discount: input.pricing.discount,
      taxableBase: input.pricing.taxableBase,
      shippingCost: input.pricing.shippingCost,
      serviceFee: input.pricing.serviceFee,
      ppnRatePercent: input.pricing.ppnRatePercent,
      ppnAmount: input.pricing.ppnAmount,
      total: input.pricing.total,
    },
  }) as DeliverySnapshotPayload;
}

const ORDER_PRICING_MONEY_FIELDS = [
  "subtotal",
  "discount",
  "taxableBase",
  "shippingCost",
  "serviceFee",
  "ppnRatePercent",
  "ppnAmount",
  "total",
] as const;

export interface DeliveryApprovalVerdict {
  approved: boolean;
  changedFields: string[];
}

/**
 * The Buat-pesanan gate: the approval body's approvedPricing must EXACTLY
 * match the freshly re-derived pricing across every OrderPricing money field
 * (missing money fields fail closed; extra non-money keys are ignored).
 */
export function compareDeliveryApproval(
  approvedPricing: OrderPricing,
  currentPricing: OrderPricing
): DeliveryApprovalVerdict {
  const changedFields: string[] = [];
  for (const field of ORDER_PRICING_MONEY_FIELDS) {
    const approvedValue = (approvedPricing as unknown as Record<string, unknown>)[field];
    const currentValue = (currentPricing as unknown as Record<string, unknown>)[field];
    if (
      approvedValue === undefined ||
      approvedValue === null ||
      currentValue === undefined ||
      currentValue === null
    ) {
      changedFields.push(field);
      continue;
    }
    if (String(approvedValue) !== String(currentValue)) {
      changedFields.push(field);
    }
  }
  return { approved: changedFields.length === 0, changedFields };
}