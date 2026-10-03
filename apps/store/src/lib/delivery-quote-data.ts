/**
 * delivery-quote-data — server-side loaders for the delivery quote endpoint
 * (ticket 03). The browser NEVER supplies money/weights: this module loads
 * the OWNED cart rows (with CURRENT variant prices and per-SKU parcel
 * dimensions), the single origin branch with its local sender complement, the
 * owned canonical address — revalidated against the Shipment region gateway
 * BEFORE the provider is consulted — and the IT-managed parcel configuration
 * (`shipment.packagingWeightGrams` + optional `shipment.parcelFallback`).
 *
 * Failures are typed (`DeliveryQuoteDataError`): NOT_FOUND maps to 404,
 * INVALID_INPUT/NOT_READY to 400, UNAVAILABLE stays non-persistent — stale or
 * zero pricing is never produced through any of them.
 */
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { addresses, branches, cartItems, carts, productVariants, products } from "@/db";
import { getPpnRatePercent } from "@/lib/config";
import { loadShipmentParcelConfig as readShipmentParcelConfig } from "./shipment-config";
import { createShipmentRegionGateway } from "./shipment-regions";
import { clientAddressInputSchema, type ClientAddressInput } from "./client-addresses";
import type { JubelioParcelDimensions } from "@marketplace/db/src/jubelio-parcel";
import type {
  ShipmentQuoteDestination,
  ShipmentQuoteItem,
  ShipmentQuoteOriginBranch,
} from "./delivery-quote";
import type { ShipmentDimensions } from "./shipment-parcel";

export type DeliveryQuoteDataErrorCode =
  | "NOT_FOUND" // cart items or address not owned/absent
  | "INVALID_INPUT" // cross-branch cart, unusable id
  | "NOT_READY" // inactive/origin-less branch, unconfigured parcel config
  | "UNAVAILABLE"; // region revalidation could not complete

export class DeliveryQuoteDataError extends Error {
  readonly code: DeliveryQuoteDataErrorCode;

  constructor(code: DeliveryQuoteDataErrorCode, message: string) {
    super(message);
    this.name = "DeliveryQuoteDataError";
    this.code = code;
  }
}

export interface ShipmentParcelConfig {
  /** Nonnegative integer kemasan grams — REQUIRED (never guessed). */
  packagingWeightGrams: number;
  /** IT-managed per-unit fallback dims; null means "all items need master". */
  fallback: ShipmentDimensions | null;
}

function isValidParcelDimensions(value: unknown): value is JubelioParcelDimensions {
  if (!value || typeof value !== "object") return false;
  const dims = value as JubelioParcelDimensions;
  return (
    Number.isSafeInteger(dims.weight) &&
    dims.weight > 0 &&
    [dims.length, dims.width, dims.height].every(
      (part) => typeof part === "number" && Number.isFinite(part) && part > 0
    )
  );
}

/** IT-managed packaging + optional fallback — missing/invalid fails closed. */
export async function loadShipmentParcelConfig(): Promise<ShipmentParcelConfig> {
  const { packagingWeight: packagingWeightGrams, fallback } = await readShipmentParcelConfig();
  if (!Number.isSafeInteger(packagingWeightGrams) || packagingWeightGrams < 0) {
    throw new DeliveryQuoteDataError(
      "NOT_READY",
      "Berat kemasan belum dikonfigurasi. Delivery belum tersedia."
    );
  }
  if (fallback !== null && !isValidParcelDimensions(fallback)) {
    throw new DeliveryQuoteDataError(
      "NOT_READY",
      "Konfigurasi fallback parcel belum valid. Delivery belum tersedia."
    );
  }
  return { packagingWeightGrams, fallback };
}

/** The PPN rate percent reused by the pricing module (string contract). */
export async function loadDeliveryPpnRatePercent(): Promise<string> {
  return getPpnRatePercent();
}

/**
 * Loads ALL the owned cart rows for the quoted item ids with CURRENT variant
 * prices and parcel dimensions; resolves the single origin branch id (a
 * cross-branch cart is rejected clearly). Every requested id must resolve —
 * any miss is presented as not found.
 */
export async function loadOwnedQuoteCartItems(
  clientId: string,
  itemIds: string[]
): Promise<{ items: ShipmentQuoteItem[]; branchId: string }> {
  const cleanIds = Array.from(
    new Set(itemIds.map((id) => id.trim()).filter((id) => id.length > 0))
  );
  if (cleanIds.length === 0) {
    throw new DeliveryQuoteDataError(
      "INVALID_INPUT",
      "Tidak ada barang yang dipilih untuk di-quote."
    );
  }
  const rows = await db
    .select({
      cartItemId: cartItems.id,
      quantity: cartItems.quantity,
      branchId: cartItems.branchId,
      variantPrice: productVariants.price,
      parcelDimensions: productVariants.parcelDimensions,
      productName: products.name,
      variantColor: productVariants.color,
      variantSize: productVariants.size,
    })
    .from(cartItems)
    .innerJoin(carts, eq(cartItems.cartId, carts.id))
    .innerJoin(productVariants, eq(cartItems.variantId, productVariants.id))
    .innerJoin(products, eq(productVariants.productId, products.id))
    .where(and(eq(carts.userId, clientId), inArray(cartItems.id, cleanIds)));

  // Every requested id must belong to the quoting client's cart — otherwise
  // this is not the caller's data and is presented as not found.
  if (rows.length !== cleanIds.length) {
    throw new DeliveryQuoteDataError(
      "NOT_FOUND",
      "Barang keranjang tidak ditemukan atau bukan milik Anda."
    );
  }

  const branchIds = new Set(
    rows.map((row) => row.branchId).filter((id): id is string => !!id)
  );
  if (rows.some((row) => !row.branchId) || branchIds.size !== 1) {
    throw new DeliveryQuoteDataError(
      "INVALID_INPUT",
      "Checkout delivery hanya untuk satu cabang. Pisahkan keranjang lintas cabang."
    );
  }

  const items = rows.map((row) => {
    const variantLabel = [row.variantColor, row.variantSize].filter(Boolean).join(" / ");
    return {
      branchId: row.branchId as string,
      itemName: `${row.productName}${variantLabel ? ` ${variantLabel}` : ""}`.trim(),
      quantity: row.quantity,
      value: row.variantPrice,
      dimensions: row.parcelDimensions,
    } satisfies ShipmentQuoteItem;
  });
  return { items, branchId: [...branchIds][0] };
}

