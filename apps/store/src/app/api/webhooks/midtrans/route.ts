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
  claimAndFinalizePaidOrder,
  claimAndFailOrder,
  describeFailureReason,
  resolvePaymentOutcome,
  type PaymentAttributes,
} from "@/lib/order-finalize";
import { requestLogger, serializeError } from "@/lib/logger";
import { processLateSettlementStock } from "@/lib/jubelio-stock-saga";

export async function POST(request: NextRequest) {
  const log = requestLogger(request, { module: "midtrans-webhook" });
  try {
    const body = await request.json();
    const verified = validateMidtransWebhookPayload(body);
    if (!verified.ok) {
      log.warn("webhook authentication rejected", { error: verified.error });
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

    log.info("webhook received", { order_id, transaction_status, status_code });

    const orderLog = log.child({ orderId: String(order_id) });

    // ===== Load the order =====
    const orderRows = await db
      .select()
      .from(orders)
      .where(eq(orders.id, String(order_id)))
      .limit(1);

    if (orderRows.length === 0) {
      orderLog.error("order not found");
      return NextResponse.json(
        { success: false, error: "Order not found" },
        { status: 404 }
      );
    }

    const order = orderRows[0];

    if (!amountsMatch(order.total, gross_amount)) {
      orderLog.error("gross amount mismatch", {
        expected: order.total,
        received: gross_amount,
      });
      return NextResponse.json(
        { success: false, error: "Gross amount mismatch" },
        { status: 400 }
      );
    }

    // ===== Idempotency: skip if already in a terminal state =====
    // (The claim-guard inside the finalizers also enforces this, but checking
    // here avoids a redundant Midtrans status re-verify round-trip.)
    if (order.paymentStatus === "paid") {
      orderLog.info("already processed — skipping");
      return NextResponse.json({
        success: true,
        message: "Order already processed",
      });
    }
    // A failed_payment order is not skipped before authoritative re-verification:
    // Midtrans can settle after TTL compensation. That path must re-acquire
    // stock or enter manual review instead of discarding a valid payment.

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
        orderLog.error("transaction not found during status re-verify");
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
    } catch (verifyError) {
      orderLog.error("status re-verify failed", {
        error: serializeError(verifyError),
      });
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
      // Payment success: convert reservation → real deduction, generate pickup
      // code, move to ready_for_pickup, send email. Claim-guard makes this
      // idempotent against the sweep cron racing this webhook.
      orderLog.info("settlement → finalize dispatched", {
        authoritativeStatus,
        paymentType: paymentAttributes.paymentType,
      });
      if (order.status === "failed_payment") {
        const lateSettlement = await processLateSettlementStock(
          order.id,
          undefined,
          orderLog,
          paymentAttributes
        );
        orderLog.info("late settlement processed", lateSettlement);
      } else {
        await claimAndFinalizePaidOrder(
          order.id,
          order,
          orderLog,
          paymentAttributes
        );
      }
    } else if (outcome === "fail") {
      const reason =
        describeFailureReason(authoritativeStatus, authoritativeStatusMessage) ??
        "Payment failed";
      orderLog.info("failure → fail dispatched", {
        authoritativeStatus,
        reason,
      });
      await claimAndFailOrder(
        order.id,
        reason,
        authoritativeStatus,
        orderLog,
        paymentAttributes
      );
    }
    // defer (pending/deny/cancel/failure) → no DB write: Snap allows the
    // customer to retry with another method on the same order, so the order
    // stays pending_payment until a settlement/expire webhook or the TTL sweep.
    if (outcome === "defer") {
      orderLog.info("non-terminal status — order stays pending_payment", {
        authoritativeStatus,
      });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    log.error("webhook handler failed", { error: serializeError(error) });
    return NextResponse.json(
      { success: false, error: "Webhook processing failed" },
      { status: 500 }
    );
  }
}
