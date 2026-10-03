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

const log = createLogger({ module: "delivery-quote" });

const quoteRequestSchema = z.union([
  z.strictObject({ itemIds: z.array(z.string()).min(1), addressId: z.string().min(1) }),
  z.strictObject({ itemIds: z.array(z.string()).min(1), newAddress: clientAddressInputSchema }),
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

    const parsed = quoteRequestSchema.safeParse(await request.json());
    if (!parsed.success) {
      requestLog.warn("delivery quote invalid payload", { outcome: "denied" });
      return NextResponse.json(
        { success: false, error: "Invalid request body" },
        { status: 400 }
      );
    }
    const { itemIds } = parsed.data;

    const owned = await loadOwnedQuoteCartItems(clientId, itemIds);
    const branch = await loadQuoteOriginBranch(owned.branchId);
    const destination = "addressId" in parsed.data
      ? await loadRevalidatedDestination(clientId, parsed.data.addressId)
      : await loadRevalidatedNewDestination(parsed.data.newAddress);
    const parcelConfig = await loadShipmentParcelConfig();
    const ppnRatePercent = await loadDeliveryPpnRatePercent();

    const quote = await quoteDelivery(
      {
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
    });
    return NextResponse.json({
      success: true,
      data: { services: quote.services },
    });
  } catch (error) {
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