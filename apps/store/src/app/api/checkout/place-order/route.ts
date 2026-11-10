import { NextRequest, NextResponse } from "next/server";
import { placeCheckoutOrder, type PlaceCheckoutOutcome } from "@/features/checkout/place-checkout-service";
import { placeOrderLegacy } from "@/features/checkout/place-order-legacy-service";
import { type PlaceDeliveryResult } from "@/features/checkout/place-order-delivery";
import { classifyPlaceOrderError, RouteLogError } from "@/features/checkout/place-order-errors";
import { requireOnboardedApiSession } from "@/lib/route-access";
import { parsePlaceOrderBody, REPRICE_REQUIRED_MESSAGE } from "@/features/checkout/place-order-input";
import { readCheckoutJson } from "@/lib/checkout-input";
import { admitCheckoutRequest } from "@/lib/checkout-admission";
import { createPayment, getMockPaymentResult } from "@/lib/midtrans";
import { createModuleLogger, getRequestId, withRequestContext } from "@/lib/logger";
import { findAcceptedCheckout, checkoutResultResponse, type CheckoutRecovery } from "@/lib/checkout-request";
import { placeCheckout } from "@/features/checkout/place-order-service";
import { createCheckoutPayment } from "@/lib/midtrans";

/**
 * Module logger untuk route ini: dibuat sekali di module scope, sedangkan
 * `requestId` dibaca dari scope HTTP yang aktif setiap kali log ditulis
 * (`withRequestContext` di export handler membuka scope tersebut).
 */
const log = createModuleLogger("checkout-place-order");

/** HTTP mapping for the version-2 attempt contract (no order means no redirect). */
function checkoutAttemptResponse(result: Awaited<ReturnType<typeof placeCheckout>>): Response {
  const { replayed, ...data } = result;
  if (result.state === "promoted") {
    log.info(`checkout attempt promoted: order ${data.orderId}, attempt ${data.attemptId}, replay ${replayed}`);
    return NextResponse.json({ success: true, data, orderId: data.orderId, redirectUrl: data.redirectUrl },
      { status: replayed ? 200 : 201, headers: { "Cache-Control": "no-store" } });
  }
  if (result.state === "rejected") {
    log.warn(`checkout rejected before order creation (attempt ${data.attemptId}, ${data.failureCode})`);
    return NextResponse.json({ success: false, code: data.failureCode, error: data.message, data,
      orderId: null, requestId: getRequestId() },
      { status: data.failureCode === "SALES_ORDER_REJECTED" ? 409 : 502, headers: { "Cache-Control": "no-store" } });
  }
  return NextResponse.json({ success: false,
    code: data.state === "manual_review" ? "CHECKOUT_MANUAL_REVIEW" : "CHECKOUT_PROCESSING",
    error: data.message, data, orderId: null, requestId: getRequestId() },
    { status: 202, headers: { "Cache-Control": "no-store" } });
}

