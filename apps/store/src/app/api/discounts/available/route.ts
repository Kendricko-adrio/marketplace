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
import { readAvailablePromoPage } from "@/features/discounts/available-promos-service";
import { z } from "zod";
import { requireOnboardedApiSession } from "@/lib/route-access";
import { admitCheckoutRequest, CheckoutAdmissionError } from "@/lib/checkout-admission";
import { CheckoutInputError, readCheckoutJson } from "@/lib/checkout-input";
import { getDiscountsContractVersion } from "@/lib/config";
import {
  DiscountAvailabilityError,
  readAvailableOffers,
} from "@/lib/discount-availability";
import {
  createModuleLogger,
  getRequestId,
  withRequestContext,
} from "@/lib/logger";

/**
 * Module logger untuk route ini: dibuat sekali di module scope, sedangkan
 * `requestId` dibaca dari scope HTTP yang aktif setiap kali log ditulis
 * (`withRequestContext` di export handler membuka scope tersebut).
 */
const log = createModuleLogger("discounts-available");

/**
 * Proyeksi teknis statis untuk field `error`: pesan asli dari DB/Next/provider
 * tidak pernah masuk log, hanya pesan yang ditulis module ini. Kontrak HTTP
 * gagal (status/body) tidak berubah.
 */
class RouteLogError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RouteLogError";
  }
}

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
  page: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
  selectedOfferId: z.string().min(1).max(128).optional(),
}).refine((value) => !(value.page !== undefined && value.cursor !== undefined))
  .refine((value) => !value.selectedOfferId || value.page !== undefined);

/**
 * Amplop kegagalan route ini. `requestId` di body tetap ada dengan bentuk yang
 * sama, kini berasal dari scope HTTP kanonik (`getRequestId()`), bukan logger
 * legacy; header `x-request-id` ditambahkan wrapper.
 */
function failure(status: number, code: string, error: string): NextResponse {
  return NextResponse.json(
    { success: false, code, error, requestId: getRequestId() },
    { status, headers: { "Cache-Control": "no-store" } }
  );
}

/** HTTP adapter: auth, gate versi, admission, baca body, map ke status/body. */
async function readDiscountAvailability(request: NextRequest): Promise<Response> {
  try {
    const access = await requireOnboardedApiSession();
    if (!access.ok) return access.response;
    const { session } = access;

    let contractVersion: 0 | 1 | null = null;
    try {
      contractVersion = await getDiscountsContractVersion();
    } catch {
      log.error(
        "discount availability gate unavailable (outcome error)",
        new RouteLogError("discount availability gate unavailable")
      );
      return failure(
        503,
        "PRICING_UNAVAILABLE",
        "Daftar promo belum dapat dibaca. Silakan coba beberapa saat lagi."
      );
    }
    if (contractVersion !== 1) {
      log.warn("discount availability rejected — versioned gate is off (outcome unsupported_version)");
      return failure(400, "UNSUPPORTED_VERSION", "Fitur promo belum aktif.");
    }

    await admitCheckoutRequest({
      clientId: session.user.id,
      kind: "preview",
      headers: request.headers,
    });
    const body = await readCheckoutJson(request);
    const parsed = availableRequestSchema.safeParse(body);
    if (!parsed.success) {
      log.warn(
        `discount availability body rejected (outcome invalid_input, ${parsed.error.issues.length} issue)`
      );
      return failure(400, "INPUT_INVALID", "Data permintaan tidak valid.");
    }

    const input = {
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
    };
    const data = parsed.data.page !== undefined
      ? await readAvailablePromoPage({ ...input, page: parsed.data.page, selectedOfferId: parsed.data.selectedOfferId })
      : await readAvailableOffers(input);

    log.info(
      `discount availability read (outcome ok, offers ${data.items.length}, eligible ${
        data.items.filter((item) => item.eligible).length
      }, hasNextPage ${"totalPages" in data ? data.page < data.totalPages : data.nextCursor != null})`
    );
    return NextResponse.json(
      { success: true, data },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    if (error instanceof CheckoutAdmissionError) {
      if (error.status === 503) {
        log.error(
          `discount availability admission unavailable (code ${error.code})`,
          new RouteLogError("discount availability admission unavailable")
        );
      } else {
        log.warn(`discount availability admission denied (code ${error.code})`);
      }
      return NextResponse.json(
        {
          success: false,
          code: error.code,
          error: error.message,
          requestId: getRequestId(),
        },
        {
          status: error.status,
          headers: {
            "Cache-Control": "no-store",
            ...(error.retryAfter ? { "Retry-After": String(error.retryAfter) } : {}),
          },
        }
      );
    }
    if (error instanceof CheckoutInputError) {
      const limitExceeded = error.status === 413;
      log.warn(
        `discount availability body rejected (outcome ${
          limitExceeded ? "limit_exceeded" : "invalid_input"
        }, underlying status ${error.status})`
      );
      return limitExceeded
        ? failure(413, "INPUT_LIMIT_EXCEEDED", "Data permintaan melebihi batas ukuran.")
        : failure(400, "INPUT_INVALID", "Data permintaan tidak valid.");
    }
    if (error instanceof DiscountAvailabilityError) {
      const notFound = error.code === "NOT_FOUND";
      log.warn(`discount availability context rejected (code ${error.code})`);
      return failure(
        notFound ? 404 : 400,
        error.code,
        error.message
      );
    }
    log.error(
      "discount availability failed (outcome error)",
      new RouteLogError("discount availability failed")
    );
    return failure(
      503,
      "PRICING_UNAVAILABLE",
      "Daftar promo gagal dibaca. Silakan coba beberapa saat lagi."
    );
  }
}

/** HTTP entry: wrapper menambahkan `x-request-id` kanonik + satu baris completion. */
export const POST = withRequestContext(
  readDiscountAvailability,
  "discounts-available"
);
