/**
 * quoteDelivery — pure backend quote seam for the checkout delivery choice
 * (ticket 03, spec Ready "Harga dan UX quote").
 *
 * Contract (pinned by apps/store/src/lib/delivery-quote.test.ts):
 * - Validates the input BEFORE the gateway touches the provider: active
 *   branch with a non-blank local origin, destination with a verified-shaped
 *   region chain (digits, non-blank postal), non-empty single-branch cart
 *   (cross-branch carts throw before any network call).
 * - Assembles the /rates/all request via the parcel adapter (per-SKU master
 *   dims, fallback for dimensionless SKUs, packaging weight) and passes the
 *   vendor response through — quoting ONLY vendor `rates`, never
 *   `final_rates` (the discounted field is ignored).
 * - Prices every surviving service with the existing order-pricing module in
 *   delivery mode (PPN over goods + ongkir, per-Rupiah rounding up), reusing
 *   its string amounts; computes the goods subtotal via
 *   calculateLineItemSubtotal from the CURRENT item values.
 * - Insurance filter is fail-closed: a rate carrying unknown NON-EMPTY
 *   `insurance_info` metadata is EXCLUDED (probed as opaque — no assumed
 *   required-key semantics are invented); `null`/empty stays includable.
 * - Failed / malformed / EMPTY provider responses throw — never a stale or
 *   zero ongkir. The quote carries NO id and NO TTL: the result is exactly
 *   `{ services }`.
 */
import {
  calculateLineItemSubtotal,
  calculateOrderPricing,
  type OrderPricing,
} from "./order-pricing";
import { buildShipmentParcel, type ShipmentDimensions } from "./shipment-parcel";

export type ShipmentQuoteOriginBranch = {
  id: string;
  name: string;
  status: string;
  shippingPhone: string | null;
  shippingAddress: string | null;
  shippingPostalCode: string | null;
  shippingAreaId: string | null;
};

export interface ShipmentQuoteItem {
  branchId: string;
  itemName: string;
  quantity: number;
  /** Current unit value (number or decimal string — pricing reuses it). */
  value: string | number;
  /** Per-SKU master dims; null → the store fallback must supply usable dims. */
  dimensions: ShipmentDimensions | null;
}

export interface ShipmentQuoteDestination {
  /** Verified canonical region fields (revalidated by the caller's gateway). */
  postalCode: string | null;
  areaId: string | null;
}

export interface ShipmentQuoteInput {
  branch: ShipmentQuoteOriginBranch;
  items: ShipmentQuoteItem[];
  destination: ShipmentQuoteDestination;
  fallback: ShipmentDimensions | null;
  packagingWeight: number;
  ppnRatePercent: string | number;
}

/** The ONLY external boundary: one POST /rates/all, raw vendor shape. */
export interface ShipmentQuoteGateway {
  rates(request: ReturnType<typeof buildShipmentRatesRequest>): Promise<unknown[]>;
}

/** Full per-service pricing object — the order-pricing strings. */
export type DeliveryQuoteServicePricing = ReturnType<typeof calculateOrderPricing>;

export interface DeliveryQuoteService {
  courierId: number;
  serviceId: number;
  name: string;
  shippingCost: number;
  pricing: OrderPricing;
  /** Only present when BOTH eta fields exist and parse as valid dates. */
  validEta?: { from: string; to: string };
}

export interface DeliveryQuote {
  services: DeliveryQuoteService[];
}

export type QuoteDeliveryErrorCode =
  | "INVALID_INPUT" // inactive/origin-less branch, cross-branch or empty cart
  | "NO_SERVICES" // provider answered with zero usable services
  | "PROVIDER"; // failed or malformed provider interaction (no retries)

export class QuoteDeliveryError extends Error {
  readonly code: QuoteDeliveryErrorCode;

  constructor(code: QuoteDeliveryErrorCode, message: string) {
    super(message);
    this.name = "QuoteDeliveryError";
    this.code = code;
  }
}

function finitePositive(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return null;
  }
  return value;
}

/** Unknown insurance metadata: excluded when present AND non-empty. */
function hasNonEmptyInsuranceMetadata(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") {
    return Object.keys(value as Record<string, unknown>).length > 0;
  }
  if (typeof value === "number") return Number.isFinite(value) && value !== 0;
  return Boolean(value);
}

function nonBlank(value: string | null | undefined, message: string): string {
  const trimmed = (value ?? "").trim();
  if (!trimmed) throw new QuoteDeliveryError("INVALID_INPUT", message);
  return trimmed;
}

/**
 * Builds {origin, destination, weight, items} for POST /rates/all from the
 * branch's local sender block, the verified destination, per-SKU master dims
 * and the store fallback; weight is worked per unit × quantity + kemasan.
 */
export function buildShipmentRatesRequest(
  input: ShipmentQuoteInput,
  destinationAreaId: string
) {
  const parcel = buildShipmentParcel({
    items: input.items.map((item) => ({
      itemName: item.itemName,
      quantity: item.quantity,
      value: Number(item.value),
      dimensions: item.dimensions,
    })),
    fallback: input.fallback,
    packagingWeight: input.packagingWeight,
  });
  const originAreaId = (input.branch.shippingAreaId ?? "").trim();
  return {
    origin: {
      name: input.branch.name,
      phone: (input.branch.shippingPhone ?? "").trim(),
      address: (input.branch.shippingAddress ?? "").trim(),
      zipcode: (input.branch.shippingPostalCode ?? "").trim(),
      // Shipment area_id is optional per the contract (v1.8).
      ...(originAreaId && /^\d{1,16}$/.test(originAreaId) ? { area_id: originAreaId } : {}),
    },
    destination: {
      zipcode: (input.destination.postalCode ?? "").trim(),
      ...(destinationAreaId ? { area_id: destinationAreaId } : {}),
    },
    weight: parcel.weight,
    items: parcel.items,
  };
}

