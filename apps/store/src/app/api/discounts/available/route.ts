/**
 * POST /api/discounts/available — daftar Coupon publik untuk checkout pickup
 * (ticket 07, spec §5.1/§5.2).
 *
 * READ ONLY: tidak membuat order/Redemption/usage/stock hold dan tidak
 * memanggil provider. Body tidak pernah menentukan identity, harga, budget
 * atau kapasitas: hanya selected cart IDs (dan method pickup eksplisit) yang
 * diambil dari sesi + cart milik client.
 */
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireOnboardedApiSession } from "@/lib/route-access";
import { admitCheckoutRequest, CheckoutAdmissionError } from "@/lib/checkout-admission";
import { CheckoutInputError, readCheckoutJson } from "@/lib/checkout-input";
import { getDiscountsContractVersion } from "@/lib/config";
import {
  DiscountAvailabilityError,
  readAvailableOffers,
} from "@/lib/discount-availability";
import { requestLogger, serializeError, withRequestId, type Logger } from "@/lib/logger";

const selectedIdsSchema = z
  .array(z.string().min(1).max(128))
  .min(1, "Pilih minimal satu barang")
  .max(50)
  .refine(
    (ids) => new Set(ids).size === ids.length,
    "ID barang keranjang duplikat"
  );

const availableRequestSchema = z.strictObject({
  selectedItemIds: selectedIdsSchema,
  // Satu picker untuk pickup dan delivery (ticket 11). Pada delivery, ongkir
  // layanan terpilih hanya dipakai untuk MENAMPILKAN eligibility subsidi;
  // preview/place-order menghitung ulang dari quote baru.
  fulfillmentMethod: z.enum(["pickup", "delivery"]).optional(),
  shippingBeforeSubsidy: z
    .union([z.string().max(32), z.number().int().nonnegative()])
    .optional(),
  cursor: z.string().min(1).max(128).optional(),
});

function failure(
  log: Logger,
  status: number,
  code: string,
  error: string
): NextResponse {
  return withRequestId(
    NextResponse.json(
      { success: false, code, error, requestId: log.requestId },
      { status, headers: { "Cache-Control": "no-store" } }
    ),
    log
  );
}

export async function POST(request: NextRequest) {
  let log = requestLogger(request, { module: "discounts-available" });
  try {
    const access = await requireOnboardedApiSession();
    if (!access.ok) return withRequestId(access.response, log);
    const { session } = access;
    log = log.child({ userId: session.user.id });

    let contractVersion: 0 | 1 | null = null;
    try {
      contractVersion = await getDiscountsContractVersion();
    } catch (gateError) {
      log.error("discount availability gate unavailable", {
        outcome: "error",
        error: serializeError(gateError),
      });
      return failure(
        log,
        503,
        "PRICING_UNAVAILABLE",
        "Daftar promo belum dapat dibaca. Silakan coba beberapa saat lagi."
      );
    }
    if (contractVersion !== 1) {
      log.warn("discount availability rejected — versioned gate is off", {
        outcome: "unsupported_version",
      });
      return failure(log, 400, "UNSUPPORTED_VERSION", "Fitur promo belum aktif.");
    }

    await admitCheckoutRequest({
      clientId: session.user.id,
      kind: "preview",
      headers: request.headers,
    });
    const body = await readCheckoutJson(request);
    const parsed = availableRequestSchema.safeParse(body);
    if (!parsed.success) {
      log.warn("discount availability body rejected", {
        outcome: "invalid_input",
        issueCount: parsed.error.issues.length,
      });
      return failure(log, 400, "INPUT_INVALID", "Data permintaan tidak valid.");
    }

    const data = await readAvailableOffers({
      clientId: session.user.id,
      selectedItemIds: parsed.data.selectedItemIds,
      cursor: parsed.data.cursor ?? null,
      fulfillment: {
        fulfillmentMethod: parsed.data.fulfillmentMethod ?? "pickup",
        ...(parsed.data.fulfillmentMethod === "delivery" &&
        parsed.data.shippingBeforeSubsidy !== undefined
          ? { shippingBeforeSubsidy: String(parsed.data.shippingBeforeSubsidy) }
          : {}),
      },
    });

    log.info("discount availability read", {
      outcome: "ok",
      offerCount: data.items.length,
      eligibleCount: data.items.filter((item) => item.eligible).length,
      hasNextPage: data.nextCursor != null,
    });
    return withRequestId(
      NextResponse.json(
        { success: true, data },
        { headers: { "Cache-Control": "no-store" } }
      ),
      log
    );
  } catch (error) {
    if (error instanceof CheckoutAdmissionError) {
      if (error.status === 503) log.error("discount availability admission unavailable", { code: error.code });
      else log.warn("discount availability admission denied", { code: error.code });
      return withRequestId(
        NextResponse.json(
          {
            success: false,
            code: error.code,
            error: error.message,
            requestId: log.requestId,
          },
          {
            status: error.status,
            headers: {
              "Cache-Control": "no-store",
              ...(error.retryAfter ? { "Retry-After": String(error.retryAfter) } : {}),
            },
          }
        ),
        log
      );
    }
    if (error instanceof CheckoutInputError) {
      const limitExceeded = error.status === 413;
      log.warn("discount availability body rejected", {
        outcome: limitExceeded ? "limit_exceeded" : "invalid_input",
        underlyingStatus: error.status,
      });
      return limitExceeded
        ? failure(log, 413, "INPUT_LIMIT_EXCEEDED", "Data permintaan melebihi batas ukuran.")
        : failure(log, 400, "INPUT_INVALID", "Data permintaan tidak valid.");
    }
    if (error instanceof DiscountAvailabilityError) {
      const notFound = error.code === "NOT_FOUND";
      log.warn("discount availability context rejected", { code: error.code });
      return failure(
        log,
        notFound ? 404 : 400,
        error.code,
        error.message
      );
    }
    log.error("discount availability failed", {
      outcome: "error",
      error: serializeError(error),
    });
    return failure(
      log,
      503,
      "PRICING_UNAVAILABLE",
      "Daftar promo gagal dibaca. Silakan coba beberapa saat lagi."
    );
  }
}
