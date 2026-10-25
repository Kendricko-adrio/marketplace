import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { orders } from "@/db";
import { eq, and, lt } from "drizzle-orm";
import {
  getMidtransTransactionStatus,
  expireMidtransTransaction,
} from "@/lib/midtrans";
import {
  claimAndFailOrder,
  claimPaidOrder,
} from "@/lib/order-finalize";
import { settleJubelioSalesOrder } from "@/lib/jubelio-sales-settlement";
import { reconcileChannelStatusMirrorForSweep } from "@/lib/jubelio-channel-mirror";
import { reconcileConfirmedSalesOrderHolds } from "@/lib/jubelio-sales-lifecycle";
import { resumeUndispatchedCheckoutCreates } from "@/lib/checkout-recovery";
import { recoverCheckoutAttempts } from "@/features/checkout/recover-checkout-service";
import {
  reconcileJubelioSalesOperations,
  reconcileSettlements,
} from "@/lib/jubelio-sales-settlement";
import { createModuleLogger, withRequestContext } from "@/lib/logger";

/**
 * Sweep cron — safety net for Sales-Order orders whose outcome was missed.
 *
 * Triggered by the host crontab (see docs/deployment-docs/cron-sweep.md):
 *   curl -X POST -H "X-Cron-Secret: $CRON_SECRET" \
 *     https://<store-host>/api/cron/sweep-reservations
 *
 * Responsibilities (Sales-Order flow, plan: jubelio-sales-api-switching;
 * channel mirror: tickets #03, #04, #05 and #06):
 *   1. Reconcile in-flight durable SO operations by persisted remote id + GET
 *      (cancel → confirm + release the hold; invoice/payment → GET-verify).
 *      Aged unknown dispatches without remote ids go to `manual_review`.
 *   2. Resume settlement for PAID orders stuck in `processing` (missed
 *      webhook, crash after the paid claim, ambiguous settlement step).
 *   3. For stale pending_payment orders (expiresAt < now): re-verify with
 *      Midtrans — settled → finalize through settlement; otherwise expire +
 *      fail the order (the failure path cancels the SO pre-invoice and
 *      releases the local hold only after a confirmed cancel).
 *   4. LOW-PRIORITY bounded channel-status mirror reconciliation: aged
 *      possibly-sent edits are reconciled GET-ONLY by the persisted SO id
 *      (any target, terminal orders included; never a re-POST), pending
 *      intents whose local committed order went terminal (completed /
 *      cancelled) are durably superseded (pending → aborted, reason
 *      PENDING_TERMINAL_SUPERSEDED, no POST/GET — EXCEPT a pending `Selesai`
 *      intent on a completed order with a fully verified SO ledger, ticket
 *      #06: that pending target IS the current projection), and missed
 *      orders whose mirror intent was never created are dispatched
 *      best-effort LAST (committed `ready_for_pickup` → `Siap Proses`,
 *      paid-but-blocked operator investigations → `Menunggu Verifikasi`
 *      (ticket #04), committed failed_payment orders with a safe-to-edit
 *      Sales Order → `Gagal Bayar`, or the started-cancel mismatch record
 *      with zero POST/GET (ticket #05), and committed `completed` orders
 *      (after pickup) → `Selesai` (ticket #06); a committed `cancelled`
 *      order stays a future-facing `Dibatalkan` mapping contract only, so
 *      the supersede window covers it), so the settlement/expiry steps
 *      always get the cron budget first. Mirror failures never touch
 *      payment, pickup or fulfillment and never fail the sweep.
 *
 * The claim-guards make this safe to run concurrently with webhooks:
 * whichever path flips the order off `pending_payment` first wins. The sweep
 * always returns 200 so the crontab log stays clean (errors are logged
 * server-side). Idempotent: re-running over handled orders is a no-op.
 */

/**
 * Module logger untuk route ini: dibuat sekali di module scope, sedangkan
 * `requestId` dibaca dari scope HTTP yang aktif setiap kali log ditulis
 * (`withRequestContext` di export handler membuka scope tersebut).
 */
const log = createModuleLogger("sweep-reservations");

/**
 * Proyeksi teknis statis untuk field `error`: pesan asli dari DB/Midtrans/
 * provider tidak pernah masuk log, hanya pesan yang ditulis module ini.
 */
class RouteLogError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RouteLogError";
  }
}

