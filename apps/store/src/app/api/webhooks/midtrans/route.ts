import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { orders } from "@/db";
import { eq } from "drizzle-orm";
import {
  verifyMidtransSignature,
  getMidtransTransactionStatus,
} from "@/lib/midtrans";
import {
  claimAndFinalizePaidOrder,
  claimAndFailOrder,
  describeFailureReason,
} from "@/lib/order-finalize";
import { requestLogger, serializeError } from "@/lib/logger";

export async function POST(request: NextRequest) {
  const log = requestLogger(request, { module: "midtrans-webhook" });
  try {
    const body = await request.json();

    const {
      order_id,
      transaction_status,
      status_code,
      gross_amount,
      signature_key,
      fraud_status,
    } = body;

    log.info("webhook received", { order_id, transaction_status, status_code });

    if (!order_id || !transaction_status) {
      log.warn("invalid notification — missing fields");
      return NextResponse.json(
        { success: false, error: "Invalid notification" },
        { status: 400 }
      );
    }

    // ===== Signature verification =====
    // Classic Snap: SHA512(order_id + status_code + gross_amount + serverKey)
    if (signature_key) {
      const isValid = verifyMidtransSignature(
        String(order_id),
        String(status_code || "200"),
        String(gross_amount),
        String(signature_key)
      );
      if (!isValid) {
        log.error("invalid signature", { order_id });
        return NextResponse.json(
          { success: false, error: "Invalid signature" },
          { status: 401 }
        );
      }
    }

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
    if (order.status === "failed_payment") {
      orderLog.info("already failed — skipping");
      return NextResponse.json({
        success: true,
        message: "Order already marked as failed",
      });
    }

    // ===== Re-verify with Midtrans (best practice) =====
    // Fetch authoritative status directly from Midtrans to defend against
    // spoofed callbacks, even when the signature looks valid.
    let authoritativeStatus = String(transaction_status);
    let authoritativeFraud = fraud_status ? String(fraud_status) : undefined;
    let authoritativeStatusMessage: string | undefined;
    try {
      const statusRes = await getMidtransTransactionStatus(String(order_id));
      if (statusRes) {
        authoritativeStatus = statusRes.transaction_status;
        authoritativeFraud = statusRes.fraud_status ?? authoritativeFraud;
        authoritativeStatusMessage = statusRes.status_message;
      }
    } catch (verifyError) {
      // If re-verify fails, fall back to the webhook payload (signature was
      // already verified above). Log the issue for investigation.
      orderLog.error("status re-verify failed", {
        error: serializeError(verifyError),
      });
    }

    // ===== Handle transaction status =====
    const isSuccess =
      authoritativeStatus === "settlement" ||
      (authoritativeStatus === "capture" && authoritativeFraud === "accept");

    const isFailure =
      authoritativeStatus === "deny" ||
      authoritativeStatus === "cancel" ||
      authoritativeStatus === "expire";

    if (isSuccess) {
      // Payment success: convert reservation → real deduction, generate pickup
      // code, move to ready_for_pickup, send email. Claim-guard makes this
      // idempotent against the sweep cron racing this webhook.
      orderLog.info("settlement → finalize dispatched", {
        authoritativeStatus,
      });
      await claimAndFinalizePaidOrder(order.id, order, orderLog);
    } else if (isFailure) {
      const reason =
        describeFailureReason(authoritativeStatus, authoritativeStatusMessage) ??
        "Payment failed";
      orderLog.info("failure → fail dispatched", {
        authoritativeStatus,
        reason,
      });
      await claimAndFailOrder(order.id, reason, authoritativeStatus, orderLog);
    }
    // transaction_status === "pending" → do nothing, order stays pending_payment
    if (!isSuccess && !isFailure) {
      orderLog.info("non-terminal status — no action", { authoritativeStatus });
    }

    // Always return 200 to Midtrans (prevents retries)
    return NextResponse.json({ success: true });
  } catch (error) {
    log.error("webhook handler failed", { error: serializeError(error) });
    // Still return 200 to prevent Midtrans from retrying excessively
    return NextResponse.json({ success: true });
  }
}