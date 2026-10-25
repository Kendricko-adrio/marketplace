import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { orders } from "@/db";
import { eq } from "drizzle-orm";
import { z } from "zod";
import crypto from "crypto";
import { guard, crossBranchNotFound } from "@/lib/rbac/guard";
import { finalizePickupCompletion } from "@/lib/orders-service";
import { createModuleLogger, withRequestContext } from "@/lib/logger";
import {
  getFailedPickupAttemptUpdate,
  isPickupVerificationLocked,
  verifyPickupCode,
} from "@/lib/pickup-code";

const verifyPickupSchema = z.object({
  pickupCodeInput: z.string().min(1).max(10),
});

/**
 * Module logger untuk route ini: dibuat sekali di module scope, sedangkan
 * `requestId` dibaca dari scope HTTP yang aktif setiap kali log ditulis
 * (`withRequestContext` di export handler membuka scope tersebut).
 */
const log = createModuleLogger("admin-order-verify-pickup");

/**
 * Proyeksi teknis statis untuk field `error`: pesan asli dari DB, fetch, atau
 * store internal tidak pernah masuk log, hanya pesan yang ditulis module ini.
 * Body respons store juga tidak pernah diteruskan (bisa memuat detail internal).
 */
class RouteLogError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RouteLogError";
  }
}

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
async function verifyPickup(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const guardResult = await guard("orders", "edit");
  if (!guardResult.ok) return guardResult.response;
  const { ctx } = guardResult;

  let orderId: string | null = null;
  try {
    const { id } = await params;
    orderId = id;
    const body = await request.json();
    const parsed = verifyPickupSchema.safeParse(body);

    if (!parsed.success) {
      log.warn(
        `verify-pickup ditolak: body tidak valid (order ${orderId}, outcome denied)`
      );
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
      .where(eq(orders.id, orderId))
      .limit(1);

    if (orderRows.length === 0) {
      crossBranchNotFound();
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
      crossBranchNotFound();
      return NextResponse.json(
        { success: false, error: "Order not found" },
        { status: 404 }
      );
    }

    // Order must be ready_for_pickup
    if (order.status !== "ready_for_pickup") {
      log.warn(
        `verify-pickup ditolak: status bukan ready_for_pickup (order ${orderId}, status ${order.status}, outcome denied)`
      );
      return NextResponse.json(
        {
          success: false,
          error: `Order must be ready_for_pickup (current: ${order.status})`,
        },
        { status: 400 }
      );
    }

    // Sales-Order settlement gate: a paid-but-ambiguous order must never be
    // picked up, even if legacy data somehow carries a pickup code.
    if (order.fulfillmentBlockedReason) {
      log.warn(
        `verify-pickup ditolak: settlement Jubelio belum terverifikasi (order ${orderId}, outcome denied)`
      );
      return NextResponse.json(
        {
          success: false,
          error:
            "Pesanan diblokir untuk pengambilan: settlement Jubelio belum terverifikasi. Lihat antrean review.",
        },
        { status: 409 }
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
        .where(eq(orders.id, orderId));
      log.warn(
        `verify-pickup ditolak: kode tidak cocok (order ${orderId}, attempts ${failedAttempt.attempts}, locked ${Boolean(
          failedAttempt.lockedUntil
        )}, outcome denied)`
      );
      return NextResponse.json(
        { success: false, error: "Invalid pickup code. Please verify with the customer." },
        { status: 409 }
      );
    }

    log.info(`verify-pickup: kode terverifikasi (order ${orderId})`);

    // ===== Code matches → call the store's internal order-complete endpoint =====
    const storeUrl =
      process.env.STORE_INTERNAL_URL ||
      "http://localhost:3000";

    if (!process.env.STORE_INTERNAL_URL) {
      log.warn(
        `verify-pickup: STORE_INTERNAL_URL belum diset, memakai localhost:3000 (order ${orderId})`
      );
    }

    const secret = crypto
      .createHmac("sha256", process.env.BETTER_AUTH_SECRET || "")
      .update(orderId)
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
        body: JSON.stringify({ orderId, secret }),
      });
    } catch {
      log.warn(
        `verify-pickup: order-complete tidak dapat dihubungi (order ${orderId}, outcome error)`,
        new RouteLogError("verify-pickup order-complete unreachable")
      );
    }

    let httpStatus: number | undefined;
    if (completeRes && !completeRes.ok) {
      httpStatus = completeRes.status;
      // Body store dibaca habis seperti sebelumnya, tetapi TIDAK pernah
      // dijadikan field log (bisa memuat detail internal store).
      await completeRes.json().catch(() => ({}));
      log.error(
        `verify-pickup: order-complete menolak (order ${orderId}, httpStatus ${httpStatus}, outcome error)`,
        new RouteLogError("verify-pickup order-complete failed")
      );
    }

    const finalize = await finalizePickupCompletion(orderId, {
      actorId: ctx.user.id,
      policyVersion: ctx.policy.policyVersion,
      branchId: order.branchId,
    });

    if (!finalize.finalized) {
      // The seam writes nothing when the order is not completed (still
      // retryable) — the 502 stays safe and the code/message stay stable.
      log.error(
        `verify-pickup: completion tidak final (order ${orderId}, externalOk ${completeRes?.ok === true}, httpStatus ${httpStatus ?? "none"}, storeStatus ${finalize.status}, outcome error)`,
        new RouteLogError("verify-pickup completion not finalized")
      );
      return NextResponse.json(
        {
          success: false,
          error: "Failed to complete order. Please try again.",
        },
        { status: 502 }
      );
    }

    log.info(
      `verify-pickup selesai (order ${orderId}, userId ${ctx.user.id}, reconciled ${!(completeRes && completeRes.ok)}, outcome success)`
    );
    return NextResponse.json({
      success: true,
      message: "Order completed successfully",
    });
  } catch {
    log.error(
      `verify-pickup gagal (order ${orderId ?? "unknown"}, outcome error)`,
      new RouteLogError("verify-pickup gagal")
    );
    return NextResponse.json(
      { success: false, error: "Failed to verify pickup code" },
      { status: 500 }
    );
  }
}

/** HTTP entry: wrapper menambahkan `x-request-id` kanonik + satu baris completion. */
export const POST = withRequestContext(verifyPickup, "admin-order-verify-pickup");
