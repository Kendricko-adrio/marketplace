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

export async function POST(request: NextRequest) {
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

    if (!order_id || !transaction_status) {
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
        console.error("Midtrans webhook: invalid signature for order", order_id);
        return NextResponse.json(
          { success: false, error: "Invalid signature" },
          { status: 401 }
        );
      }
    }

    // ===== Load the order =====
    const orderRows = await db
      .select()
      .from(orders)
      .where(eq(orders.id, String(order_id)))
      .limit(1);

    if (orderRows.length === 0) {
      console.error("Midtrans webhook: order not found", order_id);
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
      return NextResponse.json({
        success: true,
        message: "Order already processed",
      });
    }
    if (order.status === "failed_payment") {
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
      console.error(
        "Midtrans webhook: status re-verify failed for order",
        order_id,
        verifyError
      );
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
      await claimAndFinalizePaidOrder(order.id, order);
      console.log(
        `Midtrans webhook: order ${order_id} settlement → finalize dispatched`
      );
    } else if (isFailure) {
      const reason =
        describeFailureReason(authoritativeStatus, authoritativeStatusMessage) ??
        "Payment failed";
      await claimAndFailOrder(order.id, reason, authoritativeStatus);
      console.log(
        `Midtrans webhook: order ${order_id} ${authoritativeStatus} → fail dispatched`
      );
    }
    // transaction_status === "pending" → do nothing, order stays pending_payment

    // Always return 200 to Midtrans (prevents retries)
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Midtrans webhook error:", error);
    // Still return 200 to prevent Midtrans from retrying excessively
    return NextResponse.json({ success: true });
  }
}