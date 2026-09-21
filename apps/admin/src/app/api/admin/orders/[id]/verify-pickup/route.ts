import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { orders } from "@/db";
import { eq } from "drizzle-orm";
import { z } from "zod";
import crypto from "crypto";
import { guard, crossBranchNotFound } from "@/lib/rbac/guard";
import { finalizePickupCompletion } from "@/lib/orders-service";
import { serializeError } from "@/lib/logger";
import {
  getFailedPickupAttemptUpdate,
  isPickupVerificationLocked,
  verifyPickupCode,
} from "@/lib/pickup-code";

const verifyPickupSchema = z.object({
  pickupCodeInput: z.string().min(1).max(10),
});

/**
 * Verify the customer's pickup code and complete the order.   [orders:edit]
 *
 * Pickup Verification is a PHYSICAL own-branch-only operation: the order must
 * belong to the Admin User's Home Branch, even when the Role has all-branch
 * Order editing (an all-branch editor still works from one physical branch).
 * The branch identity is the server-pinned Home Branch from Current Policy —
 * never a client-supplied value. A cross-branch order id maps to 404 so
 * existence is not disclosed.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const guardResult = await guard("orders", "edit", { request });
  if (!guardResult.ok) return guardResult.response;
  const { logger, ctx } = guardResult;

  try {
    const { id } = await params;
    const orderLog = logger.child({ orderId: id });
    const body = await request.json();
    const parsed = verifyPickupSchema.safeParse(body);

    if (!parsed.success) {
      orderLog.warn("verify-pickup.invalid_input", {
        outcome: "denied",
        issues: parsed.error.issues,
      });
      return NextResponse.json(
        { success: false, error: "Invalid input" },
        { status: 400 }
      );
    }

    const { pickupCodeInput } = parsed.data;

    // Load the order
    const orderRows = await db
      .select()
      .from(orders)
      .where(eq(orders.id, id))
      .limit(1);

    if (orderRows.length === 0) {
      crossBranchNotFound(orderLog);
      return NextResponse.json(
        { success: false, error: "Order not found" },
        { status: 404 }
      );
    }

    const order = orderRows[0];

    // Physical rule: the order must belong to the Admin User's Home Branch —
    // required even for a user with Orders edit-all. Cross-branch ids hide
    // behind 404; a policy without a Home Branch can never verify.
    if (
      !ctx.policy.user.homeBranchId ||
      order.branchId !== ctx.policy.user.homeBranchId
    ) {
      crossBranchNotFound(orderLog);
      return NextResponse.json(
        { success: false, error: "Order not found" },
        { status: 404 }
      );
    }

    // Order must be ready_for_pickup
    if (order.status !== "ready_for_pickup") {
      orderLog.warn("verify-pickup.order_not_ready", {
        outcome: "denied",
        status: order.status,
      });
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
      orderLog.warn("verify-pickup.code_mismatch", {
        outcome: "denied",
        attempts: failedAttempt.attempts,
        locked: Boolean(failedAttempt.lockedUntil),
      });
      return NextResponse.json(
        { success: false, error: "Invalid pickup code. Please verify with the customer." },
        { status: 409 }
      );
    }

    orderLog.info("verify-pickup.code_verified");

    // ===== Code matches → call the store's internal order-complete endpoint =====
    const storeUrl =
      process.env.STORE_INTERNAL_URL ||
      "http://localhost:3000";

    if (!process.env.STORE_INTERNAL_URL) {
      orderLog.warn("verify-pickup.store_url_missing", {
        detail: "STORE_INTERNAL_URL not set; falling back to localhost:3000",
      });
    }

    const secret = crypto
      .createHmac("sha256", process.env.BETTER_AUTH_SECRET || "")
      .update(id)
      .digest("hex");

    // The external call sits behind an unavoidable HTTP boundary that can
    // fail ambiguously: the store may have completed the order even when the
    // call throws or answers non-OK. Every path therefore funnels into the
    // reconciliation seam `finalizePickupCompletion` (orders-service), which
    // converges a store-completed / local-not-audited order idempotently and
    // performs the attempt reset + VERIFY_PICKUP_CODE audit in ONE
    // transaction behind a locked status re-check. The route itself never
    // writes order/audit state directly.
    let completeRes: Response | null = null;
    try {
      completeRes = await fetch(`${storeUrl}/api/internal/order-complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId: id, secret }),
      });
    } catch (fetchError) {
      orderLog.warn("verify-pickup.order_complete_unreachable", {
        outcome: "error",
        error: serializeError(fetchError),
      });
    }

    let httpStatus: number | undefined;
    let errData: unknown;
    if (completeRes && !completeRes.ok) {
      httpStatus = completeRes.status;
      errData = await completeRes.json().catch(() => ({}));
      orderLog.error("verify-pickup.order_complete_failed", {
        outcome: "error",
        httpStatus,
        errData,
      });
    }

    const finalize = await finalizePickupCompletion(id, {
      actorId: ctx.user.id,
      policyVersion: ctx.policy.policyVersion,
      branchId: order.branchId,
    });

    if (!finalize.finalized) {
      // The seam writes nothing when the order is not completed (still
      // retryable) — the 502 stays safe and the code/message stay stable.
      orderLog.error("verify-pickup.completion_not_finalized", {
        outcome: "error",
        externalOk: completeRes?.ok === true,
        httpStatus,
        storeStatus: finalize.status,
      });
      return NextResponse.json(
        {
          success: false,
          error: "Failed to complete order. Please try again.",
        },
        { status: 502 }
      );
    }

    orderLog.info("verify-pickup.completed", {
      outcome: "success",
      userId: ctx.user.id,
      reconciled: !(completeRes && completeRes.ok),
    });
    return NextResponse.json({
      success: true,
      message: "Order completed successfully",
    });
  } catch (error) {
    logger.error("verify-pickup.failure", {
      outcome: "error",
      error: serializeError(error),
    });
    return NextResponse.json(
      { success: false, error: "Failed to verify pickup code" },
      { status: 500 }
    );
  }
}