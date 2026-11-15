import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { orders } from "@/db";
import { eq } from "drizzle-orm";
import {
  amountsMatch,
  getMidtransTransactionStatus,
  validateMidtransWebhookPayload,
} from "@/lib/midtrans";
import {
  blockOrderFulfillment,
  claimAndFailOrder,
  claimPaidOrder,
  describeFailureReason,
  processLateSettlement,
  resolvePaymentOutcome,
  type PaymentAttributes,
} from "@/lib/order-finalize";
import { settleJubelioSalesOrder } from "@/lib/jubelio-sales-settlement";
import { createModuleLogger, withRequestContext } from "@/lib/logger";

/**
 * Module logger untuk route ini: dibuat sekali di module scope, sedangkan
 * `requestId` dibaca dari scope HTTP yang aktif setiap kali log ditulis
 * (`withRequestContext` di export handler membuka scope tersebut).
 */
const log = createModuleLogger("midtrans-webhook");

/**
 * Proyeksi teknis statis untuk field `error`: pesan asli dari DB/Midtrans/Next
 * tidak pernah masuk log, hanya pesan yang ditulis module ini.
 */
class RouteLogError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RouteLogError";
  }
}

/** HTTP adapter webhook: validasi payload, re-verify ke Midtrans, claim/ finalize. */
async function midtransWebhook(request: NextRequest): Promise<Response> {
  try {
    const body = await request.json();
    const verified = validateMidtransWebhookPayload(body);
    if (!verified.ok) {
      log.warn(`webhook authentication rejected — ${verified.error}`);
      return NextResponse.json(
        { success: false, error: verified.error },
        { status: verified.status }
      );
    }
    const {
      orderId: order_id,
      transactionStatus: transaction_status,
      grossAmount: gross_amount,
      statusCode: status_code,
    } = verified.data;

    const orderRef = String(order_id);
    log.info(
      `webhook received: order ${orderRef}, status ${transaction_status}, statusCode ${status_code}`
    );

    // ===== Load the order =====
    const orderRows = await db
      .select()
      .from(orders)
      .where(eq(orders.id, String(order_id)))
      .limit(1);

    if (orderRows.length === 0) {
      log.error(`webhook: order ${orderRef} not found`);
      return NextResponse.json(
        { success: false, error: "Order not found" },
        { status: 404 }
      );
    }

    const order = orderRows[0];

    if (!amountsMatch(order.total, gross_amount)) {
      log.error(
        `webhook: order ${order.id} gross amount mismatch, expected ${order.total}, received ${gross_amount}`
      );
      return NextResponse.json(
        { success: false, error: "Gross amount mismatch" },
        { status: 400 }
      );
    }

    // ===== Idempotency: skip if already in a terminal state =====
    // (The claim-guard inside the finalizers also enforces this, but checking
    // here avoids a redundant Midtrans status re-verify round-trip.)
    if (order.paymentStatus === "paid") {
      log.info(`webhook: order ${order.id} already processed — skipping`);
      return NextResponse.json({
        success: true,
        message: "Order already processed",
      });
    }
    // A failed_payment order is not skipped before authoritative re-verification:
    // Midtrans can settle after TTL compensation. That path must reconcile the
    // Sales Order (never re-settle after a confirmed cancel) instead of
    // discarding a valid payment.

    // ===== Re-verify with Midtrans (best practice) =====
    // Fetch authoritative status directly from Midtrans to defend against
    // spoofed callbacks, even when the signature looks valid.
    let authoritativeStatus: string;
    let authoritativeFraud: string | undefined;
    let authoritativeStatusMessage: string | undefined;
    let authoritativePaymentType: string | undefined;
    let authoritativeTransactionId: string | undefined;
    try {
      const statusRes = await getMidtransTransactionStatus(String(order_id));
      if (!statusRes) {
        log.error(`webhook: order ${orderRef} transaction not found during status re-verify`);
        return NextResponse.json(
          { success: false, error: "Unable to verify transaction" },
          { status: 503 }
        );
      }
      if (statusRes.order_id && statusRes.order_id !== order_id) {
        return NextResponse.json(
          { success: false, error: "Transaction order mismatch" },
          { status: 400 }
        );
      }
      if (!amountsMatch(order.total, statusRes.gross_amount ?? "")) {
        return NextResponse.json(
          { success: false, error: "Verified gross amount mismatch" },
          { status: 400 }
        );
      }
      authoritativeStatus = statusRes.transaction_status;
      authoritativeFraud = statusRes.fraud_status;
      authoritativeStatusMessage = statusRes.status_message;
      authoritativePaymentType =
        typeof statusRes.payment_type === "string" && statusRes.payment_type
          ? statusRes.payment_type
          : undefined;
      authoritativeTransactionId =
        typeof statusRes.transaction_id === "string" && statusRes.transaction_id
          ? statusRes.transaction_id
          : undefined;
    } catch {
      log.error(
        `webhook: order ${orderRef} status re-verify failed`,
        new RouteLogError("midtrans status re-verify failed")
      );
      return NextResponse.json(
        { success: false, error: "Unable to verify transaction" },
        { status: 503 }
      );
    }

    // ===== Handle transaction status =====
    // Authoritative payment attributes (method + transaction id) are taken
    // ONLY from the GET status response — never from the raw webhook body.
    const paymentAttributes: PaymentAttributes = {
      paymentType: authoritativePaymentType,
      transactionId: authoritativeTransactionId,
    };

    const outcome = resolvePaymentOutcome(
      authoritativeStatus,
      authoritativeFraud
    );

    if (outcome === "finalize") {
      // Payment success: keep Midtrans's authoritative paid status. Fulfillment
      // (ready_for_pickup + pickup code) happens ONLY after the Sales-Order
      // settlement (invoice → payment) is verified; ambiguity keeps the order
      // paid but blocked and creates a manual-review case.
      log.info(
        `order ${order.id}: settlement → paid claim dispatched (status ${authoritativeStatus}, paymentType ${
          paymentAttributes.paymentType ?? "unknown"
        })`
      );
      if (order.status === "failed_payment") {
        // Late settlement: honor the confirmed-cancel rule (no new SO/invoice/
        // payment) before running the settlement pipeline.
        const late = await processLateSettlement(order.id, paymentAttributes);
        log.info(`order ${order.id}: late settlement processed (outcome ${late.status})`);
        if (late.status === "settled") {
          await settleJubelioSalesOrder(order.id);
        } else if (late.status === "manual_review" && late.message) {
          await blockOrderFulfillment(order.id, late.message);
        }
      } else {
        const claimed = await claimPaidOrder(order.id, paymentAttributes);
        if (claimed.claimed) {
          const settlement = await settleJubelioSalesOrder(order.id);
          log.info(
            `order ${order.id}: settlement pipeline completed (outcome ${settlement.status})`
          );
        }
      }
    } else if (outcome === "fail") {
      const reason =
        describeFailureReason(authoritativeStatus, authoritativeStatusMessage) ??
        "Payment failed";
      // `reason` dapat memuat `status_message` provider: hanya status yang
      // masuk log.
      log.info(
        `order ${order.id}: failure → fail dispatched (status ${authoritativeStatus})`
      );
      await claimAndFailOrder(
        order.id,
        reason,
        authoritativeStatus,
        paymentAttributes
      );
    }
    // defer (pending/deny/cancel/failure) → no DB write: Snap allows the
    // customer to retry with another method on the same order, so the order
    // stays pending_payment until a settlement/expire webhook or the TTL sweep.
    if (outcome === "defer") {
      log.info(
        `order ${order.id}: non-terminal status — order stays pending_payment (status ${authoritativeStatus})`
      );
    }

    return NextResponse.json({ success: true });
  } catch {
    log.error(
      "webhook handler failed",
      new RouteLogError("midtrans webhook handler failed")
    );
    return NextResponse.json(
      { success: false, error: "Webhook processing failed" },
      { status: 500 }
    );
  }
}

/** HTTP entry: wrapper menambahkan `x-request-id` kanonik + satu baris completion. */
export const POST = withRequestContext(midtransWebhook, "midtrans-webhook");
