import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { orders, auditLogs } from "@/db";
import { eq } from "drizzle-orm";
import { z } from "zod";
import crypto from "crypto";
import { withPermission, getBranchScope } from "@/lib/auth-guard";
import { requestLogger, serializeError } from "@/lib/logger";
import {
  getFailedPickupAttemptUpdate,
  isPickupVerificationLocked,
  verifyPickupCode,
} from "@/lib/pickup-code";

const verifyPickupSchema = z.object({
  pickupCodeInput: z.string().min(1).max(10),
});

export const POST = withPermission(async (
  { user },
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  const log = requestLogger(request, {
    module: "admin-orders",
    action: "verify-pickup",
    userId: user.id,
    role: user.role,
  });
  try {
    const { id } = await params;
    const orderLog = log.child({ orderId: id });
    const body = await request.json();
    const parsed = verifyPickupSchema.safeParse(body);

    if (!parsed.success) {
      orderLog.warn("invalid pickup code input", { issues: parsed.error.issues });
      return NextResponse.json(
        { success: false, error: "Invalid input" },
        { status: 400 }
      );
    }

    const { pickupCodeInput } = parsed.data;
    const scope = getBranchScope(user);

    // Only branch admins can verify pickup codes (HQ is read-only per spec)
    if (scope.mode !== "own") {
      orderLog.warn("non-branch admin attempted pickup verify");
      return NextResponse.json(
        { success: false, error: "Only branch admins can verify pickup codes" },
        { status: 403 }
      );
    }

    // Load the order
    const orderRows = await db
      .select()
      .from(orders)
      .where(eq(orders.id, id))
      .limit(1);

    if (orderRows.length === 0) {
      orderLog.warn("order not found");
      return NextResponse.json(
        { success: false, error: "Order not found" },
        { status: 404 }
      );
    }

    const order = orderRows[0];

    // RBAC: must be this branch's order
    if (order.branchId !== scope.branchId) {
      orderLog.warn("forbidden — order belongs to a different branch", {
        orderBranchId: order.branchId,
        adminBranchId: scope.branchId,
      });
      return NextResponse.json(
        { success: false, error: "Forbidden — order belongs to a different branch" },
        { status: 403 }
      );
    }

    // Order must be ready_for_pickup
    if (order.status !== "ready_for_pickup") {
      orderLog.warn("order not ready_for_pickup", { status: order.status });
      return NextResponse.json(
        {
          success: false,
          error: `Order must be ready_for_pickup (current: ${order.status})`,
        },
        { status: 400 }
      );
    }

    if (isPickupVerificationLocked(order.pickupLockedUntil)) {
      const retryAfter = Math.max(
        1,
        Math.ceil((order.pickupLockedUntil!.getTime() - Date.now()) / 1000)
      );
      return NextResponse.json(
        { success: false, error: "Too many attempts. Please try again later." },
        { status: 429, headers: { "Retry-After": String(retryAfter) } }
      );
    }

    // Constant-time comparison to avoid timing attacks
    const input = pickupCodeInput.toUpperCase().trim();
    const isMatch = verifyPickupCode(input, order.pickupCode);

    if (!isMatch) {
      const failedAttempt = getFailedPickupAttemptUpdate(
        order.pickupVerificationAttempts
      );
      await db
        .update(orders)
        .set({
          pickupVerificationAttempts: failedAttempt.attempts,
          pickupLockedUntil: failedAttempt.lockedUntil,
          updatedAt: new Date(),
        })
        .where(eq(orders.id, id));
      orderLog.warn("pickup code mismatch", {
        attempts: failedAttempt.attempts,
        locked: Boolean(failedAttempt.lockedUntil),
      });
      return NextResponse.json(
        { success: false, error: "Invalid pickup code. Please verify with the customer." },
        { status: 409 }
      );
    }

    orderLog.info("pickup code verified — calling store order-complete");

    // ===== Code matches → call the store's internal order-complete endpoint =====
    const storeUrl =
      process.env.STORE_INTERNAL_URL ||
      "http://localhost:3000";

    if (!process.env.STORE_INTERNAL_URL) {
      orderLog.warn("STORE_INTERNAL_URL not set; falling back to localhost:3000");
    }

    const secret = crypto
      .createHmac("sha256", process.env.BETTER_AUTH_SECRET || "")
      .update(id)
      .digest("hex");

    const completeRes = await fetch(
      `${storeUrl}/api/internal/order-complete`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId: id, secret }),
      }
    );

    if (!completeRes.ok) {
      const errData = await completeRes.json().catch(() => ({}));
      orderLog.error("store order-complete call failed", {
        httpStatus: completeRes.status,
        errData,
      });
      return NextResponse.json(
        {
          success: false,
          error: "Failed to complete order. Please try again.",
        },
        { status: 502 }
      );
    }


    await db
      .update(orders)
      .set({
        pickupVerificationAttempts: 0,
        pickupLockedUntil: null,
        updatedAt: new Date(),
      })
      .where(eq(orders.id, id));

    // Write an audit log
    await db.insert(auditLogs).values({
      id: crypto.randomUUID(),
      userId: user.id,
      action: "VERIFY_PICKUP_CODE",
      entityType: "order",
      entityId: id,
      changes: { status: { from: "ready_for_pickup", to: "completed" } },
      ipAddress: null,
    });

    orderLog.info("order completed via pickup verification", { userId: user.id });
    return NextResponse.json({
      success: true,
      message: "Order completed successfully",
    });
  } catch (error) {
    log.error("verify pickup code failed", { error: serializeError(error) });
    return NextResponse.json(
      { success: false, error: "Failed to verify pickup code" },
      { status: 500 }
    );
  }
}, "orders", "edit");