/** HTTP adapter cron: auth gate, urutan langkah sweep, map ke status/body existing. */
async function sweepReservations(request: NextRequest): Promise<Response> {
  log.info("reservation sweep requested");
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    log.error("reservation sweep unavailable — CRON_SECRET is not configured");
    return NextResponse.json(
      { success: false, error: "Cron not configured" },
      { status: 503 }
    );
  }
  const provided = request.headers.get("x-cron-secret");
  if (!provided || provided !== expected) {
    log.warn("reservation sweep unauthorized");
    return NextResponse.json({ success: false, error: "Unauthorized" }, {
      status: 401,
    });
  }

  let finalized = 0;
  let failed = 0;
  let scanned = 0;
  const jubelioSalesReview = { scanned: 0, marked: 0, failed: 0 };
  let settlementReview = { scanned: 0, fulfilled: 0, review: 0, pending: 0 };
  let channelMirrorReview = {
    possiblySentScanned: 0,
    skippedFresh: 0,
    recovered: 0,
    investigated: 0,
    stillUnknown: 0,
    pendingTerminalScanned: 0,
    pendingTerminalAborted: 0,
    pendingTerminalSkipped: 0,
    missedOrdersScanned: 0,
    missedDispatched: 0,
    missedFailed: 0,
    verifikasiOrdersScanned: 0,
    verifikasiDispatched: 0,
    verifikasiFailed: 0,
    gagalBayarOrdersScanned: 0,
    gagalBayarDispatched: 0,
    gagalBayarFailed: 0,
    failed: 0,
  };

  try {
    // Intent checkout yang committed tetapi belum pernah dispatched boleh
    // memakai satu claim existing. Possibly-sent tetap GET-only di bawah.
    try {
      const resumed = await resumeUndispatchedCheckoutCreates(50);
      log.info(`undispatched checkout create sweep completed: resumed ${resumed}`);
    } catch {
      log.error("undispatched checkout create sweep unavailable");
    }
    // Pre-order attempts: claim never-sent intents, finish safe local promotion,
    // expire only never-sent reservations; possibly-sent rows stay held.
    try {
      const attempts = await recoverCheckoutAttempts({ limit: 50, cutoff: new Date(Date.now() - 5 * 60_000) });
      log.info(`checkout attempt recovery finished: promoted ${attempts.promoted}, rejected ${attempts.rejected}, held ${attempts.held}`);
    } catch {
      log.error("checkout attempt recovery unavailable");
    }
    // 1. Reconcile in-flight durable SO operations by persisted id + GET.
    try {
      const accounted = await reconcileConfirmedSalesOrderHolds(50);
      log.info(`confirmed Sales-Order hold accounting reconciled: accounted ${accounted}`);
      const ops = await reconcileJubelioSalesOperations(50);
      jubelioSalesReview.scanned = ops.scanned;
      jubelioSalesReview.marked = ops.marked;
      log.info(
        `sales operation reconciliation finished: scanned ${ops.scanned}, confirmed ${ops.confirmed}, released ${ops.released}, marked ${ops.marked}, pending ${ops.pending}`
      );
    } catch {
      jubelioSalesReview.failed++;
      log.error(
        "sales operation reconciliation failed",
        new RouteLogError("sales operation reconciliation failed")
      );
    }

    // 2. Resume settlement for paid orders that never fulfilled.
    try {
      settlementReview = await reconcileSettlements(50);
    } catch {
      log.error(
        "settlement reconciliation failed",
        new RouteLogError("settlement reconciliation failed")
      );
    }

    // 3. Stale pending_payment orders (uses idx_orders_status_expires).
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
        let paymentType: string | undefined;
        let transactionId: string | undefined;
        try {
          const res = await getMidtransTransactionStatus(order.id);
          if (res) {
            status = res.transaction_status;
            fraud = res.fraud_status;
            paymentType =
              typeof res.payment_type === "string" && res.payment_type
                ? res.payment_type
                : undefined;
            transactionId =
              typeof res.transaction_id === "string" && res.transaction_id
                ? res.transaction_id
                : undefined;
          } else {
            // 404 — transaction never registered at Midtrans.
            status = "not_found";
          }
        } catch {
          log.error(
            `Order ${order.id}: Midtrans status check failed`,
            new RouteLogError("Midtrans status check failed")
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
          // A success webhook was likely missed — finalize as paid through
          // the settlement pipeline (never ready_for_pickup before the
          // invoice + payment are verified).
          const claimed = await claimPaidOrder(order.id, {
            paymentType,
            transactionId,
          });
          if (claimed.claimed) {
            const settlement = await settleJubelioSalesOrder(order.id);
            if (settlement.status === "fulfilled") finalized++;
            else if (settlement.status === "manual_review") {
              // `settlement.message` memuat detail provider: hanya fakta bisnis
              // (order + outcome) yang masuk log.
              log.warn(`Order ${order.id}: sweep settlement needs manual review`);
            }
          }
        } else {
          // pending / expire / deny / cancel / not_found — expire + fail the
          // order (the failure path cancels the SO pre-invoice).
          if (status === "pending") {
            await expireMidtransTransaction(order.id);
          }
          const reason =
            status === "not_found"
              ? "Payment expired — order timed out (sweep; not found at Midtrans)"
              : "Payment expired — order timed out (sweep)";
          const result = await claimAndFailOrder(order.id, reason, status, {
            paymentType,
            transactionId,
          });
          if (result.claimed) failed++;
        }
      } catch {
        log.error(
          `Order ${order.id}: reservation sweep order processing failed`,
          new RouteLogError("reservation sweep order processing failed")
        );
      }
    }

    // 4. LOW-PRIORITY channel-status mirror reconciliation (tickets
    //    #03/#04/#05/#06): runs LAST so the critical settlement/expiry work
    //    always gets the cron budget first; GET-only recovery + best-effort
    //    missed-order dispatch for ready_for_pickup AND completed orders,
    //    never a re-POST, never fatal to the sweep.
    try {
      const mirror = await reconcileChannelStatusMirrorForSweep(db);
      channelMirrorReview = {
        possiblySentScanned: mirror.possiblySentScanned,
        skippedFresh: mirror.skippedFresh,
        recovered: mirror.recovered,
        investigated: mirror.investigated,
        stillUnknown: mirror.stillUnknown,
        pendingTerminalScanned: mirror.pendingTerminalScanned,
        pendingTerminalAborted: mirror.pendingTerminalAborted,
        pendingTerminalSkipped: mirror.pendingTerminalSkipped,
        missedOrdersScanned: mirror.missedOrdersScanned,
        missedDispatched: mirror.missedDispatched,
        missedFailed: mirror.missedFailed,
        verifikasiOrdersScanned: mirror.verifikasiOrdersScanned,
        verifikasiDispatched: mirror.verifikasiDispatched,
        verifikasiFailed: mirror.verifikasiFailed,
        gagalBayarOrdersScanned: mirror.gagalBayarOrdersScanned,
        gagalBayarDispatched: mirror.gagalBayarDispatched,
        gagalBayarFailed: mirror.gagalBayarFailed,
        failed: 0,
      };
      log.info(
        `channel-status mirror reconciliation finished: possiblySent ${mirror.possiblySentScanned}, skippedFresh ${mirror.skippedFresh}, recovered ${mirror.recovered}, investigated ${mirror.investigated}, stillUnknown ${mirror.stillUnknown}, pendingTerminal ${mirror.pendingTerminalScanned}/${mirror.pendingTerminalAborted}/${mirror.pendingTerminalSkipped}, missedOrders ${mirror.missedOrdersScanned}/${mirror.missedDispatched}/${mirror.missedFailed}, verifikasi ${mirror.verifikasiOrdersScanned}/${mirror.verifikasiDispatched}/${mirror.verifikasiFailed}, gagalBayar ${mirror.gagalBayarOrdersScanned}/${mirror.gagalBayarDispatched}/${mirror.gagalBayarFailed}`
      );
    } catch {
      channelMirrorReview.failed = 1;
      log.error(
        "channel-status mirror reconciliation failed",
        new RouteLogError("channel-status mirror reconciliation failed")
      );
    }

    log.info(
      `reservation sweep completed: scanned ${scanned}, finalized ${finalized}, failed ${failed}, ` +
        `salesReview {scanned ${jubelioSalesReview.scanned}, marked ${jubelioSalesReview.marked}, failed ${jubelioSalesReview.failed}}, ` +
        `settlement {scanned ${settlementReview.scanned}, fulfilled ${settlementReview.fulfilled}, review ${settlementReview.review}, pending ${settlementReview.pending}}, ` +
        `channelMirror {possiblySent ${channelMirrorReview.possiblySentScanned}, recovered ${channelMirrorReview.recovered}, investigated ${channelMirrorReview.investigated}, stillUnknown ${channelMirrorReview.stillUnknown}, pendingTerminalAborted ${channelMirrorReview.pendingTerminalAborted}, missedDispatched ${channelMirrorReview.missedDispatched}, missedFailed ${channelMirrorReview.missedFailed}, failed ${channelMirrorReview.failed}`
    );
    return NextResponse.json({
      success: true,
      scanned,
      finalized,
      failed,
      jubelioSync: { scanned: 0, applied: 0, failed: 0, pending: 0 },
      jubelioSalesReview,
      settlementReview,
      channelMirrorReview,
    });
  } catch {
    log.error("reservation sweep failed", new RouteLogError("reservation sweep failed"));
    return NextResponse.json(
      { success: false, error: "Sweep failed" },
      { status: 500 }
    );
  }
}

/** HTTP entry: wrapper menambahkan `x-request-id` kanonik + satu baris completion. */
export const POST = withRequestContext(sweepReservations, "sweep-reservations");