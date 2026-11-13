import { and, asc, eq, lt } from "drizzle-orm";
import { db, orders } from "@/db";

/**
 * Persistence untuk pekerjaan recovery transaksi order (spec TX-04/TX-06).
 *
 * Slice TX-01 memakai pembacaan kandidat due dan view order minimum yang
 * dibutuhkan use case rekonsiliasi pembayaran. Field scheduling `due` akan
 * dipakai slice TX-04; jangan menambahkan urutan/limit yang berbeda di route.
 */

export type ReadDatabase = Pick<typeof db, "select">;

export interface PendingPaymentWork {
  id: string;
  status: string;
  paymentStatus: string;
  total: string;
  expiresAt: Date | null;
  /** A stored Snap redirect proves a session was created and possibly paid. */
  hasReadyRedirect: boolean;
}

const PAYMENT_WORK_COLUMNS = {
  id: orders.id,
  status: orders.status,
  paymentStatus: orders.paymentStatus,
  total: orders.total,
  expiresAt: orders.expiresAt,
  snapRedirectUrl: orders.snapRedirectUrl,
} as const;

function toWork(row: {
  id: string;
  status: string;
  paymentStatus: string;
  total: string;
  expiresAt: Date | null;
  snapRedirectUrl: string | null;
}): PendingPaymentWork {
  return {
    id: row.id,
    status: row.status,
    paymentStatus: row.paymentStatus,
    total: row.total,
    expiresAt: row.expiresAt,
    hasReadyRedirect: typeof row.snapRedirectUrl === "string" && row.snapRedirectUrl.trim().length > 0,
  };
}

/** One order's payment work, or null when the order does not exist. */
export async function loadPendingPaymentWork(
  orderId: string,
  database: ReadDatabase = db
): Promise<PendingPaymentWork | null> {
  const [row] = await database
    .select(PAYMENT_WORK_COLUMNS)
    .from(orders)
    .where(eq(orders.id, orderId))
    .limit(1);
  return row ? toWork(row) : null;
}

/**
 * Bounded, stable candidate scan: only pending_payment orders whose deadline
 * elapsed. Healthy delivery/settlement orders are never candidates, and the
 * order is stable by `(expires_at, id)`.
 */
export async function listDuePendingPaymentOrders(
  input: { now: Date; limit?: number },
  database: ReadDatabase = db
): Promise<Array<{ id: string }>> {
  const limit = Math.min(100, Math.max(1, input.limit ?? 50));
  return database
    .select({ id: orders.id })
    .from(orders)
    .where(and(eq(orders.status, "pending_payment"), lt(orders.expiresAt, input.now)))
    .orderBy(asc(orders.expiresAt), asc(orders.id))
    .limit(limit);
}