/** The single origin branch WITH its local sender complement configured. */
export async function loadQuoteOriginBranch(branchId: string): Promise<ShipmentQuoteOriginBranch> {
  const rows = await db
    .select({
      id: branches.id,
      name: branches.name,
      status: branches.status,
      shippingPhone: branches.shippingPhone,
      shippingAddress: branches.shippingAddress,
      shippingPostalCode: branches.shippingPostalCode,
      shippingAreaId: branches.shippingAreaId,
    })
    .from(branches)
    .where(eq(branches.id, branchId))
    .limit(1);
  if (rows.length === 0) {
    throw new DeliveryQuoteDataError("NOT_FOUND", "Cabang asal kirim tidak ditemukan.");
  }
  const branch = rows[0];
  if (branch.status !== "aktif") {
    throw new DeliveryQuoteDataError("NOT_READY", "Cabang asal kirim tidak aktif.");
  }
  if (
    !(branch.shippingPhone ?? "").trim() ||
    !(branch.shippingAddress ?? "").trim() ||
    !(branch.shippingPostalCode ?? "").trim()
  ) {
    throw new DeliveryQuoteDataError(
      "NOT_READY",
      "Cabang asal kirim belum siap untuk delivery."
    );
  }
  return branch;
}

/**
 * Loads the owned canonical address and REVALIDATES its region chain with the
 * Shipment region gateway before the provider is consulted (fail closed on a
 * stale/invalid region pair). Legacy rows without the verified chain are
 * treated as not ready. Returns BOTH the quote destination (postal/area) and
 * the full verified block for the immutable delivery snapshot (ticket 04).
 */
export interface RevalidatedDestination extends ShipmentQuoteDestination {
  recipientName: string;
  phone: string;
  fullAddress: string;
  /** The gateway-verified canonical region block (strings incl. zeros). */
  canonical: {
    provinceId: string;
    province: string;
    cityId: string;
    city: string;
    districtId: string;
    district: string;
    areaId: string;
    area: string;
    postalCode: string;
  };
}

export async function loadRevalidatedDestination(
  clientId: string,
  addressId: string
): Promise<RevalidatedDestination> {
  const rows = await db
    .select({
      id: addresses.id,
      firstName: addresses.firstName,
      phone: addresses.phone,
      fullAddress: addresses.fullAddress,
      provinceId: addresses.provinceId,
      cityId: addresses.cityId,
      districtId: addresses.districtId,
      areaId: addresses.areaId,
      postalCode: addresses.postalCode,
    })
    .from(addresses)
    .where(and(eq(addresses.id, addressId), eq(addresses.userId, clientId)))
    .limit(1);
  if (rows.length === 0) {
    throw new DeliveryQuoteDataError(
      "NOT_FOUND",
      "Alamat tidak ditemukan atau bukan milik Anda."
    );
  }
  const row = rows[0];
  if (
    !row.provinceId ||
    !row.cityId ||
    !row.districtId ||
    !row.areaId ||
    !row.postalCode
  ) {
    throw new DeliveryQuoteDataError(
      "NOT_READY",
      "Alamat belum memiliki wilayah terverifikasi. Pilih ulang alamat yang valid."
    );
  }

  return loadRevalidatedNewDestination({
    recipientName: row.firstName,
    phone: row.phone ?? "",
    fullAddress: row.fullAddress,
    provinceId: row.provinceId,
    cityId: row.cityId,
    districtId: row.districtId,
    areaId: row.areaId,
    postalCode: row.postalCode,
    isDefault: false,
  });
}

/** Ephemeral destinations share the exact same server-side region verification. */
export async function loadRevalidatedNewDestination(
  input: ClientAddressInput
): Promise<RevalidatedDestination> {
  const parsed = clientAddressInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new DeliveryQuoteDataError("INVALID_INPUT", "Alamat tidak valid.");
  }
  const regionGateway = createShipmentRegionGateway();
  let canonical;
  try {
    canonical = await regionGateway.validateAddress(parsed.data);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("REGION_INPUT_INVALID")) {
      throw new DeliveryQuoteDataError(
        "INVALID_INPUT",
        "Alamat tidak lolos verifikasi wilayah. Pilih ulang alamat yang valid."
      );
    }
    throw new DeliveryQuoteDataError(
      "UNAVAILABLE",
      "Verifikasi wilayah gagal. Coba lagi."
    );
  }
  return {
    postalCode: canonical.postalCode,
    areaId: canonical.areaId,
    recipientName: parsed.data.recipientName,
    phone: parsed.data.phone,
    fullAddress: parsed.data.fullAddress,
    canonical,
  };
}