export async function quoteDelivery(
  input: ShipmentQuoteInput,
  gateway: ShipmentQuoteGateway
): Promise<DeliveryQuote> {
  // --- Input validation BEFORE the gateway (no network on invalid input) ---
  if (input.branch.status !== "aktif") {
    throw new QuoteDeliveryError("INVALID_INPUT", "Cabang asal kirim belum aktif");
  }
  const originPhone = nonBlank(input.branch.shippingPhone, "Asal kirim belum memiliki telepon pengirim yang valid");
  nonBlank(input.branch.shippingAddress, "Asal kirim belum memiliki alamat pengirim yang valid");
  const originZipcode = nonBlank(input.branch.shippingPostalCode, "Asal kirim belum memiliki kode pos pengirim yang valid");
  const originAreaId = (input.branch.shippingAreaId ?? "").trim();
  const destinationZipcode = nonBlank(input.destination.postalCode, "Alamat tujuan belum memiliki kode pos yang valid");
  const destinationAreaId = (input.destination.areaId ?? "").trim();

  // Origin/destination region identifiers are Shipment digit-strings.
  if (!/^\d{3,10}$/.test(originZipcode) || !/^\d{3,10}$/.test(destinationZipcode)) {
    throw new QuoteDeliveryError("INVALID_INPUT", "Kode pos asal kirim tidak valid");
  }
  if (originAreaId && !/^\d{1,16}$/.test(originAreaId)) {
    throw new QuoteDeliveryError("INVALID_INPUT", "Area id asal kirim tidak valid");
  }
  if (destinationAreaId && !/^\d{1,16}$/.test(destinationAreaId)) {
    throw new QuoteDeliveryError("INVALID_INPUT", "Area id alamat tujuan tidak valid");
  }

  const items = input.items;
  if (items.length === 0) {
    throw new QuoteDeliveryError("INVALID_INPUT", "Keranjang delivery kosong");
  }
  for (const item of items) {
    if (item.branchId !== input.branch.id) {
      throw new QuoteDeliveryError(
        "INVALID_INPUT",
        "Checkout delivery hanya untuk satu cabang. Pisahkan keranjang lintas cabang."
      );
    }
    if (!Number.isSafeInteger(item.quantity) || item.quantity <= 0) {
      throw new QuoteDeliveryError("INVALID_INPUT", `Kuantitas item tidak valid: ${item.itemName}`);
    }
  }

  // Goods subtotal from the CURRENT item values (never from the browser).
  const subtotal = calculateLineItemSubtotal(
    items.map((item) => ({ price: item.value, quantity: item.quantity }))
  );

  const request = buildShipmentRatesRequest(
    { ...input, branch: { ...input.branch, shippingPhone: originPhone } },
    destinationAreaId
  );

  // --- Provider boundary (no retries, no fallback) ------------------------
  let rawRates: unknown[];
  try {
    rawRates = await gateway.rates(request);
  } catch (error) {
    throw new QuoteDeliveryError(
      "PROVIDER",
      `rates failed: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  if (!Array.isArray(rawRates)) {
    throw new QuoteDeliveryError("PROVIDER", "rates failed: malformed response");
  }

  const services: DeliveryQuoteService[] = [];
  for (const raw of rawRates) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const rate = raw as Record<string, unknown>;
    // Unknown insurance metadata is excluded as opaque: non-empty content
    // means the service is not quotable until the vendor semantics are known.
    if (hasNonEmptyInsuranceMetadata(rate.insurance_info)) continue;

    const ratesAmount = finitePositive(rate.rates);
    const courierId = finitePositive(rate.courier_id);
    const serviceId = finitePositive(rate.courier_service_id);
    const name = typeof rate.courier_service_name === "string" ? rate.courier_service_name.trim() : "";
    if (ratesAmount === null || courierId === null || serviceId === null || !name) {
      // A malformed usable-looking row never becomes an invented zero.
      continue;
    }
    const pricing = calculateOrderPricing({
      subtotal,
      shippingCost: ratesAmount,
      fulfillmentMethod: "delivery",
      ppnRatePercent: input.ppnRatePercent,
    });
    const etaFrom = rate.eta_from;
    const etaTo = rate.eta_to;
    const validEta =
      typeof etaFrom === "string" &&
      typeof etaTo === "string" &&
      Number.isFinite(Date.parse(etaFrom)) &&
      Number.isFinite(Date.parse(etaTo))
        ? { from: etaFrom, to: etaTo }
        : undefined;
    services.push({ courierId, serviceId, name, shippingCost: ratesAmount, pricing, validEta });
  }
  if (services.length === 0) {
    throw new QuoteDeliveryError(
      "NO_SERVICES",
      "Tidak ada layanan pengiriman untuk alamat ini. Coba alamat lain atau gunakan pengambilan di cabang."
    );
  }

  return { services };
}