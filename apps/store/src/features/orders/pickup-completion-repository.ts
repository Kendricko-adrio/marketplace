/**
 * Repository penyelesaian pickup — guard + commit `completed` + fakta
 * komunikasi pada SATU transaksi.
 *
 * Dipakai service `completePickupOrder`; route HTTP tetap adapter tipis. Db
 * yang dipakai adalah instance app store (bukan shared singleton).
 */

import { db } from "@/db";
import { orders } from "@/db";
import { and, eq } from "drizzle-orm";
import { recordOrderCommunicationEvent } from "@marketplace/db/src/order-communications/order-communication-repository";

export type PickupCompletionOutcome =
  | { status: "completed"; completedAt: Date }
  | { status: "not_found" }
  | { status: "not_ready"; orderStatus: string };

/**
 * Guard `ready_for_pickup` → `completed`, idempoten: panggilan kedua pada order
 * yang sudah completed tidak mengubah apa pun dan tidak membuat fakta kedua.
 */
export async function completePickupWithCommunicationEvent(input: {
  orderId: string;
  now: Date;
}): Promise<PickupCompletionOutcome> {
  return db.transaction(async (tx) => {
    const rows = await tx
      .update(orders)
      .set({ status: "completed", updatedAt: input.now })
      .where(
        and(
          eq(orders.id, input.orderId),
          eq(orders.status, "ready_for_pickup")
        )
      )
      .returning({
        id: orders.id,
        orderCommunicationVersion: orders.orderCommunicationVersion,
      });
    const committed = rows[0];
    if (!committed) {
      const existing = await tx
        .select({ status: orders.status })
        .from(orders)
        .where(eq(orders.id, input.orderId))
        .limit(1);
      const row = existing[0];
      if (!row) return { status: "not_found" };
      if (row.status === "completed") {
        return { status: "completed", completedAt: input.now };
      }
      return { status: "not_ready", orderStatus: row.status };
    }
    if (committed.orderCommunicationVersion >= 1) {
      await recordOrderCommunicationEvent(tx, {
        orderId: input.orderId,
        kind: "pickup_completed",
        source: "pickup_completion",
        occurredAt: input.now,
        receivedAt: input.now,
      });
    }
    return { status: "completed", completedAt: input.now };
  });
}
