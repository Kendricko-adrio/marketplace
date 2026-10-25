import { db } from "@/db";
import { branches, notifications, orderItems, orders } from "@/db";
import { and, eq, sql } from "drizzle-orm";
import { sendEmail } from "./email";
import {
  pickupReadyEmailHTML,
  pickupReadyEmailText,
} from "./email-templates-order";
import { createModuleLogger } from "./logger";

/**
 * Module-scope logger: hanya nama module yang diikat di sini. `requestId`
 * dibaca dari scope AsyncLocalStorage saat baris ditulis, jadi membuatnya sekali
 * ketika module dievaluasi (sebelum scope HTTP ada) adalah benar.
 */
const log = createModuleLogger("late-paid-side-effects");

/** Bentuk token kode yang boleh diteruskan: uppercase + angka + underscore. */
const SAFE_LOG_CODE = /^[A-Z][A-Z0-9_]{1,63}$/;

/** Proyeksi error statis milik module ini; teks asli provider tidak disalin. */
class LatePaidSideEffectsLogError extends Error {
  readonly code?: string;

  constructor(message: string, code?: string) {
    super(message);
    this.name = "LatePaidSideEffectsLogError";
    this.code = code;
  }
}

/**
 * Error dependency (penyimpanan/transport/notifikasi) diproyeksikan statis:
 * pesan konstan milik module, dan `code` hanya bila bentuknya token aman.
 * `message`, `stack`, `cause`, serta teks hasil provider tidak pernah disalin
 * ke log.
 */
function safeDependencyErrorLog(error: unknown): LatePaidSideEffectsLogError {
  return new LatePaidSideEffectsLogError(
    "Late-paid side effect gagal pada lapisan penyimpanan, transport atau notifikasi",
    knownLogCode(error)
  );
}

function knownLogCode(error: unknown): string | undefined {
  try {
    if (typeof error !== "object" || error === null || !("code" in error)) {
      return undefined;
    }
    const code = error.code;
    return typeof code === "string" && SAFE_LOG_CODE.test(code) ? code : undefined;
  } catch {
    // Nilai hostile (getter/proxy melempar) tidak membawa sinyal aman.
    return undefined;
  }
}

/** Runs the customer/admin effects after a late settlement has safely reached
 * ready_for_pickup. The notification query makes the durable admin effect
 * idempotent when reconciliation and webhook processing overlap. */
export async function deliverLatePaidOrderSideEffects(
  orderId: string
): Promise<void> {
  const orderRows = await db
    .select()
    .from(orders)
    .where(
      and(
        eq(orders.id, orderId),
        eq(orders.status, "ready_for_pickup"),
        eq(orders.paymentStatus, "paid")
      )
    )
    .limit(1);
  const order = orderRows[0];
  if (!order?.branchId || !order.pickupCode) return;

  try {
    const existing = await db
      .select({ id: notifications.id })
      .from(notifications)
      .where(
        and(
          eq(notifications.orderId, orderId),
          eq(notifications.type, "order_paid")
        )
      )
      .limit(1);
    if (existing.length === 0) {
      const id = crypto.randomUUID();
      await db.insert(notifications).values({
        id,
        type: "order_paid",
        orderId,
        branchId: order.branchId,
        title: "Late Payment Confirmed — Ready for Pickup",
        message: `Order #${order.id.slice(0, 8).toUpperCase()} settled after expiry and its stock is now confirmed.`,
      });
      await db.execute(
        sql`SELECT pg_notify('new_notification', ${JSON.stringify({ id })})`
      );
    }
  } catch (error) {
    log.error(
      `Order ${orderId}: late-paid admin notification failed`,
      safeDependencyErrorLog(error)
    );
  }

  try {
    const [branchRows, items] = await Promise.all([
      db.select().from(branches).where(eq(branches.id, order.branchId)).limit(1),
      db
        .select({
          productName: orderItems.productName,
          variantInfo: orderItems.variantInfo,
          price: orderItems.price,
          quantity: orderItems.quantity,
        })
        .from(orderItems)
        .where(eq(orderItems.orderId, orderId)),
    ]);
    const branch = branchRows[0];
    if (!branch) return;
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
    await sendEmail({
      to: order.contactEmail,
      subject: `Pembayaran Dikonfirmasi — #${order.id.slice(0, 8).toUpperCase()}`,
      html: pickupReadyEmailHTML({
        order: emailOrder,
        pickupCode: order.pickupCode,
        branch,
        items,
      }),
      text: pickupReadyEmailText({
        order: emailOrder,
        pickupCode: order.pickupCode,
        branch,
        items,
      }),
    });
  } catch (error) {
    log.error(
      `Order ${orderId}: late-paid pickup email failed`,
      safeDependencyErrorLog(error)
    );
  }
}
