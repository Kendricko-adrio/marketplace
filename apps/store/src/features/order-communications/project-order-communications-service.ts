/**
 * Service operasi `projectOrderCommunications` — satu operasi: memulihkan fakta
 * komunikasi yang hilang pada order bermarker versi 1, memproduksi efeknya
 * (job email + notifikasi admin), lalu memicu mirror Status Channel existing
 * secara best-effort.
 *
 * Service ini TIDAK mengirim SMTP: pengiriman dimiliki worker
 * (`sendDueOrderEmails`). Recovery di sini adalah safety net untuk crash
 * setelah transaksi bisnis committed — bukan jalur replay provider write dan
 * bukan rekonstruksi riwayat seluruh order lama.
 */

import { db } from "@/db";
import { deliveryShipments, orderCommunicationEvents, orders } from "@/db";
import { and, eq, inArray, isNotNull, isNull, notExists, or, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { OrderCommunicationDb } from "@marketplace/db/src/order-communications/order-communication-repository";
import {
  listProjectableOrderCommunications,
  materializeOrderCommunicationEffects,
  recordOrderCommunicationEvent,
} from "@marketplace/db/src/order-communications/order-communication-repository";
import {
  isOrderEmailKind,
  type OrderCommunicationKind,
  type OrderCommunicationSummary,
} from "@marketplace/db/src/order-communications/order-communication-contract";
import { reconcileJubelioChannelStatusForOrder } from "@/lib/jubelio-channel-mirror";
import { createModuleLogger } from "@/lib/logger";

const log = createModuleLogger("order-communications");

const MIRROR_TRIGGERING_KINDS: readonly OrderCommunicationKind[] = [
  "delivery_ready",
  "delivery_in_transit",
  "delivery_delivered",
  "delivery_closed_manually",
  "pickup_ready",
  "pickup_completed",
];

function hasVerifiedLedger(): SQL {
  return sql`(
    exists (select 1 from jubelio_sales_operation o where o.order_id = orders.id and o.type = 'create' and o.status = 'confirmed' and o.sales_order_id > 0)
    and exists (select 1 from jubelio_sales_operation o where o.order_id = orders.id and o.type = 'invoice' and o.status = 'confirmed' and o.invoice_id > 0)
    and exists (select 1 from jubelio_sales_operation o where o.order_id = orders.id and o.type = 'payment' and o.status = 'confirmed' and o.payment_id > 0)
  )`;
}

function missingEvent(kind: OrderCommunicationKind): SQL {
  return notExists(
    db
      .select({ one: sql`1` })
      .from(orderCommunicationEvents)
      .where(
        and(
          eq(orderCommunicationEvents.orderId, orders.id),
          eq(orderCommunicationEvents.kind, kind)
        )
      )
  );
}

/**
 * Catat fakta yang committed tetapi belum tercatat (crash setelah transaksi
 * bisnis). Semua query dibatasi pada order `order_communication_version >= 1`
 * sehingga baris lama tidak pernah menerima efek baru.
 */
async function recoverMissingEvents(
  database: OrderCommunicationDb,
  input: { limit: number; now: Date; orderId?: string }
): Promise<number> {
  let recovered = 0;
  const scope = input.orderId ? eq(orders.id, input.orderId) : undefined;

  const readyCandidates = await database
    .select({ id: orders.id, method: orders.fulfillmentMethod })
    .from(orders)
    .where(
      and(
        sql`${orders.orderCommunicationVersion} >= 1`,
        ...(scope ? [scope] : []),
        eq(orders.paymentStatus, "paid"),
        isNull(orders.fulfillmentBlockedReason),
        hasVerifiedLedger(),
        missingEvent("delivery_ready"),
        or(
          and(
            eq(orders.fulfillmentMethod, "delivery"),
            inArray(orders.status, ["processing", "completed"])
          ),
          and(
            eq(orders.fulfillmentMethod, "pickup"),
            isNotNull(orders.pickupCode),
            inArray(orders.status, ["ready_for_pickup", "completed"])
          )
        )
      )
    )
    .limit(input.limit);

  for (const candidate of readyCandidates) {
    const kind: OrderCommunicationKind =
      candidate.method === "pickup" ? "pickup_ready" : "delivery_ready";
    const recorded = await recordOrderCommunicationEvent(database, {
      orderId: candidate.id,
      kind,
      source: "recovery",
      occurredAt: null,
      receivedAt: input.now,
    });
    if (recorded.created) recovered += 1;
  }

  const pickupCompleted = await database
    .select({ id: orders.id })
    .from(orders)
    .where(
      and(
        sql`${orders.orderCommunicationVersion} >= 1`,
        ...(scope ? [scope] : []),
        eq(orders.fulfillmentMethod, "pickup"),
        isNotNull(orders.pickupCode),
        eq(orders.status, "completed"),
        missingEvent("pickup_completed")
      )
    )
    .limit(input.limit);
  for (const row of pickupCompleted) {
    const recorded = await recordOrderCommunicationEvent(database, {
      orderId: row.id,
      kind: "pickup_completed",
      source: "recovery",
      occurredAt: null,
      receivedAt: input.now,
    });
    if (recorded.created) recovered += 1;
  }

  const inTransit = await database
    .select({
      id: orders.id,
      occurredAt: deliveryShipments.handedOverAt,
    })
    .from(orders)
    .innerJoin(deliveryShipments, eq(deliveryShipments.orderId, orders.id))
    .where(
      and(
        sql`${orders.orderCommunicationVersion} >= 1`,
        ...(scope ? [scope] : []),
        eq(orders.fulfillmentMethod, "delivery"),
        or(
          isNotNull(deliveryShipments.handedOverAt),
          inArray(deliveryShipments.latestStatus, [
            "PICKED_UP",
            "ON_DELIVERY",
            "DELIVERED",
          ])
        ),
        missingEvent("delivery_in_transit")
      )
    )
    .limit(input.limit);
  for (const row of inTransit) {
    const recorded = await recordOrderCommunicationEvent(database, {
      orderId: row.id,
      kind: "delivery_in_transit",
      source: "recovery",
      occurredAt: row.occurredAt ?? null,
      receivedAt: input.now,
    });
    if (recorded.created) recovered += 1;
  }

  const delivered = await database
    .select({ id: orders.id, occurredAt: deliveryShipments.deliveredAt })
    .from(orders)
    .innerJoin(deliveryShipments, eq(deliveryShipments.orderId, orders.id))
    .where(
      and(
        sql`${orders.orderCommunicationVersion} >= 1`,
        ...(scope ? [scope] : []),
        eq(orders.fulfillmentMethod, "delivery"),
        isNotNull(deliveryShipments.deliveredAt),
        missingEvent("delivery_delivered")
      )
    )
    .limit(input.limit);
  for (const row of delivered) {
    const recorded = await recordOrderCommunicationEvent(database, {
      orderId: row.id,
      kind: "delivery_delivered",
      source: "recovery",
      occurredAt: row.occurredAt ?? null,
      receivedAt: input.now,
    });
    if (recorded.created) recovered += 1;
  }

  const closedManually = await database
    .select({ id: orders.id, occurredAt: orders.deliveryManualAt })
    .from(orders)
    .where(
      and(
        sql`${orders.orderCommunicationVersion} >= 1`,
        ...(scope ? [scope] : []),
        eq(orders.fulfillmentMethod, "delivery"),
        isNotNull(orders.deliveryManualReason),
        missingEvent("delivery_closed_manually")
      )
    )
    .limit(input.limit);
  for (const row of closedManually) {
    const recorded = await recordOrderCommunicationEvent(database, {
      orderId: row.id,
      kind: "delivery_closed_manually",
      source: "recovery",
      occurredAt: row.occurredAt ?? null,
      receivedAt: input.now,
    });
    if (recorded.created) recovered += 1;
  }

  return recovered;
}

function pendingEffects(
  state: Awaited<
    ReturnType<typeof listProjectableOrderCommunications>
  >[number]
): Array<{ eventId: string; kind: OrderCommunicationKind }> {
  const pending: Array<{ eventId: string; kind: OrderCommunicationKind }> = [];
  for (const event of state.events) {
    const emailPending =
      isOrderEmailKind(event.kind) && event.emailJobCreatedAt == null;
    const notificationPending =
      event.kind === "delivery_ready" && event.notificationCreatedAt == null;
    if (emailPending || notificationPending) {
      pending.push({ eventId: event.id, kind: event.kind });
    }
  }
  return pending;
}

async function triggerChannelMirror(orderId: string): Promise<boolean> {
  try {
    const outcome = await reconcileJubelioChannelStatusForOrder(db, { orderId });
    log.info(
      `Order ${orderId}: channel-status mirror projected after communication event (${outcome.status})`
    );
    return true;
  } catch {
    log.error(
      `Order ${orderId}: channel-status mirror projection failed after communication event`
    );
    return false;
  }
}

/** Produksi efek komunikasi untuk event committed (dan recovery versi 1). */
export async function projectOrderCommunications(input: {
  limit: number;
  orderId?: string;
  now?: Date;
  database?: OrderCommunicationDb;
  mirror?: boolean;
}): Promise<OrderCommunicationSummary> {
  const database = input.database ?? (db as unknown as OrderCommunicationDb);
  const now = input.now ?? new Date();
  const summary: OrderCommunicationSummary = {
    projected: 0,
    recoveredEvents: 0,
    emailJobsCreated: 0,
    notificationsCreated: 0,
    channelMirrorAttempted: 0,
  };

  summary.recoveredEvents = await recoverMissingEvents(database, {
    limit: input.limit,
    now,
    ...(input.orderId ? { orderId: input.orderId } : {}),
  });

  const states = await listProjectableOrderCommunications(database, {
    limit: input.limit,
    now,
    ...(input.orderId ? { orderId: input.orderId } : {}),
  });

  for (const state of states) {
    const pending = pendingEffects(state);
    if (pending.length === 0) continue;
    summary.projected += 1;
    let mirrored = false;
    for (const effect of pending) {
      const produced = await materializeOrderCommunicationEffects(database, {
        eventId: effect.eventId,
        now,
      });
      if (produced.emailJobCreated) summary.emailJobsCreated += 1;
      if (produced.notificationCreated) summary.notificationsCreated += 1;
      if (
        !mirrored &&
        input.mirror !== false &&
        MIRROR_TRIGGERING_KINDS.includes(effect.kind)
      ) {
        mirrored = true;
        summary.channelMirrorAttempted += 1;
        await triggerChannelMirror(state.orderId);
      }
    }
  }

  log.info(
    `Order communications projected: ${summary.projected} orders, ${summary.emailJobsCreated} email jobs, ${summary.notificationsCreated} notifications, ${summary.recoveredEvents} recovered events`
  );
  return summary;
}
