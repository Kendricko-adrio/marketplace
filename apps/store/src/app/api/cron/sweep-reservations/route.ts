import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { orders } from "@/db";
import { eq, and, lt } from "drizzle-orm";
import {
  getMidtransTransactionStatus,
  expireMidtransTransaction,
} from "@/lib/midtrans";
import {
  claimAndFinalizePaidOrder,
  claimAndFailOrder,
} from "@/lib/order-finalize";

/**
 * Sweep cron — safety-net release for stock reservations whose order expired
 * without a Midtrans `expire` webhook arriving.
 *
 * Triggered by the host crontab (see docs/deployment-docs/cron-sweep.md):
 *   curl -X POST -H "X-Cron-Secret: $CRON_SECRET" \
 *     https://<store-host>/api/cron/sweep-reservations
 *
 * For each stale pending_payment order (expiresAt < now) it re-verifies the
 * Midtrans transaction status:
 *   - settled/captured  → finalize as paid (a webhook was likely missed).
 *   - anything else      → best-effort expire at Midtrans, then fail the order
 *                          and release its reservation.
 *
 * The claim-guard inside the finalizers makes this safe to run concurrently
 * with the webhook: whichever path flips the order off `pending_payment` first
 * wins; the other sees 0 rows and skips. The sweep always returns 200 so the
 * crontab log stays clean (errors are logged server-side).
 *
 * Idempotent: re-running over already-handled orders is a no-op.
 */
export async function POST(request: NextRequest) {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    console.error("sweep-reservations: CRON_SECRET is not set on the server");
    return NextResponse.json(
      { success: false, error: "Cron not configured" },
      { status: 503 }
    );
  }
  const provided = request.headers.get("x-cron-secret");
  if (!provided || provided !== expected) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, {
      status: 401,
    });
  }

  let finalized = 0;
  let failed = 0;
  let scanned = 0;

  try {
    // Batch of stale pending_payment orders (uses idx_orders_status_expires).
    const stale = await db
      .select()
      .from(orders)
      .where(
        and(
          eq(orders.status, "pending_payment"),
          lt(orders.expiresAt, new Date())
        )
      )
      .limit(100);

    scanned = stale.length;

    for (const order of stale) {
      try {
        // Re-verify with Midtrans OUTSIDE any tx (don't hold locks across HTTP).
        let status: string = "unknown";
        let fraud: string | undefined;
        try {
          const res = await getMidtransTransactionStatus(order.id);
          if (res) {
            status = res.transaction_status;
            fraud = res.fraud_status;
          } else {
            // 404 — transaction never registered at Midtrans.
            status = "not_found";
          }
        } catch (err) {
          console.error(
            `sweep-reservations: status check failed for ${order.id}:`,
            err
          );
          // Don't fail the order on a transient Midtrans error — leave it for
          // the next sweep run. Avoids wrongly failing a paid-but-unreachable
          // order.
          continue;
        }

        const isSettled =
          status === "settlement" ||
          (status === "capture" && fraud === "accept");

        if (isSettled) {
          // A success webhook was likely missed — finalize as paid.
          const result = await claimAndFinalizePaidOrder(order.id, order);
          if (result.claimed) finalized++;
        } else {
          // pending / expire / deny / cancel / not_found — release reservation.
          // Best-effort tell Midtrans to expire it (no-op if already expired).
          if (status === "pending") {
            await expireMidtransTransaction(order.id);
          }
          const reason =
            status === "not_found"
              ? "Payment expired — order timed out (sweep; not found at Midtrans)"
              : "Payment expired — order timed out (sweep)";
          const result = await claimAndFailOrder(order.id, reason, status);
          if (result.claimed) failed++;
        }
      } catch (err) {
        console.error(`sweep-reservations: error processing ${order.id}:`, err);
      }
    }

    console.log(
      `sweep-reservations: scanned=${scanned} finalized=${finalized} failed=${failed}`
    );
    return NextResponse.json({
      success: true,
      scanned,
      finalized,
      failed,
    });
  } catch (error) {
    console.error("sweep-reservations: fatal error:", error);
    return NextResponse.json(
      { success: false, error: "Sweep failed" },
      { status: 500 }
    );
  }
}