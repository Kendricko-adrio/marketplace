/**
 * Service operasi `sendDueOrderEmails` — satu operasi: dispatch pekerjaan email
 * yang due.
 *
 * Urutan per job (spec §5.2/§5.3):
 *   1. claim atomik dengan lease (attempt SUDAH dicatat sebelum dispatch),
 *   2. baca ulang keadaan authoritative order + bukti pengiriman,
 *   3. bila tahap sudah dilewati → `superseded` (zero dispatch),
 *   4. render dari data tersimpan, kirim, lalu klasifikasikan hasilnya
 *      (sent / retry / failed / superseded).
 *
 * Kegagalan email tidak pernah membatalkan pembayaran/pesanan dan tidak
 * mengulang efek lain yang sudah selesai.
 */

import { db } from "@/db";
import { branches, orderEmailJobs, orderItems, orders } from "@/db";
import { eq } from "drizzle-orm";
import type { OrderCommunicationDb } from "@marketplace/db/src/order-communications/order-communication-repository";
import {
  claimDueOrderEmailJobs,
  finishOrderEmailAttempt,
  readOrderCommunicationState,
} from "@marketplace/db/src/order-communications/order-communication-repository";
import { isOrderEmailApplicable } from "@marketplace/db/src/order-communications/order-communication-policy";
import type {
  OrderEmailDispatchSummary,
  OrderEmailKind,
} from "@marketplace/db/src/order-communications/order-communication-contract";
import { BRAND_APP_URL } from "@/lib/email-config";
import {
  orderCompletedEmailHTML,
  orderCompletedEmailText,
  paymentFailedEmailHTML,
  paymentFailedEmailText,
  pickupReadyEmailHTML,
  pickupReadyEmailText,
} from "@/lib/email-templates-order";
import { createModuleLogger } from "@/lib/logger";
import {
  renderDeliveryOrderEmail,
  type DeliveryEmailOrder,
} from "./delivery-email-templates";
import { sendOrderEmail, type OrderEmailSender } from "./order-email-client";

const log = createModuleLogger("order-communications");

class OrderEmailLogError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OrderEmailLogError";
  }
}

function orderUrl(orderId: string): string {
  return `${BRAND_APP_URL.replace(/\/$/, "")}/account/orders/${orderId}`;
}

function shortId(orderId: string): string {
  return orderId.slice(0, 8).toUpperCase();
}

type LoadedOrder = {
  id: string;
  contactEmail: string;
  pickupCode: string | null;
  subtotal: string;
  shippingCost: string;
  serviceFee: string;
  ppnRate: string;
  ppnAmount: string;
  total: string;
  pickupDate: Date | null;
  pickupTime: string | null;
  paymentFailureReason: string | null;
  deliverySnapshot: unknown;
  branchId: string | null;
  itemRows: Array<{
    productName: string;
    variantInfo: string | null;
    price: string;
    quantity: number;
  }>;
  branch: {
    name: string;
    city: string;
    address: string;
    operatingHours: unknown;
  } | null;
};

async function loadOrder(
  database: OrderCommunicationDb,
  orderId: string
): Promise<LoadedOrder | null> {
  const rows = await database
    .select({
      id: orders.id,
      contactEmail: orders.contactEmail,
      pickupCode: orders.pickupCode,
      subtotal: orders.subtotal,
      shippingCost: orders.shippingCost,
      serviceFee: orders.serviceFee,
      ppnRate: orders.ppnRate,
      ppnAmount: orders.ppnAmount,
      total: orders.total,
      pickupDate: orders.pickupDate,
      pickupTime: orders.pickupTime,
      paymentFailureReason: orders.paymentFailureReason,
      deliverySnapshot: orders.deliverySnapshot,
      branchId: orders.branchId,
    })
    .from(orders)
    .where(eq(orders.id, orderId))
    .limit(1);
  const order = rows[0];
  if (!order) return null;
  const [itemRows, branchRows] = await Promise.all([
    database
      .select({
        productName: orderItems.productName,
        variantInfo: orderItems.variantInfo,
        price: orderItems.price,
        quantity: orderItems.quantity,
      })
      .from(orderItems)
      .where(eq(orderItems.orderId, orderId)),
    order.branchId
      ? database
          .select({
            name: branches.name,
            city: branches.city,
            address: branches.address,
            operatingHours: branches.operatingHours,
          })
          .from(branches)
          .where(eq(branches.id, order.branchId))
          .limit(1)
      : Promise.resolve([]),
  ]);
  return {
    ...order,
    itemRows,
    branch: branchRows[0] ?? null,
  };
}

