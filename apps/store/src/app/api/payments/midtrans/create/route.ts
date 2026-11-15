import { NextRequest, NextResponse } from "next/server";
import { requireOnboardedApiSession } from "@/lib/route-access";
import { createCheckoutPayment, getMockPaymentResult } from "@/lib/midtrans";
import { createModuleLogger, withRequestContext } from "@/lib/logger";
import { initializeOrderPayment } from "@/features/payments/initialize-order-payment-service";
import {
  loadRepaymentOrderContext,
  loadSnapSessionRequest,
  readOwnedOrderPaymentRecovery,
} from "@/features/payments/order-payment-repository";

/**
 * Module logger untuk route ini: dibuat sekali di module scope, sedangkan
 * `requestId` dibaca dari scope HTTP yang aktif setiap kali log ditulis
 * (`withRequestContext` di export handler membuka scope tersebut).
 */
const log = createModuleLogger("payments-midtrans-create");

/**
 * Proyeksi teknis statis untuk field `error`: pesan asli dari Midtrans/DB
 * tidak pernah masuk log, hanya pesan yang ditulis module ini.
 */
class RouteLogError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RouteLogError";
  }
}

/**
 * Repayment adapter (spec TX-02 §13.1): parse/auth/ownership guard + map.
 * Every session is created by the SHARED durable initialize use case, so this
 * route and the legacy place-order path can never create two Snap sessions for
 * one order. No SQL lives here.
 */
async function createRepayment(request: NextRequest): Promise<Response> {
  log.info("repayment requested");
  try {
    const access = await requireOnboardedApiSession();
    if (!access.ok) return access.response;
    const { session } = access;

    const body = (await request.json()) as { orderId?: unknown };
    const orderId = typeof body?.orderId === "string" ? body.orderId : "";
    if (!orderId) {
      log.warn("repayment rejected — orderId missing");
      return NextResponse.json({ success: false, error: "orderId is required" }, { status: 400 });
    }

    const context = await loadRepaymentOrderContext({ orderId, clientId: session.user.id });
    if (!context) {
      log.warn(`repayment rejected — order ${orderId} not owned or missing`);
      return NextResponse.json({ success: false, error: "Order not found" }, { status: 404 });
    }

    // E2E-only seam: the mock redirect only exists outside production.
    const initializeCheckoutPayment = (paymentInput: Parameters<typeof createCheckoutPayment>[0]) => {
      const mockRequested =
        process.env.NODE_ENV !== "production" &&
        request.headers.get("x-e2e-payment-mock") === "true";
      const mock = mockRequested
        ? getMockPaymentResult(paymentInput.orderId, { MIDTRANS_E2E_MOCK: "true", NODE_ENV: "test" })
        : null;
      return mock ? Promise.resolve({ kind: "ready" as const, ...mock }) : createCheckoutPayment(paymentInput);
    };

    const result = await initializeOrderPayment(
      { orderId, clientId: session.user.id, source: "repayment" },
      {
        createSession: async (claim) => {
          const persisted = await loadSnapSessionRequest(orderId);
          if (!persisted) return { kind: "unknown", code: "order_unavailable" };
          const outcome = await initializeCheckoutPayment({
            orderId: claim.providerReference,
            grossAmount: Math.round(Number(claim.expectedAmount)),
            customerDetails: persisted.customer,
            itemDetails: persisted.items,
            expiryMinutes: Math.max(
              1,
              Math.round((claim.expiresAt.getTime() - claim.paymentStartedAt.getTime()) / 60_000)
            ),
            paymentStartedAt: claim.paymentStartedAt,
          });
          if (outcome.kind === "ready") {
            return { kind: "ready", token: outcome.token, redirectUrl: outcome.redirectUrl };
          }
          if (outcome.kind === "definitive_rejection") {
            return { kind: "definitive_rejection", code: "provider_rejected" };
          }
          return { kind: "unknown", code: "initialization_unknown" };
        },
      }
    );

    const recovery = await readOwnedOrderPaymentRecovery({
      orderId,
      clientId: session.user.id,
      now: new Date(),
    });

    if (result.kind === "ready") {
      log.info(
        `repayment session ready (order ${orderId}, replay ${result.replayed}, redirect ${
          result.redirectUrl ? "ada" : "kosong"
        })`
      );
      return NextResponse.json({
        success: true,
        redirectUrl: result.redirectUrl,
        token: result.token,
        orderId,
      });
    }
    // Claim loser / unknown: the session may already exist. Promise nothing new.
    if (result.kind === "processing") {
      log.warn(`repayment deferred (order ${orderId}, reason ${result.reason})`);
      return NextResponse.json(
        {
          success: false,
          code: "PAYMENT_INITIALIZATION_UNKNOWN",
          error:
            "Status pembayaran belum dapat dipastikan. Periksa status pembayaran dan jangan membuat pembayaran baru.",
          orderId,
          paymentRecovery: recovery,
        },
        { status: 202, headers: { "Cache-Control": "no-store" } }
      );
    }
    if (result.kind === "manual_review") {
      log.warn(`repayment manual review (order ${orderId}, reason ${result.reason})`);
      return NextResponse.json(
        {
          success: false,
          code: "PAYMENT_MANUAL_REVIEW",
          error: "Status pembayaran sedang diperiksa. Jangan membuat pembayaran baru.",
          orderId,
          paymentRecovery: recovery,
        },
        { status: 202, headers: { "Cache-Control": "no-store" } }
      );
    }
    if (result.kind === "rejected") {
      log.warn(`repayment definitively rejected (order ${orderId})`);
      return NextResponse.json(
        {
          success: false,
          code: "PAYMENT_INITIALIZATION_REJECTED",
          error: "Pembayaran belum dapat disiapkan. Pesanan belum dibuat. Periksa ulang pesanan lalu coba lagi.",
          orderId,
          retryAllowed: true,
        },
        { status: 409, headers: { "Cache-Control": "no-store" } }
      );
    }
    if (result.kind === "paid") {
      log.info(`repayment refused — order ${orderId} is already paid`);
      return NextResponse.json(
        { success: false, code: "PAYMENT_ALREADY_RECEIVED", error: "Pembayaran sudah diterima.", orderId },
        { status: 409, headers: { "Cache-Control": "no-store" } }
      );
    }
    if (result.kind === "expired") {
      log.warn(`repayment refused — order ${orderId} expired`);
      return NextResponse.json(
        { success: false, code: "ORDER_EXPIRED", error: "Order has expired. Please create a new order." },
        { status: 400, headers: { "Cache-Control": "no-store" } }
      );
    }
    if (result.kind === "not_eligible") {
      log.warn(
        `repayment refused — order ${orderId} not eligible (${result.orderStatus}/${result.paymentStatus})`
      );
      return NextResponse.json(
        { success: false, error: "Order is not pending payment" },
        { status: 400 }
      );
    }
    log.warn(`repayment refused — order ${orderId} not found`);
    return NextResponse.json({ success: false, error: "Order not found" }, { status: 404 });
  } catch {
    log.error("repayment failed", new RouteLogError("repayment failed"));
    return NextResponse.json({ success: false, error: "Failed to create payment" }, { status: 500 });
  }
}

/** HTTP entry: wrapper menambahkan `x-request-id` kanonik + satu baris completion. */
export const POST = withRequestContext(createRepayment, "payments-midtrans-create");
