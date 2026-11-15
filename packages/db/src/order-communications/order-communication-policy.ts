/**
 * Policy domain `order-communications` — PURE, tanpa I/O.
 *
 * Dua keputusan yang tinggal di sini:
 *   1. `isOrderEmailApplicable` — apakah email tahap `kind` masih berlaku pada
 *      keadaan ORDER TERKINI. Kondisi terbaru selalu mengalahkan email lama
 *      (spec §5.3).
 *   2. `nextOrderEmailAttempt` — status/n jadwal berikutnya setelah satu
 *      attempt selesai, deterministik dan bisa diuji dengan jam palsu.
 */

import {
  ORDER_EMAIL_MAX_ATTEMPTS,
  ORDER_EMAIL_RETRY_DELAY_MS,
  type OrderCommunicationState,
  type OrderEmailKind,
  type OrderEmailSendOutcome,
} from "./order-communication-contract";

/**
 * Email hanya berlaku bila tahapnya masih tahap terakhir yang diketahui.
 *
 * - Marker versi komunikasi 0 (baris lama) tidak pernah mendapat efek baru.
 * - Delivery: ready → in_transit → delivered, dan penutupan manual
 *   menghentikan ready/in_transit tanpa menciptakan delivered.
 * - Pickup: ready → completed.
 * - Pembayaran gagal tidak dikirim setelah order menjadi paid (status
 *   authoritative sudah `paid`, bukan `failed_payment`).
 */
export function isOrderEmailApplicable(input: {
  kind: OrderEmailKind;
  state: OrderCommunicationState;
}): boolean {
  const { kind, state } = input;
  if (state.orderCommunicationVersion < 1) return false;
  const stage = state.stage;

  if (kind === "payment_failed") {
    return (
      stage.orderStatus === "failed_payment" && stage.paymentStatus === "failed"
    );
  }

  if (stage.fulfillmentMethod === "delivery") {
    if (kind === "delivery_delivered") return stage.delivered;
    if (stage.closedManually) return false;
    if (kind === "delivery_in_transit") {
      return stage.inTransit && !stage.delivered;
    }
    if (kind === "delivery_ready") {
      return stage.ready && !stage.inTransit && !stage.delivered;
    }
    return false;
  }

  if (stage.fulfillmentMethod === "pickup") {
    if (kind === "pickup_ready") {
      return stage.ready && stage.orderStatus === "ready_for_pickup";
    }
    if (kind === "pickup_completed") {
      return stage.orderStatus === "completed";
    }
    return false;
  }

  return false;
}

export type OrderEmailAttemptDecision = {
  status: "retry" | "failed";
  nextAttemptAt: Date | null;
};

/**
 * Keputusan setelah satu attempt tercatat.
 *
 * `attemptCount` adalah jumlah attempt yang SUDAH tercatat, termasuk attempt
 * yang baru selesai. Kegagalan definitif tidak diulang otomatis; kegagalan
 * sementara dan hasil tidak pasti memakai batas retry yang sama. Hasil tidak
 * pasti memang boleh menghasilkan email ganda — risiko itu disengaja dan
 * didokumentasikan, bukan exactly-once delivery.
 */
export function nextOrderEmailAttempt(input: {
  attemptCount: number;
  outcome: Exclude<OrderEmailSendOutcome, "accepted">;
  now: Date;
}): OrderEmailAttemptDecision {
  if (input.outcome === "permanent") {
    return { status: "failed", nextAttemptAt: null };
  }
  if (input.attemptCount >= ORDER_EMAIL_MAX_ATTEMPTS) {
    return { status: "failed", nextAttemptAt: null };
  }
  return {
    status: "retry",
    nextAttemptAt: new Date(input.now.getTime() + ORDER_EMAIL_RETRY_DELAY_MS),
  };
}