function readDestination(snapshot: unknown): {
  destination: DeliveryEmailOrder["destination"];
  serviceName: string | null;
} {
  if (!snapshot || typeof snapshot !== "object") {
    return { destination: null, serviceName: null };
  }
  const payload = snapshot as {
    address?: Record<string, unknown>;
    service?: Record<string, unknown>;
  };
  const address = payload.address;
  const service = payload.service;
  const destination =
    address && typeof address === "object"
      ? {
          recipientName: String(address.recipientName ?? ""),
          phone: String(address.phone ?? ""),
          fullAddress: String(address.fullAddress ?? ""),
          city: String(address.city ?? ""),
          province: String(address.province ?? ""),
          postalCode: String(address.postalCode ?? ""),
        }
      : null;
  return {
    destination,
    serviceName:
      service && typeof service.name === "string" ? service.name : null,
  };
}

/**
 * Susun konten email dari data TERSIMPAN. Tidak ada reprice dan tidak ada
 * pickup date/time/kode pickup pada template delivery.
 */
async function buildOrderEmailContent(
  database: OrderCommunicationDb,
  orderId: string,
  kind: OrderEmailKind
): Promise<
  | {
      ok: true;
      content: {
        to: string;
        subject: string;
        html: string;
        text: string;
      };
    }
  | { ok: false; code: string }
> {
  const order = await loadOrder(database, orderId);
  if (!order || !order.contactEmail) {
    return { ok: false, code: "ORDER_DATA_UNAVAILABLE" };
  }

  if (kind === "delivery_ready" || kind === "delivery_in_transit" || kind === "delivery_delivered") {
    const { destination, serviceName } = readDestination(order.deliverySnapshot);
    const content = renderDeliveryOrderEmail({
      kind,
      orderUrl: orderUrl(order.id),
      order: {
        id: order.id,
        contactEmail: order.contactEmail,
        items: order.itemRows,
        subtotal: order.subtotal,
        shippingCost: order.shippingCost,
        serviceFee: order.serviceFee,
        ppnRate: order.ppnRate,
        ppnAmount: order.ppnAmount,
        total: order.total,
        branch: order.branch,
        destination,
        serviceName,
      },
    });
    return { ok: true, content };
  }

  const emailOrder = {
    id: order.id,
    total: order.total,
    subtotal: order.subtotal,
    serviceFee: order.serviceFee,
    ppnRate: order.ppnRate,
    ppnAmount: order.ppnAmount,
    pickupDate: order.pickupDate,
    pickupTime: order.pickupTime,
  };

  if (kind === "pickup_ready") {
    if (!order.pickupCode || !order.branch) {
      return { ok: false, code: "PICKUP_DATA_UNAVAILABLE" };
    }
    const branch = {
      name: order.branch.name,
      address: order.branch.address,
      city: order.branch.city,
      operatingHours: order.branch.operatingHours as never,
    };
    return {
      ok: true,
      content: {
        to: order.contactEmail,
        subject: `Your Order is Ready for Pickup — #${shortId(order.id)}`,
        html: pickupReadyEmailHTML({
          order: emailOrder,
          pickupCode: order.pickupCode,
          branch,
          items: order.itemRows,
        }),
        text: pickupReadyEmailText({
          order: emailOrder,
          pickupCode: order.pickupCode,
          branch,
          items: order.itemRows,
        }),
      },
    };
  }

  if (kind === "pickup_completed") {
    return {
      ok: true,
      content: {
        to: order.contactEmail,
        subject: `Your Order has been Completed — #${shortId(order.id)}`,
        html: orderCompletedEmailHTML({ order: emailOrder, items: order.itemRows }),
        text: orderCompletedEmailText({ order: emailOrder, items: order.itemRows }),
      },
    };
  }

  const reason = order.paymentFailureReason ?? "Pembayaran tidak dapat diselesaikan";
  return {
    ok: true,
    content: {
      to: order.contactEmail,
      subject: `Pembayaran Gagal — #${shortId(order.id)}`,
      html: paymentFailedEmailHTML({
        order: paymentFailedOrder(order),
        reason,
        items: order.itemRows,
      }),
      text: paymentFailedEmailText({
        order: paymentFailedOrder(order),
        reason,
        items: order.itemRows,
      }),
    },
  };
}