async function postPlaceOrder(request: NextRequest): Promise<Response> {
  const recovery: CheckoutRecovery = {};
  try {
    const response = await placeOrder(request, recovery);
    if (response.status >= 400 && recovery.identity) {
      // Dua live-read concurrent dapat mengganti observation stamp sebelum
      // salah satu commit. Guard stock tetap ketat; tunggu sebentar hanya
      // hasil key yang sama, tanpa mengulang placement atau provider request.
      const waits = response.status === 503 ? [0, 25, 75, 150, 250] : [0];
      for (const wait of waits) {
        if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
        const accepted = await findAcceptedCheckout(recovery.identity);
        if (accepted) return checkoutResultResponse(accepted, !recovery.committed);
      }
    }
    return response;
  } catch (error) {
    const decision = classifyPlaceOrderError("recovery", error);
    if (decision.kind === "request-conflict") {
      const error = decision.error;
      log.warn(`checkout request key conflict (code ${error.code})`);
      return NextResponse.json({ success: false, code: error.code, error: error.message, requestId: getRequestId() }, { status: 409, headers: { "Cache-Control": "no-store" } });
    }
    log.error(
      `checkout result recovery unavailable (committed ${!!recovery.committed})`,
      new RouteLogError("checkout result recovery unavailable")
    );
    return NextResponse.json({ success: false, code: "POLICY_UNAVAILABLE", error: "Status checkout belum dapat dibaca. Coba lagi dengan request yang sama.", requestId: getRequestId() }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}

async function placeOrder(request: NextRequest, recovery: CheckoutRecovery) {
  log.info("place order requested");
  const createLegacyPayment: typeof createPayment = (...args) => {
    const mockRequested = process.env.NODE_ENV !== "production" &&
      request.headers.get("x-e2e-payment-mock") === "true";
    const mock = mockRequested
      ? getMockPaymentResult(args[0], { MIDTRANS_E2E_MOCK: "true", NODE_ENV: "test" })
      : null;
    return mock ? Promise.resolve(mock) : createPayment(...args);
  };
  // E2E-only payment seam shared by the creator and replay paths.
  const initializeCheckoutPayment = (paymentInput: Parameters<typeof createCheckoutPayment>[0]) => {
    const mockRequested = process.env.NODE_ENV !== "production" &&
      request.headers.get("x-e2e-payment-mock") === "true";
    const mock = mockRequested
      ? getMockPaymentResult(paymentInput.orderId, { MIDTRANS_E2E_MOCK: "true", NODE_ENV: "test" })
      : null;
    return mock ? Promise.resolve({ kind: "ready" as const, ...mock }) : createCheckoutPayment(paymentInput);
  };
  try {
    const access = await requireOnboardedApiSession();
    if (!access.ok) return access.response;
    const { session } = access;

    const body = await readCheckoutJson(request);
    const requestedMethod = (body as { fulfillmentMethod?: unknown } | null)?.fulfillmentMethod;

    // ===== Method-aware body handling: pickup stays the legacy shape; a
    // delivery submission carries ONLY the approval (never money/slots). =====
    const isDelivery = requestedMethod === "delivery";
    const parsed = parsePlaceOrderBody(body, requestedMethod);

    if (!parsed.success) {
      log.warn(`invalid request body (${parsed.error.issues.length} issue)`);
      return NextResponse.json(
        {
          success: false,
          error: "Invalid request body",
          details: parsed.error.issues,
        },
        { status: 400 }
      );
    }

    const outcome = await placeCheckoutOrder({ actor: session.user, input: parsed.data, isDelivery, recovery,
      initializeCheckoutPayment, createLegacyPayment,
      admit: (carriesManualCode) => admitCheckoutRequest({ clientId: session.user.id, kind: "place", headers: request.headers, carriesManualCode }),
    });
    return mapPlaceCheckoutOutcome(outcome);
  } catch (error) {
    return mapPlaceOrderError(error);
  }
}

function mapPlaceCheckoutOutcome(outcome: PlaceCheckoutOutcome): Response {
  if (outcome.kind === "attempt") return checkoutAttemptResponse(outcome.result);
  if (outcome.kind === "delivery-failure") return mapDeliveryQuoteFailure(outcome.result);
  if (outcome.kind === "rejected") {
    switch (outcome.reason) {
      case "paused": return NextResponse.json(outcome.data, { status: 503 });
      case "unsupported-version": return NextResponse.json(outcome.data, { status: 400 });
      case "cart-empty": return NextResponse.json(outcome.data, { status: 400 });
      case "items-not-owned": return NextResponse.json(outcome.data, { status: 404 });
      case "no-items": return NextResponse.json(outcome.data, { status: 400 });
      case "no-branch": return NextResponse.json(outcome.data, { status: 400 });
      case "multiple-branches": return NextResponse.json(outcome.data, { status: 400 });
      case "branch-unavailable": return NextResponse.json(outcome.data, { status: 400 });
      case "branch-unlinked": return NextResponse.json(outcome.data, { status: 409 });
      case "product-unlinked": return NextResponse.json(outcome.data, { status: 409 });
      case "pickup-slot": return NextResponse.json(outcome.data, { status: 400 });
      case "tax-unavailable": return NextResponse.json({ ...outcome.data, requestId: getRequestId() }, { status: 503, headers: { "Cache-Control": "no-store" } });
      case "account-missing": return NextResponse.json({ ...outcome.data, requestId: getRequestId() }, { status: 404, headers: { "Cache-Control": "no-store" } });
      case "promo-ineligible": return NextResponse.json({ ...outcome.data, requestId: getRequestId() }, { status: outcome.eligibility.status, headers: { "Cache-Control": "no-store" } });
      case "stock-adjusted": return NextResponse.json(outcome.data, { status: 409 });
      case "stock-unavailable": return NextResponse.json(outcome.data, { status: 503 });
      case "attempt-reservation": return NextResponse.json({ ...outcome.data, requestId: getRequestId() }, { status: 409, headers: { "Cache-Control": "no-store" } });
      case "attempt-unavailable": return NextResponse.json({ ...outcome.data, requestId: getRequestId() }, { status: 503, headers: { "Cache-Control": "no-store" } });
    }
  }
  return mapLegacyOutcome(outcome);
}

function mapLegacyOutcome(result: Awaited<ReturnType<typeof placeOrderLegacy>>): Response {
  if (result.kind === "accepted") return checkoutResultResponse(result.result, result.replay);
  if (result.kind === "legacy-failure") return mapLegacyPlaceOrderError(result.error, result.hasIdentity);
  if (result.kind === "legacy-sales-rejected") return NextResponse.json({ success: false, error: "Stock produk berubah atau tidak mencukupi. Silakan periksa keranjang Anda." }, { status: 409 });
  if (result.kind === "legacy-sales-pending") return NextResponse.json({ success: false, error: result.message }, { status: 503 });
  return NextResponse.json({ success: true, orderId: result.orderId, redirectUrl: result.redirectUrl, token: result.token });
}

function mapDeliveryQuoteFailure(result: Extract<PlaceDeliveryResult, { ok: false }>): Response {
  const failure = result.failure;
  if (failure.kind === "account-missing") {
    return NextResponse.json({ success: false, code: "NOT_FOUND", error: "Akun tidak ditemukan.", requestId: getRequestId() }, { status: 404, headers: { "Cache-Control": "no-store" } });
  }
  if (failure.kind === "promo") {
    return NextResponse.json({ success: false, code: failure.evaluation.mapped.code, error: failure.evaluation.message, requestId: getRequestId() },
      { status: failure.evaluation.mapped.status, headers: { "Cache-Control": "no-store" } });
  }
  if (failure.kind === "data") {
    const status = failure.error.code === "NOT_FOUND" ? 404 : failure.error.code === "UNAVAILABLE" ? 502 : 400;
    return NextResponse.json({ success: false, error: failure.error.message }, { status });
  }
  return NextResponse.json({ success: false, error: REPRICE_REQUIRED_MESSAGE, code: "DELIVERY_REPRICE_REQUIRED", data: { services: failure.services } }, { status: 409 });
}

function mapLegacyPlaceOrderError(checkoutError: unknown, hasIdentity: boolean): Response {
  const decision = classifyPlaceOrderError("legacy", checkoutError);
  if (decision.kind === "promo-reservation") {
    const checkoutError = decision.error;
    log.warn(
      `checkout promo rejected at commit (code ${checkoutError.code}, reason ${checkoutError.reason})`
    );
    return NextResponse.json(
      {
        success: false,
        code: checkoutError.code,
        error: checkoutError.safeMessage,
        requestId: getRequestId(),
      },
      { status: checkoutError.status, headers: { "Cache-Control": "no-store" } }
    );
  }
  if (decision.kind === "pricing-review") {
    const checkoutError = decision.error;
    log.warn(`checkout source changed before commit (code ${checkoutError.code})`);
    return NextResponse.json({ success: false, code: "CHECKOUT_REVIEW_REQUIRED", error: checkoutError.message }, { status: 409 });
  }
  // Insufficient stock → 400 (customer can retry / pick fewer units).
  if (decision.kind === "stock") {
    const checkoutError = decision.error;
    log.warn(
      `insufficient stock — checkout transaction rolled back (product ${checkoutError.productName}, missingSnapshot ${checkoutError.missingSnapshot})`
    );
    return NextResponse.json(
      {
        success: false,
        error: checkoutError.missingSnapshot
          ? "Stok berubah saat checkout. Silakan coba lagi."
          : checkoutError.message,
      },
      { status: checkoutError.missingSnapshot ? 503 : 400 }
    );
  }
  if (hasIdentity) {
    log.error("checkout transaction unavailable (code POLICY_UNAVAILABLE)");
    return NextResponse.json({ success: false, code: "POLICY_UNAVAILABLE",
      error: "Checkout belum dapat diselesaikan. Coba kembali dengan request yang sama.", requestId: getRequestId() },
      { status: 503, headers: { "Cache-Control": "no-store" } });
  }
  const err = checkoutError as {
    message?: string;
    httpStatusCode?: number;
    ApiResponse?: unknown;
  };
  log.error(
    `Midtrans payment creation failed (http status ${err.httpStatusCode ?? "-"})`,
    new RouteLogError("midtrans payment creation failed")
  );
  // The compensation path marks the order failed and cancels the SO;
  // checked-out cart rows are preserved so the customer can retry.
  return NextResponse.json(
    {
      success: false,
      error:
        err.message ||
        "Failed to initiate payment. Your cart is preserved — please try again.",
    },
    { status: 502 }
  );
}

function mapPlaceOrderError(error: unknown): Response {
  const decision = classifyPlaceOrderError("workflow", error);
  if (decision.kind === "rethrow") throw decision.error;
  if (decision.kind === "admission") {
    const error = decision.error;
    if (error.status === 503) log.error(`checkout admission unavailable (code ${error.code})`);
    else log.warn(`checkout admission denied (code ${error.code})`);
    return NextResponse.json({ success: false, code: error.code, error: error.message, requestId: getRequestId() },
      { status: error.status, headers: { "Cache-Control": "no-store", ...(error.retryAfter ? { "Retry-After": String(error.retryAfter) } : {}) } });
  }
  if (decision.kind === "review-required") {
    const error = decision.error;
    log.warn(
      `checkout review rejected (code ${error.code}, requiresAcknowledgement ${error.requiresAcknowledgement ?? "-"})`
    );
    return NextResponse.json(
      {
        success: false,
        code: error.code,
        error: error.message,
        requestId: getRequestId(),
        ...(error.requiresAcknowledgement
          ? { data: { requiresAcknowledgement: error.requiresAcknowledgement } }
          : {}),
      },
      { status: 409, headers: { "Cache-Control": "no-store" } });
  }
  if (decision.kind === "review-unavailable") {
    log.error("checkout review unavailable (code PRICING_UNAVAILABLE)");
    return NextResponse.json({ success: false, code: "PRICING_UNAVAILABLE", error: "Review checkout belum tersedia.", requestId: getRequestId() }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
  if (decision.kind === "promo-reservation") {
    const error = decision.error;
    log.warn(`checkout promo rejected (code ${error.code}, reason ${error.reason})`);
    return NextResponse.json(
      { success: false, code: error.code, error: error.safeMessage, requestId: getRequestId() },
      { status: error.status, headers: { "Cache-Control": "no-store" } }
    );
  }
  if (decision.kind === "redemption-review") {
    const error = decision.error;
    log.warn("checkout promo review changed (code CHECKOUT_REVIEW_REQUIRED)");
    return NextResponse.json(
      { success: false, code: "CHECKOUT_REVIEW_REQUIRED", error: error.message, requestId: getRequestId() },
      { status: 409, headers: { "Cache-Control": "no-store" } }
    );
  }
  if (decision.kind === "input") {
    const error = decision.error;
    log.warn(`checkout body rejected (status ${error.status})`);
    return NextResponse.json({ success: false, error: error.message }, { status: error.status });
  }
  if (decision.kind === "pricing-input") {
    const error = decision.error;
    log.warn(`checkout pricing input rejected (code ${error.code})`);
    return NextResponse.json({ success: false, error: "Data harga atau keranjang tidak valid.", code: error.code }, { status: 400 });
  }
  log.error(
    `place order failed (${error instanceof Error ? error.name : "UnknownError"})`,
    new RouteLogError("place order failed")
  );
  return NextResponse.json(
    { success: false, error: "Failed to place order" },
    { status: 500 }
  );
}

/** HTTP entry: wrapper menambahkan `x-request-id` kanonik + satu baris completion. */
export const POST = withRequestContext(postPlaceOrder, "checkout-place-order");