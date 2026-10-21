/**
 * POST /api/checkout/delivery-quote — backend quote for the checkout delivery
 * choice (ticket 03). STRICT body {itemIds, addressId} or
 * {itemIds, newAddress}. The browser NEVER supplies money/weights/branches:
 * the route loads the owned cart rows (with
 * current variant prices and parcel dims), the single origin branch with its
 * configured local sender block, the owned or inline address (region chain
 * revalidated against the Shipment region gateway BEFORE the provider), the parcel config
 * and the PPN rate, then quotes via the Jubelio Shipment rates/all adapter.
 *
 * Current ticket is the QUOTE PREVIEW only: no order/payment is created.
 *
 * Logging is PII-safe: no addresses, phones, tokens or raw provider payloads
 * — only ids, counts and outcome markers.
 */
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireOnboardedApiSession } from "@/lib/route-access";
import { createLogger, serializeError } from "@/lib/logger";
import {
  DeliveryQuoteDataError,
  loadDeliveryPpnRatePercent,
  loadOwnedQuoteCartItems,
  loadQuoteOriginBranch,
  loadRevalidatedDestination,
  loadRevalidatedNewDestination,
  loadShipmentParcelConfig,
} from "@/lib/delivery-quote-data";
import { QuoteDeliveryError, quoteDelivery } from "@/lib/delivery-quote";
import { createJubelioShipmentGateway } from "@/lib/jubelio-shipment-client";
import { clientAddressInputSchema } from "@/lib/client-addresses";
import { getDiscountsContractVersion } from "@/lib/config";
import { buildPricingSnapshot, PricingContractError } from "@/lib/versioned-pricing";
import { readCheckoutJson, CheckoutInputError } from "@/lib/checkout-input";

const log = createLogger({ module: "delivery-quote" });

const itemIdsSchema = z.array(z.string().min(1).max(128)).min(1).max(50)
  .refine((ids) => new Set(ids).size === ids.length, "Duplicate selected cart item IDs");
const quoteRequestSchema = z.union([
  z.strictObject({ itemIds: itemIdsSchema, addressId: z.string().min(1).max(128) }),
  z.strictObject({ itemIds: itemIdsSchema, newAddress: clientAddressInputSchema }),
]);

export async function POST(request: NextRequest) {
  const requestLog = log.child({ action: "delivery-quote" });
  try {
    const access = await requireOnboardedApiSession();
    if (!access.ok) {
      requestLog.info("delivery quote denied", { outcome: "denied" });
      return access.response;
    }
    const clientId = access.session.user.id;

    const pricingContractVersion = await getDiscountsContractVersion();
    const parsed = quoteRequestSchema.safeParse(await readCheckoutJson(request));
    if (!parsed.success) {
      requestLog.warn("delivery quote invalid payload", { outcome: "denied" });
      return NextResponse.json(
        { success: false, error: "Invalid request body" },
        { status: 400 }
      );
    }
    const { itemIds } = parsed.data;

    const owned = await loadOwnedQuoteCartItems(clientId, itemIds);
    const ppnRatePercent = await loadDeliveryPpnRatePercent();
    // Source bounds must precede even address-region provider reads.
    if (pricingContractVersion === 1) buildPricingSnapshot({
      fulfillmentMethod: "delivery", ppnRatePercent,
      lines: owned.items.map((item) => ({ variantId: item.variantId ?? "", quantity: item.quantity,
        sourceUnitPrice: item.value, effectiveUnitPrice: item.effectiveValue ?? item.value,
        markdownRevisionId: item.markdownRevisionId ?? null })),
    });
    const branch = await loadQuoteOriginBranch(owned.branchId);
    const destination = "addressId" in parsed.data
      ? await loadRevalidatedDestination(clientId, parsed.data.addressId)
      : await loadRevalidatedNewDestination(parsed.data.newAddress);
    const parcelConfig = await loadShipmentParcelConfig();

    const quote = await quoteDelivery(
      {
        pricingContractVersion,
        branch,
        items: owned.items,
        destination,
        fallback: parcelConfig.fallback,
        packagingWeight: parcelConfig.packagingWeightGrams,
        ppnRatePercent,
      },
      createJubelioShipmentGateway()
    );

    requestLog.info("delivery quote succeeded", {
      itemCount: owned.items.length,
      branchId: branch.id,
      destinationAreaId: destination.areaId,
      serviceCount: quote.services.length,
      serviceCategoryCount: new Set(quote.services
        .map((service) => service.serviceCategoryId)
        .filter((categoryId) => categoryId !== null)).size,
      uncategorizedServiceCount: quote.services.filter((service) => service.serviceCategoryId === null).length,
    });
    return NextResponse.json({
      success: true,
      data: { services: quote.services },
    });
  } catch (error) {
    if (error instanceof CheckoutInputError || error instanceof PricingContractError) {
      const status = error instanceof CheckoutInputError ? error.status : 400;
      requestLog.warn("delivery quote input rejected", { status });
      return NextResponse.json({ success: false, error: "Data checkout tidak valid." }, { status });
    }
    if (error instanceof DeliveryQuoteDataError) {
      requestLog.error("delivery quote data failed", {
        code: error.code,
        error: serializeError(error),
      });
      return NextResponse.json(
        { success: false, error: error.message },
        {
          status:
            error.code === "NOT_FOUND"
              ? 404
              : error.code === "UNAVAILABLE"
                ? 502
                : 400,
        }
      );
    }
    if (error instanceof QuoteDeliveryError) {
      requestLog.error("delivery quote failed", { code: error.code });
      return NextResponse.json(
        { success: false, error: error.message },
        // No quote must never become a zero price — the UI offers Coba lagi
        // on either a failed provider interaction or an empty service list.
        { status: error.code === "INVALID_INPUT" ? 400 : 502 }
      );
    }
    requestLog.error("delivery quote unexpected failure", {
      outcome: "error",
      error: serializeError(error),
    });
    return NextResponse.json(
      { success: false, error: "Quote gagal diproses. Coba lagi." },
      { status: 500 }
    );
  }
}