function paymentFailedOrder(order: LoadedOrder) {
  return {
    id: order.id,
    contactEmail: order.contactEmail,
    total: order.total,
    subtotal: order.subtotal,
    serviceFee: order.serviceFee,
    ppnRate: order.ppnRate,
    ppnAmount: order.ppnAmount,
    pickupDate: order.pickupDate,
    pickupTime: order.pickupTime,
  };
}

function emptySummary(): OrderEmailDispatchSummary {
  return {
    claimed: 0,
    sent: 0,
    retry: 0,
    failed: 0,
    superseded: 0,
    rejectedUnavailable: 0,
  };
}

/** Dispatch paling banyak `limit` job yang due sebelum `deadline`. */
export async function sendDueOrderEmails(
  input: {
    limit: number;
    now?: Date;
    deadline?: Date;
    sender?: OrderEmailSender;
    database?: OrderCommunicationDb;
  }
): Promise<OrderEmailDispatchSummary> {
  const database = input.database ?? (db as unknown as OrderCommunicationDb);
  const sender = input.sender ?? sendOrderEmail;
  // Budget default dihitung dari jam yang dipakai (bukan jam dinding), supaya
  // worker dengan jam terkontrol tidak berhenti sebelum mencoba apa pun.
  const base = input.now ?? new Date();
  const deadline = input.deadline ?? new Date(base.getTime() + 45_000);
  const summary = emptySummary();

  for (let index = 0; index < Math.max(1, input.limit); index += 1) {
    const now = input.now ?? new Date();
    if (now.getTime() >= deadline.getTime()) break;
    const claimed = await claimDueOrderEmailJobs(database, {
      limit: 1,
      now,
    });
    const job = claimed[0];
    if (!job) break;
    summary.claimed += 1;

    try {
      const state = await readOrderCommunicationState(database, job.orderId);
      if (!state) {
        await finishOrderEmailAttempt(database, {
          jobId: job.id,
          claimToken: job.claimToken,
          outcome: "permanent",
          errorCode: "ORDER_UNAVAILABLE",
          now,
        });
        summary.failed += 1;
        continue;
      }
      if (!isOrderEmailApplicable({ kind: job.kind, state })) {
        await finishOrderEmailAttempt(database, {
          jobId: job.id,
          claimToken: job.claimToken,
          outcome: "superseded",
          now,
        });
        summary.superseded += 1;
        continue;
      }

      const built = await buildOrderEmailContent(
        database,
        job.orderId,
        job.kind
      );
      if (!built.ok) {
        await finishOrderEmailAttempt(database, {
          jobId: job.id,
          claimToken: job.claimToken,
          outcome: "permanent",
          errorCode: built.code,
          now,
        });
        summary.failed += 1;
        summary.rejectedUnavailable += 1;
        continue;
      }

      const result = await sender(built.content);
      const finished = await finishOrderEmailAttempt(database, {
        jobId: job.id,
        claimToken: job.claimToken,
        outcome: result.outcome,
        errorCode: result.code,
        now,
      });
      if (!finished) {
        // Claim sudah diambil worker lain (lease recovery); hasil dispatch ini
        // tidak boleh menimpa claim baru.
        log.warn(
          `Order ${job.orderId}: email ${job.kind} result discarded — claim was taken over`
        );
        continue;
      }
      if (result.outcome === "accepted") summary.sent += 1;
      else {
        const nextStatus = await readJobStatus(database, job.id);
        if (nextStatus === "failed") summary.failed += 1;
        else summary.retry += 1;
      }
      log.info(
        `Order ${job.orderId}: order email ${job.kind} attempt ${job.attemptCount} finished (${result.outcome})`
      );
    } catch (error) {
      log.error(
        `Order ${job.orderId}: order email ${job.kind} dispatch failed`,
        new OrderEmailLogError("order email dispatch failed")
      );
      await finishOrderEmailAttempt(database, {
        jobId: job.id,
        claimToken: job.claimToken,
        outcome: "uncertain",
        errorCode: "DISPATCH_EXCEPTION",
        now,
      });
      summary.retry += 1;
      void error;
    }
  }

  return summary;
}

async function readJobStatus(
  database: OrderCommunicationDb,
  jobId: string
): Promise<string | null> {
  const rows = await database
    .select({ status: orderEmailJobs.status })
    .from(orderEmailJobs)
    .where(eq(orderEmailJobs.id, jobId))
    .limit(1);
  return rows[0]?.status ?? null;
}
